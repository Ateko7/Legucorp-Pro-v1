create table if not exists public.order_claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.order_claims(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  product_presentation_id uuid references public.product_presentations(id) on delete set null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price numeric(14,4) not null default 0 check (unit_price >= 0),
  standard_cost numeric(14,4) not null default 0 check (standard_cost >= 0),
  amount numeric(14,4) not null default 0 check (amount >= 0),
  sale_loss_potential numeric(14,4) not null default 0 check (sale_loss_potential >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_claim_items_claim on public.order_claim_items(claim_id);
create index if not exists idx_order_claim_items_order_item on public.order_claim_items(order_item_id);

alter table public.order_claim_items enable row level security;

drop policy if exists org_order_claim_items on public.order_claim_items;
create policy org_order_claim_items
on public.order_claim_items
using (
  exists (
    select 1
    from public.order_claims oc
    where oc.id = order_claim_items.claim_id
      and oc.organization_id = public.get_my_profile_org()
  )
)
with check (
  exists (
    select 1
    from public.order_claims oc
    where oc.id = order_claim_items.claim_id
      and oc.organization_id = public.get_my_profile_org()
  )
);

grant all on table public.order_claim_items to anon;
grant all on table public.order_claim_items to authenticated;
grant all on table public.order_claim_items to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_claim_items'
  ) then
    alter publication supabase_realtime add table public.order_claim_items;
  end if;
end
$$;
