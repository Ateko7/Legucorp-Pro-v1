/**
 * Demand projection for the packaging module.
 *
 * Model:
 *   For each SKU, look at the last 8 same-weekday dates and compute a
 *   weighted average of units delivered (delivery_date-based, not created_at).
 *   Weights decay linearly: most recent week = 4, then 3, 2, 1, 1, 1, 1, 1.
 *
 *   projected = max(confirmed_today, weighted_avg * safety_factor)
 *   net_to_produce = max(0, projected - cold_room_stock)
 *
 *   Confidence is derived from:
 *   - data_points: how many historical weeks had any sale
 *   - CV (coefficient of variation): how stable the demand is
 *
 * Safety factor default = 1.15 (15% buffer). Configurable per call.
 */

import { supabase } from '../../../lib/supabase'

// ─── Constants ─────────────────────────────────────────────────────────────────
const WEEKS_HISTORY = 8
// Weight for weeks 0..7 (index 0 = most recent)
const WEEK_WEIGHTS = [4, 3, 2, 1, 1, 1, 1, 1]
const DEFAULT_SAFETY = 1.15

// ─── Helpers ────────────────────────────────────────────────────────────────────
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

/** Returns the last `weeks` dates that share the same weekday as `fecha`. */
function getSameWeekdayDates(fecha, weeks) {
  const base = new Date(fecha + 'T00:00:00')
  return Array.from({ length: weeks }, (_, i) => {
    const d = new Date(base)
    d.setDate(d.getDate() - (i + 1) * 7)
    return d.toISOString().slice(0, 10)
  })
}

/**
 * Coefficient of variation: std_dev / mean.
 * Measures how stable demand is. Higher CV → less predictable.
 */
function coefficientOfVariation(values) {
  const nonZero = values.filter(v => v > 0)
  if (nonZero.length < 2) return null
  const mean = nonZero.reduce((a, v) => a + v, 0) / nonZero.length
  if (mean === 0) return null
  const variance = nonZero.reduce((a, v) => a + (v - mean) ** 2, 0) / nonZero.length
  return Math.sqrt(variance) / mean
}

/**
 * Confidence label based on data richness and stability.
 *   alto   → ≥5 data points AND CV ≤ 0.30
 *   medio  → ≥3 data points AND CV ≤ 0.55
 *   bajo   → < 3 data points OR high variance
 */
function calcConfidence(dataPoints, cv) {
  if (cv === null) {
    if (dataPoints >= 3) return 'medio'
    return 'bajo'
  }
  if (dataPoints >= 5 && cv <= 0.30) return 'alto'
  if (dataPoints >= 3 && cv <= 0.55) return 'medio'
  return 'bajo'
}

// ─── Main projection function ──────────────────────────────────────────────────

/**
 * Returns demand projection for a given date.
 *
 * @param {string}  fecha        ISO date string "YYYY-MM-DD"
 * @param {number}  safetyFactor Optional safety multiplier (default 1.15 = +15%)
 * @returns {object} { fecha, dia_semana, items[], summary{} }
 */
export async function getProyeccionDia(fecha, safetyFactor = DEFAULT_SAFETY) {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  const historicalDates = getSameWeekdayDates(fecha, WEEKS_HISTORY)

  const [confirmedRes, historicalRes, stockRes, presentationsRes] = await Promise.all([
    // Today's confirmed orders (delivery_date = fecha, not cancelled)
    supabase
      .from('orders')
      .select('id, status, order_items(product_presentation_id, quantity, quantity_packed)')
      .eq('organization_id', orgId)
      .eq('delivery_date', fecha)
      .neq('status', 'cancelado'),

    // Historical same-weekday orders (any non-cancelled status so we capture real demand)
    supabase
      .from('orders')
      .select('delivery_date, status, order_items(product_presentation_id, quantity)')
      .eq('organization_id', orgId)
      .in('delivery_date', historicalDates)
      .neq('status', 'cancelado'),

    // Current cold-room stock per SKU
    supabase
      .from('finished_inventory_lots')
      .select('product_presentation_id, available_quantity, expiration_date')
      .eq('organization_id', orgId)
      .in('status', ['disponible', 'parcial'])
      .eq('bloqueado_calidad', false)
      .gt('available_quantity', 0),

    // Active product presentations
    supabase
      .from('product_presentations')
      .select('id, code, display_name, net_weight, unit, standard_cost, suggested_price, product_base_id, product_bases(common_name)')
      .eq('organization_id', orgId)
      .eq('status', 'activo')
      .order('display_name'),
  ])

  if (confirmedRes.error)    throw new Error(confirmedRes.error.message)
  if (historicalRes.error)   throw new Error(historicalRes.error.message)
  if (stockRes.error)        throw new Error(stockRes.error.message)
  if (presentationsRes.error) throw new Error(presentationsRes.error.message)

  // ── Confirmed demand today (already confirmed orders for delivery today) ──────
  const confirmedByPid = {}        // pid → units
  const pendingPackByPid = {}      // pid → units not yet packed (still needed)

  for (const order of confirmedRes.data || []) {
    for (const item of order.order_items || []) {
      const pid = item.product_presentation_id
      const qty = n(item.quantity)
      const packed = n(item.quantity_packed)
      confirmedByPid[pid]   = n(confirmedByPid[pid])   + qty
      pendingPackByPid[pid] = n(pendingPackByPid[pid]) + Math.max(0, qty - packed)
    }
  }

  // ── Historical demand aggregated per (date, pid) ──────────────────────────────
  // historicalByDate[date][pid] = units
  const historicalByDate = {}
  for (const order of historicalRes.data || []) {
    const d = order.delivery_date
    if (!historicalByDate[d]) historicalByDate[d] = {}
    for (const item of order.order_items || []) {
      const pid = item.product_presentation_id
      historicalByDate[d][pid] = n(historicalByDate[d][pid]) + n(item.quantity)
    }
  }

  // ── Stock per SKU (exclude near-expired within 2 days) ────────────────────────
  const stockByPid = {}
  const today = new Date(fecha + 'T00:00:00')
  for (const lot of stockRes.data || []) {
    const pid = lot.product_presentation_id
    const exp = lot.expiration_date ? new Date(lot.expiration_date + 'T00:00:00') : null
    const daysLeft = exp ? Math.round((exp - today) / 86400000) : 999
    // Only count stock that won't expire in the next 2 days
    if (daysLeft >= 2) {
      stockByPid[pid] = n(stockByPid[pid]) + n(lot.available_quantity)
    }
  }

  // ── Build per-SKU projection ───────────────────────────────────────────────────
  const presentations = presentationsRes.data || []
  const items = []

  for (const pres of presentations) {
    const pid = pres.id
    const confirmed    = n(confirmedByPid[pid])
    const pendingPack  = n(pendingPackByPid[pid])
    const coldStock    = n(stockByPid[pid])

    // Historical values (one per historical week, index 0 = most recent)
    const historicalValues = historicalDates.map(d => n(historicalByDate[d]?.[pid]))
    const dataPoints = historicalValues.filter(v => v > 0).length

    // Weighted average
    let weightedSum  = 0
    let totalWeight  = 0
    for (let i = 0; i < historicalDates.length; i++) {
      const w = WEEK_WEIGHTS[i] ?? 1
      weightedSum  += historicalValues[i] * w
      totalWeight  += w
    }
    const weightedAvg = totalWeight > 0 ? r2(weightedSum / totalWeight) : 0

    // Stats
    const cv = coefficientOfVariation(historicalValues)
    const confidence = calcConfidence(dataPoints, cv)

    // Trend direction: compare last 2 weeks vs weeks 3-4
    let trend = 'estable'
    if (historicalValues.length >= 4) {
      const recent = (historicalValues[0] + historicalValues[1]) / 2
      const older  = (historicalValues[2] + historicalValues[3]) / 2
      if (older > 0) {
        const change = (recent - older) / older
        if (change > 0.15)      trend = 'creciendo'
        else if (change < -0.15) trend = 'bajando'
      }
    }

    // Projected demand: apply safety factor; at minimum honour confirmed
    const projected = r2(Math.max(confirmed, weightedAvg * safetyFactor))

    // Net to produce = what's needed beyond existing stock
    // We subtract cold stock; we already have pendingPack as the immediate deficit
    const netToProduce = r2(Math.max(0, projected - coldStock))

    // "Days of stock" — how many days the cold stock covers at projected daily rate
    const daysOfStockCoverage = projected > 0 ? r2(coldStock / projected) : (coldStock > 0 ? 99 : 0)

    // Priority score — used to sort (urgent items first)
    const priority =
      pendingPack > 0 && coldStock < pendingPack ? 3 :  // confirmed orders can't be filled
      netToProduce > 0 ? 2 :                            // need to produce
      1                                                  // stock is sufficient

    items.push({
      product_presentation_id: pid,
      sku_code:        pres.code,
      sku_nombre:      pres.display_name,
      product_base:    pres.product_bases?.common_name || '',
      net_weight:      pres.net_weight,
      unit:            pres.unit,
      standard_cost:   pres.standard_cost,
      suggested_price: pres.suggested_price,

      // Demand signals
      confirmed_today:   confirmed,
      pending_to_pack:   pendingPack,
      weighted_avg:      weightedAvg,
      projected:         projected,
      safety_factor:     safetyFactor,

      // Stock
      cold_stock:        coldStock,
      net_to_produce:    netToProduce,
      days_of_coverage:  daysOfStockCoverage,

      // Statistical quality
      confidence,          // 'alto' | 'medio' | 'bajo'
      data_points:  dataPoints,
      cv:           cv !== null ? r2(cv) : null,
      trend,               // 'creciendo' | 'bajando' | 'estable'

      // Raw history for sparkline
      historical_dates:  historicalDates,
      historical_values: historicalValues,

      priority,
    })
  }

  // Sort: priority desc, then net_to_produce desc
  items.sort((a, b) => b.priority - a.priority || b.net_to_produce - a.net_to_produce)

  const summary = {
    total_skus:               items.length,
    skus_con_pedidos_hoy:     items.filter(i => i.confirmed_today > 0).length,
    skus_deficit_inmediato:   items.filter(i => i.pending_to_pack > 0 && i.cold_stock < i.pending_to_pack).length,
    skus_a_producir:          items.filter(i => i.net_to_produce > 0).length,
    skus_stock_suficiente:    items.filter(i => i.net_to_produce === 0).length,
    total_unidades_proyectadas: r2(items.reduce((a, i) => a + i.projected, 0)),
    total_unidades_a_producir:  r2(items.reduce((a, i) => a + i.net_to_produce, 0)),
    semanas_historico:        WEEKS_HISTORY,
    safety_factor:            safetyFactor,
  }

  const dayName = new Date(fecha + 'T00:00:00').toLocaleDateString('es-GT', { weekday: 'long' })

  return { fecha, dia_semana: dayName, items, summary }
}
