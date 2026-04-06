import { supabase } from '../../../lib/supabase'
import { getConfiguracion, createInspeccion, getSkusEmpacadosHoy } from './calidadService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { return Number(v || 0) }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)) }
function r3(v) { return Math.round(n(v) * 1000) / 1000 }

async function getOrgId() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return data.organization_id
}

// ─── Selección aleatoria ponderada ────────────────────────────────────────────

function seleccionPonderada(candidatos) {
  const total = candidatos.reduce((s, c) => s + c.probabilidad_final, 0)
  if (total === 0) return candidatos[Math.floor(Math.random() * candidatos.length)]
  let rand = Math.random() * total
  for (const c of candidatos) {
    rand -= c.probabilidad_final
    if (rand <= 0) return c
  }
  return candidatos[candidatos.length - 1]
}

// ─── Ajuste por resultado reciente ────────────────────────────────────────────
//
// Usa el resultado más reciente del SKU para incrementar o reducir su probabilidad.
// Si los últimos 3 resultados fueron todos "liberado", amplifica la reducción.

function calcularAjusteResultado(resultados, config) {
  if (!resultados || resultados.length === 0) return 0
  const ultimo = resultados[0]
  let ajuste = 0
  if (['rechazado', 'retenido'].includes(ultimo)) {
    ajuste = n(config.ajuste_rechazo)
  } else if (ultimo === 'liberado_con_observacion') {
    ajuste = n(config.ajuste_observacion)
  } else if (ultimo === 'liberado') {
    ajuste = -n(config.ajuste_limpio)
    // Triple limpio → reducción más fuerte
    if (resultados.length >= 3 && resultados.slice(0, 3).every(r => r === 'liberado')) {
      ajuste *= 1.5
    }
  }
  return ajuste
}

// ─── Calcular score de riesgo para un SKU ─────────────────────────────────────

export async function calcularScoreSku(skuId, orgId, config) {
  const fechaReclamos   = new Date(Date.now() - n(config.ventana_reclamos)   * 86400000).toISOString().slice(0, 10)
  const fechaResultados = new Date(Date.now() - n(config.ventana_resultados) * 86400000).toISOString().slice(0, 10)

  // Consultas en paralelo — errores aislados, no rompen el motor
  const [reclamosRes, inspeccionesRes] = await Promise.allSettled([
    supabase
      .from('v_reclamos_calidad_sku')
      .select('reclamo_id')
      .eq('organization_id', orgId)
      .eq('product_presentation_id', skuId)
      .gte('fecha', fechaReclamos),
    supabase
      .from('inspecciones_calidad')
      .select('resultado')
      .eq('organization_id', orgId)
      .eq('product_presentation_id', skuId)
      .eq('status', 'completada')
      .gte('fecha', fechaResultados)
      .order('fecha',      { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const reclamos     = reclamosRes.status    === 'fulfilled' ? n(reclamosRes.value.data?.length)    : 0
  const inspecciones = inspeccionesRes.status === 'fulfilled' ? (inspeccionesRes.value.data || [])  : []

  const noConformidades  = inspecciones.filter(i => i.resultado && i.resultado !== 'liberado').length
  const resultados       = inspecciones.map(i => i.resultado).filter(Boolean)
  const ajusteResultado  = calcularAjusteResultado(resultados, config)

  const probabilidadRaw =
    n(config.probabilidad_base)
    + reclamos          * n(config.peso_reclamos)
    + noConformidades   * n(config.peso_no_conformidades)
    + ajusteResultado

  const probabilidadFinal = r3(clamp(probabilidadRaw, n(config.probabilidad_minima), n(config.probabilidad_maxima)))

  return {
    probabilidad_final:     probabilidadFinal,
    score_riesgo:           r3(probabilidadRaw),   // sin clampar, útil para ranking
    reclamos_usados:        reclamos,
    no_conformidades_usadas: noConformidades,
    resultados_usados:      resultados.length,
    ultimo_resultado:       resultados[0] || null,
    ajuste_resultado:       r3(ajusteResultado),
  }
}

// ─── Persistir scores del día ─────────────────────────────────────────────────

async function persistirScores(skusConScore, orgId) {
  if (skusConScore.length === 0) return
  const hoy  = new Date().toISOString().slice(0, 10)
  const rows = skusConScore.map(s => ({
    organization_id:           orgId,
    product_presentation_id:   s.product_presentation_id,
    fecha:                     hoy,
    score_riesgo:              s.score_riesgo,
    probabilidad_final:        s.probabilidad_final,
    reclamos_usados:           s.reclamos_usados,
    no_conformidades_usadas:   s.no_conformidades_usadas,
    resultados_usados:         s.resultados_usados,
    ultimo_resultado:          s.ultimo_resultado,
    ajuste_resultado:          s.ajuste_resultado,
    seleccionado:              s.seleccionado || false,
    updated_at:                new Date().toISOString(),
  }))
  await supabase
    .from('sku_riesgo_calculado')
    .upsert(rows, { onConflict: 'organization_id,product_presentation_id,fecha' })
}

// ─── Motor de selección principal ─────────────────────────────────────────────
//
// Flujo:
// 1. Obtener SKUs empacados hoy
// 2. Calcular probabilidad ponderada por SKU (score de riesgo)
// 3. Garantizar mínimo 1 muestreo (selección ponderada)
// 4. Evaluar muestreos adicionales (cada SKU restante se "sortea" contra su probabilidad)
// 5. Persistir scores del día
// 6. Crear inspecciones pendientes

export async function ejecutarMuestreo() {
  const orgId  = await getOrgId()
  const config = await getConfiguracion()
  const hoy    = new Date().toISOString().slice(0, 10)

  const skusHoy = await getSkusEmpacadosHoy()
  if (skusHoy.length === 0) {
    return { seleccionados: [], candidatos: [], skusEvaluados: 0, mensaje: 'Sin SKUs empacados hoy — no se generaron muestreos.' }
  }

  // Calcular score para cada SKU en paralelo (por lotes de 5 para no saturar)
  const candidatos = []
  for (const sku of skusHoy) {
    const score = await calcularScoreSku(sku.product_presentation_id, orgId, config)
    candidatos.push({ ...sku, ...score, seleccionado: false })
  }
  candidatos.sort((a, b) => b.probabilidad_final - a.probabilidad_final)

  // ¿Ya hay muestreos del motor hoy?
  const { data: yaExisten } = await supabase
    .from('inspecciones_calidad')
    .select('product_presentation_id')
    .eq('organization_id', orgId)
    .eq('fecha', hoy)
    .eq('origen', 'muestreo')
    .neq('status', 'cancelada')

  const yaMuestreados = new Set((yaExisten || []).map(i => i.product_presentation_id))

  const seleccionados = []

  // Mínimo garantizado: 1 muestreo si hay disponibles sin muestrear
  const disponibles = candidatos.filter(c => !yaMuestreados.has(c.product_presentation_id))
  if (disponibles.length > 0) {
    const elegido = seleccionPonderada(disponibles)
    elegido.seleccionado = true
    seleccionados.push(elegido)
    yaMuestreados.add(elegido.product_presentation_id)
  }

  // Muestreos adicionales: cada SKU no muestreado se evalúa contra su probabilidad
  for (const c of candidatos) {
    if (yaMuestreados.has(c.product_presentation_id)) continue
    if (Math.random() < c.probabilidad_final) {
      c.seleccionado = true
      seleccionados.push(c)
      yaMuestreados.add(c.product_presentation_id)
    }
  }

  // Persistir scores
  await persistirScores(candidatos, orgId)

  // Crear inspecciones pendientes
  const inspecciones = []
  for (const sel of seleccionados) {
    const lot = sel.lotes?.find(l => !l.bloqueado_calidad && l.status !== 'agotado') || sel.lotes?.[0] || null
    try {
      const insp = await createInspeccion({
        fecha:                   hoy,
        product_presentation_id: sel.product_presentation_id,
        finished_lot_id:         lot?.id || null,
        origen:                  'muestreo',
        tamano_muestra:          n(config.tamano_muestra_base),
        status:                  'pendiente',
        probabilidad_usada:      sel.probabilidad_final,
        score_riesgo_usado:      sel.score_riesgo,
      })
      inspecciones.push(insp)
    } catch { /* continuar con los demás */ }
  }

  return {
    seleccionados:  inspecciones,
    candidatos,
    skusEvaluados:  candidatos.length,
    mensaje: inspecciones.length > 0
      ? `${inspecciones.length} SKU(s) seleccionado(s) para inspección`
      : 'Todos los SKUs ya fueron muestreados hoy — sin selecciones adicionales.',
  }
}

// ─── Muestreo manual adicional ────────────────────────────────────────────────

export async function agregarMuestreoManual(skuId, lotId = null) {
  const orgId  = await getOrgId()
  const config = await getConfiguracion()
  const hoy    = new Date().toISOString().slice(0, 10)
  const score  = await calcularScoreSku(skuId, orgId, config)

  return createInspeccion({
    fecha:                   hoy,
    product_presentation_id: skuId,
    finished_lot_id:         lotId,
    origen:                  'manual',
    tamano_muestra:          n(config.tamano_muestra_base),
    status:                  'pendiente',
    probabilidad_usada:      score.probabilidad_final,
    score_riesgo_usado:      score.score_riesgo,
  })
}

// ─── Ranking de riesgo (con fallback si no hay scores del día) ────────────────

export async function getRankingRiesgo() {
  const orgId  = await getOrgId()
  const config = await getConfiguracion()
  const hoy    = new Date().toISOString().slice(0, 10)

  const { data: existing } = await supabase
    .from('sku_riesgo_calculado')
    .select('id')
    .eq('organization_id', orgId)
    .eq('fecha', hoy)
    .limit(1)

  if (existing && existing.length > 0) {
    const { data } = await supabase
      .from('sku_riesgo_calculado')
      .select('*, product_presentations(id, code, display_name)')
      .eq('organization_id', orgId)
      .eq('fecha', hoy)
      .order('probabilidad_final', { ascending: false })
    return data || []
  }

  // Fallback: calcular en tiempo real para SKUs activos (últimos 30 días empacados)
  const hace30d = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const { data: recentRuns } = await supabase
    .from('packaging_runs')
    .select('product_presentation_id, product_presentations(id, code, display_name)')
    .eq('organization_id', orgId)
    .gte('run_date', hace30d)
    .eq('status', 'completado')

  const uniqueSkus = []
  const seen = new Set()
  for (const r of (recentRuns || [])) {
    if (!seen.has(r.product_presentation_id)) {
      seen.add(r.product_presentation_id)
      uniqueSkus.push({ product_presentation_id: r.product_presentation_id, sku: r.product_presentations })
    }
  }

  const ranking = []
  for (const s of uniqueSkus) {
    const score = await calcularScoreSku(s.product_presentation_id, orgId, config)
    ranking.push({ product_presentation_id: s.product_presentation_id, product_presentations: s.sku, ...score })
  }
  return ranking.sort((a, b) => b.probabilidad_final - a.probabilidad_final)
}
