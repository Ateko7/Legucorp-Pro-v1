import { supabase } from '../../../lib/supabase'

async function getOrgId() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  return data.organization_id
}

function n(v) { return Number(v || 0) }

// ─── Dashboard Operativo ──────────────────────────────────────────────────────

export async function getOperativoDashboard() {
  const orgId = await getOrgId()

  const [
    ordersRes,
    inventoryRes,
    expiringRes,
    topProductsRes,
    mpStockRes,
    revenueByDayRes,
    processRunsRes,
    purchaseOrdersRes,
  ] = await Promise.allSettled([

    // 1. Pedidos por estado
    supabase.from('orders').select('status, total').eq('organization_id', orgId),

    // 2. Inventario producto terminado disponible
    supabase
      .from('finished_inventory_lots')
      .select('product_presentation_id, available_quantity, unit, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .in('status', ['disponible', 'parcial']),

    // 3. Lotes por vencer en 7 días
    supabase
      .from('finished_inventory_lots')
      .select('finished_lot_code, available_quantity, unit, expiration_date, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .in('status', ['disponible', 'parcial'])
      .lte('expiration_date', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
      .gt('available_quantity', 0)
      .order('expiration_date', { ascending: true }),

    // 4. Top productos por revenue
    supabase
      .from('order_items')
      .select('quantity, subtotal, product_presentations(code, display_name)')
      .not('order_id', 'is', null),

    // 5. Stock MP
    supabase
      .from('material_inventory_lots')
      .select('material_id, available_quantity, unit, materials(common_name, code, minimum_stock)')
      .eq('organization_id', orgId)
      .in('status', ['disponible', 'parcial']),

    // 6. Revenue últimos 14 días (pedidos facturados+)
    supabase
      .from('orders')
      .select('created_at, total, status')
      .eq('organization_id', orgId)
      .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()),

    // 7. Procesos MP activos
    supabase
      .from('material_process_runs')
      .select('id, current_stage, status, input_quantity, created_at')
      .eq('organization_id', orgId)
      .eq('status', 'en_proceso'),

    // 8. OC pendientes de recepción
    supabase
      .from('purchase_orders')
      .select('id, order_number, status, created_at, suppliers(name)')
      .eq('organization_id', orgId)
      .in('status', ['enviada', 'parcial']),
  ])

  // ── Pedidos ────────────────────────────────────────────────────────────────
  const orders = ordersRes.status === 'fulfilled' ? ordersRes.value.data || [] : []
  const ordersByStatus = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1; return acc
  }, {})
  const totalRevenue   = orders.filter(o => o.status !== 'cancelado').reduce((a, o) => a + n(o.total), 0)
  const pendingRevenue = orders.filter(o => ['confirmado','empacado','despachado'].includes(o.status)).reduce((a, o) => a + n(o.total), 0)

  // ── Inventario terminado ───────────────────────────────────────────────────
  const invLots = inventoryRes.status === 'fulfilled' ? inventoryRes.value.data || [] : []
  const invByPres = invLots.reduce((acc, l) => {
    const k = l.product_presentation_id
    if (!acc[k]) acc[k] = { name: l.product_presentations?.display_name, code: l.product_presentations?.code, total: 0, unit: l.unit }
    acc[k].total += n(l.available_quantity); return acc
  }, {})
  const inventoryItems     = Object.values(invByPres).filter(i => i.total > 0).sort((a, b) => b.total - a.total)
  const totalFinishedUnits = inventoryItems.reduce((a, i) => a + i.total, 0)

  // ── Lotes por vencer ───────────────────────────────────────────────────────
  const expiringLots = expiringRes.status === 'fulfilled' ? expiringRes.value.data || [] : []

  // ── Top productos ──────────────────────────────────────────────────────────
  const allItems = topProductsRes.status === 'fulfilled' ? topProductsRes.value.data || [] : []
  const productMap = allItems.reduce((acc, i) => {
    const code = i.product_presentations?.code || 'N/A'
    if (!acc[code]) acc[code] = { code, name: i.product_presentations?.display_name || 'N/A', units: 0, revenue: 0 }
    acc[code].units += n(i.quantity); acc[code].revenue += n(i.subtotal); return acc
  }, {})
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

  // ── Stock MP ───────────────────────────────────────────────────────────────
  const mpLots = mpStockRes.status === 'fulfilled' ? mpStockRes.value.data || [] : []
  const mpMap  = mpLots.reduce((acc, l) => {
    const id = l.material_id
    if (!acc[id]) acc[id] = { name: l.materials?.common_name, code: l.materials?.code, minimum: n(l.materials?.minimum_stock), unit: l.unit, stock: 0 }
    acc[id].stock += n(l.available_quantity); return acc
  }, {})
  const mpItems = Object.values(mpMap).map(m => ({ ...m, alert: m.minimum > 0 && m.stock <= m.minimum })).sort((a, b) => a.alert ? -1 : 1)

  // ── Revenue por día ────────────────────────────────────────────────────────
  const revOrders = revenueByDayRes.status === 'fulfilled' ? revenueByDayRes.value.data || [] : []
  const revenueByDay = {}
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    revenueByDay[d] = 0
  }
  revOrders.forEach(o => {
    const d = o.created_at.slice(0, 10)
    if (revenueByDay[d] !== undefined) revenueByDay[d] += n(o.total)
  })
  const revenueChart = Object.entries(revenueByDay).map(([date, value]) => ({ date, value }))

  // ── Procesos MP activos ────────────────────────────────────────────────────
  const processRuns = processRunsRes.status === 'fulfilled' ? processRunsRes.value.data || [] : []

  // ── OC pendientes ──────────────────────────────────────────────────────────
  const pendingPOs = purchaseOrdersRes.status === 'fulfilled' ? purchaseOrdersRes.value.data || [] : []

  return {
    orders: { byStatus: ordersByStatus, total: orders.length, totalRevenue, pendingRevenue },
    inventory: { items: inventoryItems, totalUnits: totalFinishedUnits },
    expiringLots,
    topProducts,
    mpItems,
    revenueChart,
    processRuns,
    pendingPOs,
  }
}

// ─── Dashboard Financiero ─────────────────────────────────────────────────────

export async function getFinancieroDashboard() {
  const orgId  = await getOrgId()
  const today  = new Date().toISOString().slice(0, 10)
  const m1     = today.slice(0, 7) + '-01'

  const [
    cxcRes,
    cxpRes,
    gastosRes,
    cobradoRes,
    quotesRes,
    revenueMonthRes,
  ] = await Promise.allSettled([

    // 1. CxC — pedidos facturado/en_logistica/entregado
    supabase
      .from('orders')
      .select('id, total, created_at, clients(credit_days)')
      .eq('organization_id', orgId)
      .in('status', ['facturado', 'en_logistica', 'entregado']),

    // 2. CxP — purchase_orders pendiente
    supabase
      .from('purchase_orders')
      .select('id, created_at, payment_status, purchase_order_items(quantity, unit_cost), suppliers(payment_days)')
      .eq('organization_id', orgId)
      .eq('payment_status', 'pendiente'),

    // 3. Gastos del mes
    supabase
      .from('expenses')
      .select('amount, expense_type, expense_date, cost_centers(code, name)')
      .eq('organization_id', orgId)
      .gte('expense_date', m1)
      .lte('expense_date', today),

    // 4. Revenue cobrado total
    supabase
      .from('orders')
      .select('total, status')
      .eq('organization_id', orgId)
      .in('status', ['cobrado', 'facturado', 'en_logistica', 'entregado']),

    // 5. Cotizaciones activas
    supabase
      .from('quotes')
      .select('status')
      .eq('organization_id', orgId),

    // 6. Revenue mes actual
    supabase
      .from('orders')
      .select('created_at, total, status')
      .eq('organization_id', orgId)
      .gte('created_at', m1)
      .lte('created_at', today + 'T23:59:59')
      .in('status', ['facturado', 'en_logistica', 'entregado', 'cobrado']),
  ])

  // ── CxC ───────────────────────────────────────────────────────────────────
  const cxcOrders = cxcRes.status === 'fulfilled' ? cxcRes.value.data || [] : []
  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0)

  let cxcTotal = 0, cxcVencido = 0, cxcAlDia = 0
  const cxcAging = { alDia: 0, d30: 0, d60: 0, d90: 0, dMas: 0 }

  cxcOrders.forEach(o => {
    const total = n(o.total)
    cxcTotal += total
    const creditDays = n(o.clients?.credit_days)
    const due = new Date(o.created_at)
    due.setDate(due.getDate() + creditDays)
    const overdue = Math.floor((todayDate - due) / 86400000)
    if (overdue <= 0)       { cxcAlDia += total; cxcAging.alDia += total }
    else                    { cxcVencido += total }
    if      (overdue > 90)  cxcAging.dMas += total
    else if (overdue > 60)  cxcAging.d90  += total
    else if (overdue > 30)  cxcAging.d60  += total
    else if (overdue > 0)   cxcAging.d30  += total
  })

  // ── CxP ───────────────────────────────────────────────────────────────────
  const cxpOrders = cxpRes.status === 'fulfilled' ? cxpRes.value.data || [] : []
  let cxpTotal = 0, cxpVencido = 0

  cxpOrders.forEach(po => {
    const total = (po.purchase_order_items || []).reduce((a, i) => a + n(i.quantity) * n(i.unit_cost), 0)
    cxpTotal += total
    const payDays = n(po.suppliers?.payment_days) || 30
    const due = new Date(po.created_at)
    due.setDate(due.getDate() + payDays)
    const overdue = Math.floor((todayDate - due) / 86400000)
    if (overdue > 0) cxpVencido += total
  })

  // ── Gastos mes ────────────────────────────────────────────────────────────
  const gastos = gastosRes.status === 'fulfilled' ? gastosRes.value.data || [] : []
  const gastosMes = gastos.reduce((a, g) => a + n(g.amount), 0)

  const gastosPorCC = {}
  gastos.forEach(g => {
    const code = g.cost_centers?.code || 'N/A'
    const name = g.cost_centers?.name || 'Sin CC'
    if (!gastosPorCC[code]) gastosPorCC[code] = { code, name, total: 0 }
    gastosPorCC[code].total += n(g.amount)
  })
  const gastosCCList = Object.values(gastosPorCC).sort((a, b) => b.total - a.total)

  // ── Revenue cobrado vs facturado ──────────────────────────────────────────
  const revRows = cobradoRes.status === 'fulfilled' ? cobradoRes.value.data || [] : []
  const revCobrado   = revRows.filter(r => r.status === 'cobrado').reduce((a, r) => a + n(r.total), 0)
  const revPendiente = revRows.filter(r => r.status !== 'cobrado').reduce((a, r) => a + n(r.total), 0)

  // ── Cotizaciones ──────────────────────────────────────────────────────────
  const quotes = quotesRes.status === 'fulfilled' ? quotesRes.value.data || [] : []
  const quotesStats = {
    emitidas:   quotes.filter(q => q.status === 'emitida').length,
    aceptadas:  quotes.filter(q => ['aceptada','convertida'].includes(q.status)).length,
    total:      quotes.length,
  }

  // ── Revenue mes (días del mes) ────────────────────────────────────────────
  const revMes = revenueMonthRes.status === 'fulfilled' ? revenueMonthRes.value.data || [] : []
  const revMesTotal = revMes.reduce((a, o) => a + n(o.total), 0)

  return {
    cxc:    { total: cxcTotal, vencido: cxcVencido, alDia: cxcAlDia, aging: cxcAging, count: cxcOrders.length },
    cxp:    { total: cxpTotal, vencido: cxpVencido, count: cxpOrders.length },
    gastos: { mes: gastosMes, porCC: gastosCCList },
    revenue:{ cobrado: revCobrado, pendiente: revPendiente },
    quotes: quotesStats,
    revMes: revMesTotal,
  }
}

// Mantener compatibilidad con cualquier import existente
export async function getDashboardData() {
  return getOperativoDashboard()
}

// ─── KPI Costo Mano de Obra por Libra ────────────────────────────────────────

export async function getKpiManoObra() {
  const orgId   = await getOrgId()
  const hoy     = new Date().toISOString().slice(0, 10)
  const hace7d  = new Date(Date.now() -  6 * 86400000).toISOString().slice(0, 10)
  const hace30d = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)

  const [kpiHoyRes, hist7Res, hist30Res, tendenciaRes] = await Promise.allSettled([
    // KPI de hoy (puede venir null si aún no se calculó)
    supabase
      .from('kpi_costo_laboral_diario')
      .select('*')
      .eq('organization_id', orgId)
      .eq('fecha', hoy)
      .single(),

    // Últimos 7 días para promedio
    supabase
      .from('kpi_costo_laboral_diario')
      .select('costo_mano_obra_por_libra, costo_laboral_total_dia, libras_producidas_dia')
      .eq('organization_id', orgId)
      .gte('fecha', hace7d)
      .lt('fecha', hoy)
      .not('costo_mano_obra_por_libra', 'is', null),

    // Últimos 30 días para promedio
    supabase
      .from('kpi_costo_laboral_diario')
      .select('costo_mano_obra_por_libra')
      .eq('organization_id', orgId)
      .gte('fecha', hace30d)
      .lt('fecha', hoy)
      .not('costo_mano_obra_por_libra', 'is', null),

    // Tendencia últimos 14 días (para mini-gráfica)
    supabase
      .from('kpi_costo_laboral_diario')
      .select('fecha, costo_mano_obra_por_libra, costo_laboral_total_dia, libras_producidas_dia, total_colaboradores_marcados, observacion_inconsistencia')
      .eq('organization_id', orgId)
      .gte('fecha', new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10))
      .order('fecha', { ascending: true }),
  ])

  const kpiHoy  = kpiHoyRes.status  === 'fulfilled' ? kpiHoyRes.value.data  : null
  const hist7   = hist7Res.status   === 'fulfilled' ? hist7Res.value.data   || [] : []
  const hist30  = hist30Res.status  === 'fulfilled' ? hist30Res.value.data  || [] : []
  const raw14   = tendenciaRes.status === 'fulfilled' ? tendenciaRes.value.data || [] : []

  // Rellenar días vacíos para la mini gráfica de 14 días
  const mapa14 = {}
  raw14.forEach(d => { mapa14[d.fecha] = d })
  const tendencia14 = []
  for (let i = 13; i >= 0; i--) {
    const f = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    tendencia14.push(mapa14[f] || { fecha: f, costo_mano_obra_por_libra: null, costo_laboral_total_dia: 0, libras_producidas_dia: 0, total_colaboradores_marcados: 0 })
  }

  const prom7d  = hist7.length  > 0 ? Math.round(hist7.reduce((a, d) => a + n(d.costo_mano_obra_por_libra), 0) / hist7.length * 10000) / 10000  : null
  const prom30d = hist30.length > 0 ? Math.round(hist30.reduce((a, d) => a + n(d.costo_mano_obra_por_libra), 0) / hist30.length * 10000) / 10000 : null

  const kpiHoyVal = n(kpiHoy?.costo_mano_obra_por_libra)
  const tendencia = prom7d && kpiHoyVal
    ? kpiHoyVal < prom7d * 0.97 ? 'bajo' : kpiHoyVal > prom7d * 1.03 ? 'alto' : 'normal'
    : 'sin_datos'

  return {
    hoy:         kpiHoy,
    prom7d,
    prom30d,
    tendencia,
    tendencia14,
  }
}
