import { supabase } from '../../../lib/supabase'
import { getProfile } from './nominaCore'

function n(v) {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export async function getBiometriaFacialEmpleado(empleadoId) {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('employee_biometrics')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('empleado_id', empleadoId)
    .eq('biometric_type', 'face')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message || 'No se pudo obtener la biometría facial')
  return data || null
}

export async function upsertBiometriaFacialEmpleado({
  empleadoId,
  profileId = null,
  faceEmbedding = null,
  enrollmentPhotoUrl = null,
  embeddingVersion = 'v1',
  metadata = {},
}) {
  const profile = await getProfile()
  const payload = {
    organization_id: profile.organization_id,
    empleado_id: empleadoId,
    profile_id: profileId,
    biometric_type: 'face',
    enrollment_status: 'active',
    face_embedding: faceEmbedding,
    enrollment_photo_url: enrollmentPhotoUrl,
    embedding_version: embeddingVersion,
    metadata,
    verification_score: null,
    last_verified_at: null,
  }

  const existing = await getBiometriaFacialEmpleado(empleadoId)
  if (existing?.id) {
    const { data, error } = await supabase
      .from('employee_biometrics')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw new Error(error.message || 'No se pudo actualizar la biometría facial')
    return data
  }

  const { data, error } = await supabase
    .from('employee_biometrics')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo guardar la biometría facial')
  return data
}

export async function subirFotoBiometriaFacial(blob, empleadoId) {
  const fecha = new Date().toISOString().slice(0, 10)
  const filename = `biometria/${empleadoId}/${fecha}_${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from('marcaciones-fotos')
    .upload(filename, blob, { contentType: 'image/jpeg', upsert: true })

  if (error) {
    throw new Error(`Error subiendo foto biométrica: ${error.message}`)
  }

  const { data } = supabase.storage.from('marcaciones-fotos').getPublicUrl(filename)
  return data.publicUrl
}

export function biometriaFacialCoincide(embeddingA = [], embeddingB = [], threshold = 0.9) {
  if (!Array.isArray(embeddingA) || !Array.isArray(embeddingB) || embeddingA.length === 0 || embeddingA.length !== embeddingB.length) {
    return { match: false, score: 0 }
  }

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < embeddingA.length; i += 1) {
    const a = n(embeddingA[i])
    const b = n(embeddingB[i])
    dot += a * b
    normA += a * a
    normB += b * b
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  const score = denom > 0 ? dot / denom : 0
  return { match: score >= threshold, score }
}
