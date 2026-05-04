import { supabase } from '../../../lib/supabase'

const STAGES = {
  DESHOJE: 'deshoje',
  LAVADO: 'lavado',
  SECADO: 'secado',
}

const RUN_STATUS = {
  EN_PROCESO: 'en_proceso',
  COMPLETADO: 'completado',
}

function numberOrZero(v) {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function round2(v) {
  return Math.round(numberOrZero(v) * 100) / 100
}

async function getProfile() {
  const { data } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()

  return profile
}

/* =====================================================
   CREAR PROCESO INICIAL
===================================================== */
export async function createInitialProcessRun({
  sourceInventoryLotId,
  processDate,
  startStage,
  outputs = [],
  outputQuantity,
}) {
  const profile = await getProfile()

  const { data: lot } = await supabase
    .from('material_inventory_lots')
    .select('*')
    .eq('id', sourceInventoryLotId)
    .single()

  const inputQty = numberOrZero(lot.available_quantity)

  const { data: run } = await supabase
    .from('material_process_runs')
    .insert({
      organization_id: profile.organization_id,
      source_inventory_lot_id: lot.id,
      source_material_id: lot.material_id,
      source_internal_lot: lot.internal_lot,
      start_stage: startStage,
      current_stage: startStage,
      process_date: processDate,
      input_quantity: inputQty,
      input_unit: lot.unit,
      status: RUN_STATUS.EN_PROCESO,
      created_by: profile.id,
    })
    .select()
    .single()

  if (startStage === STAGES.DESHOJE) {
    for (const o of outputs) {
      const qty = numberOrZero(o.output_quantity)

      await supabase.from('material_process_stage_outputs').insert({
        organization_id: profile.organization_id,
        process_run_id: run.id,
        stage: STAGES.DESHOJE,
        output_type: o.output_type,
        output_lot_code: `${lot.internal_lot}-${o.output_type === 'mini' ? 'M' : 'N'}`,
        material_id: lot.material_id,
        input_quantity: inputQty,
        output_quantity: qty,
        waste_quantity: 0,
        waste_percentage: 0,
        unit: lot.unit,
        created_by: profile.id,
      })
    }
  } else {
    const qty = numberOrZero(outputQuantity)

    await supabase.from('material_process_stage_outputs').insert({
      organization_id: profile.organization_id,
      process_run_id: run.id,
      stage: startStage,
      output_type: 'unico',
      output_lot_code: `${lot.internal_lot}-${startStage === 'lavado' ? 'L' : 'S'}`,
      material_id: lot.material_id,
      input_quantity: inputQty,
      output_quantity: qty,
      waste_quantity: inputQty - qty,
      waste_percentage: ((inputQty - qty) / inputQty) * 100,
      unit: lot.unit,
      created_by: profile.id,
    })
  }

  await supabase
    .from('material_inventory_lots')
    .update({ available_quantity: 0, status: 'procesado' })
    .eq('id', lot.id)
}

/* =====================================================
   AVANZAR ETAPA (FIX PRINCIPAL AQUÍ)
===================================================== */
export async function advanceOutputToNextStage({
  sourceOutputId,
  nextStage,
  processDate,
  outputQuantity,
}) {
  const profile = await getProfile()

  const { data: source } = await supabase
    .from('material_process_stage_outputs')
    .select(`
      *,
      material_process_runs:process_run_id (
        id,
        source_inventory_lot_id
      )
    `)
    .eq('id', sourceOutputId)
    .single()

  const inheritedLot = source.material_process_runs?.source_inventory_lot_id

  if (!inheritedLot) {
    throw new Error('Proceso roto: no tiene lote origen')
  }

  const inputQty = numberOrZero(source.output_quantity)
  const outQty = numberOrZero(outputQuantity)

  const { data: run } = await supabase
    .from('material_process_runs')
    .insert({
      organization_id: profile.organization_id,
      source_output_id: source.id,
      source_inventory_lot_id: inheritedLot,
      source_material_id: source.material_id,
      source_internal_lot: source.output_lot_code,
      start_stage: nextStage,
      current_stage: nextStage,
      process_date: processDate,
      input_quantity: inputQty,
      input_unit: source.unit,
      status: RUN_STATUS.EN_PROCESO,
      created_by: profile.id,
    })
    .select()
    .single()

  await supabase.from('material_process_stage_outputs').insert({
    organization_id: profile.organization_id,
    process_run_id: run.id,
    source_output_id: source.id,
    stage: nextStage,
    output_type: source.output_type,
    output_lot_code: `${source.output_lot_code}-${nextStage === 'lavado' ? 'L' : 'S'}`,
    material_id: source.material_id,
    input_quantity: inputQty,
    output_quantity: outQty,
    waste_quantity: inputQty - outQty,
    waste_percentage: ((inputQty - outQty) / inputQty) * 100,
    unit: source.unit,
    created_by: profile.id,
  })

  await supabase
    .from('material_process_stage_outputs')
    .update({ was_used: true })
    .eq('id', source.id)
}

/* =====================================================
   PREVIEW COSTEO
===================================================== */
export async function getOutputSettlementPreview(outputId) {
  const { data: output } = await supabase
    .from('material_process_stage_outputs')
    .select(`
      *,
      material_process_runs:process_run_id (
        source_inventory_lot_id
      )
    `)
    .eq('id', outputId)
    .single()

  const lotId = output.material_process_runs?.source_inventory_lot_id

  if (!lotId) throw new Error('No se encontró lote origen')

  const { data: lot } = await supabase
    .from('material_inventory_lots')
    .select('*')
    .eq('id', lotId)
    .single()

  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('id', lot.supplier_id)
    .maybeSingle()

  const originalQty = numberOrZero(lot.original_quantity)
  const finalQty = numberOrZero(output.output_quantity)
  const originalAmount = numberOrZero(lot.total_cost)

  const wastePct = ((originalQty - finalQty) / originalQty) * 100

  return {
    finalQty,
    originalAmount,
    processWastePercentage: round2(wastePct),
    sourceInventoryLotId: lot.id,
    supplierId: lot.supplier_id,
    supplierName: supplier?.name || null,
    sourceInternalLot: lot.internal_lot,
    unit: output.unit,
  }
}

/* =====================================================
   ENVIAR A INVENTARIO + CXP
===================================================== */
export async function sendDriedOutputToProcessedInventory({
  outputId,
  location,
  settlementMode,
  acceptedSupplierWastePercentage,
}) {
  const profile = await getProfile()
  const preview = await getOutputSettlementPreview(outputId)

  const acceptedPct =
    settlementMode === 'auto'
      ? preview.processWastePercentage
      : numberOrZero(acceptedSupplierWastePercentage)

  const discount =
    preview.originalAmount * (acceptedPct / 100)

  const payable = preview.originalAmount - discount

  const { data: output, error: outputError } = await supabase
    .from('material_process_stage_outputs')
    .select('*')
    .eq('id', outputId)
    .single()

  if (outputError) throw new Error(`Error al cargar output: ${outputError.message}`)

  const { data: processedLot, error: lotError } = await supabase
    .from('processed_inventory_lots')
    .insert({
      organization_id: profile.organization_id,
      process_run_id: output.process_run_id,
      processed_stage: output.stage,
      source_output_id: output.id,
      source_inventory_lot_id: preview.sourceInventoryLotId,
      material_id: output.material_id,
      internal_lot: output.output_lot_code,
      unit: output.unit,
      available_quantity: preview.finalQty,
      original_quantity: preview.finalQty,
      accumulated_cost: payable,
      location: location || null,
      process_waste_percentage: preview.processWastePercentage,
      accepted_supplier_waste_percentage: acceptedPct,
      supplier_discount_amount: discount,
      payable_amount: payable,
      created_by: profile.id,
    })
    .select()
    .single()

  if (lotError) throw new Error(`Error al crear lote procesado: ${lotError.message}`)

  const { error: cxpError } = await supabase.from('supplier_accounts_payable').insert({
    organization_id: profile.organization_id,
    supplier_id: preview.supplierId,
    source_inventory_lot_id: preview.sourceInventoryLotId,
    processed_inventory_lot_id: processedLot.id,
    output_id: output.id,
    description: `Proceso MP lote ${preview.sourceInternalLot} -> ${output.output_lot_code}`,
    original_amount: preview.originalAmount,
    accepted_supplier_waste_percentage: acceptedPct,
    supplier_discount_amount: discount,
    payable_amount: payable,
    status: 'pendiente_factura',
  })

  if (cxpError) throw new Error(`Error al crear CXP: ${cxpError.message}`)

  const { error: updateError } = await supabase
    .from('material_process_stage_outputs')
    .update({ sent_to_processed_inventory: true })
    .eq('id', outputId)

  if (updateError) throw new Error(`Error al marcar output: ${updateError.message}`)

  return { settlement: { payableAmount: payable } }
}

/* =====================================================
   WORKFLOW HELPERS
===================================================== */
function computeWorkflowFields(output) {
  if (output.stage === STAGES.DESHOJE) {
    return {
      ...output,
      workflow_status: 'pendiente_lavado',
      workflow_label: 'Pendiente lavado',
      next_action: 'Registrar lavado',
      next_stage: STAGES.LAVADO,
    }
  }
  if (output.stage === STAGES.LAVADO) {
    return {
      ...output,
      workflow_status: 'pendiente_secado',
      workflow_label: 'Pendiente secado',
      next_action: 'Registrar secado',
      next_stage: STAGES.SECADO,
    }
  }
  if (output.stage === STAGES.SECADO) {
    return {
      ...output,
      workflow_status: 'pendiente_inventario',
      workflow_label: 'Listo para inventario',
      next_action: 'Enviar a inventario',
      next_stage: null,
    }
  }
  return {
    ...output,
    workflow_status: 'completado',
    workflow_label: 'Completado',
    next_action: null,
    next_stage: null,
  }
}

/* =====================================================
   DASHBOARD
===================================================== */
export async function getProcesosMpDashboardData() {
  const profile = await getProfile()

  const { data: inventoryLots } = await supabase
    .from('material_inventory_lots')
    .select(`
      *,
      suppliers (
        id,
        name
      ),
      materials (
        id,
        code,
        common_name,
        base_unit,
        category
      )
    `)
    .eq('organization_id', profile.organization_id)
    .gt('available_quantity', 0)
    .order('created_at', { ascending: false })

  const { data: outputs } = await supabase
    .from('material_process_stage_outputs')
    .select(`
      *,
      materials (
        id,
        code,
        common_name
      )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('sent_to_processed_inventory', false)
    .eq('was_used', false)
    .order('created_at', { ascending: false })


  const { data: runs } = await supabase
    .from('material_process_runs')
    .select(`
      *,
      materials:source_material_id (
        id,
        code,
        common_name
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  return {
    inventoryLots: (inventoryLots || []).map((lot) => ({
      ...lot,
      material_name: lot.materials?.common_name || 'Materia prima',
      material_code: lot.materials?.code || null,
    })),
    processOutputs: (outputs || []).map((output) =>
      computeWorkflowFields({
        ...output,
        material_name: output.materials?.common_name || 'Materia prima',
        material_code: output.materials?.code || null,
      })
    ),
    recentRuns: runs || [],
  }
}

export { STAGES }
