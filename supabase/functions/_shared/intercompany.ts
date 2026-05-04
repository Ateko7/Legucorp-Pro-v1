import { createClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key, x-intercompany-secret, x-function-secret',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
}

export function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function requirePost(req: Request) {
  if (req.method === 'OPTIONS') return null
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  return null
}

export async function parseJson(req: Request) {
  try {
    return await req.json()
  } catch {
    throw new Error('Invalid JSON body')
  }
}

export async function logIntegrationEvent(
  supabase: ReturnType<typeof getServiceClient>,
  input: {
    event_id?: string | null
    transaction_id?: string | null
    level?: 'debug' | 'info' | 'warn' | 'error'
    message: string
    context?: Record<string, unknown>
  },
) {
  const { error } = await supabase.from('integration_event_logs').insert({
    event_id: input.event_id || null,
    transaction_id: input.transaction_id || null,
    level: input.level || 'info',
    message: input.message,
    context: input.context || {},
  })

  if (error) {
    console.error('integration_event_logs insert failed', error)
  }
}

export function requireSharedSecret(req: Request, envName = 'INTERCOMPANY_SHARED_SECRET') {
  const expected = Deno.env.get(envName)
  if (!expected) {
    throw new Error(`Missing required secret ${envName}`)
  }

  const provided = req.headers.get('x-intercompany-secret')
  if (!provided || provided !== expected) {
    throw new Error('Unauthorized intercompany request')
  }
}

export function requireFunctionSecret(req: Request, envName: string) {
  const expected = Deno.env.get(envName)
  if (!expected) {
    throw new Error(`Missing required secret ${envName}`)
  }

  const provided = req.headers.get('x-function-secret')
  if (!provided || provided !== expected) {
    throw new Error('Unauthorized function request')
  }
}

export function getOrganizationId(req: Request) {
  return req.headers.get('x-organization-id') || Deno.env.get('INTERCOMPANY_ORGANIZATION_ID') || null
}
