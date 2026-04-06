import { supabase } from '../../../lib/supabase'
import { getProfile } from './nominaCore'

// Import lazy para evitar dependencia circular — se llama sólo tras registrar salida
async function dispararKpi(fecha, orgId) {
  try {
    const { calcularYPersistirKpi } = await import('./costoLaboralService.js')
    await calcularYPersistirKpi(fecha, orgId)
  } catch { /* silencioso — no debe romper la marcación */ }
}

// ─── Subir foto de marcación a Supabase Storage ───────────────────────────────
export async function subirFotoMarcacion(blob, empleadoId, tipo) {
  const fecha    = new Date().toISOString().slice(0, 10)
  const filename = `${empleadoId}/${fecha}_${tipo}_${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from('marcaciones-fotos')
    .upload(filename, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`Error subiendo foto: ${error.message}`)
  const { data } = supabase.storage.from('marcaciones-fotos').getPublicUrl(filename)
  return data.publicUrl
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Día de la semana (0=Dom, 1=Lun…6=Sáb) de una cadena 'YYYY-MM-DD' sin TZ. */
function dowFromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Horas entre dos strings 'HH:MM' o 'HH:MM:SS'. Devuelve null si alguno falta. */
export function calcularHorasDia(horaEntrada, horaSalida) {
  if (!horaEntrada || !horaSalida) return null
  const [hE, mE] = horaEntrada.split(':').map(Number)
  const [hS, mS] = horaSalida.split(':').map(Number)
  const mins = (hS * 60 + mS) - (hE * 60 + mE)
  return mins > 0 ? Math.round(mins * 100) / 6000 : 0   // → horas con 2 dec
}

/** Horas teóricas para un día según jornada. */
export function horasTeóricasDia(iso, jornada) {
  const dow = dowFromIso(iso)
  if (dow >= 1 && dow <= 5) return jornada.lunes_viernes_horas ?? 9
  if (dow === 6) return jornada.sabado_horas ?? 4
  return jornada.domingo_laboral ? (jornada.domingo_horas ?? 0) : 0
}

/** Días y horas teóricas de un rango de fechas según jornada. */
export function calcularHorasTeoricas(fechaInicio, fechaFin, jornada) {
  const j = jornada || { lunes_viernes_horas: 9, sabado_horas: 4, domingo_laboral: false, domingo_horas: 0 }
  let diasNormales = 0, sabados = 0, domingos = 0, horasTeoricas = 0
  const [y0, m0, d0] = fechaInicio.split('-').map(Number)
  const [y1, m1, d1] = fechaFin.split('-').map(Number)
  const start = new Date(y0, m0 - 1, d0)
  const end   = new Date(y1, m1 - 1, d1)
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const dow = cur.getDay()
    if (dow >= 1 && dow <= 5) { diasNormales++; horasTeoricas += j.lunes_viernes_horas }
    else if (dow === 6)        { sabados++;      horasTeoricas += j.sabado_horas }
    else if (j.domingo_laboral){ domingos++;     horasTeoricas += j.domingo_horas }
  }
  return { diasNormales, sabados, domingos, horasTeoricas }
}

// ─── Jornada ──────────────────────────────────────────────────────────────────

const JORNADA_DEFAULT = {
  nombre: 'Jornada Estándar',
  lunes_viernes_horas: 9,
  sabado_horas: 4,
  domingo_laboral: false,
  domingo_horas: 0,
  hora_inicio_lv: '08:00',
  hora_fin_lv:    '17:00',
  hora_inicio_sab:'08:00',
  hora_fin_sab:   '12:00',
}

export async function getJornada() {
  const profile = await getProfile()
  const { data } = await supabase
    .from('configuracion_jornada')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('activo', true)
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0] || { ...JORNADA_DEFAULT, organization_id: profile.organization_id }
}

export async function saveJornada(payload) {
  const profile = await getProfile()
  // Desactivar jornada anterior
  await supabase.from('configuracion_jornada')
    .update({ activo: false })
    .eq('organization_id', profile.organization_id)
    .eq('activo', true)

  const { data, error } = await supabase.from('configuracion_jornada').insert({
    organization_id:     profile.organization_id,
    nombre:              payload.nombre || 'Jornada Estándar',
    lunes_viernes_horas: Number(payload.lunes_viernes_horas),
    sabado_horas:        Number(payload.sabado_horas),
    domingo_laboral:     payload.domingo_laboral || false,
    domingo_horas:       Number(payload.domingo_horas || 0),
    hora_inicio_lv:      payload.hora_inicio_lv || '08:00',
    hora_fin_lv:         payload.hora_fin_lv    || '17:00',
    hora_inicio_sab:     payload.hora_inicio_sab || '08:00',
    hora_fin_sab:        payload.hora_fin_sab    || '12:00',
    activo: true,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Marcaciones ──────────────────────────────────────────────────────────────

export async function getMarcaciones({ fechaInicio, fechaFin, empleadoId } = {}) {
  const profile = await getProfile()
  let q = supabase
    .from('marcaciones')
    .select(`*, empleados(id, nombres, apellidos, codigo_empleado, puesto)`)
    .eq('organization_id', profile.organization_id)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
  if (fechaInicio) q = q.gte('fecha', fechaInicio)
  if (fechaFin)    q = q.lte('fecha', fechaFin)
  if (empleadoId)  q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function getMarcacionHoy(empleadoId) {
  const hoy = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('marcaciones')
    .select('*')
    .eq('empleado_id', empleadoId)
    .eq('fecha', hoy)
    .single()
  return data || null
}

/**
 * Registra la entrada de un empleado para hoy.
 * Si ya existe una marcación incompleta, la devuelve sin modificar.
 */
export async function registrarEntrada(empleadoId) {
  const profile = await getProfile()
  const jornada = await getJornada()
  const hoy  = new Date().toISOString().slice(0, 10)
  const hora  = new Date().toTimeString().slice(0, 8) // HH:MM:SS
  const hTeorica = horasTeóricasDia(hoy, jornada)

  // Verificar si ya existe
  const { data: existing } = await supabase
    .from('marcaciones')
    .select('*')
    .eq('empleado_id', empleadoId)
    .eq('fecha', hoy)
    .single()

  if (existing) {
    if (existing.hora_entrada) throw new Error('Ya existe una entrada registrada para hoy')
    return existing
  }

  const { data, error } = await supabase.from('marcaciones').insert({
    organization_id:             profile.organization_id,
    empleado_id:                 empleadoId,
    fecha:                       hoy,
    hora_entrada:                hora,
    horas_normales_teoricas_dia: hTeorica,
    estado:                      'incompleta',
    registrado_por:              profile.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Registra la salida, calcula horas trabajadas y exceso del día.
 */
export async function registrarSalida(empleadoId, salarioMensual, horasTeóricasQuincena) {
  const jornada = await getJornada()
  const hoy   = new Date().toISOString().slice(0, 10)
  const hora  = new Date().toTimeString().slice(0, 8)

  const { data: marc } = await supabase
    .from('marcaciones')
    .select('*')
    .eq('empleado_id', empleadoId)
    .eq('fecha', hoy)
    .single()

  if (!marc) throw new Error('No hay entrada registrada para hoy')
  if (marc.hora_salida) throw new Error('La salida ya fue registrada')

  const horasTrabajadas = calcularHorasDia(marc.hora_entrada, hora)
  if (horasTrabajadas === null || horasTrabajadas < 0)
    throw new Error('La hora de salida es anterior a la entrada')

  const hTeorica = horasTeóricasDia(hoy, jornada)
  const exceso   = Math.max(0, horasTrabajadas - hTeorica)
  const estado   = horasTrabajadas < hTeorica * 0.5 ? 'pendiente_revision' : 'completa'

  // Costo preliminar — intentar obtener salario del empleado si no se pasa explícito
  let costoDia = null, costoExtra = null, costoHoraBase = null, costoTotal = null
  const salBase = salarioMensual || marc.salario_base_actual
  const htQ     = horasTeóricasQuincena || null

  if (salBase && htQ) {
    costoHoraBase = (salBase / 2) / htQ
    const normales = Math.min(horasTrabajadas, hTeorica)
    costoDia   = Math.round(normales * costoHoraBase * 100) / 100
    costoExtra = Math.round(exceso   * costoHoraBase * 1.5 * 100) / 100
    costoTotal = Math.round((costoDia + costoExtra) * 100) / 100
  }

  const profile = await getProfile()
  const { data, error } = await supabase.from('marcaciones').update({
    hora_salida:                  hora,
    horas_trabajadas:             horasTrabajadas,
    exceso_dia:                   exceso,
    costo_hora_base:              costoHoraBase,
    costo_dia_preliminar:         costoDia,
    costo_extra_preliminar:       costoExtra,
    costo_total_preliminar_dia:   costoTotal,
    estado,
    updated_at: new Date().toISOString(),
  }).eq('id', marc.id).select().single()
  if (error) throw new Error(error.message)

  // Recalcular KPI del día en background
  dispararKpi(hoy, profile.organization_id)

  return data
}

/**
 * Upsert manual de una marcación (para correcciones).
 */
export async function upsertMarcacion(payload) {
  const profile = await getProfile()
  const jornada = await getJornada()

  const hTeorica     = horasTeóricasDia(payload.fecha, jornada)
  const horasTrab    = calcularHorasDia(payload.hora_entrada, payload.hora_salida)
  const exceso       = horasTrab !== null ? Math.max(0, horasTrab - hTeorica) : 0
  const estado       = !payload.hora_salida ? 'incompleta'
    : horasTrab < hTeorica * 0.5 ? 'pendiente_revision' : 'completa'

  const { data, error } = await supabase.from('marcaciones').upsert({
    organization_id:             profile.organization_id,
    empleado_id:                 payload.empleado_id,
    fecha:                       payload.fecha,
    hora_entrada:                payload.hora_entrada || null,
    hora_salida:                 payload.hora_salida  || null,
    horas_trabajadas:            horasTrab,
    horas_normales_teoricas_dia: hTeorica,
    exceso_dia:                  exceso,
    estado:                      payload.estado || estado,
    observaciones:               payload.observaciones || null,
    registrado_por:              profile.id,
    updated_at:                  new Date().toISOString(),
  }, { onConflict: 'empleado_id,fecha' }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function aprobarMarcacion(id) {
  const { error } = await supabase.from('marcaciones')
    .update({ estado: 'aprobada', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteMarcacion(id) {
  const { error } = await supabase.from('marcaciones').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Resumen de asistencia por empleado en un rango ──────────────────────────

export async function getResumenAsistencia(fechaInicio, fechaFin) {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('marcaciones')
    .select(`
      empleado_id, horas_trabajadas, exceso_dia, estado, fecha,
      empleados(id, nombres, apellidos, codigo_empleado, puesto, salario_base_actual)
    `)
    .eq('organization_id', profile.organization_id)
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin)
  if (error) throw new Error(error.message)

  // Agrupar por empleado
  const mapa = {}
  for (const m of (data || [])) {
    const eid = m.empleado_id
    if (!mapa[eid]) {
      mapa[eid] = {
        empleado: m.empleados,
        diasRegistrados: 0,
        horasTrabajadas: 0,
        horasExtra:       0,
        diasIncompletos:  0,
        diasPendientes:   0,
      }
    }
    mapa[eid].diasRegistrados++
    mapa[eid].horasTrabajadas += Number(m.horas_trabajadas || 0)
    mapa[eid].horasExtra      += Number(m.exceso_dia || 0)
    if (m.estado === 'incompleta')         mapa[eid].diasIncompletos++
    if (m.estado === 'pendiente_revision') mapa[eid].diasPendientes++
  }
  return Object.values(mapa)
}

// ─── Marcación completa con foto + geo (operarios kiosk) ─────────────────────

/**
 * tipo: 'entrada' | 'salida'
 * extras: { sede_id, foto_url, latitud, longitud, distancia, validacion_geo }
 */
export async function registrarMarcacionConFoto(empleadoId, tipo, extras = {}) {
  const profile  = await getProfile()
  const jornada  = await getJornada()
  const hoy      = new Date().toISOString().slice(0, 10)
  const hora     = new Date().toTimeString().slice(0, 8)
  const hTeorica = horasTeóricasDia(hoy, jornada)

  if (tipo === 'entrada') {
    const { data: existing } = await supabase
      .from('marcaciones').select('id, hora_entrada').eq('empleado_id', empleadoId).eq('fecha', hoy).single()
    if (existing?.hora_entrada)
      throw new Error('Ya existe una entrada registrada para hoy')

    const payload = {
      organization_id:             profile.organization_id,
      empleado_id:                 empleadoId,
      fecha:                       hoy,
      hora_entrada:                hora,
      horas_normales_teoricas_dia: hTeorica,
      estado:                      'incompleta',
      registrado_por:              profile.id,
      sede_id:                     extras.sede_id              || null,
      foto_entrada_url:            extras.foto_url             || null,
      latitud_entrada:             extras.latitud              || null,
      longitud_entrada:            extras.longitud             || null,
      distancia_entrada:           extras.distancia            ?? null,
      validacion_geo_entrada:      extras.validacion_geo       ?? false,
    }

    const { data, error } = await supabase.from('marcaciones')
      .upsert(payload, { onConflict: 'empleado_id,fecha' })
      .select().single()
    if (error) throw new Error(error.message)
    return data
  }

  // ── salida ──
  const { data: marc } = await supabase
    .from('marcaciones').select('*').eq('empleado_id', empleadoId).eq('fecha', hoy).single()
  if (!marc)           throw new Error('No hay entrada registrada para hoy')
  if (marc.hora_salida) throw new Error('La salida ya fue registrada')

  const horasTrabajadas = calcularHorasDia(marc.hora_entrada, hora)
  if (horasTrabajadas === null || horasTrabajadas < 0)
    throw new Error('Hora de salida inválida')

  const exceso = Math.max(0, horasTrabajadas - hTeorica)
  const estado = horasTrabajadas < hTeorica * 0.5 ? 'pendiente_revision' : 'completa'

  // Calcular costo — obtener salario del empleado
  let costoHoraBase = null, costoDia = null, costoExtra = null, costoTotal = null
  if (extras.salario_mensual && extras.horas_teoricas_quincena) {
    costoHoraBase = (extras.salario_mensual / 2) / extras.horas_teoricas_quincena
    const normales = Math.min(horasTrabajadas, hTeorica)
    costoDia   = Math.round(normales * costoHoraBase * 100) / 100
    costoExtra = Math.round(exceso   * costoHoraBase * 1.5 * 100) / 100
    costoTotal = Math.round((costoDia + costoExtra) * 100) / 100
  }

  const { data, error } = await supabase.from('marcaciones').update({
    hora_salida:                  hora,
    horas_trabajadas:             horasTrabajadas,
    exceso_dia:                   exceso,
    estado,
    costo_hora_base:              costoHoraBase,
    costo_dia_preliminar:         costoDia,
    costo_extra_preliminar:       costoExtra,
    costo_total_preliminar_dia:   costoTotal,
    foto_salida_url:       extras.foto_url        || null,
    latitud_salida:        extras.latitud         || null,
    longitud_salida:       extras.longitud        || null,
    distancia_salida:      extras.distancia       ?? null,
    validacion_geo_salida: extras.validacion_geo  ?? false,
    updated_at:            new Date().toISOString(),
  }).eq('id', marc.id).select().single()
  if (error) throw new Error(error.message)

  // Recalcular KPI del día en background
  dispararKpi(hoy, profile.organization_id)

  return data
}
