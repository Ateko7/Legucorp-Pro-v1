import { supabase } from '../../../lib/supabase'

function n(v) { return Number(v || 0) }

function toKg(qty, unit) {
  if (!qty) return 0
  const q = n(qty)
  switch ((unit || '').toLowerCase()) {
    case 'oz':  return q / 35.274
    case 'g':   return q / 1000
    case 'lb':  return q / 2.20462
    default:    return q
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

// ─── Shared item-fetch helper ─────────────────────────────────────────────────

async function fetchOrderItems(orderId) {
  const { data, error } = await supabase
    .from('order_items')
    .select(`
      id, quantity, unit_price, subtotal,
      product_presentations(
        id, code, display_name, net_weight, unit, peso_neto_kg,
        producto_sombrilla_id,
        productos_sombrilla(id, nombre, codigo, codigo_arancelario, unidad_facturacion, descripcion_factura)
      )
    `)
    .eq('order_id', orderId)
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Consolidation core (pure) ────────────────────────────────────────────────
// tc: tipo de cambio GTQ→USD (e.g. 7.75 means 1 USD = 7.75 GTQ)
// moneda: 'GTQ' | 'USD' — the currency of the order prices

function consolidar(items, tc, moneda) {
  const grupos = {}
  const sinSombrilla = []

  for (const item of items) {
    const pp = item.product_presentations
    if (!pp) continue

    const pesoUnitKg = n(pp.peso_neto_kg) > 0
      ? n(pp.peso_neto_kg)
      : toKg(n(pp.net_weight), pp.unit)
    const pesoTotalKg = pesoUnitKg * n(item.quantity)
    const totalPrecio = n(item.subtotal) || (n(item.unit_price) * n(item.quantity))
    const valorUsd = moneda === 'USD' ? totalPrecio : (tc > 0 ? totalPrecio / tc : 0)

    if (!pp.producto_sombrilla_id) {
      sinSombrilla.push({ item, pp, pesoTotalKg, valorUsd })
      continue
    }

    if (!grupos[pp.producto_sombrilla_id]) {
      grupos[pp.producto_sombrilla_id] = {
        sombrilla: pp.productos_sombrilla,
        total_kg: 0, total_usd: 0, items: [],
      }
    }
    grupos[pp.producto_sombrilla_id].total_kg  += pesoTotalKg
    grupos[pp.producto_sombrilla_id].total_usd += valorUsd
    grupos[pp.producto_sombrilla_id].items.push({ item, pp, pesoTotalKg, valorUsd })
  }

  const lineas = Object.values(grupos).map((g, i) => ({
    sombrilla:     g.sombrilla,
    total_kg:      Math.round(g.total_kg  * 10000) / 10000,
    total_usd:     Math.round(g.total_usd * 10000) / 10000,
    precio_usd_kg: g.total_kg > 0
      ? Math.round((g.total_usd / g.total_kg) * 1000000) / 1000000
      : 0,
    sort_order: i,
    items: g.items,
  }))

  const total_usd = lineas.reduce((s, l) => s + l.total_usd, 0)
  const total_kg  = lineas.reduce((s, l) => s + l.total_kg,  0)

  return {
    lineas,
    sinSombrilla,
    total_usd:  Math.round(total_usd * 100) / 100,
    total_kg:   Math.round(total_kg  * 10000) / 10000,
    advertencias: sinSombrilla.length > 0
      ? [`${sinSombrilla.length} SKU(s) sin producto sombrilla — no se incluirán en la factura`]
      : [],
  }
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

// ─── Preview (before generating) ─────────────────────────────────────────────
// tipoCambioOverride: if provided, overrides the order's tipo_cambio

export async function previewConsolidacion(orderId, tipoCambioOverride = null) {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_number, moneda, tipo_cambio, total, clients(id, commercial_name, legal_name, pais, moneda_default)')
    .eq('id', orderId)
    .single()
  if (orderErr) throw new Error(orderErr.message)

  const items = await fetchOrderItems(orderId)
  const moneda = order.moneda || 'GTQ'
  const tc = tipoCambioOverride != null
    ? n(tipoCambioOverride)
    : (n(order.tipo_cambio) || 0)

  const result = consolidar(items, tc, moneda)

  return {
    order,
    ...result,
    moneda,
    tipo_cambio: tc,
  }
}

// ─── Generate factura (borrador) ──────────────────────────────────────────────

export async function generarFactura(orderId, opciones = {}) {
  const { orgId, userId } = await getAuth()

  const tipoCambio = opciones.tipoCambio != null ? n(opciones.tipoCambio) : null
  const preview = await previewConsolidacion(orderId, tipoCambio)

  if (preview.lineas.length === 0) {
    throw new Error('No hay líneas consolidables. Asegúrese de que los SKUs tengan producto sombrilla asignado y que el tipo de cambio sea mayor a 0.')
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

  await _insertLineasYDesgloses(factura.id, preview.lineas)
  return getFacturaById(factura.id)
}

// ─── Recalcular factura con nuevo tipo de cambio ──────────────────────────────
// Works for any status — deletes existing lines and recreates with new tc.

export async function recalcularFactura(facturaId, nuevoTipoCambio) {
  const tc = n(nuevoTipoCambio)
  if (tc <= 0) throw new Error('El tipo de cambio debe ser mayor a 0')

  // Load factura to get order_id
  const { data: factura, error: fErr } = await supabase
    .from('facturas_exportacion')
    .select('id, order_id, moneda')
    .eq('id', facturaId)
    .single()
  if (fErr) throw new Error(fErr.message)

  // Get order moneda
  const { data: order, error: oErr } = await supabase
    .from('orders')
    .select('moneda')
    .eq('id', factura.order_id)
    .single()
  if (oErr) throw new Error(oErr.message)

  const items = await fetchOrderItems(factura.order_id)
  const moneda = order.moneda || 'GTQ'
  const result = consolidar(items, tc, moneda)

  if (result.lineas.length === 0) {
    throw new Error('No hay líneas consolidables con el tipo de cambio indicado.')
  }

  // Delete existing lines (cascade deletes desgloses)
  const { error: delErr } = await supabase
    .from('facturas_exportacion_lineas')
    .delete()
    .eq('factura_id', facturaId)
  if (delErr) throw new Error(delErr.message)

  // Update header
  const { error: updErr } = await supabase
    .from('facturas_exportacion')
    .update({
      tipo_cambio: tc,
      total_usd:   result.total_usd,
      total_kg:    result.total_kg,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', facturaId)
  if (updErr) throw new Error(updErr.message)

  await _insertLineasYDesgloses(facturaId, result.lineas)
  return getFacturaById(facturaId)
}

// ─── Internal helper ──────────────────────────────────────────────────────────

async function _insertLineasYDesgloses(facturaId, lineas) {
  for (const linea of lineas) {
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
      unidad:                  d.pp.unit || null,
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
}

// ─── Check if order already has an active factura ─────────────────────────────

export async function getFacturaPorPedido(orderId) {
  const { data } = await supabase
    .from('facturas_exportacion')
    .select('id, numero, status, fecha, total_usd, total_kg')
    .eq('order_id', orderId)
    .neq('status', 'anulada')
    .maybeSingle()
  return data || null
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export function printFacturaPDF(factura) {
  const lineas = (factura.facturas_exportacion_lineas || [])
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const fmt = (v, d = 2) =>
    Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

  const cliente = factura.clients?.commercial_name || factura.clients?.legal_name || '—'
  const pais    = factura.clients?.pais || ''
  const numero  = factura.numero || 'BORRADOR'
  const fecha   = factura.fecha || ''
  const tc      = factura.tipo_cambio ? `Q${fmt(factura.tipo_cambio, 2)} / USD` : '—'

  const lineasHtml = lineas.map(l => `
    <tr>
      <td>${l.descripcion_factura || '—'}</td>
      <td>${l.productos_sombrilla?.codigo_arancelario || '—'}</td>
      <td class="num">${fmt(l.total_kg, 2)}</td>
      <td class="num">${fmt(l.precio_usd_kg, 2)}</td>
      <td class="num">$${fmt(l.total_usd)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Factura Exportación ${numero}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #1a1a1a; padding: 32px; }
  h1 { font-size: 18pt; font-weight: bold; margin-bottom: 2px; }
  .subtitle { color: #555; font-size: 10pt; margin-bottom: 24px; }
  .header-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .label { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
  .value { font-size: 11pt; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10pt; }
  th { background: #2f5d50; color: white; padding: 8px 10px; text-align: left; font-size: 9pt; }
  th.num, td.num { text-align: right; }
  td { padding: 7px 10px; border-bottom: 1px solid #e5e5e5; }
  tr:last-child td { border-bottom: none; }
  .total-row td { font-weight: bold; background: #f5f5f5; border-top: 2px solid #2f5d50; }
  .footer { margin-top: 32px; border-top: 1px solid #ddd; padding-top: 12px; font-size: 9pt; color: #888; display: flex; justify-content: space-between; }
  .badge { display: inline-block; background: #2f5d50; color: white; padding: 2px 10px; border-radius: 20px; font-size: 9pt; margin-bottom: 16px; }
  .nota { margin-top: 16px; font-size: 9pt; color: #555; border: 1px solid #ddd; padding: 8px 12px; border-radius: 6px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <h1>Factura de Exportación</h1>
  <div class="subtitle">Legucorp Pro — Exportaciones</div>
  <span class="badge">${numero}</span>

  <div class="header-grid">
    <div>
      <div class="label">Cliente / Consignatario</div>
      <div class="value">${cliente}</div>
      ${pais ? `<div style="color:#555;font-size:10pt;margin-top:2px">${pais}</div>` : ''}
    </div>
    <div>
      <div class="label">Fecha</div>
      <div class="value">${fecha}</div>
    </div>
    <div>
      <div class="label">Pedido de origen</div>
      <div class="value">${factura.orders?.order_number || '—'}</div>
    </div>
    <div>
      <div class="label">Tipo de cambio</div>
      <div class="value">${tc}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Descripción / Producto</th>
        <th>Arancel</th>
        <th class="num">Total kg</th>
        <th class="num">USD / kg</th>
        <th class="num">Total USD</th>
      </tr>
    </thead>
    <tbody>
      ${lineasHtml}
      <tr class="total-row">
        <td colspan="2">TOTAL</td>
        <td class="num">${fmt(factura.total_kg, 2)} kg</td>
        <td></td>
        <td class="num">$${fmt(factura.total_usd)}</td>
      </tr>
    </tbody>
  </table>

  <div class="nota">
    ✓ Factura de exportación — Libre de IVA (artículo de exportación).<br>
    Valor en dólares americanos (USD). No válida como factura fiscal.
  </div>

  <div class="footer">
    <span>Factura #${numero} · ${fecha}</span>
    <span>Legucorp Pro ERP · ${new Date().toLocaleString('es-GT')}</span>
  </div>

  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) { alert('Permite las ventanas emergentes para generar el PDF.'); return }
  win.document.write(html)
  win.document.close()
}
