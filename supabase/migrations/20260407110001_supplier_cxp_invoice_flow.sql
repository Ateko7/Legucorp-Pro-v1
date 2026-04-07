alter table public.supplier_accounts_payable
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists invoice_file_url text,
  add column if not exists invoice_uploaded_at timestamptz,
  add column if not exists invoice_uploaded_by uuid,
  add column if not exists payment_reference text,
  add column if not exists paid_amount numeric default 0,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid;

update public.supplier_accounts_payable
set status = case
  when paid_at is not null then 'pagado'
  when coalesce(invoice_number, '') <> '' and coalesce(invoice_file_url, '') <> '' then 'pendiente_pago'
  else 'pendiente_factura'
end,
updated_at = now()
where coalesce(status, '') not in ('pagado', 'pendiente_pago', 'pendiente_factura');

create index if not exists idx_supplier_accounts_payable_org_status_created
  on public.supplier_accounts_payable (organization_id, status, created_at desc);

insert into storage.buckets (id, name, public)
values ('supplier-invoices', 'supplier-invoices', true)
on conflict (id) do nothing;

drop policy if exists "supplier_invoices_select_public" on storage.objects;
create policy "supplier_invoices_select_public"
on storage.objects
for select
to public
using (bucket_id = 'supplier-invoices');

drop policy if exists "supplier_invoices_insert_auth" on storage.objects;
create policy "supplier_invoices_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'supplier-invoices');

drop policy if exists "supplier_invoices_update_auth" on storage.objects;
create policy "supplier_invoices_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'supplier-invoices');
