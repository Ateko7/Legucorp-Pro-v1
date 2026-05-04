import { supabase } from '../../../lib/supabase'

// ─── Constantes ──────────────────────────────────────────────────────────────

export const ORDER_STATUS = {
  CONFIRMADO:    'confirmado',
  EMPACADO:      'empacado',
  DESPACHADO:    'despachado',
  FACTURADO:     'facturado',
  EN_LOGISTICA:  'en_logistica',
  ENTREGADO:     'entregado',
  COBRADO:       'cobrado',
  CANCELADO:     'cancelado',
}

// WhatsApp-ready: channel identifica el origen del pedido
export const ORDER_CHANNEL = {
  MANUAL:      'manual',
  WHATSAPP:    'whatsapp',
  WEB:         'web',
  REPOSICION:  'reposicion',
}

export const STATUS_LABEL = {
  confirmado:   'Confirmado',
  empacado:     'Empacado',
  despachado:   'Despachado',
  facturado:    'Facturado',
  en_logistica: 'En logística',
  entregado:    'Entregado',
  cobrado:      'Cobrado',
}

export const STATUS_FLOW = [
  'confirmado', 'empacado', 'despachado', 'facturado', 'en_logistica', 'entregado', 'cobrado',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()
  if (error) throw new Error(error.message)
  return profile
}

function n(v) {
  const x = Number(v)
  return isNaN(x) ? 0 : x
}

function isIntercompanyOrder(order) {
  return order?.tipo_pedido === 'intercompany' ||
    !!order?.intercompany_partner_id ||
    !!order?.clients?.is_intercompany ||
    !!order?.clients?.intercompany_partner_id
}

function buildIntercompanyDispatchPayload(order, newTotal, costs = {}) {
  const items = order.order_items || []
  const packings = order.order_packings || []
  const freightCost = n(costs.freight_cost)
  const insuranceCost = n(costs.insurance_cost)

  const payloadItems = items.map((item) => {
    const itemPackings = packings.filter((packing) => packing.order_item_id === item.id)
    if (itemPackings.length === 0) {
      throw new Error(`El item ${item.product_presentations?.code || item.id} no tiene lotes empacados`)
    }

    const qty = itemPackings.reduce((sum, packing) => sum + n(packing.quantity_packed), 0)
    if (qty <= 0) {
      throw new Error(`El item ${item.product_presentations?.code || item.id} no tiene cantidad empacada`)
    }

    const weightedCost = itemPackings.reduce((sum, packing) => {
      const lot = packing.finished_inventory_lots
      const unitCost = n(lot?.unit_cost) || n(item.product_presentations?.standard_cost)
      return sum + n(packing.quantity_packed) * unitCost
    }, 0) / qty

    return {
      source_line_id: item.id,
      sku: item.product_presentations?.code,
      description: item.product_presentations?.display_name,
      qty,
      unit_cost: weightedCost,
      lots: itemPackings.map((packing) => {
        const lot = packing.finished_inventory_lots
        return {
          lot_id: lot?.id,
          lot_code: lot?.finished_lot_code || lot?.id,
          qty: n(packing.quantity_packed),
          expiry_date: lot?.expiration_date || null,
        }
      }),
    }
  })

  if (payloadItems.some((item) => !item.sku)) {
    throw new Error('Todos los productos intercompany deben tener SKU/codigo de presentacion')
  }

  return {
    currency: order.moneda || order.clients?.moneda_default || 'GTQ',
    freight_cost: freightCost,
    insurance_cost: insuranceCost,
    logistics_cost_total: freightCost + insuranceCost,
    invoice_data: {
      order_id: order.id,
      order_number: order.order_number,
      fel_document_id: order.fel_document_id || null,
      customer_name: order.clients?.commercial_name || null,
      customer_nit: order.clients?.nit || null,
      total: newTotal,
    },
    items: payloadItems,
  }
}

// ─── Clientes ────────────────────────────────────────────────────────────────

function assertOrderIsPacked(order) {
  const items = order?.order_items || []
  if (!items.length) throw new Error('El pedido no tiene lineas para despachar')

  const pendingItems = items.filter((item) => n(item.quantity_packed) < n(item.quantity))
  if (pendingItems.length) {
    throw new Error('No se puede despachar: el pedido debe estar completamente empacado')
  }
}

export async function getClients() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('clients')
    .select('id, commercial_name, legal_name, nit, main_address, phone, email, credit_days, es_exportacion, facturar_por_sombrilla, moneda_default, pais, is_intercompany, intercompany_partner_id')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'activo')
    .order('commercial_name')
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Productos / Presentaciones ───────────────────────────────────────────────

export async function getPresentations() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('product_presentations')
    .select('id, code, display_name, net_weight, unit, suggested_price, standard_cost')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'activo')
    .order('display_name')
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Inventario disponible por presentación ───────────────────────────────────

export async function getInventoryByPresentation() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('finished_inventory_lots')
    .select('id, product_presentation_id, finished_lot_code, available_quantity, unit, expiration_date, location')
    .eq('organization_id', profile.organization_id)
    .in('status', ['disponible', 'parcial'])
    .order('expiration_date', { ascending: true })
  if (error) throw new Error(error.message)

  // Filtrar quantity > 0 en JS para evitar problemas de tipo con PostgREST
  const lots = (data || []).filter((l) => Number(l.available_quantity) > 0)

  // Agrupar por presentación → { [presentationId]: [lots] }
  return lots.reduce((acc, lot) => {
    const key = lot.product_presentation_id
    if (!acc[key]) acc[key] = []
    acc[key].push(lot)
    return acc
  }, {})
}

// ─── Pedidos (queue) ──────────────────────────────────────────────────────────

export async function getOrders() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, delivery_date, status, total, channel, notes, created_at,
      clients ( id, commercial_name, nit, main_address, phone ),
      order_items ( id, product_presentation_id, quantity, unit_price, quantity_packed, subtotal )
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Pedido detalle ───────────────────────────────────────────────────────────

export async function getOrderById(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, delivery_date, status, total, channel, channel_reference, notes, created_at, updated_at, moneda, tipo_cambio, es_exportacion, tipo_pedido, intercompany_partner_id, fel_document_id,
      clients ( id, commercial_name, legal_name, nit, main_address, phone, email, credit_days, facturar_por_sombrilla, pais, moneda_default, is_intercompany, intercompany_partner_id ),
      fel_documents ( id, tipo_documento, serie, numero, dte_uuid, estado_fel, total, fecha_emision ),
      order_items (
        id, product_presentation_id, quantity, unit_price, subtotal, quantity_packed,
        product_presentations ( id, code, display_name, net_weight, unit, standard_cost )
      ),
      order_packings (
        id, quantity_packed, packed_at,
        order_item_id,
        finished_inventory_lots ( id, finished_lot_code, available_quantity, expiration_date, unit_cost )
      )
    `)
    .eq('id', orderId)
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Crear pedido ─────────────────────────────────────────────────────────────

export async function createOrder({ clientId, deliveryDate, notes, items, channel = 'manual', channelReference = null, moneda = 'GTQ', tipoCambio = null, esExportacion = false }) {
  const profile = await getProfile()

  if (!clientId) throw new Error('Cliente requerido')
  if (!deliveryDate) throw new Error('Fecha de entrega requerida')
  if (!items?.length) throw new Error('El pedido debe tener al menos un producto')

  const total = items.reduce((acc, i) => acc + n(i.unit_price) * n(i.quantity), 0)

  // Asignar CC-02 (Comercial) automáticamente
  const { data: ccComercial } = await supabase
    .from('cost_centers')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('code', 'CC-02')
    .eq('is_active', true)
    .maybeSingle()

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      organization_id: profile.organization_id,
      client_id: clientId,
      delivery_date: deliveryDate,
      status: ORDER_STATUS.CONFIRMADO,
      notes: notes || null,
      total,
      channel,
      channel_reference: channelReference,
      created_by: profile.id,
      cost_center_id: ccComercial?.id || null,
      moneda,
      tipo_cambio:    tipoCambio ? Number(tipoCambio) : null,
      es_exportacion: esExportacion,
    })
    .select()
    .single()
  if (orderError) throw new Error(orderError.message)

  const itemsPayload = items.map((i) => ({
    order_id: order.id,
    product_presentation_id: i.product_presentation_id,
    quantity: n(i.quantity),
    unit_price: n(i.unit_price),
    subtotal: n(i.quantity) * n(i.unit_price),
  }))

  const { error: itemsError } = await supabase.from('order_items').insert(itemsPayload)
  if (itemsError) throw new Error(itemsError.message)

  return order
}

// ─── Actualizar cabecera del pedido ───────────────────────────────────────────

export async function updateOrder(orderId, { deliveryDate, notes, items }) {
  const { error: orderError } = await supabase
    .from('orders')
    .update({ delivery_date: deliveryDate, notes: notes || null })
    .eq('id', orderId)
  if (orderError) throw new Error(orderError.message)

  if (items) {
    // Borrar items existentes y reinsertar
    const { error: delError } = await supabase
      .from('order_items')
      .delete()
      .eq('order_id', orderId)
    if (delError) throw new Error(delError.message)

    const total = items.reduce((acc, i) => acc + n(i.unit_price) * n(i.quantity), 0)

    const itemsPayload = items.map((i) => ({
      order_id: orderId,
      product_presentation_id: i.product_presentation_id,
      quantity: n(i.quantity),
      unit_price: n(i.unit_price),
      subtotal: n(i.quantity) * n(i.unit_price),
    }))

    const { error: itemsError } = await supabase.from('order_items').insert(itemsPayload)
    if (itemsError) throw new Error(itemsError.message)

    await supabase.from('orders').update({ total }).eq('id', orderId)
  }
}

// ─── Empacar ítem desde inventario (multi-lote) ──────────────────────────────
// lotAssignments: [{ finishedLotId, quantity }]

export async function packOrderItem({ orderId, orderItemId, lotAssignments }) {
  if (!lotAssignments?.length) throw new Error('Selecciona al menos un lote')
  const totalQty = lotAssignments.reduce((acc, l) => acc + n(l.quantity), 0)
  if (totalQty <= 0) throw new Error('La cantidad a empacar debe ser mayor a 0')

  const profile = await getProfile()

  for (const { finishedLotId, quantity } of lotAssignments) {
    const qty = n(quantity)
    if (qty <= 0) continue

    // Verificar disponibilidad
    const { data: lot, error: lotError } = await supabase
      .from('finished_inventory_lots')
      .select('id, available_quantity')
      .eq('id', finishedLotId)
      .single()
    if (lotError) throw new Error(lotError.message)
    if (n(lot.available_quantity) < qty) throw new Error(`Lote sin suficiente inventario (disponible: ${n(lot.available_quantity)})`)

    // Registrar packing
    const { error: packError } = await supabase.from('order_packings').insert({
      order_id: orderId,
      order_item_id: orderItemId,
      finished_inventory_lot_id: finishedLotId,
      quantity_packed: qty,
      packed_by: profile.id,
    })
    if (packError) throw new Error(packError.message)
  }

  // Si todos los ítems están completamente empacados → status empacado
  const { data: allItems } = await supabase
    .from('order_items')
    .select('quantity, quantity_packed')
    .eq('order_id', orderId)
  const allPacked = allItems?.every((i) => n(i.quantity_packed) >= n(i.quantity))
  if (allPacked) {
    await supabase.from('orders').update({ status: ORDER_STATUS.EMPACADO }).eq('id', orderId)
  }
}

// ─── Despachar pedido (recalcula total por cantidad empacada real) ─────────────

export async function dispatchOrder(orderId, costs = {}) {
  const order = await getOrderById(orderId)
  assertOrderIsPacked(order)

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('quantity_packed, unit_price')
    .eq('order_id', orderId)
  if (itemsError) throw new Error(itemsError.message)

  const newTotal = (items || []).reduce(
    (acc, i) => acc + n(i.quantity_packed) * n(i.unit_price), 0
  )

  const { error } = await supabase
    .from('orders')
    .update({ status: ORDER_STATUS.DESPACHADO, total: newTotal })
    .eq('id', orderId)
  if (error) throw new Error(error.message)

  if (isIntercompanyOrder(order)) {
    const profile = await getProfile()
    const payload = buildIntercompanyDispatchPayload(order, newTotal, costs)
    const { error: bridgeError } = await supabase.rpc('create_intercompany_dispatch_event', {
      p_dispatch_id: orderId,
      p_payload: payload,
      p_source_company: 'GT',
      p_target_company: 'SV',
      p_organization_id: profile.organization_id,
    })

    if (bridgeError) throw new Error(bridgeError.message || 'No se pudo crear el evento intercompany')
  }
}

// ─── Actualizar estado del pedido ─────────────────────────────────────────────

export async function updateOrderStatus(orderId, status) {
  const { error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
  if (error) throw new Error(error.message)
}

export async function facturarOrder(orderId) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('Sesion no disponible. Vuelve a iniciar sesion antes de facturar.')
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  const res = await fetch(`${supabaseUrl}/functions/v1/certify-fel-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ order_id: orderId }),
  })

  let data = {}
  try {
    data = await res.json()
  } catch {
    data = { error: await res.text() }
  }

  if (!res.ok) throw new Error(data?.error || `Error ${res.status} al certificar la factura FEL`)
  if (data?.error) throw new Error(data.error)

  return data
}

// ─── Generar PDF (datos) ──────────────────────────────────────────────────────
// Retorna los datos necesarios; la renderización se hace en el frontend

export async function getOrderPDFData(orderId) {
  return getOrderById(orderId)
}

// ─── Análisis de imagen/PDF con IA ───────────────────────────────────────────

export async function analyzeOrderImage(fileBase64, mimeType) {
  const { data: { session } } = await supabase.auth.getSession()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  const res = await fetch(`${supabaseUrl}/functions/v1/analyze-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ file_base64: fileBase64, mime_type: mimeType }),
  })

  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || `Error ${res.status} al analizar la imagen`)
  if (json?.error) throw new Error(json.error)
  return json
}

// ─── Generación de PDF en navegador ──────────────────────────────────────────

export function printOrderPDF(order) {
  const client = order.clients
  const items = order.order_items || []
  const packings = order.order_packings || []

  const rows = items.map((item) => {
    const pres = item.product_presentations
    const itemPackings = packings.filter((p) => p.order_item_id === item.id)
    const totalPacked = itemPackings.reduce((acc, p) => acc + n(p.quantity_packed), 0)
    return `
      <tr>
        <td>${pres?.code || '—'}</td>
        <td>${pres?.display_name || '—'}</td>
        <td style="text-align:right">${n(item.quantity)}</td>
        <td style="text-align:right">${totalPacked}</td>
        <td style="text-align:right">Q ${n(item.unit_price).toFixed(2)}</td>
        <td style="text-align:right">Q ${n(item.subtotal).toFixed(2)}</td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Pedido #${order.order_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; color: #1c1917; font-size: 13px; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 2px solid #2f5d50; padding-bottom: 20px; }
    .brand { font-size: 22px; font-weight: 700; color: #2f5d50; }
    .meta { text-align: right; }
    .meta h2 { font-size: 18px; font-weight: 700; color: #1c1917; }
    .meta p { color: #78716c; margin-top: 2px; font-size: 12px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #a8a29e; margin-bottom: 8px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
    .info-row { display: flex; flex-direction: column; }
    .info-label { font-size: 11px; color: #78716c; }
    .info-value { font-size: 13px; font-weight: 500; color: #1c1917; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #f5f5f4; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #78716c; border-bottom: 1px solid #e7e5e4; }
    td { padding: 9px 10px; border-bottom: 1px solid #f5f5f4; font-size: 13px; color: #1c1917; }
    .total-row { font-weight: 700; font-size: 15px; background: #f5f5f4; }
    .footer { margin-top: 40px; border-top: 1px solid #e7e5e4; padding-top: 16px; font-size: 11px; color: #a8a29e; display: flex; justify-content: space-between; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; background: #d1fae5; color: #065f46; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Legucorp Pro</div>
      <p style="color:#78716c;font-size:12px;margin-top:4px;">Documento previo a facturación</p>
    </div>
    <div class="meta">
      <h2>Pedido #${order.order_number}</h2>
      <p>Estado: <span class="status-badge">${STATUS_LABEL[order.status] || order.status}</span></p>
      <p style="margin-top:6px">Generado: ${new Date().toLocaleDateString('es-GT')}</p>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Cliente</div>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">Nombre</span><span class="info-value">${client?.commercial_name || '—'}</span></div>
      <div class="info-row"><span class="info-label">NIT</span><span class="info-value">${client?.nit || 'CF'}</span></div>
      <div class="info-row"><span class="info-label">Dirección</span><span class="info-value">${client?.main_address || '—'}</span></div>
      <div class="info-row"><span class="info-label">Entrega comprometida</span><span class="info-value">${order.delivery_date || '—'}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Detalle del pedido</div>
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Producto</th>
          <th style="text-align:right">Pedido</th>
          <th style="text-align:right">Empacado</th>
          <th style="text-align:right">Precio unit.</th>
          <th style="text-align:right">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td colspan="5" style="text-align:right">TOTAL</td>
          <td style="text-align:right">Q ${n(order.total).toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${order.notes ? `<div class="section"><div class="section-title">Notas</div><p>${order.notes}</p></div>` : ''}

  <div class="footer">
    <span>Pedido #${order.order_number} · Canal: ${order.channel || 'manual'}</span>
    <span>Legucorp Pro ERP · ${new Date().toLocaleString('es-GT')}</span>
  </div>
</body>
</html>`

  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}
