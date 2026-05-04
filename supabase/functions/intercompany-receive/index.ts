import {
  corsHeaders,
  getOrganizationId,
  getServiceClient,
  jsonResponse,
  logIntegrationEvent,
  parseJson,
  requirePost,
  requireSharedSecret,
} from '../_shared/intercompany.ts'

function assertPayload(payload: Record<string, unknown>) {
  if (!payload.transaction_code) throw new Error('transaction_code is required')
  if (!payload.dispatch_id) throw new Error('dispatch_id is required')
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error('items must be a non-empty array')
  }

  for (const item of payload.items as Array<Record<string, unknown>>) {
    if (!item.sku) throw new Error('Every item requires sku')
    if (Number(item.qty || 0) <= 0) throw new Error(`Invalid qty for SKU ${item.sku}`)
    if (!Array.isArray(item.lots) || item.lots.length === 0) {
      throw new Error(`SKU ${item.sku} requires at least one lot`)
    }

    const lotQty = (item.lots as Array<Record<string, unknown>>)
      .reduce((sum, lot) => sum + Number(lot.qty || 0), 0)

    if (Math.abs(lotQty - Number(item.qty || 0)) > 0.0001) {
      throw new Error(`Lot quantity mismatch for SKU ${item.sku}`)
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const methodError = requirePost(req)
  if (methodError) return methodError

  const supabase = getServiceClient()

  try {
    requireSharedSecret(req)
    const payload = await parseJson(req) as Record<string, unknown>
    assertPayload(payload)

    const transactionCode = String(payload.transaction_code)
    const organizationId = getOrganizationId(req)

    const { data: existingReceipt, error: existingError } = await supabase
      .from('intercompany_receipts')
      .select('id, transaction_id')
      .eq('transaction_code', transactionCode)
      .maybeSingle()

    if (existingError) throw new Error(existingError.message)

    if (existingReceipt?.id) {
      await logIntegrationEvent(supabase, {
        transaction_id: existingReceipt.transaction_id,
        level: 'info',
        message: 'Idempotent intercompany receive replay',
        context: { transaction_code: transactionCode, receipt_id: existingReceipt.id },
      })

      return jsonResponse({
        status: 'RECEIVED',
        receipt_id: existingReceipt.id,
        idempotent: true,
      })
    }

    const { data, error } = await supabase.rpc('receive_intercompany_dispatch', {
      p_payload: payload,
      p_organization_id: organizationId,
    })

    if (error) throw new Error(error.message)

    return jsonResponse(data || { status: 'RECEIVED' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown receive error'

    await logIntegrationEvent(supabase, {
      level: 'error',
      message: 'Intercompany receive failed',
      context: { error: message },
    })

    const status = message.includes('Unauthorized') ? 401 : 400
    return jsonResponse({ error: message }, status)
  }
})

