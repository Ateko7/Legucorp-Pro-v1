import { supabase } from '../../../lib/supabase'

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id, role, full_name')
    .eq('id', user.id)
    .single()
  if (error) throw new Error(error.message)
  return profile
}

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

// ─── Consultas ─────────────────────────────────────────────────────────────────

export async function getLogisticsOrders() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, delivery_date, status, total, notes, is_replacement, created_at,
      clients ( id, commercial_name, main_address, phone ),
      order_items (
        id, quantity, quantity_packed, quantity_delivered, unit_price, subtotal,
        product_presentations ( id, code, display_name, unit, standard_cost )
      ),
      order_logistics ( id, truck, route, driver_name, notes, assigned_at ),
      order_deliveries (
        id, is_partial, delivered_at, delivery_photo_url, notes,
        order_delivery_items ( order_item_id, quantity_delivered )
      )
    `)
    .eq('organization_id', profile.organization_id)
    .in('status', ['facturado', 'en_logistica', 'entregado'])
    .order('delivery_date', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function getOrderForDelivery(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, delivery_date, status, total, notes,
      clients ( id, commercial_name, main_address, phone ),
      order_items (
        id, quantity, quantity_packed, quantity_delivered, subtotal,
        product_presentations ( code, display_name, unit )
      ),
      order_logistics ( id, truck, route, driver_name ),
      order_deliveries (
        id, is_partial, delivered_at, delivery_photo_url,
        order_delivery_items ( order_item_id, quantity_delivered )
      )
    `)
    .eq('id', orderId)
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Asignar logística ─────────────────────────────────────────────────────────

export async function assignLogistics(orderId, { truck, route, driverName, notes }) {
  const profile = await getProfile()

  const { data: existing } = await supabase
    .from('order_logistics')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('order_logistics')
      .update({ truck, route, driver_name: driverName, notes: notes || null, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('order_logistics')
      .insert({
        organization_id: profile.organization_id,
        order_id: orderId,
        truck: truck || null,
        route: route || null,
        driver_name: driverName || null,
        notes: notes || null,
        assigned_by: profile.id,
      })
    if (error) throw new Error(error.message)
  }

  const { error: statusError } = await supabase
    .from('orders')
    .update({ status: 'en_logistica' })
    .eq('id', orderId)
  if (statusError) throw new Error(statusError.message)
}

// ─── Subir foto de entrega ─────────────────────────────────────────────────────

export async function uploadDeliveryPhoto(file) {
  const { data: { user } } = await supabase.auth.getUser()
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${user.id}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('delivery-photos')
    .upload(path, file, { upsert: false })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('delivery-photos').getPublicUrl(path)
  return data.publicUrl
}

// ─── Registrar entrega ─────────────────────────────────────────────────────────

export async function recordDelivery(orderId, { deliveryItems, photoUrl, notes }) {
  const profile = await getProfile()

  const itemsWithQty = (deliveryItems || []).filter(i => n(i.quantity_delivered) > 0)
  if (itemsWithQty.length === 0) throw new Error('Ingresa al menos una cantidad entregada')

  // Check total deliverable
  const totalPacked = deliveryItems.reduce((acc, i) => acc + n(i.quantity_packed), 0)
  const totalDelivering = itemsWithQty.reduce((acc, i) => acc + n(i.quantity_delivered), 0)
  const isPartial = totalDelivering < totalPacked

  // Create delivery record
  const { data: delivery, error: deliveryError } = await supabase
    .from('order_deliveries')
    .insert({
      organization_id: profile.organization_id,
      order_id: orderId,
      is_partial: isPartial,
      delivery_photo_url: photoUrl || null,
      notes: notes || null,
      delivered_by: profile.id,
    })
    .select()
    .single()
  if (deliveryError) throw new Error(deliveryError.message)

  // Insert delivery items
  const { error: itemsError } = await supabase
    .from('order_delivery_items')
    .insert(itemsWithQty.map(i => ({
      delivery_id: delivery.id,
      order_item_id: i.order_item_id,
      quantity_delivered: n(i.quantity_delivered),
    })))
  if (itemsError) throw new Error(itemsError.message)

  // Update cumulative quantity_delivered on each order_item
  for (const item of itemsWithQty) {
    const { data: current } = await supabase
      .from('order_items')
      .select('quantity_delivered')
      .eq('id', item.order_item_id)
      .single()
    const newDelivered = n(current?.quantity_delivered) + n(item.quantity_delivered)
    await supabase
      .from('order_items')
      .update({ quantity_delivered: newDelivered })
      .eq('id', item.order_item_id)
  }

  // If all items fully delivered → mark as entregado
  const { data: allItems } = await supabase
    .from('order_items')
    .select('quantity_packed, quantity_delivered')
    .eq('order_id', orderId)

  const allDelivered = (allItems || []).every(
    i => n(i.quantity_delivered) >= n(i.quantity_packed)
  )
  if (allDelivered) {
    await supabase.from('orders').update({ status: 'entregado' }).eq('id', orderId)
  }
}
