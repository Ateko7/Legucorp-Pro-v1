create table if not exists public.sales_commission_payment_batches (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  salesperson_id uuid not null references public.salespeople(id),
  period_from date not null,
  period_to date not null,
  payment_date date not null default current_date,
  payment_reference text not null,
  total_amount numeric(14,2) not null default 0 check (total_amount > 0),
  receipt_file_url text,
  bank_account_id uuid references public.bank_accounts(id),
  debit_bank_name text,
  debit_account_number text,
  journal_entry_id uuid references public.journal_entries(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_commission_payment_batches_pkey primary key (id)
);

create index if not exists idx_sales_commission_batches_org_date
  on public.sales_commission_payment_batches (organization_id, payment_date desc);

create index if not exists idx_sales_commission_batches_org_salesperson
  on public.sales_commission_payment_batches (organization_id, salesperson_id, period_from desc, period_to desc);

create unique index if not exists idx_sales_commission_batches_org_reference
  on public.sales_commission_payment_batches (organization_id, payment_reference);

alter table public.expenses
  add column if not exists salesperson_id uuid,
  add column if not exists commission_base_amount numeric(14,2),
  add column if not exists commission_pct numeric(10,6),
  add column if not exists commission_status text
    check (commission_status is null or commission_status in ('pendiente_pago', 'pagada')),
  add column if not exists sales_commission_payment_batch_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expenses_salesperson_id_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_salesperson_id_fkey
      foreign key (salesperson_id) references public.salespeople(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'expenses_sales_commission_payment_batch_id_fkey'
  ) then
    alter table public.expenses
      add constraint expenses_sales_commission_payment_batch_id_fkey
      foreign key (sales_commission_payment_batch_id) references public.sales_commission_payment_batches(id);
  end if;
end $$;

create index if not exists idx_expenses_org_commission_status
  on public.expenses (organization_id, commission_status, expense_date desc)
  where expense_type = 'comercial' and source_order_id is not null;

create index if not exists idx_expenses_sales_commission_batch
  on public.expenses (sales_commission_payment_batch_id)
  where sales_commission_payment_batch_id is not null;

update public.expenses e
set
  salesperson_id = c.salesperson_id,
  commission_status = case
    when e.sales_commission_payment_batch_id is not null then 'pagada'
    else coalesce(e.commission_status, 'pendiente_pago')
  end
from public.orders o
join public.clients c on c.id = o.client_id
where e.source_order_id = o.id
  and e.expense_type = 'comercial'
  and e.source_order_id is not null
  and (e.salesperson_id is null or e.commission_status is null);

insert into storage.buckets (id, name, public)
values ('commission-payment-receipts', 'commission-payment-receipts', true)
on conflict (id) do nothing;

drop policy if exists "commission_payment_receipts_select_public" on storage.objects;
create policy "commission_payment_receipts_select_public"
on storage.objects
for select
to public
using (bucket_id = 'commission-payment-receipts');

drop policy if exists "commission_payment_receipts_insert_auth" on storage.objects;
create policy "commission_payment_receipts_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'commission-payment-receipts');

drop policy if exists "commission_payment_receipts_update_auth" on storage.objects;
create policy "commission_payment_receipts_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'commission-payment-receipts');

grant select, insert, update, delete on table public.sales_commission_payment_batches to authenticated;
grant select, insert, update, delete on table public.sales_commission_payment_batches to service_role;

alter table public.sales_commission_payment_batches enable row level security;
drop policy if exists org_sales_commission_payment_batches_all on public.sales_commission_payment_batches;
create policy org_sales_commission_payment_batches_all on public.sales_commission_payment_batches
  using (organization_id = public.get_my_profile_org())
  with check (organization_id = public.get_my_profile_org());
