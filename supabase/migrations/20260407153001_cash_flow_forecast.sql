create table if not exists public.cash_flow_settings (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  initial_cash_balance numeric not null default 0,
  included_bank_account_ids jsonb not null default '[]'::jsonb,
  included_cash_box_ids jsonb not null default '[]'::jsonb,
  default_horizon_days integer not null default 90,
  default_grouping text not null default 'semana'
    check (default_grouping in ('semana', 'quincena', 'mes')),
  liquidity_alert_threshold numeric not null default 0,
  payment_flexible_after_days integer not null default 15,
  payment_reprogrammable_after_days integer not null default 30,
  payroll_extra_percentage numeric not null default 0,
  concentration_alert_threshold numeric not null default 0.40,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flow_settings_pkey primary key (id),
  constraint cash_flow_settings_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_flow_settings_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create unique index if not exists idx_cash_flow_settings_org_unique
  on public.cash_flow_settings (organization_id);

create table if not exists public.cash_flow_scenarios (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  scenario_code text not null
    check (scenario_code in ('optimista', 'realista', 'pesimista')),
  name text not null,
  collection_delay_days integer not null default 0,
  collection_probability_factor numeric not null default 1,
  payment_shift_days integer not null default 0,
  projected_purchase_multiplier numeric not null default 1,
  payroll_multiplier numeric not null default 1,
  manual_income_multiplier numeric not null default 1,
  manual_expense_multiplier numeric not null default 1,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flow_scenarios_pkey primary key (id),
  constraint cash_flow_scenarios_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_flow_scenarios_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create unique index if not exists idx_cash_flow_scenarios_org_code
  on public.cash_flow_scenarios (organization_id, scenario_code);

create table if not exists public.cash_flow_categories (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  kind text not null check (kind in ('ingreso', 'egreso')),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flow_categories_pkey primary key (id),
  constraint cash_flow_categories_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_flow_categories_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create unique index if not exists idx_cash_flow_categories_org_name_kind
  on public.cash_flow_categories (organization_id, name, kind);

create table if not exists public.cash_flow_projection_overrides (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  source_type text not null check (source_type in ('cxc', 'cxp')),
  source_id uuid not null,
  scenario_code text not null
    check (scenario_code in ('todos', 'optimista', 'realista', 'pesimista')),
  projected_date date,
  include_in_projection boolean not null default true,
  collection_probability numeric,
  payment_classification text
    check (payment_classification in ('obligatorio', 'flexible', 'reprogramable')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flow_projection_overrides_pkey primary key (id),
  constraint cash_flow_projection_overrides_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_flow_projection_overrides_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create unique index if not exists idx_cash_flow_projection_overrides_unique
  on public.cash_flow_projection_overrides (organization_id, source_type, source_id, scenario_code);

create index if not exists idx_cash_flow_projection_overrides_source
  on public.cash_flow_projection_overrides (organization_id, source_type, scenario_code);

create table if not exists public.cash_flow_manual_items (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  item_type text not null
    check (item_type in ('compra_proyectada', 'otro_egreso', 'otro_ingreso')),
  category_id uuid,
  supplier_id uuid,
  concept text not null,
  amount numeric not null default 0,
  estimated_date date not null,
  priority text not null default 'media'
    check (priority in ('alta', 'media', 'baja')),
  applies_to_scenario text not null default 'todos'
    check (applies_to_scenario in ('todos', 'optimista', 'realista', 'pesimista')),
  comment text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flow_manual_items_pkey primary key (id),
  constraint cash_flow_manual_items_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_flow_manual_items_category_id_fkey foreign key (category_id) references public.cash_flow_categories(id),
  constraint cash_flow_manual_items_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id),
  constraint cash_flow_manual_items_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create index if not exists idx_cash_flow_manual_items_org_date
  on public.cash_flow_manual_items (organization_id, estimated_date, applies_to_scenario);

create table if not exists public.cash_flow_simulations (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  simulation_type text not null,
  cash_effect_direction text not null default 'egreso'
    check (cash_effect_direction in ('egreso', 'ingreso')),
  amount numeric not null default 0,
  start_date date not null,
  payment_mode text not null default 'contado'
    check (payment_mode in ('contado', 'cuotas', 'anticipo_saldo')),
  installment_count integer,
  installment_frequency text
    check (installment_frequency in ('semanal', 'quincenal', 'mensual')),
  down_payment_amount numeric,
  balance_payment_date date,
  recurring_benefit_amount numeric,
  recurring_benefit_type text
    check (recurring_benefit_type in ('ahorro', 'ingreso')),
  benefit_start_date date,
  benefit_frequency text
    check (benefit_frequency in ('semanal', 'quincenal', 'mensual')),
  applies_to_scenario text not null default 'todos'
    check (applies_to_scenario in ('todos', 'optimista', 'realista', 'pesimista')),
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flow_simulations_pkey primary key (id),
  constraint cash_flow_simulations_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_flow_simulations_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create index if not exists idx_cash_flow_simulations_org_start
  on public.cash_flow_simulations (organization_id, start_date, applies_to_scenario);
