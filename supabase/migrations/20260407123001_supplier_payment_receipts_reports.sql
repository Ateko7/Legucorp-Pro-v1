create table if not exists public.supplier_payment_batches (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  supplier_id uuid not null,
  payment_reference text not null,
  payment_date date not null default current_date,
  total_amount numeric not null default 0,
  receipt_file_url text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_payment_batches_pkey primary key (id),
  constraint supplier_payment_batches_organization_id_fkey foreign key (organization_id) references public.organizations(id),
  constraint supplier_payment_batches_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id),
  constraint supplier_payment_batches_created_by_fkey foreign key (created_by) references public.profiles(id)
);

create index if not exists idx_supplier_payment_batches_org_date
  on public.supplier_payment_batches (organization_id, payment_date desc);

create unique index if not exists idx_supplier_payment_batches_org_reference
  on public.supplier_payment_batches (organization_id, payment_reference, supplier_id);

insert into public.supplier_payment_batches (
  id,
  organization_id,
  supplier_id,
  payment_reference,
  payment_date,
  total_amount,
  receipt_file_url,
  created_by,
  created_at,
  updated_at
)
select
  sap.payment_batch_id,
  sap.organization_id,
  sap.supplier_id,
  coalesce(nullif(max(sap.payment_reference), ''), 'LEGACY-' || left(sap.payment_batch_id::text, 8)),
  coalesce(max(sap.paid_at)::date, current_date),
  coalesce(sum(coalesce(sap.paid_amount, sap.net_payable_amount, sap.payable_amount, 0)), 0),
  null,
  (
    array_agg(sap.paid_by order by sap.paid_at desc nulls last)
    filter (where sap.paid_by is not null)
  )[1],
  coalesce(max(sap.paid_at), now()),
  coalesce(max(sap.updated_at), now())
from public.supplier_accounts_payable sap
where sap.payment_batch_id is not null
group by sap.payment_batch_id, sap.organization_id, sap.supplier_id
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_accounts_payable_payment_batch_id_fkey'
  ) then
    alter table public.supplier_accounts_payable
      add constraint supplier_accounts_payable_payment_batch_id_fkey
      foreign key (payment_batch_id) references public.supplier_payment_batches(id);
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('supplier-payment-receipts', 'supplier-payment-receipts', true)
on conflict (id) do nothing;

drop policy if exists "supplier_payment_receipts_select_public" on storage.objects;
create policy "supplier_payment_receipts_select_public"
on storage.objects
for select
to public
using (bucket_id = 'supplier-payment-receipts');

drop policy if exists "supplier_payment_receipts_insert_auth" on storage.objects;
create policy "supplier_payment_receipts_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'supplier-payment-receipts');

drop policy if exists "supplier_payment_receipts_update_auth" on storage.objects;
create policy "supplier_payment_receipts_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'supplier-payment-receipts');
