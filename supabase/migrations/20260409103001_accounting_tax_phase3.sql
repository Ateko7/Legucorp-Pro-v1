create table if not exists public.tax_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vat_rate numeric(10,4) not null default 0.12 check (vat_rate >= 0),
  isr_regime text not null default 'utilidades'
    check (isr_regime in ('utilidades', 'opcional_simplificado')),
  isr_rate numeric(10,4) not null default 0.25 check (isr_rate >= 0),
  iso_rate numeric(10,4) not null default 0.01 check (iso_rate >= 0),
  iso_base_mode text not null default 'mayor'
    check (iso_base_mode in ('mayor', 'ingresos_brutos', 'activos_netos')),
  export_vat_zero_rate boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create table if not exists public.tax_isr_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  adjustment_date date not null,
  adjustment_type text not null
    check (adjustment_type in ('mas_no_deducible', 'menos_deduccion', 'informativo')),
  concept text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tax_isr_adjustments_org_date
  on public.tax_isr_adjustments (organization_id, adjustment_date desc);

create table if not exists public.tax_iso_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fiscal_year integer not null,
  fiscal_quarter integer not null check (fiscal_quarter between 1 and 4),
  start_date date not null,
  end_date date not null,
  gross_income_base numeric(14,2) not null default 0,
  net_assets_base numeric(14,2) not null default 0,
  selected_base numeric(14,2) not null default 0,
  projected_tax numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  compensated_amount numeric(14,2) not null default 0,
  status text not null default 'abierto'
    check (status in ('abierto', 'declarado', 'pagado', 'compensado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, fiscal_year, fiscal_quarter)
);

create table if not exists public.tax_vat_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_month text not null,
  debit_total numeric(14,2) not null default 0,
  credit_total numeric(14,2) not null default 0,
  payable_or_carry numeric(14,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_month)
);

alter table public.tax_configurations enable row level security;
alter table public.tax_isr_adjustments enable row level security;
alter table public.tax_iso_periods enable row level security;
alter table public.tax_vat_reconciliations enable row level security;

drop policy if exists org_tax_configurations_all on public.tax_configurations;
create policy org_tax_configurations_all on public.tax_configurations
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_tax_isr_adjustments_all on public.tax_isr_adjustments;
create policy org_tax_isr_adjustments_all on public.tax_isr_adjustments
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_tax_iso_periods_all on public.tax_iso_periods;
create policy org_tax_iso_periods_all on public.tax_iso_periods
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_tax_vat_reconciliations_all on public.tax_vat_reconciliations;
create policy org_tax_vat_reconciliations_all on public.tax_vat_reconciliations
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.tax_configurations to anon;
grant all on table public.tax_configurations to authenticated;
grant all on table public.tax_configurations to service_role;
grant all on table public.tax_isr_adjustments to anon;
grant all on table public.tax_isr_adjustments to authenticated;
grant all on table public.tax_isr_adjustments to service_role;
grant all on table public.tax_iso_periods to anon;
grant all on table public.tax_iso_periods to authenticated;
grant all on table public.tax_iso_periods to service_role;
grant all on table public.tax_vat_reconciliations to anon;
grant all on table public.tax_vat_reconciliations to authenticated;
grant all on table public.tax_vat_reconciliations to service_role;
