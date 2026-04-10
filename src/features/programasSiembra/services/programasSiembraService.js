import { supabase } from '../../../lib/supabase'
import { createMaterial } from '../../materials/services/materialsService'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function round4(value) {
  return Math.round(n(value) * 10000) / 10000
}

function convertVolumeToOunces(volume, unit) {
  const normalized = String(unit || 'lb').trim().toLowerCase()
  const amount = n(volume)
  if (['oz', 'onza', 'onzas'].includes(normalized)) return amount
  if (['lb', 'lbs', 'libra', 'libras'].includes(normalized)) return amount * 16
  if (['kg', 'kgs', 'kilogramo', 'kilogramos'].includes(normalized)) return amount * 35.27396195
  if (['g', 'gr', 'gramo', 'gramos'].includes(normalized)) return amount * 0.0352739619
  return amount * 16
}

function ceil(value) {
  return Math.ceil(n(value))
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  return new Date(`${value}T00:00:00`).toISOString().slice(0, 10)
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function startOfWeek(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`)
  const day = date.getDay()
  const shift = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + shift)
  return date.toISOString().slice(0, 10)
}

function endOfWeek(dateStr) {
  return addDays(startOfWeek(dateStr), 6)
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function similarityScore(a, b) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.92
  const wa = new Set(na.split(' '))
  const wb = new Set(nb.split(' '))
  const inter = [...wa].filter((word) => wb.has(word)).length
  const union = new Set([...wa, ...wb]).size
  return union > 0 ? inter / union : 0
}

async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) throw new Error('No se pudo obtener el usuario autenticado')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id, full_name')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  if (!data?.organization_id) throw new Error('El usuario no tiene organización asignada')
  return data
}

export function calculateLineMetrics(line, projectRange = null) {
  const expectedVolume = n(line.expected_volume)
  const averageWeight = n(line.average_weight_per_plant)
  const expectedVolumeOz = convertVolumeToOunces(expectedVolume, line.unit)
  const germination = n(line.germination_rate) || 0
  const survival = n(line.survival_rate) || 0
  const waste = n(line.waste_rate)
  const rejection = n(line.rejection_rate)
  const cellsPerTray = Math.max(1, n(line.cells_per_tray))
  const startDate = projectRange?.start_date || line.project_start_date || line.first_harvest_target_date
  const endDate = projectRange?.end_date || line.project_end_date || line.first_harvest_target_date
  const frequency = line.delivery_frequency || 'semanal'

  const plantsHarvestable = averageWeight > 0 ? expectedVolumeOz / averageWeight : 0
  const denominator = germination * survival * (1 - waste) * (1 - rejection)
  const plantsToSowTotal = denominator > 0 ? plantsHarvestable / denominator : 0
  const traysRequiredTotal = ceil(plantsToSowTotal / cellsPerTray)
  const seedDate = addDays(line.first_harvest_target_date, -Math.max(1, n(line.days_to_harvest)))

  const harvestDates = []
  let cursor = toIsoDate(line.first_harvest_target_date)
  const safeEnd = toIsoDate(endDate)
  while (cursor <= safeEnd) {
    harvestDates.push(cursor)
    if (frequency === 'diaria') cursor = addDays(cursor, 1)
    else if (frequency === 'quincenal') cursor = addDays(cursor, 14)
    else if (frequency === 'mensual') {
      const next = new Date(`${cursor}T00:00:00`)
      next.setMonth(next.getMonth() + 1)
      cursor = next.toISOString().slice(0, 10)
    } else if (frequency === 'unica') {
      break
    } else {
      cursor = addDays(cursor, 7)
    }
    if (harvestDates.length > 260) break
  }
  if (!harvestDates.length) harvestDates.push(toIsoDate(line.first_harvest_target_date || startDate))

  const volumePerOccurrence = expectedVolume / Math.max(1, harvestDates.length)
  const harvestablePerOccurrence = plantsHarvestable / Math.max(1, harvestDates.length)
  const sowPerOccurrence = plantsToSowTotal / Math.max(1, harvestDates.length)

  const weeklyPlans = harvestDates.map((harvestDate) => {
    const suggestedSeedDate = addDays(harvestDate, -Math.max(1, n(line.days_to_harvest)))
    return {
      week_start: startOfWeek(suggestedSeedDate),
      week_end: endOfWeek(suggestedSeedDate),
      harvest_date: harvestDate,
      seed_date: suggestedSeedDate,
      expected_volume: round4(volumePerOccurrence),
      harvestable_plants_required: round4(harvestablePerOccurrence),
      plants_to_sow: round4(sowPerOccurrence),
      seeds_required: round4(sowPerOccurrence),
      trays_required: ceil(sowPerOccurrence / cellsPerTray),
      status: 'planificado',
    }
  })

  return {
    plants_harvestable_required: round4(plantsHarvestable),
    plants_to_sow_total: round4(plantsToSowTotal),
    seeds_required_total: round4(plantsToSowTotal),
    trays_required_total: traysRequiredTotal,
    suggested_seed_date: seedDate,
    estimated_harvest_date: toIsoDate(line.first_harvest_target_date),
    weekly_plans: weeklyPlans,
  }
}

function buildSupplyRequirements(line, metrics, availabilityMap) {
  const lineName = line.materials?.common_name || line.proposed_name || line.proposed_material_name || 'Materia prima'
  const availableSeed = line.material_id ? n(availabilityMap.get(line.material_id)) : 0
  const traysMaterialId = null
  const trayAvailability = traysMaterialId ? n(availabilityMap.get(traysMaterialId)) : 0
  const substrateQty = round4(metrics.trays_required_total * 1)
  const fertilizerQty = round4(n(line.expected_volume) * 0.02)
  const packagingQty = round4(n(line.expected_volume))

  return [
    {
      requirement_type: 'semilla',
      material_id: line.material_id || null,
      requirement_name: `Semilla ${lineName}`,
      quantity_required: metrics.seeds_required_total,
      quantity_available: availableSeed,
      shortage_quantity: Math.max(0, metrics.seeds_required_total - availableSeed),
      unit: 'semillas',
      notes: 'Calculado desde plantas a sembrar.',
    },
    {
      requirement_type: 'bandeja',
      material_id: traysMaterialId,
      requirement_name: 'Bandejas de germinación',
      quantity_required: metrics.trays_required_total,
      quantity_available: trayAvailability,
      shortage_quantity: Math.max(0, metrics.trays_required_total - trayAvailability),
      unit: 'bandejas',
      notes: `Basado en ${Math.max(1, n(line.cells_per_tray))} celdas por bandeja.`,
    },
    {
      requirement_type: 'sustrato',
      material_id: null,
      requirement_name: 'Sustrato / esponja / plugs',
      quantity_required: substrateQty,
      quantity_available: 0,
      shortage_quantity: substrateQty,
      unit: 'kit',
      notes: 'Estimación inicial de un kit por bandeja.',
    },
    {
      requirement_type: 'fertilizante',
      material_id: null,
      requirement_name: 'Fertilizantes estimados',
      quantity_required: fertilizerQty,
      quantity_available: 0,
      shortage_quantity: fertilizerQty,
      unit: line.unit || 'lb',
      notes: 'Estimación base equivalente al 2% del volumen esperado.',
    },
    {
      requirement_type: 'empaque',
      material_id: null,
      requirement_name: 'Empaque comercial',
      quantity_required: packagingQty,
      quantity_available: 0,
      shortage_quantity: packagingQty,
      unit: line.unit || 'lb',
      notes: 'Estimación inicial del volumen cosechable.',
    },
  ]
}

function computeProjectSummary(detail) {
  const lines = detail.lines || []
  const weekly = detail.weeklyPlans || []
  const supplies = detail.supplyRequirements || []
  return {
    total_lines: lines.length,
    total_expected_volume: round4(lines.reduce((acc, row) => acc + n(row.expected_volume), 0)),
    total_harvestable_plants: round4(lines.reduce((acc, row) => acc + n(row.metrics?.plants_harvestable_required), 0)),
    total_plants_to_sow: round4(lines.reduce((acc, row) => acc + n(row.metrics?.plants_to_sow_total), 0)),
    total_seeds_required: round4(lines.reduce((acc, row) => acc + n(row.metrics?.seeds_required_total), 0)),
    total_trays_required: lines.reduce((acc, row) => acc + n(row.metrics?.trays_required_total), 0),
    proposed_materials_count: (detail.proposedMaterials || []).filter((row) => row.status === 'pendiente_aprobacion').length,
    weekly_rows: weekly.length,
    shortage_requirements: supplies.filter((row) => n(row.shortage_quantity) > 0).length,
  }
}

async function getMaterialAvailability(profile, materialIds) {
  const cleanIds = [...new Set((materialIds || []).filter(Boolean))]
  if (!cleanIds.length) return new Map()
  const { data, error } = await supabase
    .from('material_inventory_lots')
    .select('material_id, available_quantity')
    .eq('organization_id', profile.organization_id)
    .in('material_id', cleanIds)

  if (error) throw new Error(error.message)

  const map = new Map()
  ;(data || []).forEach((row) => {
    map.set(row.material_id, round4(n(map.get(row.material_id)) + n(row.available_quantity)))
  })
  return map
}

async function rebuildDerivedTables(profile, project, lines) {
  await supabase.from('planting_project_weekly_plans').delete().eq('project_id', project.id)
  await supabase.from('planting_project_supply_requirements').delete().eq('project_id', project.id)

  const availabilityMap = await getMaterialAvailability(profile, lines.map((row) => row.material_id))
  const weeklyRows = []
  const supplyRows = []
  const enrichedLines = lines.map((line) => {
    const metrics = calculateLineMetrics(
      {
        ...line,
        project_start_date: project.start_date,
        project_end_date: project.end_date,
      },
      project,
    )
    metrics.weekly_plans.forEach((week) => {
      weeklyRows.push({
        organization_id: profile.organization_id,
        project_id: project.id,
        project_line_id: line.id,
        ...week,
      })
    })

    buildSupplyRequirements(line, metrics, availabilityMap).forEach((requirement) => {
      supplyRows.push({
        organization_id: profile.organization_id,
        project_id: project.id,
        project_line_id: line.id,
        ...requirement,
      })
    })

    return { ...line, metrics }
  })

  if (weeklyRows.length) {
    const { error } = await supabase.from('planting_project_weekly_plans').insert(weeklyRows)
    if (error) throw new Error(error.message)
  }

  if (supplyRows.length) {
    const { error } = await supabase.from('planting_project_supply_requirements').insert(supplyRows)
    if (error) throw new Error(error.message)
  }

  return { lines: enrichedLines, weeklyRows, supplyRows }
}

async function appendAuditLog(profile, projectId, eventType, eventNotes, oldValues = {}, newValues = {}) {
  const { error } = await supabase.from('planting_project_audit_logs').insert({
    organization_id: profile.organization_id,
    project_id: projectId,
    event_type: eventType,
    event_notes: eventNotes || null,
    old_values: oldValues,
    new_values: newValues,
    created_by: profile.id,
  })
  if (error) throw new Error(error.message)
}

function normalizeProjectPayload(payload) {
  const lines = (payload.lines || [])
    .map((row, index) => ({
      ...row,
      line_no: index + 1,
      expected_volume: round4(row.expected_volume),
      average_weight_per_plant: round4(row.average_weight_per_plant),
      germination_rate: n(row.germination_rate),
      survival_rate: n(row.survival_rate),
      waste_rate: n(row.waste_rate),
      rejection_rate: n(row.rejection_rate),
      days_to_harvest: Math.max(1, Math.round(n(row.days_to_harvest))),
      cells_per_tray: Math.max(1, Math.round(n(row.cells_per_tray))),
      material_id: row.material_id || null,
      proposed_material_name: (row.proposed_material_name || '').trim(),
    }))
    .filter((row) => row.material_id || row.proposed_material_name)

  return {
    ...payload,
    project_name: String(payload.project_name || '').trim(),
    production_unit: String(payload.production_unit || '').trim(),
    location: String(payload.location || '').trim(),
    commercial_channel: String(payload.commercial_channel || '').trim(),
    notes: String(payload.notes || '').trim(),
    start_date: toIsoDate(payload.start_date),
    end_date: toIsoDate(payload.end_date),
    lines,
  }
}

export function suggestSimilarMaterials(name, materials) {
  const target = String(name || '').trim()
  if (!target) return []
  return (materials || [])
    .map((row) => ({
      ...row,
      similarity: similarityScore(target, row.common_name),
    }))
    .filter((row) => row.similarity >= 0.45)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
}

export async function getNextPlantingProjectCode() {
  const profile = await getProfile()
  const prefix = 'PSI'
  const { data, error } = await supabase
    .from('planting_projects')
    .select('project_code')
    .eq('organization_id', profile.organization_id)
    .ilike('project_code', `${prefix}-%`)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  const used = new Set((data || []).map((row) => String(row.project_code || '').trim().toUpperCase()))
  for (let index = 1; index <= 99999; index += 1) {
    const candidate = `${prefix}-${String(index).padStart(4, '0')}`
    if (!used.has(candidate)) return candidate
  }
  throw new Error('No se pudo generar el código del proyecto de siembra')
}

export async function getPlantingProjectCatalogs() {
  const profile = await getProfile()
  const [clientsRes, materialsRes, agronomicRes] = await Promise.all([
    supabase
      .from('clients')
      .select('id, commercial_name, channel')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('commercial_name'),
    supabase
      .from('materials')
      .select('id, code, common_name, category, base_unit, status')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('common_name'),
    supabase
      .from('material_agronomic_profiles')
      .select('*')
      .eq('organization_id', profile.organization_id),
  ])

  if (clientsRes.error) throw new Error(clientsRes.error.message)
  if (materialsRes.error) throw new Error(materialsRes.error.message)
  if (agronomicRes.error) throw new Error(agronomicRes.error.message)

  const agronomicMap = new Map((agronomicRes.data || []).map((row) => [row.material_id, row]))
  const materials = (materialsRes.data || []).map((row) => ({
    ...row,
    agronomic_profile: agronomicMap.get(row.id) || null,
  }))

  return {
    clients: clientsRes.data || [],
    materials,
  }
}

export async function getPlantingProjects(filters = {}) {
  const profile = await getProfile()
  let query = supabase
    .from('planting_projects')
    .select(`
      *,
      clients ( id, commercial_name, channel )
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.clientId) query = query.eq('client_id', filters.clientId)
  if (filters.search) query = query.or(`project_code.ilike.%${filters.search}%,project_name.ilike.%${filters.search}%`)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const projectIds = (data || []).map((row) => row.id)
  const [linesRes, proposalsRes] = await Promise.all([
    projectIds.length
      ? supabase.from('planting_project_lines').select('project_id, expected_volume').in('project_id', projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from('planting_project_proposed_materials').select('project_id, status').in('project_id', projectIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (linesRes.error) throw new Error(linesRes.error.message)
  if (proposalsRes.error) throw new Error(proposalsRes.error.message)

  const lineMap = new Map()
  ;(linesRes.data || []).forEach((row) => {
    const base = lineMap.get(row.project_id) || { total_volume: 0, total_lines: 0 }
    base.total_volume += n(row.expected_volume)
    base.total_lines += 1
    lineMap.set(row.project_id, base)
  })

  const proposalMap = new Map()
  ;(proposalsRes.data || []).forEach((row) => {
    const base = proposalMap.get(row.project_id) || { pending: 0, approved: 0 }
    if (row.status === 'pendiente_aprobacion') base.pending += 1
    if (row.status === 'aprobada' || row.status === 'fusionada') base.approved += 1
    proposalMap.set(row.project_id, base)
  })

  return (data || []).map((row) => ({
    ...row,
    total_expected_volume: round4(lineMap.get(row.id)?.total_volume || 0),
    total_lines: lineMap.get(row.id)?.total_lines || 0,
    proposed_pending_count: proposalMap.get(row.id)?.pending || 0,
  }))
}

export async function getPlantingProjectsDashboard() {
  const projects = await getPlantingProjects()
  const profile = await getProfile()
  const projectIds = projects.map((row) => row.id)
  const [weeklyRes, supplyRes, proposalsRes] = await Promise.all([
    projectIds.length
      ? supabase
          .from('planting_project_weekly_plans')
          .select('project_id, plants_to_sow, seeds_required, trays_required')
          .in('project_id', projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase
          .from('planting_project_supply_requirements')
          .select('project_id, shortage_quantity')
          .in('project_id', projectIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('planting_project_proposed_materials')
      .select('status')
      .eq('organization_id', profile.organization_id),
  ])

  if (weeklyRes.error) throw new Error(weeklyRes.error.message)
  if (supplyRes.error) throw new Error(supplyRes.error.message)
  if (proposalsRes.error) throw new Error(proposalsRes.error.message)

  return {
    total_projects: projects.length,
    approved_projects: projects.filter((row) => ['aprobado', 'en_ejecucion'].includes(row.status)).length,
    pending_projects: projects.filter((row) => ['borrador', 'pendiente_aprobacion'].includes(row.status)).length,
    proposed_materials: (proposalsRes.data || []).filter((row) => row.status === 'pendiente_aprobacion').length,
    created_from_projects: (proposalsRes.data || []).filter((row) => row.status === 'aprobada' || row.status === 'fusionada').length,
    plants_planned: round4((weeklyRes.data || []).reduce((acc, row) => acc + n(row.plants_to_sow), 0)),
    seeds_required: round4((weeklyRes.data || []).reduce((acc, row) => acc + n(row.seeds_required), 0)),
    trays_required: (weeklyRes.data || []).reduce((acc, row) => acc + n(row.trays_required), 0),
    shortage_requirements: (supplyRes.data || []).filter((row) => n(row.shortage_quantity) > 0).length,
    projects,
  }
}

export async function getPlantingProjectDetail(projectId) {
  const profile = await getProfile()
  const { data: project, error: projectError } = await supabase
    .from('planting_projects')
    .select(`
      *,
      clients ( id, commercial_name, channel ),
      creator:profiles!planting_projects_created_by_fkey ( id, full_name ),
      approver:profiles!planting_projects_approved_by_fkey ( id, full_name )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('id', projectId)
    .single()

  if (projectError) throw new Error(projectError.message)

  const [linesRes, proposalsRes, weeklyRes, supplyRes, auditRes, agronomicRes] = await Promise.all([
    supabase
      .from('planting_project_lines')
      .select(`
        *,
        materials ( id, code, common_name, base_unit )
      `)
      .eq('project_id', projectId)
      .order('line_no'),
    supabase
      .from('planting_project_proposed_materials')
      .select(`
        *,
        suggested_material:materials!planting_project_proposed_materials_suggested_material_id_fkey ( id, code, common_name ),
        approved_material:materials!planting_project_proposed_materials_approved_material_id_fkey ( id, code, common_name ),
        creator:profiles!planting_project_proposed_materials_created_by_fkey ( id, full_name )
      `)
      .eq('project_id', projectId)
      .order('created_at'),
    supabase
      .from('planting_project_weekly_plans')
      .select('*')
      .eq('project_id', projectId)
      .order('seed_date'),
    supabase
      .from('planting_project_supply_requirements')
      .select(`
        *,
        materials ( id, code, common_name )
      `)
      .eq('project_id', projectId)
      .order('requirement_type'),
    supabase
      .from('planting_project_audit_logs')
      .select(`
        *,
        profiles ( id, full_name )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    supabase
      .from('material_agronomic_profiles')
      .select('*')
      .eq('organization_id', profile.organization_id),
  ])

  if (linesRes.error) throw new Error(linesRes.error.message)
  if (proposalsRes.error) throw new Error(proposalsRes.error.message)
  if (weeklyRes.error) throw new Error(weeklyRes.error.message)
  if (supplyRes.error) throw new Error(supplyRes.error.message)
  if (auditRes.error) throw new Error(auditRes.error.message)
  if (agronomicRes.error) throw new Error(agronomicRes.error.message)

  const agronomicMap = new Map((agronomicRes.data || []).map((row) => [row.material_id, row]))
  const proposalMap = new Map((proposalsRes.data || []).map((row) => [row.id, row]))

  const lines = (linesRes.data || []).map((row) => {
    const metrics = calculateLineMetrics(
      {
        ...row,
        project_start_date: project.start_date,
        project_end_date: project.end_date,
      },
      project,
    )
    return {
      ...row,
      agronomic_profile: row.material_id ? agronomicMap.get(row.material_id) || null : null,
      proposed_material: row.proposed_material_id ? proposalMap.get(row.proposed_material_id) || null : null,
      metrics,
    }
  })

  const detail = {
    ...project,
    lines,
    proposedMaterials: proposalsRes.data || [],
    weeklyPlans: weeklyRes.data || [],
    supplyRequirements: supplyRes.data || [],
    auditLogs: auditRes.data || [],
  }

  return {
    ...detail,
    summary: computeProjectSummary(detail),
  }
}

export async function savePlantingProject(rawPayload) {
  const profile = await getProfile()
  const payload = normalizeProjectPayload(rawPayload)
  if (!payload.project_name) throw new Error('Debes ingresar el nombre del proyecto')
  if (!payload.lines.length) throw new Error('Agrega al menos una materia prima al proyecto')

  const headerPayload = {
    organization_id: profile.organization_id,
    project_code: payload.project_code,
    project_name: payload.project_name,
    client_id: payload.client_id || null,
    commercial_channel: payload.commercial_channel || null,
    production_unit: payload.production_unit || null,
    location: payload.location || null,
    start_date: payload.start_date,
    end_date: payload.end_date,
    status: payload.status || 'borrador',
    notes: payload.notes || null,
    created_by: payload.id ? undefined : profile.id,
    updated_at: new Date().toISOString(),
  }

  let projectId = payload.id
  let previousProject = null
  if (projectId) {
    const existing = await getPlantingProjectDetail(projectId)
    previousProject = existing
    const { error } = await supabase.from('planting_projects').update(headerPayload).eq('id', projectId)
    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await supabase.from('planting_projects').insert(headerPayload).select('id').single()
    if (error) throw new Error(error.message)
    projectId = data.id
  }

  await supabase.from('planting_project_weekly_plans').delete().eq('project_id', projectId)
  await supabase.from('planting_project_supply_requirements').delete().eq('project_id', projectId)
  await supabase.from('planting_project_lines').delete().eq('project_id', projectId)
  await supabase.from('planting_project_proposed_materials').delete().eq('project_id', projectId)

  const proposedLineEntries = payload.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !line.material_id && line.proposed_material_name)

  let proposalRows = []
  if (proposedLineEntries.length) {
    const catalogs = await getPlantingProjectCatalogs()
    const proposalPayloads = proposedLineEntries.map(({ line }) => {
      const suggestions = suggestSimilarMaterials(line.proposed_material_name, catalogs.materials)
      return {
        organization_id: profile.organization_id,
        project_id: projectId,
        proposed_name: line.proposed_material_name,
        normalized_name: normalizeName(line.proposed_material_name),
        suggested_material_id: suggestions[0]?.similarity >= 0.9 ? suggestions[0].id : null,
        status: 'pendiente_aprobacion',
        created_by: profile.id,
      }
    })
    const { data, error } = await supabase
      .from('planting_project_proposed_materials')
      .insert(proposalPayloads)
      .select('*')
    if (error) throw new Error(error.message)
    proposalRows = data || []
  }

  let proposalCursor = 0
  const linePayloads = payload.lines.map((line) => {
    const proposedRow = !line.material_id && line.proposed_material_name ? proposalRows[proposalCursor++] : null
    return {
      organization_id: profile.organization_id,
      project_id: projectId,
      line_no: line.line_no,
      material_id: line.material_id || null,
      proposed_material_id: proposedRow?.id || null,
      variety: line.variety?.trim() || null,
      expected_volume: round4(line.expected_volume),
      unit: line.unit || 'lb',
      delivery_frequency: line.delivery_frequency || 'semanal',
      average_weight_per_plant: round4(line.average_weight_per_plant),
      germination_rate: n(line.germination_rate),
      survival_rate: n(line.survival_rate),
      waste_rate: n(line.waste_rate),
      rejection_rate: n(line.rejection_rate),
      days_to_harvest: Math.max(1, Math.round(n(line.days_to_harvest))),
      cells_per_tray: Math.max(1, Math.round(n(line.cells_per_tray))),
      first_harvest_target_date: toIsoDate(line.first_harvest_target_date),
      notes: line.notes?.trim() || null,
    }
  })

  const { data: insertedLines, error: lineError } = await supabase
    .from('planting_project_lines')
    .insert(linePayloads)
    .select(`
      *,
      materials ( id, code, common_name, base_unit )
    `)
  if (lineError) throw new Error(lineError.message)

  const project = {
    id: projectId,
    start_date: payload.start_date,
    end_date: payload.end_date,
  }

  await rebuildDerivedTables(profile, project, insertedLines || [])

  await appendAuditLog(
    profile,
    projectId,
    payload.id ? 'actualizacion_proyecto' : 'creacion_proyecto',
    payload.id ? 'Se actualizó el proyecto de siembra.' : 'Se creó el proyecto de siembra.',
    previousProject ? { project: previousProject } : {},
    { project: headerPayload, lines: linePayloads.length },
  )

  return projectId
}

export async function approvePlantingProject(projectId, approvalNotes = '') {
  const profile = await getProfile()
  const detail = await getPlantingProjectDetail(projectId)
  if (!detail.lines.length) throw new Error('No puedes aprobar un proyecto sin líneas')

  const catalogs = await getPlantingProjectCatalogs()
  const pendingProposals = (detail.proposedMaterials || []).filter((row) => row.status === 'pendiente_aprobacion')
  const createdMaterials = []

  for (const proposal of pendingProposals) {
    const relatedLine = detail.lines.find((line) => line.proposed_material_id === proposal.id)
    if (!relatedLine) continue

    const exactMatch = catalogs.materials.find(
      (row) => normalizeName(row.common_name) === normalizeName(proposal.proposed_name),
    )

    let materialId = exactMatch?.id || null
    let proposalStatus = exactMatch ? 'fusionada' : 'aprobada'

    if (!materialId) {
      const material = await createMaterial({
        common_name: proposal.proposed_name,
        category: 'materia_prima_vegetal',
        base_unit: relatedLine.unit || 'lb',
        purchase_presentation: relatedLine.unit || 'lb',
        preferred_supplier_id: null,
        estimated_cost: 0,
        shelf_life_days: null,
        requires_lot: true,
        requires_temperature: false,
        minimum_stock: 0,
        status: 'activo',
      })

      materialId = material.id
      createdMaterials.push(material)
      const { error: agronomicError } = await supabase.from('material_agronomic_profiles').upsert({
        organization_id: profile.organization_id,
        material_id: materialId,
        default_variety: relatedLine.variety || null,
        commercial_unit: relatedLine.unit || 'lb',
        standard_weight_per_plant: round4(relatedLine.average_weight_per_plant),
        standard_germination_rate: n(relatedLine.germination_rate),
        standard_survival_rate: n(relatedLine.survival_rate),
        standard_waste_rate: n(relatedLine.waste_rate),
        standard_rejection_rate: n(relatedLine.rejection_rate),
        standard_days_to_harvest: Math.max(1, Math.round(n(relatedLine.days_to_harvest))),
        cells_per_tray: Math.max(1, Math.round(n(relatedLine.cells_per_tray))),
        historical_yield: round4(relatedLine.expected_volume),
        validation_status: 'pendiente_validacion_tecnica',
        origin_project_id: projectId,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,material_id', ignoreDuplicates: false })
      if (agronomicError) throw new Error(agronomicError.message)
    }

    const { error: lineUpdateError } = await supabase
      .from('planting_project_lines')
      .update({ material_id: materialId })
      .eq('project_id', projectId)
      .eq('proposed_material_id', proposal.id)
    if (lineUpdateError) throw new Error(lineUpdateError.message)

    const { error: proposalUpdateError } = await supabase
      .from('planting_project_proposed_materials')
      .update({
        approved_material_id: materialId,
        status: proposalStatus,
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', proposal.id)
    if (proposalUpdateError) throw new Error(proposalUpdateError.message)
  }

  const { error: projectError } = await supabase
    .from('planting_projects')
    .update({
      status: 'aprobado',
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
      approval_notes: approvalNotes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
  if (projectError) throw new Error(projectError.message)

  const refreshed = await getPlantingProjectDetail(projectId)
  await rebuildDerivedTables(profile, refreshed, refreshed.lines)
  await appendAuditLog(
    profile,
    projectId,
    'aprobacion_proyecto',
    'Se aprobó el proyecto y se consolidaron materias primas propuestas.',
    { pending_proposals: pendingProposals.length },
    { created_materials: createdMaterials.map((row) => ({ id: row.id, common_name: row.common_name })) },
  )

  return {
    createdMaterials,
    projectId,
  }
}
