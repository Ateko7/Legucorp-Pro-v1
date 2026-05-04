create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text not null,
  level text not null
    check (level in ('critical', 'warning', 'info')),
  area text not null
    check (area in ('inventory', 'production', 'purchases', 'quality', 'general')),
  entity_type text not null,
  entity_id uuid,
  status text not null default 'active'
    check (status in ('active', 'reviewing', 'resolved')),
  action_url text not null,
  action_label text not null default 'Ver acción',
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (organization_id, dedupe_key)
);

create index if not exists idx_alerts_org_status_level_created
  on public.alerts (organization_id, status, level, created_at desc);

create index if not exists idx_alerts_org_area_status
  on public.alerts (organization_id, area, status, created_at desc);

alter table public.alerts enable row level security;

drop policy if exists org_alerts_all on public.alerts;
create policy org_alerts_all on public.alerts
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.alerts to anon;
grant all on table public.alerts to authenticated;
grant all on table public.alerts to service_role;

create or replace function public.upsert_operational_alert(
  p_organization_id uuid,
  p_title text,
  p_description text,
  p_level text,
  p_area text,
  p_entity_type text,
  p_entity_id uuid,
  p_action_url text,
  p_action_label text,
  p_dedupe_key text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert_id uuid;
begin
  insert into public.alerts (
    organization_id,
    title,
    description,
    level,
    area,
    entity_type,
    entity_id,
    status,
    action_url,
    action_label,
    dedupe_key,
    metadata,
    resolved_at,
    updated_at
  )
  values (
    p_organization_id,
    p_title,
    p_description,
    p_level,
    p_area,
    p_entity_type,
    p_entity_id,
    'active',
    p_action_url,
    coalesce(nullif(p_action_label, ''), 'Ver acción'),
    p_dedupe_key,
    coalesce(p_metadata, '{}'::jsonb),
    null,
    now()
  )
  on conflict (organization_id, dedupe_key)
  do update set
    title = excluded.title,
    description = excluded.description,
    level = excluded.level,
    area = excluded.area,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    status = 'active',
    action_url = excluded.action_url,
    action_label = excluded.action_label,
    metadata = excluded.metadata,
    resolved_at = null,
    updated_at = now()
  returning id into v_alert_id;

  return v_alert_id;
end;
$$;

create or replace function public.resolve_operational_alert(
  p_organization_id uuid,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.alerts
  set
    status = 'resolved',
    resolved_at = now(),
    updated_at = now()
  where organization_id = p_organization_id
    and dedupe_key = p_dedupe_key
    and status <> 'resolved';
end;
$$;

create or replace function public.sync_inventory_min_stock_alerts(
  p_organization_id uuid default public.get_my_profile_org()
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
  v_active_keys text[] := '{}';
begin
  for r in
    with stock_by_material as (
      select
        m.id as material_id,
        m.common_name,
        m.minimum_stock,
        m.base_unit,
        coalesce(sum(case when mil.status in ('disponible', 'parcial') then mil.available_quantity else 0 end), 0) as stock_available
      from public.materials m
      left join public.material_inventory_lots mil
        on mil.organization_id = m.organization_id
       and mil.material_id = m.id
      where m.organization_id = p_organization_id
        and m.status = 'activo'
      group by m.id, m.common_name, m.minimum_stock, m.base_unit
    )
    select *
    from stock_by_material
    where minimum_stock > 0
      and stock_available < minimum_stock
  loop
    v_active_keys := array_append(v_active_keys, format('inventory:min-stock:%s', r.material_id));

    perform public.upsert_operational_alert(
      p_organization_id,
      format('Inventario bajo mínimo: %s', r.common_name),
      format(
        'Disponible %s %s frente a mínimo %s %s.',
        round(coalesce(r.stock_available, 0)::numeric, 2),
        coalesce(r.base_unit, 'und'),
        round(coalesce(r.minimum_stock, 0)::numeric, 2),
        coalesce(r.base_unit, 'und')
      ),
      case when coalesce(r.stock_available, 0) <= 0 then 'critical' else 'warning' end,
      'inventory',
      'material',
      r.material_id,
      '/inventario-mp',
      'Ver inventario',
      format('inventory:min-stock:%s', r.material_id),
      jsonb_build_object(
        'material_name', r.common_name,
        'stock_available', r.stock_available,
        'minimum_stock', r.minimum_stock,
        'unit', r.base_unit
      )
    );

    v_count := v_count + 1;
  end loop;

  update public.alerts
  set
    status = 'resolved',
    resolved_at = now(),
    updated_at = now()
  where organization_id = p_organization_id
    and dedupe_key like 'inventory:min-stock:%'
    and status <> 'resolved'
    and not (dedupe_key = any(v_active_keys));

  return v_count;
end;
$$;

create or replace function public.trg_sync_supplier_scorecard_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.global_score, 0) < 70
     or coalesce(new.programs_at_risk, 0) > 0
     or coalesce(new.on_time_pct, 0) < 85 then
    perform public.upsert_operational_alert(
      new.organization_id,
      format('Proveedor con bajo cumplimiento: %s', coalesce((select s.name from public.suppliers s where s.id = new.supplier_id), 'Proveedor')),
      format(
        'Score %s, entregas a tiempo %s%% y %s programa(s) en riesgo.',
        round(coalesce(new.global_score, 0)::numeric, 2),
        round(coalesce(new.on_time_pct, 0)::numeric, 2),
        coalesce(new.programs_at_risk, 0)
      ),
      case when coalesce(new.global_score, 0) < 60 then 'critical' else 'warning' end,
      'purchases',
      'supplier',
      new.supplier_id,
      '/proveedores',
      'Ver proveedor',
      format('supplier:score:%s', new.supplier_id),
      jsonb_build_object(
        'global_score', new.global_score,
        'on_time_pct', new.on_time_pct,
        'quality_pct', new.quality_pct,
        'programs_at_risk', new.programs_at_risk
      )
    );
  else
    perform public.resolve_operational_alert(new.organization_id, format('supplier:score:%s', new.supplier_id));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_supplier_scorecards_alerts on public.supplier_scorecards;
create trigger trg_supplier_scorecards_alerts
after insert or update on public.supplier_scorecards
for each row execute function public.trg_sync_supplier_scorecard_alert();

create or replace function public.trg_sync_quality_lot_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := format('quality:inspection:%s', coalesce(new.finished_lot_id::text, new.id::text));
begin
  if new.status = 'completada' and new.resultado in ('rechazado', 'retenido') then
    perform public.upsert_operational_alert(
      new.organization_id,
      case when new.resultado = 'rechazado' then 'Lote rechazado por calidad' else 'Lote retenido por calidad' end,
      format(
        'Inspección %s con tasa de defectos de %s%%.',
        coalesce(new.resultado, 'observada'),
        round(coalesce(new.tasa_defectos, 0)::numeric, 2)
      ),
      case when new.resultado = 'rechazado' then 'critical' else 'warning' end,
      'quality',
      'batch',
      new.finished_lot_id,
      '/calidad',
      'Ver calidad',
      v_key,
      jsonb_build_object(
        'inspection_id', new.id,
        'result', new.resultado,
        'defect_rate', new.tasa_defectos,
        'lot_blocked', new.lote_bloqueado
      )
    );
  elsif new.status = 'completada' and new.resultado in ('liberado', 'liberado_con_observacion') then
    perform public.resolve_operational_alert(new.organization_id, v_key);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspecciones_calidad_alerts on public.inspecciones_calidad;
create trigger trg_inspecciones_calidad_alerts
after insert or update on public.inspecciones_calidad
for each row execute function public.trg_sync_quality_lot_alert();

grant execute on function public.upsert_operational_alert(uuid, text, text, text, text, text, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.upsert_operational_alert(uuid, text, text, text, text, text, uuid, text, text, text, jsonb) to service_role;

grant execute on function public.resolve_operational_alert(uuid, text) to authenticated;
grant execute on function public.resolve_operational_alert(uuid, text) to service_role;

grant execute on function public.sync_inventory_min_stock_alerts(uuid) to authenticated;
grant execute on function public.sync_inventory_min_stock_alerts(uuid) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;
end
$$;
