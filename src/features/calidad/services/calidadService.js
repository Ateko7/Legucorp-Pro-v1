import { supabase } from '../../../lib/supabase'

function n(v) { return Number(v || 0) }

async function getAuth() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('profiles')
    .select('organization_id, id')
    .eq('id', user.id)
    .single()
  return { orgId: data.organization_id, userId: data.id }
}

// ─── Configuración ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  probabilidad_base:       0.400,
  peso_reclamos:           0.100,
  peso_no_conformidades:   0.050,
  ajuste_rechazo:          0.300,
  ajuste_observacion:      0.150,
  ajuste_limpio:           0.100,
  probabilidad_maxima:     0.900,
  probabilidad_minima:     0.100,
  ventana_resultados:      15,
  ventana_reclamos:        30,
  tamano_muestra_base:     5,
  umbral_vigilancia:       0.700,
}

export async function getConfiguracion() {
  const { orgId } = await getAuth()
  const { data } = await supabase
    .from('configuracion_muestreo')
    .select('*')
    .eq('organization_id', orgId)
    .single()
  return data || { ...DEFAULT_CONFIG, organization_id: orgId }
}

export async function saveConfiguracion(payload) {
  const { orgId } = await getAuth()
  const { id: _id, created_at: _created_at, ...campos } = payload
  const { data, error } = await supabase
    .from('configuracion_muestreo')
    .upsert(
      { ...campos, organization_id: orgId, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' }
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Inspecciones ─────────────────────────────────────────────────────────────

export async function getInspecciones(filtros = {}) {
  const { orgId } = await getAuth()
  let q = supabase
    .from('inspecciones_calidad')
    .select(`
      *,
      product_presentations(id, code, display_name),
      finished_inventory_lots(id, finished_lot_code, production_date, status, bloqueado_calidad),
      defectos_inspeccion(id, tipo_defecto, cantidad, nivel)
    `)
    .eq('organization_id', orgId)
    .order('fecha',      { ascending: false })
    .order('created_at', { ascending: false })

  if (filtros.fecha)    q = q.eq('fecha',    filtros.fecha)
  if (filtros.status)   q = q.eq('status',   filtros.status)
  if (filtros.resultado) q = q.eq('resultado', filtros.resultado)
  if (filtros.desde)    q = q.gte('fecha',   filtros.desde)
  if (filtros.hasta)    q = q.lte('fecha',   filtros.hasta)
  if (filtros.limit)    q = q.limit(filtros.limit)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function createInspeccion(payload) {
  const { orgId, userId } = await getAuth()
  const { data, error } = await supabase
    .from('inspecciones_calidad')
    .insert({ ...payload, organization_id: orgId, created_by: userId })
    .select(`
      *,
      product_presentations(id, code, display_name),
      finished_inventory_lots(id, finished_lot_code)
    `)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function completarInspeccion(id, resultado) {
  const { userId } = await getAuth()
  const { defectos = [], ...campos } = resultado
  const tasa = n(campos.unidades_inspeccionadas) > 0
    ? Math.round((n(campos.unidades_defectuosas) / n(campos.unidades_inspeccionadas)) * 10000) / 100
    : 0

  const { data, error } = await supabase
    .from('inspecciones_calidad')
    .update({
      ...campos,
      unidades_inspeccionadas: n(campos.unidades_inspeccionadas),
      unidades_defectuosas:    n(campos.unidades_defectuosas),
      tasa_defectos:           tasa,
      status:                  'completada',
      inspeccionado_por:       userId,
      updated_at:              new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)

  if (defectos.length > 0) {
    await supabase
      .from('defectos_inspeccion')
      .insert(defectos.map(d => ({ ...d, inspeccion_id: id })))
  }

  if (['rechazado', 'retenido'].includes(campos.resultado) && data.finished_lot_id) {
    await supabase
      .from('finished_inventory_lots')
      .update({
        bloqueado_calidad:      true,
        motivo_bloqueo_calidad: `Inspección ${campos.resultado}: ${campos.observaciones || ''}`.trim(),
      })
      .eq('id', data.finished_lot_id)
    await supabase
      .from('inspecciones_calidad')
      .update({ lote_bloqueado: true })
      .eq('id', id)
  }

  return data
}

export async function liberarLote(inspeccionId, lotId) {
  const [r1, r2] = await Promise.all([
    supabase
      .from('finished_inventory_lots')
      .update({ bloqueado_calidad: false, motivo_bloqueo_calidad: null })
      .eq('id', lotId),
    supabase
      .from('inspecciones_calidad')
      .update({ lote_bloqueado: false, updated_at: new Date().toISOString() })
      .eq('id', inspeccionId),
  ])
  if (r1.error) throw new Error(r1.error.message)
  if (r2.error) throw new Error(r2.error.message)
}

export async function cancelarInspeccion(id) {
  const { error } = await supabase
    .from('inspecciones_calidad')
    .update({ status: 'cancelada', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── SKUs empacados hoy ────────────────────────────────────────────────────────

export async function getSkusEmpacadosHoy() {
  const { orgId } = await getAuth()
  const hoy = new Date().toISOString().slice(0, 10)

  const [runsRes, lotsRes] = await Promise.all([
    supabase
      .from('packaging_runs')
      .select('id, product_presentation_id, packed_weight_lb, product_presentations(id, code, display_name)')
      .eq('organization_id', orgId)
      .eq('run_date', hoy)
      .eq('status', 'completado')
      .gt('packed_weight_lb', 0),
    supabase
      .from('finished_inventory_lots')
      .select('id, finished_lot_code, product_presentation_id, bloqueado_calidad, status')
      .eq('organization_id', orgId)
      .eq('production_date', hoy),
  ])

  const runs  = runsRes.data  || []
  const lots  = lotsRes.data  || []

  const lotsBySkuId = {}
  for (const l of lots) {
    if (!lotsBySkuId[l.product_presentation_id]) lotsBySkuId[l.product_presentation_id] = []
    lotsBySkuId[l.product_presentation_id].push(l)
  }

  const bySkuId = {}
  for (const r of runs) {
    const skuId = r.product_presentation_id
    if (!bySkuId[skuId]) {
      bySkuId[skuId] = {
        product_presentation_id: skuId,
        sku:         r.product_presentations,
        libras_total: 0,
        lotes:       lotsBySkuId[skuId] || [],
      }
    }
    bySkuId[skuId].libras_total += n(r.packed_weight_lb)
  }

  return Object.values(bySkuId)
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardCalidad() {
  const { orgId } = await getAuth()
  const hoy     = new Date().toISOString().slice(0, 10)
  const hace30d = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const [inspecHoyRes, hist30Res, riesgoRes, bloqRes] = await Promise.allSettled([
    supabase
      .from('inspecciones_calidad')
      .select('id, status, resultado, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .eq('fecha', hoy),
    supabase
      .from('inspecciones_calidad')
      .select('id, fecha, resultado, tasa_defectos, observaciones, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .eq('status', 'completada')
      .gte('fecha', hace30d)
      .order('fecha', { ascending: false }),
    supabase
      .from('sku_riesgo_calculado')
      .select('*, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .eq('fecha', hoy)
      .order('probabilidad_final', { ascending: false })
      .limit(15),
    supabase
      .from('finished_inventory_lots')
      .select('id, finished_lot_code, motivo_bloqueo_calidad, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .eq('bloqueado_calidad', true),
  ])

  const hoyData    = inspecHoyRes.status === 'fulfilled' ? inspecHoyRes.value.data  || [] : []
  const hist30     = hist30Res.status    === 'fulfilled' ? hist30Res.value.data     || [] : []
  const riesgoData = riesgoRes.status    === 'fulfilled' ? riesgoRes.value.data     || [] : []
  const bloqData   = bloqRes.status      === 'fulfilled' ? bloqRes.value.data       || [] : []

  const pendientesHoy  = hoyData.filter(i => i.status === 'pendiente').length
  const completadasHoy = hoyData.filter(i => i.status === 'completada').length
  const rechazadasHoy  = hoyData.filter(i => i.resultado === 'rechazado').length

  const completadas30  = hist30.length
  const rechazadas30   = hist30.filter(i => i.resultado === 'rechazado').length
  const retenidas30    = hist30.filter(i => i.resultado === 'retenido').length
  const tasaRechazo30  = completadas30 > 0 ? Math.round((rechazadas30 / completadas30) * 1000) / 10 : 0

  // Trend 14 days
  const mapaHist = {}
  for (const i of hist30) {
    if (!mapaHist[i.fecha]) mapaHist[i.fecha] = { fecha: i.fecha, total: 0, rechazados: 0, retenidos: 0, observaciones: 0 }
    mapaHist[i.fecha].total++
    if (i.resultado === 'rechazado')              mapaHist[i.fecha].rechazados++
    if (i.resultado === 'retenido')               mapaHist[i.fecha].retenidos++
    if (i.resultado === 'liberado_con_observacion') mapaHist[i.fecha].observaciones++
  }
  const trend = []
  for (let i = 13; i >= 0; i--) {
    const f = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    trend.push(mapaHist[f] || { fecha: f, total: 0, rechazados: 0, retenidos: 0, observaciones: 0 })
  }

  const config = await getConfiguracion()
  const enVigilancia = riesgoData.filter(r => n(r.probabilidad_final) >= n(config.umbral_vigilancia))

  return {
    hoy:           { pendientes: pendientesHoy, completadas: completadasHoy, rechazadas: rechazadasHoy, total: hoyData.length },
    stats30:       { total: completadas30, rechazadas: rechazadas30, retenidas: retenidas30, tasaRechazo: tasaRechazo30 },
    trend,
    riesgoRanking: riesgoData,
    enVigilancia,
    lotesBlockeados: bloqData,
    histReciente:  hist30.slice(0, 12),
    umbralVigilancia: n(config.umbral_vigilancia),
  }
}
