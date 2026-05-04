-- Clean up schema lint findings surfaced during the RLS hardening pass.

create or replace function public.create_operator_invitation(
  p_empleado_id uuid,
  p_expires_in_days integer default 14
)
returns table (
  invite_code text,
  expires_at timestamptz,
  empleado_id uuid,
  organization_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_empleado public.empleados%rowtype;
  v_code text;
  v_expires_at timestamptz;
begin
  select *
  into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if v_profile.id is null then
    raise exception 'No se encontro el perfil autenticado';
  end if;

  select *
  into v_empleado
  from public.empleados e
  where e.id = p_empleado_id
    and e.organization_id = v_profile.organization_id;

  if v_empleado.id is null then
    raise exception 'El empleado no existe o no pertenece a tu organizacion';
  end if;

  if coalesce(v_empleado.tipo_empleado, '') <> 'operario' then
    raise exception 'Solo puedes generar codigos para empleados tipo operario';
  end if;

  update public.operator_invitations oi
  set revoked_at = now()
  where oi.empleado_id = p_empleado_id
    and oi.used_at is null
    and oi.revoked_at is null;

  v_code := public.generate_operator_invite_code();
  v_expires_at := case
    when coalesce(p_expires_in_days, 0) <= 0 then null
    else now() + make_interval(days => p_expires_in_days)
  end;

  insert into public.operator_invitations (
    organization_id,
    empleado_id,
    invite_code,
    expires_at,
    created_by
  )
  values (
    v_profile.organization_id,
    p_empleado_id,
    v_code,
    v_expires_at,
    v_profile.id
  );

  return query
  select v_code, v_expires_at, p_empleado_id, v_profile.organization_id;
end;
$$;

create or replace function public.generate_sales_budget_next_month(
  p_source_year integer,
  p_source_month integer,
  p_target_year integer,
  p_target_month integer,
  p_salesperson_id uuid default null,
  p_client_id uuid default null
) returns table (
  client_id uuid,
  client_name text,
  projected_amount numeric,
  action text
) language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.get_my_profile_org();
  v_created_by uuid := auth.uid();
  v_existing public.sales_budgets%rowtype;
  v_updated_count integer;
  r record;
  v_projected_amount numeric;
begin
  for r in
    select
      sb.client_id,
      c.commercial_name as client_name,
      coalesce(sb.salesperson_id, c.salesperson_id) as salesperson_id,
      sb.budget_units,
      coalesce(cfg.history_months, 3) as history_months
    from public.sales_budgets sb
    join public.clients c on c.id = sb.client_id
    left join public.sales_projection_configs cfg
      on cfg.organization_id = sb.organization_id
     and cfg.client_id = sb.client_id
     and cfg.is_active = true
    where sb.organization_id = v_org
      and sb.budget_year = p_source_year
      and sb.budget_month = p_source_month
      and (p_salesperson_id is null or coalesce(sb.salesperson_id, c.salesperson_id) = p_salesperson_id)
      and (p_client_id is null or sb.client_id = p_client_id)
  loop
    v_projected_amount := public.suggest_sales_budget_amount(
      r.client_id,
      p_target_year,
      p_target_month,
      r.history_months
    );

    select *
    into v_existing
    from public.sales_budgets sb
    where sb.organization_id = v_org
      and sb.client_id = r.client_id
      and sb.budget_year = p_target_year
      and sb.budget_month = p_target_month
    limit 1;

    if found and coalesce(v_existing.auto_generated, false) = false then
      client_id := r.client_id;
      client_name := r.client_name;
      projected_amount := v_existing.budget_amount;
      action := 'manual_existente';
      return next;
      continue;
    end if;

    insert into public.sales_budgets (
      organization_id,
      client_id,
      salesperson_id,
      budget_year,
      budget_month,
      budget_amount,
      budget_units,
      auto_generated,
      created_by,
      updated_at
    )
    values (
      v_org,
      r.client_id,
      r.salesperson_id,
      p_target_year,
      p_target_month,
      v_projected_amount,
      r.budget_units,
      true,
      v_created_by,
      now()
    )
    on conflict on constraint sales_budgets_organization_id_client_id_budget_year_budget__key
    do update set
      salesperson_id = excluded.salesperson_id,
      budget_amount = excluded.budget_amount,
      budget_units = excluded.budget_units,
      auto_generated = true,
      updated_at = now()
    where public.sales_budgets.auto_generated = true;

    get diagnostics v_updated_count = row_count;

    client_id := r.client_id;
    client_name := r.client_name;
    projected_amount := v_projected_amount;
    action := case when v_existing.id is not null and v_updated_count > 0 then 'actualizado' else 'creado' end;
    return next;
  end loop;
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
  v_active_keys text[] := array[]::text[];
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
      format('Inventario bajo minimo: %s', r.common_name),
      format(
        'Disponible %s %s frente a minimo %s %s.',
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

  update public.alerts a
  set
    status = 'resolved',
    resolved_at = now(),
    updated_at = now()
  where a.organization_id = p_organization_id
    and a.dedupe_key like 'inventory:min-stock:%'
    and a.status <> 'resolved'
    and not (a.dedupe_key = any(v_active_keys));

  return v_count;
end;
$$;

revoke execute on function public.create_operator_invitation(uuid, integer) from anon;
revoke execute on function public.generate_sales_budget_next_month(integer, integer, integer, integer, uuid, uuid) from anon;
