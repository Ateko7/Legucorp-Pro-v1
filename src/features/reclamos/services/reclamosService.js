import { supabase } from '../../../lib/supabase'

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

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

// ─── Consultas ─────────────────────────────────────────────────────────────────

export async function getClaimsData() {
  const profile = await getProfile()

  const [ordersRes, claimsRes] = await Promise.allSettled([
    supabase
      .from('orders')
      .select(`
        id, order_number, delivery_date, status, total, is_replacement, created_at,
        clients ( id, commercial_name ),
        order_items (
          id, quantity, quantity_packed, quantity_delivered, subtotal,
          product_presentations ( id, code, display_name, unit )
        )
      `)
      .eq('organization_id', profile.organization_id)
      .eq('status', 'entregado')
      .order('created_at', { ascending: false }),

    supabase
      .from('order_claims')
      .select(`
        id, order_id, claim_type, status, description, amount, cost_amount,
        resolution_type, resolution_notes, sale_loss, credit_note_value,
        replacement_order_id, created_at, resolved_at,
        orders!order_id ( order_number, clients ( commercial_name ) )
      `)
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
  ])

  return {
    orders: ordersRes.status === 'fulfilled' ? ordersRes.value.data || [] : [],
    claims: claimsRes.status === 'fulfilled' ? claimsRes.value.data || [] : [],
  }
}

// ─── Crear reclamo ─────────────────────────────────────────────────────────────

export async function createClaim(orderId, { claimType, description, amount, costAmount }) {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('order_claims')
    .insert({
      organization_id: profile.organization_id,
      order_id: orderId,
      claim_type: claimType,
      description: description || null,
      amount: n(amount),
      cost_amount: n(costAmount),
      created_by: profile.id,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Resolver reclamo ──────────────────────────────────────────────────────────

export async function resolveClaim(claimId, {
  resolutionType, resolutionNotes, saleLoss, creditNoteValue,
  replacementDeliveryDate, replacementItems,
}) {
  const profile = await getProfile()
  let replacementOrderId = null

  if (resolutionType === 'reposicion') {
    // Fetch original order info
    const { data: claim, error: claimFetchError } = await supabase
      .from('order_claims')
      .select('order_id, orders!order_id ( client_id, organization_id )')
      .eq('id', claimId)
      .single()
    if (claimFetchError) throw new Error(claimFetchError.message)

    // Create replacement order (total = 0, not invoiceable)
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        organization_id: profile.organization_id,
        client_id: claim.orders.client_id,
        delivery_date: replacementDeliveryDate || new Date().toISOString().slice(0, 10),
        status: 'confirmado',
        total: 0,
        is_replacement: true,
        is_invoiceable: false,
        replacement_for_order_id: claim.order_id,
        created_by: profile.id,
        channel: 'reposicion',
        notes: `Reposición por reclamo #${claimId.slice(0, 8)}`,
      })
      .select()
      .single()
    if (orderError) throw new Error(orderError.message)

    if (replacementItems?.length) {
      const itemsPayload = replacementItems
        .filter(i => n(i.quantity) > 0)
        .map(i => ({
          order_id: newOrder.id,
          product_presentation_id: i.product_presentation_id,
          quantity: n(i.quantity),
          unit_price: 0,
          subtotal: 0,
        }))
      if (itemsPayload.length > 0) {
        const { error: itemsErr } = await supabase.from('order_items').insert(itemsPayload)
        if (itemsErr) throw new Error(itemsErr.message)
      }
    }

    replacementOrderId = newOrder.id
  }

  const updateData = {
    status: 'cerrado',
    resolution_type: resolutionType,
    resolution_notes: resolutionNotes || null,
    resolved_by: profile.id,
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (resolutionType === 'refacturacion') updateData.sale_loss = n(saleLoss)
  if (resolutionType === 'nota_credito') updateData.credit_note_value = n(creditNoteValue)
  if (resolutionType === 'reposicion') updateData.replacement_order_id = replacementOrderId

  const { error } = await supabase
    .from('order_claims')
    .update(updateData)
    .eq('id', claimId)
  if (error) throw new Error(error.message)
}

// ─── Anular reclamo ────────────────────────────────────────────────────────────

export async function deleteClaim(claimId) {
  const { error } = await supabase
    .from('order_claims')
    .update({ status: 'anulado' })
    .eq('id', claimId)
  if (error) throw new Error(error.message || 'No se pudo anular el reclamo')
}

// ─── Resumen financiero de reclamos por cliente ─────────────────────────────────

export async function getClaimsSummary() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('order_claims')
    .select(`
      claim_type, status, resolution_type, sale_loss, credit_note_value, cost_amount, amount,
      orders!order_id ( client_id, clients ( commercial_name ) )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('status', 'cerrado')
  if (error) throw new Error(error.message)

  // Aggregate per client
  const byClient = {}
  for (const c of data || []) {
    const clientId = c.orders?.client_id
    const clientName = c.orders?.clients?.commercial_name || 'Desconocido'
    if (!byClient[clientId]) {
      byClient[clientId] = { clientName, saleLoss: 0, creditNotes: 0, costLoss: 0, total: 0 }
    }
    byClient[clientId].saleLoss += n(c.sale_loss)
    byClient[clientId].creditNotes += n(c.credit_note_value)
    byClient[clientId].costLoss += n(c.cost_amount)
    byClient[clientId].total += n(c.amount)
  }

  return Object.values(byClient).sort((a, b) => b.total - a.total)
}
