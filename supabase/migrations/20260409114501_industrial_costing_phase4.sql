create table if not exists public.industrial_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_date date not null default current_date,
  date_from date not null,
  date_to date not null,
  snapshot_kind text not null
    check (snapshot_kind in ('resumen', 'sku', 'pedido', 'cliente', 'ruta', 'lote_terminado')),
  source_id uuid,
  source_code text,
  source_name text,
  product_presentation_id uuid references public.product_presentations(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  route_id uuid references public.rutas(id) on delete set null,
  finished_inventory_lot_id uuid references public.finished_inventory_lots(id) on delete set null,
  quantity numeric(14,4) not null default 0,
  weight_lb numeric(14,4) not null default 0,
  revenue_amount numeric(14,2) not null default 0,
  production_cost numeric(14,2) not null default 0,
  logistics_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) not null default 0,
  margin_amount numeric(14,2) not null default 0,
  margin_pct numeric(10,4) not null default 0,
  extra_data jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_industrial_cost_snapshots_org_range
  on public.industrial_cost_snapshots (organization_id, date_from, date_to, snapshot_kind);

create index if not exists idx_industrial_cost_snapshots_org_snapshot_date
  on public.industrial_cost_snapshots (organization_id, snapshot_date desc, created_at desc);

create index if not exists idx_industrial_cost_snapshots_dims
  on public.industrial_cost_snapshots (product_presentation_id, client_id, route_id, finished_inventory_lot_id);

alter table public.industrial_cost_snapshots enable row level security;

drop policy if exists org_industrial_cost_snapshots_all on public.industrial_cost_snapshots;
create policy org_industrial_cost_snapshots_all on public.industrial_cost_snapshots
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.industrial_cost_snapshots to anon;
grant all on table public.industrial_cost_snapshots to authenticated;
grant all on table public.industrial_cost_snapshots to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'industrial_cost_snapshots'
  ) then
    alter publication supabase_realtime add table public.industrial_cost_snapshots;
  end if;
end
$$;
