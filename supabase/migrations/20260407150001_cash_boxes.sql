create table if not exists public.cash_boxes (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  accounting_account_id uuid not null,
  name text not null,
  box_type text not null check (box_type in ('mercado', 'caja_chica')),
  description text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_boxes_pkey primary key (id),
  constraint cash_boxes_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_boxes_accounting_account_id_fkey foreign key (accounting_account_id) references public.accounting_accounts(id),
  constraint cash_boxes_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create unique index if not exists idx_cash_boxes_org_name
  on public.cash_boxes (organization_id, name);

create index if not exists idx_cash_boxes_org_type_active
  on public.cash_boxes (organization_id, box_type, is_active);

create table if not exists public.cash_box_liquidations (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  cash_box_id uuid not null,
  liquidation_date date not null default current_date,
  invoice_number text not null,
  invoice_date date,
  invoice_file_url text,
  notes text,
  total_amount numeric not null default 0,
  journal_entry_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_box_liquidations_pkey primary key (id),
  constraint cash_box_liquidations_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_box_liquidations_cash_box_id_fkey foreign key (cash_box_id) references public.cash_boxes(id),
  constraint cash_box_liquidations_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id),
  constraint cash_box_liquidations_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create index if not exists idx_cash_box_liquidations_box_date
  on public.cash_box_liquidations (cash_box_id, liquidation_date desc);

create table if not exists public.cash_box_movements (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  cash_box_id uuid not null,
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('fondeo', 'compra_mp', 'gasto')),
  amount numeric not null default 0,
  quantity numeric,
  unit_cost numeric,
  supplier_id uuid,
  material_id uuid,
  cost_center_id uuid,
  expense_type text,
  description text,
  bank_account_id uuid,
  reference_number text,
  support_file_url text,
  status text not null default 'registrado' check (status in ('registrado', 'pendiente_liquidacion', 'liquidado')),
  liquidation_id uuid,
  journal_entry_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_box_movements_pkey primary key (id),
  constraint cash_box_movements_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint cash_box_movements_cash_box_id_fkey foreign key (cash_box_id) references public.cash_boxes(id),
  constraint cash_box_movements_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id),
  constraint cash_box_movements_material_id_fkey foreign key (material_id) references public.materials(id),
  constraint cash_box_movements_cost_center_id_fkey foreign key (cost_center_id) references public.cost_centers(id),
  constraint cash_box_movements_bank_account_id_fkey foreign key (bank_account_id) references public.bank_accounts(id),
  constraint cash_box_movements_liquidation_id_fkey foreign key (liquidation_id) references public.cash_box_liquidations(id),
  constraint cash_box_movements_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id),
  constraint cash_box_movements_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create index if not exists idx_cash_box_movements_box_date
  on public.cash_box_movements (cash_box_id, movement_date desc, created_at desc);

create index if not exists idx_cash_box_movements_status
  on public.cash_box_movements (organization_id, status, movement_type);

create index if not exists idx_cash_box_movements_bank_account
  on public.cash_box_movements (bank_account_id, movement_type)
  where bank_account_id is not null;

insert into storage.buckets (id, name, public)
values ('cash-box-documents', 'cash-box-documents', true)
on conflict (id) do nothing;

drop policy if exists "cash_box_documents_select_public" on storage.objects;
create policy "cash_box_documents_select_public"
on storage.objects
for select
to public
using (bucket_id = 'cash-box-documents');

drop policy if exists "cash_box_documents_insert_auth" on storage.objects;
create policy "cash_box_documents_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'cash-box-documents');

drop policy if exists "cash_box_documents_update_auth" on storage.objects;
create policy "cash_box_documents_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'cash-box-documents');
