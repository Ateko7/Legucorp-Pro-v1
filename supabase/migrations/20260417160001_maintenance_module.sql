create or replace function public.generate_maintenance_equipment_code(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_code text;
begin
  select coalesce(max((substring(internal_code from 'EQ-([0-9]+)'))::integer), 0) + 1
    into v_next
  from public.maintenance_equipment
  where organization_id = p_organization_id
    and internal_code ~ '^EQ-[0-9]+$';

  loop
    v_code := 'EQ-' || lpad(v_next::text, 4, '0');
    exit when not exists (
      select 1
      from public.maintenance_equipment
      where organization_id = p_organization_id
        and internal_code = v_code
    );
    v_next := v_next + 1;
  end loop;

  return v_code;
end;
$$;

create or replace function public.generate_maintenance_work_order_code(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_code text;
begin
  select coalesce(max((substring(work_order_code from 'MTTO-([0-9]+)'))::integer), 0) + 1
    into v_next
  from public.maintenance_work_orders
  where organization_id = p_organization_id
    and work_order_code ~ '^MTTO-[0-9]+$';

  loop
    v_code := 'MTTO-' || lpad(v_next::text, 5, '0');
    exit when not exists (
      select 1
      from public.maintenance_work_orders
      where organization_id = p_organization_id
        and work_order_code = v_code
    );
    v_next := v_next + 1;
  end loop;

  return v_code;
end;
$$;

create table if not exists public.maintenance_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  internal_code text not null,
  name text not null,
  category text not null,
  area_location text,
  brand text,
  model text,
  serial_number text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  purchase_date date,
  installation_date date,
  status text not null default 'activo'
    check (status in ('activo', 'en_reparacion', 'fuera_de_servicio', 'dado_de_baja')),
  responsible_user_id uuid references public.profiles(id) on delete set null,
  general_notes text,
  attachment_url text,
  initial_usage_counter numeric(14,2) not null default 0,
  current_usage_counter numeric(14,2) not null default 0,
  usage_unit text not null default 'horas'
    check (usage_unit in ('horas', 'ciclos', 'producciones', 'lotes', 'ninguno')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, internal_code)
);

create table if not exists public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null references public.maintenance_equipment(id) on delete cascade,
  maintenance_type text not null
    check (maintenance_type in ('preventivo', 'correctivo', 'calibracion', 'limpieza_tecnica', 'inspeccion')),
  name text not null,
  description text,
  frequency_type text not null default 'time'
    check (frequency_type in ('time', 'usage', 'mixed')),
  time_frequency text
    check (time_frequency is null or time_frequency in ('diario', 'semanal', 'quincenal', 'mensual', 'trimestral', 'semestral', 'anual', 'personalizado')),
  custom_days integer,
  usage_frequency_type text
    check (usage_frequency_type is null or usage_frequency_type in ('horas', 'ciclos', 'producciones', 'lotes')),
  usage_interval numeric(14,2),
  next_scheduled_date date,
  next_usage_target numeric(14,2),
  estimated_minutes integer,
  suggested_responsible_user_id uuid references public.profiles(id) on delete set null,
  requires_shutdown boolean not null default false,
  suggested_parts text,
  checklist_required boolean not null default true,
  yellow_days_threshold integer not null default 7,
  yellow_usage_pct numeric(5,2) not null default 80,
  red_usage_pct numeric(5,2) not null default 100,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.maintenance_plans(id) on delete cascade,
  item_label text not null,
  response_type text not null default 'check'
    check (response_type in ('check', 'number', 'short_text', 'long_text')),
  required boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_code text not null,
  equipment_id uuid not null references public.maintenance_equipment(id) on delete restrict,
  plan_id uuid references public.maintenance_plans(id) on delete set null,
  maintenance_type text not null
    check (maintenance_type in ('preventivo', 'correctivo', 'calibracion', 'limpieza_tecnica', 'inspeccion')),
  scheduled_date date,
  actual_execution_date date,
  start_time timestamptz,
  end_time timestamptz,
  executed_by uuid references public.profiles(id) on delete set null,
  support_staff text,
  status text not null default 'programado'
    check (status in ('programado', 'en_proceso', 'completado', 'cancelado', 'reprogramado', 'anulado')),
  corrective_reason text,
  failure_description text,
  action_performed text,
  parts_used text,
  parts_cost numeric(14,2) not null default 0,
  labor_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  downtime_minutes integer not null default 0,
  final_result text,
  checklist_completed boolean not null default false,
  observations text,
  attachment_url text,
  canceled_reason text,
  rescheduled_from uuid references public.maintenance_work_orders(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, work_order_code)
);

create table if not exists public.maintenance_checklist_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.maintenance_work_orders(id) on delete cascade,
  checklist_item_id uuid references public.maintenance_checklist_items(id) on delete set null,
  item_label text not null,
  response_type text not null
    check (response_type in ('check', 'number', 'short_text', 'long_text')),
  response_bool boolean,
  response_number numeric(14,4),
  response_text text,
  result text
    check (result is null or result in ('conforme', 'no_conforme')),
  observation text,
  evidence_url text,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maintenance_usage_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null references public.maintenance_equipment(id) on delete cascade,
  usage_type text not null
    check (usage_type in ('horas', 'ciclos', 'producciones', 'lotes')),
  usage_increment numeric(14,2) not null default 0,
  counter_after numeric(14,2) not null default 0,
  source_table text,
  source_id uuid,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_key text not null,
  equipment_id uuid not null references public.maintenance_equipment(id) on delete cascade,
  plan_id uuid references public.maintenance_plans(id) on delete cascade,
  work_order_id uuid references public.maintenance_work_orders(id) on delete set null,
  alert_type text not null
    check (alert_type in ('proximo_vencer', 'vencido', 'equipo_bloqueado', 'uso_excedido', 'reincidencia_fallas', 'correctivos_recurrentes')),
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'critical')),
  status text not null default 'abierta'
    check (status in ('abierta', 'reconocida', 'cerrada')),
  message text not null,
  due_date date,
  usage_target numeric(14,2),
  current_usage numeric(14,2),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, alert_key)
);

create index if not exists idx_maintenance_equipment_org_status
  on public.maintenance_equipment (organization_id, status, category);
create index if not exists idx_maintenance_plans_equipment
  on public.maintenance_plans (equipment_id, is_active, next_scheduled_date);
create index if not exists idx_maintenance_work_orders_equipment
  on public.maintenance_work_orders (equipment_id, status, scheduled_date desc);
create index if not exists idx_maintenance_work_orders_org_status
  on public.maintenance_work_orders (organization_id, status, scheduled_date);
create index if not exists idx_maintenance_alerts_org_status
  on public.maintenance_alerts (organization_id, status, severity, created_at desc);
create index if not exists idx_maintenance_usage_logs_equipment
  on public.maintenance_usage_logs (equipment_id, created_at desc);

create or replace trigger trg_maintenance_equipment_updated_at
before update on public.maintenance_equipment
for each row execute function public.set_updated_at();

create or replace trigger trg_maintenance_plans_updated_at
before update on public.maintenance_plans
for each row execute function public.set_updated_at();

create or replace trigger trg_maintenance_work_orders_updated_at
before update on public.maintenance_work_orders
for each row execute function public.set_updated_at();

create or replace trigger trg_maintenance_checklist_responses_updated_at
before update on public.maintenance_checklist_responses
for each row execute function public.set_updated_at();

create or replace trigger trg_maintenance_alerts_updated_at
before update on public.maintenance_alerts
for each row execute function public.set_updated_at();

alter table public.maintenance_equipment enable row level security;
alter table public.maintenance_plans enable row level security;
alter table public.maintenance_checklist_items enable row level security;
alter table public.maintenance_work_orders enable row level security;
alter table public.maintenance_checklist_responses enable row level security;
alter table public.maintenance_usage_logs enable row level security;
alter table public.maintenance_alerts enable row level security;

drop policy if exists maintenance_equipment_same_org_all on public.maintenance_equipment;
create policy maintenance_equipment_same_org_all on public.maintenance_equipment
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists maintenance_plans_same_org_all on public.maintenance_plans;
create policy maintenance_plans_same_org_all on public.maintenance_plans
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists maintenance_checklist_items_same_org_all on public.maintenance_checklist_items;
create policy maintenance_checklist_items_same_org_all on public.maintenance_checklist_items
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists maintenance_work_orders_same_org_all on public.maintenance_work_orders;
create policy maintenance_work_orders_same_org_all on public.maintenance_work_orders
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists maintenance_checklist_responses_same_org_all on public.maintenance_checklist_responses;
create policy maintenance_checklist_responses_same_org_all on public.maintenance_checklist_responses
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists maintenance_usage_logs_same_org_all on public.maintenance_usage_logs;
create policy maintenance_usage_logs_same_org_all on public.maintenance_usage_logs
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

drop policy if exists maintenance_alerts_same_org_all on public.maintenance_alerts;
create policy maintenance_alerts_same_org_all on public.maintenance_alerts
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());

grant all on table public.maintenance_equipment to anon, authenticated, service_role;
grant all on table public.maintenance_plans to anon, authenticated, service_role;
grant all on table public.maintenance_checklist_items to anon, authenticated, service_role;
grant all on table public.maintenance_work_orders to anon, authenticated, service_role;
grant all on table public.maintenance_checklist_responses to anon, authenticated, service_role;
grant all on table public.maintenance_usage_logs to anon, authenticated, service_role;
grant all on table public.maintenance_alerts to anon, authenticated, service_role;
grant all on function public.generate_maintenance_equipment_code(uuid) to anon, authenticated, service_role;
grant all on function public.generate_maintenance_work_order_code(uuid) to anon, authenticated, service_role;
