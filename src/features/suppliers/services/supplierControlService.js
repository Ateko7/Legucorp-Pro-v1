import { supabase } from '../../../lib/supabase'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function round(value, precision = 2) {
  const base = 10 ** precision
  return Math.round((n(value) + Number.EPSILON) * base) / base
}

function pct(value, total) {
  if (n(total) <= 0) return 0
  return round((n(value) / n(total)) * 100, 2)
}

function safeDate(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function getScoreSemaphore(score) {
  if (score >= 85) return 'green'
  if (score >= 70) return 'yellow'
  return 'red'
}

async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('No se pudo obtener el usuario autenticado')
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message || 'No se pudo cargar el perfil')
  if (!data?.organization_id) throw new Error('El usuario no tiene organización asignada')

  return data
}

function buildPriceHistoryRowsFromOrders(purchaseOrders = [], organizationId, userId) {
  return purchaseOrders.flatMap((order) =>
    (order.purchase_order_items || [])
      .filter((item) => item?.id)
      .map((item) => ({
        organization_id: organizationId,
        supplier_id: order.supplier_id,
        material_id: item.material_id || null,
        purchase_order_id: order.id,
        purchase_order_item_id: item.id,
        effective_date: safeDate(order.delivery_date || order.created_at) || safeDate(new Date().toISOString()),
        unit_price: n(item.unit_cost),
        volume: n(item.quantity),
        unit: item.unit || item.materials?.base_unit || 'unidad',
        source_type: 'purchase_order',
        created_by: userId,
        updated_at: new Date().toISOString(),
      })),
  )
}

async function syncSupplierPriceHistory(organizationId, userId) {
  const { data: purchaseOrders, error } = await supabase
    .from('purchase_orders')
    .select(`
      id,
      supplier_id,
      delivery_date,
      created_at,
      purchase_order_items (
        id,
        material_id,
        quantity,
        unit,
        unit_cost,
        materials (
          id,
          code,
          common_name,
          base_unit
        )
      )
    `)
    .eq('organization_id', organizationId)

  if (error) throw new Error(error.message || 'No se pudo sincronizar el historial de precios')

  const rows = buildPriceHistoryRowsFromOrders(purchaseOrders || [], organizationId, userId)
  if (!rows.length) return []

  const { error: upsertError } = await supabase
    .from('supplier_price_history')
    .upsert(rows, { onConflict: 'purchase_order_item_id' })

  if (upsertError) throw new Error(upsertError.message || 'No se pudo actualizar el historial de precios')

  return rows
}

function buildGeneratedAlerts(metrics) {
  const alerts = []

  if (metrics.qualityPct < 90 && metrics.deliveriesTotal > 0) {
    alerts.push({
      alert_type: 'baja_calidad',
      severity: metrics.qualityPct < 80 ? 'danger' : 'warning',
      title: 'Calidad del proveedor en riesgo',
      message: `La aceptación está en ${metrics.qualityPct.toFixed(2)}%.`,
      metric_value: metrics.qualityPct,
    })
  }

  if (metrics.onTimePct < 85 && metrics.deliveriesTotal > 0) {
    alerts.push({
      alert_type: 'entrega_tardia',
      severity: metrics.onTimePct < 70 ? 'danger' : 'warning',
      title: 'Entregas tardías recurrentes',
      message: `Sólo ${metrics.onTimePct.toFixed(2)}% de las recepciones llegaron a tiempo.`,
      metric_value: metrics.onTimePct,
    })
  }

  if (metrics.priceVariationPct > 12) {
    alerts.push({
      alert_type: 'variacion_precio',
      severity: metrics.priceVariationPct > 20 ? 'danger' : 'warning',
      title: 'Variación de precio elevada',
      message: `La desviación contra el promedio histórico es ${metrics.priceVariationPct.toFixed(2)}%.`,
      metric_value: metrics.priceVariationPct,
    })
  }

  if (metrics.claimsTotal >= 3 || metrics.claimsRatePct > 5) {
    alerts.push({
      alert_type: 'muchos_reclamos',
      severity: metrics.claimsRatePct > 10 ? 'danger' : 'warning',
      title: 'Reclamos por encima del rango esperado',
      message: `${metrics.claimsTotal} reclamo(s), equivalente a ${metrics.claimsRatePct.toFixed(2)}% sobre recepciones.`,
      metric_value: metrics.claimsRatePct,
    })
  }

  if (metrics.programsAtRisk > 0) {
    alerts.push({
      alert_type: 'incumplimiento_programa',
      severity: metrics.programsAtRisk > 1 ? 'danger' : 'warning',
      title: 'Programa agrícola con riesgo',
      message: `${metrics.programsAtRisk} programa(s) muestran subentrega o cierre comprometido.`,
      metric_value: metrics.programsAtRisk,
    })
  }

  if (metrics.fiscalInvoicedPct < metrics.taxAlertThresholdPct && metrics.totalFiscalPurchases > 0) {
    alerts.push({
      alert_type: 'riesgo_fiscal',
      severity: metrics.fiscalInvoicedPct < 50 ? 'danger' : 'warning',
      title: 'Riesgo fiscal por bajo respaldo',
      message: `Sólo ${metrics.fiscalInvoicedPct.toFixed(2)}% de las compras tiene factura cargada.`,
      metric_value: metrics.fiscalInvoicedPct,
    })
  }

  return alerts
}

async function replaceGeneratedSupplierAlerts(profile, suppliers = []) {
  const supplierIds = suppliers.map((supplier) => supplier.id).filter(Boolean)
  if (!supplierIds.length) return

  const { error: deleteError } = await supabase
    .from('supplier_alerts')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('generated_by_system', true)
    .in('supplier_id', supplierIds)

  if (deleteError) throw new Error(deleteError.message || 'No se pudieron refrescar las alertas')

  const rows = suppliers.flatMap((supplier) =>
    (supplier.generatedAlerts || []).map((alert) => ({
      organization_id: profile.organization_id,
      supplier_id: supplier.id,
      alert_type: alert.alert_type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      metric_value: alert.metric_value ?? null,
      generated_by_system: true,
      status: 'abierta',
      context: {
        score: supplier.globalScore,
        semaphore: supplier.semaphore,
      },
      created_by: profile.id,
      updated_at: new Date().toISOString(),
    })),
  )

  if (!rows.length) return

  const { error: insertError } = await supabase
    .from('supplier_alerts')
    .insert(rows)

  if (insertError) throw new Error(insertError.message || 'No se pudieron guardar las alertas del proveedor')
}

async function persistScorecards(profile, suppliers = []) {
  const rows = suppliers
    .filter((supplier) => supplier.id)
    .map((supplier) => ({
      organization_id: profile.organization_id,
      supplier_id: supplier.id,
      deliveries_total: supplier.deliveriesTotal,
      deliveries_on_time: supplier.deliveriesOnTime,
      on_time_pct: supplier.onTimePct,
      quality_received_qty: supplier.qualityReceivedQty,
      quality_accepted_qty: supplier.qualityAcceptedQty,
      quality_pct: supplier.qualityPct,
      price_variation_pct: supplier.priceVariationPct,
      claims_total: supplier.claimsTotal,
      claims_rate_pct: supplier.claimsRatePct,
      programs_total: supplier.programsTotal,
      programs_at_risk: supplier.programsAtRisk,
      fiscal_invoiced_pct: supplier.fiscalInvoicedPct,
      global_score: supplier.globalScore,
      semaphore: supplier.semaphore,
      metadata: {
        openClaims: supplier.openClaims,
        averageUnitPrice: supplier.averageUnitPrice,
      },
      last_computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

  if (!rows.length) return

  const { error } = await supabase
    .from('supplier_scorecards')
    .upsert(rows, { onConflict: 'supplier_id' })

  if (error) throw new Error(error.message || 'No se pudieron guardar los scorecards de proveedores')
}

function buildProgramsSummary(programs = [], receptions = []) {
  const receptionByProgram = new Map()
  const receptionByDelivery = new Map()

  ;(receptions || []).forEach((row) => {
    const accepted = n(row.quantity_accepted)
    const received = n(row.quantity_received)
    const qty = accepted > 0 ? accepted : received

    if (row.programa_agricola_id) {
      receptionByProgram.set(
        row.programa_agricola_id,
        n(receptionByProgram.get(row.programa_agricola_id)) + qty,
      )
    }

    if (row.programa_entrega_id) {
      receptionByDelivery.set(
        row.programa_entrega_id,
        n(receptionByDelivery.get(row.programa_entrega_id)) + qty,
      )
    }
  })

  return (programs || []).map((program) => {
    const deliveries = (program.programa_entregas || []).map((delivery) => {
      const receivedQty = receptionByDelivery.has(delivery.id)
        ? n(receptionByDelivery.get(delivery.id))
        : n(delivery.received_quantity)

      const status = receivedQty > n(delivery.planned_quantity)
        ? 'sobreentrega'
        : receivedQty >= n(delivery.planned_quantity) && n(delivery.planned_quantity) > 0
          ? 'cumplida'
          : receivedQty > 0
            ? 'parcial'
            : safeDate(delivery.scheduled_date) < safeDate(new Date().toISOString())
              ? 'incumplida'
              : delivery.status || 'pendiente'

      return {
        ...delivery,
        received_quantity: receivedQty,
        computed_status: status,
      }
    })

    const deliveredTotal = receptionByProgram.has(program.id)
      ? n(receptionByProgram.get(program.id))
      : deliveries.reduce((acc, delivery) => acc + n(delivery.received_quantity), 0)

    const committedTotal = n(program.quantity_committed_total)
    const compliancePct = pct(deliveredTotal, committedTotal)
    const overdueCount = deliveries.filter((delivery) => delivery.computed_status === 'incumplida').length
    const riskLevel = overdueCount > 0 || compliancePct < 90 ? 'risk' : compliancePct > 105 ? 'oversupply' : 'ok'

    return {
      ...program,
      delivered_total: round(deliveredTotal, 4),
      compliance_pct: compliancePct,
      overdue_count: overdueCount,
      risk_level: riskLevel,
      deliveries,
    }
  })
}

export async function getSupplierControlDashboard() {
  const profile = await getProfile()
  await syncSupplierPriceHistory(profile.organization_id, profile.id)

  const [
    suppliersRes,
    programsRes,
    receptionsRes,
    priceHistoryRes,
    fiscalRes,
    claimsRes,
    accountsPayableRes,
    alertsRes,
  ] = await Promise.all([
    supabase
      .from('suppliers')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('name', { ascending: true }),
    supabase
      .from('programas_agricolas')
      .select(`
        id,
        supplier_id,
        material_id,
        program_code,
        quantity_committed_total,
        unit,
        start_date,
        end_date,
        delivery_frequency,
        status,
        notes,
        materials (
          id,
          code,
          common_name
        ),
        programa_entregas (
          id,
          scheduled_date,
          planned_quantity,
          received_quantity,
          ordered_quantity,
          status,
          purchase_order_id
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('material_receptions')
      .select(`
        id,
        supplier_id,
        material_id,
        purchase_order_id,
        received_date,
        quantity_received,
        quantity_accepted,
        quantity_rejected,
        unit,
        quality_notes,
        unit_cost,
        programa_agricola_id,
        programa_entrega_id,
        materials (
          id,
          code,
          common_name
        ),
        purchase_orders (
          id,
          delivery_date,
          order_number
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('received_date', { ascending: false }),
    supabase
      .from('supplier_price_history')
      .select(`
        *,
        materials (
          id,
          code,
          common_name,
          base_unit
        ),
        suppliers (
          id,
          name
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('effective_date', { ascending: false }),
    supabase
      .from('supplier_fiscal_classifications')
      .select('*')
      .eq('organization_id', profile.organization_id),
    supabase
      .from('supplier_claims')
      .select(`
        *,
        materials (
          id,
          code,
          common_name
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('claim_date', { ascending: false }),
    supabase
      .from('supplier_accounts_payable')
      .select(`
        id,
        supplier_id,
        status,
        payable_amount,
        net_payable_amount,
        invoice_total_amount,
        invoice_number,
        invoice_file_url,
        created_at,
        updated_at
      `)
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('supplier_alerts')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
  ])

  if (suppliersRes.error) throw new Error(suppliersRes.error.message)
  if (programsRes.error) throw new Error(programsRes.error.message)
  if (receptionsRes.error) throw new Error(receptionsRes.error.message)
  if (priceHistoryRes.error) throw new Error(priceHistoryRes.error.message)
  if (fiscalRes.error) throw new Error(fiscalRes.error.message)
  if (claimsRes.error) throw new Error(claimsRes.error.message)
  if (accountsPayableRes.error) throw new Error(accountsPayableRes.error.message)
  if (alertsRes.error) throw new Error(alertsRes.error.message)

  const suppliers = suppliersRes.data || []
  const programs = buildProgramsSummary(programsRes.data || [], receptionsRes.data || [])
  const receptions = receptionsRes.data || []
  const priceHistory = priceHistoryRes.data || []
  const fiscalProfiles = fiscalRes.data || []
  const claims = claimsRes.data || []
  const accountsPayable = accountsPayableRes.data || []
  const persistedAlerts = alertsRes.data || []

  const marketPriceByMaterial = {}
  priceHistory.forEach((row) => {
    const key = row.material_id || 'sin_material'
    if (!marketPriceByMaterial[key]) {
      marketPriceByMaterial[key] = { sum: 0, count: 0 }
    }
    marketPriceByMaterial[key].sum += n(row.unit_price)
    marketPriceByMaterial[key].count += 1
  })

  const priceRows = priceHistory.map((row) => {
    const market = marketPriceByMaterial[row.material_id || 'sin_material']
    const marketAvg = market?.count ? market.sum / market.count : n(row.unit_price)
    return {
      ...row,
      market_avg_price: round(marketAvg, 4),
      price_variation_pct: marketAvg > 0 ? round(((n(row.unit_price) - marketAvg) / marketAvg) * 100, 2) : 0,
    }
  })

  const programsBySupplier = new Map()
  programs.forEach((program) => {
    const supplierKey = program.supplier_id
    if (!programsBySupplier.has(supplierKey)) programsBySupplier.set(supplierKey, [])
    programsBySupplier.get(supplierKey).push(program)
  })

  const receptionsBySupplier = new Map()
  receptions.forEach((reception) => {
    const supplierKey = reception.supplier_id
    if (!receptionsBySupplier.has(supplierKey)) receptionsBySupplier.set(supplierKey, [])
    receptionsBySupplier.get(supplierKey).push(reception)
  })

  const claimsBySupplier = new Map()
  claims.forEach((claim) => {
    const supplierKey = claim.supplier_id
    if (!claimsBySupplier.has(supplierKey)) claimsBySupplier.set(supplierKey, [])
    claimsBySupplier.get(supplierKey).push(claim)
  })

  const fiscalBySupplier = new Map(fiscalProfiles.map((row) => [row.supplier_id, row]))
  const accountsBySupplier = new Map()
  accountsPayable.forEach((row) => {
    if (!accountsBySupplier.has(row.supplier_id)) accountsBySupplier.set(row.supplier_id, [])
    accountsBySupplier.get(row.supplier_id).push(row)
  })

  const alertsBySupplier = new Map()
  persistedAlerts.forEach((row) => {
    if (!alertsBySupplier.has(row.supplier_id)) alertsBySupplier.set(row.supplier_id, [])
    alertsBySupplier.get(row.supplier_id).push(row)
  })

  const pricesBySupplier = new Map()
  priceRows.forEach((row) => {
    const supplierKey = row.supplier_id
    if (!pricesBySupplier.has(supplierKey)) pricesBySupplier.set(supplierKey, [])
    pricesBySupplier.get(supplierKey).push(row)
  })

  const enrichedSuppliers = suppliers.map((supplier) => {
    const supplierReceptions = receptionsBySupplier.get(supplier.id) || []
    const supplierPrograms = programsBySupplier.get(supplier.id) || []
    const supplierClaims = claimsBySupplier.get(supplier.id) || []
    const supplierFiscal = fiscalBySupplier.get(supplier.id) || null
    const supplierAccounts = accountsBySupplier.get(supplier.id) || []
    const supplierPrices = pricesBySupplier.get(supplier.id) || []

    const deliveriesTotal = supplierReceptions.length
    const deliveriesOnTime = supplierReceptions.filter((row) => {
      const promised = safeDate(row.purchase_orders?.delivery_date)
      const received = safeDate(row.received_date)
      return !promised || !received || received <= promised
    }).length

    const qualityReceivedQty = supplierReceptions.reduce((acc, row) => acc + n(row.quantity_received), 0)
    const qualityAcceptedQty = supplierReceptions.reduce((acc, row) => acc + n(row.quantity_accepted), 0)
    const onTimePct = pct(deliveriesOnTime, deliveriesTotal)
    const qualityPct = pct(qualityAcceptedQty, qualityReceivedQty)
    const priceVariationPct = supplierPrices.length
      ? round(
          supplierPrices.reduce((acc, row) => acc + Math.abs(n(row.price_variation_pct)), 0) / supplierPrices.length,
          2,
        )
      : 0

    const claimsTotal = supplierClaims.filter((claim) => claim.status !== 'anulado').length
    const openClaims = supplierClaims.filter((claim) => ['abierto', 'investigacion'].includes(claim.status)).length
    const claimsRatePct = pct(claimsTotal, deliveriesTotal)

    const programsTotal = supplierPrograms.length
    const programsAtRisk = supplierPrograms.filter((program) => program.risk_level === 'risk').length

    const totalFiscalPurchases = supplierAccounts.reduce(
      (acc, row) => acc + (n(row.invoice_total_amount) || n(row.net_payable_amount) || n(row.payable_amount)),
      0,
    )
    const invoicedAmount = supplierAccounts
      .filter((row) => row.invoice_number || row.invoice_file_url)
      .reduce((acc, row) => acc + (n(row.invoice_total_amount) || n(row.net_payable_amount) || n(row.payable_amount)), 0)
    const fiscalInvoicedPct = pct(invoicedAmount, totalFiscalPurchases)
    const taxAlertThresholdPct = n(supplierFiscal?.tax_alert_threshold_pct || 80)

    const priceScore = Math.max(0, 100 - Math.min(100, priceVariationPct))
    const claimsScore = Math.max(0, 100 - Math.min(100, claimsRatePct * 4))
    const globalScore = round(
      onTimePct * 0.3 +
      qualityPct * 0.4 +
      priceScore * 0.2 +
      claimsScore * 0.1,
      2,
    )
    const semaphore = getScoreSemaphore(globalScore)
    const generatedAlerts = buildGeneratedAlerts({
      onTimePct,
      qualityPct,
      deliveriesTotal,
      priceVariationPct,
      claimsTotal,
      claimsRatePct,
      programsAtRisk,
      fiscalInvoicedPct,
      taxAlertThresholdPct,
      totalFiscalPurchases,
    })

    return {
      ...supplier,
      fiscal_profile: supplierFiscal,
      deliveriesTotal,
      deliveriesOnTime,
      onTimePct,
      qualityReceivedQty: round(qualityReceivedQty, 4),
      qualityAcceptedQty: round(qualityAcceptedQty, 4),
      qualityPct,
      priceVariationPct,
      claimsTotal,
      openClaims,
      claimsRatePct,
      programsTotal,
      programsAtRisk,
      fiscalInvoicedPct,
      totalFiscalPurchases: round(totalFiscalPurchases, 2),
      globalScore,
      semaphore,
      generatedAlerts,
      alerts: [...generatedAlerts, ...(alertsBySupplier.get(supplier.id) || []).filter((row) => !row.generated_by_system || row.status !== 'abierta')],
      programs: supplierPrograms,
      receptions: supplierReceptions,
      claims: supplierClaims,
      priceHistory: supplierPrices,
      accountsPayable: supplierAccounts,
      averageUnitPrice: supplierPrices.length
        ? round(supplierPrices.reduce((acc, row) => acc + n(row.unit_price), 0) / supplierPrices.length, 4)
        : 0,
    }
  })

  await persistScorecards(profile, enrichedSuppliers)
  await replaceGeneratedSupplierAlerts(profile, enrichedSuppliers)

  const overview = {
    activeSuppliers: enrichedSuppliers.filter((supplier) => supplier.status === 'activo').length,
    averageScore: enrichedSuppliers.length
      ? round(enrichedSuppliers.reduce((acc, supplier) => acc + n(supplier.globalScore), 0) / enrichedSuppliers.length, 2)
      : 0,
    openAlerts: enrichedSuppliers.reduce((acc, supplier) => acc + (supplier.generatedAlerts?.length || 0), 0),
    invoicedPct: pct(
      enrichedSuppliers.reduce((acc, supplier) => acc + (n(supplier.totalFiscalPurchases) * n(supplier.fiscalInvoicedPct) / 100), 0),
      enrichedSuppliers.reduce((acc, supplier) => acc + n(supplier.totalFiscalPurchases), 0),
    ),
  }

  return {
    overview,
    suppliers: enrichedSuppliers,
    programs,
    priceRows,
    fiscalProfiles,
    claims,
  }
}

export async function saveSupplierFiscalClassification(supplierId, payload) {
  const profile = await getProfile()

  const { error } = await supabase
    .from('supplier_fiscal_classifications')
    .upsert({
      organization_id: profile.organization_id,
      supplier_id: supplierId,
      billing_type: payload.billing_type || 'con_factura',
      sat_regime: payload.sat_regime || 'general',
      tax_alert_threshold_pct: n(payload.tax_alert_threshold_pct || 80),
      notes: payload.notes?.trim() || null,
      created_by: profile.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'supplier_id' })

  if (error) throw new Error(error.message || 'No se pudo guardar la clasificación fiscal')
}

export async function createSupplierClaim(payload) {
  const profile = await getProfile()

  const insertPayload = {
    organization_id: profile.organization_id,
    supplier_id: payload.supplier_id,
    material_id: payload.material_id || null,
    purchase_order_id: payload.purchase_order_id || null,
    material_reception_id: payload.material_reception_id || null,
    claim_date: payload.claim_date || safeDate(new Date().toISOString()),
    claim_type: payload.claim_type || 'calidad',
    title: String(payload.title || '').trim(),
    description: payload.description?.trim() || null,
    amount: n(payload.amount || 0),
    created_by: profile.id,
  }

  if (!insertPayload.title) {
    throw new Error('Ingresa un título para el reclamo')
  }

  const { error } = await supabase
    .from('supplier_claims')
    .insert(insertPayload)

  if (error) throw new Error(error.message || 'No se pudo crear el reclamo al proveedor')
}

export async function updateSupplierClaimStatus(claimId, status, resolutionNotes = '') {
  const profile = await getProfile()
  const nextStatus = status || 'cerrado'

  const { error } = await supabase
    .from('supplier_claims')
    .update({
      status: nextStatus,
      resolution_notes: resolutionNotes?.trim() || null,
      resolved_by: ['cerrado', 'anulado'].includes(nextStatus) ? profile.id : null,
      resolved_at: ['cerrado', 'anulado'].includes(nextStatus) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', claimId)

  if (error) throw new Error(error.message || 'No se pudo actualizar el reclamo del proveedor')
}
