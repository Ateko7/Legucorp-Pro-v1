import { supabase } from '../../../lib/supabase'

// ─── Helpers ───────────────────────────────────────────────────────────────────
function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function r2(v) { return Math.round(n(v) * 100) / 100 }

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

function isoDate(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : d }

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

// ─── Date range helpers ────────────────────────────────────────────────────────

export function rangoParaDiario(fecha) {
  return { inicio: fecha, fin: fecha, referencia: fecha }
}

export function rangoParaSemanal(fechaEnSemana) {
  const d = new Date(fechaEnSemana + 'T00:00:00')
  const dow = d.getDay() // 0=dom
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - ((dow + 6) % 7))
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  return {
    inicio: isoDate(lunes),
    fin: isoDate(domingo),
    referencia: isoDate(lunes),
  }
}

export function rangoParaMensual(anio, mes) {
  const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`
  const finDate = new Date(anio, mes, 0) // last day of month
  return {
    inicio,
    fin: isoDate(finDate),
    referencia: inicio,
  }
}

// ─── Data consolidation helpers ────────────────────────────────────────────────

async function consolidarProduccion(orgId, inicio, fin) {
  const { data, error } = await supabase
    .from('packaging_runs')
    .select(`
      id, run_date, quantity_produced, packed_weight_lb, total_input_weight_lb,
      waste_weight_lb, waste_percentage, total_cost, unit_cost,
      product_presentation_id,
      product_presentations ( code, display_name )
    `)
    .eq('organization_id', orgId)
    .gte('run_date', inicio)
    .lte('run_date', fin)
  if (error) throw new Error(error.message)

  const runs = data || []
  const libras = r2(runs.reduce((a, r) => a + n(r.packed_weight_lb), 0))
  const unidades = r2(runs.reduce((a, r) => a + n(r.quantity_produced), 0))
  const mermaLibras = r2(runs.reduce((a, r) => a + n(r.waste_weight_lb), 0))
  const totalInput = r2(runs.reduce((a, r) => a + n(r.total_input_weight_lb), 0))
  const mermaPorc = totalInput > 0 ? r2((mermaLibras / totalInput) * 100) : 0
  const costoProd = r2(runs.reduce((a, r) => a + n(r.total_cost), 0))

  // Group by SKU
  const bySku = {}
  for (const r of runs) {
    const pid = r.product_presentation_id
    if (!bySku[pid]) bySku[pid] = {
      product_presentation_id: pid,
      sku_code: r.product_presentations?.code || '',
      sku_nombre: r.product_presentations?.display_name || '',
      produccion_unidades: 0,
      produccion_libras: 0,
      costo_produccion: 0,
    }
    bySku[pid].produccion_unidades += n(r.quantity_produced)
    bySku[pid].produccion_libras   += n(r.packed_weight_lb)
    bySku[pid].costo_produccion    += n(r.total_cost)
  }

  return {
    libras_producidas: libras,
    unidades_producidas: unidades,
    total_runs: runs.length,
    merma_libras: mermaLibras,
    merma_porcentaje: mermaPorc,
    costo_mp_packaging: costoProd,
    by_sku: Object.values(bySku),
  }
}

async function consolidarVentas(orgId, inicio, fin) {
  // Pedidos despachados/entregados/facturados/cobrados en el rango
  const SHIPPED = ['despachado', 'facturado', 'en_logistica', 'entregado', 'cobrado']

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, status, total, created_at,
      order_items (
        quantity, quantity_packed, unit_price, subtotal,
        product_presentation_id,
        product_presentations ( code, display_name )
      )
    `)
    .eq('organization_id', orgId)
    .gte('created_at', inicio + 'T00:00:00')
    .lte('created_at', fin + 'T23:59:59')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const allOrders = orders || []
  const shipped   = allOrders.filter(o => SHIPPED.includes(o.status))

  const ventasTotal = r2(shipped.reduce((a, o) => a + n(o.total), 0))

  // Group sales by SKU
  const bySkuVentas = {}
  for (const o of shipped) {
    for (const item of o.order_items || []) {
      const pid = item.product_presentation_id
      if (!bySkuVentas[pid]) bySkuVentas[pid] = {
        product_presentation_id: pid,
        sku_code: item.product_presentations?.code || '',
        sku_nombre: item.product_presentations?.display_name || '',
        ventas_unidades: 0,
        ventas_monto: 0,
      }
      bySkuVentas[pid].ventas_unidades += n(item.quantity_packed || item.quantity)
      bySkuVentas[pid].ventas_monto    += n(item.subtotal)
    }
  }

  return {
    total_pedidos: allOrders.length,
    pedidos_despachados: shipped.length,
    pedidos_pendientes: allOrders.filter(o => ['confirmado','empacado'].includes(o.status)).length,
    ventas_total: ventasTotal,
    by_sku_ventas: Object.values(bySkuVentas),
  }
}

async function consolidarCostos(orgId, inicio, fin) {
  // Gastos operativos del período
  const { data: gastos, error: ge } = await supabase
    .from('expenses')
    .select('amount, expense_type, cost_center_id')
    .eq('organization_id', orgId)
    .gte('expense_date', inicio)
    .lte('expense_date', fin)
  if (ge) throw new Error(ge.message)

  const totalGastos = r2((gastos || []).reduce((a, g) => a + n(g.amount), 0))

  // Labor cost from KPI table (pre-computed)
  const { data: laborRows, error: le } = await supabase
    .from('kpi_costo_laboral_diario')
    .select('costo_laboral_total_dia')
    .eq('organization_id', orgId)
    .gte('fecha', inicio)
    .lte('fecha', fin)
  if (le) throw new Error(le.message)

  const costoLaboral = r2((laborRows || []).reduce((a, r) => a + n(r.costo_laboral_total_dia), 0))

  return {
    costo_gastos: totalGastos,
    costo_laboral: costoLaboral,
  }
}

async function consolidarCalidad(orgId, inicio, fin) {
  const { data, error } = await supabase
    .from('inspecciones_calidad')
    .select('id, resultado, tasa_defectos')
    .eq('organization_id', orgId)
    .gte('fecha', inicio)
    .lte('fecha', fin)
  if (error) throw new Error(error.message)

  const insp = data || []
  const rechazadas = insp.filter(i => i.resultado === 'rechazado').length
  const retenidas  = insp.filter(i => i.resultado === 'retenido').length
  const tasa = insp.length > 0 ? r2((rechazadas / insp.length) * 100) : 0

  // Reclamos abiertos en el período
  const { data: claims, error: ce } = await supabase
    .from('order_claims')
    .select('id')
    .eq('organization_id', orgId)
    .gte('created_at', inicio + 'T00:00:00')
    .lte('created_at', fin + 'T23:59:59')
  if (ce) throw new Error(ce.message)

  // Lotes bloqueados actualmente
  const { data: blocked, error: be } = await supabase
    .from('finished_inventory_lots')
    .select('id')
    .eq('organization_id', orgId)
    .eq('bloqueado_calidad', true)
  if (be) throw new Error(be.message)

  return {
    inspecciones_total: insp.length,
    inspecciones_rechazadas: rechazadas,
    inspecciones_retenidas: retenidas,
    tasa_rechazo: tasa,
    reclamos_total: (claims || []).length,
    lotes_bloqueados: (blocked || []).length,
  }
}

// ─── Alert generation ──────────────────────────────────────────────────────────

function generarAlertas({ produccion, ventas, costos, calidad, tipo_periodo }) {
  const alertas = []

  // Producción 0 con costo laboral
  if (produccion.libras_producidas === 0 && costos.costo_laboral > 0) {
    alertas.push({
      tipo_evento: 'produccion_sin_libras',
      descripcion: `Hubo costo laboral (Q${r2(costos.costo_laboral)}) pero producción 0 lb`,
      severidad: 'error',
    })
  }

  // Merma alta (>15%)
  if (produccion.merma_porcentaje > 15) {
    alertas.push({
      tipo_evento: 'merma_alta',
      descripcion: `Merma de ${r2(produccion.merma_porcentaje)}% (umbral: 15%)`,
      severidad: 'warning',
    })
  }

  // Ventas 0 con producción
  if (ventas.ventas_total === 0 && produccion.libras_producidas > 0) {
    alertas.push({
      tipo_evento: 'ventas_cero',
      descripcion: `Sin ventas despachadas en el período`,
      severidad: 'info',
    })
  }

  // Inspecciones rechazadas
  if (calidad.inspecciones_rechazadas > 0) {
    alertas.push({
      tipo_evento: 'inspecciones_rechazadas',
      descripcion: `${calidad.inspecciones_rechazadas} inspección(es) rechazada(s) - tasa ${r2(calidad.tasa_rechazo)}%`,
      severidad: calidad.tasa_rechazo > 10 ? 'error' : 'warning',
    })
  }

  // Lotes bloqueados
  if (calidad.lotes_bloqueados > 0) {
    alertas.push({
      tipo_evento: 'lotes_bloqueados',
      descripcion: `${calidad.lotes_bloqueados} lote(s) bloqueado(s) por calidad`,
      severidad: 'warning',
    })
  }

  // Reclamos
  if (calidad.reclamos_total > 0) {
    alertas.push({
      tipo_evento: 'reclamos',
      descripcion: `${calidad.reclamos_total} reclamo(s) registrado(s) en el período`,
      severidad: calidad.reclamos_total > 3 ? 'error' : 'warning',
    })
  }

  // Margen negativo
  const margen = n(ventas.ventas_total) > 0
    ? r2(((n(ventas.ventas_total) - (n(costos.costo_gastos) + n(costos.costo_laboral) + n(produccion.costo_mp_packaging))) / n(ventas.ventas_total)) * 100)
    : 0
  if (margen < 0 && ventas.ventas_total > 0) {
    alertas.push({
      tipo_evento: 'margen_negativo',
      descripcion: `Margen bruto negativo: ${margen}%`,
      severidad: 'error',
    })
  }

  return alertas
}

// ─── Core: generate or recalculate a cierre ───────────────────────────────────

async function generarCierre({ tipo_periodo, inicio, fin, referencia, orgId, userId }) {
  const [produccion, ventas, costos, calidad] = await Promise.all([
    consolidarProduccion(orgId, inicio, fin),
    consolidarVentas(orgId, inicio, fin),
    consolidarCostos(orgId, inicio, fin),
    consolidarCalidad(orgId, inicio, fin),
  ])

  // Cost split from packaging_run_inputs
  const { data: inputs, error: ie } = await supabase
    .from('packaging_run_inputs')
    .select('input_type, total_cost, packaging_runs!packaging_run_id(run_date)')
    .eq('organization_id', orgId)
  if (ie) throw new Error(ie.message)

  const inputsInRange = (inputs || []).filter(i => {
    const d = i.packaging_runs?.run_date
    return d && d >= inicio && d <= fin
  })
  const costoMp      = r2(inputsInRange.filter(i => i.input_type === 'procesado').reduce((a, i) => a + n(i.total_cost), 0))
  const costoEmpaque = r2(inputsInRange.filter(i => i.input_type === 'empaque').reduce((a, i) => a + n(i.total_cost), 0))

  const costoTotal = r2(costoMp + costoEmpaque + costos.costo_laboral + costos.costo_gastos)
  const costoPorLibra = produccion.libras_producidas > 0 ? r2(costoTotal / produccion.libras_producidas) : null
  const utilidadBruta = r2(ventas.ventas_total - costoTotal)
  const margenBruto   = ventas.ventas_total > 0 ? r2((utilidadBruta / ventas.ventas_total) * 100) : 0

  const alertas = generarAlertas({ produccion, ventas, costos: { ...costos, costo_mp: costoMp }, calidad, tipo_periodo })

  // Build per-SKU summary
  const skuMap = {}
  for (const s of produccion.by_sku) {
    skuMap[s.product_presentation_id] = { ...s, ventas_unidades: 0, ventas_monto: 0, costo_total: n(s.costo_produccion), margen: 0 }
  }
  for (const s of ventas.by_sku_ventas) {
    if (!skuMap[s.product_presentation_id]) {
      skuMap[s.product_presentation_id] = {
        product_presentation_id: s.product_presentation_id,
        sku_code: s.sku_code,
        sku_nombre: s.sku_nombre,
        produccion_unidades: 0,
        produccion_libras: 0,
        costo_total: 0,
        ventas_unidades: 0,
        ventas_monto: 0,
        margen: 0,
      }
    }
    skuMap[s.product_presentation_id].ventas_unidades = s.ventas_unidades
    skuMap[s.product_presentation_id].ventas_monto    = s.ventas_monto
  }
  const resumenSku = Object.values(skuMap).map(s => ({
    ...s,
    margen: s.ventas_monto > 0 ? r2(((s.ventas_monto - s.costo_total) / s.ventas_monto) * 100) : 0,
  }))

  return {
    tipo_periodo,
    fecha_inicio: inicio,
    fecha_fin: fin,
    fecha_referencia: referencia,
    estado: 'calculado',
    libras_producidas:       produccion.libras_producidas,
    unidades_producidas:     produccion.unidades_producidas,
    total_runs:              produccion.total_runs,
    merma_libras:            produccion.merma_libras,
    merma_porcentaje:        produccion.merma_porcentaje,
    total_pedidos:           ventas.total_pedidos,
    pedidos_despachados:     ventas.pedidos_despachados,
    pedidos_pendientes:      ventas.pedidos_pendientes,
    ventas_total:            ventas.ventas_total,
    costo_mp:                costoMp,
    costo_empaque_mat:       costoEmpaque,
    costo_laboral:           costos.costo_laboral,
    costo_gastos:            costos.costo_gastos,
    costo_total:             costoTotal,
    costo_por_libra:         costoPorLibra,
    utilidad_bruta:          utilidadBruta,
    margen_bruto:            margenBruto,
    inspecciones_total:      calidad.inspecciones_total,
    inspecciones_rechazadas: calidad.inspecciones_rechazadas,
    inspecciones_retenidas:  calidad.inspecciones_retenidas,
    tasa_rechazo:            calidad.tasa_rechazo,
    reclamos_total:          calidad.reclamos_total,
    lotes_bloqueados:        calidad.lotes_bloqueados,
    resumen_por_sku:         resumenSku,
    resumen_alertas:         alertas,
    organization_id:         orgId,
    created_by:              userId,
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function getCierres({ tipo_periodo } = {}) {
  const profile = await getProfile()
  let query = supabase
    .from('cierres_operativos')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('fecha_referencia', { ascending: false })
  if (tipo_periodo) query = query.eq('tipo_periodo', tipo_periodo)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

export async function getCierreById(id) {
  const { data, error } = await supabase
    .from('cierres_operativos')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)

  const { data: detalle } = await supabase
    .from('cierres_detalle_sku')
    .select('*')
    .eq('cierre_id', id)
    .order('ventas_monto', { ascending: false })

  const { data: eventos } = await supabase
    .from('cierres_eventos')
    .select('*')
    .eq('cierre_id', id)
    .order('created_at', { ascending: true })

  return { ...data, detalle_sku: detalle || [], eventos: eventos || [] }
}

export async function generarCierreDiario(fecha) {
  const profile = await getProfile()
  const { inicio, fin, referencia } = rangoParaDiario(fecha)
  return _upsertCierre({ tipo_periodo: 'diario', inicio, fin, referencia, profile })
}

export async function generarCierreSemanal(fechaEnSemana) {
  const profile = await getProfile()
  const { inicio, fin, referencia } = rangoParaSemanal(fechaEnSemana)
  return _upsertCierre({ tipo_periodo: 'semanal', inicio, fin, referencia, profile })
}

export async function generarCierreMensual(anio, mes) {
  const profile = await getProfile()
  const { inicio, fin, referencia } = rangoParaMensual(anio, mes)
  return _upsertCierre({ tipo_periodo: 'mensual', inicio, fin, referencia, profile })
}

async function _upsertCierre({ tipo_periodo, inicio, fin, referencia, profile }) {
  // Check if cierre already exists and is cerrado (cannot recalculate)
  const { data: existing } = await supabase
    .from('cierres_operativos')
    .select('id, estado')
    .eq('organization_id', profile.organization_id)
    .eq('tipo_periodo', tipo_periodo)
    .eq('fecha_inicio', inicio)
    .eq('fecha_fin', fin)
    .single()

  if (existing?.estado === 'cerrado') {
    throw new Error('El cierre ya está cerrado. No se puede recalcular.')
  }

  const payload = await generarCierre({
    tipo_periodo, inicio, fin, referencia,
    orgId: profile.organization_id,
    userId: profile.id,
  })

  const { data: cierre, error } = await supabase
    .from('cierres_operativos')
    .upsert(payload, {
      onConflict: 'organization_id,tipo_periodo,fecha_inicio,fecha_fin',
      ignoreDuplicates: false,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)

  // Delete old detail rows and reinsert
  await supabase.from('cierres_detalle_sku').delete().eq('cierre_id', cierre.id)
  await supabase.from('cierres_eventos').delete().eq('cierre_id', cierre.id)

  const skuRows = (payload.resumen_por_sku || []).map(s => ({
    cierre_id:              cierre.id,
    organization_id:        profile.organization_id,
    tipo_periodo,
    product_presentation_id: s.product_presentation_id,
    sku_code:               s.sku_code,
    sku_nombre:             s.sku_nombre,
    produccion_unidades:    s.produccion_unidades,
    produccion_libras:      s.produccion_libras,
    ventas_unidades:        s.ventas_unidades,
    ventas_monto:           s.ventas_monto,
    costo_total:            s.costo_total,
    costo_unitario:         s.produccion_unidades > 0 ? r2(s.costo_total / s.produccion_unidades) : 0,
    margen:                 s.margen,
  }))
  if (skuRows.length) await supabase.from('cierres_detalle_sku').insert(skuRows)

  const eventRows = (payload.resumen_alertas || []).map(a => ({
    cierre_id:      cierre.id,
    organization_id: profile.organization_id,
    tipo_periodo,
    tipo_evento:    a.tipo_evento,
    descripcion:    a.descripcion,
    severidad:      a.severidad,
  }))
  if (eventRows.length) await supabase.from('cierres_eventos').insert(eventRows)

  return getCierreById(cierre.id)
}

export async function cambiarEstadoCierre(id, nuevoEstado) {
  const profile = await getProfile()
  const updates = {
    estado: nuevoEstado,
    updated_at: new Date().toISOString(),
  }
  if (nuevoEstado === 'cerrado') {
    updates.responsable_cierre_id = profile.id
    updates.fecha_cierre = new Date().toISOString()
  }
  const { error } = await supabase
    .from('cierres_operativos')
    .update(updates)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function actualizarObservaciones(id, observaciones) {
  const { error } = await supabase
    .from('cierres_operativos')
    .update({ observaciones, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteCierre(id) {
  const { data } = await supabase
    .from('cierres_operativos')
    .select('estado')
    .eq('id', id)
    .single()
  if (data?.estado === 'cerrado') throw new Error('No se puede eliminar un cierre cerrado.')
  const { error } = await supabase.from('cierres_operativos').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
