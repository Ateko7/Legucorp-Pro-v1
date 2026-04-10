create table if not exists public.planting_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_code text not null,
  project_name text not null,
  client_id uuid references public.clients(id) on delete set null,
  commercial_channel text,
  production_unit text,
  location text,
  start_date date not null,
  end_date date not null,
  status text not null default 'borrador'
    check (status in ('borrador', 'pendiente_aprobacion', 'aprobado', 'en_ejecucion', 'cerrado', 'cancelado', 'rechazado')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approval_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planting_projects_dates_check check (end_date >= start_date),
  unique (organization_id, project_code)
);

create index if not exists idx_planting_projects_org_status
  on public.planting_projects (organization_id, status, start_date, end_date);

create table if not exists public.material_agronomic_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  default_variety text,
  commercial_unit text,
  standard_weight_per_plant numeric(14,6) not null default 0,
  standard_germination_rate numeric(10,6) not null default 0.90 check (standard_germination_rate > 0 and standard_germination_rate <= 1),
  standard_survival_rate numeric(10,6) not null default 0.92 check (standard_survival_rate > 0 and standard_survival_rate <= 1),
  standard_waste_rate numeric(10,6) not null default 0.04 check (standard_waste_rate >= 0 and standard_waste_rate < 1),
  standard_rejection_rate numeric(10,6) not null default 0.03 check (standard_rejection_rate >= 0 and standard_rejection_rate < 1),
  standard_days_to_harvest integer not null default 30 check (standard_days_to_harvest > 0),
  cells_per_tray integer not null default 128 check (cells_per_tray > 0),
  historical_yield numeric(14,4) not null default 0,
  validation_status text not null default 'validado'
    check (validation_status in ('validado', 'pendiente_validacion_tecnica')),
  origin_project_id uuid references public.planting_projects(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, material_id)
);

create index if not exists idx_material_agronomic_profiles_org
  on public.material_agronomic_profiles (organization_id, material_id);

create table if not exists public.planting_project_proposed_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.planting_projects(id) on delete cascade,
  proposed_name text not null,
  normalized_name text not null,
  suggested_material_id uuid references public.materials(id) on delete set null,
  approved_material_id uuid references public.materials(id) on delete set null,
  status text not null default 'pendiente_aprobacion'
    check (status in ('pendiente_aprobacion', 'aprobada', 'rechazada', 'fusionada')),
  origin_trace text not null default 'creada_desde_proyecto_siembra',
  rejection_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_planting_project_proposed_materials_project
  on public.planting_project_proposed_materials (project_id, status, created_at desc);

create table if not exists public.planting_project_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.planting_projects(id) on delete cascade,
  line_no integer not null default 1,
  material_id uuid references public.materials(id) on delete set null,
  proposed_material_id uuid references public.planting_project_proposed_materials(id) on delete set null,
  variety text,
  expected_volume numeric(14,4) not null default 0 check (expected_volume > 0),
  unit text not null,
  delivery_frequency text not null default 'semanal'
    check (delivery_frequency in ('unica', 'diaria', 'semanal', 'quincenal', 'mensual')),
  average_weight_per_plant numeric(14,6) not null default 0 check (average_weight_per_plant > 0),
  germination_rate numeric(10,6) not null default 0.90 check (germination_rate > 0 and germination_rate <= 1),
  survival_rate numeric(10,6) not null default 0.92 check (survival_rate > 0 and survival_rate <= 1),
  waste_rate numeric(10,6) not null default 0.04 check (waste_rate >= 0 and waste_rate < 1),
  rejection_rate numeric(10,6) not null default 0.03 check (rejection_rate >= 0 and rejection_rate < 1),
  days_to_harvest integer not null default 30 check (days_to_harvest > 0),
  cells_per_tray integer not null default 128 check (cells_per_tray > 0),
  first_harvest_target_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planting_project_lines_material_source_check check (
    material_id is not null or proposed_material_id is not null
  ),
  unique (project_id, line_no)
);

create index if not exists idx_planting_project_lines_project
  on public.planting_project_lines (project_id, line_no);

create table if not exists public.planting_project_weekly_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.planting_projects(id) on delete cascade,
  project_line_id uuid not null references public.planting_project_lines(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  harvest_date date not null,
  seed_date date not null,
  expected_volume numeric(14,4) not null default 0,
  harvestable_plants_required numeric(14,4) not null default 0,
  plants_to_sow numeric(14,4) not null default 0,
  seeds_required numeric(14,4) not null default 0,
  trays_required integer not null default 0,
  status text not null default 'planificado'
    check (status in ('planificado', 'en_ejecucion', 'sembrado', 'cosechado', 'cancelado')),
  created_at timestamptz not null default now()
);

create index if not exists idx_planting_project_weekly_plans_project
  on public.planting_project_weekly_plans (project_id, week_start, harvest_date);

create table if not exists public.planting_project_supply_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.planting_projects(id) on delete cascade,
  project_line_id uuid references public.planting_project_lines(id) on delete cascade,
  requirement_type text not null
    check (requirement_type in ('semilla', 'bandeja', 'sustrato', 'esponja', 'plug', 'fertilizante', 'empaque', 'otro')),
  material_id uuid references public.materials(id) on delete set null,
  requirement_name text not null,
  quantity_required numeric(14,4) not null default 0,
  quantity_available numeric(14,4) not null default 0,
  shortage_quantity numeric(14,4) not null default 0,
  unit text not null,
  reserved_quantity numeric(14,4) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_planting_project_supply_requirements_project
  on public.planting_project_supply_requirements (project_id, requirement_type, material_id);

create table if not exists public.planting_project_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.planting_projects(id) on delete cascade,
  event_type text not null,
  event_notes text,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_planting_project_audit_logs_project
  on public.planting_project_audit_logs (project_id, created_at desc);

alter table public.planting_projects enable row level security;
alter table public.material_agronomic_profiles enable row level security;
alter table public.planting_project_proposed_materials enable row level security;
alter table public.planting_project_lines enable row level security;
alter table public.planting_project_weekly_plans enable row level security;
alter table public.planting_project_supply_requirements enable row level security;
alter table public.planting_project_audit_logs enable row level security;

drop policy if exists org_planting_projects_all on public.planting_projects;
create policy org_planting_projects_all on public.planting_projects
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_material_agronomic_profiles_all on public.material_agronomic_profiles;
create policy org_material_agronomic_profiles_all on public.material_agronomic_profiles
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_planting_project_proposed_materials_all on public.planting_project_proposed_materials;
create policy org_planting_project_proposed_materials_all on public.planting_project_proposed_materials
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_planting_project_lines_all on public.planting_project_lines;
create policy org_planting_project_lines_all on public.planting_project_lines
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_planting_project_weekly_plans_all on public.planting_project_weekly_plans;
create policy org_planting_project_weekly_plans_all on public.planting_project_weekly_plans
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_planting_project_supply_requirements_all on public.planting_project_supply_requirements;
create policy org_planting_project_supply_requirements_all on public.planting_project_supply_requirements
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_planting_project_audit_logs_all on public.planting_project_audit_logs;
create policy org_planting_project_audit_logs_all on public.planting_project_audit_logs
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.planting_projects to anon;
grant all on table public.planting_projects to authenticated;
grant all on table public.planting_projects to service_role;
grant all on table public.material_agronomic_profiles to anon;
grant all on table public.material_agronomic_profiles to authenticated;
grant all on table public.material_agronomic_profiles to service_role;
grant all on table public.planting_project_proposed_materials to anon;
grant all on table public.planting_project_proposed_materials to authenticated;
grant all on table public.planting_project_proposed_materials to service_role;
grant all on table public.planting_project_lines to anon;
grant all on table public.planting_project_lines to authenticated;
grant all on table public.planting_project_lines to service_role;
grant all on table public.planting_project_weekly_plans to anon;
grant all on table public.planting_project_weekly_plans to authenticated;
grant all on table public.planting_project_weekly_plans to service_role;
grant all on table public.planting_project_supply_requirements to anon;
grant all on table public.planting_project_supply_requirements to authenticated;
grant all on table public.planting_project_supply_requirements to service_role;
grant all on table public.planting_project_audit_logs to anon;
grant all on table public.planting_project_audit_logs to authenticated;
grant all on table public.planting_project_audit_logs to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'planting_projects'
  ) then
    alter publication supabase_realtime add table public.planting_projects;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'planting_project_lines'
  ) then
    alter publication supabase_realtime add table public.planting_project_lines;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'planting_project_proposed_materials'
  ) then
    alter publication supabase_realtime add table public.planting_project_proposed_materials;
  end if;
end
$$;
