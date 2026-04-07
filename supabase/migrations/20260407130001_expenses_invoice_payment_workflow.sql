alter table public.expenses
  add column if not exists status text
  check (status in ('pendiente_factura', 'pendiente_pago', 'pagado')),
  add column if not exists supplier_id uuid,
  add column if not exists supplier_accounts_payable_id uuid,
  add column if not exists supplier_payment_batch_id uuid,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists invoice_file_url text,
  add column if not exists invoice_uploaded_at timestamptz,
  add column if not exists invoice_uploaded_by uuid,
  add column if not exists payment_reference text,
  add column if not exists payment_receipt_file_url text,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid;

update public.expenses
set status = case
  when paid_at is not null then 'pagado'
  when coalesce(invoice_number, '') <> '' and coalesce(invoice_file_url, '') <> '' then 'pendiente_pago'
  else 'pendiente_factura'
end
where coalesce(status, '') = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_supplier_id_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_supplier_id_fkey
      foreign key (supplier_id) references public.suppliers(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_supplier_accounts_payable_id_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_supplier_accounts_payable_id_fkey
      foreign key (supplier_accounts_payable_id) references public.supplier_accounts_payable(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_supplier_payment_batch_id_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_supplier_payment_batch_id_fkey
      foreign key (supplier_payment_batch_id) references public.supplier_payment_batches(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_invoice_uploaded_by_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_invoice_uploaded_by_fkey
      foreign key (invoice_uploaded_by) references public.profiles(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_paid_by_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_paid_by_fkey
      foreign key (paid_by) references public.profiles(id);
  end if;
end $$;

create unique index if not exists idx_expenses_supplier_cxp_unique
  on public.expenses (supplier_accounts_payable_id)
  where supplier_accounts_payable_id is not null;

create index if not exists idx_expenses_org_status_date
  on public.expenses (organization_id, status, expense_date desc);

insert into storage.buckets (id, name, public)
values ('expense-documents', 'expense-documents', true)
on conflict (id) do nothing;

drop policy if exists "expense_documents_select_public" on storage.objects;
create policy "expense_documents_select_public"
on storage.objects
for select
to public
using (bucket_id = 'expense-documents');

drop policy if exists "expense_documents_insert_auth" on storage.objects;
create policy "expense_documents_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'expense-documents');

drop policy if exists "expense_documents_update_auth" on storage.objects;
create policy "expense_documents_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'expense-documents');
