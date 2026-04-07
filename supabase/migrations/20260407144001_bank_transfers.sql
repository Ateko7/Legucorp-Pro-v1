create table if not exists public.bank_transfers (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  transfer_date date not null default current_date,
  from_bank_account_id uuid not null,
  to_bank_account_id uuid not null,
  amount numeric not null default 0,
  reference_number text not null,
  receipt_file_url text,
  notes text,
  created_by uuid,
  journal_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_transfers_pkey primary key (id),
  constraint bank_transfers_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint bank_transfers_from_bank_account_id_fkey foreign key (from_bank_account_id) references public.bank_accounts(id),
  constraint bank_transfers_to_bank_account_id_fkey foreign key (to_bank_account_id) references public.bank_accounts(id),
  constraint bank_transfers_created_by_fkey foreign key (created_by) references public.profiles(id),
  constraint bank_transfers_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id),
  constraint bank_transfers_different_accounts_chk check (from_bank_account_id <> to_bank_account_id),
  constraint bank_transfers_amount_positive_chk check (amount > 0)
);

create index if not exists idx_bank_transfers_org_date
  on public.bank_transfers (organization_id, transfer_date desc);

create index if not exists idx_bank_transfers_from_account
  on public.bank_transfers (from_bank_account_id, transfer_date desc);

create index if not exists idx_bank_transfers_to_account
  on public.bank_transfers (to_bank_account_id, transfer_date desc);

insert into storage.buckets (id, name, public)
values ('bank-transfer-receipts', 'bank-transfer-receipts', true)
on conflict (id) do nothing;

drop policy if exists "bank_transfer_receipts_select_public" on storage.objects;
create policy "bank_transfer_receipts_select_public"
on storage.objects
for select
to public
using (bucket_id = 'bank-transfer-receipts');

drop policy if exists "bank_transfer_receipts_insert_auth" on storage.objects;
create policy "bank_transfer_receipts_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'bank-transfer-receipts');

drop policy if exists "bank_transfer_receipts_update_auth" on storage.objects;
create policy "bank_transfer_receipts_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'bank-transfer-receipts');
