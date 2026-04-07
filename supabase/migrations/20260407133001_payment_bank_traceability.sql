alter table public.supplier_payment_batches
  add column if not exists debit_bank_name text,
  add column if not exists debit_account_number text;

alter table public.expenses
  add column if not exists payment_bank_name text,
  add column if not exists payment_account_number text;

alter table public.orders
  add column if not exists collection_bank_name text,
  add column if not exists collection_account_number text;
