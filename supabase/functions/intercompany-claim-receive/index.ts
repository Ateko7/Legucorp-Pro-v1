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

    if (!payload.gt_order_id && !payload.gt_order_number) {
      return jsonResponse({ error: 'Claim requires gt_order_id or gt_order_number' }, 400)
    }

    const { data, error } = await supabase.rpc('receive_sv_intercompany_claim', {
      p_payload: payload,
      p_organization_id: organizationId,
    })

    if (error) throw new Error(error.message)

    await logIntegrationEvent(supabase, {
      level: 'info',
      message: 'SV intercompany claim received in GT',
      context: { result: data, claim_id: payload.claim_id || payload.sv_claim_id },
    })

    return jsonResponse(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.includes('Unauthorized') ? 401 : 500

    await logIntegrationEvent(supabase, {
      level: status === 401 ? 'warn' : 'error',
      message: 'SV intercompany claim receive failed',
      context: { error: message },
    })

    return jsonResponse({ error: message }, status)
  }
})
