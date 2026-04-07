create table if not exists public.bank_accounts (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  accounting_account_id uuid not null,
  name text not null,
  bank_name text not null,
  account_number text not null,
  currency text not null default 'GTQ',
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_accounts_pkey primary key (id),
  constraint bank_accounts_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint bank_accounts_accounting_account_id_fkey foreign key (accounting_account_id) references public.accounting_accounts(id),
  constraint bank_accounts_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create unique index if not exists idx_bank_accounts_org_bank_account
  on public.bank_accounts (organization_id, bank_name, account_number);

create index if not exists idx_bank_accounts_org_active
  on public.bank_accounts (organization_id, is_active, bank_name);

create table if not exists public.bank_movements (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  bank_account_id uuid not null,
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('debito', 'credito')),
  debit_amount numeric not null default 0,
  credit_amount numeric not null default 0,
  document_number text,
  receipt_file_url text,
  description text,
  source_type text not null,
  source_id uuid,
  reconciled boolean not null default false,
  reconciled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_movements_pkey primary key (id),
  constraint bank_movements_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint bank_movements_bank_account_id_fkey foreign key (bank_account_id) references public.bank_accounts(id),
  constraint bank_movements_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create unique index if not exists idx_bank_movements_source_unique
  on public.bank_movements (source_type, source_id)
  where source_id is not null;

create index if not exists idx_bank_movements_account_date
  on public.bank_movements (bank_account_id, movement_date desc);

alter table public.supplier_payment_batches
  add column if not exists bank_account_id uuid;

alter table public.expenses
  add column if not exists bank_account_id uuid;

alter table public.orders
  add column if not exists collection_reference text,
  add column if not exists collection_receipt_file_url text,
  add column if not exists collection_bank_account_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'supplier_payment_batches_bank_account_id_fkey'
  ) then
    alter table public.supplier_payment_batches
      add constraint supplier_payment_batches_bank_account_id_fkey
      foreign key (bank_account_id) references public.bank_accounts(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_bank_account_id_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_bank_account_id_fkey
      foreign key (bank_account_id) references public.bank_accounts(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_collection_bank_account_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_collection_bank_account_id_fkey
      foreign key (collection_bank_account_id) references public.bank_accounts(id);
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('collection-receipts', 'collection-receipts', true)
on conflict (id) do nothing;

drop policy if exists "collection_receipts_select_public" on storage.objects;
create policy "collection_receipts_select_public"
on storage.objects
for select
to public
using (bucket_id = 'collection-receipts');

drop policy if exists "collection_receipts_insert_auth" on storage.objects;
create policy "collection_receipts_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'collection-receipts');

drop policy if exists "collection_receipts_update_auth" on storage.objects;
create policy "collection_receipts_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'collection-receipts');
