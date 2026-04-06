import { supabase } from '../../../lib/supabase'

export async function getPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
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
          common_name
        )
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las órdenes de compra')
  }

  return data || []
}

export async function getSuppliersForPurchaseOrders() {
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

export async function getMaterialsForPurchaseOrders() {
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

async function getMyOrganizationId() {
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

  return { organizationId: profile.organization_id, userId: user.id }
}

export async function createPurchaseOrder(payload) {
  const {
    supplier_id,
    delivery_date,
    notes,
    items,
  } = payload

  if (!supplier_id) {
    throw new Error('Debes seleccionar un proveedor')
  }

  if (!items || items.length === 0) {
    throw new Error('Debes agregar al menos una línea a la orden de compra')
  }

  const validItems = items.filter(
    (item) =>
      item.material_id &&
      Number(item.quantity || 0) > 0 &&
      item.unit &&
      Number(item.unit_cost || 0) >= 0
  )

  if (validItems.length === 0) {
    throw new Error('No hay líneas válidas para guardar')
  }

  const { organizationId, userId } = await getMyOrganizationId()

  const { data: orderNumber, error: orderNumberError } = await supabase.rpc(
    'generate_purchase_order_number',
    { p_organization_id: organizationId }
  )

  if (orderNumberError) {
    throw new Error(orderNumberError.message || 'No se pudo generar el número de orden')
  }

  // Asignar CC-01 (Producción) automáticamente
  const { data: ccProduccion } = await supabase
    .from('cost_centers')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('code', 'CC-01')
    .eq('is_active', true)
    .maybeSingle()

  const { data: purchaseOrder, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      organization_id: organizationId,
      supplier_id,
      order_number: orderNumber,
      delivery_date: delivery_date || null,
      status: 'abierta',
      notes: notes?.trim() || null,
      created_by: userId,
      cost_center_id: ccProduccion?.id || null,
    })
    .select()
    .single()

  if (poError) {
    throw new Error(poError.message || 'No se pudo crear la orden de compra')
  }

  const itemRows = validItems.map((item) => ({
    purchase_order_id: purchaseOrder.id,
    material_id: item.material_id,
    quantity: Number(item.quantity),
    unit: item.unit.trim(),
    unit_cost: Number(item.unit_cost),
  }))

  const { error: itemsError } = await supabase
    .from('purchase_order_items')
    .insert(itemRows)

  if (itemsError) {
    throw new Error(itemsError.message || 'La orden se creó, pero fallaron las líneas')
  }

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
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
          common_name
        )
      )
    `)
    .eq('id', purchaseOrder.id)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo recargar la orden creada')
  }

  return data
}

export async function updatePurchaseOrderStatus(orderId, status) {
  const allowed = ['abierta', 'enviada', 'parcial', 'cerrada', 'cancelada']

  if (!allowed.includes(status)) {
    throw new Error('Estado inválido')
  }

  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status })
    .eq('id', orderId)
    .select(`
      *,
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
          common_name
        )
      )
    `)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar el estado de la orden')
  }

  return data
}