alter table public.supplier_accounts_payable
  add column if not exists payment_batch_id uuid;

create index if not exists idx_supplier_accounts_payable_payment_batch
  on public.supplier_accounts_payable (payment_batch_id);
