import { supabase } from '../../../lib/supabase'
import { getProfile } from './nominaCore'

// ─── Haversine distance (metros) ──────────────────────────────────────────────
export function haversineMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = x => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

// ─── CRUD Sedes ───────────────────────────────────────────────────────────────

export async function getSedes(soloActivas = true) {
  const profile = await getProfile()
  let q = supabase
    .from('sedes_trabajo')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('nombre')
  if (soloActivas) q = q.eq('activo', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function getSede(id) {
  const { data, error } = await supabase
    .from('sedes_trabajo')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function createSede(payload) {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('sedes_trabajo')
    .insert({
      organization_id: profile.organization_id,
      nombre:          payload.nombre?.trim(),
      descripcion:     payload.descripcion || null,
      direccion:       payload.direccion   || null,
      latitud:         Number(payload.latitud),
      longitud:        Number(payload.longitud),
      radio_metros:    Number(payload.radio_metros || 100),
      activo:          true,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateSede(id, payload) {
  const { error } = await supabase
    .from('sedes_trabajo')
    .update({
      nombre:       payload.nombre?.trim(),
      descripcion:  payload.descripcion || null,
      direccion:    payload.direccion   || null,
      latitud:      Number(payload.latitud),
      longitud:     Number(payload.longitud),
      radio_metros: Number(payload.radio_metros || 100),
      activo:       payload.activo !== false,
      updated_at:   new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteSede(id) {
  const { error } = await supabase
    .from('sedes_trabajo')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Obtener ubicación actual (promesa) ───────────────────────────────────────
export function obtenerUbicacion(opciones = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Tu dispositivo no soporta geolocalización'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitud: pos.coords.latitude, longitud: pos.coords.longitude, precision: pos.coords.accuracy }),
      err => {
        const msgs = {
          1: 'Permiso de ubicación denegado. Habilítalo en la configuración del navegador.',
          2: 'No se pudo obtener la ubicación. Verifica tu conexión o GPS.',
          3: 'Tiempo de espera agotado para obtener la ubicación.',
        }
        reject(new Error(msgs[err.code] || 'Error de geolocalización'))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0, ...opciones }
    )
  })
}

// ─── Validar si una ubicación está dentro de una sede ────────────────────────
export function validarDistancia(latEmp, lonEmp, sede) {
  if (!sede?.latitud || !sede?.longitud) return { valido: false, distancia: null, error: 'Sede sin coordenadas' }
  const distancia = haversineMetros(latEmp, lonEmp, Number(sede.latitud), Number(sede.longitud))
  const valido    = distancia <= (sede.radio_metros || 100)
  return { valido, distancia }
}
