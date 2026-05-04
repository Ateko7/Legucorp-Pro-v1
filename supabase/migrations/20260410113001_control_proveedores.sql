create table if not exists public.supplier_scorecards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  period_start date,
  period_end date,
  deliveries_total integer not null default 0,
  deliveries_on_time integer not null default 0,
  on_time_pct numeric(8,2) not null default 0,
  quality_received_qty numeric(14,4) not null default 0,
  quality_accepted_qty numeric(14,4) not null default 0,
  quality_pct numeric(8,2) not null default 0,
  price_variation_pct numeric(8,2) not null default 0,
  claims_total integer not null default 0,
  claims_rate_pct numeric(8,2) not null default 0,
  programs_total integer not null default 0,
  programs_at_risk integer not null default 0,
  fiscal_invoiced_pct numeric(8,2) not null default 0,
  global_score numeric(8,2) not null default 0,
  semaphore text not null default 'yellow'
    check (semaphore in ('green', 'yellow', 'red')),
  metadata jsonb not null default '{}'::jsonb,
  last_computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id)
);

create index if not exists idx_supplier_scorecards_org_score
  on public.supplier_scorecards (organization_id, global_score desc, last_computed_at desc);

create table if not exists public.supplier_price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  effective_date date not null,
  unit_price numeric(14,4) not null default 0 check (unit_price >= 0),
  volume numeric(14,4) not null default 0 check (volume >= 0),
  unit text not null,
  source_type text not null default 'purchase_order'
    check (source_type in ('purchase_order', 'manual', 'ajuste')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_item_id)
);

create index if not exists idx_supplier_price_history_supplier_material_date
  on public.supplier_price_history (supplier_id, material_id, effective_date desc);

create table if not exists public.supplier_fiscal_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  billing_type text not null default 'con_factura'
    check (billing_type in ('con_factura', 'sin_factura')),
  sat_regime text not null default 'general'
    check (sat_regime in ('pequeno_contribuyente', 'general')),
  tax_alert_threshold_pct numeric(8,2) not null default 80 check (tax_alert_threshold_pct >= 0 and tax_alert_threshold_pct <= 100),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id)
);

create index if not exists idx_supplier_fiscal_classifications_org
  on public.supplier_fiscal_classifications (organization_id, billing_type, sat_regime);

create table if not exists public.supplier_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  material_reception_id uuid references public.material_receptions(id) on delete set null,
  claim_date date not null default current_date,
  claim_type text not null default 'calidad'
    check (claim_type in ('calidad', 'entrega', 'precio', 'documentacion', 'otro')),
  status text not null default 'abierto'
    check (status in ('abierto', 'investigacion', 'cerrado', 'anulado')),
  title text not null,
  description text,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  resolution_notes text,
  created_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_claims_supplier_date
  on public.supplier_claims (supplier_id, claim_date desc, status);

create table if not exists public.supplier_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  alert_type text not null
    check (alert_type in ('baja_calidad', 'incumplimiento_programa', 'variacion_precio', 'muchos_reclamos', 'riesgo_fiscal', 'entrega_tardia')),
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'danger')),
  title text not null,
  message text not null,
  metric_value numeric(14,4),
  status text not null default 'abierta'
    check (status in ('abierta', 'resuelta', 'descartada')),
  generated_by_system boolean not null default true,
  context jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_alerts_supplier_status
  on public.supplier_alerts (supplier_id, status, severity, created_at desc);

alter table public.supplier_scorecards enable row level security;
alter table public.supplier_price_history enable row level security;
alter table public.supplier_fiscal_classifications enable row level security;
alter table public.supplier_claims enable row level security;
alter table public.supplier_alerts enable row level security;

drop policy if exists org_supplier_scorecards_all on public.supplier_scorecards;
create policy org_supplier_scorecards_all on public.supplier_scorecards
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_supplier_price_history_all on public.supplier_price_history;
create policy org_supplier_price_history_all on public.supplier_price_history
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_supplier_fiscal_classifications_all on public.supplier_fiscal_classifications;
create policy org_supplier_fiscal_classifications_all on public.supplier_fiscal_classifications
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_supplier_claims_all on public.supplier_claims;
create policy org_supplier_claims_all on public.supplier_claims
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_supplier_alerts_all on public.supplier_alerts;
create policy org_supplier_alerts_all on public.supplier_alerts
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.supplier_scorecards to anon;
grant all on table public.supplier_scorecards to authenticated;
grant all on table public.supplier_scorecards to service_role;
grant all on table public.supplier_price_history to anon;
grant all on table public.supplier_price_history to authenticated;
grant all on table public.supplier_price_history to service_role;
grant all on table public.supplier_fiscal_classifications to anon;
grant all on table public.supplier_fiscal_classifications to authenticated;
grant all on table public.supplier_fiscal_classifications to service_role;
grant all on table public.supplier_claims to anon;
grant all on table public.supplier_claims to authenticated;
grant all on table public.supplier_claims to service_role;
grant all on table public.supplier_alerts to anon;
grant all on table public.supplier_alerts to authenticated;
grant all on table public.supplier_alerts to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'supplier_scorecards'
  ) then
    alter publication supabase_realtime add table public.supplier_scorecards;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'supplier_claims'
  ) then
    alter publication supabase_realtime add table public.supplier_claims;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'supplier_alerts'
  ) then
    alter publication supabase_realtime add table public.supplier_alerts;
  end if;
end
$$;
