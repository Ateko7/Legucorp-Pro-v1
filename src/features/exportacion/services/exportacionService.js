import { supabase } from '../../../lib/supabase'

function n(v) { return Number(v || 0) }

function toKg(qty, unit) {
  if (!qty) return 0
  const q = n(qty)
  switch ((unit || '').toLowerCase()) {
    case 'oz':  return q / 35.274
    case 'g':   return q / 1000
    case 'lb':  return q / 2.20462
    default:    return q   // kg or unknown
  }
}

async function getAuth() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('profiles')
    .select('organization_id, id')
    .eq('id', user.id)
    .single()
  return { orgId: data.organization_id, userId: data.id }
}

// ─── Facturas CRUD ────────────────────────────────────────────────────────────

export async function getFacturasExportacion(filtros = {}) {
  const { orgId } = await getAuth()
  let q = supabase
    .from('facturas_exportacion')
    .select(`
      *,
      clients(id, commercial_name, legal_name, pais),
      orders(id, order_number),
      facturas_exportacion_lineas(
        id, descripcion_factura, total_kg, precio_usd_kg, total_usd, sort_order,
        productos_sombrilla(id, nombre, codigo, codigo_arancelario)
      )
    `)
    .eq('organization_id', orgId)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })

  if (filtros.status) q = q.eq('status', filtros.status)
  if (filtros.desde)  q = q.gte('fecha', filtros.desde)
  if (filtros.hasta)  q = q.lte('fecha', filtros.hasta)
  if (filtros.limit)  q = q.limit(filtros.limit)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function getFacturaById(id) {
  const { data, error } = await supabase
    .from('facturas_exportacion')
    .select(`
      *,
      clients(id, commercial_name, legal_name, pais, main_address),
      orders(id, order_number),
      facturas_exportacion_lineas(
        id, descripcion_factura, total_kg, precio_usd_kg, total_usd, sort_order,
        productos_sombrilla(id, nombre, codigo, codigo_arancelario, unidad_facturacion),
        facturas_exportacion_desglose(
          id, product_presentation_id, cantidad, unidad, peso_kg, valor_usd,
          product_presentations(id, code, display_name)
        )
      )
    `)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function emitirFactura(id, numero) {
  const { data, error } = await supabase
    .from('facturas_exportacion')
    .update({ status: 'emitida', numero, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function anularFactura(id) {
  const { data, error } = await supabase
    .from('facturas_exportacion')
    .update({ status: 'anulada', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Consolidation engine ─────────────────────────────────────────────────────
//
// Groups order_items by producto_sombrilla_id.
// For each group: sum kg (from peso_neto_kg override or net_weight+unit conversion)
// and sum USD value (converting from order's moneda via tipo_cambio).
// precio_usd_kg = total_usd / total_kg — computed dynamically per order.

export async function previewConsolidacion(orderId) {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_number, moneda, tipo_cambio, total_amount, clients(id, commercial_name, legal_name, pais, moneda_default)')
    .eq('id', orderId)
    .single()
  if (orderErr) throw new Error(orderErr.message)

  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select(`
      id, quantity, unit_price, subtotal, unit,
      product_presentations(
        id, code, display_name, net_weight, unit, peso_neto_kg,
        producto_sombrilla_id,
        productos_sombrilla(id, nombre, codigo, codigo_arancelario, unidad_facturacion, descripcion_factura)
      )
    `)
    .eq('order_id', orderId)
  if (itemsErr) throw new Error(itemsErr.message)

  const tc = n(order.tipo_cambio) || 1
  const moneda = order.moneda || 'GTQ'

  const grupos = {}
  const sinSombrilla = []

  for (const item of (items || [])) {
    const pp = item.product_presentations
    if (!pp) continue

    const pesoUnitKg = n(pp.peso_neto_kg) > 0
      ? n(pp.peso_neto_kg)
      : toKg(n(pp.net_weight), pp.unit)
    const pesoTotalKg = pesoUnitKg * n(item.quantity)
    const totalPrecio = n(item.subtotal) || (n(item.unit_price) * n(item.quantity))
    const valorUsd = moneda === 'USD' ? totalPrecio : (tc > 0 ? totalPrecio / tc : 0)

    const sombraId = pp.producto_sombrilla_id
    if (!sombraId) {
      sinSombrilla.push({ item, pp, pesoTotalKg, valorUsd })
      continue
    }

    if (!grupos[sombraId]) {
      grupos[sombraId] = { sombrilla: pp.productos_sombrilla, total_kg: 0, total_usd: 0, items: [] }
    }
    grupos[sombraId].total_kg  += pesoTotalKg
    grupos[sombraId].total_usd += valorUsd
    grupos[sombraId].items.push({ item, pp, pesoTotalKg, valorUsd })
  }

  const lineas = Object.values(grupos).map((g, i) => ({
    sombrilla:    g.sombrilla,
    total_kg:     Math.round(g.total_kg  * 10000) / 10000,
    total_usd:    Math.round(g.total_usd * 10000) / 10000,
    precio_usd_kg: g.total_kg > 0
      ? Math.round((g.total_usd / g.total_kg) * 1000000) / 1000000
      : 0,
    sort_order: i,
    items: g.items,
  }))

  const total_usd = lineas.reduce((s, l) => s + l.total_usd, 0)
  const total_kg  = lineas.reduce((s, l) => s + l.total_kg,  0)

  return {
    order,
    lineas,
    sinSombrilla,
    total_usd:  Math.round(total_usd * 100) / 100,
    total_kg:   Math.round(total_kg  * 10000) / 10000,
    moneda,
    tipo_cambio: tc,
    advertencias: sinSombrilla.length > 0
      ? [`${sinSombrilla.length} SKU(s) sin producto sombrilla asignado — no se incluirán en la factura`]
      : [],
  }
}

export async function generarFactura(orderId, opciones = {}) {
  const { orgId, userId } = await getAuth()
  const preview = await previewConsolidacion(orderId)

  if (preview.lineas.length === 0) {
    throw new Error('No hay líneas consolidables. Asegúrese de que los SKUs tengan producto sombrilla asignado.')
  }

  const { data: factura, error: factErr } = await supabase
    .from('facturas_exportacion')
    .insert({
      organization_id: orgId,
      order_id:        orderId,
      client_id:       preview.order.clients?.id || null,
      fecha:           opciones.fecha || new Date().toISOString().slice(0, 10),
      moneda:          'USD',
      tipo_cambio:     preview.tipo_cambio,
      total_usd:       preview.total_usd,
      total_kg:        preview.total_kg,
      status:          'borrador',
      observaciones:   opciones.observaciones || null,
      created_by:      userId,
    })
    .select()
    .single()
  if (factErr) throw new Error(factErr.message)

  const facturaId = factura.id

  for (const linea of preview.lineas) {
    const { data: lineaRow, error: lineaErr } = await supabase
      .from('facturas_exportacion_lineas')
      .insert({
        factura_id:            facturaId,
        producto_sombrilla_id: linea.sombrilla?.id || null,
        descripcion_factura:   linea.sombrilla?.descripcion_factura || linea.sombrilla?.nombre || '',
        total_kg:              linea.total_kg,
        precio_usd_kg:         linea.precio_usd_kg,
        total_usd:             linea.total_usd,
        sort_order:            linea.sort_order,
      })
      .select()
      .single()
    if (lineaErr) throw new Error(lineaErr.message)

    const desgloses = linea.items.map(d => ({
      factura_id:              facturaId,
      linea_id:                lineaRow.id,
      order_item_id:           d.item.id,
      product_presentation_id: d.pp.id,
      cantidad:                d.item.quantity,
      unidad:                  d.item.unit || d.pp.unit,
      peso_kg:                 d.pesoTotalKg,
      valor_usd:               d.valorUsd,
    }))
    if (desgloses.length > 0) {
      const { error: desErr } = await supabase
        .from('facturas_exportacion_desglose')
        .insert(desgloses)
      if (desErr) throw new Error(desErr.message)
    }
  }

  return getFacturaById(facturaId)
}

// Check if order already has an active factura
export async function getFacturaPorPedido(orderId) {
  const { data } = await supabase
    .from('facturas_exportacion')
    .select('id, numero, status, fecha, total_usd, total_kg')
    .eq('order_id', orderId)
    .neq('status', 'anulada')
    .maybeSingle()
  return data || null
}
