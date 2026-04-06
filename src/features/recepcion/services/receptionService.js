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
    .in('status', ['abierta', 'parcial', 'enviada'])
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las órdenes de compra')
  }

  return data || []
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
    unit: unit?.trim(),
    quality_notes: quality_notes?.trim() || null,
    unit_cost: Number(unit_cost || 0),
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
        order_number
      )
    `)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo crear la recepción')
  }

  return data
}

export async function releaseReception(receptionId) {
  const { data, error } = await supabase.rpc('release_material_reception', {
    p_reception_id: receptionId,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo liberar el lote')
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