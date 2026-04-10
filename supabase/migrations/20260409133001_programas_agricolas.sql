create table if not exists public.programas_agricolas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  material_id uuid not null references public.materials(id) on delete restrict,
  program_code text not null,
  quantity_committed_total numeric(14,4) not null default 0 check (quantity_committed_total > 0),
  unit text not null,
  start_date date not null,
  end_date date not null,
  delivery_frequency text not null default 'semanal'
    check (delivery_frequency in ('diaria', 'semanal', 'quincenal', 'mensual', 'personalizada')),
  status text not null default 'borrador'
    check (status in ('borrador', 'activo', 'pausado', 'finalizado', 'cancelado')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programas_agricolas_dates_check check (end_date >= start_date),
  unique (organization_id, program_code)
);

create index if not exists idx_programas_agricolas_org_status
  on public.programas_agricolas (organization_id, status, end_date, start_date);

create index if not exists idx_programas_agricolas_supplier_material
  on public.programas_agricolas (supplier_id, material_id);

create table if not exists public.programa_entregas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  programa_id uuid not null references public.programas_agricolas(id) on delete cascade,
  scheduled_date date not null,
  planned_quantity numeric(14,4) not null default 0 check (planned_quantity > 0),
  received_quantity numeric(14,4) not null default 0 check (received_quantity >= 0),
  ordered_quantity numeric(14,4) not null default 0 check (ordered_quantity >= 0),
  difference_quantity numeric(14,4) not null default 0,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'parcial', 'cumplida', 'incumplida', 'reprogramada', 'cancelada', 'sobreentrega')),
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_programa_entregas_programa_fecha_unique
  on public.programa_entregas (programa_id, scheduled_date, id);

create index if not exists idx_programa_entregas_org_fecha
  on public.programa_entregas (organization_id, scheduled_date, status);

create index if not exists idx_programa_entregas_programa
  on public.programa_entregas (programa_id, scheduled_date);

create table if not exists public.programa_reajustes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  programa_id uuid not null references public.programas_agricolas(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  adjustment_date timestamptz not null default now(),
  reason text not null,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_programa_reajustes_programa
  on public.programa_reajustes (programa_id, adjustment_date desc);

alter table public.purchase_orders
  add column if not exists programa_agricola_id uuid,
  add column if not exists programa_entrega_id uuid;

alter table public.material_receptions
  add column if not exists programa_agricola_id uuid,
  add column if not exists programa_entrega_id uuid;

alter table public.material_inventory_lots
  add column if not exists programa_agricola_id uuid,
  add column if not exists programa_entrega_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'purchase_orders_programa_agricola_id_fkey'
  ) then
    alter table public.purchase_orders
      add constraint purchase_orders_programa_agricola_id_fkey
      foreign key (programa_agricola_id) references public.programas_agricolas(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'purchase_orders_programa_entrega_id_fkey'
  ) then
    alter table public.purchase_orders
      add constraint purchase_orders_programa_entrega_id_fkey
      foreign key (programa_entrega_id) references public.programa_entregas(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'material_receptions_programa_agricola_id_fkey'
  ) then
    alter table public.material_receptions
      add constraint material_receptions_programa_agricola_id_fkey
      foreign key (programa_agricola_id) references public.programas_agricolas(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'material_receptions_programa_entrega_id_fkey'
  ) then
    alter table public.material_receptions
      add constraint material_receptions_programa_entrega_id_fkey
      foreign key (programa_entrega_id) references public.programa_entregas(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'material_inventory_lots_programa_agricola_id_fkey'
  ) then
    alter table public.material_inventory_lots
      add constraint material_inventory_lots_programa_agricola_id_fkey
      foreign key (programa_agricola_id) references public.programas_agricolas(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'material_inventory_lots_programa_entrega_id_fkey'
  ) then
    alter table public.material_inventory_lots
      add constraint material_inventory_lots_programa_entrega_id_fkey
      foreign key (programa_entrega_id) references public.programa_entregas(id) on delete set null;
  end if;
end
$$;

create index if not exists idx_purchase_orders_programa
  on public.purchase_orders (programa_agricola_id, programa_entrega_id);

create index if not exists idx_material_receptions_programa
  on public.material_receptions (programa_agricola_id, programa_entrega_id, received_date);

create index if not exists idx_material_inventory_lots_programa
  on public.material_inventory_lots (programa_agricola_id, programa_entrega_id, created_at desc);

alter table public.programas_agricolas enable row level security;
alter table public.programa_entregas enable row level security;
alter table public.programa_reajustes enable row level security;

drop policy if exists org_programas_agricolas_all on public.programas_agricolas;
create policy org_programas_agricolas_all on public.programas_agricolas
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_programa_entregas_all on public.programa_entregas;
create policy org_programa_entregas_all on public.programa_entregas
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_programa_reajustes_all on public.programa_reajustes;
create policy org_programa_reajustes_all on public.programa_reajustes
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.programas_agricolas to anon;
grant all on table public.programas_agricolas to authenticated;
grant all on table public.programas_agricolas to service_role;
grant all on table public.programa_entregas to anon;
grant all on table public.programa_entregas to authenticated;
grant all on table public.programa_entregas to service_role;
grant all on table public.programa_reajustes to anon;
grant all on table public.programa_reajustes to authenticated;
grant all on table public.programa_reajustes to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'programas_agricolas'
  ) then
    alter publication supabase_realtime add table public.programas_agricolas;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'programa_entregas'
  ) then
    alter publication supabase_realtime add table public.programa_entregas;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'programa_reajustes'
  ) then
    alter publication supabase_realtime add table public.programa_reajustes;
  end if;
end
$$;
