create table if not exists public.accounting_entry_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  event_code text not null,
  description text,
  posting_mode text not null default 'automatico'
    check (posting_mode in ('automatico', 'borrador', 'manual')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.accounting_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.accounting_entry_templates(id) on delete cascade,
  line_no integer not null,
  side text not null check (side in ('debit', 'credit')),
  account_mode text not null default 'static_code'
    check (account_mode in ('static_code', 'payload_account_id', 'payload_account_code')),
  account_value text not null,
  amount_mode text not null default 'payload'
    check (amount_mode in ('payload', 'fixed')),
  amount_value text not null,
  description_template text,
  cost_center_mode text not null default 'none'
    check (cost_center_mode in ('none', 'static_code', 'payload_cost_center_id')),
  cost_center_value text,
  tax_code text,
  allow_zero boolean not null default false,
  created_at timestamptz not null default now(),
  unique (template_id, line_no)
);

create table if not exists public.accounting_posting_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_code text not null,
  template_id uuid not null references public.accounting_entry_templates(id) on delete cascade,
  priority integer not null default 100,
  condition_key text,
  condition_value text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounting_posting_rules_org_event_template_key'
  ) then
    alter table public.accounting_posting_rules
      add constraint accounting_posting_rules_org_event_template_key
      unique (organization_id, event_code, template_id);
  end if;
end $$;

create index if not exists idx_accounting_entry_templates_org_event on public.accounting_entry_templates(organization_id, event_code, is_active);
create index if not exists idx_accounting_template_lines_template on public.accounting_template_lines(template_id, line_no);
create index if not exists idx_accounting_posting_rules_org_event on public.accounting_posting_rules(organization_id, event_code, priority);

alter table public.accounting_entry_templates enable row level security;
alter table public.accounting_template_lines enable row level security;
alter table public.accounting_posting_rules enable row level security;

drop policy if exists org_accounting_entry_templates_all on public.accounting_entry_templates;
create policy org_accounting_entry_templates_all on public.accounting_entry_templates
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

drop policy if exists org_accounting_template_lines_all on public.accounting_template_lines;
create policy org_accounting_template_lines_all on public.accounting_template_lines
using (
  exists (
    select 1
    from public.accounting_entry_templates t
    where t.id = accounting_template_lines.template_id
      and t.organization_id = public.get_my_profile_org()
  )
)
with check (
  exists (
    select 1
    from public.accounting_entry_templates t
    where t.id = accounting_template_lines.template_id
      and t.organization_id = public.get_my_profile_org()
  )
);

drop policy if exists org_accounting_posting_rules_all on public.accounting_posting_rules;
create policy org_accounting_posting_rules_all on public.accounting_posting_rules
using (organization_id = public.get_my_profile_org())
with check (organization_id = public.get_my_profile_org());

grant all on table public.accounting_entry_templates to anon;
grant all on table public.accounting_entry_templates to authenticated;
grant all on table public.accounting_entry_templates to service_role;
grant all on table public.accounting_template_lines to anon;
grant all on table public.accounting_template_lines to authenticated;
grant all on table public.accounting_template_lines to service_role;
grant all on table public.accounting_posting_rules to anon;
grant all on table public.accounting_posting_rules to authenticated;
grant all on table public.accounting_posting_rules to service_role;
