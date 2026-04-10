import { supabase } from '../../../lib/supabase'
import { getBankAccounts } from '../../contabilidad/services/contabilidadService'
import { getCajaModuleData } from './cajaService'
import { getCxCData } from './cxcService'
import { getCxPData } from './cxpService'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function round2(value) {
  return Math.round((n(value) + Number.EPSILON) * 100) / 100
}

function clamp(value, min, max) {
  return Math.min(Math.max(n(value), min), max)
}

function dateFromKey(value) {
  if (value instanceof Date) {
    const date = new Date(value.getTime())
    date.setHours(12, 0, 0, 0)
    return date
  }
  const raw = String(value || '').slice(0, 10)
  if (!raw) return null
  const date = new Date(`${raw}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateKey(value) {
  const date = value instanceof Date ? value : dateFromKey(value)
  if (!date) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function addDays(value, days) {
  const date = dateFromKey(value)
  if (!date) return ''
  date.setDate(date.getDate() + n(days))
  return dateKey(date)
}

function endOfMonth(value) {
  const date = dateFromKey(value)
  if (!date) return ''
  return dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0))
}

function diffDays(from, to) {
  const start = dateFromKey(from)
  const end = dateFromKey(to)
  if (!start || !end) return 0
  const ms = end.getTime() - start.getTime()
  return Math.round(ms / 86400000)
}

function startOfWeek(value) {
  const date = dateFromKey(value)
  if (!date) return ''
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return dateKey(date)
}

function endOfWeek(value) {
  return addDays(startOfWeek(value), 6)
}

function getPeriodMeta(value, grouping) {
  const date = dateFromKey(value)
  if (!date) return { key: '', label: '', start: '', end: '' }

  if (grouping === 'mes') {
    const start = dateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0))
    const end = endOfMonth(value)
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('es-GT', { month: 'long', year: 'numeric' }),
      start,
      end,
    }
  }

  if (grouping === 'quincena') {
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const isFirstHalf = date.getDate() <= 15
    const start = isFirstHalf ? `${monthKey}-01` : `${monthKey}-16`
    const end = isFirstHalf ? `${monthKey}-15` : endOfMonth(value)
    return {
      key: `${monthKey}-${isFirstHalf ? 'Q1' : 'Q2'}`,
      label: isFirstHalf
        ? `1-15 ${date.toLocaleDateString('es-GT', { month: 'short', year: 'numeric' })}`
        : `16-${dateFromKey(end)?.getDate() || 0} ${date.toLocaleDateString('es-GT', { month: 'short', year: 'numeric' })}`,
      start,
      end,
    }
  }

  const start = startOfWeek(value)
  const end = endOfWeek(value)
  return {
    key: `${start}_${end}`,
    label: `${start} - ${end}`,
    start,
    end,
  }
}

function todayKey() {
  return dateKey(new Date())
}

function buildDateRange(start, end) {
  const rows = []
  let cursor = dateFromKey(start)
  const limit = dateFromKey(end)

  while (cursor && limit && cursor <= limit) {
    rows.push(dateKey(cursor))
    cursor = dateFromKey(addDays(cursor, 1))
  }

  return rows
}

function scenarioLabel(code) {
  if (code === 'optimista') return 'Optimista'
  if (code === 'pesimista') return 'Pesimista'
  return 'Realista'
}

function fmtPriority(priority) {
  if (priority === 'alta') return 'Alta'
  if (priority === 'baja') return 'Baja'
  return 'Media'
}

const DEFAULT_SETTINGS = {
  initial_cash_balance: 0,
  included_bank_account_ids: [],
  included_cash_box_ids: [],
  default_horizon_days: 90,
  default_grouping: 'semana',
  liquidity_alert_threshold: 0,
  payment_flexible_after_days: 15,
  payment_reprogrammable_after_days: 30,
  payroll_extra_percentage: 0,
  concentration_alert_threshold: 0.4,
}

const DEFAULT_SCENARIOS = [
  {
    scenario_code: 'optimista',
    name: 'Optimista',
    collection_delay_days: -4,
    collection_probability_factor: 1,
    payment_shift_days: 6,
    projected_purchase_multiplier: 0.95,
    payroll_multiplier: 1,
    manual_income_multiplier: 1.05,
    manual_expense_multiplier: 0.95,
    notes: 'Cobros mas rapidos y mayor holgura de pagos.',
  },
  {
    scenario_code: 'realista',
    name: 'Realista',
    collection_delay_days: 0,
    collection_probability_factor: 1,
    payment_shift_days: 0,
    projected_purchase_multiplier: 1,
    payroll_multiplier: 1,
    manual_income_multiplier: 1,
    manual_expense_multiplier: 1,
    notes: 'Comportamiento esperado segun la operacion normal.',
  },
  {
    scenario_code: 'pesimista',
    name: 'Pesimista',
    collection_delay_days: 10,
    collection_probability_factor: 0.85,
    payment_shift_days: -4,
    projected_purchase_multiplier: 1.12,
    payroll_multiplier: 1.02,
    manual_income_multiplier: 0.9,
    manual_expense_multiplier: 1.12,
    notes: 'Clientes tardan en pagar y los egresos se aceleran.',
  },
]

const DEFAULT_CATEGORIES = [
  { name: 'Materia prima', kind: 'egreso' },
  { name: 'Material de empaque', kind: 'egreso' },
  { name: 'Servicios', kind: 'egreso' },
  { name: 'Mantenimiento', kind: 'egreso' },
  { name: 'Inversion', kind: 'egreso' },
  { name: 'Otros', kind: 'egreso' },
  { name: 'Otros ingresos', kind: 'ingreso' },
]

async function getProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('No se pudo obtener el usuario autenticado')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return []
}

async function ensureCashFlowDefaults(profile) {
  const [settingsRes, scenariosRes, categoriesRes] = await Promise.all([
    supabase
      .from('cash_flow_settings')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .maybeSingle(),
    supabase
      .from('cash_flow_scenarios')
      .select('*')
      .eq('organization_id', profile.organization_id),
    supabase
      .from('cash_flow_categories')
      .select('*')
      .eq('organization_id', profile.organization_id),
  ])

  if (settingsRes.error) throw new Error(settingsRes.error.message)
  if (scenariosRes.error) throw new Error(scenariosRes.error.message)
  if (categoriesRes.error) throw new Error(categoriesRes.error.message)

  if (!settingsRes.data) {
    const { error } = await supabase
      .from('cash_flow_settings')
      .insert({
        organization_id: profile.organization_id,
        ...DEFAULT_SETTINGS,
        created_by: profile.id,
      })

    if (error) throw new Error(error.message)
  }

  const existingScenarioCodes = new Set((scenariosRes.data || []).map((row) => row.scenario_code))
  const missingScenarios = DEFAULT_SCENARIOS.filter((row) => !existingScenarioCodes.has(row.scenario_code))
  if (missingScenarios.length) {
    const { error } = await supabase
      .from('cash_flow_scenarios')
      .insert(missingScenarios.map((row) => ({
        organization_id: profile.organization_id,
        created_by: profile.id,
        ...row,
      })))

    if (error) throw new Error(error.message)
  }

  const existingCategories = new Set((categoriesRes.data || []).map((row) => `${row.kind}:${row.name}`.toLowerCase()))
  const missingCategories = DEFAULT_CATEGORIES.filter((row) => !existingCategories.has(`${row.kind}:${row.name}`.toLowerCase()))
  if (missingCategories.length) {
    const { error } = await supabase
      .from('cash_flow_categories')
      .insert(missingCategories.map((row) => ({
        organization_id: profile.organization_id,
        created_by: profile.id,
        ...row,
      })))

    if (error) throw new Error(error.message)
  }
}

async function getCashFlowCoreData(profile) {
  const [
    settingsRes,
    scenariosRes,
    categoriesRes,
    overridesRes,
    manualItemsRes,
    simulationsRes,
    employeesRes,
    suppliersRes,
    bankAccounts,
    cxcRows,
    cxpRows,
  ] = await Promise.all([
    supabase
      .from('cash_flow_settings')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .single(),
    supabase
      .from('cash_flow_scenarios')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('scenario_code'),
    supabase
      .from('cash_flow_categories')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('kind')
      .order('name'),
    supabase
      .from('cash_flow_projection_overrides')
      .select('*')
      .eq('organization_id', profile.organization_id),
    supabase
      .from('cash_flow_manual_items')
      .select(`
        *,
        suppliers ( id, name ),
        cash_flow_categories ( id, name, kind )
      `)
      .eq('organization_id', profile.organization_id)
      .order('estimated_date')
      .order('created_at'),
    supabase
      .from('cash_flow_simulations')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('empleados')
      .select(`
        id,
        codigo_empleado,
        nombres,
        apellidos,
        puesto,
        tipo_pago,
        salario_base_actual,
        bonificacion_incentivo_actual,
        estado_laboral
      `)
      .eq('organization_id', profile.organization_id)
      .neq('estado_laboral', 'baja'),
    supabase
      .from('suppliers')
      .select('id, name, status')
      .eq('organization_id', profile.organization_id)
      .order('name'),
    getBankAccounts(true),
    getCxCData(false),
    getCxPData(false),
  ])

  if (settingsRes.error) throw new Error(settingsRes.error.message)
  if (scenariosRes.error) throw new Error(scenariosRes.error.message)
  if (categoriesRes.error) throw new Error(categoriesRes.error.message)
  if (overridesRes.error) throw new Error(overridesRes.error.message)
  if (manualItemsRes.error) throw new Error(manualItemsRes.error.message)
  if (simulationsRes.error) throw new Error(simulationsRes.error.message)
  if (employeesRes.error) throw new Error(employeesRes.error.message)
  if (suppliersRes.error) throw new Error(suppliersRes.error.message)

  let cashBoxes = []
  try {
    const cajaData = await getCajaModuleData(true)
    cashBoxes = cajaData.boxes || []
  } catch {
    cashBoxes = []
  }

  const { data: bankMovements, error: bankMovementsError } = await supabase
    .from('bank_movements')
    .select('bank_account_id, movement_date, debit_amount, credit_amount')
    .eq('organization_id', profile.organization_id)

  if (bankMovementsError) throw new Error(bankMovementsError.message)

  return {
    settings: settingsRes.data,
    scenarios: scenariosRes.data || [],
    categories: categoriesRes.data || [],
    overrides: overridesRes.data || [],
    manualItems: manualItemsRes.data || [],
    simulations: simulationsRes.data || [],
    employees: employeesRes.data || [],
    suppliers: suppliersRes.data || [],
    bankAccounts,
    bankMovements: bankMovements || [],
    cashBoxes,
    cxcRows,
    cxpRows,
  }
}

function computeBankBalances(bankAccounts, bankMovements, projectionStartDate) {
  return (bankAccounts || []).map((account) => {
    const totals = (bankMovements || []).reduce((acc, row) => {
      if (row.bank_account_id !== account.id) return acc
      if (projectionStartDate && row.movement_date && row.movement_date > projectionStartDate) return acc
      acc.debit += n(row.debit_amount)
      acc.credit += n(row.credit_amount)
      return acc
    }, { debit: 0, credit: 0 })

    return {
      ...account,
      current_balance: round2(n(account.opening_balance) + totals.credit - totals.debit),
    }
  })
}

function computeCashBalances(cashBoxes) {
  return (cashBoxes || []).map((box) => ({
    ...box,
    current_balance: round2(box.current_balance),
  }))
}

function resolveOverride(overrides, sourceType, sourceId, scenarioCode) {
  const global = overrides.find((row) =>
    row.source_type === sourceType &&
    row.source_id === sourceId &&
    row.scenario_code === 'todos'
  )
  const specific = overrides.find((row) =>
    row.source_type === sourceType &&
    row.source_id === sourceId &&
    row.scenario_code === scenarioCode
  )

  return {
    id: specific?.id || global?.id || null,
    projected_date: specific?.projected_date || global?.projected_date || null,
    include_in_projection: specific?.include_in_projection ?? global?.include_in_projection ?? true,
    collection_probability: specific?.collection_probability ?? global?.collection_probability ?? null,
    payment_classification: specific?.payment_classification || global?.payment_classification || '',
    notes: specific?.notes || global?.notes || '',
    scope: specific?.id ? scenarioCode : global?.id ? 'todos' : scenarioCode,
    hasSpecific: Boolean(specific?.id),
    hasGlobal: Boolean(global?.id),
  }
}

function inferPaymentClassification(projectedDate, settings) {
  const daysUntil = diffDays(todayKey(), projectedDate)
  if (daysUntil <= 0) return 'obligatorio'
  if (daysUntil <= n(settings.payment_flexible_after_days)) return 'obligatorio'
  if (daysUntil <= n(settings.payment_reprogrammable_after_days)) return 'flexible'
  return 'reprogramable'
}

function getScenarioPaymentShift(classification, baseShift) {
  const shift = n(baseShift)
  if (shift <= 0) return shift
  if (classification === 'obligatorio') return 0
  if (classification === 'flexible') return Math.min(shift, 7)
  return shift
}

function buildCxcItems(rows, overrides, scenario, horizonEnd) {
  return (rows || []).map((row) => {
    const override = resolveOverride(overrides, 'cxc', row.id, scenario.scenario_code)
    const baseDate = override.projected_date || row.dueDate || String(row.created_at || '').slice(0, 10)
    const projectedDate = addDays(baseDate, scenario.collection_delay_days)
    const probability = clamp(
      (override.collection_probability == null ? 1 : n(override.collection_probability)) *
      n(scenario.collection_probability_factor),
      0,
      1
    )

    return {
      id: row.id,
      source_type: 'cxc',
      source_id: row.id,
      label: `Pedido #${row.order_number}`,
      client_name: row.clients?.commercial_name || 'Cliente',
      document_reference: row.order_number ? `PED-${row.order_number}` : row.id,
      base_amount: round2(row.total),
      projected_amount: round2(n(row.total) * probability),
      due_date: row.dueDate,
      projected_date: projectedDate,
      state: row.status,
      include_in_projection: override.include_in_projection,
      probability,
      override,
      notes: override.notes,
      is_within_horizon: projectedDate <= horizonEnd,
    }
  })
}

function buildCxpItems(rows, overrides, scenario, settings, horizonEnd) {
  return (rows || []).map((row) => {
    const override = resolveOverride(overrides, 'cxp', row.id, scenario.scenario_code)
    const baseDate = override.projected_date || row.dueDate || String(row.invoice_date || row.created_at || '').slice(0, 10)
    const classification = override.payment_classification || inferPaymentClassification(baseDate, settings)
    const shiftDays = getScenarioPaymentShift(classification, scenario.payment_shift_days)
    const projectedDate = addDays(baseDate, shiftDays)
    const projectedAmount = round2(n(row.displayAmount || row.net_payable_amount || row.payable_amount))

    return {
      id: row.id,
      source_type: 'cxp',
      source_id: row.id,
      label: row.invoice_number ? `Factura ${row.invoice_number}` : `CxP ${row.internalLot || row.id}`,
      supplier_name: row.suppliers?.name || 'Proveedor',
      document_reference: row.invoice_number || row.internalLot || row.id,
      base_amount: projectedAmount,
      projected_amount: projectedAmount,
      due_date: row.dueDate,
      projected_date: projectedDate,
      state: row.status,
      classification,
      include_in_projection: override.include_in_projection,
      override,
      notes: override.notes,
      is_within_horizon: projectedDate <= horizonEnd,
    }
  })
}

function getMonthlyCompensation(employee, payrollExtraPercentage) {
  return round2(
    (n(employee.salario_base_actual) + n(employee.bonificacion_incentivo_actual)) *
    (1 + n(payrollExtraPercentage) / 100)
  )
}

function buildPayrollSchedule(employee, startDate, endDate, monthlyCompensation) {
  const events = []
  const start = dateFromKey(startDate)
  const end = dateFromKey(endDate)
  if (!start || !end) return events

  if (employee.tipo_pago === 'mensual') {
    let cursor = dateFromKey(dateKey(new Date(start.getFullYear(), start.getMonth(), 1, 12, 0, 0)))
    while (cursor && cursor <= end) {
      const payDate = dateFromKey(endOfMonth(cursor))
      if (payDate && payDate >= start && payDate <= end) {
        events.push({ date: dateKey(payDate), amount: monthlyCompensation })
      }
      cursor = dateFromKey(addDays(endOfMonth(cursor), 1))
    }
    return events
  }

  if (employee.tipo_pago === 'quincenal') {
    let cursor = dateFromKey(dateKey(new Date(start.getFullYear(), start.getMonth(), 1, 12, 0, 0)))
    while (cursor && cursor <= end) {
      const firstHalf = dateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 15, 12, 0, 0))
      const secondHalf = endOfMonth(cursor)
      ;[firstHalf, secondHalf].forEach((dateValue) => {
        const payDate = dateFromKey(dateValue)
        if (payDate && payDate >= start && payDate <= end) {
          events.push({ date: dateValue, amount: round2(monthlyCompensation / 2) })
        }
      })
      cursor = dateFromKey(addDays(endOfMonth(cursor), 1))
    }
    return events
  }

  let cursor = dateFromKey(startDate)
  while (cursor && cursor <= end) {
    if (cursor.getDay() === 5) {
      events.push({
        date: dateKey(cursor),
        amount: round2((monthlyCompensation * 12) / 52),
      })
    }
    cursor = dateFromKey(addDays(cursor, 1))
  }

  return events
}

function buildPayrollItems(employees, settings, scenario, startDate, endDate) {
  const activeEmployees = (employees || []).filter((employee) => employee.estado_laboral === 'activo')
  const items = []

  activeEmployees.forEach((employee) => {
    const monthlyCompensation = round2(
      getMonthlyCompensation(employee, settings.payroll_extra_percentage) *
      n(scenario.payroll_multiplier || 1)
    )
    const schedule = buildPayrollSchedule(employee, startDate, endDate, monthlyCompensation)
    schedule.forEach((event, index) => {
      items.push({
        id: `${employee.id}-${event.date}-${index}`,
        source_type: 'nomina',
        source_id: employee.id,
        label: `${employee.codigo_empleado || 'EMP'} ${employee.nombres || ''} ${employee.apellidos || ''}`.trim(),
        employee_name: `${employee.nombres || ''} ${employee.apellidos || ''}`.trim(),
        employee_code: employee.codigo_empleado,
        payment_type: employee.tipo_pago,
        projected_date: event.date,
        projected_amount: round2(event.amount),
        monthly_compensation: monthlyCompensation,
        include_in_projection: true,
      })
    })
  })

  return items
}

function buildManualItems(items, scenario) {
  return (items || [])
    .filter((item) => item.is_active !== false)
    .filter((item) => item.applies_to_scenario === 'todos' || item.applies_to_scenario === scenario.scenario_code)
    .map((item) => {
      const multiplier = item.item_type === 'otro_ingreso'
        ? n(scenario.manual_income_multiplier)
        : item.item_type === 'compra_proyectada'
          ? n(scenario.projected_purchase_multiplier)
          : n(scenario.manual_expense_multiplier)

      return {
        id: item.id,
        source_type: 'manual',
        source_id: item.id,
        label: item.concept,
        category_name: item.cash_flow_categories?.name || 'Sin categoria',
        item_type: item.item_type,
        supplier_name: item.suppliers?.name || '',
        projected_date: item.estimated_date,
        projected_amount: round2(n(item.amount) * multiplier),
        base_amount: round2(item.amount),
        direction: item.item_type === 'otro_ingreso' ? 'ingreso' : 'egreso',
        priority: item.priority,
        notes: item.comment,
        include_in_projection: true,
      }
    })
}

function buildRecurringSimulationBenefits(simulation, horizonEnd) {
  const rows = []
  if (n(simulation.recurring_benefit_amount) <= 0 || !simulation.benefit_start_date || !simulation.benefit_frequency) {
    return rows
  }

  let cursor = dateFromKey(simulation.benefit_start_date)
  const limit = dateFromKey(horizonEnd)
  const jumpDays = simulation.benefit_frequency === 'semanal'
    ? 7
    : simulation.benefit_frequency === 'quincenal'
      ? 15
      : 30

  while (cursor && limit && cursor <= limit) {
    rows.push({ date: dateKey(cursor), amount: round2(simulation.recurring_benefit_amount) })
    cursor = dateFromKey(addDays(cursor, jumpDays))
  }

  return rows
}

function buildSimulationItems(simulations, scenario, startDate, endDate, previewSimulation = null) {
  const sourceRows = previewSimulation?.preview_mode === 'isolated'
    ? []
    : [...(simulations || []).filter((row) => row.is_active !== false)]
  if (previewSimulation?.name) {
    sourceRows.unshift({
      ...previewSimulation,
      id: previewSimulation.id || 'preview-simulation',
      is_preview: true,
      is_active: true,
    })
  }

  const rows = []
  sourceRows
    .filter((row) => row.applies_to_scenario === 'todos' || row.applies_to_scenario === scenario.scenario_code)
    .forEach((simulation) => {
      const sign = simulation.cash_effect_direction === 'ingreso' ? 1 : -1
      const amount = round2(n(simulation.amount) * sign)
      const start = simulation.start_date || startDate
      const paymentMode = simulation.payment_mode || 'contado'

      if (paymentMode === 'contado') {
        rows.push({
          id: `${simulation.id}-principal`,
          source_type: 'simulacion',
          source_id: simulation.id,
          label: simulation.name,
          simulation_type: simulation.simulation_type,
          projected_date: start,
          projected_amount: Math.abs(amount),
          signed_amount: amount,
          direction: sign > 0 ? 'ingreso' : 'egreso',
          notes: simulation.notes,
          is_preview: Boolean(simulation.is_preview),
        })
      } else if (paymentMode === 'cuotas') {
        const count = Math.max(1, parseInt(simulation.installment_count, 10) || 1)
        const jumpDays = simulation.installment_frequency === 'semanal'
          ? 7
          : simulation.installment_frequency === 'quincenal'
            ? 15
            : 30
        for (let i = 0; i < count; i += 1) {
          const paymentDate = addDays(start, i * jumpDays)
          if (paymentDate > endDate) break
          rows.push({
            id: `${simulation.id}-cuota-${i + 1}`,
            source_type: 'simulacion',
            source_id: simulation.id,
            label: `${simulation.name} · cuota ${i + 1}/${count}`,
            simulation_type: simulation.simulation_type,
            projected_date: paymentDate,
            projected_amount: round2(Math.abs(amount) / count),
            signed_amount: round2(amount / count),
            direction: sign > 0 ? 'ingreso' : 'egreso',
            notes: simulation.notes,
            is_preview: Boolean(simulation.is_preview),
          })
        }
      } else {
        const downPayment = round2(n(simulation.down_payment_amount))
        const balanceAmount = round2(Math.abs(amount) - downPayment)
        rows.push({
          id: `${simulation.id}-anticipo`,
          source_type: 'simulacion',
          source_id: simulation.id,
          label: `${simulation.name} · anticipo`,
          simulation_type: simulation.simulation_type,
          projected_date: start,
          projected_amount: downPayment,
          signed_amount: round2(sign * downPayment),
          direction: sign > 0 ? 'ingreso' : 'egreso',
          notes: simulation.notes,
          is_preview: Boolean(simulation.is_preview),
        })
        rows.push({
          id: `${simulation.id}-saldo`,
          source_type: 'simulacion',
          source_id: simulation.id,
          label: `${simulation.name} · saldo`,
          simulation_type: simulation.simulation_type,
          projected_date: simulation.balance_payment_date || addDays(start, 30),
          projected_amount: balanceAmount,
          signed_amount: round2(sign * balanceAmount),
          direction: sign > 0 ? 'ingreso' : 'egreso',
          notes: simulation.notes,
          is_preview: Boolean(simulation.is_preview),
        })
      }

      buildRecurringSimulationBenefits(simulation, endDate).forEach((benefit, index) => {
        rows.push({
          id: `${simulation.id}-benefit-${index + 1}`,
          source_type: 'simulacion_beneficio',
          source_id: simulation.id,
          label: `${simulation.name} · ${simulation.recurring_benefit_type || 'beneficio'}`,
          simulation_type: simulation.simulation_type,
          projected_date: benefit.date,
          projected_amount: benefit.amount,
          signed_amount: benefit.amount,
          direction: 'ingreso',
          notes: simulation.notes,
          is_preview: Boolean(simulation.is_preview),
        })
      })
    })

  return rows
    .filter((row) => row.projected_date >= startDate && row.projected_date <= endDate)
    .map((row) => ({
      ...row,
      projected_amount: round2(row.projected_amount),
      signed_amount: row.signed_amount == null
        ? round2(row.direction === 'ingreso' ? row.projected_amount : -row.projected_amount)
        : round2(row.signed_amount),
      include_in_projection: true,
    }))
}

function buildEventRows({ cxcItems, cxpItems, payrollItems, manualItems, simulationItems }) {
  const events = []

  cxcItems.filter((item) => item.include_in_projection).forEach((item) => {
    events.push({
      id: `cxc-${item.id}`,
      source_type: 'cxc',
      source_id: item.id,
      label: item.label,
      counterpart: item.client_name,
      date: item.projected_date,
      amount: round2(item.projected_amount),
      direction: 'ingreso',
      notes: item.notes,
    })
  })

  cxpItems.filter((item) => item.include_in_projection).forEach((item) => {
    events.push({
      id: `cxp-${item.id}`,
      source_type: 'cxp',
      source_id: item.id,
      label: item.label,
      counterpart: item.supplier_name,
      date: item.projected_date,
      amount: round2(item.projected_amount),
      direction: 'egreso',
      classification: item.classification,
      notes: item.notes,
    })
  })

  payrollItems.forEach((item) => {
    events.push({
      id: `nomina-${item.id}`,
      source_type: 'nomina',
      source_id: item.source_id,
      label: item.label,
      counterpart: item.employee_name,
      date: item.projected_date,
      amount: round2(item.projected_amount),
      direction: 'egreso',
      notes: `Pago ${item.payment_type}`,
    })
  })

  manualItems.forEach((item) => {
    events.push({
      id: `manual-${item.id}`,
      source_type: 'manual',
      source_id: item.id,
      label: item.label,
      counterpart: item.supplier_name,
      date: item.projected_date,
      amount: round2(item.projected_amount),
      direction: item.direction,
      notes: item.notes,
      priority: item.priority,
    })
  })

  simulationItems.forEach((item) => {
    events.push({
      id: `sim-${item.id}`,
      source_type: item.source_type,
      source_id: item.source_id,
      label: item.label,
      date: item.projected_date,
      amount: round2(item.projected_amount),
      direction: item.direction,
      notes: item.notes,
      is_preview: Boolean(item.is_preview),
    })
  })

  return events.sort((a, b) => {
    if (a.date === b.date) return a.direction === 'ingreso' ? -1 : 1
    return a.date.localeCompare(b.date)
  })
}

function buildDailyProjection(initialBalance, events, startDate, endDate) {
  const dateRange = buildDateRange(startDate, endDate)
  const eventsByDate = {}

  events.forEach((event) => {
    if (!eventsByDate[event.date]) eventsByDate[event.date] = []
    eventsByDate[event.date].push(event)
  })

  let runningBalance = round2(initialBalance)

  return dateRange.map((day) => {
    const dayEvents = eventsByDate[day] || []
    const inflows = round2(dayEvents.filter((event) => event.direction === 'ingreso').reduce((acc, event) => acc + n(event.amount), 0))
    const outflows = round2(dayEvents.filter((event) => event.direction === 'egreso').reduce((acc, event) => acc + n(event.amount), 0))
    const openingBalance = runningBalance
    const closingBalance = round2(openingBalance + inflows - outflows)
    runningBalance = closingBalance

    return {
      date: day,
      opening_balance: round2(openingBalance),
      inflows,
      outflows,
      closing_balance: closingBalance,
      events: dayEvents,
    }
  })
}

function buildPeriodProjection(dailyRows, grouping, scenarioCode) {
  const periodMap = new Map()

  dailyRows.forEach((dayRow) => {
    const meta = getPeriodMeta(dayRow.date, grouping)
    if (!periodMap.has(meta.key)) {
      periodMap.set(meta.key, {
        key: meta.key,
        label: meta.label,
        start_date: meta.start,
        end_date: meta.end,
        opening_balance: dayRow.opening_balance,
        inflows: 0,
        outflows: 0,
        closing_balance: dayRow.closing_balance,
        event_count: 0,
        scenario_code: scenarioCode,
        observations: [],
      })
    }

    const period = periodMap.get(meta.key)
    period.inflows = round2(period.inflows + dayRow.inflows)
    period.outflows = round2(period.outflows + dayRow.outflows)
    period.closing_balance = dayRow.closing_balance
    period.event_count += dayRow.events.length
    dayRow.events.slice(0, 2).forEach((event) => {
      if (period.observations.length < 3 && event.label) {
        period.observations.push(event.label)
      }
    })
  })

  return Array.from(periodMap.values()).map((period) => ({
    ...period,
    observations: period.closing_balance < 0 ? 'Riesgo de liquidez' : period.observations.join(' · '),
  }))
}

function buildSourceBreakdown({ cxcItems, cxpItems, payrollItems, manualItems, simulationItems }) {
  return [
    {
      key: 'cxc',
      label: 'CxC incluidas',
      count: cxcItems.filter((item) => item.include_in_projection).length,
      total: round2(cxcItems.filter((item) => item.include_in_projection).reduce((acc, item) => acc + n(item.projected_amount), 0)),
      direction: 'ingreso',
    },
    {
      key: 'cxp',
      label: 'CxP incluidas',
      count: cxpItems.filter((item) => item.include_in_projection).length,
      total: round2(cxpItems.filter((item) => item.include_in_projection).reduce((acc, item) => acc + n(item.projected_amount), 0)),
      direction: 'egreso',
    },
    {
      key: 'nomina',
      label: 'Nomina',
      count: payrollItems.length,
      total: round2(payrollItems.reduce((acc, item) => acc + n(item.projected_amount), 0)),
      direction: 'egreso',
    },
    {
      key: 'manual-egresos',
      label: 'Compras y egresos manuales',
      count: manualItems.filter((item) => item.direction === 'egreso').length,
      total: round2(manualItems.filter((item) => item.direction === 'egreso').reduce((acc, item) => acc + n(item.projected_amount), 0)),
      direction: 'egreso',
    },
    {
      key: 'otros-ingresos',
      label: 'Otros ingresos y beneficios',
      count: manualItems.filter((item) => item.direction === 'ingreso').length + simulationItems.filter((item) => item.direction === 'ingreso').length,
      total: round2(
        manualItems.filter((item) => item.direction === 'ingreso').reduce((acc, item) => acc + n(item.projected_amount), 0) +
        simulationItems.filter((item) => item.direction === 'ingreso').reduce((acc, item) => acc + n(item.projected_amount), 0)
      ),
      direction: 'ingreso',
    },
  ]
}

function buildAlerts({ dailyRows, cxcItems, cxpItems, payrollItems, settings, summary }) {
  const alerts = []
  const threshold = n(settings.liquidity_alert_threshold)
  const firstNegative = dailyRows.find((row) => row.closing_balance < 0)

  if (firstNegative) {
    alerts.push({
      id: 'negative-balance',
      severity: 'high',
      title: 'Saldo negativo proyectado',
      date: firstNegative.date,
      amount: round2(Math.abs(firstNegative.closing_balance)),
      description: `La proyeccion cae por debajo de cero el ${firstNegative.date}.`,
      recommendation: 'Reprogramar pagos flexibles o adelantar cobranza antes de esa fecha.',
    })
  } else if (summary.minimum_balance <= threshold) {
    alerts.push({
      id: 'low-liquidity',
      severity: 'medium',
      title: 'Liquidez ajustada',
      date: summary.minimum_balance_date,
      amount: round2(Math.max(0, threshold - summary.minimum_balance)),
      description: `El punto minimo de caja queda en ${summary.minimum_balance_date}.`,
      recommendation: 'Mantener reserva operativa o postergar compras no criticas.',
    })
  }

  const payrollByDate = payrollItems.reduce((acc, item) => {
    acc[item.projected_date] = (acc[item.projected_date] || 0) + n(item.projected_amount)
    return acc
  }, {})

  Object.entries(payrollByDate).some(([date, amount]) => {
    const day = dailyRows.find((row) => row.date === date)
    if (day && day.closing_balance < threshold) {
      alerts.push({
        id: `payroll-${date}`,
        severity: 'high',
        title: 'Caja insuficiente para nomina',
        date,
        amount: round2(amount),
        description: `La salida de nomina proyectada para ${date} deja la caja por debajo del umbral.`,
        recommendation: 'Asegurar cobranza previa, fondeo temporal o reprogramar otros egresos.',
      })
      return true
    }
    return false
  })

  const totalCxc = cxcItems.filter((item) => item.include_in_projection).reduce((acc, item) => acc + n(item.projected_amount), 0)
  const clientBuckets = {}
  cxcItems.filter((item) => item.include_in_projection).forEach((item) => {
    clientBuckets[item.client_name] = (clientBuckets[item.client_name] || 0) + n(item.projected_amount)
  })
  const topClient = Object.entries(clientBuckets).sort((a, b) => b[1] - a[1])[0]
  if (topClient && totalCxc > 0 && (topClient[1] / totalCxc) >= n(settings.concentration_alert_threshold || 0.4)) {
    alerts.push({
      id: 'client-concentration',
      severity: 'medium',
      title: 'Concentracion alta de cobros',
      date: '',
      amount: round2(topClient[1]),
      description: `${topClient[0]} concentra ${(topClient[1] / totalCxc * 100).toFixed(1)}% de los cobros proyectados.`,
      recommendation: 'Acelerar otras cuentas por cobrar o diversificar las fechas de cobro.',
    })
  }

  const bigMandatoryPayment = [...cxpItems]
    .filter((item) => item.include_in_projection && item.classification === 'obligatorio')
    .sort((a, b) => b.projected_amount - a.projected_amount)[0]

  if (bigMandatoryPayment && diffDays(todayKey(), bigMandatoryPayment.projected_date) <= 14 && bigMandatoryPayment.projected_amount > summary.initial_balance * 0.35) {
    alerts.push({
      id: 'large-payment',
      severity: 'medium',
      title: 'Pago grande cercano',
      date: bigMandatoryPayment.projected_date,
      amount: round2(bigMandatoryPayment.projected_amount),
      description: `${bigMandatoryPayment.supplier_name} tiene un pago relevante en los proximos 14 dias.`,
      recommendation: 'Preparar caja con anticipacion o revisar pagos flexibles alrededor de esa fecha.',
    })
  }

  const riskyCollections = cxcItems.filter((item) => item.include_in_projection && n(item.probability) < 0.9)
  const riskyTotal = riskyCollections.reduce((acc, item) => acc + n(item.projected_amount), 0)
  if (riskyCollections.length && totalCxc > 0 && riskyTotal / totalCxc >= 0.25) {
    alerts.push({
      id: 'risky-collections',
      severity: 'medium',
      title: 'Dependencia de cobros inciertos',
      date: riskyCollections.sort((a, b) => a.projected_date.localeCompare(b.projected_date))[0]?.projected_date || '',
      amount: round2(riskyTotal),
      description: 'Una parte relevante de la liquidez proyectada depende de cobros con probabilidad reducida.',
      recommendation: 'Dar seguimiento comercial, ajustar fechas o bajar el escenario antes de comprometer gastos.',
    })
  }

  return alerts
}

function buildScenarioProjection({
  scenario,
  settings,
  bankAccounts,
  cashBoxes,
  overrides,
  cxcRows,
  cxpRows,
  employees,
  manualItems,
  simulations,
  projectionStartDate,
  horizonDays,
  grouping,
  previewSimulation = null,
}) {
  const horizonEnd = addDays(projectionStartDate, horizonDays - 1)
  const selectedBankIds = normalizeJsonArray(settings.included_bank_account_ids)
  const selectedCashBoxIds = normalizeJsonArray(settings.included_cash_box_ids)

  const includedBanks = selectedBankIds.length
    ? bankAccounts.filter((account) => selectedBankIds.includes(account.id))
    : bankAccounts.filter((account) => account.is_active !== false)

  const includedCashBoxes = selectedCashBoxIds.length
    ? cashBoxes.filter((box) => selectedCashBoxIds.includes(box.id))
    : cashBoxes.filter((box) => box.is_active !== false)

  const bankInitial = round2(includedBanks.reduce((acc, account) => acc + n(account.current_balance), 0))
  const cashInitial = round2(includedCashBoxes.reduce((acc, box) => acc + n(box.current_balance), 0))
  const manualInitial = round2(settings.initial_cash_balance)
  const initialBalance = round2(bankInitial + cashInitial + manualInitial)

  const cxcItems = buildCxcItems(cxcRows, overrides, scenario, horizonEnd)
  const cxpItems = buildCxpItems(cxpRows, overrides, scenario, settings, horizonEnd)
  const payrollItems = buildPayrollItems(employees, settings, scenario, projectionStartDate, horizonEnd)
  const manualScenarioItems = buildManualItems(manualItems, scenario)
  const simulationScenarioItems = buildSimulationItems(simulations, scenario, projectionStartDate, horizonEnd, previewSimulation)

  const events = buildEventRows({
    cxcItems,
    cxpItems,
    payrollItems,
    manualItems: manualScenarioItems,
    simulationItems: simulationScenarioItems,
  }).filter((event) => event.date >= projectionStartDate && event.date <= horizonEnd)

  const dailyRows = buildDailyProjection(initialBalance, events, projectionStartDate, horizonEnd)
  const periods = buildPeriodProjection(dailyRows, grouping, scenario.scenario_code)

  const inflows = round2(events.filter((event) => event.direction === 'ingreso').reduce((acc, event) => acc + n(event.amount), 0))
  const outflows = round2(events.filter((event) => event.direction === 'egreso').reduce((acc, event) => acc + n(event.amount), 0))
  const minimumDay = dailyRows.reduce((minRow, row) => (
    minRow && minRow.closing_balance <= row.closing_balance ? minRow : row
  ), null)

  const summary = {
    initial_balance: initialBalance,
    bank_initial_balance: bankInitial,
    cash_box_initial_balance: cashInitial,
    manual_initial_balance: manualInitial,
    projected_inflows: inflows,
    projected_outflows: outflows,
    final_balance: round2(initialBalance + inflows - outflows),
    minimum_balance: round2(minimumDay?.closing_balance ?? initialBalance),
    minimum_balance_date: minimumDay?.date || projectionStartDate,
    tension_date: minimumDay?.date || projectionStartDate,
    horizon_end: horizonEnd,
  }

  return {
    scenario,
    summary,
    alerts: buildAlerts({
      dailyRows,
      cxcItems,
      cxpItems,
      payrollItems,
      settings,
      summary,
    }),
    periods,
    dailyRows,
    events,
    sourceBreakdown: buildSourceBreakdown({
      cxcItems,
      cxpItems,
      payrollItems,
      manualItems: manualScenarioItems,
      simulationItems: simulationScenarioItems,
    }),
    cxcItems,
    cxpItems,
    payrollItems,
    manualItems: manualScenarioItems,
    simulationItems: simulationScenarioItems,
    includedBanks,
    includedCashBoxes,
  }
}

export async function getFlujoCajaWorkbench({
  scenarioCode = 'realista',
  grouping = '',
  horizonDays = 0,
  previewSimulation = null,
} = {}) {
  const profile = await getProfile()
  await ensureCashFlowDefaults(profile)

  const core = await getCashFlowCoreData(profile)
  const normalizedSettings = {
    ...DEFAULT_SETTINGS,
    ...core.settings,
    included_bank_account_ids: normalizeJsonArray(core.settings?.included_bank_account_ids),
    included_cash_box_ids: normalizeJsonArray(core.settings?.included_cash_box_ids),
  }

  const projectionStartDate = todayKey()
  const currentGrouping = grouping || normalizedSettings.default_grouping || 'semana'
  const currentHorizon = Number(horizonDays || normalizedSettings.default_horizon_days || 90)
  const bankBalances = computeBankBalances(core.bankAccounts, core.bankMovements, projectionStartDate)
  const cashBalances = computeCashBalances(core.cashBoxes)

  const scenariosByCode = {}
  const scenarioResults = {}

  ;(core.scenarios || []).forEach((scenario) => {
    scenariosByCode[scenario.scenario_code] = scenario
    scenarioResults[scenario.scenario_code] = buildScenarioProjection({
      scenario,
      settings: normalizedSettings,
      bankAccounts: bankBalances,
      cashBoxes: cashBalances,
      overrides: core.overrides,
      cxcRows: core.cxcRows,
      cxpRows: core.cxpRows,
      employees: core.employees,
      manualItems: core.manualItems,
      simulations: core.simulations,
      projectionStartDate,
      horizonDays: currentHorizon,
      grouping: currentGrouping,
      previewSimulation,
    })
  })

  const selectedCode = scenariosByCode[scenarioCode] ? scenarioCode : 'realista'
  const current = scenarioResults[selectedCode] || Object.values(scenarioResults)[0]

  return {
    generated_at: new Date().toISOString(),
    projection_start_date: projectionStartDate,
    settings: normalizedSettings,
    scenarios: core.scenarios || [],
    categories: core.categories || [],
    manualItems: core.manualItems || [],
    simulations: core.simulations || [],
    suppliers: core.suppliers || [],
    bankAccounts: bankBalances,
    cashBoxes: cashBalances,
    selectedScenarioCode: selectedCode,
    grouping: currentGrouping,
    horizonDays: currentHorizon,
    comparison: Object.values(scenarioResults).map((result) => ({
      scenario_code: result.scenario.scenario_code,
      name: result.scenario.name || scenarioLabel(result.scenario.scenario_code),
      summary: result.summary,
      alert_count: result.alerts.length,
      high_alert_count: result.alerts.filter((alert) => alert.severity === 'high').length,
    })),
    current,
  }
}

export async function saveCashFlowSettings(payload) {
  const profile = await getProfile()
  await ensureCashFlowDefaults(profile)

  const data = {
    organization_id: profile.organization_id,
    initial_cash_balance: round2(payload.initial_cash_balance),
    included_bank_account_ids: normalizeJsonArray(payload.included_bank_account_ids),
    included_cash_box_ids: normalizeJsonArray(payload.included_cash_box_ids),
    default_horizon_days: parseInt(payload.default_horizon_days, 10) || 90,
    default_grouping: payload.default_grouping || 'semana',
    liquidity_alert_threshold: round2(payload.liquidity_alert_threshold),
    payment_flexible_after_days: parseInt(payload.payment_flexible_after_days, 10) || 15,
    payment_reprogrammable_after_days: parseInt(payload.payment_reprogrammable_after_days, 10) || 30,
    payroll_extra_percentage: round2(payload.payroll_extra_percentage),
    concentration_alert_threshold: n(payload.concentration_alert_threshold || 0.4),
    updated_at: new Date().toISOString(),
  }

  const { data: existing, error: loadError } = await supabase
    .from('cash_flow_settings')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .single()

  if (loadError) throw new Error(loadError.message)

  const { error } = existing?.id
    ? await supabase.from('cash_flow_settings').update(data).eq('id', existing.id)
    : await supabase.from('cash_flow_settings').insert({ ...data, created_by: profile.id })

  if (error) throw new Error(error.message)
}

export async function saveCashFlowScenario(payload) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('cash_flow_scenarios')
    .upsert({
      organization_id: profile.organization_id,
      scenario_code: payload.scenario_code,
      name: payload.name || scenarioLabel(payload.scenario_code),
      collection_delay_days: parseInt(payload.collection_delay_days, 10) || 0,
      collection_probability_factor: n(payload.collection_probability_factor || 1),
      payment_shift_days: parseInt(payload.payment_shift_days, 10) || 0,
      projected_purchase_multiplier: n(payload.projected_purchase_multiplier || 1),
      payroll_multiplier: n(payload.payroll_multiplier || 1),
      manual_income_multiplier: n(payload.manual_income_multiplier || 1),
      manual_expense_multiplier: n(payload.manual_expense_multiplier || 1),
      notes: payload.notes || null,
      updated_at: new Date().toISOString(),
      created_by: profile.id,
    }, {
      onConflict: 'organization_id,scenario_code',
    })

  if (error) throw new Error(error.message)
}

export async function saveCashFlowOverride(payload) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('cash_flow_projection_overrides')
    .upsert({
      organization_id: profile.organization_id,
      source_type: payload.source_type,
      source_id: payload.source_id,
      scenario_code: payload.scenario_code || 'todos',
      projected_date: payload.projected_date || null,
      include_in_projection: payload.include_in_projection !== false,
      collection_probability: payload.collection_probability == null || payload.collection_probability === ''
        ? null
        : n(payload.collection_probability),
      payment_classification: payload.payment_classification || null,
      notes: payload.notes || null,
      updated_at: new Date().toISOString(),
      created_by: profile.id,
    }, {
      onConflict: 'organization_id,source_type,source_id,scenario_code',
    })

  if (error) throw new Error(error.message)
}

export async function deleteCashFlowOverride({ source_type, source_id, scenario_code }) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('cash_flow_projection_overrides')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('source_type', source_type)
    .eq('source_id', source_id)
    .eq('scenario_code', scenario_code || 'todos')

  if (error) throw new Error(error.message)
}

export async function saveCashFlowCategory(payload) {
  const profile = await getProfile()
  const data = {
    organization_id: profile.organization_id,
    name: String(payload.name || '').trim(),
    kind: payload.kind || 'egreso',
    is_active: payload.is_active !== false,
    updated_at: new Date().toISOString(),
    created_by: profile.id,
  }

  if (!data.name) throw new Error('Debes ingresar el nombre de la categoria')

  const { error } = payload.id
    ? await supabase.from('cash_flow_categories').update(data).eq('id', payload.id)
    : await supabase.from('cash_flow_categories').insert(data)

  if (error) throw new Error(error.message)
}

export async function toggleCashFlowCategoryActive(id, is_active) {
  const { error } = await supabase
    .from('cash_flow_categories')
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function saveCashFlowManualItem(payload) {
  const profile = await getProfile()
  const data = {
    organization_id: profile.organization_id,
    item_type: payload.item_type || 'compra_proyectada',
    category_id: payload.category_id || null,
    supplier_id: payload.supplier_id || null,
    concept: String(payload.concept || '').trim(),
    amount: round2(payload.amount),
    estimated_date: payload.estimated_date,
    priority: payload.priority || 'media',
    applies_to_scenario: payload.applies_to_scenario || 'todos',
    comment: payload.comment || null,
    is_active: payload.is_active !== false,
    updated_at: new Date().toISOString(),
    created_by: profile.id,
  }

  if (!data.concept) throw new Error('Debes ingresar el concepto proyectado')
  if (!data.estimated_date) throw new Error('Debes ingresar la fecha estimada')
  if (n(data.amount) <= 0) throw new Error('El monto estimado debe ser mayor a cero')

  const { error } = payload.id
    ? await supabase.from('cash_flow_manual_items').update(data).eq('id', payload.id)
    : await supabase.from('cash_flow_manual_items').insert(data)

  if (error) throw new Error(error.message)
}

export async function toggleCashFlowManualItemActive(id, is_active) {
  const { error } = await supabase
    .from('cash_flow_manual_items')
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function deleteCashFlowManualItem(id) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('cash_flow_manual_items')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function saveCashFlowSimulation(payload) {
  const profile = await getProfile()
  const data = {
    organization_id: profile.organization_id,
    name: String(payload.name || '').trim(),
    simulation_type: String(payload.simulation_type || '').trim() || 'otro',
    cash_effect_direction: payload.cash_effect_direction || 'egreso',
    amount: round2(payload.amount),
    start_date: payload.start_date,
    payment_mode: payload.payment_mode || 'contado',
    installment_count: payload.installment_count ? parseInt(payload.installment_count, 10) : null,
    installment_frequency: payload.installment_frequency || null,
    down_payment_amount: payload.down_payment_amount == null || payload.down_payment_amount === ''
      ? null
      : round2(payload.down_payment_amount),
    balance_payment_date: payload.balance_payment_date || null,
    recurring_benefit_amount: payload.recurring_benefit_amount == null || payload.recurring_benefit_amount === ''
      ? null
      : round2(payload.recurring_benefit_amount),
    recurring_benefit_type: payload.recurring_benefit_type || null,
    benefit_start_date: payload.benefit_start_date || null,
    benefit_frequency: payload.benefit_frequency || null,
    applies_to_scenario: payload.applies_to_scenario || 'todos',
    is_active: payload.is_active !== false,
    notes: payload.notes || null,
    updated_at: new Date().toISOString(),
    created_by: profile.id,
  }

  if (!data.name) throw new Error('Debes ingresar el nombre de la simulacion')
  if (!data.start_date) throw new Error('Debes ingresar la fecha de inicio')
  if (n(data.amount) <= 0) throw new Error('El monto debe ser mayor a cero')

  const { error } = payload.id
    ? await supabase.from('cash_flow_simulations').update(data).eq('id', payload.id)
    : await supabase.from('cash_flow_simulations').insert(data)

  if (error) throw new Error(error.message)
}

export async function toggleCashFlowSimulationActive(id, is_active) {
  const { error } = await supabase
    .from('cash_flow_simulations')
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function deleteCashFlowSimulation(id) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('cash_flow_simulations')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export function getScenarioLabel(code) {
  return scenarioLabel(code)
}

export function getPriorityLabel(priority) {
  return fmtPriority(priority)
}

export function exportCashFlowProjectionToExcel({
  workbookName,
  scenarioName,
  periods,
  alerts,
  summary,
}) {
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const s = (value) => `<Cell><Data ss:Type="String">${esc(value)}</Data></Cell>`
  const num = (value) => `<Cell><Data ss:Type="Number">${n(value).toFixed(2)}</Data></Cell>`
  const hdr = (value) => `<Cell ss:StyleID="h"><Data ss:Type="String">${esc(value)}</Data></Cell>`

  const periodRows = (periods || []).map((row) => (
    `<Row>${s(row.label)}${num(row.opening_balance)}${num(row.inflows)}${num(row.outflows)}${num(row.closing_balance)}${s(row.scenario_code)}${s(row.observations)}</Row>`
  )).join('\n')

  const alertRows = (alerts || []).map((alert) => (
    `<Row>${s(alert.severity)}${s(alert.title)}${s(alert.date || '')}${num(alert.amount || 0)}${s(alert.description)}${s(alert.recommendation)}</Row>`
  )).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2F5D50" ss:Pattern="Solid"/></Style>
    <Style ss:ID="title"><Font ss:Bold="1" ss:Size="14"/></Style>
  </Styles>
  <Worksheet ss:Name="Flujo proyectado">
    <Table>
      <Column ss:Width="140"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="100"/><Column ss:Width="220"/>
      <Row><Cell ss:StyleID="title"><Data ss:Type="String">${esc(workbookName || 'Flujo de caja proyectado')}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Escenario: ${esc(scenarioName)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Saldo inicial: ${n(summary?.initial_balance).toFixed(2)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Ingresos proyectados: ${n(summary?.projected_inflows).toFixed(2)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Egresos proyectados: ${n(summary?.projected_outflows).toFixed(2)}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">Saldo final: ${n(summary?.final_balance).toFixed(2)}</Data></Cell></Row>
      <Row/>
      <Row>${hdr('Periodo')}${hdr('Saldo inicial')}${hdr('Ingresos')}${hdr('Egresos')}${hdr('Saldo final')}${hdr('Escenario')}${hdr('Observaciones')}</Row>
      ${periodRows}
      <Row/>
      <Row>${hdr('Severidad')}${hdr('Alerta')}${hdr('Fecha')}${hdr('Monto')}${hdr('Descripcion')}${hdr('')}${hdr('Recomendacion')}</Row>
      ${alertRows}
    </Table>
  </Worksheet>
</Workbook>`

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${(workbookName || 'flujo-caja-proyectado').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.xls`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
