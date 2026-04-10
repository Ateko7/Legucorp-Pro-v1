const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SOURCE_URL =
  'https://mem.gob.gt/que-hacemos/hidrocarburos/comercializacion-downstream/precios-combustible-nacionales/'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
}

function parseMoney(raw: string | null | undefined) {
  if (!raw) return null
  const normalized = String(raw).replace(/[^0-9.,]/g, '').replace(/,/g, '')
  const value = Number(normalized)
  if (Number.isNaN(value) || value <= 0) return null
  return Math.round(value * 100) / 100
}

function extractPriceNearLabel(html: string, labels: string[]) {
  const amountPattern = '(?:Q\\s*)?(\\d{1,2}(?:[.,]\\d{2,3})?)'

  for (const label of labels) {
    const afterRegex = new RegExp(`${label}[\\s\\S]{0,450}?${amountPattern}`, 'i')
    const afterMatch = html.match(afterRegex)
    const afterValue = parseMoney(afterMatch?.[1])
    if (afterValue && afterValue >= 5 && afterValue <= 100) return afterValue

    const rowRegex = new RegExp(`<tr[\\s\\S]{0,1200}?${label}[\\s\\S]{0,1200}?<\\/tr>`, 'i')
    const rowMatch = html.match(rowRegex)?.[0] || ''
    const rowCandidates = [...rowMatch.matchAll(new RegExp(amountPattern, 'gi'))]
      .map((match) => parseMoney(match[1]))
      .filter((value): value is number => Boolean(value && value >= 5 && value <= 100))
    if (rowCandidates.length) return rowCandidates[0]
  }

  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Metodo no permitido' }, 405)
    }

    const response = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent': 'Legucorp Logistics Fuel Sync/1.0',
      },
    })

    const html = await response.text()
    if (!response.ok) {
      throw new Error(`La fuente oficial respondio ${response.status}`)
    }

    const normalized = normalizeHtml(html)
    const gasolinaSuper = extractPriceNearLabel(normalized, [
      'gasolina\\s+super(?:ior)?',
      'superior',
    ])
    const gasolinaRegular = extractPriceNearLabel(normalized, [
      'gasolina\\s+regular',
      'regular',
    ])
    const diesel = extractPriceNearLabel(normalized, [
      'diesel',
      'di[eé]sel',
    ])

    if (!gasolinaSuper || !gasolinaRegular || !diesel) {
      throw new Error('No se pudieron interpretar los precios oficiales desde MEM Guatemala')
    }

    return jsonResponse({
      source: 'mem_gt',
      source_name: 'MEM Guatemala',
      source_url: SOURCE_URL,
      fetched_at: new Date().toISOString(),
      prices: {
        gasolina_super: gasolinaSuper,
        gasolina_regular: gasolinaRegular,
        diesel,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return jsonResponse({ error: message }, 500)
  }
})
