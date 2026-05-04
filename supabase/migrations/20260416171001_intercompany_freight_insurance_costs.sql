-- Agrega costos de flete y seguro a movimientos intercompany.
-- El prorrateo no se hace aqui: recepcion SV define la logica mixta por tipo de cargamento.

alter table public.intercompany_transactions
  add column if not exists freight_cost numeric(14,4) not null default 0,
  add column if not exists insurance_cost numeric(14,4) not null default 0,
  add column if not exists logistics_cost_total numeric(14,4) not null default 0;

alter table public.intercompany_receipts
  add column if not exists freight_cost numeric(14,4) not null default 0,
  add column if not exists insurance_cost numeric(14,4) not null default 0,
  add column if not exists logistics_cost_total numeric(14,4) not null default 0;

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
  v_session_org uuid := public.get_my_profile_org();
  v_org_scope uuid := coalesce(v_session_org, p_organization_id);
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
  v_freight_cost numeric(14,4) := greatest(coalesce(nullif(p_payload->>'freight_cost', '')::numeric, 0), 0);
  v_insurance_cost numeric(14,4) := greatest(coalesce(nullif(p_payload->>'insurance_cost', '')::numeric, 0), 0);
  v_logistics_cost_total numeric(14,4);
begin
  if p_dispatch_id is null then
    raise exception 'dispatch_id es requerido';
  end if;

  if v_session_org is not null
     and p_organization_id is not null
     and p_organization_id <> v_session_org then
    raise exception 'organization_id no autorizado';
  end if;

  if v_org_scope is null then
    raise exception 'organization_id es requerido';
  end if;

  v_logistics_cost_total := round(v_freight_cost + v_insurance_cost, 4);

  if exists (
    select 1 from public.intercompany_transactions
    where source_document_id = p_dispatch_id
      and source_company = p_source_company
      and target_company = p_target_company
      and organization_id = v_org_scope
  ) then
    select id into v_transaction_id
      from public.intercompany_transactions
      where source_document_id = p_dispatch_id
        and source_company = p_source_company
        and target_company = p_target_company
        and organization_id = v_org_scope
      order by created_at desc
      limit 1;
    return v_transaction_id;
  end if;

  v_transaction_code := public.generate_intercompany_transaction_code(p_source_company, p_target_company);

  insert into public.intercompany_transactions (
    organization_id, transaction_code, source_company, target_company,
    source_document_id, status, currency, freight_cost, insurance_cost, logistics_cost_total
  ) values (
    v_org_scope, v_transaction_code, p_source_company, p_target_company,
    p_dispatch_id, 'CREATED', v_currency, v_freight_cost, v_insurance_cost, v_logistics_cost_total
  )
  returning id into v_transaction_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    v_qty := (v_item->>'qty')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;

    select *
      into v_pricing
      from public.calculate_transfer_price(v_item->>'sku', v_unit_cost, v_transaction_id, v_org_scope);

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
        freight_cost = v_freight_cost,
        insurance_cost = v_insurance_cost,
        logistics_cost_total = v_logistics_cost_total,
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
      'freight_cost', v_freight_cost,
      'insurance_cost', v_insurance_cost,
      'logistics_cost_total', v_logistics_cost_total,
      'items', v_items
    ),
    'pending'
  );

  insert into public.intercompany_references (transaction_id, gt_dispatch_id)
  values (v_transaction_id, p_dispatch_id);

  return v_transaction_id;
end;
$$;

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
  v_freight_cost numeric(14,4) := greatest(coalesce(nullif(p_payload->>'freight_cost', '')::numeric, 0), 0);
  v_insurance_cost numeric(14,4) := greatest(coalesce(nullif(p_payload->>'insurance_cost', '')::numeric, 0), 0);
  v_logistics_cost_total numeric(14,4);
begin
  if v_transaction_code is null or trim(v_transaction_code) = '' then
    raise exception 'transaction_code es requerido';
  end if;

  v_logistics_cost_total := round(v_freight_cost + v_insurance_cost, 4);

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
    source_document_id, status, currency, freight_cost, insurance_cost, logistics_cost_total
  ) values (
    p_organization_id,
    v_transaction_code,
    'GT',
    'SV',
    v_dispatch_id,
    'RECEIVED',
    coalesce(p_payload->>'currency', 'GTQ'),
    v_freight_cost,
    v_insurance_cost,
    v_logistics_cost_total
  )
  on conflict (transaction_code) do update
    set status = excluded.status,
        freight_cost = excluded.freight_cost,
        insurance_cost = excluded.insurance_cost,
        logistics_cost_total = excluded.logistics_cost_total,
        updated_at = now()
  returning id into v_transaction_id;

  insert into public.intercompany_receipts (
    organization_id, transaction_id, transaction_code, gt_dispatch_id, status,
    freight_cost, insurance_cost, logistics_cost_total
  ) values (
    p_organization_id, v_transaction_id, v_transaction_code, v_dispatch_id, 'PENDING_REVIEW',
    v_freight_cost, v_insurance_cost, v_logistics_cost_total
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

  update public.intercompany_receipts
    set freight_cost = v_freight_cost,
        insurance_cost = v_insurance_cost,
        logistics_cost_total = v_logistics_cost_total,
        updated_at = now()
    where id = v_receipt_id;

  update public.intercompany_transactions
    set target_document_id = v_receipt_id,
        total_qty = v_total_qty,
        total_value = round(v_total_value, 4),
        freight_cost = v_freight_cost,
        insurance_cost = v_insurance_cost,
        logistics_cost_total = v_logistics_cost_total,
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

grant execute on function public.create_intercompany_dispatch_event(uuid, jsonb, text, text, uuid) to authenticated, service_role;
grant execute on function public.receive_intercompany_dispatch(jsonb, uuid) to service_role;
