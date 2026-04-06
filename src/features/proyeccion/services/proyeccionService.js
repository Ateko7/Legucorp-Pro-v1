import { supabase } from '../../../lib/supabase'

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getOrgId() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return data.organization_id
}

function n(v) {
  const x = Number(v)
  return isNaN(x) ? 0 : x
}

function stddev(values) {
  if (values.length === 0) return 0
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Returns an array of material projections grouped by day-of-week.
 *
 * @param {number} weeks - Number of weeks to look back: 4, 8, or 12
 * @returns {Array} sorted by weekly_avg descending
 *
 * Each entry:
 * {
 *   material_id, code, name, base_unit,
 *   weekly_avg,
 *   days: {
 *     0: { occurrences, total_received, avg, max, min, stddev, suggested, confidence, raw_values },
 *     1: ...,
 *     ...6
 *   }
 * }
 */
export async function getProyeccionData(weeks = 4) {
  const orgId = await getOrgId()

  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - weeks * 7)
  const sinceDateStr = sinceDate.toISOString().split('T')[0]

  // Fetch receptions and purchase order items in parallel
  const [receptionsResult, poItemsResult] = await Promise.allSettled([
    supabase
      .from('material_receptions')
      .select(`
        material_id, received_date, quantity_accepted, unit,
        materials ( id, code, common_name, base_unit, category )
      `)
      .eq('organization_id', orgId)
      .gte('received_date', sinceDateStr)
      .order('received_date', { ascending: true }),

    supabase
      .from('purchase_order_items')
      .select(`
        material_id, quantity, unit,
        purchase_orders ( id, created_at, organization_id, status )
      `)
      .gte('purchase_orders.created_at', sinceDateStr)
      .not('purchase_orders', 'is', null),
  ])

  const receptions = receptionsResult.status === 'fulfilled'
    ? (receptionsResult.value.data || [])
    : []

  // Filter PO items to org (join filtering in PostgREST is limited)
  const rawPoItems = poItemsResult.status === 'fulfilled'
    ? (poItemsResult.value.data || [])
    : []
  const poItems = rawPoItems.filter(
    (i) => i.purchase_orders && i.purchase_orders.organization_id === orgId
  )

  if (receptions.length === 0 && poItems.length === 0) return []

  // Build a map of all materials encountered
  const materialsMap = {}

  // Process receptions: group by (material_id, day_of_week) → list of quantities
  // day_of_week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const receptionData = {}
  // raw: { [material_id]: { [dayOfWeek]: [qty, qty, ...] } }

  for (const rec of receptions) {
    const mat = rec.materials
    if (!mat) continue
    if (mat.category !== 'materia_prima_vegetal') continue

    materialsMap[mat.id] = {
      material_id: mat.id,
      code: mat.code,
      name: mat.common_name,
      base_unit: mat.base_unit,
    }

    const dateObj = new Date(rec.received_date + 'T00:00:00')
    const dow = dateObj.getDay() // 0=Sun..6=Sat
    const qty = n(rec.quantity_accepted)

    if (!receptionData[mat.id]) receptionData[mat.id] = {}
    if (!receptionData[mat.id][dow]) receptionData[mat.id][dow] = []
    receptionData[mat.id][dow].push(qty)
  }

  // How many of each day-of-week occurred in the period?
  // Count actual calendar occurrences of each weekday in [sinceDate, today]
  const dayOccurrences = [0, 0, 0, 0, 0, 0, 0]
  const today = new Date()
  const cursor = new Date(sinceDate)
  while (cursor <= today) {
    dayOccurrences[cursor.getDay()]++
    cursor.setDate(cursor.getDate() + 1)
  }

  // Build projection per material
  const result = []

  for (const [materialId, dayData] of Object.entries(receptionData)) {
    const mat = materialsMap[materialId]
    if (!mat) continue

    const days = {}
    let weeklyAvgSum = 0

    for (let dow = 0; dow <= 6; dow++) {
      const rawValues = dayData[dow] || []
      const occurrences = dayOccurrences[dow]

      if (occurrences === 0) {
        days[dow] = {
          occurrences: 0,
          total_received: 0,
          avg: 0,
          max: 0,
          min: 0,
          stddev: 0,
          suggested: 0,
          confidence: 'baja',
          raw_values: [],
        }
        continue
      }

      // Fill zeros for days where no reception happened in that weekday slot
      const allValues = [...rawValues]
      // Pad with zeros up to occurrences (days with no reception = 0)
      while (allValues.length < occurrences) allValues.push(0)

      const total_received = allValues.reduce((a, b) => a + b, 0)
      const avg = total_received / occurrences
      const nonZero = allValues.filter((v) => v > 0)
      const max = nonZero.length > 0 ? Math.max(...nonZero) : 0
      const min = nonZero.length > 0 ? Math.min(...nonZero) : 0
      const sd = stddev(allValues)
      const suggested = avg + 0.5 * sd

      let confidence
      if (rawValues.length >= 3) confidence = 'alta'
      else if (rawValues.length >= 2) confidence = 'media'
      else confidence = 'baja'

      days[dow] = {
        occurrences,
        total_received,
        avg,
        max,
        min,
        stddev: sd,
        suggested,
        confidence,
        raw_values: allValues,
      }

      weeklyAvgSum += avg
    }

    result.push({
      ...mat,
      weekly_avg: weeklyAvgSum,
      days,
    })
  }

  // Sort by weekly_avg descending
  result.sort((a, b) => b.weekly_avg - a.weekly_avg)

  return result
}
