import { supabase } from '../../../lib/supabase'

async function getOrgId() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return data.organization_id
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function buscarLoteMP(query) {
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('material_inventory_lots')
    .select('id, internal_lot, supplier_lot, available_quantity, unit, status, en_recall, recall_id, created_at, materials(common_name, code)')
    .eq('organization_id', orgId)
    .or(`internal_lot.ilike.%${query}%,supplier_lot.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return data || []
}

export async function buscarLoteTerminado(query) {
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('finished_inventory_lots')
    .select('id, finished_lot_code, available_quantity, unit, status, en_recall, recall_id, production_date, expiration_date, product_presentations(code, display_name, product_bases(common_name))')
    .eq('organization_id', orgId)
    .ilike('finished_lot_code', `%${query}%`)
    .order('production_date', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Forward trace: MP lot → all downstream ──────────────────────────────────

export async function trazarDesdeMp(mpLotId) {
  const chain = {
    mpLot: null,
    processRuns: [],
    processOutputs: [],
    processedLots: [],
    packagingRuns: [],
    finishedLots: [],
    orderPackings: [],
    orders: [],
  }

  // 1. MP lot
  const { data: mpLot, error: e1 } = await supabase
    .from('material_inventory_lots')
    .select('id, internal_lot, supplier_lot, available_quantity, unit, status, en_recall, recall_id, created_at, materials(common_name, code)')
    .eq('id', mpLotId)
    .single()
  if (e1) throw new Error(e1.message)
  chain.mpLot = mpLot

  // 2. Process runs that used this MP lot
  const { data: processRuns } = await supabase
    .from('material_process_runs')
    .select('id, source_internal_lot, process_date, start_stage, current_stage, status, input_quantity, input_unit, notes')
    .eq('source_inventory_lot_id', mpLotId)
  chain.processRuns = processRuns || []

  if (chain.processRuns.length === 0) return chain

  const processRunIds = chain.processRuns.map((r) => r.id)

  // 3. Stage outputs of those runs
  const { data: processOutputs } = await supabase
    .from('material_process_stage_outputs')
    .select('id, output_lot_code, output_quantity, output_type, stage, unit, created_at, process_run_id')
    .in('process_run_id', processRunIds)
  chain.processOutputs = processOutputs || []

  const outputIds = chain.processOutputs.map((o) => o.id)
  if (outputIds.length === 0) return chain

  // 4. Processed lots sourced from those outputs
  const { data: processedLots } = await supabase
    .from('processed_inventory_lots')
    .select('id, internal_lot, available_quantity, original_quantity, unit, status, processed_stage, processed_type, created_at, source_output_id')
    .in('source_output_id', outputIds)
  chain.processedLots = processedLots || []

  const processedLotIds = chain.processedLots.map((p) => p.id)
  if (processedLotIds.length === 0) return chain

  // 5. Packaging run inputs that consumed those processed lots
  const { data: packagingInputs } = await supabase
    .from('packaging_run_inputs')
    .select('id, packaging_run_id, source_lot_id, quantity_used, unit')
    .in('source_lot_id', processedLotIds)
  chain.packagingInputs = packagingInputs || []

  const packagingRunIds = [...new Set((packagingInputs || []).map((i) => i.packaging_run_id))]
  if (packagingRunIds.length === 0) return chain

  // 6. Packaging runs
  const { data: packagingRuns } = await supabase
    .from('packaging_runs')
    .select('id, finished_lot_code, run_date, quantity_produced, unit, status, notes, product_presentations(code, display_name, product_bases(common_name))')
    .in('id', packagingRunIds)
  chain.packagingRuns = packagingRuns || []

  // 7. Finished inventory lots from those packaging runs
  const { data: finishedLots } = await supabase
    .from('finished_inventory_lots')
    .select('id, finished_lot_code, available_quantity, unit, status, en_recall, recall_id, production_date, expiration_date, source_packaging_run_id, product_presentations(code, display_name, product_bases(common_name))')
    .in('source_packaging_run_id', packagingRunIds)
  chain.finishedLots = finishedLots || []

  const finishedLotIds = chain.finishedLots.map((f) => f.id)
  if (finishedLotIds.length === 0) return chain

  // 8. Order packings → orders via order_items
  const { data: orderPackings } = await supabase
    .from('order_packings')
    .select('id, quantity_packed, packed_at, finished_inventory_lot_id, order_item_id, order_items(order_id)')
    .in('finished_inventory_lot_id', finishedLotIds)
  chain.orderPackings = orderPackings || []

  const orderIds = [...new Set((orderPackings || []).map((p) => p.order_items?.order_id).filter(Boolean))]
  if (orderIds.length === 0) return chain

  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, status, total, moneda, delivery_date, created_at, clients(id, commercial_name, pais)')
    .in('id', orderIds)
  chain.orders = orders || []

  return chain
}

// ─── Backward trace: finished lot → MP (bidireccional) ───────────────────────

export async function trazarDesdeLoteTerminado(finishedLotId) {
  const chain = {
    finishedLot: null,
    packagingRun: null,
    packagingInputs: [],
    processedLots: [],
    processOutputs: [],
    processRuns: [],
    mpLots: [],
    orderPackings: [],
    orders: [],
  }

  // 1. Finished lot
  const { data: finishedLot, error: e1 } = await supabase
    .from('finished_inventory_lots')
    .select('id, finished_lot_code, available_quantity, unit, status, en_recall, recall_id, production_date, expiration_date, source_packaging_run_id, product_presentations(code, display_name, product_bases(common_name))')
    .eq('id', finishedLotId)
    .single()
  if (e1) throw new Error(e1.message)
  chain.finishedLot = finishedLot

  // 2. Order packings (downstream — where it was shipped)
  const { data: orderPackings } = await supabase
    .from('order_packings')
    .select('id, quantity_packed, packed_at, finished_inventory_lot_id, order_item_id, order_items(order_id)')
    .eq('finished_inventory_lot_id', finishedLotId)
  chain.orderPackings = orderPackings || []

  const orderIds = [...new Set((orderPackings || []).map((p) => p.order_items?.order_id).filter(Boolean))]
  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number, status, total, moneda, delivery_date, created_at, clients(id, commercial_name, pais)')
      .in('id', orderIds)
    chain.orders = orders || []
  }

  // 3. Packaging run (upstream)
  if (!finishedLot.source_packaging_run_id) return chain

  const { data: packagingRun } = await supabase
    .from('packaging_runs')
    .select('id, finished_lot_code, run_date, quantity_produced, unit, status, notes, product_presentations(code, display_name, product_bases(common_name))')
    .eq('id', finishedLot.source_packaging_run_id)
    .single()
  chain.packagingRun = packagingRun

  // 4. Packaging run inputs → which processed lots were used
  const { data: packagingInputs } = await supabase
    .from('packaging_run_inputs')
    .select('id, source_lot_id, quantity_used, unit, input_type')
    .eq('packaging_run_id', finishedLot.source_packaging_run_id)
    .eq('input_type', 'procesado')
  chain.packagingInputs = packagingInputs || []

  const processedLotIds = [...new Set((packagingInputs || []).map((i) => i.source_lot_id).filter(Boolean))]
  if (processedLotIds.length === 0) return chain

  // 5. Processed lots
  const { data: processedLots } = await supabase
    .from('processed_inventory_lots')
    .select('id, internal_lot, available_quantity, original_quantity, unit, status, processed_stage, processed_type, created_at, source_output_id')
    .in('id', processedLotIds)
  chain.processedLots = processedLots || []

  const outputIds = processedLots.map((p) => p.source_output_id).filter(Boolean)
  if (outputIds.length === 0) return chain

  // 6. Process stage outputs
  const { data: processOutputs } = await supabase
    .from('material_process_stage_outputs')
    .select('id, output_lot_code, output_quantity, output_type, stage, unit, created_at, process_run_id')
    .in('id', outputIds)
  chain.processOutputs = processOutputs || []

  const processRunIds = [...new Set(processOutputs.map((o) => o.process_run_id).filter(Boolean))]
  if (processRunIds.length === 0) return chain

  // 7. Process runs
  const { data: processRuns } = await supabase
    .from('material_process_runs')
    .select('id, source_internal_lot, source_inventory_lot_id, process_date, start_stage, current_stage, status, input_quantity, input_unit, notes')
    .in('id', processRunIds)
  chain.processRuns = processRuns || []

  const mpLotIds = [...new Set(processRuns.map((r) => r.source_inventory_lot_id).filter(Boolean))]
  if (mpLotIds.length === 0) return chain

  // 8. MP lots
  const { data: mpLots } = await supabase
    .from('material_inventory_lots')
    .select('id, internal_lot, supplier_lot, available_quantity, unit, status, en_recall, recall_id, created_at, materials(common_name, code)')
    .in('id', mpLotIds)
  chain.mpLots = mpLots || []

  return chain
}

// ─── Recall report data ───────────────────────────────────────────────────────

export async function fetchRecallReport(recall) {
  // Trace the full chain in both directions depending on origin type
  let chain
  if (recall.lote_origen_tipo === 'materia_prima') {
    chain = await trazarDesdeMp(recall.lote_origen_id)
  } else {
    chain = await trazarDesdeLoteTerminado(recall.lote_origen_id)
  }

  // Collect all MP lot IDs (source + any upstream)
  const mpLots = chain.mpLot
    ? [chain.mpLot, ...(chain.mpLots || [])]
    : (chain.mpLots || [])

  // Deduplicate by id
  const mpLotsUniq = [...new Map(mpLots.map((l) => [l.id, l])).values()]

  // Collect suppliers via material_receptions linked to mp lots
  const mpLotIds = mpLotsUniq.map((l) => l.id)
  let suppliers = []
  if (mpLotIds.length > 0) {
    // material_inventory_lots has a FK to material_receptions; fetch lots with their reception+supplier
    const { data: lotsWithReception } = await supabase
      .from('material_inventory_lots')
      .select('id, material_receptions(id, received_date, supplier_id, suppliers(id, name, email, phone))')
      .in('id', mpLotIds)
    const seen = new Set()
    for (const lot of lotsWithReception || []) {
      const rec = lot.material_receptions
      if (rec?.suppliers && !seen.has(rec.supplier_id)) {
        seen.add(rec.supplier_id)
        suppliers.push({ ...rec.suppliers, received_date: rec.received_date })
      }
    }
  }

  // Collect finished lots
  const finishedLots = chain.finishedLot
    ? [chain.finishedLot, ...(chain.finishedLots || [])]
    : (chain.finishedLots || [])
  const finishedLotsUniq = [...new Map(finishedLots.map((l) => [l.id, l])).values()]

  // Collect orders + clients
  const orders = chain.orders || []
  const clientsMap = new Map()
  for (const o of orders) {
    if (o.clients?.id && !clientsMap.has(o.clients.id)) {
      clientsMap.set(o.clients.id, { ...o.clients, orders: [] })
    }
    if (o.clients?.id) clientsMap.get(o.clients.id).orders.push(o)
  }
  const clients = [...clientsMap.values()]

  return { recall, mpLots: mpLotsUniq, suppliers, finishedLots: finishedLotsUniq, orders, clients }
}

// ─── Recalls ──────────────────────────────────────────────────────────────────

export async function getRecalls() {
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('recalls')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function iniciarRecall({ tipo, motivo, descripcion, loteOrigenId, loteOrigenTipo, loteOrigenCodigo }) {
  const orgId = await getOrgId()
  const { data: { user } } = await supabase.auth.getUser()

  const now = new Date()
  const numero = `RC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`

  const { data: recall, error: e1 } = await supabase
    .from('recalls')
    .insert({
      organization_id: orgId,
      numero,
      tipo,
      motivo,
      descripcion,
      lote_origen_id: loteOrigenId,
      lote_origen_tipo: loteOrigenTipo,
      lote_origen_codigo: loteOrigenCodigo,
      created_by: user.id,
    })
    .select()
    .single()
  if (e1) throw new Error(e1.message)

  // Mark source lot as en_recall
  if (loteOrigenId && loteOrigenTipo) {
    const table = loteOrigenTipo === 'materia_prima' ? 'material_inventory_lots' : 'finished_inventory_lots'
    await supabase
      .from(table)
      .update({ en_recall: true, recall_id: recall.id })
      .eq('id', loteOrigenId)
  }

  return recall
}

export async function actualizarRecall(id, updates) {
  const { data, error } = await supabase
    .from('recalls')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function resolverRecall(id) {
  return actualizarRecall(id, { status: 'resuelto' })
}

export async function cerrarRecall(id) {
  await supabase.from('material_inventory_lots').update({ en_recall: false, recall_id: null }).eq('recall_id', id)
  await supabase.from('finished_inventory_lots').update({ en_recall: false, recall_id: null }).eq('recall_id', id)
  return actualizarRecall(id, { status: 'cerrado' })
}
