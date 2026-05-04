import { supabase } from '../../../lib/supabase'

const TIME_DAYS = {
  diario: 1,
  semanal: 7,
  quincenal: 15,
  mensual: 30,
  trimestral: 90,
  semestral: 180,
  anual: 365,
}

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function dateDiffDays(date) {
  if (!date) return null
  const start = new Date(`${today()}T00:00:00`)
  const end = new Date(`${date}T00:00:00`)
  return Math.ceil((end - start) / 86400000)
}

function addDays(date, days) {
  const base = date ? new Date(`${date}T00:00:00`) : new Date()
  base.setDate(base.getDate() + n(days))
  return base.toISOString().slice(0, 10)
}

function getPlanIntervalDays(plan) {
  if (plan.time_frequency === 'personalizado') return n(plan.custom_days)
  return TIME_DAYS[plan.time_frequency] || 0
}

async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) throw new Error('No se pudo obtener el usuario autenticado')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id, full_name, email')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message || 'No se pudo cargar el perfil')
  if (!data?.organization_id) throw new Error('El usuario no tiene organizacion asignada')
  return data
}

function calcPlanState(plan, equipment) {
  if (!plan?.is_active) return { severity: 'green', label: 'Inactivo', daysLeft: null, usagePct: 0 }

  const daysLeft = ['time', 'mixed'].includes(plan.frequency_type) ? dateDiffDays(plan.next_scheduled_date) : null
  const currentUsage = n(equipment?.current_usage_counter)
  const targetUsage = n(plan.next_usage_target)
  const usagePct = ['usage', 'mixed'].includes(plan.frequency_type) && targetUsage > 0
    ? (currentUsage / targetUsage) * 100
    : 0

  if (daysLeft != null && daysLeft < 0) {
    return { severity: 'red', label: 'Vencido', daysLeft, usagePct }
  }
  if (targetUsage > 0 && currentUsage >= targetUsage) {
    return { severity: 'red', label: 'Uso vencido', daysLeft, usagePct }
  }
  if (daysLeft != null && daysLeft <= n(plan.yellow_days_threshold)) {
    return { severity: 'yellow', label: 'Proximo', daysLeft, usagePct }
  }
  if (targetUsage > 0 && usagePct >= n(plan.yellow_usage_pct || 80)) {
    return { severity: 'yellow', label: 'Uso proximo', daysLeft, usagePct }
  }

  return { severity: 'green', label: 'Al dia', daysLeft, usagePct }
}

function calcEquipmentState(equipment, plans = []) {
  if (['fuera_de_servicio', 'dado_de_baja'].includes(equipment.status)) return 'red'
  if (equipment.status === 'en_reparacion') return 'yellow'
  if (plans.some((plan) => calcPlanState(plan, equipment).severity === 'red')) return 'red'
  if (plans.some((plan) => calcPlanState(plan, equipment).severity === 'yellow')) return 'yellow'
  return 'green'
}

function composeData({ equipment, plans, checklistItems, workOrders, responses, alerts, users, suppliers }) {
  const plansByEquipment = new Map()
  const checklistByPlan = new Map()
  const ordersByEquipment = new Map()
  const responsesByOrder = new Map()
  const alertsByEquipment = new Map()
  const userById = new Map((users || []).map((user) => [user.id, user]))
  const supplierById = new Map((suppliers || []).map((supplier) => [supplier.id, supplier]))

  checklistItems.forEach((item) => {
    if (!checklistByPlan.has(item.plan_id)) checklistByPlan.set(item.plan_id, [])
    checklistByPlan.get(item.plan_id).push(item)
  })

  plans.forEach((plan) => {
    if (!plansByEquipment.has(plan.equipment_id)) plansByEquipment.set(plan.equipment_id, [])
    plansByEquipment.get(plan.equipment_id).push({
      ...plan,
      checklist_items: (checklistByPlan.get(plan.id) || []).sort((a, b) => n(a.position) - n(b.position)),
    })
  })

  responses.forEach((response) => {
    if (!responsesByOrder.has(response.work_order_id)) responsesByOrder.set(response.work_order_id, [])
    responsesByOrder.get(response.work_order_id).push(response)
  })

  workOrders.forEach((order) => {
    if (!ordersByEquipment.has(order.equipment_id)) ordersByEquipment.set(order.equipment_id, [])
    ordersByEquipment.get(order.equipment_id).push({
      ...order,
      checklist_responses: responsesByOrder.get(order.id) || [],
      executed_by_profile: userById.get(order.executed_by) || null,
    })
  })

  alerts.forEach((alert) => {
    if (!alertsByEquipment.has(alert.equipment_id)) alertsByEquipment.set(alert.equipment_id, [])
    alertsByEquipment.get(alert.equipment_id).push(alert)
  })

  const enrichedEquipment = equipment.map((item) => {
    const itemPlans = plansByEquipment.get(item.id) || []
    const itemOrders = ordersByEquipment.get(item.id) || []
    const itemAlerts = alertsByEquipment.get(item.id) || []
    const completedOrders = itemOrders.filter((order) => order.status === 'completado')
    const correctiveOrders = itemOrders.filter((order) => order.maintenance_type === 'correctivo' && order.status !== 'anulado')

    return {
      ...item,
      supplier: supplierById.get(item.supplier_id) || null,
      responsible: userById.get(item.responsible_user_id) || null,
      plans: itemPlans.map((plan) => ({ ...plan, state: calcPlanState(plan, item) })),
      work_orders: itemOrders,
      alerts: itemAlerts,
      semaphore: calcEquipmentState(item, itemPlans),
      last_maintenance: completedOrders[0] || null,
      next_plan: itemPlans
        .filter((plan) => plan.is_active)
        .sort((a, b) => String(a.next_scheduled_date || '9999').localeCompare(String(b.next_scheduled_date || '9999')))[0] || null,
      total_cost: completedOrders.reduce((sum, order) => sum + n(order.total_cost), 0),
      total_downtime: completedOrders.reduce((sum, order) => sum + n(order.downtime_minutes), 0),
      corrective_count: correctiveOrders.length,
    }
  })

  return {
    equipment: enrichedEquipment,
    plans,
    checklistItems,
    workOrders,
    responses,
    alerts,
    users,
    suppliers,
  }
}

function buildDashboard(data) {
  const equipment = data.equipment || []
  const workOrders = data.workOrders || []
  const month = today().slice(0, 7)
  const active = equipment.filter((item) => item.status === 'activo')
  const preventiveCompleted = workOrders.filter((order) =>
    order.maintenance_type === 'preventivo' &&
    order.status === 'completado' &&
    String(order.actual_execution_date || '').startsWith(month),
  )
  const preventiveDue = workOrders.filter((order) =>
    order.maintenance_type === 'preventivo' &&
    ['programado', 'en_proceso', 'reprogramado', 'completado'].includes(order.status) &&
    String(order.scheduled_date || '').startsWith(month),
  )

  return {
    activeEquipment: active.length,
    yellowEquipment: equipment.filter((item) => item.semaphore === 'yellow').length,
    redEquipment: equipment.filter((item) => item.semaphore === 'red').length,
    outOfService: equipment.filter((item) => ['fuera_de_servicio', 'dado_de_baja'].includes(item.status)).length,
    scheduledToday: workOrders.filter((order) => order.scheduled_date === today() && order.status !== 'completado').length,
    pending: workOrders.filter((order) => ['programado', 'en_proceso', 'reprogramado'].includes(order.status)).length,
    monthlyCost: workOrders
      .filter((order) => String(order.actual_execution_date || order.scheduled_date || '').startsWith(month))
      .reduce((sum, order) => sum + n(order.total_cost), 0),
    monthlyDowntime: workOrders
      .filter((order) => String(order.actual_execution_date || order.scheduled_date || '').startsWith(month))
      .reduce((sum, order) => sum + n(order.downtime_minutes), 0),
    preventiveCompliance: preventiveDue.length ? (preventiveCompleted.length / preventiveDue.length) * 100 : 100,
    correctiveThisMonth: workOrders.filter((order) => order.maintenance_type === 'correctivo' && String(order.created_at || '').startsWith(month)).length,
    percentOnTime: active.length ? (equipment.filter((item) => item.status === 'activo' && item.semaphore === 'green').length / active.length) * 100 : 100,
    mostFailures: [...equipment].sort((a, b) => b.corrective_count - a.corrective_count).slice(0, 5),
    mostCostly: [...equipment].sort((a, b) => b.total_cost - a.total_cost).slice(0, 5),
  }
}

async function syncPlanAlerts(profile, composed) {
  const rows = []
  const existingKeys = new Set((composed.alerts || []).map((alert) => alert.alert_key))

  composed.equipment.forEach((equipment) => {
    if (['fuera_de_servicio', 'dado_de_baja'].includes(equipment.status)) {
      rows.push({
        organization_id: profile.organization_id,
        alert_key: `equipment:${equipment.id}:blocked`,
        equipment_id: equipment.id,
        alert_type: 'equipo_bloqueado',
        severity: 'critical',
        status: 'abierta',
        message: `${equipment.internal_code} - ${equipment.name} no esta disponible para operacion.`,
      })
    }

    equipment.plans.forEach((plan) => {
      const state = calcPlanState(plan, equipment)
      if (state.severity === 'green') return

      const isUsage = state.label.includes('Uso')
      rows.push({
        organization_id: profile.organization_id,
        alert_key: `plan:${plan.id}:${isUsage ? 'usage' : 'time'}`,
        equipment_id: equipment.id,
        plan_id: plan.id,
        alert_type: state.severity === 'red' ? (isUsage ? 'uso_excedido' : 'vencido') : 'proximo_vencer',
        severity: state.severity === 'red' ? 'critical' : 'warning',
        status: 'abierta',
        message: `${equipment.internal_code} - ${plan.name}: ${state.label.toLowerCase()}.`,
        due_date: plan.next_scheduled_date || null,
        usage_target: plan.next_usage_target || null,
        current_usage: equipment.current_usage_counter || 0,
      })
    })
  })

  const newRows = rows.filter((row) => !existingKeys.has(row.alert_key))
  if (!newRows.length) return

  const { error } = await supabase
    .from('maintenance_alerts')
    .insert(newRows)

  if (error) throw new Error(error.message || 'No se pudieron sincronizar alertas de mantenimiento')
}

export async function getMaintenanceDashboard() {
  const profile = await getProfile()

  const [equipmentRes, plansRes, checklistRes, ordersRes, responsesRes, alertsRes, usersRes, suppliersRes] = await Promise.all([
    supabase.from('maintenance_equipment').select('*').eq('organization_id', profile.organization_id).order('internal_code'),
    supabase.from('maintenance_plans').select('*').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }),
    supabase.from('maintenance_checklist_items').select('*').eq('organization_id', profile.organization_id).order('position'),
    supabase.from('maintenance_work_orders').select('*').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }),
    supabase.from('maintenance_checklist_responses').select('*').eq('organization_id', profile.organization_id).order('created_at'),
    supabase.from('maintenance_alerts').select('*').eq('organization_id', profile.organization_id).eq('status', 'abierta').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, email').eq('organization_id', profile.organization_id).eq('is_active', true).order('full_name'),
    supabase.from('suppliers').select('id, name').eq('organization_id', profile.organization_id).order('name'),
  ])

  for (const result of [equipmentRes, plansRes, checklistRes, ordersRes, responsesRes, alertsRes, usersRes, suppliersRes]) {
    if (result.error) throw new Error(result.error.message)
  }

  let composed = composeData({
    equipment: equipmentRes.data || [],
    plans: plansRes.data || [],
    checklistItems: checklistRes.data || [],
    workOrders: ordersRes.data || [],
    responses: responsesRes.data || [],
    alerts: alertsRes.data || [],
    users: usersRes.data || [],
    suppliers: suppliersRes.data || [],
  })

  await syncPlanAlerts(profile, composed)

  const { data: refreshedAlerts } = await supabase
    .from('maintenance_alerts')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'abierta')
    .order('created_at', { ascending: false })

  composed = composeData({
    equipment: equipmentRes.data || [],
    plans: plansRes.data || [],
    checklistItems: checklistRes.data || [],
    workOrders: ordersRes.data || [],
    responses: responsesRes.data || [],
    alerts: refreshedAlerts || alertsRes.data || [],
    users: usersRes.data || [],
    suppliers: suppliersRes.data || [],
  })

  return {
    ...composed,
    dashboard: buildDashboard(composed),
  }
}

export async function createEquipment(payload) {
  const profile = await getProfile()
  const { data: generatedCode, error: codeError } = await supabase.rpc(
    'generate_maintenance_equipment_code',
    { p_organization_id: profile.organization_id },
  )
  if (codeError) throw new Error(codeError.message || 'No se pudo generar el codigo del equipo')

  const { data, error } = await supabase
    .from('maintenance_equipment')
    .insert({
      organization_id: profile.organization_id,
      internal_code: generatedCode,
      name: payload.name,
      category: payload.category,
      area_location: payload.area_location || null,
      brand: payload.brand || null,
      model: payload.model || null,
      serial_number: payload.serial_number || null,
      supplier_id: payload.supplier_id || null,
      purchase_date: payload.purchase_date || null,
      installation_date: payload.installation_date || null,
      status: payload.status || 'activo',
      responsible_user_id: payload.responsible_user_id || null,
      general_notes: payload.general_notes || null,
      attachment_url: payload.attachment_url || null,
      initial_usage_counter: n(payload.initial_usage_counter),
      current_usage_counter: n(payload.initial_usage_counter),
      usage_unit: payload.usage_unit || 'horas',
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo registrar el equipo')
  return data
}

export async function updateEquipment(id, payload) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('maintenance_equipment')
    .update({
      name: payload.name,
      category: payload.category,
      area_location: payload.area_location || null,
      brand: payload.brand || null,
      model: payload.model || null,
      serial_number: payload.serial_number || null,
      supplier_id: payload.supplier_id || null,
      purchase_date: payload.purchase_date || null,
      installation_date: payload.installation_date || null,
      status: payload.status || 'activo',
      responsible_user_id: payload.responsible_user_id || null,
      general_notes: payload.general_notes || null,
      attachment_url: payload.attachment_url || null,
      current_usage_counter: n(payload.current_usage_counter),
      usage_unit: payload.usage_unit || 'horas',
      updated_by: profile.id,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo actualizar el equipo')
}

export async function setEquipmentStatus(id, status) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('maintenance_equipment')
    .update({ status, updated_by: profile.id })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo cambiar el estado del equipo')
}

export async function createMaintenancePlan(payload, checklistItems = []) {
  const profile = await getProfile()
  const { data: plan, error } = await supabase
    .from('maintenance_plans')
    .insert({
      organization_id: profile.organization_id,
      equipment_id: payload.equipment_id,
      maintenance_type: payload.maintenance_type,
      name: payload.name,
      description: payload.description || null,
      frequency_type: payload.frequency_type,
      time_frequency: payload.time_frequency || null,
      custom_days: payload.time_frequency === 'personalizado' ? n(payload.custom_days) : null,
      usage_frequency_type: payload.usage_frequency_type || null,
      usage_interval: payload.usage_interval === '' ? null : n(payload.usage_interval),
      next_scheduled_date: payload.next_scheduled_date || null,
      next_usage_target: payload.next_usage_target === '' ? null : n(payload.next_usage_target),
      estimated_minutes: payload.estimated_minutes === '' ? null : n(payload.estimated_minutes),
      suggested_responsible_user_id: payload.suggested_responsible_user_id || null,
      requires_shutdown: !!payload.requires_shutdown,
      suggested_parts: payload.suggested_parts || null,
      checklist_required: !!payload.checklist_required,
      yellow_days_threshold: n(payload.yellow_days_threshold || 7),
      yellow_usage_pct: n(payload.yellow_usage_pct || 80),
      red_usage_pct: n(payload.red_usage_pct || 100),
      is_active: payload.is_active !== false,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo crear el plan')

  const rows = checklistItems
    .filter((item) => String(item.item_label || '').trim())
    .map((item, index) => ({
      organization_id: profile.organization_id,
      plan_id: plan.id,
      item_label: item.item_label.trim(),
      response_type: item.response_type || 'check',
      required: item.required !== false,
      position: index + 1,
    }))

  if (rows.length) {
    const { error: checklistError } = await supabase.from('maintenance_checklist_items').insert(rows)
    if (checklistError) throw new Error(checklistError.message || 'Plan creado, pero fallo el checklist')
  }

  return plan
}

export async function updateMaintenancePlan(id, payload, checklistItems = []) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('maintenance_plans')
    .update({
      maintenance_type: payload.maintenance_type,
      name: payload.name,
      description: payload.description || null,
      frequency_type: payload.frequency_type,
      time_frequency: payload.time_frequency || null,
      custom_days: payload.time_frequency === 'personalizado' ? n(payload.custom_days) : null,
      usage_frequency_type: payload.usage_frequency_type || null,
      usage_interval: payload.usage_interval === '' ? null : n(payload.usage_interval),
      next_scheduled_date: payload.next_scheduled_date || null,
      next_usage_target: payload.next_usage_target === '' ? null : n(payload.next_usage_target),
      estimated_minutes: payload.estimated_minutes === '' ? null : n(payload.estimated_minutes),
      suggested_responsible_user_id: payload.suggested_responsible_user_id || null,
      requires_shutdown: !!payload.requires_shutdown,
      suggested_parts: payload.suggested_parts || null,
      checklist_required: !!payload.checklist_required,
      yellow_days_threshold: n(payload.yellow_days_threshold || 7),
      yellow_usage_pct: n(payload.yellow_usage_pct || 80),
      red_usage_pct: n(payload.red_usage_pct || 100),
      is_active: payload.is_active !== false,
      updated_by: profile.id,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo actualizar el plan')

  await supabase.from('maintenance_checklist_items').delete().eq('plan_id', id)

  const rows = checklistItems
    .filter((item) => String(item.item_label || '').trim())
    .map((item, index) => ({
      organization_id: profile.organization_id,
      plan_id: id,
      item_label: item.item_label.trim(),
      response_type: item.response_type || 'check',
      required: item.required !== false,
      position: index + 1,
    }))

  if (rows.length) {
    const { error: checklistError } = await supabase.from('maintenance_checklist_items').insert(rows)
    if (checklistError) throw new Error(checklistError.message || 'Plan actualizado, pero fallo el checklist')
  }
}

export async function createWorkOrder(payload) {
  const profile = await getProfile()
  const { data: generatedCode, error: codeError } = await supabase.rpc(
    'generate_maintenance_work_order_code',
    { p_organization_id: profile.organization_id },
  )
  if (codeError) throw new Error(codeError.message || 'No se pudo generar el codigo de mantenimiento')

  const { data, error } = await supabase
    .from('maintenance_work_orders')
    .insert({
      organization_id: profile.organization_id,
      work_order_code: generatedCode,
      equipment_id: payload.equipment_id,
      plan_id: payload.plan_id || null,
      maintenance_type: payload.maintenance_type,
      scheduled_date: payload.scheduled_date || today(),
      executed_by: payload.executed_by || null,
      support_staff: payload.support_staff || null,
      corrective_reason: payload.corrective_reason || null,
      failure_description: payload.failure_description || null,
      observations: payload.observations || null,
      status: payload.status || 'programado',
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo crear el mantenimiento')
  return data
}

export async function startWorkOrder(id) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('maintenance_work_orders')
    .update({
      status: 'en_proceso',
      start_time: new Date().toISOString(),
      executed_by: profile.id,
      updated_by: profile.id,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo iniciar el mantenimiento')
}

function isResponseComplete(item, response) {
  if (!item.required) return true
  if (!response) return false
  if (item.response_type === 'check') return response.response_bool != null
  if (item.response_type === 'number') return response.response_number !== '' && response.response_number != null
  return String(response.response_text || '').trim() !== ''
}

export async function closeWorkOrder(workOrder, payload, checklistResponses = []) {
  const profile = await getProfile()
  const plan = payload.plan || null
  const checklistItems = plan?.checklist_items || []

  if (plan?.checklist_required) {
    const missing = checklistItems.filter((item) => {
      const response = checklistResponses.find((entry) => entry.checklist_item_id === item.id)
      return !isResponseComplete(item, response)
    })
    if (missing.length) {
      throw new Error(`Completa el checklist obligatorio antes de cerrar: ${missing[0].item_label}`)
    }
  }

  const partsCost = n(payload.parts_cost)
  const laborCost = n(payload.labor_cost)
  const totalCost = partsCost + laborCost

  const rows = checklistResponses
    .filter((response) => String(response.item_label || '').trim())
    .map((response) => ({
      organization_id: profile.organization_id,
      work_order_id: workOrder.id,
      checklist_item_id: response.checklist_item_id || null,
      item_label: response.item_label,
      response_type: response.response_type,
      response_bool: response.response_type === 'check' ? !!response.response_bool : null,
      response_number: response.response_type === 'number' ? n(response.response_number) : null,
      response_text: ['short_text', 'long_text'].includes(response.response_type) ? response.response_text || null : null,
      result: response.result || null,
      observation: response.observation || null,
      evidence_url: response.evidence_url || null,
      completed_by: profile.id,
      completed_at: new Date().toISOString(),
    }))

  await supabase.from('maintenance_checklist_responses').delete().eq('work_order_id', workOrder.id)
  if (rows.length) {
    const { error: responseError } = await supabase.from('maintenance_checklist_responses').insert(rows)
    if (responseError) throw new Error(responseError.message || 'No se pudo guardar el checklist')
  }

  const { error } = await supabase
    .from('maintenance_work_orders')
    .update({
      status: 'completado',
      actual_execution_date: payload.actual_execution_date || today(),
      start_time: payload.start_time || workOrder.start_time || new Date().toISOString(),
      end_time: payload.end_time || new Date().toISOString(),
      executed_by: payload.executed_by || profile.id,
      support_staff: payload.support_staff || null,
      corrective_reason: payload.corrective_reason || null,
      failure_description: payload.failure_description || null,
      action_performed: payload.action_performed || null,
      parts_used: payload.parts_used || null,
      parts_cost: partsCost,
      labor_cost: laborCost,
      total_cost: totalCost,
      downtime_minutes: n(payload.downtime_minutes),
      final_result: payload.final_result || null,
      checklist_completed: !!rows.length || !plan?.checklist_required,
      observations: payload.observations || null,
      attachment_url: payload.attachment_url || null,
      updated_by: profile.id,
    })
    .eq('id', workOrder.id)

  if (error) throw new Error(error.message || 'No se pudo cerrar el mantenimiento')

  if (plan) {
    const intervalDays = getPlanIntervalDays(plan)
    const updatePlan = {}
    if (intervalDays > 0) updatePlan.next_scheduled_date = addDays(payload.actual_execution_date || today(), intervalDays)
    if (n(plan.usage_interval) > 0) {
      const { data: equipment } = await supabase
        .from('maintenance_equipment')
        .select('current_usage_counter')
        .eq('id', workOrder.equipment_id)
        .single()
      updatePlan.next_usage_target = n(equipment?.current_usage_counter) + n(plan.usage_interval)
    }
    if (Object.keys(updatePlan).length) {
      await supabase.from('maintenance_plans').update({ ...updatePlan, updated_by: profile.id }).eq('id', plan.id)
    }
  }

  await supabase
    .from('maintenance_alerts')
    .update({ status: 'cerrada', closed_at: new Date().toISOString() })
    .eq('equipment_id', workOrder.equipment_id)
    .eq('status', 'abierta')
}

export async function rescheduleWorkOrder(id, scheduledDate, reason = '') {
  const profile = await getProfile()
  const { error } = await supabase
    .from('maintenance_work_orders')
    .update({
      status: 'reprogramado',
      scheduled_date: scheduledDate,
      observations: reason || null,
      updated_by: profile.id,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo reprogramar el mantenimiento')
}

export async function logEquipmentUsage(equipment, usageIncrement, notes = '') {
  const profile = await getProfile()
  const counterAfter = n(equipment.current_usage_counter) + n(usageIncrement)

  const { error: equipmentError } = await supabase
    .from('maintenance_equipment')
    .update({ current_usage_counter: counterAfter, updated_by: profile.id })
    .eq('id', equipment.id)

  if (equipmentError) throw new Error(equipmentError.message || 'No se pudo actualizar el uso del equipo')

  const { error } = await supabase
    .from('maintenance_usage_logs')
    .insert({
      organization_id: profile.organization_id,
      equipment_id: equipment.id,
      usage_type: equipment.usage_unit === 'ninguno' ? 'horas' : equipment.usage_unit,
      usage_increment: n(usageIncrement),
      counter_after: counterAfter,
      notes: notes || null,
      created_by: profile.id,
    })

  if (error) throw new Error(error.message || 'No se pudo registrar la bitacora de uso')
}

export const maintenanceLabels = {
  equipmentStatus: {
    activo: 'Activo',
    en_reparacion: 'En reparacion',
    fuera_de_servicio: 'Fuera de servicio',
    dado_de_baja: 'Dado de baja',
  },
  maintenanceType: {
    preventivo: 'Preventivo',
    correctivo: 'Correctivo',
    calibracion: 'Calibracion',
    limpieza_tecnica: 'Limpieza tecnica',
    inspeccion: 'Inspeccion',
  },
  workOrderStatus: {
    programado: 'Programado',
    en_proceso: 'En proceso',
    completado: 'Completado',
    cancelado: 'Cancelado',
    reprogramado: 'Reprogramado',
    anulado: 'Anulado',
  },
}
