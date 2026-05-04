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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const methodError = requirePost(req)
  if (methodError) return methodError

  const supabase = getServiceClient()

  try {
    requireSharedSecret(req)

    const payload = await parseJson(req) as Record<string, unknown>
    const organizationId = getOrganizationId(req)
    if (!organizationId) return jsonResponse({ error: 'Missing organization id' }, 400)

    const items = Array.isArray(payload.items) ? payload.items : []
    if (!items.length) return jsonResponse({ error: 'Purchase order requires at least one item' }, 400)

    const { data, error } = await supabase.rpc('receive_sv_purchase_order', {
      p_payload: payload,
      p_organization_id: organizationId,
    })

    if (error) throw new Error(error.message)

    await logIntegrationEvent(supabase, {
      level: 'info',
      message: 'SV purchase order received in GT',
      context: { result: data, purchase_order_id: payload.purchase_order_id || payload.po_id || payload.id },
    })

    return jsonResponse(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.includes('Unauthorized') ? 401 : 500

    await logIntegrationEvent(supabase, {
      level: status === 401 ? 'warn' : 'error',
      message: 'SV purchase order receive failed',
      context: { error: message },
    })

    return jsonResponse({ error: message }, status)
  }
})
