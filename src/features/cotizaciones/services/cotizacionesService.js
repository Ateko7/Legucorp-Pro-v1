import { supabase } from '../../../lib/supabase'

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles').select('id, organization_id').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return data
}

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

// ─── Clientes (para selector) ─────────────────────────────────────────────────

export async function getClientsForQuote() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('clients')
    .select('id, commercial_name, legal_name, nit, main_address, phone, email, main_contact, channel, credit_days, delivery_conditions')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'activo')
    .order('commercial_name')
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Presentaciones con datos de pricing ─────────────────────────────────────

export async function getProductsForQuote() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('product_presentations')
    .select('id, code, display_name, unit, net_weight, suggested_price, standard_cost, min_profitable_price, volume_low_threshold, volume_high_threshold')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'activo')
    .order('display_name')
  if (error) throw new Error(error.message)
  return (data || []).map(p => ({
    ...p,
    // min_profitable_price fallback: standard_cost * 1.10
    min_profitable_price: n(p.min_profitable_price) > 0
      ? n(p.min_profitable_price)
      : Math.round(n(p.standard_cost) * 1.10 * 10000) / 10000,
    volume_low_threshold:  n(p.volume_low_threshold)  || 50,
    volume_high_threshold: n(p.volume_high_threshold) || 200,
  }))
}

// ─── Prospectos ───────────────────────────────────────────────────────────────

export async function getProspects() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('commercial_name')
  if (error) throw new Error(error.message)
  return data || []
}

export async function createProspect(payload) {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('prospects')
    .insert({ ...payload, organization_id: profile.organization_id, created_by: profile.id })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Cotizaciones ─────────────────────────────────────────────────────────────

export async function getQuotes({ status, search, dateFrom, dateTo } = {}) {
  const profile = await getProfile()

  let q = supabase
    .from('quotes')
    .select(`
      id, quote_number, quote_date, valid_until, status, currency,
      growth_opportunity, estimated_frequency, commercial_notes, auto_note,
      converted_order_id, created_at,
      clients ( id, commercial_name, nit ),
      prospects ( id, commercial_name, nit, status )
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  if (status)   q = q.eq('status', status)
  if (dateFrom) q = q.gte('quote_date', dateFrom)
  if (dateTo)   q = q.lte('quote_date', dateTo)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  let rows = data || []

  if (search) {
    const s = search.toLowerCase()
    rows = rows.filter(r =>
      r.quote_number?.toLowerCase().includes(s) ||
      r.clients?.commercial_name?.toLowerCase().includes(s) ||
      r.prospects?.commercial_name?.toLowerCase().includes(s)
    )
  }

  return rows
}

export async function getQuoteById(id) {
  const { data, error } = await supabase
    .from('quotes')
    .select(`
      *,
      clients ( id, commercial_name, legal_name, nit, main_address, main_contact, phone, email, channel, credit_days ),
      prospects ( * ),
      quote_items (
        id, product_presentation_id, estimated_volume, unit,
        ref_price, min_price, volume_class, rule_applied, adjustment_pct,
        suggested_price, price_note, final_price, subtotal, created_at,
        product_presentations ( id, code, display_name, unit, net_weight, suggested_price, standard_cost )
      )
    `)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function createQuote({ header, items, prospectPayload }) {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  // Crear prospecto si viene inline
  let prospectId = header.prospect_id || null
  if (!header.client_id && prospectPayload) {
    const { data: p, error: pErr } = await supabase
      .from('prospects')
      .insert({ ...prospectPayload, organization_id: orgId, created_by: profile.id })
      .select('id')
      .single()
    if (pErr) throw new Error(pErr.message)
    prospectId = p.id
  }

  // Generar número de cotización
  const { data: quoteNum, error: numErr } = await supabase
    .rpc('generate_quote_number', { p_organization_id: orgId })
  if (numErr) throw new Error(numErr.message)

  // Insertar cabecera
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .insert({
      organization_id:    orgId,
      quote_number:       quoteNum,
      client_id:          header.client_id || null,
      prospect_id:        prospectId,
      quote_date:         header.quote_date,
      valid_until:        header.valid_until,
      currency:           header.currency || 'GTQ',
      growth_opportunity: header.growth_opportunity || 'media',
      estimated_frequency:header.estimated_frequency || 'mensual',
      commercial_notes:   header.commercial_notes || null,
      auto_note:          header.auto_note || null,
      status:             'borrador',
      created_by:         profile.id,
    })
    .select()
    .single()
  if (qErr) throw new Error(qErr.message)

  // Insertar líneas
  if (items?.length) {
    const itemRows = items.map(i => ({
      quote_id:                 quote.id,
      product_presentation_id:  i.product_presentation_id,
      estimated_volume:         n(i.estimated_volume),
      unit:                     i.unit,
      ref_price:                n(i.ref_price),
      min_price:                n(i.min_price),
      volume_class:             i.volume_class || 'medio',
      rule_applied:             i.rule_applied || null,
      adjustment_pct:           n(i.adjustment_pct),
      suggested_price:          n(i.suggested_price),
      price_note:               i.price_note || null,
      final_price:              n(i.final_price),
      subtotal:                 n(i.final_price) * n(i.estimated_volume),
    }))
    const { error: iErr } = await supabase.from('quote_items').insert(itemRows)
    if (iErr) throw new Error(iErr.message)
  }

  return quote
}

export async function updateQuote(id, { header, items }) {
  const autoNote = header.auto_note || null

  const { error: qErr } = await supabase
    .from('quotes')
    .update({
      client_id:           header.client_id   || null,
      prospect_id:         header.prospect_id || null,
      quote_date:          header.quote_date,
      valid_until:         header.valid_until,
      currency:            header.currency,
      growth_opportunity:  header.growth_opportunity,
      estimated_frequency: header.estimated_frequency,
      commercial_notes:    header.commercial_notes || null,
      auto_note:           autoNote,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', id)
  if (qErr) throw new Error(qErr.message)

  if (items) {
    await supabase.from('quote_items').delete().eq('quote_id', id)
    const itemRows = items.map(i => ({
      quote_id:                 id,
      product_presentation_id:  i.product_presentation_id,
      estimated_volume:         n(i.estimated_volume),
      unit:                     i.unit,
      ref_price:                n(i.ref_price),
      min_price:                n(i.min_price),
      volume_class:             i.volume_class || 'medio',
      rule_applied:             i.rule_applied || null,
      adjustment_pct:           n(i.adjustment_pct),
      suggested_price:          n(i.suggested_price),
      price_note:               i.price_note || null,
      final_price:              n(i.final_price),
      subtotal:                 n(i.final_price) * n(i.estimated_volume),
    }))
    if (itemRows.length) {
      const { error: iErr } = await supabase.from('quote_items').insert(itemRows)
      if (iErr) throw new Error(iErr.message)
    }
  }
}

export async function updateQuoteStatus(id, status) {
  const allowed = ['borrador','emitida','aceptada','rechazada','vencida','convertida']
  if (!allowed.includes(status)) throw new Error('Estado inválido')
  const { error } = await supabase
    .from('quotes')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteQuote(id) {
  const { error } = await supabase.from('quotes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Aceptar cotización ───────────────────────────────────────────────────────

export async function acceptQuote(quoteId, { saveAgreedPrices = true, convertToOrder = true }) {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  // 1. Cargar cotización completa
  const quote = await getQuoteById(quoteId)
  if (!quote) throw new Error('Cotización no encontrada')

  let clientId = quote.client_id

  // 2. Convertir prospecto a cliente si aplica
  if (!clientId && quote.prospect_id) {
    clientId = await convertProspectToClient(quote.prospect_id, orgId, profile.id)
    // Vincular cliente a cotización
    await supabase.from('quotes').update({ client_id: clientId }).eq('id', quoteId)
  }

  if (!clientId) throw new Error('No se pudo determinar el cliente')

  // 3. Guardar precios acordados
  if (saveAgreedPrices && quote.quote_items?.length) {
    await saveClientAgreedPrices(clientId, quote.quote_items, quoteId, quote.valid_until, orgId)
  }

  // 4. Crear pedido desde cotización
  let orderId = null
  if (convertToOrder) {
    orderId = await createOrderFromQuote(quote, clientId, orgId, profile.id)
  }

  // 5. Marcar cotización como convertida
  await supabase.from('quotes').update({
    status:              'convertida',
    converted_order_id:  orderId,
    updated_at:          new Date().toISOString(),
  }).eq('id', quoteId)

  return { clientId, orderId }
}

// ─── Convertir prospecto a cliente ───────────────────────────────────────────

export async function convertProspectToClient(prospectId, orgId, userId) {
  const { data: p, error: pErr } = await supabase
    .from('prospects')
    .select('*')
    .eq('id', prospectId)
    .single()
  if (pErr) throw new Error(pErr.message)
  if (p.status === 'convertido' && p.converted_client_id) return p.converted_client_id

  const { data: client, error: cErr } = await supabase
    .from('clients')
    .insert({
      organization_id:      orgId,
      commercial_name:      p.commercial_name,
      legal_name:           p.legal_name   || null,
      nit:                  p.nit          || null,
      main_address:         p.commercial_address || null,
      main_contact:         p.contact_name || null,
      phone:                p.phone        || null,
      email:                p.email        || null,
      channel:              p.channel      || 'directo',
      credit_days:          p.credit_days  || 0,
      delivery_conditions:  p.logistics_notes || null,
      status:               'activo',
      created_by:           userId,
    })
    .select('id')
    .single()
  if (cErr) throw new Error(cErr.message)

  // Marcar prospecto como convertido
  await supabase.from('prospects').update({
    status:              'convertido',
    converted_client_id: client.id,
    converted_at:        new Date().toISOString(),
  }).eq('id', prospectId)

  return client.id
}

// ─── Guardar precios acordados ────────────────────────────────────────────────

async function saveClientAgreedPrices(clientId, items, quoteId, validUntil, orgId) {
  // Desactivar precios previos de los mismos productos
  const presentationIds = items.map(i => i.product_presentation_id)
  await supabase
    .from('client_agreed_prices')
    .update({ is_active: false })
    .eq('client_id', clientId)
    .in('product_presentation_id', presentationIds)
    .eq('is_active', true)

  const rows = items.map(i => ({
    organization_id:          orgId,
    client_id:                clientId,
    product_presentation_id:  i.product_presentation_id,
    agreed_price:             n(i.final_price),
    valid_from:               new Date().toISOString().slice(0, 10),
    valid_until:              validUntil || null,
    origin_quote_id:          quoteId,
    is_active:                true,
  }))

  const { error } = await supabase.from('client_agreed_prices').insert(rows)
  if (error) throw new Error(error.message)
}

// ─── Crear pedido desde cotización ───────────────────────────────────────────

async function createOrderFromQuote(quote, clientId, orgId, userId) {
  const { data: ccComercial } = await supabase
    .from('cost_centers')
    .select('id')
    .eq('organization_id', orgId)
    .eq('code', 'CC-02')
    .eq('is_active', true)
    .maybeSingle()

  const total = (quote.quote_items || []).reduce(
    (acc, i) => acc + n(i.final_price) * n(i.estimated_volume), 0
  )

  const { data: order, error: oErr } = await supabase
    .from('orders')
    .insert({
      organization_id: orgId,
      client_id:       clientId,
      status:          'confirmado',
      total,
      notes:           quote.commercial_notes
                         ? `Cotización ${quote.quote_number}: ${quote.commercial_notes}`
                         : `Generado desde cotización ${quote.quote_number}`,
      delivery_date:   quote.valid_until,
      channel:         'cotizacion',
      channel_reference: quote.quote_number,
      cost_center_id:  ccComercial?.id || null,
      created_by:      userId,
    })
    .select('id')
    .single()
  if (oErr) throw new Error(oErr.message)

  const itemRows = (quote.quote_items || []).map(i => ({
    order_id:                 order.id,
    product_presentation_id:  i.product_presentation_id,
    quantity:                 n(i.estimated_volume),
    unit_price:               n(i.final_price),
    subtotal:                 n(i.final_price) * n(i.estimated_volume),
  }))

  if (itemRows.length) {
    const { error: iErr } = await supabase.from('order_items').insert(itemRows)
    if (iErr) throw new Error(iErr.message)
  }

  return order.id
}

// ─── Precios acordados por cliente ───────────────────────────────────────────

export async function getClientAgreedPrices(clientId) {
  const { data, error } = await supabase
    .from('client_agreed_prices')
    .select(`
      id, agreed_price, valid_from, valid_until, is_active, notes, created_at,
      product_presentations ( id, code, display_name, unit ),
      quotes ( id, quote_number )
    `)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Reportes / helpers ───────────────────────────────────────────────────────

export async function getQuoteStats() {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  const { data, error } = await supabase
    .from('quotes')
    .select('status, growth_opportunity')
    .eq('organization_id', orgId)
  if (error) throw new Error(error.message)

  const rows = data || []
  return {
    total:        rows.length,
    borrador:     rows.filter(r => r.status === 'borrador').length,
    emitidas:     rows.filter(r => r.status === 'emitida').length,
    aceptadas:    rows.filter(r => r.status === 'aceptada' || r.status === 'convertida').length,
    rechazadas:   rows.filter(r => r.status === 'rechazada').length,
    altaOportunidad: rows.filter(r => r.growth_opportunity === 'alta').length,
  }
}

// ─── PDF del cliente (genera HTML para imprimir) ──────────────────────────────

export function generateQuotePDF(quote) {
  const fmt = (v) => Number(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const clientName = quote.clients?.commercial_name || quote.prospects?.commercial_name || '—'
  const clientNit  = quote.clients?.nit || quote.prospects?.nit || 'CF'
  const clientContact = quote.clients?.main_contact || quote.prospects?.contact_name || ''
  const clientPhone   = quote.clients?.phone || quote.prospects?.phone || ''
  const clientEmail   = quote.clients?.email || quote.prospects?.email || ''
  const clientAddress = quote.clients?.main_address || quote.prospects?.commercial_address || ''

  const items  = quote.quote_items || []
  const total  = items.reduce((a, i) => a + Number(i.subtotal), 0)
  const autoNote = quote.auto_note || ''
  const notes    = quote.commercial_notes || ''

  const itemRows = items.map(i => `
    <tr>
      <td>${i.product_presentations?.display_name || '—'}</td>
      <td style="text-align:center">${i.estimated_volume}</td>
      <td style="text-align:center">${i.unit}</td>
      <td style="text-align:right">Q ${fmt(i.final_price)}</td>
      <td style="text-align:right">Q ${fmt(i.subtotal)}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cotización ${quote.quote_number}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { font-family: 'Segoe UI', Arial, sans-serif; color:#1c1917; background:#fff; padding:40px }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #2f5d50; padding-bottom:24px; margin-bottom:28px }
  .brand { display:flex; align-items:center; gap:14px }
  .brand-logo { width:52px; height:52px; background:#2f5d50; border-radius:14px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:22px; font-weight:700 }
  .brand-name { font-size:22px; font-weight:700; color:#1c1917 }
  .brand-sub { font-size:12px; color:#78716c; margin-top:2px }
  .quote-meta { text-align:right }
  .quote-number { font-size:20px; font-weight:700; color:#2f5d50 }
  .quote-dates { font-size:12px; color:#78716c; margin-top:4px }
  .client-block { background:#faf9f7; border:1px solid #e7e5e4; border-radius:16px; padding:20px 24px; margin-bottom:24px }
  .client-block h3 { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#a8a29e; margin-bottom:12px }
  .client-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px }
  .client-row { font-size:13px; color:#44403c }
  .client-label { font-weight:600; color:#78716c }
  table { width:100%; border-collapse:collapse; margin-bottom:20px }
  thead th { background:#2f5d50; color:#fff; padding:10px 14px; text-align:left; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.05em }
  tbody tr:nth-child(even) { background:#faf9f7 }
  tbody td { padding:10px 14px; font-size:13px; border-bottom:1px solid #f5f5f4 }
  .total-row { background:#2f5d50 !important }
  .total-row td { color:#fff; font-weight:700; font-size:14px; padding:12px 14px }
  .notes-block { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:16px 20px; margin-bottom:16px }
  .notes-block h4 { font-size:11px; font-weight:700; text-transform:uppercase; color:#16a34a; margin-bottom:8px }
  .notes-block p { font-size:13px; color:#166534 }
  .obs-block { background:#faf9f7; border:1px solid #e7e5e4; border-radius:12px; padding:16px 20px; margin-bottom:16px }
  .obs-block p { font-size:13px; color:#44403c }
  .footer { margin-top:36px; padding-top:20px; border-top:1px solid #e7e5e4; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#a8a29e }
  @media print {
    body { padding:20px }
    .no-print { display:none }
  }
</style>
</head>
<body>

<div class="header">
  <div class="brand">
    <div class="brand-logo">L</div>
    <div>
      <div class="brand-name">Legucorp Pro</div>
      <div class="brand-sub">Operación y trazabilidad</div>
    </div>
  </div>
  <div class="quote-meta">
    <div class="quote-number">${quote.quote_number}</div>
    <div class="quote-dates">
      Fecha: <strong>${quote.quote_date}</strong><br>
      Vigencia hasta: <strong>${quote.valid_until}</strong>
    </div>
    <div style="margin-top:8px">
      <span style="background:#2f5d50;color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase">
        ${quote.currency || 'GTQ'}
      </span>
    </div>
  </div>
</div>

<div class="client-block">
  <h3>Cliente</h3>
  <div class="client-grid">
    <div class="client-row"><span class="client-label">Razón social / Nombre:</span> ${clientName}</div>
    <div class="client-row"><span class="client-label">NIT:</span> ${clientNit}</div>
    ${clientContact ? `<div class="client-row"><span class="client-label">Contacto:</span> ${clientContact}</div>` : ''}
    ${clientPhone   ? `<div class="client-row"><span class="client-label">Teléfono:</span> ${clientPhone}</div>` : ''}
    ${clientEmail   ? `<div class="client-row"><span class="client-label">Correo:</span> ${clientEmail}</div>` : ''}
    ${clientAddress ? `<div class="client-row" style="grid-column:span 2"><span class="client-label">Dirección:</span> ${clientAddress}</div>` : ''}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Producto / Presentación</th>
      <th style="text-align:center">Cantidad</th>
      <th style="text-align:center">Unidad</th>
      <th style="text-align:right">Precio unitario</th>
      <th style="text-align:right">Subtotal</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="4" style="text-align:right">TOTAL ${quote.currency || 'GTQ'}</td>
      <td style="text-align:right">Q ${fmt(total)}</td>
    </tr>
  </tfoot>
</table>

${autoNote ? `
<div class="notes-block">
  <h4>Nota comercial</h4>
  <p>${autoNote}</p>
</div>` : ''}

${notes ? `
<div class="obs-block">
  <h4 style="font-size:11px;font-weight:700;text-transform:uppercase;color:#78716c;margin-bottom:8px">Observaciones</h4>
  <p>${notes}</p>
</div>` : ''}

<div class="footer">
  <div>Legucorp Pro · Operación y trazabilidad</div>
  <div style="font-style:italic">Documento comercial — uso exclusivo del cliente</div>
  <div>Cotización válida hasta ${quote.valid_until}</div>
</div>

<div class="no-print" style="margin-top:30px;text-align:center">
  <button onclick="window.print()"
    style="background:#2f5d50;color:#fff;border:none;padding:12px 28px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">
    Imprimir / Guardar PDF
  </button>
</div>

</body>
</html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}
