import { supabase } from '../../../lib/supabase'
import { getDemandaData } from '../../demanda/services/demandaService'
import { getProgramasAgricolas } from '../../programasAgricolas/services/programasAgricolasService'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function round(value, precision = 2) {
  const base = 10 ** precision
  return Math.round((n(value) + Number.EPSILON) * base) / base
}

function safeDate(value) {
  return value ? String(value).slice(0, 10) : ''
}

function nowIso() {
  return new Date().toISOString()
}

function todayIso() {
  return safeDate(nowIso())
}

function subtractDays(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return safeDate(date.toISOString())
}

function priorityValue(level) {
  if (level === 'critical') return 0
  if (level === 'warning') return 1
  return 2
}

function areaLabel(area) {
  if (area === 'inventory') return 'Inventario'
  if (area === 'production') return 'Producción'
  if (area === 'purchases') return 'Compras'
  if (area === 'quality') return 'Calidad'
  return 'General'
}

function levelLabel(level) {
  if (level === 'critical') return 'Crítica'
  if (level === 'warning') return 'Riesgo'
  return 'Informativa'
}

async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('No se pudo obtener el usuario autenticado')
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message || 'No se pudo cargar el perfil')
  return data
}

function normalizeAlert(raw, organizationId) {
  return {
    organization_id: organizationId,
    title: raw.title,
    description: raw.description,
    level: raw.level,
    area: raw.area,
    entity_type: raw.entity_type,
    entity_id: raw.entity_id || null,
    status: 'active',
    action_url: raw.action_url,
    action_label: raw.action_label || 'Ver acción',
    dedupe_key: raw.dedupe_key,
    metadata: raw.metadata || {},
    resolved_at: null,
    updated_at: nowIso(),
  }
}

function buildInventoryAlerts(materials = [], lots = []) {
  const stockByMaterial = new Map()

  ;(lots || []).forEach((lot) => {
    if (!lot?.material_id) return
    const current = stockByMaterial.get(lot.material_id) || 0
    if (['disponible', 'parcial'].includes(lot.status)) {
      stockByMaterial.set(lot.material_id, current + n(lot.available_quantity))
    }
  })

  const alerts = []
  ;(materials || []).forEach((material) => {
    const minimum = n(material.minimum_stock)
    const stock = n(stockByMaterial.get(material.id))

    if (minimum > 0 && stock < minimum) {
      alerts.push({
        title: `Inventario bajo mínimo: ${material.common_name}`,
        description: `Disponible ${round(stock, 2)} ${material.base_unit} frente a mínimo ${round(minimum, 2)} ${material.base_unit}.`,
        level: stock <= 0 ? 'critical' : 'warning',
        area: 'inventory',
        entity_type: 'material',
        entity_id: material.id,
        action_url: '/inventario-mp',
        action_label: 'Ver inventario',
        dedupe_key: `inventory:min-stock:${material.id}`,
        metadata: {
          material_name: material.common_name,
          stock_available: round(stock, 4),
          minimum_stock: round(minimum, 4),
          unit: material.base_unit,
        },
      })
    }
  })

  return alerts
}

function buildCoverageAlerts(consumptionRows = [], lots = []) {
  const stockByMaterial = new Map()
  ;(lots || []).forEach((lot) => {
    if (!lot?.material_id) return
    if (!['disponible', 'parcial'].includes(lot.status)) return
    stockByMaterial.set(lot.material_id, n(stockByMaterial.get(lot.material_id)) + n(lot.available_quantity))
  })

  const alerts = []
  ;(consumptionRows || []).forEach((row) => {
    const avgDailyConsumption = n(row.avg_daily_consumption)
    if (avgDailyConsumption <= 0) return

    const stock = n(stockByMaterial.get(row.material_id))
    const daysCover = stock / avgDailyConsumption

    if (daysCover < 5) {
      alerts.push({
        title: `Cobertura baja: ${row.material_name}`,
        description: `La cobertura estimada es de ${round(daysCover, 1)} día(s) con un consumo promedio de ${round(avgDailyConsumption, 2)} ${row.unit}/día.`,
        level: daysCover < 2 ? 'critical' : 'warning',
        area: 'inventory',
        entity_type: 'material',
        entity_id: row.material_id,
        action_url: '/proyeccion-compras',
        action_label: 'Planificar compra',
        dedupe_key: `inventory:coverage:${row.material_id}`,
        metadata: {
          material_name: row.material_name,
          days_cover: round(daysCover, 2),
          avg_daily_consumption: round(avgDailyConsumption, 4),
          stock_available: round(stock, 4),
          unit: row.unit,
        },
      })
    }
  })

  return alerts
}

function buildDemandAlerts(demandRows = []) {
  return (demandRows || [])
    .filter((row) => n(row.deficit) > 0)
    .slice(0, 6)
    .map((row) => ({
      title: `Producción sin MP suficiente: ${row.name}`,
      description: `Faltan ${round(row.deficit, 2)} ${row.base_unit} para cubrir pedidos activos. Necesidad total ${round(row.needed_qty, 2)} ${row.base_unit}.`,
      level: n(row.deficit) >= n(row.needed_qty) * 0.5 ? 'critical' : 'warning',
      area: 'production',
      entity_type: 'material',
      entity_id: row.material_id,
      action_url: '/proyeccion-compras',
      action_label: 'Crear compra',
      dedupe_key: `production:shortage:${row.material_id}`,
      metadata: {
        material_name: row.name,
        deficit: round(row.deficit, 4),
        needed_qty: round(row.needed_qty, 4),
        stock_qty: round(row.stock_qty, 4),
        unit: row.base_unit,
        orders: row.orders?.slice(0, 5) || [],
      },
    }))
}

function buildWasteAlerts(outputs = []) {
  return (outputs || [])
    .filter((row) => n(row.waste_percentage) > 12)
    .slice(0, 6)
    .map((row) => ({
      title: `Merma alta en proceso: ${row.output_lot_code}`,
      description: `La merma registrada fue ${round(row.waste_percentage, 2)}% en etapa ${row.stage}.`,
      level: n(row.waste_percentage) > 20 ? 'critical' : 'warning',
      area: 'production',
      entity_type: 'process_output',
      entity_id: row.id,
      action_url: '/procesos-mp',
      action_label: 'Ver proceso',
      dedupe_key: `production:waste:${row.id}`,
      metadata: {
        lot_code: row.output_lot_code,
        stage: row.stage,
        waste_percentage: round(row.waste_percentage, 4),
        input_quantity: round(row.input_quantity, 4),
        output_quantity: round(row.output_quantity, 4),
      },
    }))
}

function buildStalledProcessAlerts(runs = []) {
  const today = new Date(`${todayIso()}T00:00:00`)

  return (runs || [])
    .filter((run) => run.status === 'en_proceso')
    .map((run) => {
      const processDate = new Date(`${safeDate(run.process_date)}T00:00:00`)
      const openDays = Math.max(0, Math.round((today - processDate) / 86400000))
      return { ...run, openDays }
    })
    .filter((run) => run.openDays >= 2)
    .slice(0, 6)
    .map((run) => ({
      title: `Proceso abierto por más tiempo del esperado`,
      description: `El proceso ${run.source_internal_lot} sigue en ${run.current_stage} desde hace ${run.openDays} día(s).`,
      level: run.openDays >= 4 ? 'critical' : 'warning',
      area: 'production',
      entity_type: 'process_run',
      entity_id: run.id,
      action_url: '/procesos-mp',
      action_label: 'Revisar proceso',
      dedupe_key: `production:stalled:${run.id}`,
      metadata: {
        process_date: run.process_date,
        current_stage: run.current_stage,
        open_days: run.openDays,
        source_internal_lot: run.source_internal_lot,
      },
    }))
}

function buildSupplierAlerts(scorecards = [], programs = []) {
  const alerts = []

  ;(scorecards || []).forEach((scorecard) => {
    if (n(scorecard.global_score) < 70 || n(scorecard.on_time_pct) < 85) {
      alerts.push({
        title: `Bajo cumplimiento de proveedor`,
        description: `${scorecard.suppliers?.name || 'Proveedor'} tiene score ${round(scorecard.global_score, 2)} y puntualidad ${round(scorecard.on_time_pct, 2)}%.`,
        level: n(scorecard.global_score) < 60 ? 'critical' : 'warning',
        area: 'purchases',
        entity_type: 'supplier',
        entity_id: scorecard.supplier_id,
        action_url: '/proveedores',
        action_label: 'Ver proveedor',
        dedupe_key: `purchases:supplier-score:${scorecard.supplier_id}`,
        metadata: {
          supplier_name: scorecard.suppliers?.name || 'Proveedor',
          global_score: round(scorecard.global_score, 2),
          on_time_pct: round(scorecard.on_time_pct, 2),
          quality_pct: round(scorecard.quality_pct, 2),
        },
      })
    }
  })

  ;(programs || [])
    .filter((program) => (program.alerts || []).some((alert) => ['subentrega', 'subentrega_acumulada', 'sobreentrega', 'sobreentrega_acumulada', 'faltante_cierre'].includes(alert.type)))
    .slice(0, 6)
    .forEach((program) => {
      const mainAlert = (program.alerts || []).find((alert) => ['subentrega', 'subentrega_acumulada', 'sobreentrega', 'sobreentrega_acumulada', 'faltante_cierre'].includes(alert.type))
      if (!mainAlert) return

      alerts.push({
        title: `Programa agrícola con desviación`,
        description: `${program.program_code} · ${program.suppliers?.name || 'Proveedor'} · ${mainAlert.message}`,
        level: mainAlert.level === 'danger' ? 'critical' : 'warning',
        area: 'purchases',
        entity_type: 'program',
        entity_id: program.id,
        action_url: '/programas-agricolas',
        action_label: 'Ver programa',
        dedupe_key: `purchases:program:${program.id}:${mainAlert.type}`,
        metadata: {
          program_code: program.program_code,
          supplier_name: program.suppliers?.name || 'Proveedor',
          material_name: program.materials?.common_name || 'Materia prima',
          compliance_pct: round(program.compliance_pct, 2),
          alert_type: mainAlert.type,
        },
      })
    })

  return alerts
}

function buildQualityAlerts(inspections = []) {
  const alerts = []

  ;(inspections || [])
    .filter((inspection) => inspection.status === 'pendiente')
    .slice(0, 5)
    .forEach((inspection) => {
      alerts.push({
        title: 'Muestreo fuera de estándar operativo',
        description: `Hay una inspección pendiente para ${inspection.product_presentations?.display_name || 'SKU'} del ${inspection.fecha}.`,
        level: 'warning',
        area: 'quality',
        entity_type: 'inspection',
        entity_id: inspection.id,
        action_url: '/calidad',
        action_label: 'Ir a calidad',
        dedupe_key: `quality:pending:${inspection.id}`,
        metadata: {
          inspection_date: inspection.fecha,
          sku_name: inspection.product_presentations?.display_name || '',
          origin: inspection.origen,
        },
      })
    })

  ;(inspections || [])
    .filter((inspection) => inspection.status === 'completada' && ['rechazado', 'retenido'].includes(inspection.resultado))
    .slice(0, 6)
    .forEach((inspection) => {
      alerts.push({
        title: inspection.resultado === 'rechazado' ? 'Lote rechazado por calidad' : 'Lote retenido por calidad',
        description: `${inspection.finished_inventory_lots?.finished_lot_code || 'Lote'} con tasa de defectos ${round(inspection.tasa_defectos, 2)}%.`,
        level: inspection.resultado === 'rechazado' ? 'critical' : 'warning',
        area: 'quality',
        entity_type: 'batch',
        entity_id: inspection.finished_lot_id || inspection.id,
        action_url: '/calidad',
        action_label: 'Ver lote',
        dedupe_key: `quality:lot:${inspection.finished_lot_id || inspection.id}`,
        metadata: {
          inspection_id: inspection.id,
          lot_code: inspection.finished_inventory_lots?.finished_lot_code || '',
          result: inspection.resultado,
          defect_rate: round(inspection.tasa_defectos, 2),
        },
      })
    })

  return alerts
}

function buildMaintenanceAlerts(maintenanceAlerts = []) {
  return (maintenanceAlerts || []).map((alert) => ({
    title: alert.severity === 'critical' ? 'Mantenimiento critico' : 'Mantenimiento proximo',
    description: alert.message,
    level: alert.severity === 'critical' ? 'critical' : 'warning',
    area: 'general',
    entity_type: 'maintenance',
    entity_id: alert.equipment_id,
    action_url: '/mantenimiento',
    action_label: 'Ver mantenimiento',
    dedupe_key: `maintenance:${alert.alert_key}`,
    metadata: {
      maintenance_alert_id: alert.id,
      alert_type: alert.alert_type,
      due_date: alert.due_date,
      usage_target: alert.usage_target,
      current_usage: alert.current_usage,
    },
  }))
}

async function resolveMissingAlerts(profile, activeKeys = []) {
  const { data: currentAlerts, error: fetchError } = await supabase
    .from('alerts')
    .select('id, dedupe_key')
    .eq('organization_id', profile.organization_id)
    .in('status', ['active', 'reviewing'])

  if (fetchError) {
    throw new Error(fetchError.message || 'No se pudieron revisar las alertas previas')
  }

  const staleIds = (currentAlerts || [])
    .filter((row) => !activeKeys.includes(row.dedupe_key))
    .map((row) => row.id)

  if (!staleIds.length) return

  const { error } = await supabase
    .from('alerts')
    .update({
      status: 'resolved',
      resolved_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('organization_id', profile.organization_id)
    .in('id', staleIds)

  if (error) {
    throw new Error(error.message || 'No se pudieron resolver alertas antiguas')
  }
}

async function syncOperationalAlerts(profile) {
  const [
    materialsRes,
    lotsRes,
    runsRes,
    outputsRes,
    scorecardsRes,
    inspectionsRes,
    maintenanceAlertsRes,
    demandaRows,
    programs,
  ] = await Promise.all([
    supabase
      .from('materials')
      .select('id, common_name, code, base_unit, minimum_stock, status')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo'),
    supabase
      .from('material_inventory_lots')
      .select('id, material_id, available_quantity, unit, status')
      .eq('organization_id', profile.organization_id),
    supabase
      .from('material_process_runs')
      .select('id, source_internal_lot, source_material_id, input_quantity, current_stage, process_date, status')
      .eq('organization_id', profile.organization_id)
      .gte('process_date', subtractDays(10)),
    supabase
      .from('material_process_stage_outputs')
      .select('id, process_run_id, stage, output_lot_code, input_quantity, output_quantity, waste_percentage, created_at')
      .eq('organization_id', profile.organization_id)
      .gte('created_at', `${subtractDays(7)}T00:00:00`),
    supabase
      .from('supplier_scorecards')
      .select('*, suppliers(id, name)')
      .eq('organization_id', profile.organization_id),
    supabase
      .from('inspecciones_calidad')
      .select(`
        id,
        fecha,
        finished_lot_id,
        status,
        resultado,
        origen,
        tasa_defectos,
        product_presentations(id, display_name),
        finished_inventory_lots(id, finished_lot_code)
      `)
      .eq('organization_id', profile.organization_id)
      .gte('fecha', subtractDays(14))
      .order('fecha', { ascending: false }),
    supabase
      .from('maintenance_alerts')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'abierta'),
    getDemandaData(),
    getProgramasAgricolas(),
  ])

  if (materialsRes.error) throw new Error(materialsRes.error.message)
  if (lotsRes.error) throw new Error(lotsRes.error.message)
  if (runsRes.error) throw new Error(runsRes.error.message)
  if (outputsRes.error) throw new Error(outputsRes.error.message)
  if (scorecardsRes.error) throw new Error(scorecardsRes.error.message)
  if (inspectionsRes.error) throw new Error(inspectionsRes.error.message)
  if (maintenanceAlertsRes.error) throw new Error(maintenanceAlertsRes.error.message)

  const materials = materialsRes.data || []
  const lots = lotsRes.data || []
  const runs = runsRes.data || []
  const outputs = outputsRes.data || []
  const scorecards = scorecardsRes.data || []
  const inspections = inspectionsRes.data || []
  const maintenanceAlerts = maintenanceAlertsRes.data || []

  const consumptionMap = {}
  ;(runs || [])
    .filter((run) => safeDate(run.process_date) >= subtractDays(14))
    .forEach((run) => {
      const materialId = run.source_material_id
      if (!materialId) return
      if (!consumptionMap[materialId]) {
        const material = materials.find((item) => item.id === materialId)
        consumptionMap[materialId] = {
          material_id: materialId,
          material_name: material?.common_name || 'Materia prima',
          unit: material?.base_unit || 'und',
          total_input: 0,
        }
      }
      consumptionMap[materialId].total_input += n(run.input_quantity)
    })

  const consumptionRows = Object.values(consumptionMap).map((row) => ({
    ...row,
    avg_daily_consumption: row.total_input / 14,
  }))

  const computedAlerts = [
    ...buildInventoryAlerts(materials, lots),
    ...buildCoverageAlerts(consumptionRows, lots),
    ...buildDemandAlerts(demandaRows),
    ...buildWasteAlerts(outputs),
    ...buildStalledProcessAlerts(runs),
    ...buildSupplierAlerts(scorecards, programs),
    ...buildQualityAlerts(inspections),
    ...buildMaintenanceAlerts(maintenanceAlerts),
  ]

  const dedupedMap = new Map()
  computedAlerts.forEach((alert) => {
    const existing = dedupedMap.get(alert.dedupe_key)
    if (!existing || priorityValue(alert.level) < priorityValue(existing.level)) {
      dedupedMap.set(alert.dedupe_key, alert)
    }
  })

  const dedupedAlerts = [...dedupedMap.values()]
  if (dedupedAlerts.length) {
    const { error } = await supabase
      .from('alerts')
      .upsert(dedupedAlerts.map((alert) => normalizeAlert(alert, profile.organization_id)), {
        onConflict: 'organization_id,dedupe_key',
      })

    if (error) throw new Error(error.message || 'No se pudieron sincronizar las alertas')
  }

  await resolveMissingAlerts(profile, dedupedAlerts.map((alert) => alert.dedupe_key))
}

export async function getAlertCenterData({ filter = 'all', page = 1, pageSize = 15, search = '', sync = true } = {}) {
  const profile = await getProfile()
  if (sync) {
    await syncOperationalAlerts(profile)
  }

  let query = supabase
    .from('alerts')
    .select('*', { count: 'exact' })
    .eq('organization_id', profile.organization_id)
    .in('status', ['active', 'reviewing'])
    .order('created_at', { ascending: false })

  if (filter === 'today') {
    query = query.gte('created_at', `${todayIso()}T00:00:00`)
  } else if (['inventory', 'production', 'purchases', 'quality'].includes(filter)) {
    query = query.eq('area', filter)
  }

  if (search.trim()) {
    const term = search.trim()
    query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`)
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await query.range(from, to)

  if (error) throw new Error(error.message || 'No se pudieron cargar las alertas')

  const rows = (data || [])
    .sort((a, b) => {
      const priorityDiff = priorityValue(a.level) - priorityValue(b.level)
      if (priorityDiff !== 0) return priorityDiff
      return String(b.created_at).localeCompare(String(a.created_at))
    })

  const counts = {
    critical: rows.filter((row) => row.level === 'critical').length,
    warning: rows.filter((row) => row.level === 'warning').length,
    info: rows.filter((row) => row.level === 'info').length,
  }

  const { data: summaryRows, error: summaryError } = await supabase
    .from('alerts')
    .select('level, area, status, created_at')
    .eq('organization_id', profile.organization_id)
    .in('status', ['active', 'reviewing'])

  if (summaryError) throw new Error(summaryError.message || 'No se pudo cargar el resumen de alertas')

  const headerCounts = {
    critical: (summaryRows || []).filter((row) => row.level === 'critical').length,
    warning: (summaryRows || []).filter((row) => row.level === 'warning').length,
    info: (summaryRows || []).filter((row) => row.level === 'info').length,
  }

  return {
    counts: headerCounts,
    visibleCount: rows.length,
    total: count || rows.length,
    hasMore: (count || 0) > to + 1,
    alerts: rows.map((row) => ({
      ...row,
      level_label: levelLabel(row.level),
      area_label: areaLabel(row.area),
      action_label: row.action_label || row.metadata?.action_label || 'Ver acción',
      can_resolve: row.status !== 'resolved',
    })),
    page,
    pageSize,
    summaryCounts: counts,
  }
}

export async function updateAlertStatus(alertId, status) {
  const profile = await getProfile()
  const nextStatus = status || 'reviewing'

  const payload = {
    status: nextStatus,
    updated_at: nowIso(),
  }

  if (nextStatus === 'resolved') {
    payload.resolved_at = nowIso()
  }

  const { error } = await supabase
    .from('alerts')
    .update(payload)
    .eq('organization_id', profile.organization_id)
    .eq('id', alertId)

  if (error) throw new Error(error.message || 'No se pudo actualizar la alerta')
}

export async function syncAlertCenter() {
  const profile = await getProfile()
  await syncOperationalAlerts(profile)
}
