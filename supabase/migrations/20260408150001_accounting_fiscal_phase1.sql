alter table public.accounting_accounts
  add column if not exists parent_id uuid,
  add column if not exists level_no integer not null default 1,
  add column if not exists is_postable boolean not null default true,
  add column if not exists fiscal_profile_id uuid,
  add column if not exists allow_cost_center boolean not null default false,
  add column if not exists allow_auxiliary boolean not null default false,
  add column if not exists account_group text,
  add column if not exists account_subgroup text,
  add column if not exists reporting_code text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'accounting_accounts_parent_id_fkey'
  ) then
    alter table public.accounting_accounts
      add constraint accounting_accounts_parent_id_fkey
      foreign key (parent_id) references public.accounting_accounts(id) on delete set null;
  end if;
end $$;

create index if not exists idx_accounting_accounts_parent on public.accounting_accounts(parent_id);
create index if not exists idx_accounting_accounts_org_type on public.accounting_accounts(organization_id, account_type, code);

create table if not exists public.fiscal_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  profile_type text not null default 'cuenta'
    check (profile_type in ('cuenta', 'documento', 'proveedor', 'gasto')),
  is_deductible boolean not null default true,
  deductibility_mode text not null default 'deducible'
    check (deductibility_mode in ('deducible', 'no_deducible', 'deducible_con_limite', 'requiere_revision')),
  affects_vat_credit boolean not null default false,
  affects_vat_debit boolean not null default false,
  affects_isr_base boolean not null default true,
  affects_iso boolean not null default false,
  is_exempt boolean not null default false,
  is_zero_rated boolean not null default false,
  operation_kind text
    check (operation_kind in ('compra_local', 'servicios', 'combustible', 'viaticos', 'depreciacion', 'planilla', 'honorarios', 'arrendamientos', 'sin_factura', 'ajuste_fiscal', 'exportacion')),
  fiscal_notes text,
  limit_rule text,
  risk_level text not null default 'medio'
    check (risk_level in ('bajo', 'medio', 'alto')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'accounting_accounts_fiscal_profile_id_fkey'
  ) then
    alter table public.accounting_accounts
      add constraint accounting_accounts_fiscal_profile_id_fkey
      foreign key (fiscal_profile_id) references public.fiscal_profiles(id) on delete set null;
  end if;
end $$;

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_code text not null,
  period_name text not null,
  fiscal_year integer not null,
  fiscal_month integer,
  start_date date not null,
  end_date date not null,
  status text not null default 'abierto'
    check (status in ('abierto', 'cerrado', 'bloqueado')),
  close_notes text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_code),
  constraint accounting_periods_month_check check (fiscal_month is null or (fiscal_month between 1 and 12)),
  constraint accounting_periods_date_check check (end_date >= start_date)
);

create index if not exists idx_accounting_periods_org_dates on public.accounting_periods(organization_id, start_date, end_date);
create index if not exists idx_accounting_periods_org_status on public.accounting_periods(organization_id, status, fiscal_year, fiscal_month);

create table if not exists public.accounting_event_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  module text not null,
  description text,
  default_posting_mode text not null default 'automatico'
    check (default_posting_mode in ('automatico', 'borrador', 'manual')),
  requires_review boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create index if not exists idx_accounting_event_types_org_module on public.accounting_event_types(organization_id, module, is_active);

alter table public.journal_entries
  add column if not exists event_code text,
  add column if not exists period_id uuid,
  add column if not exists posting_status text not null default 'posteado'
    check (posting_status in ('borrador', 'posteado', 'revertido', 'error')),
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists reversal_of_entry_id uuid,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entries_period_id_fkey'
  ) then
    alter table public.journal_entries
      add constraint journal_entries_period_id_fkey
      foreign key (period_id) references public.accounting_periods(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entries_reviewed_by_fkey'
  ) then
    alter table public.journal_entries
      add constraint journal_entries_reviewed_by_fkey
      foreign key (reviewed_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entries_approved_by_fkey'
  ) then
    alter table public.journal_entries
      add constraint journal_entries_approved_by_fkey
      foreign key (approved_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entries_reversal_of_entry_id_fkey'
  ) then
    alter table public.journal_entries
      add constraint journal_entries_reversal_of_entry_id_fkey
      foreign key (reversal_of_entry_id) references public.journal_entries(id) on delete set null;
  end if;
end $$;

create index if not exists idx_journal_entries_org_event on public.journal_entries(organization_id, event_code, entry_date desc);
create index if not exists idx_journal_entries_org_source on public.journal_entries(organization_id, source_type, source_id);
create index if not exists idx_journal_entries_org_period on public.journal_entries(organization_id, period_id, posting_status);

alter table public.journal_entry_lines
  add column if not exists line_no integer not null default 1,
  add column if not exists dimension_client_id uuid,
  add column if not exists dimension_supplier_id uuid,
  add column if not exists dimension_product_presentation_id uuid,
  add column if not exists dimension_order_id uuid,
  add column if not exists dimension_route_id uuid,
  add column if not exists dimension_lot_id uuid,
  add column if not exists tax_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entry_lines_dimension_client_id_fkey'
  ) then
    alter table public.journal_entry_lines
      add constraint journal_entry_lines_dimension_client_id_fkey
      foreign key (dimension_client_id) references public.clients(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entry_lines_dimension_supplier_id_fkey'
  ) then
    alter table public.journal_entry_lines
      add constraint journal_entry_lines_dimension_supplier_id_fkey
      foreign key (dimension_supplier_id) references public.suppliers(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entry_lines_dimension_product_presentation_id_fkey'
  ) then
    alter table public.journal_entry_lines
      add constraint journal_entry_lines_dimension_product_presentation_id_fkey
      foreign key (dimension_product_presentation_id) references public.product_presentations(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entry_lines_dimension_order_id_fkey'
  ) then
    alter table public.journal_entry_lines
      add constraint journal_entry_lines_dimension_order_id_fkey
      foreign key (dimension_order_id) references public.orders(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_entry_lines_dimension_route_id_fkey'
  ) then
    alter table public.journal_entry_lines
      add constraint journal_entry_lines_dimension_route_id_fkey
      foreign key (dimension_route_id) references public.rutas(id) on delete set null;
  end if;
end $$;

create index if not exists idx_journal_entry_lines_entry_line on public.journal_entry_lines(entry_id, line_no);
create index if not exists idx_journal_entry_lines_dimensions on public.journal_entry_lines(dimension_order_id, dimension_product_presentation_id, dimension_route_id);

create table if not exists public.accounting_source_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  event_code text not null,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, source_type, source_id, event_code)
);

create index if not exists idx_accounting_source_links_entry on public.accounting_source_links(journal_entry_id);
create index if not exists idx_accounting_source_links_source on public.accounting_source_links(organization_id, source_type, source_id);

alter table public.fiscal_profiles enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.accounting_event_types enable row level security;
alter table public.accounting_source_links enable row level security;

drop policy if exists org_fiscal_profiles_all on public.fiscal_profiles;
create policy org_fiscal_profiles_all on public.fiscal_profiles
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_accounting_periods_all on public.accounting_periods;
create policy org_accounting_periods_all on public.accounting_periods
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_accounting_event_types_all on public.accounting_event_types;
create policy org_accounting_event_types_all on public.accounting_event_types
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_accounting_source_links_all on public.accounting_source_links;
create policy org_accounting_source_links_all on public.accounting_source_links
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.fiscal_profiles to anon;
grant all on table public.fiscal_profiles to authenticated;
grant all on table public.fiscal_profiles to service_role;
grant all on table public.accounting_periods to anon;
grant all on table public.accounting_periods to authenticated;
grant all on table public.accounting_periods to service_role;
grant all on table public.accounting_event_types to anon;
grant all on table public.accounting_event_types to authenticated;
grant all on table public.accounting_event_types to service_role;
grant all on table public.accounting_source_links to anon;
grant all on table public.accounting_source_links to authenticated;
grant all on table public.accounting_source_links to service_role;
