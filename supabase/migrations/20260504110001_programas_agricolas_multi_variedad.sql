create table if not exists public.programa_agricola_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  programa_id uuid not null references public.programas_agricolas(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity_committed_total numeric(14,4) not null default 0 check (quantity_committed_total > 0),
  unit text not null,
  notes text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_programa_agricola_items_programa
  on public.programa_agricola_items (programa_id, sort_order, created_at);

create index if not exists idx_programa_agricola_items_material
  on public.programa_agricola_items (organization_id, material_id);

alter table public.programa_entregas
  add column if not exists programa_item_id uuid,
  add column if not exists material_id uuid,
  add column if not exists unit text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'programa_entregas_programa_item_id_fkey'
  ) then
    alter table public.programa_entregas
      add constraint programa_entregas_programa_item_id_fkey
      foreign key (programa_item_id) references public.programa_agricola_items(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'programa_entregas_material_id_fkey'
  ) then
    alter table public.programa_entregas
      add constraint programa_entregas_material_id_fkey
      foreign key (material_id) references public.materials(id) on delete restrict;
  end if;
end
$$;

create index if not exists idx_programa_entregas_item
  on public.programa_entregas (programa_id, programa_item_id, scheduled_date);

create index if not exists idx_programa_entregas_material
  on public.programa_entregas (organization_id, material_id, scheduled_date);

with inserted_items as (
  insert into public.programa_agricola_items (
    organization_id,
    programa_id,
    material_id,
    quantity_committed_total,
    unit,
    notes,
    sort_order,
    created_by,
    created_at,
    updated_at
  )
  select
    p.organization_id,
    p.id,
    p.material_id,
    p.quantity_committed_total,
    p.unit,
    p.notes,
    0,
    p.created_by,
    p.created_at,
    p.updated_at
  from public.programas_agricolas p
  where not exists (
    select 1
    from public.programa_agricola_items i
    where i.programa_id = p.id
  )
  returning id, programa_id, material_id, unit
)
update public.programa_entregas pe
set
  programa_item_id = ii.id,
  material_id = coalesce(pe.material_id, ii.material_id),
  unit = coalesce(pe.unit, ii.unit)
from inserted_items ii
where pe.programa_id = ii.programa_id
  and (pe.programa_item_id is null or pe.material_id is null or pe.unit is null);

update public.programa_entregas pe
set
  programa_item_id = i.id,
  material_id = coalesce(pe.material_id, i.material_id),
  unit = coalesce(pe.unit, i.unit)
from public.programa_agricola_items i
where pe.programa_id = i.programa_id
  and i.sort_order = 0
  and (pe.programa_item_id is null or pe.material_id is null or pe.unit is null);

alter table public.programa_agricola_items enable row level security;

drop policy if exists org_programa_agricola_items_all on public.programa_agricola_items;
create policy org_programa_agricola_items_all on public.programa_agricola_items
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.programa_agricola_items to anon;
grant all on table public.programa_agricola_items to authenticated;
grant all on table public.programa_agricola_items to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'programa_agricola_items'
  ) then
    alter publication supabase_realtime add table public.programa_agricola_items;
  end if;
end
$$;
