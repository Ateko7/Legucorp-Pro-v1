import { supabase } from '../../../lib/supabase'

export async function getReceptions() {
  const { data, error } = await supabase
    .from('material_receptions')
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
        base_unit
      ),
      purchase_orders (
        id,
        order_number
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las recepciones')
  }

  return data || []
}

export async function getReceptionSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('status', 'activo')
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los proveedores')
  }

  return data || []
}

export async function getReceptionMaterials() {
  const { data, error } = await supabase
    .from('materials')
    .select('id, code, common_name, base_unit')
    .eq('status', 'activo')
    .order('common_name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las materias primas')
  }

  return data || []
}

export async function getOpenPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      id,
      order_number,
      status,
      supplier_id,
      suppliers (
        id,
        name
      ),
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
    .eq('status', 'enviada')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las órdenes de compra')
  }

  const purchaseOrders = data || []
  const itemIds = purchaseOrders.flatMap((po) => (po.purchase_order_items || []).map((item) => item.id))

  if (itemIds.length === 0) return purchaseOrders

  const { data: receptions, error: receptionsError } = await supabase
    .from('material_receptions')
    .select('purchase_order_item_id')
    .in('purchase_order_item_id', itemIds)

  if (receptionsError) {
    throw new Error(receptionsError.message || 'No se pudieron validar las recepciones de la orden')
  }

  const receivedItemIds = new Set((receptions || []).map((row) => row.purchase_order_item_id).filter(Boolean))

  return purchaseOrders
    .map((po) => ({
      ...po,
      purchase_order_items: (po.purchase_order_items || []).filter((item) => !receivedItemIds.has(item.id)),
    }))
    .filter((po) => (po.purchase_order_items || []).length > 0)
}

async function updatePurchaseOrderReceptionStatus(purchaseOrderId) {
  if (!purchaseOrderId) return

  const { data: items, error: itemsError } = await supabase
    .from('purchase_order_items')
    .select('id')
    .eq('purchase_order_id', purchaseOrderId)

  if (itemsError) {
    throw new Error(itemsError.message || 'No se pudo validar el estado de la orden de compra')
  }

  const itemIds = (items || []).map((item) => item.id)
  if (itemIds.length === 0) return

  const { data: receptions, error: receptionsError } = await supabase
    .from('material_receptions')
    .select('purchase_order_item_id')
    .eq('purchase_order_id', purchaseOrderId)
    .in('purchase_order_item_id', itemIds)

  if (receptionsError) {
    throw new Error(receptionsError.message || 'No se pudo validar recepciones de la orden de compra')
  }

  const receivedCount = new Set((receptions || []).map((row) => row.purchase_order_item_id).filter(Boolean)).size
  const nextStatus = receivedCount >= itemIds.length ? 'cerrada' : receivedCount > 0 ? 'parcial' : 'enviada'

  const { error: updateError } = await supabase
    .from('purchase_orders')
    .update({ status: nextStatus })
    .eq('id', purchaseOrderId)

  if (updateError) {
    throw new Error(updateError.message || 'No se pudo actualizar el estado de la orden de compra')
  }
}

export async function createReception(payload) {
  const {
    purchase_order_id,
    purchase_order_item_id,
    supplier_id,
    material_id,
    supplier_lot,
    received_date,
    quantity_received,
    quantity_accepted,
    unit,
    quality_notes,
    unit_cost,
    programa_agricola_id,
    programa_entrega_id,
  } = payload

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('No se pudo obtener el usuario autenticado')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error(profileError.message || 'No se pudo obtener la organización del usuario')
  }

  if (!profile?.organization_id) {
    throw new Error('El usuario no tiene organization_id asignado')
  }

  if (purchase_order_id) {
    if (!purchase_order_item_id) {
      throw new Error('Debes seleccionar una línea de la orden de compra')
    }

    const { data: purchaseOrder, error: purchaseOrderError } = await supabase
      .from('purchase_orders')
      .select('id, status')
      .eq('id', purchase_order_id)
      .single()

    if (purchaseOrderError || !purchaseOrder) {
      throw new Error(purchaseOrderError?.message || 'No se encontró la orden de compra')
    }

    if (purchaseOrder.status !== 'enviada') {
      throw new Error('Solo se puede recepcionar una orden de compra en estado enviada')
    }

    const { data: existingReception, error: receptionValidationError } = await supabase
      .from('material_receptions')
      .select('id, internal_lot')
      .eq('purchase_order_item_id', purchase_order_item_id)
      .maybeSingle()

    if (receptionValidationError) {
      throw new Error(receptionValidationError.message || 'No se pudo validar la recepción previa de la línea')
    }

    if (existingReception?.id) {
      throw new Error(`Esta línea de orden ya fue recepcionada en el lote ${existingReception.internal_lot}`)
    }
  }

  const insertPayload = {
    organization_id: profile.organization_id,
    purchase_order_id: purchase_order_id || null,
    purchase_order_item_id: purchase_order_item_id || null,
    supplier_id,
    material_id,
    supplier_lot: supplier_lot?.trim() || null,
    received_date,
    quantity_received: Number(quantity_received || 0),
    quantity_accepted: Number(quantity_accepted || 0),
    quantity_rejected: Math.max(Number(quantity_received || 0) - Number(quantity_accepted || 0), 0),
    unit: unit?.trim(),
    quality_notes: quality_notes?.trim() || null,
    unit_cost: Number(unit_cost || 0),
    real_cost: Number(quantity_accepted || 0) * Number(unit_cost || 0),
    programa_agricola_id: programa_agricola_id || null,
    programa_entrega_id: programa_entrega_id || null,
    created_by: user.id,
  }

  const { data, error } = await supabase
    .from('material_receptions')
    .insert(insertPayload)
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
        base_unit
      ),
      purchase_orders (
        id,
        order_number,
        programa_agricola_id,
        programa_entrega_id
      )
    `)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo crear la recepción')
  }

  if (purchase_order_id) {
    await updatePurchaseOrderReceptionStatus(purchase_order_id)
  }

  return data
}

export async function createBulkReceptions(payload) {
  const {
    purchase_order_id,
    supplier_id,
    received_date,
    quality_notes,
    items = [],
    programa_agricola_id,
    programa_entrega_id,
  } = payload

  if (!purchase_order_id) {
    throw new Error('Debes seleccionar una orden de compra')
  }

  if (!supplier_id) {
    throw new Error('No se encontró el proveedor de la orden de compra')
  }

  const validItems = (items || []).filter(
    (item) =>
      item.purchase_order_item_id &&
      item.material_id &&
      Number(item.quantity_received || 0) > 0 &&
      Number(item.quantity_accepted || 0) >= 0 &&
      item.unit &&
      Number(item.unit_cost || 0) >= 0
  )

  if (!validItems.length) {
    throw new Error('Debes ingresar al menos una línea válida para recepcionar')
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('No se pudo obtener el usuario autenticado')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error(profileError.message || 'No se pudo obtener la organización del usuario')
  }

  if (!profile?.organization_id) {
    throw new Error('El usuario no tiene organization_id asignado')
  }

  const { data: purchaseOrder, error: purchaseOrderError } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .eq('id', purchase_order_id)
    .single()

  if (purchaseOrderError || !purchaseOrder) {
    throw new Error(purchaseOrderError?.message || 'No se encontró la orden de compra')
  }

  if (purchaseOrder.status !== 'enviada') {
    throw new Error('Solo se puede recepcionar una orden de compra en estado enviada')
  }

  const itemIds = validItems.map((item) => item.purchase_order_item_id)
  const { data: existingReceptions, error: existingReceptionsError } = await supabase
    .from('material_receptions')
    .select('purchase_order_item_id, internal_lot')
    .in('purchase_order_item_id', itemIds)

  if (existingReceptionsError) {
    throw new Error(existingReceptionsError.message || 'No se pudo validar recepciones previas')
  }

  if ((existingReceptions || []).length > 0) {
    const lots = existingReceptions.map((row) => row.internal_lot).filter(Boolean).join(', ')
    throw new Error(`Una o más líneas ya fueron recepcionadas${lots ? ` (${lots})` : ''}`)
  }

  const insertPayload = validItems.map((item) => ({
    organization_id: profile.organization_id,
    purchase_order_id,
    purchase_order_item_id: item.purchase_order_item_id,
    supplier_id,
    material_id: item.material_id,
    supplier_lot: item.supplier_lot?.trim() || null,
    received_date,
    quantity_received: Number(item.quantity_received || 0),
    quantity_accepted: Number(item.quantity_accepted || 0),
    quantity_rejected: Math.max(Number(item.quantity_received || 0) - Number(item.quantity_accepted || 0), 0),
    unit: item.unit?.trim(),
    quality_notes: item.quality_notes?.trim() || quality_notes?.trim() || null,
    unit_cost: Number(item.unit_cost || 0),
    real_cost: Number(item.quantity_accepted || 0) * Number(item.unit_cost || 0),
    programa_agricola_id: item.programa_agricola_id || programa_agricola_id || null,
    programa_entrega_id: item.programa_entrega_id || programa_entrega_id || null,
    created_by: user.id,
  }))

  const { data, error } = await supabase
    .from('material_receptions')
    .insert(insertPayload)
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
        base_unit
      ),
      purchase_orders (
        id,
        order_number,
        programa_agricola_id,
        programa_entrega_id
      )
    `)

  if (error) {
    throw new Error(error.message || 'No se pudieron crear las recepciones')
  }

  await updatePurchaseOrderReceptionStatus(purchase_order_id)

  return data || []
}

export async function releaseReception(receptionId) {
  const { data: reception, error: receptionError } = await supabase
    .from('material_receptions')
    .select('id, programa_agricola_id, programa_entrega_id')
    .eq('id', receptionId)
    .single()

  if (receptionError) {
    throw new Error(receptionError.message || 'No se pudo obtener la recepción')
  }

  const { data, error } = await supabase.rpc('release_material_reception', {
    p_reception_id: receptionId,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo liberar el lote')
  }

  if (reception?.programa_agricola_id || reception?.programa_entrega_id) {
    const { error: lotError } = await supabase
      .from('material_inventory_lots')
      .update({
        programa_agricola_id: reception.programa_agricola_id || null,
        programa_entrega_id: reception.programa_entrega_id || null,
      })
      .eq('reception_id', receptionId)

    if (lotError) {
      throw new Error(lotError.message || 'No se pudo vincular el inventario al programa agrícola')
    }
  }

  return data
}

export async function rejectReception(receptionId) {
  const { data, error } = await supabase.rpc('reject_material_reception', {
    p_reception_id: receptionId,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo rechazar el lote')
  }

  return data
}
