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

// ─── Merma helper ─────────────────────────────────────────────────────────────

/**
 * Returns a map of material_id → avg merma rate (0–1) based on completed
 * processing runs for this organization.
 *
 * merma_rate = 1 - SUM(output_original_quantity) / SUM(input_quantity)
 * per source_material_id, only from status = 'completado' runs.
 */
export async function getMermaByMaterial() {
  const orgId = await getOrgId()

  const { data: runs, error } = await supabase
    .from('material_process_runs')
    .select('source_material_id, input_quantity, processed_inventory_lots(original_quantity)')
    .eq('organization_id', orgId)
    .eq('status', 'completado')

  if (error) throw new Error(error.message)
  if (!runs || runs.length === 0) return {}

  // Aggregate per material
  const agg = {}   // { [material_id]: { totalInput, totalOutput } }

  for (const run of runs) {
    const matId = run.source_material_id
    if (!matId) continue
    if (!agg[matId]) agg[matId] = { totalInput: 0, totalOutput: 0 }

    agg[matId].totalInput += n(run.input_quantity)

    for (const lot of run.processed_inventory_lots || []) {
      agg[matId].totalOutput += n(lot.original_quantity)
    }
  }

  // Convert to rate
  const mermaMap = {}
  for (const [matId, { totalInput, totalOutput }] of Object.entries(agg)) {
    if (totalInput > 0) {
      mermaMap[matId] = Math.max(0, Math.min(0.99, 1 - totalOutput / totalInput))
    }
  }

  return mermaMap
}

// ─── Main service ─────────────────────────────────────────────────────────────

/**
 * Returns an array of materials needed to fulfill all pending order items
 * (orders with status 'confirmado' or 'empacado', where quantity_packed < quantity).
 *
 * Each entry:
 * {
 *   material_id, code, name, base_unit,
 *   needed_qty, stock_qty, deficit,
 *   orders: [{ order_id, order_number, presentation_name, pending_units, material_needed }]
 * }
 */
export async function getDemandaData() {
  const orgId = await getOrgId()

  // 1. Fetch orders with pending items
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select(`
      id, order_number, status,
      order_items (
        id, quantity, quantity_packed,
        product_presentation_id
      )
    `)
    .eq('organization_id', orgId)
    .in('status', ['confirmado', 'empacado'])

  if (ordersError) throw new Error(ordersError.message)
  if (!orders || orders.length === 0) return []

  // 2. Collect pending items with their presentation IDs
  const pendingItems = []
  for (const order of orders) {
    for (const item of order.order_items || []) {
      const pending = n(item.quantity) - n(item.quantity_packed)
      if (pending > 0) {
        pendingItems.push({
          order_id: order.id,
          order_number: order.order_number,
          order_item_id: item.id,
          product_presentation_id: item.product_presentation_id,
          pending_units: pending,
        })
      }
    }
  }

  if (pendingItems.length === 0) return []

  // 3. Unique presentation IDs
  const presentationIds = [...new Set(pendingItems.map((i) => i.product_presentation_id))]

  // 4. Fetch presentations → product_base_id, display_name, net_weight in parallel with stock query
  const [presentationsResult, stockResult] = await Promise.allSettled([
    supabase
      .from('product_presentations')
      .select('id, display_name, product_base_id, net_weight, unit')
      .in('id', presentationIds),

    supabase
      .from('material_inventory_lots')
      .select('material_id, available_quantity, unit')
      .eq('organization_id', orgId)
      .in('status', ['disponible', 'parcial']),
  ])

  const presentations = presentationsResult.status === 'fulfilled'
    ? (presentationsResult.value.data || [])
    : []

  const stockLots = stockResult.status === 'fulfilled'
    ? (stockResult.value.data || [])
    : []

  // 5. Map presentation → product_base_id
  const presentationMap = {}
  for (const p of presentations) {
    presentationMap[p.id] = p
  }

  // 6. Unique base IDs
  const baseIds = [...new Set(
    presentationIds
      .map((pid) => presentationMap[pid]?.product_base_id)
      .filter(Boolean)
  )]

  if (baseIds.length === 0) return []

  // 7. Fetch recipes for those bases
  const { data: recipes, error: recipesError } = await supabase
    .from('product_base_recipes')
    .select(`
      product_base_id, percentage, material_id,
      materials ( id, code, common_name, base_unit, minimum_stock, status )
    `)
    .in('product_base_id', baseIds)
    .eq('is_active', true)

  if (recipesError) throw new Error(recipesError.message)
  if (!recipes || recipes.length === 0) return []

  // 8. Build recipe map: base_id → [recipe lines]
  const recipesByBase = {}
  for (const r of recipes) {
    if (!recipesByBase[r.product_base_id]) recipesByBase[r.product_base_id] = []
    recipesByBase[r.product_base_id].push(r)
  }

  // 9. Aggregate demand per material
  // materialDemand[material_id] = { material info, needed_qty, orders: [] }
  const materialDemand = {}

  for (const item of pendingItems) {
    const presentation = presentationMap[item.product_presentation_id]
    if (!presentation) continue

    const baseId = presentation.product_base_id
    const recipeLines = recipesByBase[baseId] || []

    for (const recipe of recipeLines) {
      const mat = recipe.materials
      if (!mat) continue

      const netWeight = n(presentation.net_weight)
      const materialNeeded = (n(recipe.percentage) / 100) * netWeight * item.pending_units

      if (!materialDemand[mat.id]) {
        materialDemand[mat.id] = {
          material_id: mat.id,
          code: mat.code,
          name: mat.common_name,
          base_unit: mat.base_unit,
          needed_qty: 0,
          stock_qty: 0,
          deficit: 0,
          orders: [],
        }
      }

      materialDemand[mat.id].needed_qty += materialNeeded
      materialDemand[mat.id].orders.push({
        order_id: item.order_id,
        order_number: item.order_number,
        presentation_name: presentation.display_name,
        pending_units: item.pending_units,
        material_needed: materialNeeded,
        recipe_unit: mat.base_unit,
      })
    }
  }

  // 10. Aggregate stock per material
  const stockByMaterial = {}
  for (const lot of stockLots) {
    if (!stockByMaterial[lot.material_id]) stockByMaterial[lot.material_id] = 0
    stockByMaterial[lot.material_id] += n(lot.available_quantity)
  }

  // 11. Attach stock and compute deficit
  const result = Object.values(materialDemand).map((m) => {
    const stock = stockByMaterial[m.material_id] || 0
    return {
      ...m,
      stock_qty: stock,
      deficit: m.needed_qty - stock, // positive = deficit, negative = surplus
    }
  })

  // Sort: deficit first, then by name
  result.sort((a, b) => {
    if (a.deficit > 0 && b.deficit <= 0) return -1
    if (a.deficit <= 0 && b.deficit > 0) return 1
    return a.name.localeCompare(b.name)
  })

  return result
}
