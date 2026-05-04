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

function hasDefinedEndDate(program) {
  return Boolean(program?.end_date)
}

function getProgramDateLabel(program) {
  return hasDefinedEndDate(program)
    ? `${program.start_date} → ${program.end_date}`
    : `${program.start_date} → Indefinido`
}

function receptionMatchesProgramWindow(program, reception) {
  if (!reception?.received_date || reception.received_date < program.start_date) return false
  if (!hasDefinedEndDate(program)) return true
  return reception.received_date <= program.end_date
}

function getProgramReceptions(program, receptions = []) {
  return (receptions || []).filter((row) => (
    row?.supplier_id === program.supplier_id
    && receptionMatchesProgramWindow(program, row)
  ))
}

function buildPrimaryProgramUnit(items = [], fallbackUnit = 'lb') {
  const units = [...new Set(items.map((item) => String(item.unit || '').trim()).filter(Boolean))]
  if (units.length === 1) return units[0]
  if (units.length > 1) return 'varias'
  return fallbackUnit
}

function buildProgramMaterialLabels(items = [], fallbackLabel = 'Materia prima') {
  const labels = [...new Set(items.map((item) => item.materials?.common_name || item.material_name).filter(Boolean))]
  return labels.length ? labels.join(', ') : fallbackLabel
}

function buildFallbackItem(program) {
  return {
    id: `legacy-${program.id}`,
    organization_id: program.organization_id,
    programa_id: program.id,
    material_id: program.material_id,
    quantity_committed_total: round4(program.quantity_committed_total),
    unit: program.unit,
    notes: program.notes || null,
    sort_order: 0,
    materials: program.materials || null,
  }
}

function getNormalizedProgramItems(program) {
  const rawItems = Array.isArray(program.programa_agricola_items) && program.programa_agricola_items.length
    ? program.programa_agricola_items
    : [buildFallbackItem(program)]

  return rawItems
    .map((item, index) => ({
      ...item,
      sort_order: Number.isInteger(item.sort_order) ? item.sort_order : index,
      quantity_committed_total: round4(item.quantity_committed_total),
      unit: item.unit || program.unit || item.materials?.base_unit || 'lb',
    }))
    .sort((a, b) => n(a.sort_order) - n(b.sort_order))
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

  throw new Error('No se pudo generar un código automático para el programa agrícola')
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
  const totalCommitted = n(program.quantity_committed_total)
  const totalReceived = n(program.delivered_total)

  if (totalReceived > totalCommitted) {
    alerts.push({ level: 'danger', type: 'sobreentrega_acumulada', message: `El acumulado supera lo comprometido por ${round4(totalReceived - totalCommitted)} ${program.unit}.` })
  }

  const hasEndDate = hasDefinedEndDate(program)
  const totalDays = hasEndDate ? Math.max(1, Math.ceil((new Date(`${program.end_date}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1) : null
  const elapsedDays = hasEndDate ? Math.min(totalDays, Math.max(0, Math.ceil((new Date(`${today}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1)) : null
  const timeProgressPct = hasEndDate ? round4((elapsedDays / totalDays) * 100) : 0
  const volumeProgressPct = n(program.quantity_committed_total) > 0 ? round4((totalReceived / n(program.quantity_committed_total)) * 100) : 0

  if (hasEndDate && timeProgressPct > volumeProgressPct + 15 && ['activo', 'pausado'].includes(program.status)) {
    alerts.push({ level: 'warning', type: 'riesgo_tiempo_volumen', message: `El tiempo avanza ${round2(timeProgressPct)}% y el volumen sólo ${round2(volumeProgressPct)}%.` })
  }

  const daysToEnd = hasEndDate ? Math.ceil((new Date(`${program.end_date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null
  const pending = Math.max(0, totalCommitted - totalReceived)
  if (hasEndDate && daysToEnd <= 14 && pending > 0) {
    alerts.push({ level: 'warning', type: 'faltante_cierre', message: `Faltan ${round4(pending)} ${program.unit} y el programa vence en ${Math.max(daysToEnd, 0)} día(s).` })
  }

  return alerts
}

function enrichProgram(program, receptions = []) {
  const today = new Date().toISOString().slice(0, 10)
  const items = getNormalizedProgramItems(program)
  const matchedReceptions = getProgramReceptions(program, receptions)

  const enrichedItems = items.map((item) => {
    const itemReceptions = matchedReceptions.filter((row) => row.material_id === item.material_id)
    const deliveredTotal = round4(itemReceptions.reduce((acc, row) => acc + receptionQty(row), 0))
    const committedTotal = round4(item.quantity_committed_total)
    const pendingTotal = round4(Math.max(0, committedTotal - deliveredTotal))
    const compliancePct = committedTotal > 0 ? round4((deliveredTotal / committedTotal) * 100) : 0

    return {
      ...item,
      material_name: item.materials?.common_name || 'Materia prima',
      material_code: item.materials?.code || '',
      deliveries: [],
      ordered_total: 0,
      delivered_total: deliveredTotal,
      pending_total: pendingTotal,
      compliance_pct: compliancePct,
    }
  })

  const committedTotal = round4(enrichedItems.reduce((acc, item) => acc + n(item.quantity_committed_total), 0))
  const deliveredTotal = round4(enrichedItems.reduce((acc, item) => acc + n(item.delivered_total), 0))
  const orderedTotal = 0
  const pendingTotal = round4(Math.max(0, committedTotal - deliveredTotal))
  const compliancePct = committedTotal > 0 ? round4((deliveredTotal / committedTotal) * 100) : 0
  const unit = buildPrimaryProgramUnit(enrichedItems, program.unit)
  const primaryItem = enrichedItems[0] || null
  const materialLabels = buildProgramMaterialLabels(enrichedItems, program.materials?.common_name || 'Materia prima')
  const deliveryStats = {
    cumplidas: enrichedItems.filter((item) => item.compliance_pct >= 100).length,
    parciales: enrichedItems.filter((item) => item.compliance_pct > 0 && item.compliance_pct < 100).length,
    incumplidas: enrichedItems.filter((item) => item.compliance_pct <= 0).length,
    reprogramadas: 0,
    sobreentregas: enrichedItems.filter((item) => item.compliance_pct > 100).length,
  }

  const hasEndDate = hasDefinedEndDate(program)
  const totalDays = hasEndDate ? Math.max(1, Math.ceil((new Date(`${program.end_date}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1) : null
  const elapsedDays = hasEndDate ? Math.min(totalDays, Math.max(0, Math.ceil((new Date(`${today}T00:00:00`) - new Date(`${program.start_date}T00:00:00`)) / 86400000) + 1)) : null
  const timeProgressPct = hasEndDate ? round4((elapsedDays / totalDays) * 100) : 0
  const volumeProgressPct = committedTotal > 0 ? round4((deliveredTotal / committedTotal) * 100) : 0

  return {
    ...program,
    material_id: primaryItem?.material_id || program.material_id,
    materials: primaryItem?.materials || program.materials || null,
    material_labels: materialLabels,
    materials_count: enrichedItems.length,
    quantity_committed_total: committedTotal,
    unit,
    programa_agricola_items: enrichedItems,
    programa_entregas: deliveries,
    delivered_total: deliveredTotal,
    ordered_total: orderedTotal,
    pending_total: pendingTotal,
    compliance_pct: compliancePct,
    date_label: getProgramDateLabel(program),
    is_open_ended: !hasEndDate,
    delivery_stats: deliveryStats,
    time_progress_pct: timeProgressPct,
    volume_progress_pct: volumeProgressPct,
    matched_receptions: matchedReceptions,
    alerts: buildProgramAlerts({
      ...program,
      unit,
      quantity_committed_total: committedTotal,
      delivered_total: deliveredTotal,
    }, today),
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

const PROGRAM_SELECT = `
  *,
  suppliers ( id, name ),
  materials ( id, code, common_name, base_unit ),
  programa_agricola_items (
    *,
    materials ( id, code, common_name, base_unit )
  ),
  programa_entregas (
    *,
    materials ( id, code, common_name, base_unit ),
    purchase_orders:purchase_orders!programa_entregas_purchase_order_id_fkey (
      id, order_number, status, delivery_date, created_at
    )
  )
`

export async function getProgramasAgricolas() {
  const profile = await getProfile()
  const [programsRes, receptionsRes] = await Promise.all([
    supabase
      .from('programas_agricolas')
      .select(PROGRAM_SELECT)
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('material_receptions')
      .select('id, supplier_id, material_id, received_date, quantity_received, quantity_accepted')
      .eq('organization_id', profile.organization_id),
  ])

  if (programsRes.error) throw new Error(programsRes.error.message)
  if (receptionsRes.error) throw new Error(receptionsRes.error.message)

  return (programsRes.data || []).map((program) => enrichProgram(program, receptionsRes.data || []))
}

export async function getProgramaAgricolaDetail(programId) {
  const profile = await getProfile()
  const [programRes, receptionsRes, adjustmentsRes] = await Promise.all([
    supabase
      .from('programas_agricolas')
      .select(PROGRAM_SELECT)
      .eq('organization_id', profile.organization_id)
      .eq('id', programId)
      .single(),
    supabase
      .from('material_receptions')
      .select(`
        *,
        suppliers ( id, name ),
        materials ( id, code, common_name, base_unit ),
        purchase_orders ( id, order_number, status ),
        profiles:created_by ( id, full_name )
      `)
      .eq('organization_id', profile.organization_id)
      .order('received_date', { ascending: false }),
    supabase
      .from('programa_reajustes')
      .select('*, profiles:created_by ( id, full_name )')
      .eq('organization_id', profile.organization_id)
      .eq('programa_id', programId)
      .order('adjustment_date', { ascending: false }),
  ])

  if (programRes.error) throw new Error(programRes.error.message)
  if (receptionsRes.error) throw new Error(receptionsRes.error.message)
  if (adjustmentsRes.error) throw new Error(adjustmentsRes.error.message)

  const enriched = enrichProgram(programRes.data, receptionsRes.data || [])
  const matchedReceptionIds = (enriched.matched_receptions || []).map((row) => row.id).filter(Boolean)
  let inventoryLots = []

  if (matchedReceptionIds.length) {
    const { data: lotsData, error: lotsError } = await supabase
      .from('material_inventory_lots')
      .select(`
        id,
        internal_lot,
        available_quantity,
        original_quantity,
        unit,
        status,
        material_id,
        reception_id,
        programa_entrega_id,
        created_at,
        materials ( id, code, common_name, base_unit )
      `)
      .eq('organization_id', profile.organization_id)
      .in('reception_id', matchedReceptionIds)
      .order('created_at', { ascending: false })

    if (lotsError) throw new Error(lotsError.message)
    inventoryLots = lotsData || []
  }

  return {
    ...enriched,
    receptions: enriched.matched_receptions || [],
    inventoryLots,
    adjustments: adjustmentsRes.data || [],
  }
}

function validateProgramItems(items) {
  const normalized = (items || [])
    .map((item, index) => ({
      ...item,
      sort_order: index,
      quantity_committed_total: round4(item.quantity_committed_total),
      unit: String(item.unit || '').trim(),
      material_id: item.material_id || '',
      notes: String(item.notes || '').trim() || null,
      deliveries: Array.isArray(item.deliveries) ? item.deliveries : [],
    }))
    .filter((item) => item.material_id && n(item.quantity_committed_total) > 0)

  if (!normalized.length) throw new Error('Debes agregar al menos una variedad o materia prima al programa')

  const uniqueMaterialIds = new Set(normalized.map((item) => item.material_id))
  if (uniqueMaterialIds.size !== normalized.length) {
    throw new Error('No puedes repetir la misma variedad o materia prima dentro del mismo programa')
  }

  const units = [...new Set(normalized.map((item) => item.unit).filter(Boolean))]
  if (!units.length) throw new Error('Cada variedad debe tener una unidad')
  if (units.length > 1) throw new Error('Todas las variedades del programa deben manejar la misma unidad por ahora')

  return normalized
}

async function syncProgramItems(profile, programId, items) {
  const { data: existingRows, error: existingError } = await supabase
    .from('programa_agricola_items')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('programa_id', programId)

  if (existingError) throw new Error(existingError.message)

  const keepIds = new Set()
  const syncedItems = []

  for (const item of items) {
    const payload = {
      organization_id: profile.organization_id,
      programa_id: programId,
      material_id: item.material_id,
      quantity_committed_total: round4(item.quantity_committed_total),
      unit: item.unit,
      notes: item.notes,
      sort_order: item.sort_order,
      updated_at: new Date().toISOString(),
    }

    if (item.id) {
      const { error: updateError } = await supabase
        .from('programa_agricola_items')
        .update(payload)
        .eq('id', item.id)
        .eq('organization_id', profile.organization_id)

      if (updateError) throw new Error(updateError.message)
      keepIds.add(item.id)
      syncedItems.push({ ...item, id: item.id })
      continue
    }

    const { data, error: insertError } = await supabase
      .from('programa_agricola_items')
      .insert({
        ...payload,
        created_by: profile.id,
      })
      .select('id')
      .single()

    if (insertError) throw new Error(insertError.message)
    keepIds.add(data.id)
    syncedItems.push({ ...item, id: data.id })
  }

  const deleteIds = (existingRows || []).map((row) => row.id).filter((id) => !keepIds.has(id))
  if (deleteIds.length) {
    const { error: deleteError } = await supabase
      .from('programa_agricola_items')
      .delete()
      .in('id', deleteIds)
      .eq('organization_id', profile.organization_id)
      .eq('programa_id', programId)

    if (deleteError) throw new Error(deleteError.message)
  }

  return syncedItems
}

function buildDeliveryRows(profile, syncedItems) {
  return []
}

export async function saveProgramaAgricola(programData) {
  const profile = await getProfile()
  const items = validateProgramItems(programData.items)
  const resolvedProgramCode = programData.id
    ? String(programData.program_code || '').trim().toUpperCase()
    : (String(programData.program_code || '').trim().toUpperCase() || await getNextProgramaAgricolaCode())

  const totalCommitted = round4(items.reduce((acc, item) => acc + n(item.quantity_committed_total), 0))
  const primaryItem = items[0]
  const payload = {
    organization_id: profile.organization_id,
    supplier_id: programData.supplier_id,
    material_id: primaryItem.material_id,
    program_code: resolvedProgramCode,
    quantity_committed_total: totalCommitted,
    unit: primaryItem.unit,
    start_date: programData.start_date,
    end_date: programData.end_date || null,
    delivery_frequency: programData.delivery_frequency || 'semanal',
    status: programData.status || 'borrador',
    notes: String(programData.notes || '').trim() || null,
    updated_at: new Date().toISOString(),
  }

  if (!payload.supplier_id) throw new Error('Proveedor requerido')
  if (!payload.program_code) throw new Error('No se pudo generar el código del programa')
  if (!payload.start_date) throw new Error('Fecha de inicio requerida')
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

  const syncedItems = await syncProgramItems(profile, programId, items.map((item) => ({
    ...item,
    programa_id: programId,
  })))
  const deliveries = buildDeliveryRows(profile, syncedItems)

  const { data: existingDeliveries, error: existingDeliveriesError } = await supabase
    .from('programa_entregas')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('programa_id', programId)

  if (existingDeliveriesError) throw new Error(existingDeliveriesError.message)

  const keepIds = new Set(deliveries.map((row) => row.id).filter(Boolean))
  const deleteIds = (existingDeliveries || []).map((row) => row.id).filter((id) => !keepIds.has(id))

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

  const validItemIds = new Set((detail.programa_agricola_items || []).map((item) => item.id))
  const normalized = (futureDeliveries || [])
    .filter((row) => row.scheduled_date && n(row.planned_quantity) > 0 && validItemIds.has(row.programa_item_id))
    .map((row) => ({
      id: row.id || undefined,
      organization_id: profile.organization_id,
      programa_id: programId,
      programa_item_id: row.programa_item_id,
      material_id: row.material_id,
      scheduled_date: row.scheduled_date,
      planned_quantity: round4(row.planned_quantity),
      received_quantity: round4(row.received_quantity),
      ordered_quantity: round4(row.ordered_quantity),
      difference_quantity: round4(n(row.received_quantity) - n(row.planned_quantity)),
      unit: row.unit,
      status: row.status || 'pendiente',
      purchase_order_id: row.purchase_order_id || null,
      notes: row.notes || null,
      created_by: profile.id,
      updated_at: new Date().toISOString(),
    }))

  const futureExisting = (detail.programa_entregas || []).filter((row) => !protectedIds.has(row.id))
  const previousValues = futureExisting.map((row) => ({
    id: row.id,
    programa_item_id: row.programa_item_id,
    material_id: row.material_id,
    material_name: row.material_name,
    scheduled_date: row.scheduled_date,
    planned_quantity: row.planned_quantity,
    received_quantity: row.received_quantity,
    ordered_quantity: row.ordered_quantity,
    unit: row.unit,
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

  const totalsByItem = new Map()
  ;(detail.programa_entregas || [])
    .filter((row) => protectedIds.has(row.id))
    .forEach((row) => {
      totalsByItem.set(row.programa_item_id, round4(n(totalsByItem.get(row.programa_item_id)) + n(row.planned_quantity)))
    })
  normalized.forEach((row) => {
    totalsByItem.set(row.programa_item_id, round4(n(totalsByItem.get(row.programa_item_id)) + n(row.planned_quantity)))
  })

  for (const item of detail.programa_agricola_items || []) {
    const { error: itemUpdateError } = await supabase
      .from('programa_agricola_items')
      .update({
        quantity_committed_total: round4(totalsByItem.get(item.id) || 0),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('organization_id', profile.organization_id)

    if (itemUpdateError) throw new Error(itemUpdateError.message)
  }

  const newCommitted = round4([...totalsByItem.values()].reduce((acc, value) => acc + n(value), 0))
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
      materials ( id, code, common_name, base_unit ),
      programas_agricolas (
        id, supplier_id, program_code, status,
        suppliers ( id, name )
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
    notes: `OC generada desde programa agrícola ${delivery.programas_agricolas.program_code} · ${delivery.materials?.common_name || 'Variedad'}`,
    programa_agricola_id: delivery.programas_agricolas.id,
    programa_entrega_id: delivery.id,
    items: [
      {
        material_id: delivery.material_id,
        quantity: remaining,
        unit: delivery.unit || delivery.materials?.base_unit || 'lb',
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
      materials ( id, code, common_name, base_unit ),
      programas_agricolas (
        id, supplier_id
      )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('id', deliveryId)
    .single()

  if (error) throw new Error(error.message)
  if (!delivery?.programas_agricolas) throw new Error('No se encontró la entrega del programa')

  const reception = await createReception({
    supplier_id: delivery.programas_agricolas.supplier_id,
    material_id: delivery.material_id,
    supplier_lot: receptionData.supplier_lot || '',
    received_date: receptionData.received_date || new Date().toISOString().slice(0, 10),
    quantity_received: receptionData.quantity_received,
    quantity_accepted: receptionData.quantity_accepted,
    unit: receptionData.unit || delivery.unit || delivery.materials?.base_unit,
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
      material_name: delivery.material_name || delivery.materials?.common_name || program.materials?.common_name || 'Producto',
      unit: delivery.unit || program.unit,
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

    for (const item of program.programa_agricola_items || []) {
      const materialKey = item.material_id
      if (!byMaterialMap[materialKey]) {
        byMaterialMap[materialKey] = {
          label: item.material_name || item.materials?.common_name || 'Producto',
          committed: 0,
          received: 0,
        }
      }
      byMaterialMap[materialKey].committed += n(item.quantity_committed_total)
      byMaterialMap[materialKey].received += n(item.delivered_total)
    }
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
