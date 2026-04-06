import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? ''
const VERIFY_TOKEN   = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? 'legucorp_verify'
const PHONE_ID       = Deno.env.get('WHATSAPP_PHONE_ID') ?? ''
const ORG_ID         = Deno.env.get('ORGANIZATION_ID') ?? ''

// ─── Enviar mensaje de WhatsApp ───────────────────────────────────────────────

async function sendWA(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !PHONE_ID) return
  await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  })
}

// ─── Buscar o crear cliente por teléfono ─────────────────────────────────────

async function findClientByPhone(phone: string, orgId: string) {
  // Intentar con los últimos 8 dígitos
  const suffix = phone.replace(/\D/g, '').slice(-8)
  const { data } = await supabase
    .from('clients')
    .select('id, commercial_name')
    .eq('organization_id', orgId)
    .ilike('phone', `%${suffix}%`)
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// ─── Obtener presentaciones activas ──────────────────────────────────────────

async function getActivePresentations(orgId: string) {
  const { data } = await supabase
    .from('product_presentations')
    .select('id, display_name, net_weight, unit, suggested_price')
    .eq('organization_id', orgId)
    .eq('status', 'activo')
  return data ?? []
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // ── Verificación de webhook (Meta envía GET) ─────────────────────────────
  if (req.method === 'GET') {
    const url     = new URL(req.url)
    const mode    = url.searchParams.get('hub.mode')
    const token   = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  // ── Mensajes entrantes (Meta envía POST) ─────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = await req.json()

      const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages
      if (!messages?.length) return new Response('OK', { status: 200 })

      const msg   = messages[0]
      const from  = msg.from as string       // número del cliente
      const msgId = msg.id as string
      const text  = msg.text?.body as string ?? ''

      if (!text.trim()) return new Response('OK', { status: 200 })

      // Evitar re-procesar el mismo mensaje (idempotencia básica)
      const { data: existing } = await supabase
        .from('orders')
        .select('id')
        .eq('channel_reference', msgId)
        .limit(1)
        .maybeSingle()
      if (existing) return new Response('OK', { status: 200 })

      const orgId = ORG_ID
      if (!orgId) {
        console.error('ORGANIZATION_ID no configurado')
        return new Response('OK', { status: 200 })
      }

      const [client, presentations] = await Promise.all([
        findClientByPhone(from, orgId),
        getActivePresentations(orgId),
      ])

      const presListStr = presentations
        .map((p) => `- ${p.display_name} (${p.net_weight} ${p.unit}) — sugerido Q${p.suggested_price}`)
        .join('\n')

      // ── Claude analiza si es un pedido y extrae los datos ────────────────
      const aiRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Eres el asistente de pedidos de LegucorPro, empresa de vegetales procesados.

Mensaje de WhatsApp del cliente (${from}):
"${text}"

Catálogo disponible:
${presListStr || '(sin productos registrados)'}

Responde SOLO con JSON:
{
  "is_order": true/false,
  "items": [
    { "presentation_id": "id_exacto_o_null", "product_name": "...", "quantity": número }
  ],
  "delivery_date": "YYYY-MM-DD o null",
  "notes": "...",
  "reply_message": "mensaje corto de confirmación en español para enviar al cliente"
}

Reglas:
- is_order = true si el mensaje contiene una lista de productos con cantidades
- Para cada item, intenta encontrar el presentation_id del catálogo; si no coincide usa null
- quantity siempre debe ser número positivo`,
          },
        ],
      })

      const aiText = aiRes.content[0].type === 'text' ? aiRes.content[0].text.trim() : '{}'
      let parsed: {
        is_order: boolean
        items?: { presentation_id: string | null; product_name: string; quantity: number }[]
        delivery_date?: string | null
        notes?: string | null
        reply_message?: string
      }

      try {
        const match = aiText.match(/\{[\s\S]*\}/)
        parsed = match ? JSON.parse(match[0]) : { is_order: false }
      } catch {
        parsed = { is_order: false }
      }

      if (!parsed.is_order) {
        await sendWA(from, parsed.reply_message ?? '¡Hola! Para hacer un pedido indícanos los productos y cantidades que necesitas.')
        return new Response('OK', { status: 200 })
      }

      // ── Construir notas con el resumen del mensaje original ──────────────
      const itemsSummary = (parsed.items ?? [])
        .map((i) => `• ${i.product_name}: ${i.quantity}`)
        .join('\n')

      const orderNotes = [
        `[Pedido WhatsApp de ${from}]`,
        `Mensaje: "${text}"`,
        '',
        'Productos detectados:',
        itemsSummary,
        parsed.notes ? `\nNotas: ${parsed.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

      // ── Insertar pedido ──────────────────────────────────────────────────
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          organization_id: orgId,
          client_id:        client?.id ?? null,
          delivery_date:    parsed.delivery_date ?? tomorrow,
          status:           'confirmado',
          notes:            orderNotes,
          total:            0,
          channel:          'whatsapp',
          channel_reference: msgId,
        })
        .select('id, order_number')
        .single()

      if (orderErr) {
        console.error('Error al crear pedido:', orderErr.message)
        await sendWA(from, 'Hubo un error al registrar tu pedido. Por favor contáctanos directamente.')
        return new Response('OK', { status: 200 })
      }

      // ── Insertar ítems que tengan presentation_id conocido ───────────────
      const validItems = (parsed.items ?? []).filter((i) => i.presentation_id)
      if (validItems.length > 0) {
        const presentationMap = Object.fromEntries(presentations.map((p) => [p.id, p]))
        const itemsPayload = validItems.map((i) => {
          const pres = presentationMap[i.presentation_id!]
          const unitPrice = pres?.suggested_price ?? 0
          return {
            order_id: order.id,
            product_presentation_id: i.presentation_id,
            quantity: i.quantity,
            unit_price: unitPrice,
            subtotal: i.quantity * unitPrice,
          }
        })

        await supabase.from('order_items').insert(itemsPayload)

        const total = itemsPayload.reduce((acc, it) => acc + it.subtotal, 0)
        await supabase.from('orders').update({ total }).eq('id', order.id)
      }

      // ── Responder al cliente ─────────────────────────────────────────────
      const clientName = client?.commercial_name ?? 'estimado cliente'
      const confirmMsg = parsed.reply_message
        ?? `✅ Pedido recibido, ${clientName}!\n\nNúmero de pedido: #${order.order_number ?? order.id.slice(0, 8).toUpperCase()}\n\n${itemsSummary}\n\nNuestro equipo lo procesará pronto. ¡Gracias!`

      await sendWA(from, confirmMsg)

      return new Response('OK', { status: 200 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      console.error('WhatsApp webhook error:', msg)
      return new Response('OK', { status: 200 }) // Siempre 200 para Meta
    }
  }

  return new Response('Method Not Allowed', { status: 405 })
})
