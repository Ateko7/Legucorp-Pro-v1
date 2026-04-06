import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { file_base64, mime_type } = await req.json()

    if (!file_base64 || !mime_type) {
      return new Response(
        JSON.stringify({ error: 'Se requieren file_base64 y mime_type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const isImage = mime_type.startsWith('image/')
    const isPDF = mime_type === 'application/pdf'

    if (!isImage && !isPDF) {
      return new Response(
        JSON.stringify({ error: 'Solo se admiten imágenes (jpg, png, webp) y PDFs' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const fileBlock = isImage
      ? { type: 'image' as const, source: { type: 'base64' as const, media_type: mime_type, data: file_base64 } }
      : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: file_base64 } }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            fileBlock,
            {
              type: 'text',
              text: `Eres un asistente especializado en extraer información de pedidos de alimentos desde imágenes o documentos.

Analiza el contenido y extrae los datos del pedido. Responde ÚNICAMENTE con un objeto JSON válido, sin explicaciones ni bloques de código:

{
  "client_name": "nombre del cliente o empresa, null si no aparece",
  "delivery_date": "YYYY-MM-DD o null si no se menciona",
  "notes": "instrucciones especiales o notas, null si no hay",
  "items": [
    {
      "product_name": "nombre exacto del producto como aparece",
      "quantity": número_entero_positivo,
      "unit_price": número_decimal_o_null
    }
  ]
}

Reglas:
- items nunca debe estar vacío si hay productos en la imagen
- quantity siempre debe ser un número positivo (no string)
- Si ves un pedido en lista o tabla, extrae cada fila como un item
- delivery_date en formato ISO 8601 (YYYY-MM-DD)
- Responde SOLO el JSON, nada más`,
            },
          ],
        },
      ],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    let extracted
    try {
      extracted = JSON.parse(raw)
    } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No se pudo interpretar la respuesta de la IA')
      extracted = JSON.parse(match[0])
    }

    return new Response(JSON.stringify(extracted), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
