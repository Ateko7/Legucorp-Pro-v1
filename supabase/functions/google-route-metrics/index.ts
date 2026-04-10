const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type StopInput = {
  label?: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function n(value: unknown) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function parseDurationSeconds(raw: string | null | undefined) {
  if (!raw) return 0
  const match = String(raw).match(/([\d.]+)s$/)
  if (!match) return 0
  return Math.round(Number(match[1]) || 0)
}

async function geocodeAddress(address: string, apiKey: string) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  const json = await res.json()

  if (!res.ok) {
    throw new Error(json?.error_message || `Google Geocoding respondio ${res.status}`)
  }

  if (json?.status !== 'OK' || !json?.results?.length) {
    throw new Error(json?.error_message || `No se pudo geocodificar la direccion: ${address}`)
  }

  const first = json.results[0]
  return {
    address: first.formatted_address || address,
    latitude: n(first.geometry?.location?.lat),
    longitude: n(first.geometry?.location?.lng),
  }
}

async function normalizeStop(stop: StopInput | null | undefined, apiKey: string) {
  const latitude = n(stop?.latitude)
  const longitude = n(stop?.longitude)
  const address = String(stop?.address || '').trim()

  if (latitude != null && longitude != null) {
    return {
      label: stop?.label || address || 'Punto',
      address,
      latitude,
      longitude,
    }
  }

  if (!address) {
    throw new Error('Cada punto debe incluir coordenadas o direccion')
  }

  const geocoded = await geocodeAddress(address, apiKey)
  return {
    label: stop?.label || geocoded.address || address,
    address: geocoded.address || address,
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
  }
}

Deno.serve(async (req) => {
  let stage = 'init'

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    stage = 'method'
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Metodo no permitido' }, 405)
    }

    stage = 'api_key'
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || ''
    if (!apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY no configurado en Supabase Functions')
    }

    stage = 'body'
    const body = await req.json()

    stage = 'origin'
    const origin = await normalizeStop(body?.origin, apiKey)

    stage = 'destination'
    const destination = await normalizeStop(body?.destination, apiKey)

    stage = 'routes_api'
    const routeRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: origin.latitude,
              longitude: origin.longitude,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: false,
        languageCode: 'es-419',
        units: 'METRIC',
      }),
    })

    const routeJson = await routeRes.json()
    if (!routeRes.ok) {
      throw new Error(routeJson?.error?.message || `Google Routes respondio ${routeRes.status}`)
    }

    stage = 'parse_response'
    const firstRoute = routeJson?.routes?.[0]
    if (!firstRoute) {
      const fallbackReason =
        routeJson?.fallbackInfo?.routingMode ||
        routeJson?.fallbackInfo?.reason ||
        routeJson?.error?.message ||
        null

      const details = [
        'Google Maps no devolvio una ruta valida',
        fallbackReason ? `detalle=${fallbackReason}` : null,
        origin?.address ? `origen=${origin.address}` : null,
        origin?.latitude != null && origin?.longitude != null ? `origen_coords=${origin.latitude},${origin.longitude}` : null,
        destination?.address ? `destino=${destination.address}` : null,
        destination?.latitude != null && destination?.longitude != null ? `destino_coords=${destination.latitude},${destination.longitude}` : null,
      ]
        .filter(Boolean)
        .join(' | ')

      throw new Error(details)
    }

    const distanceMeters = Number(firstRoute.distanceMeters || 0)
    const durationSeconds = parseDurationSeconds(firstRoute.duration)

    return jsonResponse({
      provider: 'google_maps',
      origin,
      destination,
      distance_meters: distanceMeters,
      distance_km: Number((distanceMeters / 1000).toFixed(3)),
      duration_seconds: durationSeconds,
      duration_minutes: Number((durationSeconds / 60).toFixed(2)),
      polyline: firstRoute.polyline?.encodedPolyline || null,
      raw: firstRoute,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return jsonResponse(
      {
        error: message,
        stage,
        stack: err instanceof Error ? err.stack : null,
      },
      500,
    )
  }
})
