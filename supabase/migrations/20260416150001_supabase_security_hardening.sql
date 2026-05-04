-- Security hardening for Supabase RPCs, RLS policies, and operational alert helpers.
-- This migration intentionally tightens privileges after the intercompany/FEL rollout.

-- Alert helper functions mutate operational data and must not be callable by anon users.
revoke execute on function public.upsert_operational_alert(uuid, text, text, text, text, text, uuid, text, text, text, jsonb) from anon;
revoke execute on function public.resolve_operational_alert(uuid, text) from anon;
revoke execute on function public.sync_inventory_min_stock_alerts(uuid) from anon;

-- Direct pricing/FEL/receive RPCs should run through trusted code paths.
revoke execute on function public.calculate_transfer_price(text, numeric, uuid, uuid) from anon;
revoke execute on function public.calculate_transfer_price(text, numeric, uuid, uuid) from authenticated;
grant execute on function public.calculate_transfer_price(text, numeric, uuid, uuid) to service_role;

revoke execute on function public.receive_intercompany_dispatch(jsonb, uuid) from anon;
revoke execute on function public.receive_intercompany_dispatch(jsonb, uuid) from authenticated;
grant execute on function public.receive_intercompany_dispatch(jsonb, uuid) to service_role;

revoke execute on function public.generate_fel_document_for_order(uuid, uuid) from anon;
revoke execute on function public.generate_fel_document_for_order(uuid, uuid) from authenticated;
grant execute on function public.generate_fel_document_for_order(uuid, uuid) to service_role;

-- Keep dispatch creation callable by authenticated users, but prevent org spoofing.
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
    source_document_id, status, currency
  ) values (
    v_org_scope, v_transaction_code, p_source_company, p_target_company,
    p_dispatch_id, 'CREATED', v_currency
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

grant execute on function public.create_intercompany_dispatch_event(uuid, jsonb, text, text, uuid) to authenticated, service_role;

-- The app should observe integration state, but mutation is owned by RPCs/Edge Functions.
drop policy if exists org_ic_transactions_all on public.intercompany_transactions;
create policy org_ic_transactions_select on public.intercompany_transactions
  for select using (organization_id is null or organization_id = public.get_my_profile_org());

drop policy if exists org_integration_events_all on public.integration_events;
create policy org_integration_events_select on public.integration_events
  for select using (exists (
    select 1 from public.intercompany_transactions t
    where t.id = integration_events.transaction_id
      and (t.organization_id is null or t.organization_id = public.get_my_profile_org())
  ));

drop policy if exists org_ic_receipts_all on public.intercompany_receipts;
create policy org_ic_receipts_select on public.intercompany_receipts
  for select using (organization_id is null or organization_id = public.get_my_profile_org());
