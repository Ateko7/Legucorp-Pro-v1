import { supabase } from '../../../lib/supabase'
import { createPurchaseOrder } from '../../compras/Services/purchaseOrdersService'
import { createReception } from '../../recepcion/services/receptionService'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function round2(v) {
  return Math.round(n(v) * 100) / 100
}

function round4(v) {
  return Math.round(n(v) * 10000) / 10000
}

function receptionQty(row) {
  const accepted = n(row?.quantity_accepted)
  const received = n(row?.quantity_received)
  return accepted > 0 ? accepted : received
}

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('No se pudo obtener el usuario autenticado')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (profileError) throw new Error(profileError.message)
  if (!profile?.organization_id) throw new Error('El usuario no tiene organización asignada')
  return profile
}

export async function getNextProgramaAgricolaCode() {
  const profile = await getProfile()
  const prefix = 'PAG'

  const { data, error } = await supabase
    .from('programas_agricolas')
    .select('program_code')
    .eq('organization_id', profile.organization_id)
    .ilike('program_code', `${prefix}-%`)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const used = new Set(
    (data || [])
      .map((row) => String(row.program_code || '').trim().toUpperCase())
      .filter(Boolean),
  )

  for (let index = 1; index <= 99999; index += 1) {
    const candidate = `${prefix}-${String(index).padStart(4, '0')}`
    if (!used.has(candidate)) return candidate
  }

  throw new Error('No se pudo generar un codigo automatico para el programa agricola')
}

export function generateScheduledDeliveries({ start_date, end_date, delivery_frequency, quantity_committed_total }) {
  const start = start_date || new Date().toISOString().slice(0, 10)
  const end = end_date || start
  const frequency = delivery_frequency || 'semanal'
  const totalQuantity = round4(quantity_committed_total)

  if (totalQuantity <= 0) return []

  const dates = []
  let current = start
  while (current <= end) {
    dates.push(current)
    if (frequency === 'diaria') current = addDays(current, 1)
    else if (frequency === 'quincenal') current = addDays(current, 14)
    else if (frequency === 'mensual') {
      const next = new Date(`${current}T00:00:00`)
      next.setMonth(next.getMonth() + 1)
      current = formatDate(next)
    } else current = addDays(current, 7)
    if (dates.length > 366) break
  }

  if (!dates.length) dates.push(start)
  const evenQty = round4(totalQuantity / dates.length)
  let assigned = 0

  return dates.map((date, index) => {
    const isLast = index === dates.length - 1
    const planned = isLast ? round4(totalQuantity - assigned) : evenQty
    assigned = round4(assigned + planned)
    return {
      scheduled_date: date,
      planned_quantity: planned,
      status: 'pendiente',
      notes: '',
    }
  })
}

function computeDeliveryStatus(delivery, today) {
  const planned = n(delivery.planned_quantity)
  const received = n(delivery.received_quantity)
  const ordered = n(delivery.ordered_quantity)
  const difference = round4(received - planned)
  const scheduledDate = delivery.scheduled_date

  let status = delivery.status || 'pendiente'
  if (status === 'cancelada' || status === 'reprogramada') {
    return { ...delivery, difference_quantity: difference, ordered_quantity: ordered, received_quantity: received, computed_status: status }
  }

  if (received > planned) status = 'sobreentrega'
  else if (received >= planned && planned > 0) status = 'cumplida'
  else if (received > 0) status = 'parcial'
  else if (scheduledDate < today) status = 'incumplida'
  else status = 'pendiente'

  return {
    ...delivery,
    ordered_quantity: ordered,
    received_quantity: received,
    difference_quantity: difference,
    computed_status: status,
  }
}

function buildProgramAlerts(program, today) {
  const alerts = []
  const deliveries = (program.programa_entregas || []).map((row) => computeDeliveryStatus(row, today))
  const totalPlanned = round4(deliveries.reduce((acc, row) => acc + n(row.planned_quantity), 0))
  const totalReceived = round4(deliveries.reduce((acc, row) => acc + n(row.received_quantity), 0))

  if (totalReceived < totalPlanned) {
    alerts.push({ level: 'danger', type: 'subentrega_acumulada', message: `Acumulado recibido menor al plan por ${round4(totalPlanned - totalReceived)} ${program.unit}.` })
  }
  if (totalReceived > n(program.quantity_committed_total)) {
    alerts.push({ level: 'danger', type: 'sobreentrega_acumulada', message: `El acumulado supera lo comprometido por ${round4(totalReceived - n(program.quantity_committed_total))} ${program.unit}.` })
  }

  const futureWithoutPo = deliveries.filter((row) => row.scheduled_date >= today && row.scheduled_date <= addDays(today, 7) && !row.purchase_order_id && row.computed_status === 'pendiente')
  if (futureWithoutPo.length) {
    alerts.push({ level: 'warning', type: 'sin_oc_cercana', message: `${futureWithoutPo.length} entrega(s) próximas aún sin orden de compra.` })
  }

  const totalDays = Math.max(1, Math.ceil((new Date(`${program.end_date}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1)
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.ceil((new Date(`${today}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1))
  const timeProgressPct = round4((elapsedDays / totalDays) * 100)
  const volumeProgressPct = n(program.quantity_committed_total) > 0 ? round4((totalReceived / n(program.quantity_committed_total)) * 100) : 0

  if (timeProgressPct > volumeProgressPct + 15 && ['activo', 'pausado'].includes(program.status)) {
    alerts.push({ level: 'warning', type: 'riesgo_tiempo_volumen', message: `El tiempo avanza ${round2(timeProgressPct)}% y el volumen sólo ${round2(volumeProgressPct)}%.` })
  }

  const daysToEnd = Math.ceil((new Date(`${program.end_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
  const pending = Math.max(0, n(program.quantity_committed_total) - totalReceived)
  if (daysToEnd <= 14 && pending > 0) {
    alerts.push({ level: 'warning', type: 'faltante_cierre', message: `Faltan ${round4(pending)} ${program.unit} y el programa vence en ${Math.max(daysToEnd, 0)} día(s).` })
  }

  deliveries.forEach((delivery) => {
    if (n(delivery.received_quantity) < n(delivery.planned_quantity) && n(delivery.received_quantity) > 0) {
      alerts.push({ level: 'danger', type: 'subentrega', message: `${delivery.scheduled_date}: subentrega de ${round4(n(delivery.planned_quantity) - n(delivery.received_quantity))} ${program.unit}.` })
    }
    if (n(delivery.received_quantity) > n(delivery.planned_quantity)) {
      alerts.push({ level: 'danger', type: 'sobreentrega', message: `${delivery.scheduled_date}: sobreentrega de ${round4(n(delivery.received_quantity) - n(delivery.planned_quantity))} ${program.unit}.` })
    }
  })

  return alerts
}

function enrichProgram(program, receptions = []) {
  const today = new Date().toISOString().slice(0, 10)
  const receptionByDelivery = new Map()

  ;(receptions || []).forEach((row) => {
    if (!row?.programa_entrega_id) return
    receptionByDelivery.set(
      row.programa_entrega_id,
      round4(n(receptionByDelivery.get(row.programa_entrega_id)) + receptionQty(row)),
    )
  })

  const deliveries = (program.programa_entregas || [])
    .map((row) => {
      const receivedFromReceptions = receptionByDelivery.get(row.id)
      return {
        ...row,
        received_quantity: receivedFromReceptions != null ? receivedFromReceptions : row.received_quantity,
      }
    })
    .map((row) => computeDeliveryStatus(row, today))
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))

  const deliveredFromDeliveries = round4(deliveries.reduce((acc, row) => acc + n(row.received_quantity), 0))
  const undirectedReceptionsTotal = round4(
    (receptions || [])
      .filter((row) => !row?.programa_entrega_id)
      .reduce((acc, row) => acc + receptionQty(row), 0),
  )
  const deliveredTotal = round4(deliveredFromDeliveries + undirectedReceptionsTotal)
  const orderedTotal = round4(deliveries.reduce((acc, row) => acc + n(row.ordered_quantity), 0))
  const committed = round4(program.quantity_committed_total)
  const pendingTotal = round4(Math.max(0, committed - deliveredTotal))
  const deliveryStats = {
    cumplidas: deliveries.filter((row) => row.computed_status === 'cumplida').length,
    parciales: deliveries.filter((row) => row.computed_status === 'parcial').length,
    incumplidas: deliveries.filter((row) => row.computed_status === 'incumplida').length,
    reprogramadas: deliveries.filter((row) => row.computed_status === 'reprogramada').length,
    sobreentregas: deliveries.filter((row) => row.computed_status === 'sobreentrega').length,
  }
  const compliancePct = committed > 0 ? round4((deliveredTotal / committed) * 100) : 0

  const totalDays = Math.max(1, Math.ceil((new Date(`${program.end_date}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1)
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.ceil((new Date(`${today}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1))
  const timeProgressPct = round4((elapsedDays / totalDays) * 100)
  const volumeProgressPct = committed > 0 ? round4((deliveredTotal / committed) * 100) : 0

  return {
    ...program,
    programa_entregas: deliveries,
    delivered_total: deliveredTotal,
    ordered_total: orderedTotal,
    pending_total: pendingTotal,
    compliance_pct: compliancePct,
    delivery_stats: deliveryStats,
    time_progress_pct: timeProgressPct,
    volume_progress_pct: volumeProgressPct,
    orphan_receptions_total: undirectedReceptionsTotal,
    alerts: buildProgramAlerts({ ...program, programa_entregas: deliveries }, today),
  }
}

export async function getProgramCatalogs() {
  const profile = await getProfile()
  const [suppliersRes, materialsRes] = await Promise.all([
    supabase
      .from('suppliers')
      .select('id, name')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('name'),
    supabase
      .from('materials')
      .select('id, code, common_name, base_unit')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('common_name'),
  ])

  if (suppliersRes.error) throw new Error(suppliersRes.error.message)
  if (materialsRes.error) throw new Error(materialsRes.error.message)

  return {
    suppliers: suppliersRes.data || [],
    materials: materialsRes.data || [],
  }
}

export async function getProgramasAgricolas() {
  const profile = await getProfile()
  const [programsRes, receptionsRes] = await Promise.all([
    supabase
      .from('programas_agricolas')
      .select(`
        *,
        suppliers ( id, name ),
        materials ( id, code, common_name, base_unit ),
        programa_entregas (
          *,
          purchase_orders:purchase_orders!programa_entregas_purchase_order_id_fkey (
            id, order_number, status, delivery_date
          )
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('material_receptions')
      .select('programa_agricola_id, programa_entrega_id, quantity_received, quantity_accepted')
      .eq('organization_id', profile.organization_id)
      .not('programa_agricola_id', 'is', null),
  ])

  if (programsRes.error) throw new Error(programsRes.error.message)
  if (receptionsRes.error) throw new Error(receptionsRes.error.message)

  const receptionsByProgram = new Map()
  ;(receptionsRes.data || []).forEach((row) => {
    const key = row.programa_agricola_id
    if (!key) return
    const current = receptionsByProgram.get(key) || []
    current.push(row)
    receptionsByProgram.set(key, current)
  })

  return (programsRes.data || []).map((program) => enrichProgram(program, receptionsByProgram.get(program.id) || []))
}

export async function getProgramaAgricolaDetail(programId) {
  const profile = await getProfile()
  const [programRes, receptionsRes, lotsRes, adjustmentsRes] = await Promise.all([
    supabase
      .from('programas_agricolas')
      .select(`
        *,
        suppliers ( id, name ),
        materials ( id, code, common_name, base_unit ),
        programa_entregas (
          *,
          purchase_orders:purchase_orders!programa_entregas_purchase_order_id_fkey (
            id, order_number, status, delivery_date, created_at
          )
        )
      `)
      .eq('organization_id', profile.organization_id)
      .eq('id', programId)
      .single(),
    supabase
      .from('material_receptions')
      .select(`
        *,
        suppliers ( id, name ),
        purchase_orders ( id, order_number, status ),
        profiles:created_by ( id, full_name )
      `)
      .eq('organization_id', profile.organization_id)
      .eq('programa_agricola_id', programId)
      .order('received_date', { ascending: false }),
    supabase
      .from('material_inventory_lots')
      .select('id, internal_lot, available_quantity, original_quantity, unit, status, reception_id, programa_entrega_id, created_at')
      .eq('organization_id', profile.organization_id)
      .eq('programa_agricola_id', programId)
      .order('created_at', { ascending: false }),
    supabase
      .from('programa_reajustes')
      .select('*, profiles:created_by ( id, full_name )')
      .eq('organization_id', profile.organization_id)
      .eq('programa_id', programId)
      .order('adjustment_date', { ascending: false }),
  ])

  if (programRes.error) throw new Error(programRes.error.message)
  if (receptionsRes.error) throw new Error(receptionsRes.error.message)
  if (lotsRes.error) throw new Error(lotsRes.error.message)
  if (adjustmentsRes.error) throw new Error(adjustmentsRes.error.message)

  const enriched = enrichProgram(programRes.data, receptionsRes.data || [])
  return {
    ...enriched,
    receptions: receptionsRes.data || [],
    inventoryLots: lotsRes.data || [],
    adjustments: adjustmentsRes.data || [],
  }
}

export async function saveProgramaAgricola(programData) {
  const profile = await getProfile()
  const resolvedProgramCode = programData.id
    ? String(programData.program_code || '').trim().toUpperCase()
    : (String(programData.program_code || '').trim().toUpperCase() || await getNextProgramaAgricolaCode())
  const deliveries = (programData.deliveries || [])
    .filter((row) => row.scheduled_date && n(row.planned_quantity) > 0)
    .map((row) => ({
      id: row.id || undefined,
      organization_id: profile.organization_id,
      scheduled_date: row.scheduled_date,
      planned_quantity: round4(row.planned_quantity),
      received_quantity: round4(row.received_quantity),
      ordered_quantity: round4(row.ordered_quantity),
      difference_quantity: round4(n(row.received_quantity) - n(row.planned_quantity)),
      status: row.status || 'pendiente',
      purchase_order_id: row.purchase_order_id || null,
      notes: row.notes || null,
      created_by: profile.id,
    }))

  const payload = {
    organization_id: profile.organization_id,
    supplier_id: programData.supplier_id,
    material_id: programData.material_id,
    program_code: resolvedProgramCode,
    quantity_committed_total: round4(programData.quantity_committed_total),
    unit: String(programData.unit || '').trim(),
    start_date: programData.start_date,
    end_date: programData.end_date,
    delivery_frequency: programData.delivery_frequency || 'semanal',
    status: programData.status || 'borrador',
    notes: String(programData.notes || '').trim() || null,
    updated_at: new Date().toISOString(),
  }

  if (!payload.supplier_id) throw new Error('Proveedor requerido')
  if (!payload.material_id) throw new Error('Producto requerido')
  if (!payload.program_code) throw new Error('No se pudo generar el codigo del programa')
  if (!payload.start_date || !payload.end_date) throw new Error('Fechas requeridas')
  if (n(payload.quantity_committed_total) <= 0) throw new Error('La cantidad comprometida debe ser mayor a 0')

  let programId = programData.id

  if (programData.id) {
    const { error } = await supabase
      .from('programas_agricolas')
      .update(payload)
      .eq('id', programData.id)
      .eq('organization_id', profile.organization_id)
    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await supabase
      .from('programas_agricolas')
      .insert({ ...payload, created_by: profile.id })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    programId = data.id
  }

  const existingRes = await supabase
    .from('programa_entregas')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('programa_id', programId)
  if (existingRes.error) throw new Error(existingRes.error.message)
  const existingIds = new Set((existingRes.data || []).map((row) => row.id))
  const keepIds = new Set(deliveries.map((row) => row.id).filter(Boolean))

  const deleteIds = [...existingIds].filter((id) => !keepIds.has(id))
  if (deleteIds.length) {
    const { error: deleteError } = await supabase
      .from('programa_entregas')
      .delete()
      .in('id', deleteIds)
      .eq('organization_id', profile.organization_id)
      .eq('programa_id', programId)
    if (deleteError) throw new Error(deleteError.message)
  }

  if (deliveries.length) {
    const { error: upsertError } = await supabase
      .from('programa_entregas')
      .upsert(
        deliveries.map((row) => ({
          ...row,
          programa_id: programId,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'id', ignoreDuplicates: false },
      )
    if (upsertError) throw new Error(upsertError.message)
  }

  return programId
}

export async function reajustarPrograma(programId, { reason, futureDeliveries }) {
  const profile = await getProfile()
  const detail = await getProgramaAgricolaDetail(programId)
  const today = new Date().toISOString().slice(0, 10)
  const protectedIds = new Set(
    (detail.programa_entregas || [])
      .filter((row) => row.scheduled_date < today || n(row.received_quantity) > 0)
      .map((row) => row.id),
  )

  const normalized = (futureDeliveries || [])
    .filter((row) => row.scheduled_date && n(row.planned_quantity) > 0)
    .map((row) => ({
      id: row.id || undefined,
      organization_id: profile.organization_id,
      programa_id: programId,
      scheduled_date: row.scheduled_date,
      planned_quantity: round4(row.planned_quantity),
      received_quantity: round4(row.received_quantity),
      ordered_quantity: round4(row.ordered_quantity),
      difference_quantity: round4(n(row.received_quantity) - n(row.planned_quantity)),
      status: row.status || 'pendiente',
      purchase_order_id: row.purchase_order_id || null,
      notes: row.notes || null,
      created_by: profile.id,
      updated_at: new Date().toISOString(),
    }))

  const futureExisting = (detail.programa_entregas || []).filter((row) => !protectedIds.has(row.id))
  const previousValues = futureExisting.map((row) => ({
    id: row.id,
    scheduled_date: row.scheduled_date,
    planned_quantity: row.planned_quantity,
    received_quantity: row.received_quantity,
    ordered_quantity: row.ordered_quantity,
    status: row.computed_status || row.status,
    purchase_order_id: row.purchase_order_id || null,
  }))

  const futureExistingIds = new Set(futureExisting.map((row) => row.id))
  const keepIds = new Set(normalized.map((row) => row.id).filter(Boolean))
  const deleteIds = [...futureExistingIds].filter((id) => !keepIds.has(id))

  if (deleteIds.length) {
    const { error: deleteError } = await supabase
      .from('programa_entregas')
      .delete()
      .in('id', deleteIds)
      .eq('organization_id', profile.organization_id)
      .eq('programa_id', programId)
    if (deleteError) throw new Error(deleteError.message)
  }

  if (normalized.length) {
    const { error: upsertError } = await supabase
      .from('programa_entregas')
      .upsert(normalized, { onConflict: 'id', ignoreDuplicates: false })
    if (upsertError) throw new Error(upsertError.message)
  }

  const newCommitted = round4(
    (detail.programa_entregas || [])
      .filter((row) => protectedIds.has(row.id))
      .reduce((acc, row) => acc + n(row.planned_quantity), 0) +
    normalized.reduce((acc, row) => acc + n(row.planned_quantity), 0),
  )

  const { error: programUpdateError } = await supabase
    .from('programas_agricolas')
    .update({
      quantity_committed_total: newCommitted,
      updated_at: new Date().toISOString(),
    })
    .eq('id', programId)
    .eq('organization_id', profile.organization_id)
  if (programUpdateError) throw new Error(programUpdateError.message)

  const { error: adjustmentError } = await supabase
    .from('programa_reajustes')
    .insert({
      organization_id: profile.organization_id,
      programa_id: programId,
      created_by: profile.id,
      reason: String(reason || '').trim() || 'Reajuste manual',
      previous_values: previousValues,
      new_values: normalized,
    })
  if (adjustmentError) throw new Error(adjustmentError.message)
}

export async function createPurchaseOrderForProgramDelivery(deliveryId) {
  const profile = await getProfile()
  const { data: delivery, error } = await supabase
    .from('programa_entregas')
    .select(`
      *,
      programas_agricolas (
        id, supplier_id, material_id, unit, program_code, status,
        suppliers ( id, name ),
        materials ( id, code, common_name, base_unit )
      )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('id', deliveryId)
    .single()

  if (error) throw new Error(error.message)
  if (!delivery?.programas_agricolas) throw new Error('No se encontró el programa vinculado')
  if (delivery.purchase_order_id) throw new Error('La entrega ya tiene una OC asociada')

  const remaining = round4(Math.max(0, n(delivery.planned_quantity) - n(delivery.ordered_quantity)))
  if (remaining <= 0) throw new Error('La entrega ya está completamente ordenada')

  const order = await createPurchaseOrder({
    supplier_id: delivery.programas_agricolas.supplier_id,
    delivery_date: delivery.scheduled_date,
    notes: `OC generada desde programa agrícola ${delivery.programas_agricolas.program_code}`,
    programa_agricola_id: delivery.programas_agricolas.id,
    programa_entrega_id: delivery.id,
    items: [
      {
        material_id: delivery.programas_agricolas.material_id,
        quantity: remaining,
        unit: delivery.programas_agricolas.unit || delivery.programas_agricolas.materials?.base_unit || 'lb',
        unit_cost: 0,
      },
    ],
  })

  const { error: updateError } = await supabase
    .from('programa_entregas')
    .update({
      purchase_order_id: order.id,
      ordered_quantity: round4(n(delivery.ordered_quantity) + remaining),
      updated_at: new Date().toISOString(),
    })
    .eq('id', delivery.id)
    .eq('organization_id', profile.organization_id)
  if (updateError) throw new Error(updateError.message)

  return order
}

export async function registerReceptionForProgramDelivery(deliveryId, receptionData) {
  const profile = await getProfile()
  const { data: delivery, error } = await supabase
    .from('programa_entregas')
    .select(`
      *,
      programas_agricolas (
        id, supplier_id, material_id, unit
      )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('id', deliveryId)
    .single()

  if (error) throw new Error(error.message)
  if (!delivery?.programas_agricolas) throw new Error('No se encontró la entrega del programa')

  const reception = await createReception({
    supplier_id: delivery.programas_agricolas.supplier_id,
    material_id: delivery.programas_agricolas.material_id,
    supplier_lot: receptionData.supplier_lot || '',
    received_date: receptionData.received_date || new Date().toISOString().slice(0, 10),
    quantity_received: receptionData.quantity_received,
    quantity_accepted: receptionData.quantity_accepted,
    unit: receptionData.unit || delivery.programas_agricolas.unit,
    quality_notes: receptionData.quality_notes || '',
    unit_cost: receptionData.unit_cost || 0,
    programa_agricola_id: delivery.programas_agricolas.id,
    programa_entrega_id: delivery.id,
  })

  const { data: allReceptions, error: recError } = await supabase
    .from('material_receptions')
    .select('quantity_received, quantity_accepted')
    .eq('organization_id', profile.organization_id)
    .eq('programa_entrega_id', delivery.id)
  if (recError) throw new Error(recError.message)

  const receivedQuantity = round4((allReceptions || []).reduce((acc, row) => acc + receptionQty(row), 0))
  const nextStatus =
    receivedQuantity > n(delivery.planned_quantity) ? 'sobreentrega'
      : receivedQuantity >= n(delivery.planned_quantity) ? 'cumplida'
        : receivedQuantity > 0 ? 'parcial'
          : 'pendiente'

  const { error: updateError } = await supabase
    .from('programa_entregas')
    .update({
      received_quantity: receivedQuantity,
      difference_quantity: round4(receivedQuantity - n(delivery.planned_quantity)),
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', delivery.id)
    .eq('organization_id', profile.organization_id)
  if (updateError) throw new Error(updateError.message)

  return reception
}

export async function getProgramasAgricolasDashboard() {
  const programs = await getProgramasAgricolas()
  const active = programs.filter((row) => row.status === 'activo')
  const risk = programs.filter((row) => row.alerts.some((alert) => alert.level !== 'info'))
  const nextDeliveries = active
    .flatMap((program) => (program.programa_entregas || []).map((delivery) => ({
      ...delivery,
      program_id: program.id,
      program_code: program.program_code,
      supplier_name: program.suppliers?.name || 'Proveedor',
      material_name: program.materials?.common_name || 'Producto',
      unit: program.unit,
    })))
    .filter((row) => ['pendiente', 'parcial', 'incumplida'].includes(row.computed_status || row.status))
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
    .slice(0, 10)

  const committed = round4(programs.reduce((acc, row) => acc + n(row.quantity_committed_total), 0))
  const received = round4(programs.reduce((acc, row) => acc + n(row.delivered_total), 0))

  const bySupplierMap = {}
  const byMaterialMap = {}

  for (const program of programs) {
    const supplierKey = program.supplier_id
    if (!bySupplierMap[supplierKey]) {
      bySupplierMap[supplierKey] = {
        label: program.suppliers?.name || 'Proveedor',
        committed: 0,
        received: 0,
      }
    }
    bySupplierMap[supplierKey].committed += n(program.quantity_committed_total)
    bySupplierMap[supplierKey].received += n(program.delivered_total)

    const materialKey = program.material_id
    if (!byMaterialMap[materialKey]) {
      byMaterialMap[materialKey] = {
        label: program.materials?.common_name || 'Producto',
        committed: 0,
        received: 0,
      }
    }
    byMaterialMap[materialKey].committed += n(program.quantity_committed_total)
    byMaterialMap[materialKey].received += n(program.delivered_total)
  }

  return {
    total_programs: programs.length,
    active_programs: active.length,
    avg_compliance_pct: programs.length ? round2(programs.reduce((acc, row) => acc + n(row.compliance_pct), 0) / programs.length) : 0,
    committed_volume: committed,
    received_volume: received,
    risk_programs: risk.length,
    nextDeliveries,
    bySupplier: Object.values(bySupplierMap).map((row) => ({
      ...row,
      compliance_pct: row.committed > 0 ? round2((row.received / row.committed) * 100) : 0,
    })),
    byMaterial: Object.values(byMaterialMap).map((row) => ({
      ...row,
      compliance_pct: row.committed > 0 ? round2((row.received / row.committed) * 100) : 0,
    })),
  }
}
