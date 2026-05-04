import {
  corsHeaders,
  getServiceClient,
  jsonResponse,
  logIntegrationEvent,
  requireFunctionSecret,
  requirePost,
} from '../_shared/intercompany.ts'

type PendingEvent = {
  id: string
  transaction_id: string
  event_type: string
  payload: Record<string, unknown>
  retries: number
  intercompany_transactions: {
    id: string
    transaction_code: string
    status: string
  } | null
}

async function postToSv(endpoint: string, event: PendingEvent) {
  const transactionCode = event.intercompany_transactions?.transaction_code ||
    String(event.payload?.transaction_code || '')
  const sharedSecret = Deno.env.get('INTERCOMPANY_SHARED_SECRET')

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': transactionCode,
      ...(sharedSecret ? { 'x-intercompany-secret': sharedSecret } : {}),
    },
    body: JSON.stringify(event.payload),
  })

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = await res.text()
  }

  if (!res.ok) {
    const message = typeof body === 'object' && body && 'error' in body
      ? String((body as { error: unknown }).error)
      : `SV endpoint responded ${res.status}`
    throw new Error(message)
  }

  return body
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const methodError = requirePost(req)
  if (methodError) return methodError

  try {
    requireFunctionSecret(req, 'PROCESS_INTERCOMPANY_SECRET')

    const endpoint = Deno.env.get('SV_INTERCOMPANY_RECEIVE_URL')
    if (!endpoint) return jsonResponse({ error: 'Missing SV_INTERCOMPANY_RECEIVE_URL' }, 500)
    if (!Deno.env.get('INTERCOMPANY_SHARED_SECRET')) {
      return jsonResponse({ error: 'Missing INTERCOMPANY_SHARED_SECRET' }, 500)
    }

    const supabase = getServiceClient()
    const maxRetries = Number(Deno.env.get('INTERCOMPANY_MAX_RETRIES') || 10)
    const batchSize = Math.min(Number(Deno.env.get('INTERCOMPANY_BATCH_SIZE') || 25), 100)

    const { data, error } = await supabase
      .from('integration_events')
      .select(`
        id,
        transaction_id,
        event_type,
        payload,
        retries,
        intercompany_transactions(id, transaction_code, status)
      `)
      .eq('status', 'pending')
      .lt('retries', maxRetries)
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (error) throw new Error(error.message)

    const events = (data || []) as PendingEvent[]
    const results: Array<Record<string, unknown>> = []

    for (const event of events) {
      try {
        const response = await postToSv(endpoint, event)

        const { error: eventError } = await supabase
          .from('integration_events')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', event.id)

        if (eventError) throw new Error(eventError.message)

        const nextTransactionStatus = event.event_type === 'DISPATCH_CONFIRMED'
          ? 'IN_TRANSIT'
          : event.event_type === 'DELIVERY_CONFIRMED'
            ? 'DELIVERED'
            : 'SENT'

        const { error: txError } = await supabase
          .from('intercompany_transactions')
          .update({ status: nextTransactionStatus })
          .eq('id', event.transaction_id)

        if (txError) throw new Error(txError.message)

        await logIntegrationEvent(supabase, {
          event_id: event.id,
          transaction_id: event.transaction_id,
          level: 'info',
          message: 'Intercompany event sent to SV',
          context: { response },
        })

        results.push({ event_id: event.id, status: 'sent' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown processing error'
        const retries = Number(event.retries || 0) + 1
        const failed = retries >= maxRetries

        await supabase
          .from('integration_events')
          .update({
            status: failed ? 'failed' : 'pending',
            retries,
            last_error: message,
          })
          .eq('id', event.id)

        await logIntegrationEvent(supabase, {
          event_id: event.id,
          transaction_id: event.transaction_id,
          level: failed ? 'error' : 'warn',
          message: failed ? 'Intercompany event failed permanently' : 'Intercompany event retry scheduled',
          context: { error: message, retries },
        })

        results.push({ event_id: event.id, status: failed ? 'failed' : 'retry', error: message })
      }
    }

    return jsonResponse({ processed: results.length, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.includes('Unauthorized') ? 401 : 500
    return jsonResponse({ error: message }, status)
  }
})
