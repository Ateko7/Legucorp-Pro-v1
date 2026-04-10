import { supabase } from '../../../lib/supabase'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) throw new Error('No se pudo obtener el usuario autenticado')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

function normalizeFilterId(value) {
  return value ? value : null
}

function getNextPeriod(year, month) {
  const current = new Date(year, month - 1, 1)
  current.setMonth(current.getMonth() + 1)
  return {
    year: current.getFullYear(),
    month: current.getMonth() + 1,
  }
}

export async function getSalesBudgetCatalogs() {
  const profile = await getProfile()

  const [clientsRes, salespeopleRes] = await Promise.all([
    supabase
      .from('clients')
      .select('id, commercial_name, salesperson_id, salespeople ( id, name )')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('commercial_name'),
    supabase
      .from('salespeople')
      .select('id, name')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('name'),
  ])

  if (clientsRes.error) throw new Error(clientsRes.error.message)
  if (salespeopleRes.error) throw new Error(salespeopleRes.error.message)

  return {
    clients: clientsRes.data || [],
    salespeople: salespeopleRes.data || [],
  }
}

export async function getSalesBudgetDashboard(filters) {
  const year = Number(filters.year)
  const month = Number(filters.month)
  const salespersonId = normalizeFilterId(filters.salespersonId)
  const clientId = normalizeFilterId(filters.clientId)
  const profile = await getProfile()

  const [rowsRes, configsRes] = await Promise.all([
    supabase.rpc('get_sales_budget_dashboard', {
      p_year: year,
      p_month: month,
      p_salesperson_id: salespersonId,
      p_client_id: clientId,
    }),
    supabase
      .from('sales_projection_configs')
      .select('id, client_id, history_months, projection_method, is_active')
      .eq('organization_id', profile.organization_id),
  ])

  if (rowsRes.error) throw new Error(rowsRes.error.message)
  if (configsRes.error) throw new Error(configsRes.error.message)

  const configMap = new Map((configsRes.data || []).map((row) => [row.client_id, row]))
  const rows = (rowsRes.data || []).map((row) => ({
    ...row,
    budget_amount: n(row.budget_amount),
    budget_units: row.budget_units == null ? '' : String(row.budget_units),
    actual_amount: n(row.actual_amount),
    expected_amount: n(row.expected_amount),
    expected_progress_pct: n(row.expected_progress_pct),
    compliance_pct: n(row.compliance_pct),
    deviation_pct: n(row.deviation_pct),
    projected_next_amount: n(row.projected_next_amount),
    history_months: configMap.get(row.client_id)?.history_months || row.history_months || 3,
    projection_method: configMap.get(row.client_id)?.projection_method || row.projection_method || 'promedio_desviacion',
    projection_active: configMap.get(row.client_id)?.is_active ?? true,
  }))

  const totals = rows.reduce((acc, row) => {
    acc.budget += n(row.budget_amount)
    acc.actual += n(row.actual_amount)
    acc.expected += n(row.expected_amount)
    return acc
  }, { budget: 0, actual: 0, expected: 0 })

  const summary = {
    budget_total: totals.budget,
    actual_total: totals.actual,
    expected_total: totals.expected,
    compliance_pct: totals.budget > 0 ? (totals.actual / totals.budget) * 100 : 0,
    deviation_pct: totals.expected > 0 ? ((totals.actual - totals.expected) / totals.expected) * 100 : 0,
    green_count: rows.filter((row) => row.status_color === 'green').length,
    red_count: rows.filter((row) => row.status_color === 'red').length,
    neutral_count: rows.filter((row) => row.status_color === 'neutral').length,
  }

  return { rows, summary, nextPeriod: getNextPeriod(year, month) }
}

export async function ensureSalesBudgetMonth(filters) {
  const { error } = await supabase.rpc('ensure_sales_budget_month', {
    p_year: Number(filters.year),
    p_month: Number(filters.month),
    p_salesperson_id: normalizeFilterId(filters.salespersonId),
    p_client_id: normalizeFilterId(filters.clientId),
  })

  if (error) throw new Error(error.message)
}

export async function saveSalesBudgetRows(rows) {
  const profile = await getProfile()
  const budgets = rows.map((row) => ({
    id: row.budget_id || undefined,
    organization_id: profile.organization_id,
    client_id: row.client_id,
    salesperson_id: row.salesperson_id || null,
    budget_year: Number(row.budget_year),
    budget_month: Number(row.budget_month),
    budget_amount: n(row.budget_amount),
    budget_units: row.budget_units === '' || row.budget_units == null ? null : n(row.budget_units),
    auto_generated: row.is_auto_generated === true,
    notes: row.notes || null,
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  }))

  const configs = rows.map((row) => ({
    organization_id: profile.organization_id,
    client_id: row.client_id,
    history_months: Number(row.history_months || 3),
    projection_method: row.projection_method || 'promedio_desviacion',
    is_active: row.projection_active !== false,
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  }))

  const [budgetRes, configRes] = await Promise.all([
    supabase.from('sales_budgets').upsert(budgets, {
      onConflict: 'organization_id,client_id,budget_year,budget_month',
      ignoreDuplicates: false,
    }),
    supabase.from('sales_projection_configs').upsert(configs, {
      onConflict: 'organization_id,client_id',
      ignoreDuplicates: false,
    }),
  ])

  if (budgetRes.error) throw new Error(budgetRes.error.message)
  if (configRes.error) throw new Error(configRes.error.message)
}

export async function generateNextMonthSalesBudget(filters) {
  const nextPeriod = getNextPeriod(Number(filters.year), Number(filters.month))
  const { data, error } = await supabase.rpc('generate_sales_budget_next_month', {
    p_source_year: Number(filters.year),
    p_source_month: Number(filters.month),
    p_target_year: nextPeriod.year,
    p_target_month: nextPeriod.month,
    p_salesperson_id: normalizeFilterId(filters.salespersonId),
    p_client_id: normalizeFilterId(filters.clientId),
  })

  if (error) throw new Error(error.message)
  return {
    nextPeriod,
    generated: data || [],
  }
}

export async function closeSalesBudgetMonth(filters) {
  const { data, error } = await supabase.rpc('close_sales_budget_month', {
    p_year: Number(filters.year),
    p_month: Number(filters.month),
    p_salesperson_id: normalizeFilterId(filters.salespersonId),
    p_client_id: normalizeFilterId(filters.clientId),
  })

  if (error) throw new Error(error.message)
  return data
}
