import { supabase } from '../../../lib/supabase'
import { getProfile } from './nominaCore'
import { getCostoLaboralDiaEnVivo } from './marcacionesService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function r4(v) { return Math.round(n(v) * 10000) / 10000 }
function r2(v) { return Math.round(n(v) * 100) / 100 }

function construirFilaKpi(fecha, prod, labor) {
  const libras = n(prod.libras_producidas)
  const costo = n(labor.costo_laboral_total)
  const kpiVal = (libras > 0 && costo > 0) ? r4(costo / libras) : null

  let inconsistencia = null
  if (libras > 0 && labor.total_colaboradores === 0) {
    inconsistencia = 'Produccion registrada sin marcaciones de empleados'
  } else if (labor.total_colaboradores > 0 && libras === 0) {
    inconsistencia = 'Marcaciones registradas sin produccion empacada'
  } else if (labor.sin_salida > 0) {
    inconsistencia = `${labor.sin_salida} empleado(s) sin salida registrada`
  }

  return {
    fecha,
    costo_laboral_total_dia: r2(costo),
    libras_producidas_dia: libras,
    costo_mano_obra_por_libra: kpiVal,
    total_colaboradores_marcados: labor.total_colaboradores,
    total_horas_trabajadas: r2(labor.total_horas_trabajadas),
    total_horas_extra_preliminares: r2(labor.total_horas_extra),
    observacion_inconsistencia: inconsistencia,
    runs_produccion: n(prod.total_runs),
  }
}

// ─── Producción diaria desde packaging_runs ──────────────────────────────────

export async function getProduccionDia(fecha, orgId) {
  const { data, error } = await supabase
    .from('v_produccion_diaria')
    .select('libras_producidas, unidades_producidas, total_runs')
    .eq('organization_id', orgId)
    .eq('fecha', fecha)
    .single()
  if (error && error.code !== 'PGRST116') throw new Error(error.message)
  return {
    libras_producidas: n(data?.libras_producidas),
    unidades_producidas: n(data?.unidades_producidas),
    total_runs: n(data?.total_runs),
  }
}

// ─── Costo laboral del día desde marcaciones ──────────────────────────────────

export async function getCostoLaboralDia(fecha, orgId) {
  const hoy = new Date().toISOString().slice(0, 10)
  if (fecha === hoy) {
    return getCostoLaboralDiaEnVivo(fecha, orgId)
  }

  const { data, error } = await supabase
    .from('v_costo_laboral_diario')
    .select('*')
    .eq('organization_id', orgId)
    .eq('fecha', fecha)
    .single()
  if (error && error.code !== 'PGRST116') throw new Error(error.message)
  return {
    costo_laboral_total: n(data?.costo_laboral_total),
    total_horas_trabajadas: n(data?.total_horas_trabajadas),
    total_horas_extra: n(data?.total_horas_extra),
    total_colaboradores: n(data?.total_colaboradores),
    sin_salida: n(data?.sin_salida),
  }
}

// ─── Calcular y persistir KPI de un día ──────────────────────────────────────
/**
 * Recalcula el KPI para una fecha y lo guarda en kpi_costo_laboral_diario.
 * Se llama automáticamente al registrar salida de cualquier empleado.
 * También se puede invocar manualmente para recalcular.
 */
export async function calcularYPersistirKpi(fecha, orgId) {
  const [prod, labor] = await Promise.all([
    getProduccionDia(fecha, orgId),
    getCostoLaboralDia(fecha, orgId),
  ])

  const payload = {
    organization_id: orgId,
    ...construirFilaKpi(fecha, prod, labor),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('kpi_costo_laboral_diario')
    .upsert(payload, { onConflict: 'organization_id,fecha' })
  if (error) console.error('Error persistiendo KPI:', error.message)

  return payload
}

// ─── KPI de hoy ──────────────────────────────────────────────────────────────

export async function getKpiHoy() {
  const profile = await getProfile()
  const hoy     = new Date().toISOString().slice(0, 10)
  return calcularYPersistirKpi(hoy, profile.organization_id)
}

// ─── KPI persistido por fecha ─────────────────────────────────────────────────

export async function getKpiDia(fecha) {
  const profile = await getProfile()
  const { data } = await supabase
    .from('kpi_costo_laboral_diario')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('fecha', fecha)
    .single()
  return data || null
}

// ─── Tendencia: últimos N días ────────────────────────────────────────────────

export async function getKpiTendencia(dias = 14) {
  const profile   = await getProfile()
  const fechaDesde = new Date(Date.now() - (dias - 1) * 86400000).toISOString().slice(0, 10)
  const hoy = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('kpi_costo_laboral_diario')
    .select('fecha, costo_laboral_total_dia, libras_producidas_dia, costo_mano_obra_por_libra, total_colaboradores_marcados, total_horas_trabajadas, total_horas_extra_preliminares, observacion_inconsistencia, runs_produccion')
    .eq('organization_id', profile.organization_id)
    .gte('fecha', fechaDesde)
    .order('fecha', { ascending: true })
  if (error) throw new Error(error.message)

  // Rellenar días vacíos
  const mapa = {}
  for (const d of (data || [])) mapa[d.fecha] = d

  const resultado = []
  for (let i = dias - 1; i >= 0; i--) {
    const f = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    resultado.push(mapa[f] || {
      fecha: f,
      costo_laboral_total_dia:       0,
      libras_producidas_dia:         0,
      costo_mano_obra_por_libra:     null,
      total_colaboradores_marcados:  0,
      total_horas_trabajadas:        0,
      total_horas_extra_preliminares: 0,
      observacion_inconsistencia:    null,
      runs_produccion:               0,
    })
  }

  if (fechaDesde <= hoy) {
    const [prodHoy, laborHoy] = await Promise.all([
      getProduccionDia(hoy, profile.organization_id),
      getCostoLaboralDia(hoy, profile.organization_id),
    ])
    const filaHoy = construirFilaKpi(hoy, prodHoy, laborHoy)
    const idxHoy = resultado.findIndex(d => d.fecha === hoy)
    if (idxHoy >= 0) resultado[idxHoy] = filaHoy
  }

  return resultado
}

// ─── Resumen estadístico de un rango ─────────────────────────────────────────

export async function getKpiResumen(dias = 30) {
  const tendencia = await getKpiTendencia(dias)
  const conDatos  = tendencia.filter(d => n(d.costo_mano_obra_por_libra) > 0)

  if (conDatos.length === 0) return {
    promedio7d: null, promedio30d: null, max: null, min: null,
    tendencia, diasSinProduccion: 0, diasSinMarcacion: 0,
  }

  const kpis = conDatos.map(d => n(d.costo_mano_obra_por_libra))
  const suma  = kpis.reduce((a, v) => a + v, 0)
  const prom  = r4(suma / kpis.length)

  const ultimos7 = conDatos.slice(-7)
  const prom7 = ultimos7.length > 0
    ? r4(ultimos7.reduce((a, d) => a + n(d.costo_mano_obra_por_libra), 0) / ultimos7.length)
    : null

  return {
    promedio7d:         prom7,
    promedio30d:        prom,
    max:                Math.max(...kpis),
    min:                Math.min(...kpis),
    tendencia,
    diasSinProduccion:  tendencia.filter(d => n(d.costo_laboral_total_dia) > 0 && n(d.libras_producidas_dia) === 0).length,
    diasSinMarcacion:   tendencia.filter(d => n(d.libras_producidas_dia) > 0 && n(d.total_colaboradores_marcados) === 0).length,
    diasConInconsistencia: tendencia.filter(d => d.observacion_inconsistencia).length,
  }
}

// ─── Alertas operativas ───────────────────────────────────────────────────────

export async function getAlertas() {
  const profile = await getProfile()
  const hoy     = new Date().toISOString().slice(0, 10)
  const ayer    = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const alertas = []

  // Marcaciones sin salida hoy
  const { data: sinSalida } = await supabase
    .from('marcaciones')
    .select('id, empleado_id, empleados(nombres, apellidos)')
    .eq('organization_id', profile.organization_id)
    .eq('fecha', hoy)
    .is('hora_salida', null)
    .not('hora_entrada', 'is', null)

  if (sinSalida?.length > 0) {
    alertas.push({
      tipo: 'sin_salida',
      nivel: 'warning',
      mensaje: `${sinSalida.length} empleado(s) sin salida registrada hoy`,
      detalle: sinSalida.map(m => `${m.empleados?.nombres} ${m.empleados?.apellidos}`).join(', '),
    })
  }

  // Producción ayer sin marcaciones
  const [prodAyer, laborAyer] = await Promise.all([
    getProduccionDia(ayer, profile.organization_id),
    getCostoLaboralDia(ayer, profile.organization_id),
  ])
  if (n(prodAyer.libras_producidas) > 0 && laborAyer.total_colaboradores === 0) {
    alertas.push({
      tipo: 'produccion_sin_marcacion',
      nivel: 'error',
      mensaje: `Ayer hubo producción (${r2(prodAyer.libras_producidas)} lb) sin marcaciones registradas`,
    })
  }
  if (laborAyer.total_colaboradores > 0 && n(prodAyer.libras_producidas) === 0) {
    alertas.push({
      tipo: 'marcacion_sin_produccion',
      nivel: 'info',
      mensaje: `Ayer hubo ${laborAyer.total_colaboradores} marcaciones pero sin producción empacada registrada`,
    })
  }

  return alertas
}

// ─── Datos rápidos para dashboard (sin recalcular) ────────────────────────────

export async function getKpiDashboard() {
  const profile  = await getProfile()
  const orgId    = profile.organization_id
  const hoy      = new Date().toISOString().slice(0, 10)
  const hace7d   = new Date(Date.now() -  6 * 86400000).toISOString().slice(0, 10)
  const hace30d  = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)

  const [kpiHoy, kpi7d, kpi30d, alertas] = await Promise.allSettled([
    // KPI de hoy (recalcula en tiempo real)
    calcularYPersistirKpi(hoy, orgId),
    // Promedio últimos 7 días
    supabase
      .from('kpi_costo_laboral_diario')
      .select('costo_mano_obra_por_libra')
      .eq('organization_id', orgId)
      .gte('fecha', hace7d)
      .lt('fecha', hoy)
      .not('costo_mano_obra_por_libra', 'is', null),
    // Promedio últimos 30 días
    supabase
      .from('kpi_costo_laboral_diario')
      .select('costo_mano_obra_por_libra')
      .eq('organization_id', orgId)
      .gte('fecha', hace30d)
      .lt('fecha', hoy)
      .not('costo_mano_obra_por_libra', 'is', null),
    getAlertas(),
  ])

  const hoyData  = kpiHoy.status === 'fulfilled' ? kpiHoy.value : null
  const data7d   = kpi7d.status  === 'fulfilled' ? kpi7d.value.data  || [] : []
  const data30d  = kpi30d.status === 'fulfilled' ? kpi30d.value.data || [] : []
  const alertList= alertas.status === 'fulfilled' ? alertas.value : []

  const prom7d  = data7d.length  > 0 ? r4(data7d.reduce((a, d) => a + n(d.costo_mano_obra_por_libra), 0) / data7d.length)  : null
  const prom30d = data30d.length > 0 ? r4(data30d.reduce((a, d) => a + n(d.costo_mano_obra_por_libra), 0) / data30d.length) : null

  // Tendencia vs promedio
  const kpiHoyVal = n(hoyData?.costo_mano_obra_por_libra)
  const tendencia = prom7d && kpiHoyVal
    ? kpiHoyVal < prom7d * 0.97 ? 'bajo' : kpiHoyVal > prom7d * 1.03 ? 'alto' : 'normal'
    : 'sin_datos'

  return {
    hoy: hoyData,
    prom7d,
    prom30d,
    tendencia,       // 'bajo' | 'alto' | 'normal' | 'sin_datos'
    alertas: alertList,
  }
}

// ─── Recalcular KPI de un rango (para ajuste quincenal) ──────────────────────

export async function recalcularKpiRango(fechaInicio, fechaFin) {
  const profile = await getProfile()
  const orgId   = profile.organization_id
  const start   = new Date(fechaInicio)
  const end     = new Date(fechaFin)
  const resultados = []

  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const f = cur.toISOString().slice(0, 10)
    try {
      const kpi = await calcularYPersistirKpi(f, orgId)
      resultados.push({ fecha: f, ok: true, kpi: kpi.costo_mano_obra_por_libra })
    } catch (e) {
      resultados.push({ fecha: f, ok: false, error: e.message })
    }
  }
  return resultados
}
