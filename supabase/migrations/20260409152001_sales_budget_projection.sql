create table if not exists public.sales_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  salesperson_id uuid references public.salespeople(id) on delete set null,
  budget_year integer not null check (budget_year between 2020 and 2100),
  budget_month integer not null check (budget_month between 1 and 12),
  budget_amount numeric(14,2) not null default 0 check (budget_amount >= 0),
  budget_units numeric(14,4) check (budget_units is null or budget_units >= 0),
  auto_generated boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, budget_year, budget_month)
);

create index if not exists idx_sales_budgets_org_period
  on public.sales_budgets (organization_id, budget_year, budget_month, salesperson_id);

create index if not exists idx_sales_budgets_client
  on public.sales_budgets (client_id, budget_year desc, budget_month desc);

create table if not exists public.sales_projection_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  history_months integer not null default 3 check (history_months between 1 and 24),
  projection_method text not null default 'promedio_desviacion'
    check (projection_method in ('promedio_desviacion')),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id)
);

create table if not exists public.sales_budget_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  salesperson_id uuid references public.salespeople(id) on delete set null,
  budget_year integer not null check (budget_year between 2020 and 2100),
  budget_month integer not null check (budget_month between 1 and 12),
  budget_amount numeric(14,2) not null default 0 check (budget_amount >= 0),
  budget_units numeric(14,4) check (budget_units is null or budget_units >= 0),
  actual_amount numeric(14,2) not null default 0,
  expected_amount numeric(14,2) not null default 0,
  deviation_pct numeric(14,6) not null default 0,
  compliance_pct numeric(14,6) not null default 0,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz not null default now(),
  next_budget_generated boolean not null default false,
  unique (organization_id, client_id, budget_year, budget_month)
);

create index if not exists idx_sales_budget_closures_org_period
  on public.sales_budget_closures (organization_id, budget_year desc, budget_month desc);

alter table public.sales_budgets enable row level security;
alter table public.sales_projection_configs enable row level security;
alter table public.sales_budget_closures enable row level security;

drop policy if exists org_sales_budgets_all on public.sales_budgets;
create policy org_sales_budgets_all on public.sales_budgets
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_sales_projection_configs_all on public.sales_projection_configs;
create policy org_sales_projection_configs_all on public.sales_projection_configs
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_sales_budget_closures_all on public.sales_budget_closures;
create policy org_sales_budget_closures_all on public.sales_budget_closures
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.sales_budgets to anon;
grant all on table public.sales_budgets to authenticated;
grant all on table public.sales_budgets to service_role;
grant all on table public.sales_projection_configs to anon;
grant all on table public.sales_projection_configs to authenticated;
grant all on table public.sales_projection_configs to service_role;
grant all on table public.sales_budget_closures to anon;
grant all on table public.sales_budget_closures to authenticated;
grant all on table public.sales_budget_closures to service_role;

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
    0,
    null,
    false,
    v_created_by
  from public.clients c
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

create or replace function public.get_sales_budget_dashboard(
  p_year integer,
  p_month integer,
  p_salesperson_id uuid default null,
  p_client_id uuid default null
) returns table (
  budget_id uuid,
  client_id uuid,
  client_name text,
  salesperson_id uuid,
  salesperson_name text,
  budget_year integer,
  budget_month integer,
  budget_amount numeric,
  budget_units numeric,
  actual_amount numeric,
  expected_amount numeric,
  expected_progress_pct numeric,
  compliance_pct numeric,
  deviation_pct numeric,
  status_color text,
  history_months integer,
  projection_method text,
  projected_next_amount numeric,
  is_auto_generated boolean
) language sql
security definer
set search_path = public
as $$
with month_bounds as (
  select
    make_date(p_year, p_month, 1) as month_start,
    (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as month_end
),
sales_actual as (
  select
    o.client_id,
    sum(coalesce(o.total, 0)) as actual_amount
  from public.orders o
  cross join month_bounds mb
  where o.organization_id = public.get_my_profile_org()
    and o.status <> 'cancelado'
    and date_trunc('month', coalesce(o.delivery_date, o.created_at::date)) = date_trunc('month', mb.month_start)
  group by o.client_id
),
budget_base as (
  select
    sb.id as budget_id,
    sb.client_id,
    c.commercial_name as client_name,
    coalesce(sb.salesperson_id, c.salesperson_id) as salesperson_id,
    sp.name as salesperson_name,
    sb.budget_year,
    sb.budget_month,
    sb.budget_amount,
    sb.budget_units,
    sb.auto_generated,
    coalesce(cfg.history_months, 3) as history_months,
    coalesce(cfg.projection_method, 'promedio_desviacion') as projection_method,
    coalesce(sa.actual_amount, 0) as actual_amount,
    case
      when current_date < mb.month_start then 0::numeric
      when current_date > mb.month_end then 1::numeric
      else extract(day from current_date)::numeric / extract(day from mb.month_end)::numeric
    end as expected_progress_ratio
  from public.sales_budgets sb
  join public.clients c on c.id = sb.client_id
  left join public.salespeople sp on sp.id = coalesce(sb.salesperson_id, c.salesperson_id)
  left join public.sales_projection_configs cfg
    on cfg.organization_id = sb.organization_id
   and cfg.client_id = sb.client_id
   and cfg.is_active = true
  left join sales_actual sa on sa.client_id = sb.client_id
  cross join month_bounds mb
  where sb.organization_id = public.get_my_profile_org()
    and sb.budget_year = p_year
    and sb.budget_month = p_month
    and (p_salesperson_id is null or coalesce(sb.salesperson_id, c.salesperson_id) = p_salesperson_id)
    and (p_client_id is null or sb.client_id = p_client_id)
),
historical_deviation as (
  select
    bb.client_id,
    avg(
      case
        when hist.budget_amount > 0
          then (coalesce(hist_actual.actual_amount, 0) - hist.budget_amount) / hist.budget_amount
        else 0
      end
    ) as avg_deviation
  from budget_base bb
  left join lateral (
    select
      sbh.client_id,
      sbh.budget_year,
      sbh.budget_month,
      sbh.budget_amount
    from public.sales_budgets sbh
    where sbh.organization_id = public.get_my_profile_org()
      and sbh.client_id = bb.client_id
      and make_date(sbh.budget_year, sbh.budget_month, 1) < make_date(p_year, p_month, 1)
    order by sbh.budget_year desc, sbh.budget_month desc
    limit bb.history_months
  ) hist on true
  left join lateral (
    select
      sum(coalesce(o.total, 0)) as actual_amount
    from public.orders o
    where o.organization_id = public.get_my_profile_org()
      and o.client_id = hist.client_id
      and o.status <> 'cancelado'
      and extract(year from coalesce(o.delivery_date, o.created_at::date)) = hist.budget_year
      and extract(month from coalesce(o.delivery_date, o.created_at::date)) = hist.budget_month
  ) hist_actual on true
  group by bb.client_id
)
select
  bb.budget_id,
  bb.client_id,
  bb.client_name,
  bb.salesperson_id,
  bb.salesperson_name,
  bb.budget_year,
  bb.budget_month,
  bb.budget_amount,
  bb.budget_units,
  bb.actual_amount,
  round((bb.budget_amount * bb.expected_progress_ratio)::numeric, 2) as expected_amount,
  round((bb.expected_progress_ratio * 100)::numeric, 4) as expected_progress_pct,
  round(
    case
      when bb.budget_amount > 0 then (bb.actual_amount / bb.budget_amount) * 100
      else 0
    end::numeric,
    4
  ) as compliance_pct,
  round(
    case
      when (bb.budget_amount * bb.expected_progress_ratio) > 0
        then ((bb.actual_amount - (bb.budget_amount * bb.expected_progress_ratio)) / (bb.budget_amount * bb.expected_progress_ratio)) * 100
      else 0
    end::numeric,
    4
  ) as deviation_pct,
  case
    when bb.actual_amount > (bb.budget_amount * bb.expected_progress_ratio * 1.05) then 'green'
    when bb.actual_amount < (bb.budget_amount * bb.expected_progress_ratio * 0.95) then 'red'
    else 'neutral'
  end as status_color,
  bb.history_months,
  bb.projection_method,
  round((bb.budget_amount * (1 + coalesce(hd.avg_deviation, 0)))::numeric, 2) as projected_next_amount,
  bb.auto_generated
from budget_base bb
left join historical_deviation hd on hd.client_id = bb.client_id
order by bb.client_name;
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
  r record;
  v_avg_deviation numeric;
  v_projected_amount numeric;
begin
  for r in
    select
      sb.client_id,
      c.commercial_name as client_name,
      coalesce(sb.salesperson_id, c.salesperson_id) as salesperson_id,
      sb.budget_amount,
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
    select avg(
      case
        when hist.budget_amount > 0
          then (coalesce(hist.actual_amount, 0) - hist.budget_amount) / hist.budget_amount
        else 0
      end
    )
    into v_avg_deviation
    from (
      select
        sbh.budget_amount,
        (
          select sum(coalesce(o.total, 0))
          from public.orders o
          where o.organization_id = v_org
            and o.client_id = sbh.client_id
            and o.status <> 'cancelado'
            and extract(year from coalesce(o.delivery_date, o.created_at::date)) = sbh.budget_year
            and extract(month from coalesce(o.delivery_date, o.created_at::date)) = sbh.budget_month
        ) as actual_amount
      from public.sales_budgets sbh
      where sbh.organization_id = v_org
        and sbh.client_id = r.client_id
        and make_date(sbh.budget_year, sbh.budget_month, 1) < make_date(p_source_year, p_source_month, 1)
      order by sbh.budget_year desc, sbh.budget_month desc
      limit r.history_months
    ) hist;

    v_projected_amount := greatest(0, round((coalesce(r.budget_amount, 0) * (1 + coalesce(v_avg_deviation, 0)))::numeric, 2));

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

    client_id := r.client_id;
    client_name := r.client_name;
    projected_amount := v_projected_amount;
    action := case when found then 'actualizado' else 'creado' end;
    return next;
  end loop;
end;
$$;

create or replace function public.close_sales_budget_month(
  p_year integer,
  p_month integer,
  p_salesperson_id uuid default null,
  p_client_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_month_date date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_generated_count integer := 0;
begin
  insert into public.sales_budget_closures (
    organization_id,
    client_id,
    salesperson_id,
    budget_year,
    budget_month,
    budget_amount,
    budget_units,
    actual_amount,
    expected_amount,
    deviation_pct,
    compliance_pct,
    closed_by,
    next_budget_generated
  )
  select
    public.get_my_profile_org(),
    row.client_id,
    row.salesperson_id,
    p_year,
    p_month,
    row.budget_amount,
    row.budget_units,
    row.actual_amount,
    row.expected_amount,
    row.deviation_pct,
    row.compliance_pct,
    auth.uid(),
    true
  from public.get_sales_budget_dashboard(p_year, p_month, p_salesperson_id, p_client_id) row
  on conflict (organization_id, client_id, budget_year, budget_month)
  do update set
    salesperson_id = excluded.salesperson_id,
    budget_amount = excluded.budget_amount,
    budget_units = excluded.budget_units,
    actual_amount = excluded.actual_amount,
    expected_amount = excluded.expected_amount,
    deviation_pct = excluded.deviation_pct,
    compliance_pct = excluded.compliance_pct,
    closed_by = excluded.closed_by,
    closed_at = now(),
    next_budget_generated = true;

  select count(*)
  into v_generated_count
  from public.generate_sales_budget_next_month(
    p_year,
    p_month,
    extract(year from v_next_month_date)::integer,
    extract(month from v_next_month_date)::integer,
    p_salesperson_id,
    p_client_id
  );

  return jsonb_build_object(
    'closed', true,
    'generated_count', v_generated_count,
    'next_year', extract(year from v_next_month_date)::integer,
    'next_month', extract(month from v_next_month_date)::integer
  );
end;
$$;

grant execute on function public.ensure_sales_budget_month(integer, integer, uuid, uuid) to anon;
grant execute on function public.ensure_sales_budget_month(integer, integer, uuid, uuid) to authenticated;
grant execute on function public.ensure_sales_budget_month(integer, integer, uuid, uuid) to service_role;

grant execute on function public.get_sales_budget_dashboard(integer, integer, uuid, uuid) to anon;
grant execute on function public.get_sales_budget_dashboard(integer, integer, uuid, uuid) to authenticated;
grant execute on function public.get_sales_budget_dashboard(integer, integer, uuid, uuid) to service_role;

grant execute on function public.generate_sales_budget_next_month(integer, integer, integer, integer, uuid, uuid) to anon;
grant execute on function public.generate_sales_budget_next_month(integer, integer, integer, integer, uuid, uuid) to authenticated;
grant execute on function public.generate_sales_budget_next_month(integer, integer, integer, integer, uuid, uuid) to service_role;

grant execute on function public.close_sales_budget_month(integer, integer, uuid, uuid) to anon;
grant execute on function public.close_sales_budget_month(integer, integer, uuid, uuid) to authenticated;
grant execute on function public.close_sales_budget_month(integer, integer, uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sales_budgets'
  ) then
    alter publication supabase_realtime add table public.sales_budgets;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sales_projection_configs'
  ) then
    alter publication supabase_realtime add table public.sales_projection_configs;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sales_budget_closures'
  ) then
    alter publication supabase_realtime add table public.sales_budget_closures;
  end if;
end
$$;
