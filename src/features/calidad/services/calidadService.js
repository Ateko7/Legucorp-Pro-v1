import { supabase } from '../../../lib/supabase'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))]
}

function severityRank(level) {
  if (level === 'critico') return 3
  if (level === 'mayor') return 2
  if (level === 'menor') return 1
  return 0
}

function resultRank(result) {
  if (result === 'rechazado') return 4
  if (result === 'retenido') return 3
  if (result === 'liberado_con_observacion') return 2
  if (result === 'liberado') return 1
  return 0
}

function maxResult(a, b) {
  return resultRank(a) >= resultRank(b) ? a : b
}

function getNonConformityStatus(row) {
  if (!row) return 'abierta'
  if (row.status === 'cerrada') return 'cerrada'
  if (row.due_date && row.status !== 'cerrada' && row.due_date < new Date().toISOString().slice(0, 10)) {
    return 'vencida'
  }
  return row.status || 'abierta'
}

const DEFAULT_CONFIG = {
  probabilidad_base: 0.4,
  peso_reclamos: 0.1,
  peso_no_conformidades: 0.05,
  ajuste_rechazo: 0.3,
  ajuste_observacion: 0.15,
  ajuste_limpio: 0.1,
  probabilidad_maxima: 0.9,
  probabilidad_minima: 0.1,
  ventana_resultados: 15,
  ventana_reclamos: 30,
  tamano_muestra_base: 5,
  umbral_vigilancia: 0.7,
}

export const QUALITY_STAGES = [
  { key: 'recepcion_mp', label: 'Recepción MP' },
  { key: 'proceso', label: 'Proceso' },
  { key: 'empaque_final', label: 'Empaque' },
]

export const RESULTADOS_CALIDAD = [
  'liberado',
  'liberado_con_observacion',
  'retenido',
  'rechazado',
]

const DEFAULT_SPEC_LIBRARY = {
  recepcion_mp: {
    name: 'Recepción MP estándar',
    description: 'Controles base para liberación de materia prima recibida.',
    rules: [
      {
        code: 'temp_recepcion',
        label: 'Temperatura de recepción',
        measurement_type: 'numeric',
        unit: '°C',
        min_value: 3,
        max_value: 6,
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'condicion_visual',
        label: 'Condición visual',
        measurement_type: 'select',
        allowed_values: ['conforme', 'aprobado'],
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'rechazo_pct',
        label: 'Porcentaje de rechazo',
        measurement_type: 'numeric',
        unit: '%',
        min_value: 0,
        max_value: 5,
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'vida_util_restante',
        label: 'Vida útil restante',
        measurement_type: 'numeric',
        unit: 'días',
        min_value: 3,
        severity: 'critico',
        decision_effect: 'rechazado',
      },
      {
        code: 'trazabilidad_lote',
        label: 'Lote/proveedor identificado',
        measurement_type: 'boolean',
        expected_boolean: true,
        severity: 'critico',
        decision_effect: 'rechazado',
      },
    ],
  },
  proceso: {
    name: 'Proceso estándar',
    description: 'Controles base de merma, checklist y condiciones de proceso.',
    rules: [
      {
        code: 'merma_proceso',
        label: 'Merma del proceso',
        measurement_type: 'numeric',
        unit: '%',
        min_value: 0,
        max_value: 18,
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'temperatura_proceso',
        label: 'Temperatura de proceso',
        measurement_type: 'numeric',
        unit: '°C',
        min_value: 3,
        max_value: 6,
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'humedad_proceso',
        label: 'Humedad residual',
        measurement_type: 'numeric',
        unit: '%',
        min_value: 0,
        max_value: 12,
        severity: 'menor',
        decision_effect: 'liberado_con_observacion',
      },
      {
        code: 'rendimiento',
        label: 'Rendimiento',
        measurement_type: 'numeric',
        unit: '%',
        min_value: 82,
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'checklist',
        label: 'Checklist de proceso',
        measurement_type: 'boolean',
        expected_boolean: true,
        severity: 'critico',
        decision_effect: 'rechazado',
      },
    ],
  },
  empaque_final: {
    name: 'Empaque final estándar',
    description: 'Controles de liberación de producto terminado.',
    rules: [
      {
        code: 'desviacion_peso',
        label: 'Desviación de peso neto',
        measurement_type: 'numeric',
        unit: '%',
        min_value: -3,
        max_value: 3,
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'sellado',
        label: 'Sellado conforme',
        measurement_type: 'boolean',
        expected_boolean: true,
        severity: 'critico',
        decision_effect: 'rechazado',
      },
      {
        code: 'etiqueta',
        label: 'Etiqueta conforme',
        measurement_type: 'boolean',
        expected_boolean: true,
        severity: 'mayor',
        decision_effect: 'retenido',
      },
      {
        code: 'codigo_lote',
        label: 'Código/lote correcto',
        measurement_type: 'boolean',
        expected_boolean: true,
        severity: 'critico',
        decision_effect: 'rechazado',
      },
      {
        code: 'defectos_visuales',
        label: 'Defectos visuales',
        measurement_type: 'defect_count',
        defect_threshold: 0,
        severity: 'menor',
        decision_effect: 'liberado_con_observacion',
      },
    ],
  },
}

async function getAuth() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)
  if (!user) throw new Error('No hay usuario autenticado.')

  const { data, error } = await supabase
    .from('profiles')
    .select('organization_id, id, full_name')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return { orgId: data.organization_id, userId: data.id, userName: data.full_name || 'Usuario' }
}

async function ensureDefaultSpecTemplates(orgId, userId) {
  const { data: existing, error } = await supabase
    .from('quality_spec_templates')
    .select('id, inspection_stage, name')
    .eq('organization_id', orgId)

  if (error) throw new Error(error.message)

  const existingByStage = new Map((existing || []).map((row) => [row.inspection_stage, row]))
  for (const stage of Object.keys(DEFAULT_SPEC_LIBRARY)) {
    if (existingByStage.has(stage)) continue
    const templateDef = DEFAULT_SPEC_LIBRARY[stage]
    const { data: template, error: templateError } = await supabase
      .from('quality_spec_templates')
      .insert({
        organization_id: orgId,
        inspection_stage: stage,
        name: templateDef.name,
        description: templateDef.description,
        is_active: true,
        created_by: userId,
      })
      .select()
      .single()

    if (templateError) throw new Error(templateError.message)

    const rulesPayload = templateDef.rules.map((rule, index) => ({
      organization_id: orgId,
      template_id: template.id,
      sort_order: index + 1,
      code: rule.code,
      label: rule.label,
      measurement_type: rule.measurement_type,
      unit: rule.unit || null,
      min_value: rule.min_value ?? null,
      max_value: rule.max_value ?? null,
      expected_boolean: rule.expected_boolean ?? null,
      allowed_values: rule.allowed_values || [],
      defect_threshold: rule.defect_threshold ?? null,
      severity: rule.severity,
      decision_effect: rule.decision_effect,
      is_required: true,
    }))

    const { error: rulesError } = await supabase
      .from('quality_spec_rules')
      .insert(rulesPayload)

    if (rulesError) throw new Error(rulesError.message)
  }
}

function normalizeRule(row) {
  return {
    ...row,
    min_value: row.min_value == null ? null : n(row.min_value),
    max_value: row.max_value == null ? null : n(row.max_value),
    defect_threshold: row.defect_threshold == null ? null : Number(row.defect_threshold),
    allowed_values: Array.isArray(row.allowed_values)
      ? row.allowed_values
      : (() => {
          try { return JSON.parse(row.allowed_values || '[]') } catch { return [] }
        })(),
  }
}

function normalizeMeasurementInput(raw, rule) {
  return {
    spec_rule_id: rule.id,
    actual_numeric: raw.actual_numeric === '' || raw.actual_numeric == null ? null : n(raw.actual_numeric),
    actual_boolean: raw.actual_boolean === '' || raw.actual_boolean == null ? null : Boolean(raw.actual_boolean),
    actual_text: raw.actual_text?.trim() || null,
    actual_count: raw.actual_count === '' || raw.actual_count == null ? null : parseInt(raw.actual_count, 10),
    notes: raw.notes?.trim() || null,
  }
}

function evaluateMeasurement(rule, rawMeasurement) {
  const measurement = normalizeMeasurementInput(rawMeasurement || {}, rule)
  let pass = true
  let detailValue = null

  if (rule.measurement_type === 'numeric') {
    detailValue = measurement.actual_numeric
    if (measurement.actual_numeric == null) pass = !rule.is_required
    if (rule.min_value != null && measurement.actual_numeric < rule.min_value) pass = false
    if (rule.max_value != null && measurement.actual_numeric > rule.max_value) pass = false
  }

  if (rule.measurement_type === 'boolean') {
    detailValue = measurement.actual_boolean
    if (measurement.actual_boolean == null) pass = !rule.is_required
    if (rule.expected_boolean != null && measurement.actual_boolean !== rule.expected_boolean) pass = false
  }

  if (rule.measurement_type === 'select') {
    detailValue = measurement.actual_text
    const allowed = (rule.allowed_values || []).map((item) => String(item || '').trim().toLowerCase())
    if (!measurement.actual_text) pass = !rule.is_required
    if (measurement.actual_text && allowed.length > 0 && !allowed.includes(String(measurement.actual_text).trim().toLowerCase())) {
      pass = false
    }
  }

  if (rule.measurement_type === 'defect_count') {
    detailValue = measurement.actual_count
    if (measurement.actual_count == null) pass = !rule.is_required
    if (rule.defect_threshold != null && measurement.actual_count > rule.defect_threshold) pass = false
  }

  return {
    ...measurement,
    pass,
    severity: rule.severity,
    decision_effect: pass ? null : rule.decision_effect,
    detailValue,
    rule_snapshot: {
      code: rule.code,
      label: rule.label,
      measurement_type: rule.measurement_type,
      unit: rule.unit,
      min_value: rule.min_value,
      max_value: rule.max_value,
      expected_boolean: rule.expected_boolean,
      allowed_values: rule.allowed_values || [],
      defect_threshold: rule.defect_threshold,
      severity: rule.severity,
      decision_effect: rule.decision_effect,
    },
  }
}

function buildAutoDecision({ rules = [], measurements = [], defectos = [] }) {
  let autoResult = 'liberado'
  let topSeverity = 'menor'

  for (const evaluated of measurements) {
    if (!evaluated.pass) {
      autoResult = maxResult(autoResult, evaluated.decision_effect || 'liberado_con_observacion')
      if (severityRank(evaluated.severity) > severityRank(topSeverity)) {
        topSeverity = evaluated.severity
      }
    }
  }

  for (const defecto of defectos) {
    const mapped =
      defecto.nivel === 'critico'
        ? 'rechazado'
        : defecto.nivel === 'mayor'
          ? 'retenido'
          : 'liberado_con_observacion'
    autoResult = maxResult(autoResult, mapped)
    if (severityRank(defecto.nivel) > severityRank(topSeverity)) topSeverity = defecto.nivel
  }

  const failingRules = measurements.filter((item) => !item.pass).length
  return {
    resultado_automatico: autoResult,
    resultado_sugerido: autoResult,
    failing_rules: failingRules,
    top_severity: failingRules > 0 || defectos.length > 0 ? topSeverity : null,
  }
}

export function evaluateInspectionDraft(specRules = [], draftMeasurements = [], defectos = []) {
  const measurements = (specRules || []).map((rule) => {
    const existing = (draftMeasurements || []).find((item) => item.spec_rule_id === rule.id)
    return evaluateMeasurement(rule, existing || {})
  })
  return {
    measurements,
    ...buildAutoDecision({ rules: specRules, measurements, defectos }),
  }
}

async function getTemplateForStage(orgId, stage) {
  const { data, error } = await supabase
    .from('quality_spec_templates')
    .select('*')
    .eq('organization_id', orgId)
    .eq('inspection_stage', stage)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

async function getRulesByTemplateIds(templateIds = []) {
  if (!templateIds.length) return {}
  const { data, error } = await supabase
    .from('quality_spec_rules')
    .select('*')
    .in('template_id', templateIds)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)
  return (data || []).reduce((acc, row) => {
    const normalized = normalizeRule(row)
    if (!acc[row.template_id]) acc[row.template_id] = []
    acc[row.template_id].push(normalized)
    return acc
  }, {})
}

async function hydrateInspecciones(inspecciones = [], orgId) {
  if (!inspecciones.length) return []

  const templateIds = uniq(inspecciones.map((item) => item.spec_template_id))
  const receptionIds = uniq(inspecciones.map((item) => item.source_reception_id))
  const outputIds = uniq(inspecciones.map((item) => item.source_process_output_id))
  const processedLotIds = uniq(inspecciones.map((item) => item.source_processed_lot_id))
  const finishedLotIds = uniq(inspecciones.map((item) => item.finished_lot_id))
  const productIds = uniq(inspecciones.map((item) => item.product_presentation_id))
  const inspectionIds = inspecciones.map((item) => item.id)

  const [
    templatesRes,
    rulesByTemplate,
    receptionsRes,
    outputsRes,
    processedLotsRes,
    finishedLotsRes,
    productsRes,
    measurementsRes,
    defectsRes,
    ncRes,
  ] = await Promise.all([
    templateIds.length
      ? supabase.from('quality_spec_templates').select('*').in('id', templateIds)
      : Promise.resolve({ data: [], error: null }),
    getRulesByTemplateIds(templateIds),
    receptionIds.length
      ? supabase
          .from('material_receptions')
          .select(`
            *,
            suppliers(id, name),
            materials(id, code, common_name, base_unit)
          `)
          .in('id', receptionIds)
      : Promise.resolve({ data: [], error: null }),
    outputIds.length
      ? supabase
          .from('material_process_stage_outputs')
          .select(`
            *,
            materials(id, code, common_name),
            material_process_runs!process_run_id(id, process_date, source_internal_lot)
          `)
          .in('id', outputIds)
      : Promise.resolve({ data: [], error: null }),
    processedLotIds.length
      ? supabase
          .from('processed_inventory_lots')
          .select(`
            *,
            materials(id, code, common_name)
          `)
          .in('id', processedLotIds)
      : Promise.resolve({ data: [], error: null }),
    finishedLotIds.length
      ? supabase
          .from('finished_inventory_lots')
          .select(`
            *,
            product_presentations(id, code, display_name)
          `)
          .in('id', finishedLotIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase
          .from('product_presentations')
          .select('id, code, display_name')
          .in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('quality_inspection_measurements')
      .select('*')
      .in('inspection_id', inspectionIds),
    supabase
      .from('defectos_inspeccion')
      .select('*')
      .in('inspeccion_id', inspectionIds),
    supabase
      .from('quality_non_conformities')
      .select('*')
      .eq('organization_id', orgId)
      .in('inspection_id', inspectionIds),
  ])

  if (templatesRes.error) throw new Error(templatesRes.error.message)
  if (receptionsRes.error) throw new Error(receptionsRes.error.message)
  if (outputsRes.error) throw new Error(outputsRes.error.message)
  if (processedLotsRes.error) throw new Error(processedLotsRes.error.message)
  if (finishedLotsRes.error) throw new Error(finishedLotsRes.error.message)
  if (productsRes.error) throw new Error(productsRes.error.message)
  if (measurementsRes.error) throw new Error(measurementsRes.error.message)
  if (defectsRes.error) throw new Error(defectsRes.error.message)
  if (ncRes.error) throw new Error(ncRes.error.message)

  const templates = Object.fromEntries((templatesRes.data || []).map((item) => [item.id, item]))
  const receptions = Object.fromEntries((receptionsRes.data || []).map((item) => [item.id, item]))
  const outputs = Object.fromEntries((outputsRes.data || []).map((item) => [item.id, item]))
  const processedLots = Object.fromEntries((processedLotsRes.data || []).map((item) => [item.id, item]))
  const finishedLots = Object.fromEntries((finishedLotsRes.data || []).map((item) => [item.id, item]))
  const products = Object.fromEntries((productsRes.data || []).map((item) => [item.id, item]))
  const ncByInspection = Object.fromEntries((ncRes.data || []).map((item) => [item.inspection_id, { ...item, status: getNonConformityStatus(item) }]))

  const measurementsByInspection = {}
  for (const row of measurementsRes.data || []) {
    if (!measurementsByInspection[row.inspection_id]) measurementsByInspection[row.inspection_id] = []
    measurementsByInspection[row.inspection_id].push(row)
  }

  const defectsByInspection = {}
  for (const row of defectsRes.data || []) {
    if (!defectsByInspection[row.inspeccion_id]) defectsByInspection[row.inspeccion_id] = []
    defectsByInspection[row.inspeccion_id].push(row)
  }

  return inspecciones.map((item) => {
    const specRules = rulesByTemplate[item.spec_template_id] || []
    const specTemplate = templates[item.spec_template_id] || null
    const sourceReception = item.source_reception_id ? receptions[item.source_reception_id] || null : null
    const sourceProcessOutput = item.source_process_output_id ? outputs[item.source_process_output_id] || null : null
    const sourceProcessedLot = item.source_processed_lot_id ? processedLots[item.source_processed_lot_id] || null : null
    const finishedLot = item.finished_lot_id ? finishedLots[item.finished_lot_id] || null : null
    const product = item.product_presentation_id ? products[item.product_presentation_id] || finishedLot?.product_presentations || null : finishedLot?.product_presentations || null

    let sourceLabel = 'Sin origen'
    if (item.inspection_stage === 'recepcion_mp' && sourceReception) {
      sourceLabel = `${sourceReception.materials?.common_name || 'Materia prima'} · recepción ${sourceReception.internal_lot}`
    }
    if (item.inspection_stage === 'proceso' && sourceProcessOutput) {
      sourceLabel = `${sourceProcessOutput.materials?.common_name || 'Proceso'} · sublote ${sourceProcessOutput.output_lot_code}`
    }
    if (item.inspection_stage === 'proceso' && !sourceProcessOutput && sourceProcessedLot) {
      sourceLabel = `${sourceProcessedLot.materials?.common_name || 'Proceso'} · lote ${sourceProcessedLot.internal_lot}`
    }
    if (item.inspection_stage === 'empaque_final' && finishedLot) {
      sourceLabel = `${product?.display_name || product?.code || 'SKU'} · lote ${finishedLot.finished_lot_code}`
    }

    return {
      ...item,
      product_presentations: product,
      finished_inventory_lots: finishedLot,
      source_reception: sourceReception,
      source_process_output: sourceProcessOutput,
      source_processed_lot: sourceProcessedLot,
      spec_template: specTemplate,
      spec_rules: specRules,
      measurements: measurementsByInspection[item.id] || [],
      defectos_inspeccion: defectsByInspection[item.id] || [],
      non_conformity: ncByInspection[item.id] || null,
      source_label: sourceLabel,
    }
  })
}

async function applyQualityBlock(inspection, reason) {
  const motivo = reason?.trim() || 'Bloqueado por calidad'

  if (inspection.inspection_stage === 'recepcion_mp' && inspection.source_reception_id) {
    const { error } = await supabase
      .from('material_inventory_lots')
      .update({
        bloqueado_calidad: true,
        motivo_bloqueo_calidad: motivo,
        updated_at: new Date().toISOString(),
      })
      .eq('reception_id', inspection.source_reception_id)
    if (error) throw new Error(error.message)
  }

  if (inspection.inspection_stage === 'proceso') {
    if (inspection.source_process_output_id) {
      const [outputRes, processedRes] = await Promise.all([
        supabase
          .from('material_process_stage_outputs')
          .update({
            bloqueado_calidad: true,
            motivo_bloqueo_calidad: motivo,
          })
          .eq('id', inspection.source_process_output_id),
        supabase
          .from('processed_inventory_lots')
          .update({
            bloqueado_calidad: true,
            motivo_bloqueo_calidad: motivo,
            status: 'bloqueado',
            updated_at: new Date().toISOString(),
          })
          .eq('source_output_id', inspection.source_process_output_id),
      ])
      if (outputRes.error) throw new Error(outputRes.error.message)
      if (processedRes.error) throw new Error(processedRes.error.message)
    }

    if (inspection.source_processed_lot_id) {
      const { error } = await supabase
        .from('processed_inventory_lots')
        .update({
          bloqueado_calidad: true,
          motivo_bloqueo_calidad: motivo,
          status: 'bloqueado',
          updated_at: new Date().toISOString(),
        })
        .eq('id', inspection.source_processed_lot_id)
      if (error) throw new Error(error.message)
    }
  }

  if (inspection.inspection_stage === 'empaque_final' && inspection.finished_lot_id) {
    const { error } = await supabase
      .from('finished_inventory_lots')
      .update({
        bloqueado_calidad: true,
        motivo_bloqueo_calidad: motivo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inspection.finished_lot_id)
    if (error) throw new Error(error.message)
  }

  const { error: inspectionError } = await supabase
    .from('inspecciones_calidad')
    .update({ lote_bloqueado: true, updated_at: new Date().toISOString() })
    .eq('id', inspection.id)

  if (inspectionError) throw new Error(inspectionError.message)
}

async function clearQualityBlock(inspection, reason) {
  const motivo = reason?.trim() || null

  if (inspection.inspection_stage === 'recepcion_mp' && inspection.source_reception_id) {
    const { error } = await supabase
      .from('material_inventory_lots')
      .update({
        bloqueado_calidad: false,
        motivo_bloqueo_calidad: motivo,
        updated_at: new Date().toISOString(),
      })
      .eq('reception_id', inspection.source_reception_id)
    if (error) throw new Error(error.message)
  }

  if (inspection.inspection_stage === 'proceso') {
    if (inspection.source_process_output_id) {
      const { error } = await supabase
        .from('material_process_stage_outputs')
        .update({
          bloqueado_calidad: false,
          motivo_bloqueo_calidad: motivo,
        })
        .eq('id', inspection.source_process_output_id)
      if (error) throw new Error(error.message)
    }

    if (inspection.source_processed_lot_id || inspection.source_process_output_id) {
      let query = supabase
        .from('processed_inventory_lots')
        .update({
          bloqueado_calidad: false,
          motivo_bloqueo_calidad: motivo,
          status: 'disponible',
          updated_at: new Date().toISOString(),
        })
      if (inspection.source_processed_lot_id) query = query.eq('id', inspection.source_processed_lot_id)
      else query = query.eq('source_output_id', inspection.source_process_output_id)
      const { error } = await query
      if (error) throw new Error(error.message)
    }
  }

  if (inspection.inspection_stage === 'empaque_final' && inspection.finished_lot_id) {
    const { error } = await supabase
      .from('finished_inventory_lots')
      .update({
        bloqueado_calidad: false,
        motivo_bloqueo_calidad: motivo,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inspection.finished_lot_id)
    if (error) throw new Error(error.message)
  }

  const { error: inspectionError } = await supabase
    .from('inspecciones_calidad')
    .update({ lote_bloqueado: false, updated_at: new Date().toISOString() })
    .eq('id', inspection.id)

  if (inspectionError) throw new Error(inspectionError.message)
}

async function upsertNonConformity({ inspection, finalResult, autoDecision, defectos = [], observaciones, userId }) {
  const shouldCreate =
    ['retenido', 'rechazado'].includes(finalResult) ||
    autoDecision.top_severity === 'critico' ||
    autoDecision.top_severity === 'mayor'

  if (!shouldCreate) return null

  const highestDefect = defectos.sort((a, b) => severityRank(b.nivel) - severityRank(a.nivel))[0]
  const severity =
    autoDecision.top_severity ||
    highestDefect?.nivel ||
    (finalResult === 'rechazado' ? 'critico' : finalResult === 'retenido' ? 'mayor' : 'menor')

  const immediateDisposition =
    finalResult === 'rechazado'
      ? 'devolver'
      : finalResult === 'retenido'
        ? 'segregar'
        : 'retrabajo'

  const defectDetected = highestDefect?.tipo_defecto || observaciones || 'No conformidad detectada durante inspección'
  const title = `NC ${inspection.inspection_stage} · ${defectDetected}`

  const existing = await supabase
    .from('quality_non_conformities')
    .select('id')
    .eq('inspection_id', inspection.id)
    .maybeSingle()

  if (existing.error) throw new Error(existing.error.message)

  const payload = {
    organization_id: inspection.organization_id,
    inspection_id: inspection.id,
    inspection_stage: inspection.inspection_stage,
    source_reception_id: inspection.source_reception_id || null,
    source_process_output_id: inspection.source_process_output_id || null,
    source_processed_lot_id: inspection.source_processed_lot_id || null,
    finished_lot_id: inspection.finished_lot_id || null,
    product_presentation_id: inspection.product_presentation_id || null,
    title,
    defect_detected: defectDetected,
    severity,
    immediate_disposition: immediateDisposition,
    status: finalResult === 'rechazado' ? 'abierta' : 'en_investigacion',
    corrective_action: observaciones || null,
    preventive_action: null,
    created_by: userId,
    updated_at: new Date().toISOString(),
  }

  if (existing.data?.id) {
    const { data, error } = await supabase
      .from('quality_non_conformities')
      .update(payload)
      .eq('id', existing.data.id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await supabase
    .from('quality_non_conformities')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
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

export async function getSpecTemplates(stage = '') {
  const { orgId, userId } = await getAuth()
  await ensureDefaultSpecTemplates(orgId, userId)

  let query = supabase
    .from('quality_spec_templates')
    .select('*')
    .eq('organization_id', orgId)
    .order('inspection_stage', { ascending: true })
    .order('created_at', { ascending: true })

  if (stage) query = query.eq('inspection_stage', stage)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rulesByTemplate = await getRulesByTemplateIds((data || []).map((item) => item.id))
  return (data || []).map((template) => ({
    ...template,
    rules: rulesByTemplate[template.id] || [],
  }))
}

export async function saveSpecTemplate(payload) {
  const { orgId, userId } = await getAuth()
  const clean = {
    organization_id: orgId,
    inspection_stage: payload.inspection_stage,
    name: payload.name?.trim(),
    description: payload.description?.trim() || null,
    is_active: payload.is_active !== false,
    created_by: payload.created_by || userId,
    updated_at: new Date().toISOString(),
  }

  if (!clean.inspection_stage || !clean.name) {
    throw new Error('La etapa y el nombre de la plantilla son obligatorios.')
  }

  if (payload.id) {
    const { data, error } = await supabase
      .from('quality_spec_templates')
      .update(clean)
      .eq('id', payload.id)
      .eq('organization_id', orgId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await supabase
    .from('quality_spec_templates')
    .insert(clean)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function saveSpecRule(templateId, payload) {
  const { orgId } = await getAuth()
  if (!templateId) throw new Error('La plantilla es obligatoria.')
  if (!payload.code?.trim() || !payload.label?.trim()) {
    throw new Error('Código y nombre de criterio son obligatorios.')
  }

  const clean = {
    organization_id: orgId,
    template_id: templateId,
    sort_order: parseInt(payload.sort_order || 0, 10) || 0,
    code: payload.code.trim(),
    label: payload.label.trim(),
    measurement_type: payload.measurement_type,
    unit: payload.unit?.trim() || null,
    min_value: payload.min_value === '' || payload.min_value == null ? null : n(payload.min_value),
    max_value: payload.max_value === '' || payload.max_value == null ? null : n(payload.max_value),
    expected_boolean: payload.expected_boolean == null || payload.expected_boolean === '' ? null : Boolean(payload.expected_boolean),
    allowed_values: payload.allowed_values || [],
    defect_threshold: payload.defect_threshold === '' || payload.defect_threshold == null ? null : parseInt(payload.defect_threshold, 10),
    severity: payload.severity || 'menor',
    decision_effect: payload.decision_effect || 'liberado_con_observacion',
    is_required: payload.is_required !== false,
    updated_at: new Date().toISOString(),
  }

  if (payload.id) {
    const { data, error } = await supabase
      .from('quality_spec_rules')
      .update(clean)
      .eq('id', payload.id)
      .eq('organization_id', orgId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return normalizeRule(data)
  }

  const { data, error } = await supabase
    .from('quality_spec_rules')
    .insert(clean)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return normalizeRule(data)
}

export async function getInspectionSources() {
  const { orgId } = await getAuth()
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10)

  const [receptionsRes, outputsRes, processedLotsRes, finishedLotsRes] = await Promise.all([
    supabase
      .from('material_receptions')
      .select(`
        *,
        suppliers(id, name),
        materials(id, code, common_name)
      `)
      .eq('organization_id', orgId)
      .gte('received_date', since)
      .order('received_date', { ascending: false })
      .limit(60),
    supabase
      .from('material_process_stage_outputs')
      .select(`
        *,
        materials(id, code, common_name),
        material_process_runs!process_run_id(id, process_date, source_internal_lot)
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('processed_inventory_lots')
      .select(`
        *,
        materials(id, code, common_name)
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('finished_inventory_lots')
      .select(`
        *,
        product_presentations(id, code, display_name)
      `)
      .eq('organization_id', orgId)
      .gte('production_date', since)
      .order('production_date', { ascending: false })
      .limit(60),
  ])

  if (receptionsRes.error) throw new Error(receptionsRes.error.message)
  if (outputsRes.error) throw new Error(outputsRes.error.message)
  if (processedLotsRes.error) throw new Error(processedLotsRes.error.message)
  if (finishedLotsRes.error) throw new Error(finishedLotsRes.error.message)

  return {
    today,
    receptions: receptionsRes.data || [],
    processOutputs: outputsRes.data || [],
    processedLots: processedLotsRes.data || [],
    finishedLots: finishedLotsRes.data || [],
  }
}

export async function getInspecciones(filtros = {}) {
  const { orgId, userId } = await getAuth()
  await ensureDefaultSpecTemplates(orgId, userId)

  let query = supabase
    .from('inspecciones_calidad')
    .select('*')
    .eq('organization_id', orgId)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })

  if (filtros.fecha) query = query.eq('fecha', filtros.fecha)
  if (filtros.status) query = query.eq('status', filtros.status)
  if (filtros.resultado) query = query.eq('resultado', filtros.resultado)
  if (filtros.inspection_stage) query = query.eq('inspection_stage', filtros.inspection_stage)
  if (filtros.desde) query = query.gte('fecha', filtros.desde)
  if (filtros.hasta) query = query.lte('fecha', filtros.hasta)
  if (filtros.limit) query = query.limit(filtros.limit)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return hydrateInspecciones(data || [], orgId)
}

export async function createInspeccion(payload) {
  const { orgId, userId } = await getAuth()
  await ensureDefaultSpecTemplates(orgId, userId)

  const stage = payload.inspection_stage || 'empaque_final'
  const template = payload.spec_template_id
    ? { id: payload.spec_template_id }
    : await getTemplateForStage(orgId, stage)

  if (!template?.id) {
    throw new Error('No hay plantilla activa para esta etapa de calidad.')
  }

  let productPresentationId = payload.product_presentation_id || null
  if (payload.finished_lot_id && !productPresentationId) {
    const { data: lot, error: lotError } = await supabase
      .from('finished_inventory_lots')
      .select('product_presentation_id')
      .eq('id', payload.finished_lot_id)
      .maybeSingle()
    if (lotError) throw new Error(lotError.message)
    productPresentationId = lot?.product_presentation_id || null
  }

  const insertPayload = {
    organization_id: orgId,
    fecha: payload.fecha || new Date().toISOString().slice(0, 10),
    inspection_stage: stage,
    spec_template_id: template.id,
    product_presentation_id: productPresentationId,
    finished_lot_id: payload.finished_lot_id || null,
    source_reception_id: payload.source_reception_id || null,
    source_process_output_id: payload.source_process_output_id || null,
    source_processed_lot_id: payload.source_processed_lot_id || null,
    origen: payload.origen || 'manual',
    tamano_muestra: parseInt(payload.tamano_muestra || 5, 10),
    status: payload.status || 'pendiente',
    probabilidad_usada: payload.probabilidad_usada ?? null,
    score_riesgo_usado: payload.score_riesgo_usado ?? null,
    observaciones: payload.observaciones?.trim() || null,
    created_by: userId,
  }

  const { data, error } = await supabase
    .from('inspecciones_calidad')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  const [hydrated] = await getInspecciones({ limit: 1, fecha: insertPayload.fecha })
  const inspection = hydrated?.id === data.id
    ? hydrated
    : (await hydrateInspecciones([{ ...insertPayload, id: data.id }], orgId))[0]
  return inspection
}

export async function completarInspeccion(id, resultado) {
  const { orgId, userId } = await getAuth()
  const inspections = await getInspecciones({ limit: 200 })
  const inspection = inspections.find((item) => item.id === id)
  if (!inspection) throw new Error('No se encontró la inspección.')

  const rules = inspection.spec_rules || []
  const rawMeasurements = resultado.measurements || []
  const measurements = rules.map((rule) => {
    const existing = rawMeasurements.find((item) => item.spec_rule_id === rule.id)
    return evaluateMeasurement(rule, existing || {})
  })

  const defectos = (resultado.defectos || []).map((item) => ({
    ...item,
    cantidad: parseInt(item.cantidad || 0, 10) || 0,
    nivel: item.nivel || 'menor',
    tipo_defecto: item.tipo_defecto?.trim() || '',
  })).filter((item) => item.tipo_defecto && item.cantidad > 0)

  const autoDecision = buildAutoDecision({ rules, measurements, defectos })
  const finalResult = resultado.resultado || autoDecision.resultado_automatico || 'liberado'

  if (resultRank(finalResult) < resultRank(autoDecision.resultado_automatico) && !resultado.override_reason?.trim()) {
    throw new Error('No puedes suavizar el resultado automático sin justificación.')
  }

  const unidadesInspeccionadas = parseInt(resultado.unidades_inspeccionadas || inspection.tamano_muestra || 0, 10) || 0
  const unidadesDefectuosas = parseInt(resultado.unidades_defectuosas || defectos.reduce((sum, item) => sum + n(item.cantidad), 0), 10) || 0
  const tasa = unidadesInspeccionadas > 0
    ? Math.round((unidadesDefectuosas / unidadesInspeccionadas) * 10000) / 100
    : 0

  const { data, error } = await supabase
    .from('inspecciones_calidad')
    .update({
      resultado: finalResult,
      resultado_sugerido: autoDecision.resultado_sugerido,
      resultado_automatico: autoDecision.resultado_automatico,
      override_reason: resultRank(finalResult) < resultRank(autoDecision.resultado_automatico)
        ? resultado.override_reason?.trim() || null
        : null,
      override_by: resultRank(finalResult) < resultRank(autoDecision.resultado_automatico) ? userId : null,
      unidades_inspeccionadas: unidadesInspeccionadas,
      unidades_defectuosas: unidadesDefectuosas,
      tasa_defectos: tasa,
      observaciones: resultado.observaciones?.trim() || null,
      status: 'completada',
      inspeccionado_por: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single()

  if (error) throw new Error(error.message)

  const deleteMeasurements = await supabase
    .from('quality_inspection_measurements')
    .delete()
    .eq('inspection_id', id)
  if (deleteMeasurements.error) throw new Error(deleteMeasurements.error.message)

  if (measurements.length) {
    const { error: measurementError } = await supabase
      .from('quality_inspection_measurements')
      .insert(
        measurements.map((item) => ({
          organization_id: orgId,
          inspection_id: id,
          spec_rule_id: item.spec_rule_id,
          rule_snapshot: item.rule_snapshot,
          actual_numeric: item.actual_numeric,
          actual_boolean: item.actual_boolean,
          actual_text: item.actual_text,
          actual_count: item.actual_count,
          pass: item.pass,
          triggered_result: item.decision_effect,
          notes: item.notes,
        }))
      )
    if (measurementError) throw new Error(measurementError.message)
  }

  const deleteDefects = await supabase
    .from('defectos_inspeccion')
    .delete()
    .eq('inspeccion_id', id)
  if (deleteDefects.error) throw new Error(deleteDefects.error.message)

  if (defectos.length) {
    const { error: defectError } = await supabase
      .from('defectos_inspeccion')
      .insert(defectos.map((item) => ({ ...item, inspeccion_id: id })))
    if (defectError) throw new Error(defectError.message)
  }

  const fullInspection = {
    ...inspection,
    ...data,
  }

  if (['retenido', 'rechazado'].includes(finalResult)) {
    await applyQualityBlock(fullInspection, `Inspección ${finalResult}: ${resultado.observaciones || ''}`.trim())
  }

  await upsertNonConformity({
    inspection: fullInspection,
    finalResult,
    autoDecision,
    defectos,
    observaciones: resultado.observaciones,
    userId,
  })

  const [hydrated] = await hydrateInspecciones([data], orgId)
  return hydrated
}

export async function liberarLote(inspeccionId, _lotId = null, options = {}) {
  const { orgId } = await getAuth()
  const { data, error } = await supabase
    .from('inspecciones_calidad')
    .select('*')
    .eq('id', inspeccionId)
    .eq('organization_id', orgId)
    .single()

  if (error) throw new Error(error.message)
  if (!options.reason?.trim()) throw new Error('Debes indicar el motivo de liberación manual.')

  await clearQualityBlock(data, options.reason)
  return true
}

export async function cancelarInspeccion(id) {
  const { error } = await supabase
    .from('inspecciones_calidad')
    .update({ status: 'cancelada', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getNonConformities(filters = {}) {
  const { orgId } = await getAuth()
  let query = supabase
    .from('quality_non_conformities')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.inspection_stage) query = query.eq('inspection_stage', filters.inspection_stage)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rows = data || []
  if (!rows.length) return []

  const inspectionIds = uniq(rows.map((item) => item.inspection_id))
  const responsibleIds = uniq(rows.map((item) => item.responsible_user_id))
  const actionNcIds = rows.map((item) => item.id)

  const [inspections, profilesRes, actionsRes] = await Promise.all([
    inspectionIds.length ? getInspecciones({ limit: 500 }) : Promise.resolve([]),
    responsibleIds.length
      ? supabase.from('profiles').select('id, full_name, email').in('id', responsibleIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('quality_corrective_actions').select('*').in('non_conformity_id', actionNcIds),
  ])

  if (profilesRes.error) throw new Error(profilesRes.error.message)
  if (actionsRes.error) throw new Error(actionsRes.error.message)

  const inspectionMap = Object.fromEntries((inspections || []).map((item) => [item.id, item]))
  const profileMap = Object.fromEntries((profilesRes.data || []).map((item) => [item.id, item]))
  const actionsByNc = {}
  for (const item of actionsRes.data || []) {
    if (!actionsByNc[item.non_conformity_id]) actionsByNc[item.non_conformity_id] = []
    actionsByNc[item.non_conformity_id].push(item)
  }

  return rows.map((item) => ({
    ...item,
    status: getNonConformityStatus(item),
    inspection: item.inspection_id ? inspectionMap[item.inspection_id] || null : null,
    responsible: item.responsible_user_id ? profileMap[item.responsible_user_id] || null : null,
    actions: actionsByNc[item.id] || [],
  }))
}

export async function updateNonConformity(id, payload) {
  const { orgId, userId } = await getAuth()
  const clean = {
    title: payload.title?.trim() || undefined,
    defect_detected: payload.defect_detected?.trim() || undefined,
    severity: payload.severity || undefined,
    immediate_disposition: payload.immediate_disposition || undefined,
    status: payload.status || undefined,
    root_cause: payload.root_cause?.trim() || null,
    corrective_action: payload.corrective_action?.trim() || null,
    preventive_action: payload.preventive_action?.trim() || null,
    responsible_user_id: payload.responsible_user_id || null,
    due_date: payload.due_date || null,
    closed_at: payload.status === 'cerrada' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('quality_non_conformities')
    .update(clean)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single()
  if (error) throw new Error(error.message)

  const actionPayload = []
  if (payload.corrective_action?.trim()) {
    actionPayload.push({
      organization_id: orgId,
      non_conformity_id: id,
      action_type: 'correctiva',
      description: payload.corrective_action.trim(),
      responsible_user_id: payload.responsible_user_id || null,
      due_date: payload.due_date || null,
      status: payload.status === 'cerrada' ? 'completada' : 'en_curso',
      completed_at: payload.status === 'cerrada' ? new Date().toISOString() : null,
      created_by: userId,
    })
  }
  if (payload.preventive_action?.trim()) {
    actionPayload.push({
      organization_id: orgId,
      non_conformity_id: id,
      action_type: 'preventiva',
      description: payload.preventive_action.trim(),
      responsible_user_id: payload.responsible_user_id || null,
      due_date: payload.due_date || null,
      status: payload.status === 'cerrada' ? 'completada' : 'en_curso',
      completed_at: payload.status === 'cerrada' ? new Date().toISOString() : null,
      created_by: userId,
    })
  }

  if (actionPayload.length) {
    const { error: actionError } = await supabase
      .from('quality_corrective_actions')
      .insert(actionPayload)
    if (actionError) throw new Error(actionError.message)
  }

  return data
}

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

  const runs = runsRes.data || []
  const lots = lotsRes.data || []

  const lotsBySkuId = {}
  for (const lot of lots) {
    if (!lotsBySkuId[lot.product_presentation_id]) lotsBySkuId[lot.product_presentation_id] = []
    lotsBySkuId[lot.product_presentation_id].push(lot)
  }

  const bySkuId = {}
  for (const run of runs) {
    const skuId = run.product_presentation_id
    if (!bySkuId[skuId]) {
      bySkuId[skuId] = {
        product_presentation_id: skuId,
        sku: run.product_presentations,
        libras_total: 0,
        lotes: lotsBySkuId[skuId] || [],
      }
    }
    bySkuId[skuId].libras_total += n(run.packed_weight_lb)
  }

  return Object.values(bySkuId)
}

export async function getDashboardCalidad() {
  const { orgId } = await getAuth()
  const hoy = new Date().toISOString().slice(0, 10)
  const hace30d = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)

  const [
    inspections,
    riesgoRes,
    rawBlocksRes,
    outputBlocksRes,
    processedBlocksRes,
    finishedBlocksRes,
    ncRows,
  ] = await Promise.all([
    getInspecciones({ desde: hace30d, hasta: hoy, limit: 500 }),
    supabase
      .from('sku_riesgo_calculado')
      .select('*, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .eq('fecha', hoy)
      .order('probabilidad_final', { ascending: false })
      .limit(15),
    supabase
      .from('material_inventory_lots')
      .select('id, internal_lot, motivo_bloqueo_calidad, materials(code, common_name)')
      .eq('organization_id', orgId)
      .eq('bloqueado_calidad', true),
    supabase
      .from('material_process_stage_outputs')
      .select('id, output_lot_code, motivo_bloqueo_calidad, materials(code, common_name), stage')
      .eq('organization_id', orgId)
      .eq('bloqueado_calidad', true),
    supabase
      .from('processed_inventory_lots')
      .select('id, internal_lot, motivo_bloqueo_calidad, materials(code, common_name)')
      .eq('organization_id', orgId)
      .eq('bloqueado_calidad', true),
    supabase
      .from('finished_inventory_lots')
      .select('id, finished_lot_code, motivo_bloqueo_calidad, product_presentations(code, display_name)')
      .eq('organization_id', orgId)
      .eq('bloqueado_calidad', true),
    getNonConformities(),
  ])

  if (riesgoRes.error) throw new Error(riesgoRes.error.message)
  if (rawBlocksRes.error) throw new Error(rawBlocksRes.error.message)
  if (outputBlocksRes.error) throw new Error(outputBlocksRes.error.message)
  if (processedBlocksRes.error) throw new Error(processedBlocksRes.error.message)
  if (finishedBlocksRes.error) throw new Error(finishedBlocksRes.error.message)

  const hoyData = inspections.filter((item) => item.fecha === hoy)
  const hist30 = inspections.filter((item) => item.status === 'completada')
  const riesgoData = riesgoRes.data || []

  const pendientesHoy = hoyData.filter((item) => item.status === 'pendiente').length
  const completadasHoy = hoyData.filter((item) => item.status === 'completada').length
  const rechazadasHoy = hoyData.filter((item) => item.resultado === 'rechazado').length

  const completadas30 = hist30.length
  const rechazadas30 = hist30.filter((item) => item.resultado === 'rechazado').length
  const retenidas30 = hist30.filter((item) => item.resultado === 'retenido').length
  const tasaRechazo30 = completadas30 > 0 ? Math.round((rechazadas30 / completadas30) * 1000) / 10 : 0

  const byStage = QUALITY_STAGES.map((stage) => {
    const stageRows = hist30.filter((item) => item.inspection_stage === stage.key)
    const total = stageRows.length
    const rechazados = stageRows.filter((item) => item.resultado === 'rechazado').length
    const retenidos = stageRows.filter((item) => item.resultado === 'retenido').length
    return {
      key: stage.key,
      label: stage.label,
      total,
      rechazados,
      retenidos,
      tasa_rechazo: total > 0 ? Math.round((rechazados / total) * 1000) / 10 : 0,
    }
  })

  const topDefectsMap = {}
  for (const inspection of hist30) {
    for (const defect of inspection.defectos_inspeccion || []) {
      const key = defect.tipo_defecto || 'Sin clasificar'
      if (!topDefectsMap[key]) {
        topDefectsMap[key] = {
          tipo_defecto: key,
          total: 0,
          max_severity: defect.nivel || 'menor',
        }
      }
      topDefectsMap[key].total += n(defect.cantidad)
      if (severityRank(defect.nivel) > severityRank(topDefectsMap[key].max_severity)) {
        topDefectsMap[key].max_severity = defect.nivel
      }
    }
  }

  const topDefects = Object.values(topDefectsMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  const mapaHist = {}
  for (const inspection of hist30) {
    if (!mapaHist[inspection.fecha]) {
      mapaHist[inspection.fecha] = { fecha: inspection.fecha, total: 0, rechazados: 0, retenidos: 0, observaciones: 0 }
    }
    mapaHist[inspection.fecha].total += 1
    if (inspection.resultado === 'rechazado') mapaHist[inspection.fecha].rechazados += 1
    if (inspection.resultado === 'retenido') mapaHist[inspection.fecha].retenidos += 1
    if (inspection.resultado === 'liberado_con_observacion') mapaHist[inspection.fecha].observaciones += 1
  }

  const trend = []
  for (let i = 13; i >= 0; i -= 1) {
    const fecha = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    trend.push(mapaHist[fecha] || { fecha, total: 0, rechazados: 0, retenidos: 0, observaciones: 0 })
  }

  const config = await getConfiguracion()
  const enVigilancia = riesgoData.filter((item) => n(item.probabilidad_final) >= n(config.umbral_vigilancia))

  const blockedCostEstimate =
    (rawBlocksRes.data || []).length +
    (outputBlocksRes.data || []).length +
    (processedBlocksRes.data || []).length +
    (finishedBlocksRes.data || []).length

  const openNcs = ncRows.filter((item) => item.status !== 'cerrada')
  const overdueNcs = openNcs.filter((item) => item.status === 'vencida')
  const closedNcs = ncRows.filter((item) => item.status === 'cerrada' && item.closed_at)
  const avgCloseHours = closedNcs.length
    ? Math.round(
        closedNcs.reduce((sum, item) => {
          const start = new Date(item.created_at).getTime()
          const end = new Date(item.closed_at).getTime()
          return sum + Math.max(0, (end - start) / 3600000)
        }, 0) / closedNcs.length
      )
    : 0

  return {
    hoy: { pendientes: pendientesHoy, completadas: completadasHoy, rechazadas: rechazadasHoy, total: hoyData.length },
    stats30: { total: completadas30, rechazadas: rechazadas30, retenidas: retenidas30, tasaRechazo: tasaRechazo30 },
    byStage,
    trend,
    topDefects,
    riesgoRanking: riesgoData,
    enVigilancia,
    lotesBlockeados: {
      recepcion: rawBlocksRes.data || [],
      proceso: [...(outputBlocksRes.data || []), ...(processedBlocksRes.data || [])],
      empaque: finishedBlocksRes.data || [],
    },
    nonConformities: {
      abiertas: openNcs.length,
      vencidas: overdueNcs.length,
      tiempoPromedioCierreHoras: avgCloseHours,
    },
    costEstimate: blockedCostEstimate,
    histReciente: hist30.slice(0, 12),
    umbralVigilancia: n(config.umbral_vigilancia),
  }
}
