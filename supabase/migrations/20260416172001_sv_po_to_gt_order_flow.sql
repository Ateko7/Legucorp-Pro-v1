-- Intercompany SV -> GT: confirmed purchase orders create GT commercial orders.
-- Commercial packing relieves GT finished inventory; dispatch requires packed
-- orders, and SV inventory is received only after driver delivery confirmation.

alter table public.orders
  add column if not exists intercompany_source text,
  add column if not exists sv_purchase_order_id text,
  add column if not exists sv_purchase_order_number text,
  add column if not exists intercompany_source_payload jsonb not null default '{}'::jsonb,
  add column if not exists intercompany_delivery_event_sent_at timestamptz;

alter table public.order_items
  add column if not exists sv_purchase_order_line_id text,
  add column if not exists intercompany_source_line_payload jsonb not null default '{}'::jsonb;

alter table public.order_claims
  add column if not exists intercompany_source_payload jsonb not null default '{}'::jsonb;

create unique index if not exists uq_orders_sv_purchase_order
  on public.orders(organization_id, sv_purchase_order_id)
  where sv_purchase_order_id is not null;

do $$
begin
  alter table public.integration_events
    drop constraint if exists integration_events_event_type_check;

  alter table public.integration_events
    add constraint integration_events_event_type_check
    check (event_type in (
      'PURCHASE_ORDER_CONFIRMED',
      'ORDER_CREATED_ACK',
      'DISPATCH_CONFIRMED',
      'DELIVERY_CONFIRMED',
      'RECEIPT_CONFIRMED',
      'ISSUE_REPORTED',
      'RECEIPT_ISSUE_REPORTED',
      'CLAIM_CREATED'
    ));
end $$;

do $$
begin
  alter table public.intercompany_transactions
    drop constraint if exists intercompany_transactions_status_check;

  alter table public.intercompany_transactions
    add constraint intercompany_transactions_status_check
    check (status in ('CREATED', 'SENT', 'IN_TRANSIT', 'DELIVERED', 'RECEIVED', 'PARTIAL', 'REJECTED', 'CLOSED'));
end $$;

-- Commercial packing relieves finished inventory. Production packaging continues
-- consuming processed material in its own module. Dispatch is only allowed after
-- the order is fully packed.
create or replace function public.trg_order_packing_relieve_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
begin
  if tg_op = 'INSERT' then
    select available_quantity into v_available
      from public.finished_inventory_lots
      where id = new.finished_inventory_lot_id
      for update;

    if v_available is null then
      raise exception 'Lote % no existe', new.finished_inventory_lot_id;
    end if;

    if v_available < new.quantity_packed then
      raise exception 'Stock insuficiente en lote %: disponible %, requerido %',
        new.finished_inventory_lot_id, v_available, new.quantity_packed;
    end if;

    update public.finished_inventory_lots
      set available_quantity = available_quantity - new.quantity_packed,
          status = case when available_quantity - new.quantity_packed <= 0 then 'agotado' else 'parcial' end,
          updated_at = now()
      where id = new.finished_inventory_lot_id;

    update public.order_items
      set quantity_packed = quantity_packed + new.quantity_packed
      where id = new.order_item_id;

    return new;
  elsif tg_op = 'DELETE' then
    update public.finished_inventory_lots
      set available_quantity = available_quantity + old.quantity_packed,
          status = case when available_quantity + old.quantity_packed > 0 then 'parcial' else status end,
          updated_at = now()
      where id = old.finished_inventory_lot_id;

    update public.order_items
      set quantity_packed = greatest(0, quantity_packed - old.quantity_packed)
      where id = old.order_item_id;

    return old;
  end if;

  return null;
end;
$$;

create or replace function public.receive_sv_purchase_order(
  p_payload jsonb,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := p_organization_id;
  v_partner public.intercompany_partners%rowtype;
  v_client_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_pp record;
  v_snapshot public.transfer_pricing_snapshots%rowtype;
  v_order_item_id uuid;
  v_total numeric(14,4) := 0;
  v_po_id text := nullif(coalesce(p_payload->>'purchase_order_id', p_payload->>'po_id', p_payload->>'id'), '');
  v_po_number text := nullif(coalesce(p_payload->>'purchase_order_number', p_payload->>'po_number', p_payload->>'number'), '');
  v_partner_code text := nullif(coalesce(p_payload->>'partner_code', p_payload->>'partner'), '');
  v_currency text := coalesce(nullif(p_payload->>'currency', ''), 'GTQ');
  v_delivery_date date := coalesce(nullif(p_payload->>'required_date', '')::date, nullif(p_payload->>'delivery_date', '')::date, current_date);
  v_notes text := nullif(p_payload->>'notes', '');
  v_items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
begin
  if v_org_id is null then
    raise exception 'organization_id es requerido';
  end if;
  if v_po_id is null and v_po_number is null then
    raise exception 'purchase_order_id o purchase_order_number es requerido';
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'La OC intercompany debe traer al menos una linea';
  end if;

  select *
    into v_partner
    from public.intercompany_partners p
    where p.organization_id = v_org_id
      and p.is_active
      and (
        (v_partner_code is not null and (p.codigo = v_partner_code or p.tax_id = v_partner_code))
        or (v_partner_code is null and p.default_client_id is not null)
      )
    order by case when v_partner_code is not null and p.codigo = v_partner_code then 0 else 1 end, p.created_at
    limit 1;

  if v_partner.id is null then
    raise exception 'No hay partner intercompany activo para la OC SV';
  end if;
  if v_partner.default_client_id is null then
    raise exception 'El partner intercompany % no tiene cliente default', v_partner.codigo;
  end if;

  v_client_id := v_partner.default_client_id;

  if v_po_id is not null then
    select id into v_order_id
      from public.orders
      where organization_id = v_org_id
        and sv_purchase_order_id = v_po_id
      limit 1;

    if v_order_id is not null then
      return jsonb_build_object('status', 'ORDER_EXISTS', 'order_id', v_order_id, 'idempotent', true);
    end if;
  end if;

  update public.clients
    set is_intercompany = true,
        intercompany_partner_id = v_partner.id,
        facturar_por_sombrilla = true,
        updated_at = now()
    where id = v_client_id;

  insert into public.orders (
    organization_id, client_id, channel, channel_reference, delivery_date,
    status, notes, total, tipo_pedido, intercompany_partner_id, es_exportacion,
    moneda, sv_purchase_order_id, sv_purchase_order_number, intercompany_source,
    intercompany_source_payload
  ) values (
    v_org_id,
    v_client_id,
    'intercompany_sv',
    coalesce(v_po_number, v_po_id),
    v_delivery_date,
    'confirmado',
    concat_ws(' ', 'OC SV', coalesce(v_po_number, v_po_id), v_notes),
    0,
    'intercompany',
    v_partner.id,
    true,
    v_currency,
    v_po_id,
    v_po_number,
    'sv_purchase_order',
    p_payload
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    select
      pp.id,
      pp.code,
      pp.display_name,
      pp.standard_cost,
      pp.producto_sombrilla_id
    into v_pp
    from public.product_presentations pp
    where pp.organization_id = v_org_id
      and pp.status = 'activo'
      and pp.code = coalesce(v_item->>'sku', v_item->>'product_sku', v_item->>'code')
    limit 1;

    if v_pp.id is null then
      raise exception 'SKU intercompany % no existe en GT', coalesce(v_item->>'sku', v_item->>'product_sku', v_item->>'code');
    end if;
    if v_pp.producto_sombrilla_id is null then
      raise exception 'SKU % no tiene producto sombrilla para facturacion intercompany', v_pp.code;
    end if;

    v_snapshot := public.calculate_transfer_price(
      v_partner.id,
      v_pp.id,
      null,
      coalesce(nullif(v_item->>'qty', '')::numeric, nullif(v_item->>'quantity', '')::numeric),
      null,
      null,
      false
    );

    insert into public.order_items (
      order_id, product_presentation_id, quantity, unit_price, subtotal,
      sv_purchase_order_line_id, intercompany_source_line_payload, transfer_pricing_snapshot_id
    ) values (
      v_order_id,
      v_pp.id,
      coalesce(nullif(v_item->>'qty', '')::numeric, nullif(v_item->>'quantity', '')::numeric),
      v_snapshot.final_price,
      v_snapshot.line_total,
      nullif(coalesce(v_item->>'line_id', v_item->>'purchase_order_line_id'), ''),
      v_item,
      v_snapshot.id
    )
    returning id into v_order_item_id;

    update public.transfer_pricing_snapshots
      set order_item_id = v_order_item_id,
          frozen = true
      where id = v_snapshot.id;

    v_total := v_total + v_snapshot.line_total;
  end loop;

  update public.orders
    set total = round(v_total, 4),
        updated_at = now()
    where id = v_order_id;

  perform public.upsert_operational_alert(
    v_org_id,
    format('Pedido intercompany creado desde OC SV %s', coalesce(v_po_number, v_po_id)),
    'El pedido ya esta en Comercial > Pedidos y listo para planificacion, produccion y empaque.',
    'info',
    'general',
    'order',
    v_order_id,
    '/pedidos',
    'Ver pedido',
    format('intercompany:sv-po:%s', coalesce(v_po_id, v_po_number)),
    jsonb_build_object(
      'purchase_order_id', v_po_id,
      'purchase_order_number', v_po_number,
      'partner_id', v_partner.id,
      'order_id', v_order_id
    )
  );

  return jsonb_build_object('status', 'ORDER_CREATED', 'order_id', v_order_id, 'idempotent', false);
end;
$$;

create or replace function public.enqueue_intercompany_delivery_confirmation(
  p_order_id uuid,
  p_delivery_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_tx public.intercompany_transactions%rowtype;
  v_event_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_item record;
begin
  select *
    into v_order
    from public.orders
    where id = p_order_id;

  if v_order.id is null then
    raise exception 'Pedido % no existe', p_order_id;
  end if;

  if coalesce(v_order.tipo_pedido, 'regular') <> 'intercompany'
     and v_order.intercompany_partner_id is null then
    return null;
  end if;

  if v_order.intercompany_delivery_event_sent_at is not null then
    select id into v_event_id
      from public.integration_events
      where event_type = 'DELIVERY_CONFIRMED'
        and transaction_id in (
          select id from public.intercompany_transactions where source_document_id = p_order_id
        )
      order by created_at desc
      limit 1;
    return v_event_id;
  end if;

  select *
    into v_tx
    from public.intercompany_transactions
    where source_document_id = p_order_id
    order by created_at desc
    limit 1;

  if v_tx.id is null then
    raise exception 'No hay transaccion intercompany de despacho para pedido %', p_order_id;
  end if;

  for v_item in
    select
      iti.product_sku,
      iti.description,
      iti.qty,
      iti.unit_cost,
      iti.transfer_price,
      coalesce(jsonb_agg(jsonb_build_object(
        'lot_id', l.source_lot_id,
        'lot_code', l.lot_code,
        'qty', l.qty,
        'expiry_date', l.expiry_date
      ) order by l.created_at) filter (where l.id is not null), '[]'::jsonb) as lots
    from public.intercompany_transaction_items iti
    left join public.intercompany_transaction_lots l on l.transaction_item_id = iti.id
    where iti.transaction_id = v_tx.id
    group by iti.id
    order by iti.created_at
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'sku', v_item.product_sku,
      'description', v_item.description,
      'qty', v_item.qty,
      'unit_cost', v_item.unit_cost,
      'transfer_price', v_item.transfer_price,
      'lots', v_item.lots
    ));
  end loop;

  insert into public.integration_events (
    transaction_id, event_type, payload, status
  ) values (
    v_tx.id,
    'DELIVERY_CONFIRMED',
    jsonb_build_object(
      'transaction_code', v_tx.transaction_code,
      'order_id', p_order_id,
      'delivery_id', p_delivery_id,
      'dispatch_id', v_tx.source_document_id,
      'currency', v_tx.currency,
      'freight_cost', v_tx.freight_cost,
      'insurance_cost', v_tx.insurance_cost,
      'logistics_cost_total', v_tx.logistics_cost_total,
      'items', v_items
    ),
    'pending'
  )
  on conflict (transaction_id, event_type) do update
    set payload = excluded.payload,
        status = case when integration_events.status = 'sent' then integration_events.status else 'pending' end,
        updated_at = now()
  returning id into v_event_id;

  update public.intercompany_transactions
    set status = 'DELIVERED',
        updated_at = now()
    where id = v_tx.id;

  update public.orders
    set intercompany_delivery_event_sent_at = now(),
        updated_at = now()
    where id = p_order_id;

  return v_event_id;
end;
$$;

create or replace function public.receive_sv_intercompany_claim(
  p_payload jsonb,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := p_organization_id;
  v_claim_id uuid;
  v_existing_id uuid;
  v_order_id uuid := nullif(p_payload->>'gt_order_id', '')::uuid;
  v_order_number bigint;
  v_claim_type text := coalesce(nullif(p_payload->>'claim_type', ''), 'cantidad');
  v_description text := coalesce(nullif(p_payload->>'description', ''), 'Reclamo intercompany recibido desde SV');
  v_external_claim_id text := nullif(coalesce(p_payload->>'claim_id', p_payload->>'sv_claim_id'), '');
  v_item jsonb;
  v_order_item record;
  v_amount numeric(14,4) := 0;
  v_cost_amount numeric(14,4) := 0;
begin
  if v_org_id is null then
    raise exception 'organization_id es requerido';
  end if;

  if v_order_id is null and nullif(p_payload->>'gt_order_number', '') is not null then
    v_order_number := (p_payload->>'gt_order_number')::bigint;
    select id into v_order_id
      from public.orders
      where organization_id = v_org_id
        and order_number = v_order_number
      limit 1;
  end if;

  if v_order_id is null then
    raise exception 'gt_order_id o gt_order_number es requerido para reclamo SV';
  end if;

  if v_external_claim_id is not null then
    select id into v_existing_id
      from public.order_claims
      where organization_id = v_org_id
        and intercompany_source_payload->>'claim_id' = v_external_claim_id
      limit 1;
    if v_existing_id is not null then
      return jsonb_build_object('status', 'CLAIM_EXISTS', 'claim_id', v_existing_id, 'idempotent', true);
    end if;
  end if;

  insert into public.order_claims (
    organization_id, order_id, claim_type, description, amount, cost_amount,
    intercompany_source_payload
  ) values (
    v_org_id,
    v_order_id,
    case when v_claim_type in ('calidad', 'problema_entrega', 'cantidad') then v_claim_type else 'cantidad' end,
    v_description,
    0,
    0,
    p_payload
  )
  returning id into v_claim_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    select
      oi.id,
      oi.product_presentation_id,
      oi.unit_price,
      pp.standard_cost
    into v_order_item
    from public.order_items oi
    join public.product_presentations pp on pp.id = oi.product_presentation_id
    where oi.order_id = v_order_id
      and (
        oi.id::text = coalesce(v_item->>'gt_order_item_id', '')
        or pp.code = coalesce(v_item->>'sku', v_item->>'product_sku', '')
      )
    limit 1;

    if v_order_item.id is null then
      raise exception 'No se encontro linea GT para reclamo SKU %', coalesce(v_item->>'sku', v_item->>'product_sku', v_item->>'gt_order_item_id');
    end if;

    insert into public.order_claim_items (
      claim_id, order_item_id, product_presentation_id, quantity,
      unit_price, standard_cost, amount, sale_loss_potential
    ) values (
      v_claim_id,
      v_order_item.id,
      v_order_item.product_presentation_id,
      coalesce(nullif(v_item->>'qty', '')::numeric, nullif(v_item->>'quantity', '')::numeric, 0),
      coalesce(nullif(v_item->>'unit_price', '')::numeric, v_order_item.unit_price, 0),
      coalesce(v_order_item.standard_cost, 0),
      coalesce(nullif(v_item->>'qty', '')::numeric, nullif(v_item->>'quantity', '')::numeric, 0) * coalesce(nullif(v_item->>'unit_price', '')::numeric, v_order_item.unit_price, 0),
      coalesce(nullif(v_item->>'qty', '')::numeric, nullif(v_item->>'quantity', '')::numeric, 0) * coalesce(nullif(v_item->>'unit_price', '')::numeric, v_order_item.unit_price, 0)
    );

    v_amount := v_amount + coalesce(nullif(v_item->>'qty', '')::numeric, nullif(v_item->>'quantity', '')::numeric, 0) * coalesce(nullif(v_item->>'unit_price', '')::numeric, v_order_item.unit_price, 0);
    v_cost_amount := v_cost_amount + coalesce(nullif(v_item->>'qty', '')::numeric, nullif(v_item->>'quantity', '')::numeric, 0) * coalesce(v_order_item.standard_cost, 0);
  end loop;

  update public.order_claims
    set amount = v_amount,
        cost_amount = v_cost_amount,
        updated_at = now()
    where id = v_claim_id;

  update public.orders
    set status = 'reclamado',
        updated_at = now()
    where id = v_order_id;

  perform public.upsert_operational_alert(
    v_org_id,
    'Reclamo intercompany recibido desde SV',
    v_description,
    'warning',
    'general',
    'claim',
    v_claim_id,
    '/reclamos',
    'Ver reclamo',
    format('intercompany:sv-claim:%s', coalesce(v_external_claim_id, v_claim_id::text)),
    jsonb_build_object('claim_id', v_claim_id, 'order_id', v_order_id, 'source', 'SV')
  );

  return jsonb_build_object('status', 'CLAIM_CREATED', 'claim_id', v_claim_id, 'idempotent', false);
end;
$$;

grant execute on function public.receive_sv_purchase_order(jsonb, uuid) to service_role;
grant execute on function public.enqueue_intercompany_delivery_confirmation(uuid, uuid) to authenticated, service_role;
grant execute on function public.receive_sv_intercompany_claim(jsonb, uuid) to service_role;
