-- Transfer pricing engine — snapshot inmutable + función de cálculo cost-plus.
-- Ancla de auditoría para el estudio de precios de transferencia intercompany.

-- ============================================================
-- 1. transfer_pricing_snapshots
-- ============================================================
create table if not exists public.transfer_pricing_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Contexto
  partner_id uuid not null references public.intercompany_partners(id) on delete restrict,
  order_item_id uuid references public.order_items(id) on delete set null,
  product_presentation_id uuid references public.product_presentations(id) on delete set null,
  product_base_id uuid references public.product_bases(id) on delete set null,
  finished_inventory_lot_id uuid references public.finished_inventory_lots(id) on delete set null,
  quantity numeric(14,4) not null,

  -- Método y fuente del costo base
  method text not null default 'cost_plus' check (method in ('cost_plus','cup','resale','apa')),
  base_cost numeric(14,6) not null,
  base_cost_source text not null
    check (base_cost_source in ('industrial_cost_snapshot','lot_unit_cost','standard_cost','manual')),
  industrial_cost_snapshot_id uuid references public.industrial_cost_snapshots(id) on delete set null,

  -- Markup aplicado
  markup_pct numeric(9,4) not null,
  markup_source_agreement_id uuid references public.intercompany_price_agreements(id) on delete set null,

  -- Moneda / FX
  currency text not null default 'GTQ',
  fx_rate numeric(14,6) not null default 1,

  -- Resultado
  final_price numeric(14,6) not null,
  line_total numeric(14,4) not null,

  -- Documentación TP
  tp_study_ref text,
  tp_study_url text,

  -- Estado
  frozen boolean not null default false,

  calculated_by uuid references public.profiles(id) on delete set null,
  calculated_at timestamptz not null default now()
);

create index if not exists idx_tp_snapshots_order_item
  on public.transfer_pricing_snapshots(order_item_id)
  where order_item_id is not null;

create index if not exists idx_tp_snapshots_partner
  on public.transfer_pricing_snapshots(organization_id, partner_id, calculated_at desc);

-- ============================================================
-- 2. Trigger de inmutabilidad: una vez frozen, no se puede modificar
-- ============================================================
create or replace function public.trg_tp_snapshot_immutable()
returns trigger
language plpgsql as $$
begin
  if old.frozen and tg_op = 'UPDATE' then
    -- Permitimos solo el paso de no-frozen a frozen
    if not (old.frozen = false and new.frozen = true) then
      raise exception 'transfer_pricing_snapshots es inmutable una vez congelado (id=%)', old.id;
    end if;
    -- Si ya estaba frozen, prohibir cualquier cambio
    if old.frozen = true then
      raise exception 'No se puede modificar un transfer_pricing_snapshot congelado (id=%)', old.id;
    end if;
  end if;
  if old.frozen and tg_op = 'DELETE' then
    raise exception 'No se puede eliminar un transfer_pricing_snapshot congelado (id=%)', old.id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_tp_snapshot_immutable_upd on public.transfer_pricing_snapshots;
create trigger trg_tp_snapshot_immutable_upd
  before update or delete on public.transfer_pricing_snapshots
  for each row execute function public.trg_tp_snapshot_immutable();

-- ============================================================
-- 3. FK de order_items al snapshot (diferida)
-- ============================================================
alter table public.order_items
  add column if not exists transfer_pricing_snapshot_id uuid
    references public.transfer_pricing_snapshots(id) on delete set null;

create index if not exists idx_order_items_tp_snapshot
  on public.order_items(transfer_pricing_snapshot_id)
  where transfer_pricing_snapshot_id is not null;

-- ============================================================
-- 4. Función calculate_transfer_price (cost-plus)
-- ============================================================
create or replace function public.calculate_transfer_price(
  p_partner_id uuid,
  p_product_presentation_id uuid,
  p_finished_inventory_lot_id uuid,
  p_quantity numeric,
  p_order_item_id uuid default null,
  p_calculated_by uuid default null,
  p_freeze boolean default false
)
returns public.transfer_pricing_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_product_base_id uuid;
  v_category text;
  v_lot_unit_cost numeric(14,6);
  v_base_cost numeric(14,6);
  v_base_source text;
  v_ics_id uuid;
  v_agreement record;
  v_final_price numeric(14,6);
  v_snapshot public.transfer_pricing_snapshots;
  v_partner record;
  v_fx numeric(14,6) := 1;
begin
  -- Partner y org
  select p.* into v_partner
    from public.intercompany_partners p
    where p.id = p_partner_id;

  if v_partner.id is null then
    raise exception 'Partner intercompany % no existe', p_partner_id;
  end if;
  v_org_id := v_partner.organization_id;

  -- Resolver product_base y category
  select pp.product_base_id, pb.category
    into v_product_base_id, v_category
    from public.product_presentations pp
    left join public.product_bases pb on pb.id = pp.product_base_id
    where pp.id = p_product_presentation_id;

  if v_product_base_id is null then
    raise exception 'Presentación de producto % no existe', p_product_presentation_id;
  end if;

  -- 1) base_cost: preferir industrial_cost_snapshot del lote (más auditable)
  if p_finished_inventory_lot_id is not null then
    select ics.id,
           case when ics.quantity > 0 then ics.total_cost / ics.quantity else null end
      into v_ics_id, v_base_cost
      from public.industrial_cost_snapshots ics
      where ics.finished_inventory_lot_id = p_finished_inventory_lot_id
        and ics.snapshot_kind = 'lote_terminado'
        and ics.organization_id = v_org_id
      order by ics.snapshot_date desc, ics.created_at desc
      limit 1;

    if v_base_cost is not null then
      v_base_source := 'industrial_cost_snapshot';
    else
      select unit_cost into v_lot_unit_cost
        from public.finished_inventory_lots
        where id = p_finished_inventory_lot_id;
      if v_lot_unit_cost is not null and v_lot_unit_cost > 0 then
        v_base_cost := v_lot_unit_cost;
        v_base_source := 'lot_unit_cost';
      end if;
    end if;
  end if;

  -- Último fallback: standard_cost de la presentación
  if v_base_cost is null or v_base_cost = 0 then
    select standard_cost into v_base_cost
      from public.product_presentations
      where id = p_product_presentation_id;
    if v_base_cost is not null and v_base_cost > 0 then
      v_base_source := 'standard_cost';
    end if;
  end if;

  if v_base_cost is null or v_base_cost = 0 then
    raise exception 'No se pudo determinar base_cost para presentación % / lote %',
      p_product_presentation_id, p_finished_inventory_lot_id;
  end if;

  -- 2) Resolver acuerdo: sku > product > category > global (más específico gana)
  select a.* into v_agreement
    from public.intercompany_price_agreements a
    where a.partner_id = p_partner_id
      and a.is_active
      and a.valid_from <= current_date
      and (a.valid_to is null or a.valid_to >= current_date)
      and (
        (a.scope_type = 'product' and a.product_base_id = v_product_base_id) or
        (a.scope_type = 'category' and a.category is not distinct from v_category) or
        (a.scope_type = 'global')
      )
    order by case a.scope_type
               when 'product' then 1
               when 'category' then 2
               when 'global' then 3
             end,
             a.valid_from desc
    limit 1;

  if v_agreement.id is null then
    raise exception 'No hay acuerdo intercompany activo para partner % / producto %',
      p_partner_id, v_product_base_id;
  end if;

  -- 3) FX (hoy ambos GTQ; dejamos la puerta abierta)
  if v_agreement.currency <> v_partner.currency then
    -- TODO: lookup en fx_rates cuando exista
    v_fx := 1;
  end if;

  v_final_price := round(v_base_cost * (1 + v_agreement.markup_pct / 100.0) * v_fx, 6);

  -- 4) Insertar snapshot
  insert into public.transfer_pricing_snapshots (
    organization_id, partner_id, order_item_id,
    product_presentation_id, product_base_id, finished_inventory_lot_id,
    quantity, method, base_cost, base_cost_source, industrial_cost_snapshot_id,
    markup_pct, markup_source_agreement_id, currency, fx_rate,
    final_price, line_total, tp_study_ref, tp_study_url,
    frozen, calculated_by
  ) values (
    v_org_id, p_partner_id, p_order_item_id,
    p_product_presentation_id, v_product_base_id, p_finished_inventory_lot_id,
    p_quantity, 'cost_plus', v_base_cost, v_base_source, v_ics_id,
    v_agreement.markup_pct, v_agreement.id, v_agreement.currency, v_fx,
    v_final_price, round(v_final_price * p_quantity, 4),
    v_agreement.tp_study_ref, v_agreement.tp_study_url,
    coalesce(p_freeze, false), p_calculated_by
  )
  returning * into v_snapshot;

  return v_snapshot;
end;
$$;

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.transfer_pricing_snapshots enable row level security;

drop policy if exists org_tp_snapshots_read on public.transfer_pricing_snapshots;
create policy org_tp_snapshots_read on public.transfer_pricing_snapshots
  for select using (organization_id = public.get_my_profile_org());

drop policy if exists org_tp_snapshots_insert on public.transfer_pricing_snapshots;
create policy org_tp_snapshots_insert on public.transfer_pricing_snapshots
  for insert with check (organization_id = public.get_my_profile_org());

drop policy if exists org_tp_snapshots_update on public.transfer_pricing_snapshots;
create policy org_tp_snapshots_update on public.transfer_pricing_snapshots
  for update using (organization_id = public.get_my_profile_org() and not frozen)
  with check (organization_id = public.get_my_profile_org());

grant execute on function public.calculate_transfer_price(uuid, uuid, uuid, numeric, uuid, uuid, boolean)
  to authenticated, service_role;
