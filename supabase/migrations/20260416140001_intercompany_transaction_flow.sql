-- Production intercompany transaction flow.
-- GT -> SV event-driven inventory transfer with transfer pricing audit trail.

-- ============================================================
-- 1. Transaction code sequence
-- ============================================================
create sequence if not exists public.intercompany_transaction_code_seq
  as bigint
  start with 1
  increment by 1
  no minvalue
  no maxvalue
  cache 1;

create or replace function public.generate_intercompany_transaction_code(
  p_source_company text default 'GT',
  p_target_company text default 'SV'
)
returns text
language sql
as $$
  select 'IC-' || upper(coalesce(p_source_company, 'GT')) || '-' ||
         upper(coalesce(p_target_company, 'SV')) || '-' ||
         lpad(nextval('public.intercompany_transaction_code_seq')::text, 6, '0');
$$;

-- ============================================================
-- 2. Core transaction header
-- ============================================================
create table if not exists public.intercompany_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  transaction_code text not null unique,
  source_company text not null default 'GT',
  target_company text not null default 'SV',
  source_document_id uuid not null,
  target_document_id uuid,
  status text not null default 'CREATED'
    check (status in ('CREATED', 'SENT', 'RECEIVED', 'PARTIAL', 'REJECTED', 'CLOSED')),
  total_qty numeric(14,4) not null default 0,
  total_value numeric(14,4) not null default 0,
  currency text not null default 'GTQ',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ic_transactions_org_status
  on public.intercompany_transactions(organization_id, status, created_at desc);

create index if not exists idx_ic_transactions_source_document
  on public.intercompany_transactions(source_document_id);

create index if not exists idx_ic_transactions_target_document
  on public.intercompany_transactions(target_document_id)
  where target_document_id is not null;

-- ============================================================
-- 3. Transaction line + lot traceability
-- ============================================================
create table if not exists public.intercompany_transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.intercompany_transactions(id) on delete cascade,
  source_line_id uuid,
  product_sku text not null,
  description text,
  qty numeric(14,4) not null check (qty > 0),
  unit_cost numeric(14,6) not null default 0,
  transfer_price numeric(14,6) not null default 0,
  line_total numeric(14,4) not null default 0,
  currency text not null default 'GTQ',
  created_at timestamptz not null default now()
);

create index if not exists idx_ic_items_transaction
  on public.intercompany_transaction_items(transaction_id);

create index if not exists idx_ic_items_sku
  on public.intercompany_transaction_items(product_sku);

create table if not exists public.intercompany_transaction_lots (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.intercompany_transactions(id) on delete cascade,
  transaction_item_id uuid not null references public.intercompany_transaction_items(id) on delete cascade,
  source_lot_id text,
  lot_code text not null,
  qty numeric(14,4) not null check (qty > 0),
  expiry_date date,
  created_at timestamptz not null default now(),
  unique (transaction_item_id, lot_code)
);

create index if not exists idx_ic_lots_transaction
  on public.intercompany_transaction_lots(transaction_id);

-- ============================================================
-- 4. Integration events + logs
-- ============================================================
create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.intercompany_transactions(id) on delete cascade,
  event_type text not null
    check (event_type in ('DISPATCH_CONFIRMED', 'RECEIPT_CONFIRMED', 'ISSUE_REPORTED', 'RECEIPT_ISSUE_REPORTED')),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  retries integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, event_type)
);

create index if not exists idx_integration_events_pending
  on public.integration_events(status, created_at)
  where status = 'pending';

create index if not exists idx_integration_events_transaction
  on public.integration_events(transaction_id, created_at desc);

create table if not exists public.integration_event_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.integration_events(id) on delete set null,
  transaction_id uuid references public.intercompany_transactions(id) on delete set null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_integration_event_logs_event
  on public.integration_event_logs(event_id, created_at desc);

-- ============================================================
-- 5. Transfer pricing rules + immutable calculation log
-- ============================================================
create table if not exists public.transfer_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  product_sku text not null,
  method text not null default 'COST_PLUS' check (method in ('COST_PLUS')),
  min_margin_pct numeric(9,6) not null check (min_margin_pct >= 0),
  target_margin_pct numeric(9,6) not null check (target_margin_pct >= 0),
  max_margin_pct numeric(9,6) not null check (max_margin_pct >= 0),
  market_reference_price numeric(14,6),
  currency text not null default 'GTQ',
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_margin_pct <= target_margin_pct and target_margin_pct <= max_margin_pct),
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists idx_tp_rules_lookup
  on public.transfer_pricing_rules(organization_id, product_sku, valid_from desc, valid_to);

create table if not exists public.transfer_pricing_logs (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.intercompany_transactions(id) on delete set null,
  product_sku text not null,
  cost numeric(14,6) not null,
  applied_margin_pct numeric(9,6) not null,
  calculated_price numeric(14,6) not null,
  market_reference_price numeric(14,6),
  compliance_adjustment boolean not null default false,
  rule_id uuid references public.transfer_pricing_rules(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tp_logs_transaction
  on public.transfer_pricing_logs(transaction_id, created_at desc);

create index if not exists idx_tp_logs_sku
  on public.transfer_pricing_logs(product_sku, created_at desc);

-- ============================================================
-- 6. Cross-system references and SV receipt staging
-- ============================================================
create table if not exists public.intercompany_references (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.intercompany_transactions(id) on delete cascade,
  gt_dispatch_id uuid not null,
  sv_receipt_id uuid,
  created_at timestamptz not null default now(),
  unique (transaction_id),
  unique (gt_dispatch_id),
  unique (sv_receipt_id)
);

create table if not exists public.intercompany_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  transaction_id uuid not null references public.intercompany_transactions(id) on delete cascade,
  transaction_code text not null unique,
  gt_dispatch_id uuid not null,
  status text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW', 'RECEIVED', 'PARTIAL', 'REJECTED', 'CLOSED')),
  supplier_code text not null default 'GT',
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intercompany_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.intercompany_receipts(id) on delete cascade,
  product_sku text not null,
  qty numeric(14,4) not null check (qty > 0),
  unit_cost numeric(14,6) not null default 0,
  transfer_price numeric(14,6) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.intercompany_receipt_lots (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.intercompany_receipts(id) on delete cascade,
  receipt_item_id uuid not null references public.intercompany_receipt_items(id) on delete cascade,
  source_lot_id text,
  lot_code text not null,
  qty numeric(14,4) not null check (qty > 0),
  expiry_date date,
  created_at timestamptz not null default now(),
  unique (receipt_item_id, lot_code)
);

-- ============================================================
-- 7. Transfer pricing function
-- Percentages are decimal fractions: 0.15 = 15%.
-- ============================================================
create or replace function public.calculate_transfer_price(
  p_product_sku text,
  p_cost numeric,
  p_transaction_id uuid default null,
  p_organization_id uuid default public.get_my_profile_org()
)
returns table (
  final_price numeric,
  applied_margin_pct numeric,
  compliance_adjustment boolean,
  rule_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.transfer_pricing_rules%rowtype;
  v_price numeric(14,6);
  v_min_price numeric(14,6);
  v_max_price numeric(14,6);
  v_market_floor numeric(14,6);
  v_adjusted boolean := false;
begin
  if p_product_sku is null or trim(p_product_sku) = '' then
    raise exception 'product_sku es requerido';
  end if;

  if p_cost is null or p_cost < 0 then
    raise exception 'cost debe ser mayor o igual a cero';
  end if;

  select *
    into v_rule
    from public.transfer_pricing_rules r
    where r.product_sku = p_product_sku
      and (p_organization_id is null or r.organization_id is null or r.organization_id = p_organization_id)
      and r.valid_from <= current_date
      and (r.valid_to is null or r.valid_to >= current_date)
    order by r.organization_id nulls last, r.valid_from desc, r.created_at desc
    limit 1;

  if v_rule.id is null then
    raise exception 'No hay regla activa de precio de transferencia para SKU %', p_product_sku;
  end if;

  if v_rule.method <> 'COST_PLUS' then
    raise exception 'Metodo no soportado: %', v_rule.method;
  end if;

  v_price := p_cost * (1 + v_rule.target_margin_pct);
  v_min_price := p_cost * (1 + v_rule.min_margin_pct);
  v_max_price := p_cost * (1 + v_rule.max_margin_pct);

  if v_rule.market_reference_price is not null then
    v_market_floor := v_rule.market_reference_price * 0.9;
    if v_price < v_market_floor then
      v_price := v_market_floor;
      v_adjusted := true;
    end if;
  end if;

  if v_price < v_min_price then
    v_price := v_min_price;
  elsif v_price > v_max_price then
    v_price := v_max_price;
  end if;

  applied_margin_pct := case when p_cost = 0 then 0 else round((v_price / p_cost) - 1, 6) end;
  final_price := round(v_price, 6);
  compliance_adjustment := v_adjusted;
  rule_id := v_rule.id;

  insert into public.transfer_pricing_logs (
    transaction_id, product_sku, cost, applied_margin_pct, calculated_price,
    market_reference_price, compliance_adjustment, rule_id
  ) values (
    p_transaction_id, p_product_sku, p_cost, applied_margin_pct, final_price,
    v_rule.market_reference_price, compliance_adjustment, rule_id
  );

  return next;
end;
$$;

-- ============================================================
-- 8. Dispatch event creator (GT side)
-- Expected payload:
-- { dispatch_id, currency, invoice_data, items:[{sku, qty, unit_cost, lots:[{lot_id, lot_code, qty, expiry_date}]}] }
-- ============================================================
create or replace function public.create_intercompany_dispatch_event(
  p_dispatch_id uuid,
  p_payload jsonb,
  p_source_company text default 'GT',
  p_target_company text default 'SV',
  p_organization_id uuid default public.get_my_profile_org()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
  v_transaction_code text;
  v_item jsonb;
  v_lot jsonb;
  v_item_id uuid;
  v_qty numeric(14,4);
  v_unit_cost numeric(14,6);
  v_price numeric(14,6);
  v_total_qty numeric(14,4) := 0;
  v_total_value numeric(14,4) := 0;
  v_items jsonb := '[]'::jsonb;
  v_pricing record;
  v_currency text := coalesce(p_payload->>'currency', 'GTQ');
begin
  if p_dispatch_id is null then
    raise exception 'dispatch_id es requerido';
  end if;

  if exists (
    select 1 from public.intercompany_transactions
    where source_document_id = p_dispatch_id
      and source_company = p_source_company
      and target_company = p_target_company
  ) then
    select id into v_transaction_id
      from public.intercompany_transactions
      where source_document_id = p_dispatch_id
        and source_company = p_source_company
        and target_company = p_target_company
      order by created_at desc
      limit 1;
    return v_transaction_id;
  end if;

  v_transaction_code := public.generate_intercompany_transaction_code(p_source_company, p_target_company);

  insert into public.intercompany_transactions (
    organization_id, transaction_code, source_company, target_company,
    source_document_id, status, currency
  ) values (
    p_organization_id, v_transaction_code, p_source_company, p_target_company,
    p_dispatch_id, 'CREATED', v_currency
  )
  returning id into v_transaction_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := (v_item->>'qty')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;

    select *
      into v_pricing
      from public.calculate_transfer_price(v_item->>'sku', v_unit_cost, v_transaction_id, p_organization_id);

    v_price := v_pricing.final_price;

    insert into public.intercompany_transaction_items (
      transaction_id, source_line_id, product_sku, description, qty,
      unit_cost, transfer_price, line_total, currency
    ) values (
      v_transaction_id,
      nullif(v_item->>'source_line_id', '')::uuid,
      v_item->>'sku',
      v_item->>'description',
      v_qty,
      v_unit_cost,
      v_price,
      round(v_price * v_qty, 4),
      v_currency
    )
    returning id into v_item_id;

    for v_lot in select * from jsonb_array_elements(coalesce(v_item->'lots', '[]'::jsonb))
    loop
      insert into public.intercompany_transaction_lots (
        transaction_id, transaction_item_id, source_lot_id, lot_code, qty, expiry_date
      ) values (
        v_transaction_id,
        v_item_id,
        nullif(v_lot->>'lot_id', ''),
        coalesce(v_lot->>'lot_code', v_lot->>'lot_id'),
        (v_lot->>'qty')::numeric,
        nullif(v_lot->>'expiry_date', '')::date
      );
    end loop;

    v_total_qty := v_total_qty + v_qty;
    v_total_value := v_total_value + round(v_price * v_qty, 4);

    v_items := v_items || jsonb_build_array(
      v_item || jsonb_build_object(
        'transfer_price', v_price,
        'pricing', jsonb_build_object(
          'applied_margin_pct', v_pricing.applied_margin_pct,
          'compliance_adjustment', v_pricing.compliance_adjustment,
          'rule_id', v_pricing.rule_id
        )
      )
    );
  end loop;

  update public.intercompany_transactions
    set total_qty = v_total_qty,
        total_value = v_total_value,
        updated_at = now()
    where id = v_transaction_id;

  insert into public.integration_events (
    transaction_id, event_type, payload, status
  ) values (
    v_transaction_id,
    'DISPATCH_CONFIRMED',
    jsonb_build_object(
      'transaction_code', v_transaction_code,
      'dispatch_id', p_dispatch_id,
      'invoice_data', coalesce(p_payload->'invoice_data', '{}'::jsonb),
      'currency', v_currency,
      'items', v_items
    ),
    'pending'
  );

  insert into public.intercompany_references (transaction_id, gt_dispatch_id)
  values (v_transaction_id, p_dispatch_id);

  return v_transaction_id;
end;
$$;

-- ============================================================
-- 9. SV receiver RPC. Idempotent; preserves lot ids exactly.
-- ============================================================
create or replace function public.receive_intercompany_dispatch(
  p_payload jsonb,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_code text := p_payload->>'transaction_code';
  v_dispatch_id uuid := (p_payload->>'dispatch_id')::uuid;
  v_transaction_id uuid;
  v_receipt_id uuid;
  v_item jsonb;
  v_lot jsonb;
  v_receipt_item_id uuid;
  v_total_qty numeric(14,4) := 0;
  v_total_value numeric(14,4) := 0;
begin
  if v_transaction_code is null or trim(v_transaction_code) = '' then
    raise exception 'transaction_code es requerido';
  end if;

  select r.id, r.transaction_id
    into v_receipt_id, v_transaction_id
    from public.intercompany_receipts r
    where r.transaction_code = v_transaction_code
    limit 1;

  if v_receipt_id is not null then
    return jsonb_build_object('status', 'RECEIVED', 'receipt_id', v_receipt_id, 'idempotent', true);
  end if;

  insert into public.intercompany_transactions (
    organization_id, transaction_code, source_company, target_company,
    source_document_id, status, currency
  ) values (
    p_organization_id,
    v_transaction_code,
    'GT',
    'SV',
    v_dispatch_id,
    'RECEIVED',
    coalesce(p_payload->>'currency', 'GTQ')
  )
  on conflict (transaction_code) do update
    set status = excluded.status,
        updated_at = now()
  returning id into v_transaction_id;

  insert into public.intercompany_receipts (
    organization_id, transaction_id, transaction_code, gt_dispatch_id, status
  ) values (
    p_organization_id, v_transaction_id, v_transaction_code, v_dispatch_id, 'PENDING_REVIEW'
  )
  returning id into v_receipt_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    insert into public.intercompany_receipt_items (
      receipt_id, product_sku, qty, unit_cost, transfer_price
    ) values (
      v_receipt_id,
      v_item->>'sku',
      (v_item->>'qty')::numeric,
      coalesce((v_item->>'unit_cost')::numeric, 0),
      coalesce((v_item->>'transfer_price')::numeric, 0)
    )
    returning id into v_receipt_item_id;

    for v_lot in select * from jsonb_array_elements(coalesce(v_item->'lots', '[]'::jsonb))
    loop
      insert into public.intercompany_receipt_lots (
        receipt_id, receipt_item_id, source_lot_id, lot_code, qty, expiry_date
      ) values (
        v_receipt_id,
        v_receipt_item_id,
        nullif(v_lot->>'lot_id', ''),
        coalesce(v_lot->>'lot_code', v_lot->>'lot_id'),
        (v_lot->>'qty')::numeric,
        nullif(v_lot->>'expiry_date', '')::date
      );
    end loop;

    v_total_qty := v_total_qty + (v_item->>'qty')::numeric;
    v_total_value := v_total_value + (coalesce((v_item->>'qty')::numeric, 0) * coalesce((v_item->>'transfer_price')::numeric, 0));
  end loop;

  update public.intercompany_transactions
    set target_document_id = v_receipt_id,
        total_qty = v_total_qty,
        total_value = round(v_total_value, 4),
        status = 'RECEIVED',
        updated_at = now()
    where id = v_transaction_id;

  insert into public.intercompany_references (
    transaction_id, gt_dispatch_id, sv_receipt_id
  ) values (
    v_transaction_id, v_dispatch_id, v_receipt_id
  )
  on conflict (transaction_id) do update
    set sv_receipt_id = excluded.sv_receipt_id;

  return jsonb_build_object('status', 'RECEIVED', 'receipt_id', v_receipt_id, 'idempotent', false);
end;
$$;

-- ============================================================
-- 10. Triggers + RLS
-- ============================================================
drop trigger if exists trg_ic_transactions_touch on public.intercompany_transactions;
create trigger trg_ic_transactions_touch
  before update on public.intercompany_transactions
  for each row execute function public.trg_touch_updated_at();

drop trigger if exists trg_integration_events_touch on public.integration_events;
create trigger trg_integration_events_touch
  before update on public.integration_events
  for each row execute function public.trg_touch_updated_at();

drop trigger if exists trg_tp_rules_touch on public.transfer_pricing_rules;
create trigger trg_tp_rules_touch
  before update on public.transfer_pricing_rules
  for each row execute function public.trg_touch_updated_at();

drop trigger if exists trg_ic_receipts_touch on public.intercompany_receipts;
create trigger trg_ic_receipts_touch
  before update on public.intercompany_receipts
  for each row execute function public.trg_touch_updated_at();

alter table public.intercompany_transactions enable row level security;
alter table public.intercompany_transaction_items enable row level security;
alter table public.intercompany_transaction_lots enable row level security;
alter table public.integration_events enable row level security;
alter table public.integration_event_logs enable row level security;
alter table public.transfer_pricing_rules enable row level security;
alter table public.transfer_pricing_logs enable row level security;
alter table public.intercompany_references enable row level security;
alter table public.intercompany_receipts enable row level security;
alter table public.intercompany_receipt_items enable row level security;
alter table public.intercompany_receipt_lots enable row level security;

drop policy if exists org_ic_transactions_all on public.intercompany_transactions;
create policy org_ic_transactions_all on public.intercompany_transactions
  using (organization_id is null or organization_id = public.get_my_profile_org())
  with check (organization_id is null or organization_id = public.get_my_profile_org());

drop policy if exists org_ic_items_read on public.intercompany_transaction_items;
create policy org_ic_items_read on public.intercompany_transaction_items
  using (exists (
    select 1 from public.intercompany_transactions t
    where t.id = intercompany_transaction_items.transaction_id
      and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
  ));

drop policy if exists org_ic_lots_read on public.intercompany_transaction_lots;
create policy org_ic_lots_read on public.intercompany_transaction_lots
  using (exists (
    select 1 from public.intercompany_transactions t
    where t.id = intercompany_transaction_lots.transaction_id
      and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
  ));

drop policy if exists org_integration_events_all on public.integration_events;
create policy org_integration_events_all on public.integration_events
  using (exists (
    select 1 from public.intercompany_transactions t
    where t.id = integration_events.transaction_id
      and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
  ))
  with check (exists (
    select 1 from public.intercompany_transactions t
    where t.id = integration_events.transaction_id
      and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
  ));

drop policy if exists org_integration_logs_read on public.integration_event_logs;
create policy org_integration_logs_read on public.integration_event_logs
  for select using (
    transaction_id is null or exists (
      select 1 from public.intercompany_transactions t
      where t.id = integration_event_logs.transaction_id
        and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
    )
  );

drop policy if exists org_tp_rules_all on public.transfer_pricing_rules;
create policy org_tp_rules_all on public.transfer_pricing_rules
  using (organization_id is null or organization_id = public.get_my_profile_org())
  with check (organization_id is null or organization_id = public.get_my_profile_org());

drop policy if exists org_tp_logs_read on public.transfer_pricing_logs;
create policy org_tp_logs_read on public.transfer_pricing_logs
  for select using (
    transaction_id is null or exists (
      select 1 from public.intercompany_transactions t
      where t.id = transfer_pricing_logs.transaction_id
        and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
    )
  );

drop policy if exists org_ic_references_read on public.intercompany_references;
create policy org_ic_references_read on public.intercompany_references
  for select using (exists (
    select 1 from public.intercompany_transactions t
    where t.id = intercompany_references.transaction_id
      and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
  ));

drop policy if exists org_ic_receipts_all on public.intercompany_receipts;
create policy org_ic_receipts_all on public.intercompany_receipts
  using (organization_id is null or organization_id = public.get_my_profile_org())
  with check (organization_id is null or organization_id = public.get_my_profile_org());

drop policy if exists org_ic_receipt_items_read on public.intercompany_receipt_items;
create policy org_ic_receipt_items_read on public.intercompany_receipt_items
  for select using (exists (
    select 1 from public.intercompany_receipts r
    where r.id = intercompany_receipt_items.receipt_id
      and (r.organization_id is null or r.organization_id = public.get_my_profile_org())
  ));

drop policy if exists org_ic_receipt_lots_read on public.intercompany_receipt_lots;
create policy org_ic_receipt_lots_read on public.intercompany_receipt_lots
  for select using (exists (
    select 1 from public.intercompany_receipts r
    where r.id = intercompany_receipt_lots.receipt_id
      and (r.organization_id is null or r.organization_id = public.get_my_profile_org())
  ));

grant execute on function public.generate_intercompany_transaction_code(text, text) to authenticated, service_role;
grant execute on function public.calculate_transfer_price(text, numeric, uuid, uuid) to service_role;
grant execute on function public.create_intercompany_dispatch_event(uuid, jsonb, text, text, uuid) to authenticated, service_role;
grant execute on function public.receive_intercompany_dispatch(jsonb, uuid) to service_role;

-- ============================================================
-- 11. Universal FEL generation for every order
-- Local, export, and intercompany orders all produce fel_documents.
-- Idempotent: existing orders.fel_document_id or source document wins.
-- ============================================================
create or replace function public.generate_fel_document_for_order(
  p_order_id uuid,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_org record;
  v_client record;
  v_doc_id uuid;
  v_line record;
  v_line_no integer := 0;
  v_subtotal numeric(14,4) := 0;
  v_iva numeric(14,4) := 0;
  v_total numeric(14,4) := 0;
  v_tipo_documento text := 'FACT';
  v_iva_rate numeric := 0.12;
begin
  select o.*
    into v_order
    from public.orders o
    where o.id = p_order_id;

  if v_order.id is null then
    raise exception 'Pedido % no existe', p_order_id;
  end if;

  if v_order.fel_document_id is not null then
    return v_order.fel_document_id;
  end if;

  select id
    into v_doc_id
    from public.fel_documents
    where source_type = 'order'
      and source_id = p_order_id
    limit 1;

  if v_doc_id is not null then
    update public.orders
      set fel_document_id = v_doc_id,
          updated_at = now()
      where id = p_order_id;
    return v_doc_id;
  end if;

  select *
    into v_org
    from public.organizations
    where id = v_order.organization_id;

  select *
    into v_client
    from public.clients
    where id = v_order.client_id;

  if v_client.id is null then
    raise exception 'Cliente % no existe para pedido %', v_order.client_id, p_order_id;
  end if;

  v_iva_rate := coalesce(v_order.iva_rate, 0.12);

  if coalesce(v_order.es_exportacion, false) then
    v_tipo_documento := 'FACA';
  elsif coalesce(v_order.tipo_pedido, 'regular') = 'intercompany' then
    select coalesce(p.default_fel_tipo_documento, 'FACT')
      into v_tipo_documento
      from public.intercompany_partners p
      where p.id = v_order.intercompany_partner_id;
    v_tipo_documento := coalesce(v_tipo_documento, 'FACT');
  end if;

  insert into public.fel_documents (
    organization_id, tipo_documento, fecha_emision,
    emisor_nit, emisor_nombre,
    receptor_nit, receptor_nombre, receptor_direccion, receptor_email,
    moneda, tipo_cambio, subtotal, descuento, iva, otros_impuestos, total,
    es_exportacion, estado_fel, source_type, source_id, created_by, notas
  ) values (
    v_order.organization_id,
    v_tipo_documento,
    now(),
    coalesce(v_org.rtn, 'CF'),
    v_org.name,
    coalesce(v_client.nit, 'CF'),
    coalesce(v_client.legal_name, v_client.commercial_name),
    v_client.main_address,
    v_client.email,
    coalesce(v_order.moneda, v_client.moneda_default, 'GTQ'),
    v_order.tipo_cambio,
    0,
    0,
    0,
    0,
    0,
    coalesce(v_order.es_exportacion, false),
    'pending',
    'order',
    p_order_id,
    p_created_by,
    'Generado automaticamente al facturar pedido'
  )
  returning id into v_doc_id;

  for v_line in
    select
      oi.id,
      oi.quantity,
      oi.unit_price,
      coalesce(oi.subtotal, oi.quantity * oi.unit_price) as line_subtotal,
      pp.code,
      pp.display_name,
      pp.unit
    from public.order_items oi
    left join public.product_presentations pp on pp.id = oi.product_presentation_id
    where oi.order_id = p_order_id
    order by oi.created_at, oi.id
  loop
    v_line_no := v_line_no + 1;
    v_subtotal := v_subtotal + coalesce(v_line.line_subtotal, 0);

    insert into public.fel_document_lines (
      fel_document_id, line_no, descripcion, codigo_producto,
      cantidad, unidad_medida, precio_unitario, descuento,
      subtotal, iva, total_linea, bien_o_servicio,
      source_line_type, source_line_id
    ) values (
      v_doc_id,
      v_line_no,
      coalesce(v_line.display_name, v_line.code, 'Producto'),
      v_line.code,
      coalesce(v_line.quantity, 0),
      coalesce(v_line.unit, 'UNI'),
      coalesce(v_line.unit_price, 0),
      0,
      round(coalesce(v_line.line_subtotal, 0), 4),
      case when coalesce(v_order.es_exportacion, false) then 0 else round(coalesce(v_line.line_subtotal, 0) * v_iva_rate, 4) end,
      case when coalesce(v_order.es_exportacion, false) then round(coalesce(v_line.line_subtotal, 0), 4) else round(coalesce(v_line.line_subtotal, 0) * (1 + v_iva_rate), 4) end,
      'B',
      'order_item',
      v_line.id
    );
  end loop;

  v_iva := case when coalesce(v_order.es_exportacion, false) then 0 else round(v_subtotal * v_iva_rate, 4) end;
  v_total := round(v_subtotal + v_iva, 4);

  update public.fel_documents
    set subtotal = round(v_subtotal, 4),
        iva = v_iva,
        total = v_total,
        updated_at = now()
    where id = v_doc_id;

  update public.orders
    set fel_document_id = v_doc_id,
        updated_at = now()
    where id = p_order_id;

  return v_doc_id;
end;
$$;

create or replace function public.trg_generate_fel_on_order_facturado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'facturado'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.fel_document_id is null then
    perform public.generate_fel_document_for_order(new.id, new.created_by);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_generate_fel on public.orders;
create trigger trg_orders_generate_fel
  after insert or update of status on public.orders
  for each row execute function public.trg_generate_fel_on_order_facturado();

grant execute on function public.generate_fel_document_for_order(uuid, uuid) to service_role;

do $$
declare
  v_order record;
begin
  for v_order in
    select id, created_by
    from public.orders
    where status = 'facturado'
      and fel_document_id is null
  loop
    begin
      perform public.generate_fel_document_for_order(v_order.id, v_order.created_by);
    exception when others then
      insert into public.integration_event_logs(level, message, context)
      values (
        'warn',
        'No se pudo generar FEL historico para pedido facturado',
        jsonb_build_object('order_id', v_order.id, 'error', sqlerrm)
      );
    end;
  end loop;
end $$;
