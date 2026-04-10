create or replace function public.suggest_sales_budget_amount(
  p_client_id uuid,
  p_target_year integer,
  p_target_month integer,
  p_history_months integer default 3
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.get_my_profile_org();
  v_target_date date := make_date(p_target_year, p_target_month, 1);
  v_avg_deviation numeric;
  v_current_budget numeric;
  v_avg_actual numeric;
begin
  select avg(
    case
      when hist.budget_amount > 0
        then (coalesce(hist.actual_amount, 0) - hist.budget_amount) / hist.budget_amount
      else null
    end
  )
  into v_avg_deviation
  from (
    select
      sb.budget_amount,
      (
        select sum(coalesce(o.total, 0))
        from public.orders o
        where o.organization_id = v_org
          and o.client_id = sb.client_id
          and o.status <> 'cancelado'
          and date_trunc('month', coalesce(o.delivery_date, o.created_at::date)) = make_date(sb.budget_year, sb.budget_month, 1)
      ) as actual_amount
    from public.sales_budgets sb
    where sb.organization_id = v_org
      and sb.client_id = p_client_id
      and make_date(sb.budget_year, sb.budget_month, 1) < v_target_date
    order by sb.budget_year desc, sb.budget_month desc
    limit greatest(1, p_history_months)
  ) hist;

  select sb.budget_amount
  into v_current_budget
  from public.sales_budgets sb
  where sb.organization_id = v_org
    and sb.client_id = p_client_id
    and make_date(sb.budget_year, sb.budget_month, 1) = (
      select max(make_date(sbh.budget_year, sbh.budget_month, 1))
      from public.sales_budgets sbh
      where sbh.organization_id = v_org
        and sbh.client_id = p_client_id
        and make_date(sbh.budget_year, sbh.budget_month, 1) < v_target_date
    )
  limit 1;

  if v_current_budget is not null and v_current_budget > 0 then
    return round(greatest(0, v_current_budget * (1 + coalesce(v_avg_deviation, 0)))::numeric, 2);
  end if;

  select avg(actual_amount)
  into v_avg_actual
  from (
    select
      sum(coalesce(o.total, 0)) as actual_amount
    from public.orders o
    where o.organization_id = v_org
      and o.client_id = p_client_id
      and o.status <> 'cancelado'
      and date_trunc('month', coalesce(o.delivery_date, o.created_at::date)) < v_target_date
    group by date_trunc('month', coalesce(o.delivery_date, o.created_at::date))
    order by date_trunc('month', coalesce(o.delivery_date, o.created_at::date)) desc
    limit greatest(1, p_history_months)
  ) actuals;

  return round(greatest(0, coalesce(v_avg_actual, 0))::numeric, 2);
end;
$$;

create or replace function public.ensure_sales_budget_month(
  p_year integer,
  p_month integer,
  p_salesperson_id uuid default null,
  p_client_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.get_my_profile_org();
  v_created_by uuid := auth.uid();
  v_inserted_count integer := 0;
begin
  insert into public.sales_budgets (
    organization_id,
    client_id,
    salesperson_id,
    budget_year,
    budget_month,
    budget_amount,
    budget_units,
    auto_generated,
    created_by
  )
  select
    c.organization_id,
    c.id,
    c.salesperson_id,
    p_year,
    p_month,
    public.suggest_sales_budget_amount(
      c.id,
      p_year,
      p_month,
      coalesce(cfg.history_months, 3)
    ),
    null,
    true,
    v_created_by
  from public.clients c
  left join public.sales_projection_configs cfg
    on cfg.organization_id = c.organization_id
   and cfg.client_id = c.id
   and cfg.is_active = true
  where c.organization_id = v_org
    and c.status = 'activo'
    and (p_salesperson_id is null or c.salesperson_id = p_salesperson_id)
    and (p_client_id is null or c.id = p_client_id)
    and not exists (
      select 1
      from public.sales_budgets sb
      where sb.organization_id = v_org
        and sb.client_id = c.id
        and sb.budget_year = p_year
        and sb.budget_month = p_month
    );

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
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
    on conflict (organization_id, client_id, budget_year, budget_month)
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

grant execute on function public.suggest_sales_budget_amount(uuid, integer, integer, integer) to anon;
grant execute on function public.suggest_sales_budget_amount(uuid, integer, integer, integer) to authenticated;
grant execute on function public.suggest_sales_budget_amount(uuid, integer, integer, integer) to service_role;
