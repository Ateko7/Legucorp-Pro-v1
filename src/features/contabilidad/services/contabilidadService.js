import { supabase } from '../../../lib/supabase'

// ─── Constantes ───────────────────────────────────────────────────────────────

export const IVA_RATE = 0.12

export function ivaCalc(totalConIva) {
  const total = Number(totalConIva) || 0
  const base  = total / (1 + IVA_RATE)
  const iva   = total - base
  return { base, iva, total }
}

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles').select('id, organization_id').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Inicialización de catálogos ──────────────────────────────────────────────

const DEFAULT_ACCOUNTS = [
  { code: '1110', name: 'Caja',                               account_type: 'activo',  normal_balance: 'debito'  },
  { code: '1120', name: 'Banco',                              account_type: 'activo',  normal_balance: 'debito'  },
  { code: '1150', name: 'IVA Crédito Fiscal Compras',         account_type: 'activo',  normal_balance: 'debito'  },
  { code: '1200', name: 'Cuentas por Cobrar Clientes',        account_type: 'activo',  normal_balance: 'debito'  },
  { code: '1300', name: 'Inventario Producto Terminado',      account_type: 'activo',  normal_balance: 'debito'  },
  { code: '1400', name: 'Inventario Materias Primas',         account_type: 'activo',  normal_balance: 'debito'  },
  { code: '2100', name: 'Cuentas por Pagar Proveedores',      account_type: 'pasivo',  normal_balance: 'credito' },
  { code: '2120', name: 'Retenciones por Pagar',              account_type: 'pasivo',  normal_balance: 'credito' },
  { code: '2200', name: 'IVA por Pagar',                      account_type: 'pasivo',  normal_balance: 'credito' },
  { code: '4100', name: 'Ventas',                             account_type: 'ingreso', normal_balance: 'credito' },
  { code: '5100', name: 'Costo de Ventas',                    account_type: 'costo',   normal_balance: 'debito'  },
  { code: '6100', name: 'Gastos Administrativos',             account_type: 'egreso',  normal_balance: 'debito'  },
  { code: '6200', name: 'Gastos de Producción',               account_type: 'egreso',  normal_balance: 'debito'  },
  { code: '6300', name: 'Gastos de Distribución / Logística', account_type: 'egreso',  normal_balance: 'debito'  },
]

const DEFAULT_COST_CENTERS = [
  { code: 'CC-01', name: 'Producción',     description: 'Planta y procesamiento' },
  { code: 'CC-02', name: 'Comercial',      description: 'Ventas y pedidos'       },
  { code: 'CC-03', name: 'Logística',      description: 'Distribución y entrega' },
  { code: 'CC-04', name: 'Administración', description: 'Gestión general'        },
]

const DEFAULT_FISCAL_PROFILES = [
  { code: 'INGRAV-LOCAL', name: 'Ingreso gravado local', profile_type: 'cuenta', deductibility_mode: 'deducible', affects_vat_debit: true, affects_isr_base: true, risk_level: 'bajo' },
  { code: 'EXPORT-0', name: 'Exportacion tasa 0', profile_type: 'cuenta', deductibility_mode: 'deducible', affects_isr_base: true, is_zero_rated: true, operation_kind: 'exportacion', risk_level: 'medio' },
  { code: 'COMP-IVA-CF', name: 'Compra local con credito fiscal', profile_type: 'documento', deductibility_mode: 'deducible', affects_vat_credit: true, affects_isr_base: true, operation_kind: 'compra_local', risk_level: 'bajo' },
  { code: 'GASTO-ND', name: 'Gasto no deducible', profile_type: 'gasto', deductibility_mode: 'no_deducible', affects_isr_base: false, risk_level: 'alto' },
  { code: 'COMB-REV', name: 'Combustible requiere revision', profile_type: 'gasto', deductibility_mode: 'requiere_revision', affects_vat_credit: true, affects_isr_base: true, operation_kind: 'combustible', risk_level: 'alto' },
  { code: 'PLANILLA-COSTO', name: 'Planilla costo deducible', profile_type: 'gasto', deductibility_mode: 'deducible', affects_isr_base: true, operation_kind: 'planilla', risk_level: 'bajo' },
]

const DEFAULT_ACCOUNTING_EVENT_TYPES = [
  { code: 'VENTA_FACTURADA', name: 'Venta facturada', module: 'ventas', description: 'Reconocimiento de ingreso, IVA y CxC', default_posting_mode: 'automatico', requires_review: false },
  { code: 'COBRO_CLIENTE', name: 'Cobro de cliente', module: 'cxc', description: 'Aplicacion de cobro contra cuenta por cobrar', default_posting_mode: 'automatico', requires_review: false },
  { code: 'FACTURA_PROVEEDOR', name: 'Factura de proveedor', module: 'cxp', description: 'Reconocimiento de CxP, IVA credito y retenciones', default_posting_mode: 'automatico', requires_review: false },
  { code: 'PAGO_PROVEEDOR', name: 'Pago a proveedor', module: 'cxp', description: 'Cancelacion de cuenta por pagar', default_posting_mode: 'automatico', requires_review: false },
  { code: 'TRANSFERENCIA_BANCARIA', name: 'Transferencia bancaria', module: 'tesoreria', description: 'Movimiento entre cuentas bancarias', default_posting_mode: 'automatico', requires_review: false },
  { code: 'GASTO_OPERATIVO', name: 'Gasto operativo', module: 'gastos', description: 'Registro de gasto con centro de costo', default_posting_mode: 'borrador', requires_review: true },
  { code: 'COMISION_VENDEDOR', name: 'Comision de vendedor', module: 'ventas', description: 'Provision de comision comercial', default_posting_mode: 'automatico', requires_review: false },
  { code: 'CIERRE_PROCESO_MP', name: 'Cierre proceso MP', module: 'produccion', description: 'Liquidacion de costo en inventario procesado', default_posting_mode: 'borrador', requires_review: true },
  { code: 'EMPAQUE_TERMINADO', name: 'Empaque terminado', module: 'produccion', description: 'Transferencia de costo a lote terminado', default_posting_mode: 'borrador', requires_review: true },
  { code: 'RUTA_COSTEADA', name: 'Ruta costeada', module: 'logistica', description: 'Costeo logistico real por ruta y pedido', default_posting_mode: 'borrador', requires_review: true },
  { code: 'COSTO_VENTA_REAL', name: 'Costo de venta real', module: 'costeo', description: 'Reconocimiento de costo real por pedido y lote', default_posting_mode: 'borrador', requires_review: true },
]

const DEFAULT_POSTING_TEMPLATES = [
  {
    code: 'TPL-VENTA-FACTURADA',
    name: 'Venta facturada',
    event_code: 'VENTA_FACTURADA',
    posting_mode: 'automatico',
    description: 'CxC, ventas e IVA debito',
    lines: [
      { line_no: 1, side: 'debit', account_mode: 'static_code', account_value: '1200', amount_mode: 'payload', amount_value: 'total', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'sales_cost_center_id', tax_code: 'IVA_DB', description_template: 'CxC pedido {{order_number}}' },
      { line_no: 2, side: 'credit', account_mode: 'static_code', account_value: '4100', amount_mode: 'payload', amount_value: 'base', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'sales_cost_center_id', tax_code: 'BASE_ING', description_template: 'Venta pedido {{order_number}}' },
      { line_no: 3, side: 'credit', account_mode: 'static_code', account_value: '2200', amount_mode: 'payload', amount_value: 'iva', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'admin_cost_center_id', tax_code: 'IVA_DB', description_template: 'IVA pedido {{order_number}}' },
    ],
  },
  {
    code: 'TPL-COBRO-CLIENTE',
    name: 'Cobro de cliente',
    event_code: 'COBRO_CLIENTE',
    posting_mode: 'automatico',
    description: 'Banco contra cuentas por cobrar',
    lines: [
      { line_no: 1, side: 'debit', account_mode: 'payload_account_id', account_value: 'bank_accounting_account_id', amount_mode: 'payload', amount_value: 'total', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'admin_cost_center_id', tax_code: 'NO_FISCAL', description_template: 'Cobro pedido {{order_number}}' },
      { line_no: 2, side: 'credit', account_mode: 'static_code', account_value: '1200', amount_mode: 'payload', amount_value: 'total', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'admin_cost_center_id', tax_code: 'NO_FISCAL', description_template: 'Cancelacion CxC pedido {{order_number}}' },
    ],
  },
  {
    code: 'TPL-TRANSFERENCIA-BANCARIA',
    name: 'Transferencia bancaria',
    event_code: 'TRANSFERENCIA_BANCARIA',
    posting_mode: 'automatico',
    description: 'Traslado entre bancos',
    lines: [
      { line_no: 1, side: 'debit', account_mode: 'payload_account_id', account_value: 'to_accounting_account_id', amount_mode: 'payload', amount_value: 'amount', cost_center_mode: 'none', tax_code: 'NO_FISCAL', description_template: 'Transferencia recibida {{reference_number}}' },
      { line_no: 2, side: 'credit', account_mode: 'payload_account_id', account_value: 'from_accounting_account_id', amount_mode: 'payload', amount_value: 'amount', cost_center_mode: 'none', tax_code: 'NO_FISCAL', description_template: 'Transferencia enviada {{reference_number}}' },
    ],
  },
  {
    code: 'TPL-FACTURA-PROVEEDOR',
    name: 'Factura proveedor',
    event_code: 'FACTURA_PROVEEDOR',
    posting_mode: 'automatico',
    description: 'Inventario/CxP/IVA/retencion',
    lines: [
      { line_no: 1, side: 'debit', account_mode: 'payload_account_id', account_value: 'inventory_account_id', amount_mode: 'payload', amount_value: 'subtotal', cost_center_mode: 'none', tax_code: 'BASE_COMPRA', description_template: 'Compra proveedor {{supplier_name}}' },
      { line_no: 2, side: 'debit', account_mode: 'static_code', account_value: '1150', amount_mode: 'payload', amount_value: 'iva', cost_center_mode: 'none', tax_code: 'IVA_CF', description_template: 'IVA compra {{invoice_number}}', allow_zero: true },
      { line_no: 3, side: 'credit', account_mode: 'static_code', account_value: '2100', amount_mode: 'payload', amount_value: 'net_payable', cost_center_mode: 'none', tax_code: 'NO_FISCAL', description_template: 'CxP proveedor {{supplier_name}}' },
      { line_no: 4, side: 'credit', account_mode: 'static_code', account_value: '2120', amount_mode: 'payload', amount_value: 'withholding', cost_center_mode: 'none', tax_code: 'RET_ISR', description_template: 'Retencion proveedor {{supplier_name}}', allow_zero: true },
    ],
  },
  {
    code: 'TPL-PAGO-PROVEEDOR',
    name: 'Pago proveedor',
    event_code: 'PAGO_PROVEEDOR',
    posting_mode: 'automatico',
    description: 'Cancelacion CxP',
    lines: [
      { line_no: 1, side: 'debit', account_mode: 'static_code', account_value: '2100', amount_mode: 'payload', amount_value: 'total_paid', cost_center_mode: 'none', tax_code: 'NO_FISCAL', description_template: 'Cancelacion CxP proveedor {{supplier_name}}' },
      { line_no: 2, side: 'credit', account_mode: 'payload_account_id', account_value: 'bank_accounting_account_id', amount_mode: 'payload', amount_value: 'total_paid', cost_center_mode: 'none', tax_code: 'NO_FISCAL', description_template: 'Pago proveedor {{payment_reference}}' },
    ],
  },
  {
    code: 'TPL-GASTO-OPERATIVO',
    name: 'Gasto operativo pagado',
    event_code: 'GASTO_OPERATIVO',
    posting_mode: 'automatico',
    description: 'Gasto contra banco',
    lines: [
      { line_no: 1, side: 'debit', account_mode: 'payload_account_id', account_value: 'expense_account_id', amount_mode: 'payload', amount_value: 'amount', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'cost_center_id', tax_code: 'GASTO_OP', description_template: '{{description}}' },
      { line_no: 2, side: 'credit', account_mode: 'payload_account_id', account_value: 'bank_accounting_account_id', amount_mode: 'payload', amount_value: 'amount', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'cost_center_id', tax_code: 'NO_FISCAL', description_template: 'Pago en banco' },
    ],
  },
  {
    code: 'TPL-COMISION-VENDEDOR',
    name: 'Provision comision vendedor',
    event_code: 'COMISION_VENDEDOR',
    posting_mode: 'automatico',
    description: 'Gasto comercial contra cuenta por pagar',
    lines: [
      { line_no: 1, side: 'debit', account_mode: 'static_code', account_value: '6100', amount_mode: 'payload', amount_value: 'commission', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'cost_center_id', tax_code: 'GASTO_COM', description_template: '{{description}}' },
      { line_no: 2, side: 'credit', account_mode: 'static_code', account_value: '2100', amount_mode: 'payload', amount_value: 'commission', cost_center_mode: 'payload_cost_center_id', cost_center_value: 'cost_center_id', tax_code: 'NO_FISCAL', description_template: 'Comision por pagar' },
    ],
  },
]

async function ensureFiscalProfiles(orgId) {
  const rows = DEFAULT_FISCAL_PROFILES.map((row) => ({
    organization_id: orgId,
    code: row.code,
    name: row.name,
    profile_type: row.profile_type || 'cuenta',
    is_deductible: row.is_deductible !== false,
    deductibility_mode: row.deductibility_mode || 'deducible',
    affects_vat_credit: row.affects_vat_credit === true,
    affects_vat_debit: row.affects_vat_debit === true,
    affects_isr_base: row.affects_isr_base !== false,
    affects_iso: row.affects_iso === true,
    is_exempt: row.is_exempt === true,
    is_zero_rated: row.is_zero_rated === true,
    operation_kind: row.operation_kind || null,
    fiscal_notes: row.fiscal_notes || null,
    limit_rule: row.limit_rule || null,
    risk_level: row.risk_level || 'medio',
    is_active: row.is_active !== false,
  }))

  const { error: insertError } = await supabase
    .from('fiscal_profiles')
    .upsert(rows, { onConflict: 'organization_id,code', ignoreDuplicates: false })
  if (insertError) throw new Error(insertError.message)
}

async function ensureAccountingEventTypes(orgId) {
  const { error: insertError } = await supabase
    .from('accounting_event_types')
    .upsert(
      DEFAULT_ACCOUNTING_EVENT_TYPES.map((row) => ({ organization_id: orgId, ...row })),
      { onConflict: 'organization_id,code', ignoreDuplicates: false },
    )
  if (insertError) throw new Error(insertError.message)
}

async function ensurePostingTemplates(orgId) {
  const templatesPayload = DEFAULT_POSTING_TEMPLATES.map((template) => ({
    organization_id: orgId,
    code: template.code,
    name: template.name,
    event_code: template.event_code,
    description: template.description || null,
    posting_mode: template.posting_mode || 'automatico',
    is_active: true,
  }))

  const { error: templateError } = await supabase
    .from('accounting_entry_templates')
    .upsert(templatesPayload, { onConflict: 'organization_id,code', ignoreDuplicates: false })
  if (templateError) throw new Error(templateError.message)

  const { data: templates, error: loadTemplatesError } = await supabase
    .from('accounting_entry_templates')
    .select('id, code, event_code')
    .eq('organization_id', orgId)
    .in('code', DEFAULT_POSTING_TEMPLATES.map((template) => template.code))
  if (loadTemplatesError) throw new Error(loadTemplatesError.message)

  const templateMap = Object.fromEntries((templates || []).map((row) => [row.code, row]))

  for (const template of DEFAULT_POSTING_TEMPLATES) {
    const templateRow = templateMap[template.code]
    if (!templateRow?.id) continue

    const desiredLineNos = template.lines.map((line) => line.line_no)
    const { error: deleteLinesError } = await supabase
      .from('accounting_template_lines')
      .delete()
      .eq('template_id', templateRow.id)
      .not('line_no', 'in', `(${desiredLineNos.join(',') || '0'})`)
    if (deleteLinesError) throw new Error(deleteLinesError.message)

    const { error: insertLinesError } = await supabase
      .from('accounting_template_lines')
      .upsert(
        template.lines.map((line) => ({
          template_id: templateRow.id,
          line_no: line.line_no,
          side: line.side,
          account_mode: line.account_mode || 'static_code',
          account_value: line.account_value,
          amount_mode: line.amount_mode || 'payload',
          amount_value: String(line.amount_value),
          description_template: line.description_template || null,
          cost_center_mode: line.cost_center_mode || 'none',
          cost_center_value: line.cost_center_value || null,
          tax_code: line.tax_code || null,
          allow_zero: line.allow_zero === true,
        })),
        { onConflict: 'template_id,line_no', ignoreDuplicates: false },
      )
    if (insertLinesError) throw new Error(insertLinesError.message)

    const { error: ruleUpsertError } = await supabase
      .from('accounting_posting_rules')
      .upsert({
        organization_id: orgId,
        event_code: template.event_code,
        template_id: templateRow.id,
        priority: 100,
        condition_key: null,
        condition_value: null,
        is_active: true,
      }, { onConflict: 'organization_id,event_code,template_id', ignoreDuplicates: false })

    if (ruleUpsertError && !String(ruleUpsertError.message || '').includes('no unique')) {
      throw new Error(ruleUpsertError.message)
    }
  }
}

async function ensureAccountingPeriods(orgId, fiscalYear = new Date().getFullYear()) {
  const years = [fiscalYear - 1, fiscalYear, fiscalYear + 1]
  for (const year of years) {
    const { data: existing, error } = await supabase
      .from('accounting_periods')
      .select('period_code')
      .eq('organization_id', orgId)
      .eq('fiscal_year', year)
    if (error) throw new Error(error.message)
    const existingCodes = new Set((existing || []).map((row) => row.period_code))
    const rows = []
    for (let month = 1; month <= 12; month += 1) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`
      const end = new Date(year, month, 0).toISOString().slice(0, 10)
      const periodCode = `${year}-${String(month).padStart(2, '0')}`
      if (existingCodes.has(periodCode)) continue
      rows.push({
        organization_id: orgId,
        period_code: periodCode,
        period_name: `Periodo ${periodCode}`,
        fiscal_year: year,
        fiscal_month: month,
        start_date: start,
        end_date: end,
        status: 'abierto',
      })
    }
    if (rows.length) {
      const { error: insertError } = await supabase.from('accounting_periods').insert(rows)
      if (insertError) throw new Error(insertError.message)
    }
  }
}

async function ensureTaxConfiguration(orgId) {
  const { error } = await supabase
    .from('tax_configurations')
    .upsert({
      organization_id: orgId,
      vat_rate: IVA_RATE,
      isr_regime: 'utilidades',
      isr_rate: 0.25,
      iso_rate: 0.01,
      iso_base_mode: 'mayor',
      export_vat_zero_rate: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id', ignoreDuplicates: false })
  if (error) throw new Error(error.message)
}

async function ensureIsoPeriods(orgId, fiscalYear = new Date().getFullYear()) {
  const years = [fiscalYear - 1, fiscalYear, fiscalYear + 1]
  for (const year of years) {
    const rows = [
      { fiscal_quarter: 1, start_date: `${year}-01-01`, end_date: `${year}-03-31` },
      { fiscal_quarter: 2, start_date: `${year}-04-01`, end_date: `${year}-06-30` },
      { fiscal_quarter: 3, start_date: `${year}-07-01`, end_date: `${year}-09-30` },
      { fiscal_quarter: 4, start_date: `${year}-10-01`, end_date: `${year}-12-31` },
    ]
    const { error } = await supabase
      .from('tax_iso_periods')
      .upsert(rows.map((row) => ({
        organization_id: orgId,
        fiscal_year: year,
        ...row,
        updated_at: new Date().toISOString(),
      })), { onConflict: 'organization_id,fiscal_year,fiscal_quarter', ignoreDuplicates: false })
    if (error) throw new Error(error.message)
  }
}

async function getOpenPeriodForDate(orgId, entryDate) {
  const targetDate = entryDate || new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('id, period_code, status')
    .eq('organization_id', orgId)
    .lte('start_date', targetDate)
    .gte('end_date', targetDate)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No existe periodo contable para la fecha ${targetDate}`)
  if (data.status !== 'abierto') throw new Error(`El periodo ${data.period_code} no esta abierto`)
  return data
}

async function upsertAccountingSourceLink({ organizationId, sourceType, sourceId, eventCode, journalEntryId }) {
  if (!organizationId || !sourceType || !sourceId || !eventCode || !journalEntryId) return
  const { data: existing, error: loadError } = await supabase
    .from('accounting_source_links')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('event_code', eventCode)
    .maybeSingle()
  if (loadError) throw new Error(loadError.message)
  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('accounting_source_links')
      .update({ journal_entry_id: journalEntryId })
      .eq('id', existing.id)
    if (updateError) throw new Error(updateError.message)
    return
  }
  const { error: insertError } = await supabase
    .from('accounting_source_links')
    .insert({
      organization_id: organizationId,
      source_type: sourceType,
      source_id: sourceId,
      event_code: eventCode,
      journal_entry_id: journalEntryId,
    })
  if (insertError) throw new Error(insertError.message)
}

function interpolateTemplate(template, payload) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = payload?.[key]
    return value == null ? '' : String(value)
  }).trim()
}

async function resolveAccountId(orgId, line, payload) {
  if (line.account_mode === 'payload_account_id') {
    const value = payload?.[line.account_value]
    if (!value) throw new Error(`Falta cuenta dinamica ${line.account_value}`)
    return value
  }

  let code = line.account_value
  if (line.account_mode === 'payload_account_code') {
    code = payload?.[line.account_value]
  }

  if (!code) throw new Error(`No se pudo resolver cuenta para ${line.account_value}`)

  const { data, error } = await supabase
    .from('accounting_accounts')
    .select('id')
    .eq('organization_id', orgId)
    .eq('code', code)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error(`No existe cuenta contable ${code}`)
  return data.id
}

async function resolveCostCenterId(orgId, line, payload) {
  if (line.cost_center_mode === 'none') return null
  if (line.cost_center_mode === 'payload_cost_center_id') return payload?.[line.cost_center_value] || null
  if (line.cost_center_mode === 'static_code') {
    const { data, error } = await supabase
      .from('cost_centers')
      .select('id')
      .eq('organization_id', orgId)
      .eq('code', line.cost_center_value)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data?.id || null
  }
  return null
}

function resolveLineAmount(line, payload) {
  const value = line.amount_mode === 'fixed' ? line.amount_value : payload?.[line.amount_value]
  return n(value)
}

async function getPostingTemplateForEvent(orgId, eventCode) {
  const { data: rules, error } = await supabase
    .from('accounting_posting_rules')
    .select(`
      id, event_code, template_id, priority, condition_key, condition_value, is_active,
      accounting_entry_templates (
        id, code, name, posting_mode, is_active,
        accounting_template_lines (
          id, line_no, side, account_mode, account_value, amount_mode, amount_value, description_template, cost_center_mode, cost_center_value, tax_code, allow_zero
        )
      )
    `)
    .eq('organization_id', orgId)
    .eq('event_code', eventCode)
    .eq('is_active', true)
    .order('priority')
  if (error) throw new Error(error.message)
  const selected = (rules || []).find((rule) => rule.accounting_entry_templates?.is_active !== false)
  return selected?.accounting_entry_templates || null
}

export async function postAccountingEvent({
  eventCode,
  entryDate,
  description,
  referenceType,
  referenceId,
  sourceType,
  sourceId,
  payload = {},
  status = 'confirmado',
}) {
  const profile = await getProfile()
  const orgId = profile.organization_id

  const { data: existingLink, error: linkLoadError } = await supabase
    .from('accounting_source_links')
    .select('journal_entry_id')
    .eq('organization_id', orgId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('event_code', eventCode)
    .maybeSingle()
  if (linkLoadError) throw new Error(linkLoadError.message)
  if (existingLink?.journal_entry_id) return existingLink.journal_entry_id

  const template = await getPostingTemplateForEvent(orgId, eventCode)
  if (!template?.id) throw new Error(`No existe plantilla contable activa para ${eventCode}`)

  const effectiveDate = entryDate || new Date().toISOString().slice(0, 10)
  const period = await getOpenPeriodForDate(orgId, effectiveDate)
  const templateLines = [...(template.accounting_template_lines || [])].sort((a, b) => a.line_no - b.line_no)

  const resolvedLines = []
  for (const line of templateLines) {
    const amount = resolveLineAmount(line, payload)
    if (!line.allow_zero && amount <= 0) continue
    const accountId = await resolveAccountId(orgId, line, payload)
    const costCenterId = await resolveCostCenterId(orgId, line, payload)
    resolvedLines.push({
      line_no: line.line_no,
      account_id: accountId,
      cost_center_id: costCenterId,
      description: interpolateTemplate(line.description_template || description, payload) || description || eventCode,
      debit: line.side === 'debit' ? amount : 0,
      credit: line.side === 'credit' ? amount : 0,
      tax_code: line.tax_code || null,
      dimension_client_id: payload.dimension_client_id || null,
      dimension_supplier_id: payload.dimension_supplier_id || null,
      dimension_product_presentation_id: payload.dimension_product_presentation_id || null,
      dimension_order_id: payload.dimension_order_id || null,
      dimension_route_id: payload.dimension_route_id || null,
      dimension_lot_id: payload.dimension_lot_id || null,
    })
  }

  const totalDebit = resolvedLines.reduce((acc, line) => acc + n(line.debit), 0)
  const totalCredit = resolvedLines.reduce((acc, line) => acc + n(line.credit), 0)
  if (!resolvedLines.length) throw new Error(`La plantilla ${template.code} no produjo lineas`)
  if (Math.abs(totalDebit - totalCredit) > 0.005) throw new Error(`Asiento desbalanceado para ${eventCode}`)

  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: orgId,
      entry_date: effectiveDate,
      description: description || template.name,
      reference_type: referenceType || 'otro',
      reference_id: referenceId || null,
      event_code: eventCode,
      period_id: period.id,
      posting_status: template.posting_mode === 'borrador' ? 'borrador' : 'posteado',
      source_type: sourceType || null,
      source_id: sourceId || null,
      status,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (entryError) throw new Error(entryError.message)

  const { error: linesError } = await supabase
    .from('journal_entry_lines')
    .insert(resolvedLines.map((line) => ({ entry_id: entry.id, ...line })))
  if (linesError) throw new Error(linesError.message)

  await upsertAccountingSourceLink({
    organizationId: orgId,
    sourceType,
    sourceId,
    eventCode,
    journalEntryId: entry.id,
  })

  return entry.id
}

export async function initAccounting() {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  const { count: ccCount } = await supabase
    .from('cost_centers')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  const { error: accountSeedError } = await supabase
    .from('accounting_accounts')
    .upsert(
      DEFAULT_ACCOUNTS.map((a) => ({ ...a, organization_id: orgId })),
      { onConflict: 'organization_id,code', ignoreDuplicates: false },
    )
  if (accountSeedError) throw new Error(accountSeedError.message)
  // Seed solo si no hay ningún CC; los duplicados ya se limpiaron con la migración
  if (!ccCount) {
    await supabase.from('cost_centers').insert(
      DEFAULT_COST_CENTERS.map(c => ({ ...c, organization_id: orgId, is_active: true }))
    )
  }

  await Promise.all([
    ensureFiscalProfiles(orgId),
    ensureAccountingEventTypes(orgId),
    ensureAccountingPeriods(orgId),
    ensurePostingTemplates(orgId),
    ensureTaxConfiguration(orgId),
    ensureIsoPeriods(orgId),
  ])
}

// ─── Catálogo de cuentas ──────────────────────────────────────────────────────

export async function getAccounts() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('accounting_accounts')
    .select(`
      *,
      fiscal_profiles ( id, code, name, deductibility_mode, affects_vat_credit, affects_vat_debit )
    `)
    .eq('organization_id', profile.organization_id)
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function getFiscalProfiles() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('fiscal_profiles')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('profile_type')
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveFiscalProfile(profileData) {
  const profile = await getProfile()
  const payload = {
    code: String(profileData.code || '').trim().toUpperCase(),
    name: String(profileData.name || '').trim(),
    profile_type: profileData.profile_type || 'cuenta',
    is_deductible: profileData.is_deductible !== false,
    deductibility_mode: profileData.deductibility_mode || 'deducible',
    affects_vat_credit: profileData.affects_vat_credit === true,
    affects_vat_debit: profileData.affects_vat_debit === true,
    affects_isr_base: profileData.affects_isr_base !== false,
    affects_iso: profileData.affects_iso === true,
    is_exempt: profileData.is_exempt === true,
    is_zero_rated: profileData.is_zero_rated === true,
    operation_kind: profileData.operation_kind || null,
    fiscal_notes: String(profileData.fiscal_notes || '').trim() || null,
    limit_rule: String(profileData.limit_rule || '').trim() || null,
    risk_level: profileData.risk_level || 'medio',
    is_active: profileData.is_active !== false,
    updated_at: new Date().toISOString(),
  }
  if (!payload.code) throw new Error('Codigo fiscal requerido')
  if (!payload.name) throw new Error('Nombre fiscal requerido')
  if (profileData.id) {
    const { error } = await supabase
      .from('fiscal_profiles')
      .update(payload)
      .eq('id', profileData.id)
      .eq('organization_id', profile.organization_id)
    if (error) throw new Error(error.message)
    return profileData.id
  }
  const { data, error } = await supabase
    .from('fiscal_profiles')
    .insert({ organization_id: profile.organization_id, ...payload })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function getAccountingPeriods() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('start_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function updateAccountingPeriodStatus(periodId, status, close_notes = '') {
  const profile = await getProfile()
  const payload = {
    status,
    close_notes: close_notes || null,
    updated_at: new Date().toISOString(),
  }
  if (status !== 'abierto') {
    payload.closed_by = profile.id
    payload.closed_at = new Date().toISOString()
  } else {
    payload.closed_by = null
    payload.closed_at = null
  }
  const { error } = await supabase
    .from('accounting_periods')
    .update(payload)
    .eq('id', periodId)
    .eq('organization_id', profile.organization_id)
  if (error) throw new Error(error.message)
}

export async function getAccountingEventTypes() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('accounting_event_types')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('module')
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveAccountingEventType(eventType) {
  const profile = await getProfile()
  const payload = {
    code: String(eventType.code || '').trim().toUpperCase(),
    name: String(eventType.name || '').trim(),
    module: String(eventType.module || '').trim().toLowerCase(),
    description: String(eventType.description || '').trim() || null,
    default_posting_mode: eventType.default_posting_mode || 'automatico',
    requires_review: eventType.requires_review === true,
    is_active: eventType.is_active !== false,
    updated_at: new Date().toISOString(),
  }
  if (!payload.code) throw new Error('Codigo de evento requerido')
  if (!payload.name) throw new Error('Nombre de evento requerido')
  if (!payload.module) throw new Error('Modulo requerido')
  if (eventType.id) {
    const { error } = await supabase
      .from('accounting_event_types')
      .update(payload)
      .eq('id', eventType.id)
      .eq('organization_id', profile.organization_id)
    if (error) throw new Error(error.message)
    return eventType.id
  }
  const { data, error } = await supabase
    .from('accounting_event_types')
    .insert({ organization_id: profile.organization_id, ...payload })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function getAccountingSourceLinks(dateFrom, dateTo) {
  const profile = await getProfile()
  let query = supabase
    .from('accounting_source_links')
    .select(`
      id, source_type, source_id, event_code, created_at,
      journal_entries ( id, entry_number, entry_date, description, posting_status, status )
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
  if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`)
  if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

export async function getAccountingTemplates() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('accounting_entry_templates')
    .select(`
      id, code, name, event_code, description, posting_mode, is_active,
      accounting_template_lines (
        id, line_no, side, account_mode, account_value, amount_mode, amount_value, description_template, cost_center_mode, cost_center_value, tax_code, allow_zero
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('event_code')
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function getAccountingPostingRules() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('accounting_posting_rules')
    .select(`
      id, event_code, priority, condition_key, condition_value, is_active,
      accounting_entry_templates ( id, code, name )
    `)
    .eq('organization_id', profile.organization_id)
    .order('event_code')
    .order('priority')
  if (error) throw new Error(error.message)
  return data || []
}

export async function getTaxConfiguration() {
  const profile = await getProfile()
  await ensureTaxConfiguration(profile.organization_id)
  const { data, error } = await supabase
    .from('tax_configurations')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function saveTaxConfiguration(config) {
  const profile = await getProfile()
  const payload = {
    organization_id: profile.organization_id,
    vat_rate: n(config.vat_rate) || IVA_RATE,
    isr_regime: config.isr_regime || 'utilidades',
    isr_rate: n(config.isr_rate) || 0.25,
    iso_rate: n(config.iso_rate) || 0.01,
    iso_base_mode: config.iso_base_mode || 'mayor',
    export_vat_zero_rate: config.export_vat_zero_rate !== false,
    notes: String(config.notes || '').trim() || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('tax_configurations')
    .upsert(payload, { onConflict: 'organization_id', ignoreDuplicates: false })
  if (error) throw new Error(error.message)
}

export async function getVatReport(month) {
  const profile = await getProfile()
  const normalizedMonth = month || new Date().toISOString().slice(0, 7)
  const dateFrom = `${normalizedMonth}-01`
  const monthEnd = new Date(`${normalizedMonth}-01T00:00:00`)
  monthEnd.setMonth(monthEnd.getMonth() + 1)
  monthEnd.setDate(0)
  const dateTo = monthEnd.toISOString().slice(0, 10)

  const [sales, purchases, accountingVat] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, total, created_at, clients ( commercial_name, nit )')
      .eq('organization_id', profile.organization_id)
      .in('status', ['facturado', 'en_logistica', 'entregado', 'cobrado'])
      .gte('created_at', dateFrom)
      .lte('created_at', `${dateTo}T23:59:59`),
    supabase
      .from('supplier_accounts_payable')
      .select(`
        id, invoice_number, invoice_date, invoice_file_url, invoice_tax_regime,
        invoice_subtotal_amount, invoice_iva_amount, invoice_total_amount,
        suppliers ( id, name, nit, tax_regime )
      `)
      .eq('organization_id', profile.organization_id)
      .not('invoice_number', 'is', null)
      .gte('invoice_date', dateFrom)
      .lte('invoice_date', dateTo),
    supabase
      .from('journal_entry_lines')
      .select(`
        debit, credit, tax_code,
        journal_entries!inner ( organization_id, entry_date, status, posting_status )
      `)
      .eq('journal_entries.organization_id', profile.organization_id)
      .eq('journal_entries.status', 'confirmado')
      .in('journal_entries.posting_status', ['posteado', 'borrador'])
      .in('tax_code', ['IVA_DB', 'IVA_CF'])
      .gte('journal_entries.entry_date', dateFrom)
      .lte('journal_entries.entry_date', dateTo),
  ])

  if (sales.error) throw new Error(sales.error.message)
  if (purchases.error) throw new Error(purchases.error.message)
  if (accountingVat.error) throw new Error(accountingVat.error.message)

  const salesRows = (sales.data || []).map((row) => {
    const totals = ivaCalc(n(row.total))
    return { ...row, ...totals }
  })

  const purchaseRows = (purchases.data || []).map((row) => {
    const acreditable = !!row.invoice_file_url && row.invoice_tax_regime !== 'pequeno_contribuyente'
    const risk =
      !row.invoice_file_url ? 'Sin factura adjunta'
        : row.invoice_tax_regime === 'pequeno_contribuyente' ? 'Proveedor no acreditable'
          : null
    return { ...row, acreditable, risk }
  })

  const debitVat = salesRows.reduce((acc, row) => acc + n(row.iva), 0)
  const creditVat = purchaseRows.reduce((acc, row) => acc + (row.acreditable ? n(row.invoice_iva_amount) : 0), 0)
  const accountingDebit = (accountingVat.data || []).reduce((acc, row) => acc + (row.tax_code === 'IVA_DB' ? n(row.credit) : 0), 0)
  const accountingCredit = (accountingVat.data || []).reduce((acc, row) => acc + (row.tax_code === 'IVA_CF' ? n(row.debit) : 0), 0)

  return {
    month: normalizedMonth,
    salesRows,
    purchaseRows,
    totals: {
      debit_vat: debitVat,
      credit_vat: creditVat,
      payable_or_carry: debitVat - creditVat,
      accounting_debit_vat: accountingDebit,
      accounting_credit_vat: accountingCredit,
      debit_gap: debitVat - accountingDebit,
      credit_gap: creditVat - accountingCredit,
      risk_purchases: purchaseRows.filter((row) => !!row.risk).length,
    },
  }
}

export async function getIsrAdjustments(month) {
  const profile = await getProfile()
  const normalizedMonth = month || new Date().toISOString().slice(0, 7)
  const dateFrom = `${normalizedMonth}-01`
  const monthEnd = new Date(`${normalizedMonth}-01T00:00:00`)
  monthEnd.setMonth(monthEnd.getMonth() + 1)
  monthEnd.setDate(0)
  const dateTo = monthEnd.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('tax_isr_adjustments')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .gte('adjustment_date', dateFrom)
    .lte('adjustment_date', dateTo)
    .order('adjustment_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveIsrAdjustment(adjustment) {
  const profile = await getProfile()
  const payload = {
    organization_id: profile.organization_id,
    adjustment_date: adjustment.adjustment_date || new Date().toISOString().slice(0, 10),
    adjustment_type: adjustment.adjustment_type || 'mas_no_deducible',
    concept: String(adjustment.concept || '').trim(),
    amount: n(adjustment.amount),
    notes: String(adjustment.notes || '').trim() || null,
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  }
  if (!payload.concept) throw new Error('Concepto requerido')
  if (payload.amount < 0) throw new Error('Monto invalido')
  if (adjustment.id) {
    const { error } = await supabase
      .from('tax_isr_adjustments')
      .update(payload)
      .eq('id', adjustment.id)
      .eq('organization_id', profile.organization_id)
    if (error) throw new Error(error.message)
    return adjustment.id
  }
  const { data, error } = await supabase
    .from('tax_isr_adjustments')
    .insert(payload)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

export async function getIsrProjection(month) {
  const config = await getTaxConfiguration()
  const normalizedMonth = month || new Date().toISOString().slice(0, 7)
  const dateFrom = `${normalizedMonth}-01`
  const monthEnd = new Date(`${normalizedMonth}-01T00:00:00`)
  monthEnd.setMonth(monthEnd.getMonth() + 1)
  monthEnd.setDate(0)
  const dateTo = monthEnd.toISOString().slice(0, 10)

  const [sales, purchases, expenses, adjustments] = await Promise.all([
    getSalesLedger(dateFrom, dateTo),
    supabase
      .from('supplier_accounts_payable')
      .select('invoice_subtotal_amount, invoice_number, invoice_date, invoice_file_url')
      .eq('organization_id', (await getProfile()).organization_id)
      .not('invoice_number', 'is', null)
      .gte('invoice_date', dateFrom)
      .lte('invoice_date', dateTo),
    supabase
      .from('expenses')
      .select('amount, expense_date, invoice_number, invoice_file_url, description')
      .eq('organization_id', (await getProfile()).organization_id)
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo),
    getIsrAdjustments(normalizedMonth),
  ])

  if (purchases.error) throw new Error(purchases.error.message)
  if (expenses.error) throw new Error(expenses.error.message)

  const ingresosGravados = sales.reduce((acc, row) => acc + n(row.base), 0)
  const costoCompras = (purchases.data || []).reduce((acc, row) => acc + n(row.invoice_subtotal_amount), 0)
  const deductibleExpenses = (expenses.data || []).reduce((acc, row) => acc + (row.invoice_number && row.invoice_file_url ? n(row.amount) : 0), 0)
  const nondeductibleExpenses = (expenses.data || []).reduce((acc, row) => acc + (!row.invoice_number || !row.invoice_file_url ? n(row.amount) : 0), 0)
  const masNoDeducible = adjustments.filter((row) => row.adjustment_type === 'mas_no_deducible').reduce((acc, row) => acc + n(row.amount), 0)
  const menosDeduccion = adjustments.filter((row) => row.adjustment_type === 'menos_deduccion').reduce((acc, row) => acc + n(row.amount), 0)
  const utilidadContable = ingresosGravados - costoCompras - deductibleExpenses - nondeductibleExpenses
  const baseImponible = Math.max(0, utilidadContable + nondeductibleExpenses + masNoDeducible - menosDeduccion)
  const projectedIsr = config.isr_regime === 'utilidades'
    ? baseImponible * n(config.isr_rate)
    : ingresosGravados * n(config.isr_rate)

  return {
    month: normalizedMonth,
    totals: {
      ingresos_gravados: ingresosGravados,
      costo_compras: costoCompras,
      gastos_deducibles: deductibleExpenses,
      gastos_no_deducibles: nondeductibleExpenses,
      ajustes_mas: masNoDeducible,
      ajustes_menos: menosDeduccion,
      utilidad_contable: utilidadContable,
      base_imponible: baseImponible,
      isr_proyectado: projectedIsr,
      isr_rate: n(config.isr_rate),
      isr_regime: config.isr_regime,
    },
    adjustments,
  }
}

async function getAccountBalancesUntil(orgId, endDate) {
  const { data, error } = await supabase
    .from('journal_entry_lines')
    .select(`
      debit, credit,
      accounting_accounts!inner ( account_type ),
      journal_entries!inner ( organization_id, entry_date, status, posting_status )
    `)
    .eq('journal_entries.organization_id', orgId)
    .eq('journal_entries.status', 'confirmado')
    .in('journal_entries.posting_status', ['posteado', 'borrador'])
    .lte('journal_entries.entry_date', endDate)
  if (error) throw new Error(error.message)

  return (data || []).reduce((acc, row) => {
    const type = row.accounting_accounts?.account_type
    const debit = n(row.debit)
    const credit = n(row.credit)
    if (!acc[type]) acc[type] = 0
    if (['activo', 'egreso', 'costo'].includes(type)) acc[type] += debit - credit
    else acc[type] += credit - debit
    return acc
  }, {})
}

export async function getIsoDashboard(year) {
  const profile = await getProfile()
  const config = await getTaxConfiguration()
  const fiscalYear = Number(year) || new Date().getFullYear()
  await ensureIsoPeriods(profile.organization_id, fiscalYear)

  const { data: periods, error } = await supabase
    .from('tax_iso_periods')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('fiscal_year', fiscalYear)
    .order('fiscal_quarter')
  if (error) throw new Error(error.message)

  const rows = []
  for (const period of periods || []) {
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('total, created_at')
      .eq('organization_id', profile.organization_id)
      .in('status', ['facturado', 'en_logistica', 'entregado', 'cobrado'])
      .gte('created_at', period.start_date)
      .lte('created_at', `${period.end_date}T23:59:59`)
    if (orderError) throw new Error(orderError.message)

    const balances = await getAccountBalancesUntil(profile.organization_id, period.end_date)
    const grossIncomeBase = (orders || []).reduce((acc, row) => acc + n(row.total), 0)
    const netAssetsBase = Math.max(0, n(balances.activo) - n(balances.pasivo))
    const selectedBase = config.iso_base_mode === 'ingresos_brutos'
      ? grossIncomeBase
      : config.iso_base_mode === 'activos_netos'
        ? netAssetsBase
        : Math.max(grossIncomeBase, netAssetsBase)
    const projectedTax = selectedBase * n(config.iso_rate)

    rows.push({
      ...period,
      gross_income_base: grossIncomeBase,
      net_assets_base: netAssetsBase,
      selected_base: selectedBase,
      projected_tax: projectedTax,
      pending_tax: projectedTax - n(period.paid_amount) - n(period.compensated_amount),
    })
  }

  return {
    year: fiscalYear,
    iso_rate: n(config.iso_rate),
    iso_base_mode: config.iso_base_mode,
    rows,
  }
}

function round2(value) {
  return Math.round(n(value) * 100) / 100
}

function round4(value) {
  return Math.round(n(value) * 10000) / 10000
}

function safePct(amount, base) {
  return n(base) > 0 ? round4((n(amount) / n(base)) * 100) : 0
}

function buildMarginRow(row) {
  const revenue = round2(row.revenue_amount)
  const production = round2(row.production_cost)
  const logistics = round2(row.logistics_cost)
  const total = round2(production + logistics)
  const margin = round2(revenue - total)
  return {
    ...row,
    quantity: round4(row.quantity),
    weight_lb: round4(row.weight_lb),
    revenue_amount: revenue,
    production_cost: production,
    logistics_cost: logistics,
    total_cost: total,
    margin_amount: margin,
    margin_pct: safePct(margin, revenue),
  }
}

export async function getIndustrialCostReport(dateFrom, dateTo) {
  const profile = await getProfile()
  const from = dateFrom || `${new Date().toISOString().slice(0, 7)}-01`
  const to = dateTo || new Date().toISOString().slice(0, 10)
  const soldStatuses = ['despachado', 'en_logistica', 'entregado', 'cobrado', 'facturado']

  const [
    packagingRunsRes,
    currentFinishedRes,
    currentProcessedRes,
    ordersRes,
  ] = await Promise.all([
    supabase
      .from('packaging_runs')
      .select(`
        id, run_date, quantity_produced, packed_weight_lb, waste_weight_lb, waste_percentage, total_cost,
        product_presentation_id,
        product_presentations ( code, display_name )
      `)
      .eq('organization_id', profile.organization_id)
      .gte('run_date', from)
      .lte('run_date', to),
    supabase
      .from('finished_inventory_lots')
      .select(`
        id, available_quantity, unit_cost, finished_lot_code, product_presentation_id,
        product_presentations ( code, display_name )
      `)
      .eq('organization_id', profile.organization_id)
      .gt('available_quantity', 0),
    supabase
      .from('processed_inventory_lots')
      .select('id, available_quantity, original_quantity, accumulated_cost')
      .eq('organization_id', profile.organization_id)
      .gt('available_quantity', 0),
    supabase
      .from('orders')
      .select(`
        id, order_number, total, delivery_date, status, client_id,
        clients ( id, commercial_name ),
        order_items (
          id, product_presentation_id, quantity, quantity_packed, quantity_delivered, unit_price, subtotal,
          product_presentations ( code, display_name )
        )
      `)
      .eq('organization_id', profile.organization_id)
      .in('status', soldStatuses)
      .gte('delivery_date', from)
      .lte('delivery_date', to)
      .order('delivery_date', { ascending: false }),
  ])

  if (packagingRunsRes.error) throw new Error(packagingRunsRes.error.message)
  if (currentFinishedRes.error) throw new Error(currentFinishedRes.error.message)
  if (currentProcessedRes.error) throw new Error(currentProcessedRes.error.message)
  if (ordersRes.error) throw new Error(ordersRes.error.message)

  const packagingRuns = packagingRunsRes.data || []
  const currentFinishedLots = currentFinishedRes.data || []
  const currentProcessedLots = currentProcessedRes.data || []
  const orders = ordersRes.data || []
  const orderIds = orders.map((row) => row.id)

  const [packingsRes, routeOrdersRes] = orderIds.length
    ? await Promise.all([
        supabase
          .from('order_packings')
          .select(`
            id, order_id, order_item_id, finished_inventory_lot_id, quantity_packed,
            finished_inventory_lots (
              id, finished_lot_code, unit_cost, total_cost, original_quantity, production_date, product_presentation_id,
              product_presentations ( code, display_name )
            )
          `)
          .in('order_id', orderIds),
        supabase
          .from('ruta_pedidos')
          .select(`
            id, ruta_id, order_id, client_id, allocated_total_cost,
            rutas ( id, route_number, route_name, route_date )
          `)
          .eq('organization_id', profile.organization_id)
          .in('order_id', orderIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  if (packingsRes.error) throw new Error(packingsRes.error.message)
  if (routeOrdersRes.error) throw new Error(routeOrdersRes.error.message)

  const packings = packingsRes.data || []
  const routeOrders = routeOrdersRes.data || []

  const packingsByItem = {}
  const routeCostByOrder = {}
  const routeMetaByOrder = {}

  for (const packing of packings) {
    if (!packingsByItem[packing.order_item_id]) packingsByItem[packing.order_item_id] = []
    packingsByItem[packing.order_item_id].push(packing)
  }

  for (const routeOrder of routeOrders) {
    routeCostByOrder[routeOrder.order_id] = round2(n(routeCostByOrder[routeOrder.order_id]) + n(routeOrder.allocated_total_cost))
    if (!routeMetaByOrder[routeOrder.order_id] && routeOrder.rutas?.id) {
      routeMetaByOrder[routeOrder.order_id] = {
        route_id: routeOrder.rutas.id,
        route_code: routeOrder.rutas.route_name || `Ruta #${routeOrder.rutas.route_number}`,
        route_name: routeOrder.rutas.route_name || `Ruta #${routeOrder.rutas.route_number}`,
        route_date: routeOrder.rutas.route_date,
      }
    }
  }

  const skuMap = {}
  const orderRows = []
  const clientMap = {}
  const routeMap = {}
  const lotMap = {}

  for (const order of orders) {
    const items = order.order_items || []
    const itemRows = items.map((item) => {
      const soldQty = round4(n(item.quantity_delivered) || n(item.quantity_packed) || n(item.quantity))
      const revenue = round2(soldQty * n(item.unit_price))
      const itemPackings = packingsByItem[item.id] || []
      const productionCost = round2(
        itemPackings.reduce(
          (acc, packing) => acc + n(packing.quantity_packed) * n(packing.finished_inventory_lots?.unit_cost),
          0,
        ),
      )

      return {
        item_id: item.id,
        product_presentation_id: item.product_presentation_id,
        sku_code: item.product_presentations?.code || '',
        sku_name: item.product_presentations?.display_name || 'SKU',
        quantity: soldQty,
        revenue_amount: revenue,
        production_cost: productionCost,
        packings: itemPackings,
      }
    })

    const orderRevenue = round2(itemRows.reduce((acc, row) => acc + n(row.revenue_amount), 0))
    const orderProduction = round2(itemRows.reduce((acc, row) => acc + n(row.production_cost), 0))
    const orderLogistics = round2(routeCostByOrder[order.id])

    for (const itemRow of itemRows) {
      const allocationBase = orderRevenue > 0 ? n(itemRow.revenue_amount) / orderRevenue : 1 / Math.max(1, itemRows.length)
      const itemLogistics = round2(orderLogistics * allocationBase)
      const marginRow = buildMarginRow({
        quantity: itemRow.quantity,
        weight_lb: 0,
        revenue_amount: itemRow.revenue_amount,
        production_cost: itemRow.production_cost,
        logistics_cost: itemLogistics,
      })

      if (!skuMap[itemRow.product_presentation_id]) {
        skuMap[itemRow.product_presentation_id] = {
          product_presentation_id: itemRow.product_presentation_id,
          source_code: itemRow.sku_code,
          source_name: itemRow.sku_name,
          quantity: 0,
          weight_lb: 0,
          revenue_amount: 0,
          production_cost: 0,
          logistics_cost: 0,
        }
      }

      skuMap[itemRow.product_presentation_id].quantity += n(marginRow.quantity)
      skuMap[itemRow.product_presentation_id].revenue_amount += n(marginRow.revenue_amount)
      skuMap[itemRow.product_presentation_id].production_cost += n(marginRow.production_cost)
      skuMap[itemRow.product_presentation_id].logistics_cost += n(marginRow.logistics_cost)

      for (const packing of itemRow.packings) {
        const packingShare = n(itemRow.quantity) > 0 ? n(packing.quantity_packed) / n(itemRow.quantity) : 0
        const lotId = packing.finished_inventory_lots?.id || packing.finished_inventory_lot_id
        if (!lotId) continue
        if (!lotMap[lotId]) {
          lotMap[lotId] = {
            finished_inventory_lot_id: lotId,
            product_presentation_id: packing.finished_inventory_lots?.product_presentation_id || itemRow.product_presentation_id,
            source_code: packing.finished_inventory_lots?.finished_lot_code || 'Lote',
            source_name: packing.finished_inventory_lots?.product_presentations?.display_name || itemRow.sku_name,
            quantity: 0,
            weight_lb: 0,
            revenue_amount: 0,
            production_cost: 0,
            logistics_cost: 0,
          }
        }
        lotMap[lotId].quantity += n(packing.quantity_packed)
        lotMap[lotId].revenue_amount += n(itemRow.revenue_amount) * packingShare
        lotMap[lotId].production_cost += n(packing.quantity_packed) * n(packing.finished_inventory_lots?.unit_cost)
        lotMap[lotId].logistics_cost += n(itemLogistics) * packingShare
      }
    }

    const orderMarginRow = buildMarginRow({
      order_id: order.id,
      source_code: `#${order.order_number}`,
      source_name: order.clients?.commercial_name || `Cliente ${String(order.client_id || '').slice(0, 6)}`,
      client_id: order.client_id || null,
      route_id: routeMetaByOrder[order.id]?.route_id || null,
      route_code: routeMetaByOrder[order.id]?.route_code || null,
      route_name: routeMetaByOrder[order.id]?.route_name || null,
      route_date: routeMetaByOrder[order.id]?.route_date || null,
      quantity: itemRows.reduce((acc, row) => acc + n(row.quantity), 0),
      weight_lb: 0,
      revenue_amount: orderRevenue || n(order.total),
      production_cost: orderProduction,
      logistics_cost: orderLogistics,
    })

    orderRows.push({
      ...orderMarginRow,
      order_number: order.order_number,
      delivery_date: order.delivery_date,
      status: order.status,
      client_name: order.clients?.commercial_name || 'Cliente',
    })

    if (order.client_id) {
      if (!clientMap[order.client_id]) {
        clientMap[order.client_id] = {
          client_id: order.client_id,
          source_code: order.clients?.commercial_name || `Cliente ${String(order.client_id).slice(0, 6)}`,
          source_name: order.clients?.commercial_name || 'Cliente',
          quantity: 0,
          weight_lb: 0,
          revenue_amount: 0,
          production_cost: 0,
          logistics_cost: 0,
        }
      }
      clientMap[order.client_id].quantity += n(orderMarginRow.quantity)
      clientMap[order.client_id].revenue_amount += n(orderMarginRow.revenue_amount)
      clientMap[order.client_id].production_cost += n(orderMarginRow.production_cost)
      clientMap[order.client_id].logistics_cost += n(orderMarginRow.logistics_cost)
    }

    const routeMeta = routeMetaByOrder[order.id]
    if (routeMeta?.route_id) {
      if (!routeMap[routeMeta.route_id]) {
        routeMap[routeMeta.route_id] = {
          route_id: routeMeta.route_id,
          source_code: routeMeta.route_code,
          source_name: routeMeta.route_name,
          quantity: 0,
          weight_lb: 0,
          revenue_amount: 0,
          production_cost: 0,
          logistics_cost: 0,
        }
      }
      routeMap[routeMeta.route_id].quantity += n(orderMarginRow.quantity)
      routeMap[routeMeta.route_id].revenue_amount += n(orderMarginRow.revenue_amount)
      routeMap[routeMeta.route_id].production_cost += n(orderMarginRow.production_cost)
      routeMap[routeMeta.route_id].logistics_cost += n(orderMarginRow.logistics_cost)
    }
  }

  const skuRows = Object.values(skuMap).map(buildMarginRow).sort((a, b) => n(b.revenue_amount) - n(a.revenue_amount))
  const clientRows = Object.values(clientMap).map(buildMarginRow).sort((a, b) => n(b.margin_amount) - n(a.margin_amount))
  const routeRows = Object.values(routeMap).map(buildMarginRow).sort((a, b) => n(b.revenue_amount) - n(a.revenue_amount))
  const lotRows = Object.values(lotMap).map(buildMarginRow).sort((a, b) => n(b.revenue_amount) - n(a.revenue_amount))

  const producedCost = round2(packagingRuns.reduce((acc, row) => acc + n(row.total_cost), 0))
  const producedUnits = round4(packagingRuns.reduce((acc, row) => acc + n(row.quantity_produced), 0))
  const producedWeightLb = round4(packagingRuns.reduce((acc, row) => acc + n(row.packed_weight_lb), 0))
  const wasteLb = round4(packagingRuns.reduce((acc, row) => acc + n(row.waste_weight_lb), 0))
  const averageWastePct = producedWeightLb + wasteLb > 0 ? round4((wasteLb / (producedWeightLb + wasteLb)) * 100) : 0
  const soldRevenue = round2(orderRows.reduce((acc, row) => acc + n(row.revenue_amount), 0))
  const soldProductionCost = round2(orderRows.reduce((acc, row) => acc + n(row.production_cost), 0))
  const soldLogisticsCost = round2(orderRows.reduce((acc, row) => acc + n(row.logistics_cost), 0))
  const grossMargin = round2(soldRevenue - soldProductionCost - soldLogisticsCost)
  const finishedInventoryValue = round2(currentFinishedLots.reduce((acc, row) => acc + n(row.available_quantity) * n(row.unit_cost), 0))
  const processedInventoryValue = round2(currentProcessedLots.reduce((acc, row) => {
    const denominator = n(row.original_quantity) > 0 ? n(row.original_quantity) : n(row.available_quantity)
    const unitCost = denominator > 0 ? n(row.accumulated_cost) / denominator : 0
    return acc + n(row.available_quantity) * unitCost
  }, 0))

  const productionBySku = packagingRuns.reduce((acc, row) => {
    const key = row.product_presentation_id
    if (!key) return acc
    if (!acc[key]) {
      acc[key] = {
        produced_units: 0,
        produced_weight_lb: 0,
        produced_cost: 0,
      }
    }
    acc[key].produced_units += n(row.quantity_produced)
    acc[key].produced_weight_lb += n(row.packed_weight_lb)
    acc[key].produced_cost += n(row.total_cost)
    return acc
  }, {})

  const skuRowsMerged = skuRows.map((row) => ({
    ...row,
    produced_units: round4(productionBySku[row.product_presentation_id]?.produced_units),
    produced_weight_lb: round4(productionBySku[row.product_presentation_id]?.produced_weight_lb),
    produced_cost: round2(productionBySku[row.product_presentation_id]?.produced_cost),
  }))

  return {
    date_from: from,
    date_to: to,
    totals: {
      produced_cost: producedCost,
      produced_units: producedUnits,
      produced_weight_lb: producedWeightLb,
      waste_lb: wasteLb,
      waste_pct: averageWastePct,
      sold_revenue: soldRevenue,
      sold_production_cost: soldProductionCost,
      sold_logistics_cost: soldLogisticsCost,
      sold_total_cost: round2(soldProductionCost + soldLogisticsCost),
      gross_margin: grossMargin,
      gross_margin_pct: safePct(grossMargin, soldRevenue),
      finished_inventory_value: finishedInventoryValue,
      processed_inventory_value: processedInventoryValue,
      produced_cost_per_lb: producedWeightLb > 0 ? round4(producedCost / producedWeightLb) : 0,
    },
    skuRows: skuRowsMerged,
    orderRows: orderRows.sort((a, b) => n(b.revenue_amount) - n(a.revenue_amount)),
    clientRows,
    routeRows,
    lotRows,
  }
}

export async function saveIndustrialCostSnapshots(dateFrom, dateTo) {
  const profile = await getProfile()
  const report = await getIndustrialCostReport(dateFrom, dateTo)
  const rows = []

  rows.push({
    organization_id: profile.organization_id,
    snapshot_date: new Date().toISOString().slice(0, 10),
    date_from: report.date_from,
    date_to: report.date_to,
    snapshot_kind: 'resumen',
    source_code: `${report.date_from}_${report.date_to}`,
    source_name: 'Resumen industrial',
    quantity: report.totals.produced_units,
    weight_lb: report.totals.produced_weight_lb,
    revenue_amount: report.totals.sold_revenue,
    production_cost: report.totals.sold_production_cost,
    logistics_cost: report.totals.sold_logistics_cost,
    total_cost: report.totals.sold_total_cost,
    margin_amount: report.totals.gross_margin,
    margin_pct: report.totals.gross_margin_pct,
    extra_data: {
      waste_lb: report.totals.waste_lb,
      waste_pct: report.totals.waste_pct,
      finished_inventory_value: report.totals.finished_inventory_value,
      processed_inventory_value: report.totals.processed_inventory_value,
      produced_cost: report.totals.produced_cost,
      produced_cost_per_lb: report.totals.produced_cost_per_lb,
    },
    created_by: profile.id,
  })

  for (const row of report.skuRows) {
    rows.push({
      organization_id: profile.organization_id,
      snapshot_date: new Date().toISOString().slice(0, 10),
      date_from: report.date_from,
      date_to: report.date_to,
      snapshot_kind: 'sku',
      source_id: row.product_presentation_id || null,
      source_code: row.source_code,
      source_name: row.source_name,
      product_presentation_id: row.product_presentation_id || null,
      quantity: row.quantity,
      weight_lb: row.produced_weight_lb || 0,
      revenue_amount: row.revenue_amount,
      production_cost: row.production_cost,
      logistics_cost: row.logistics_cost,
      total_cost: row.total_cost,
      margin_amount: row.margin_amount,
      margin_pct: row.margin_pct,
      extra_data: {
        produced_units: row.produced_units || 0,
        produced_cost: row.produced_cost || 0,
      },
      created_by: profile.id,
    })
  }

  for (const row of report.orderRows) {
    rows.push({
      organization_id: profile.organization_id,
      snapshot_date: new Date().toISOString().slice(0, 10),
      date_from: report.date_from,
      date_to: report.date_to,
      snapshot_kind: 'pedido',
      source_id: row.order_id,
      source_code: row.source_code,
      source_name: row.client_name,
      client_id: row.client_id || null,
      route_id: row.route_id || null,
      quantity: row.quantity,
      revenue_amount: row.revenue_amount,
      production_cost: row.production_cost,
      logistics_cost: row.logistics_cost,
      total_cost: row.total_cost,
      margin_amount: row.margin_amount,
      margin_pct: row.margin_pct,
      extra_data: {
        delivery_date: row.delivery_date,
        status: row.status,
        route_code: row.route_code || null,
      },
      created_by: profile.id,
    })
  }

  for (const row of report.clientRows) {
    rows.push({
      organization_id: profile.organization_id,
      snapshot_date: new Date().toISOString().slice(0, 10),
      date_from: report.date_from,
      date_to: report.date_to,
      snapshot_kind: 'cliente',
      source_id: row.client_id || null,
      source_code: row.source_code,
      source_name: row.source_name,
      client_id: row.client_id || null,
      quantity: row.quantity,
      revenue_amount: row.revenue_amount,
      production_cost: row.production_cost,
      logistics_cost: row.logistics_cost,
      total_cost: row.total_cost,
      margin_amount: row.margin_amount,
      margin_pct: row.margin_pct,
      created_by: profile.id,
    })
  }

  for (const row of report.routeRows) {
    rows.push({
      organization_id: profile.organization_id,
      snapshot_date: new Date().toISOString().slice(0, 10),
      date_from: report.date_from,
      date_to: report.date_to,
      snapshot_kind: 'ruta',
      source_id: row.route_id || null,
      source_code: row.source_code,
      source_name: row.source_name,
      route_id: row.route_id || null,
      quantity: row.quantity,
      revenue_amount: row.revenue_amount,
      production_cost: row.production_cost,
      logistics_cost: row.logistics_cost,
      total_cost: row.total_cost,
      margin_amount: row.margin_amount,
      margin_pct: row.margin_pct,
      created_by: profile.id,
    })
  }

  for (const row of report.lotRows) {
    rows.push({
      organization_id: profile.organization_id,
      snapshot_date: new Date().toISOString().slice(0, 10),
      date_from: report.date_from,
      date_to: report.date_to,
      snapshot_kind: 'lote_terminado',
      source_id: row.finished_inventory_lot_id || null,
      source_code: row.source_code,
      source_name: row.source_name,
      product_presentation_id: row.product_presentation_id || null,
      finished_inventory_lot_id: row.finished_inventory_lot_id || null,
      quantity: row.quantity,
      revenue_amount: row.revenue_amount,
      production_cost: row.production_cost,
      logistics_cost: row.logistics_cost,
      total_cost: row.total_cost,
      margin_amount: row.margin_amount,
      margin_pct: row.margin_pct,
      created_by: profile.id,
    })
  }

  const { error: deleteError } = await supabase
    .from('industrial_cost_snapshots')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('date_from', report.date_from)
    .eq('date_to', report.date_to)

  if (deleteError) throw new Error(deleteError.message)

  if (rows.length) {
    const { error: insertError } = await supabase
      .from('industrial_cost_snapshots')
      .insert(rows)
    if (insertError) throw new Error(insertError.message)
  }

  return { saved_rows: rows.length, ...report }
}

async function getNextBankAccountingCode(orgId) {
  const { data, error } = await supabase
    .from('accounting_accounts')
    .select('code')
    .eq('organization_id', orgId)
    .like('code', '112%')

  if (error) throw new Error(error.message)

  const maxCode = (data || []).reduce((max, row) => {
    const parsed = parseInt(row.code, 10)
    return Number.isNaN(parsed) ? max : Math.max(max, parsed)
  }, 1120)

  return String(maxCode + 1)
}

export async function getBankAccounts(includeInactive = false) {
  const profile = await getProfile()
  let query = supabase
    .from('bank_accounts')
    .select(`
      id,
      name,
      bank_name,
      account_number,
      currency,
      opening_balance,
      opening_balance_date,
      is_active,
      accounting_account_id,
      accounting_accounts (
        id,
        code,
        name
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('bank_name')

  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

async function getBankAccountById(profile, bankAccountId) {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select(`
      id,
      name,
      bank_name,
      account_number,
      accounting_account_id
    `)
    .eq('organization_id', profile.organization_id)
    .eq('id', bankAccountId)
    .single()

  if (error) throw new Error(error.message)
  return data
}

function getFileExtension(file) {
  const raw = (file?.name || '').split('.').pop()?.trim().toLowerCase()
  if (!raw) return 'pdf'
  return raw.replace(/[^a-z0-9]/g, '') || 'pdf'
}

async function uploadBankTransferReceipt(file, transferId) {
  const { data: { user } } = await supabase.auth.getUser()
  const ext = getFileExtension(file)
  const path = `${user.id}/${transferId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('bank-transfer-receipts')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('bank-transfer-receipts').getPublicUrl(path)
  return data.publicUrl
}

export async function saveBankAccount({
  id,
  name,
  bank_name,
  account_number,
  currency = 'GTQ',
  opening_balance = 0,
  opening_balance_date,
}) {
  const profile = await getProfile()
  const cleanName = String(name || '').trim()
  const cleanBankName = String(bank_name || '').trim()
  const cleanAccountNumber = String(account_number || '').trim()
  const cleanCurrency = String(currency || 'GTQ').trim().toUpperCase() || 'GTQ'
  const cleanOpeningBalance = n(opening_balance)
  const cleanOpeningBalanceDate = opening_balance_date || new Date().toISOString().slice(0, 10)

  if (!cleanName) throw new Error('Debes ingresar un nombre interno para la cuenta bancaria')
  if (!cleanBankName) throw new Error('Debes ingresar el banco')
  if (!cleanAccountNumber) throw new Error('Debes ingresar el numero de cuenta')

  if (id) {
    const { data: existing, error: loadError } = await supabase
      .from('bank_accounts')
      .select('id, accounting_account_id')
      .eq('id', id)
      .eq('organization_id', profile.organization_id)
      .single()

    if (loadError) throw new Error(loadError.message)

    const { error } = await supabase
      .from('bank_accounts')
      .update({
        name: cleanName,
        bank_name: cleanBankName,
        account_number: cleanAccountNumber,
        currency: cleanCurrency,
        opening_balance: cleanOpeningBalance,
        opening_balance_date: cleanOpeningBalanceDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) throw new Error(error.message)

    if (existing?.accounting_account_id) {
      const { error: accountError } = await supabase
        .from('accounting_accounts')
        .update({
          name: `${cleanName} (${cleanBankName} ${cleanAccountNumber})`,
        })
        .eq('id', existing.accounting_account_id)

      if (accountError) throw new Error(accountError.message)
    }

    return id
  }

  const nextCode = await getNextBankAccountingCode(profile.organization_id)
  const accountingName = `${cleanName} (${cleanBankName} ${cleanAccountNumber})`

  const { data: account, error: accountError } = await supabase
    .from('accounting_accounts')
    .insert({
      organization_id: profile.organization_id,
      code: nextCode,
      name: accountingName,
      account_type: 'activo',
      normal_balance: 'debito',
      is_active: true,
    })
    .select('id')
    .single()

  if (accountError) throw new Error(accountError.message)

  const { data: bankAccount, error } = await supabase
    .from('bank_accounts')
    .insert({
      organization_id: profile.organization_id,
      accounting_account_id: account.id,
      name: cleanName,
      bank_name: cleanBankName,
      account_number: cleanAccountNumber,
      currency: cleanCurrency,
      opening_balance: cleanOpeningBalance,
      opening_balance_date: cleanOpeningBalanceDate,
      is_active: true,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return bankAccount.id
}

export async function toggleBankAccountActive(id, is_active) {
  const { data: bankAccount, error: loadError } = await supabase
    .from('bank_accounts')
    .select('id, accounting_account_id')
    .eq('id', id)
    .single()

  if (loadError) throw new Error(loadError.message)

  const { error } = await supabase
    .from('bank_accounts')
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)

  if (bankAccount?.accounting_account_id) {
    const { error: accountError } = await supabase
      .from('accounting_accounts')
      .update({ is_active })
      .eq('id', bankAccount.accounting_account_id)

    if (accountError) throw new Error(accountError.message)
  }
}

export async function createBankTransfer({
  transfer_date,
  from_bank_account_id,
  to_bank_account_id,
  amount,
  reference_number,
  receipt_file,
  notes,
}) {
  const profile = await getProfile()
  const cleanAmount = n(amount)
  const cleanReference = String(reference_number || '').trim()
  const cleanDate = transfer_date || new Date().toISOString().slice(0, 10)
  const cleanNotes = String(notes || '').trim()

  if (!from_bank_account_id) throw new Error('Debes seleccionar la cuenta origen')
  if (!to_bank_account_id) throw new Error('Debes seleccionar la cuenta destino')
  if (from_bank_account_id === to_bank_account_id) throw new Error('La cuenta origen y destino deben ser distintas')
  if (cleanAmount <= 0) throw new Error('El monto de la transferencia debe ser mayor a cero')
  if (!cleanReference) throw new Error('Debes ingresar el numero de boleta o referencia')
  if (!receipt_file) throw new Error('Debes adjuntar la boleta de deposito en PDF')

  const [fromAccount, toAccount] = await Promise.all([
    getBankAccountById(profile, from_bank_account_id),
    getBankAccountById(profile, to_bank_account_id),
  ])

  const { data: transfer, error: transferError } = await supabase
    .from('bank_transfers')
    .insert({
      organization_id: profile.organization_id,
      transfer_date: cleanDate,
      from_bank_account_id,
      to_bank_account_id,
      amount: cleanAmount,
      reference_number: cleanReference,
      notes: cleanNotes || null,
      created_by: profile.id,
    })
    .select()
    .single()

  if (transferError) throw new Error(transferError.message)

  const receiptFileUrl = await uploadBankTransferReceipt(receipt_file, transfer.id)

  const { data: updatedTransfer, error: updateTransferError } = await supabase
    .from('bank_transfers')
    .update({
      receipt_file_url: receiptFileUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transfer.id)
    .select()
    .single()

  if (updateTransferError) throw new Error(updateTransferError.message)

  const entryId = await postAccountingEvent({
    eventCode: 'TRANSFERENCIA_BANCARIA',
    entryDate: cleanDate,
    description: `Transferencia bancaria ${cleanReference}: ${fromAccount.name} a ${toAccount.name}`,
    referenceType: 'ajuste',
    referenceId: transfer.id,
    sourceType: 'bank_transfer',
    sourceId: transfer.id,
    payload: {
      amount: cleanAmount,
      reference_number: cleanReference,
      from_accounting_account_id: fromAccount.accounting_account_id,
      to_accounting_account_id: toAccount.accounting_account_id,
    },
  })

  const { error: journalLinkError } = await supabase
    .from('bank_transfers')
    .update({
      journal_entry_id: entryId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transfer.id)

  if (journalLinkError) throw new Error(journalLinkError.message)

  return updatedTransfer
}

// ─── Centros de costo ─────────────────────────────────────────────────────────

/** Solo activos (para dropdowns en formularios) */
export async function getCostCenters() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('cost_centers')
    .select('id, code, name, description, parent_id, is_active')
    .eq('organization_id', profile.organization_id)
    .eq('is_active', true)
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

/** Todos (activos + inactivos) para la vista de gestión */
export async function getAllCostCenters() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('cost_centers')
    .select('id, code, name, description, parent_id, is_active, created_at')
    .eq('organization_id', profile.organization_id)
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveCostCenter({ id, code, name, description, parent_id }) {
  const profile = await getProfile()
  if (id) {
    const { error } = await supabase.from('cost_centers')
      .update({ code, name, description: description || null, parent_id: parent_id || null })
      .eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('cost_centers')
      .insert({
        organization_id: profile.organization_id,
        code,
        name,
        description: description || null,
        parent_id:   parent_id || null,
        is_active:   true,
      })
    if (error) throw new Error(error.message)
  }
}

export async function toggleCostCenterActive(id, is_active) {
  const { error } = await supabase.from('cost_centers')
    .update({ is_active })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Resolución de CC por código (uso interno de otros servicios) ─────────────

export async function getCostCenterByCode(orgId, code) {
  const { data } = await supabase
    .from('cost_centers')
    .select('id, code')
    .eq('organization_id', orgId)
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle()
  return data || null
}

// ─── Libro de ventas ──────────────────────────────────────────────────────────

export async function getSalesLedger(dateFrom, dateTo) {
  const profile = await getProfile()
  let query = supabase
    .from('orders')
    .select(`
      id, order_number, created_at, delivery_date, status, total,
      clients ( commercial_name, nit )
    `)
    .eq('organization_id', profile.organization_id)
    .in('status', ['facturado', 'en_logistica', 'entregado', 'cobrado'])
    .order('created_at', { ascending: true })

  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo)   query = query.lte('created_at', dateTo + 'T23:59:59')

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data || []).map(o => {
    const { base, iva, total } = ivaCalc(n(o.total))
    return { ...o, base, iva, total }
  })
}

// ─── Asientos contables ───────────────────────────────────────────────────────

export async function getJournalEntries(dateFrom, dateTo) {
  const profile = await getProfile()
  let query = supabase
    .from('journal_entries')
    .select(`
      id, entry_number, entry_date, description, reference_type, reference_id, status, created_at,
      event_code, posting_status, source_type, source_id,
      accounting_periods ( id, period_code, status ),
      journal_entry_lines (
        id, line_no, debit, credit, description, tax_code,
        accounting_accounts ( code, name, account_type ),
        cost_centers ( code, name )
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('entry_date', { ascending: false })

  if (dateFrom) query = query.gte('entry_date', dateFrom)
  if (dateTo)   query = query.lte('entry_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Generar asiento de venta ─────────────────────────────────────────────────

export async function generateSalesEntry(orderId) {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('organization_id', orgId)
    .eq('event_code', 'VENTA_FACTURADA')
    .eq('source_type', 'order')
    .eq('source_id', orderId)
    .maybeSingle()
  if (existing) return

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_number, total, client_id, clients ( id, commercial_name )')
    .eq('id', orderId)
    .single()
  if (orderErr) throw new Error(orderErr.message)

  const { base, iva, total } = ivaCalc(n(order.total))

  const { data: ccs } = await supabase
    .from('cost_centers')
    .select('id, code')
    .eq('organization_id', orgId)
    .in('code', ['CC-02', 'CC-04'])
  const ccMap = {}
  ;(ccs || []).forEach(c => { ccMap[c.code] = c.id })

  return postAccountingEvent({
    eventCode: 'VENTA_FACTURADA',
    entryDate: new Date().toISOString().slice(0, 10),
    description: `Venta Pedido #${order.order_number} - ${order.clients?.commercial_name || 'Cliente'}`,
    referenceType: 'venta',
    referenceId: orderId,
    sourceType: 'order',
    sourceId: orderId,
    payload: {
      total,
      base,
      iva,
      order_number: order.order_number,
      sales_cost_center_id: ccMap['CC-02'] || null,
      admin_cost_center_id: ccMap['CC-04'] || null,
      dimension_order_id: orderId,
      dimension_client_id: order.client_id || order.clients?.id || null,
    },
  })

  /*

  if (!acctMap['1200'] || !acctMap['4100'] || !acctMap['2200']) {
    throw new Error('Catálogo de cuentas incompleto. Inicializa la contabilidad primero.')
  }

  const entryDate = new Date().toISOString().slice(0, 10)
  const period = await getOpenPeriodForDate(orgId, entryDate)

  const { data: entry, error: entryErr } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: orgId,
      entry_date:      entryDate,
      description:     `Venta Pedido #${order.order_number} — ${order.clients?.commercial_name}`,
      reference_type:  'venta',
      reference_id:    orderId,
      event_code:      'VENTA_FACTURADA',
      period_id:       period.id,
      posting_status:  'posteado',
      source_type:     'order',
      source_id:       orderId,
      status:          'confirmado',
      created_by:      profile.id,
    })
    .select()
    .single()
  if (entryErr) throw new Error(entryErr.message)

  // DR 1200 CxC [total]   CC: Comercial
  // CR 4100 Ventas [base] CC: Comercial
  // CR 2200 IVA [iva]     CC: Administración
  const lines = [
    {
      entry_id: entry.id, account_id: acctMap['1200'],
      cost_center_id: ccMap['CC-02'] || null,
      line_no: 1,
      description: `CxC Pedido #${order.order_number}`,
      dimension_order_id: orderId,
      tax_code: 'IVA_DB',
      debit: total, credit: 0,
    },
    {
      entry_id: entry.id, account_id: acctMap['4100'],
      cost_center_id: ccMap['CC-02'] || null,
      line_no: 2,
      description: `Ventas Pedido #${order.order_number}`,
      dimension_order_id: orderId,
      tax_code: 'BASE_ING',
      debit: 0, credit: base,
    },
    {
      entry_id: entry.id, account_id: acctMap['2200'],
      cost_center_id: ccMap['CC-04'] || null,
      line_no: 3,
      description: `IVA 12% Pedido #${order.order_number}`,
      dimension_order_id: orderId,
      tax_code: 'IVA_DB',
      debit: 0, credit: iva,
    },
  ]

  const { error: linesErr } = await supabase.from('journal_entry_lines').insert(lines)
  if (linesErr) throw new Error(linesErr.message)

  await upsertAccountingSourceLink({
    organizationId: orgId,
    sourceType: 'order',
    sourceId: orderId,
    eventCode: 'VENTA_FACTURADA',
    journalEntryId: entry.id,
  })
  */
}

// ─── Resumen por centro de costo ──────────────────────────────────────────────

export async function getCostCenterSummary(dateFrom, dateTo) {
  const profile = await getProfile()
  let query = supabase
    .from('journal_entry_lines')
    .select(`
      debit, credit,
      cost_centers ( id, code, name ),
      journal_entries!inner ( organization_id, entry_date, status )
    `)
    .eq('journal_entries.organization_id', profile.organization_id)
    .eq('journal_entries.status', 'confirmado')

  if (dateFrom) query = query.gte('journal_entries.entry_date', dateFrom)
  if (dateTo)   query = query.lte('journal_entries.entry_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const byCC = {}
  ;(data || []).forEach(line => {
    const cc = line.cost_centers
    if (!cc) return
    if (!byCC[cc.id]) byCC[cc.id] = { code: cc.code, name: cc.name, debit: 0, credit: 0 }
    byCC[cc.id].debit  += n(line.debit)
    byCC[cc.id].credit += n(line.credit)
  })

  return Object.values(byCC).sort((a, b) => a.code.localeCompare(b.code))
}

function mapMovementSourceLabel(sourceType) {
  if (sourceType === 'opening_balance') return 'Saldo inicial'
  if (sourceType === 'bank_transfer_out') return 'Transferencia enviada'
  if (sourceType === 'bank_transfer_in') return 'Transferencia recibida'
  if (sourceType === 'cash_box_funding') return 'Fondeo de caja'
  if (sourceType === 'supplier_payment_batch') return 'Pago CxP'
  if (sourceType === 'expense') return 'Pago gasto'
  if (sourceType === 'cxc_collection') return 'Cobro CxC'
  return sourceType
}

async function upsertBankMovements(rows) {
  if (!rows.length) return
  for (const row of rows) {
    if (!row.source_id) {
      const { error: insertError } = await supabase
        .from('bank_movements')
        .insert(row)

      if (insertError) throw new Error(insertError.message)
      continue
    }

    const { data: existing, error: loadError } = await supabase
      .from('bank_movements')
      .select('id')
      .eq('organization_id', row.organization_id)
      .eq('source_type', row.source_type)
      .eq('source_id', row.source_id)
      .maybeSingle()

    if (loadError) throw new Error(loadError.message)

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from('bank_movements')
        .update({
          bank_account_id: row.bank_account_id,
          movement_date: row.movement_date,
          movement_type: row.movement_type,
          debit_amount: row.debit_amount,
          credit_amount: row.credit_amount,
          document_number: row.document_number,
          receipt_file_url: row.receipt_file_url,
          description: row.description,
          created_by: row.created_by,
          updated_at: row.updated_at,
        })
        .eq('id', existing.id)

      if (updateError) throw new Error(updateError.message)
    } else {
      const { error: insertError } = await supabase
        .from('bank_movements')
        .insert(row)

      if (insertError) throw new Error(insertError.message)
    }
  }
}

async function syncOpeningBalanceMovement(profile, bankAccount) {
  const amount = n(bankAccount.opening_balance)
  const sourceId = bankAccount.id

  if (!amount) {
    const { error } = await supabase
      .from('bank_movements')
      .delete()
      .eq('organization_id', profile.organization_id)
      .eq('bank_account_id', bankAccount.id)
      .eq('source_type', 'opening_balance')
      .eq('source_id', sourceId)

    if (error) throw new Error(error.message)
    return
  }

  await upsertBankMovements([
    {
      organization_id: profile.organization_id,
      bank_account_id: bankAccount.id,
      movement_date: bankAccount.opening_balance_date || new Date().toISOString().slice(0, 10),
      movement_type: amount >= 0 ? 'credito' : 'debito',
      debit_amount: amount < 0 ? Math.abs(amount) : 0,
      credit_amount: amount >= 0 ? Math.abs(amount) : 0,
      document_number: 'SALDO INICIAL',
      receipt_file_url: null,
      description: `Saldo inicial ${bankAccount.name}`.trim(),
      source_type: 'opening_balance',
      source_id: sourceId,
      created_by: bankAccount.created_by || profile.id,
      updated_at: new Date().toISOString(),
    },
  ])
}

async function syncSupplierPaymentBatchMovements(profile, bankAccount) {
  const { data, error } = await supabase
    .from('supplier_payment_batches')
    .select(`
      id,
      organization_id,
      payment_reference,
      payment_date,
      total_amount,
      receipt_file_url,
      debit_bank_name,
      debit_account_number,
      bank_account_id,
      created_by,
      suppliers ( name )
    `)
    .eq('organization_id', profile.organization_id)

  if (error) throw new Error(error.message)

  const rows = (data || [])
    .filter((row) =>
      row.bank_account_id === bankAccount.id ||
      (!row.bank_account_id &&
        row.debit_bank_name === bankAccount.bank_name &&
        row.debit_account_number === bankAccount.account_number)
    )
    .map((row) => ({
      organization_id: profile.organization_id,
      bank_account_id: bankAccount.id,
      movement_date: row.payment_date,
      movement_type: 'debito',
      debit_amount: n(row.total_amount),
      credit_amount: 0,
      document_number: row.payment_reference,
      receipt_file_url: row.receipt_file_url,
      description: `Boleta de pago proveedor ${row.suppliers?.name || ''}`.trim(),
      source_type: 'supplier_payment_batch',
      source_id: row.id,
      created_by: row.created_by || profile.id,
      updated_at: new Date().toISOString(),
    }))

  await upsertBankMovements(rows)
}

async function syncExpenseMovements(profile, bankAccount) {
  const { data, error } = await supabase
    .from('expenses')
    .select(`
      id,
      organization_id,
      expense_date,
      amount,
      description,
      payment_reference,
      payment_receipt_file_url,
      payment_bank_name,
      payment_account_number,
      bank_account_id,
      supplier_payment_batch_id,
      paid_by
    `)
    .eq('organization_id', profile.organization_id)
    .eq('status', 'pagado')
    .is('supplier_payment_batch_id', null)

  if (error) throw new Error(error.message)

  const rows = (data || [])
    .filter((row) =>
      row.bank_account_id === bankAccount.id ||
      (!row.bank_account_id &&
        row.payment_bank_name === bankAccount.bank_name &&
        row.payment_account_number === bankAccount.account_number)
    )
    .map((row) => ({
      organization_id: profile.organization_id,
      bank_account_id: bankAccount.id,
      movement_date: row.expense_date,
      movement_type: 'debito',
      debit_amount: n(row.amount),
      credit_amount: 0,
      document_number: row.payment_reference,
      receipt_file_url: row.payment_receipt_file_url,
      description: `Boleta de gasto ${row.description || ''}`.trim(),
      source_type: 'expense',
      source_id: row.id,
      created_by: row.paid_by || profile.id,
      updated_at: new Date().toISOString(),
    }))

  await upsertBankMovements(rows)
}

async function syncCollectionMovements(profile, bankAccount) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      organization_id,
      order_number,
      total,
      collected_at,
      collection_reference,
      collection_receipt_file_url,
      collection_bank_name,
      collection_account_number,
      collection_bank_account_id,
      clients ( commercial_name )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('status', 'cobrado')

  if (error) throw new Error(error.message)

  const rows = (data || [])
    .filter((row) =>
      row.collection_bank_account_id === bankAccount.id ||
      (!row.collection_bank_account_id &&
        row.collection_bank_name === bankAccount.bank_name &&
        row.collection_account_number === bankAccount.account_number)
    )
    .map((row) => ({
      organization_id: profile.organization_id,
      bank_account_id: bankAccount.id,
      movement_date: row.collected_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      movement_type: 'credito',
      debit_amount: 0,
      credit_amount: n(row.total),
      document_number: row.collection_reference || row.order_number,
      receipt_file_url: row.collection_receipt_file_url,
      description: `Boleta de cobro pedido #${row.order_number} ${row.clients?.commercial_name || ''}`.trim(),
      source_type: 'cxc_collection',
      source_id: row.id,
      created_by: profile.id,
      updated_at: new Date().toISOString(),
    }))

  await upsertBankMovements(rows)
}

async function syncBankTransferMovements(profile, bankAccount) {
  const { data, error } = await supabase
    .from('bank_transfers')
    .select(`
      id,
      organization_id,
      transfer_date,
      from_bank_account_id,
      to_bank_account_id,
      amount,
      reference_number,
      receipt_file_url,
      notes,
      created_by,
      from_bank_account:from_bank_account_id (
        name
      ),
      to_bank_account:to_bank_account_id (
        name
      )
    `)
    .eq('organization_id', profile.organization_id)

  if (error) throw new Error(error.message)

  const rows = []

  ;(data || []).forEach((row) => {
    if (row.from_bank_account_id === bankAccount.id) {
      rows.push({
        organization_id: profile.organization_id,
        bank_account_id: bankAccount.id,
        movement_date: row.transfer_date,
        movement_type: 'debito',
        debit_amount: n(row.amount),
        credit_amount: 0,
        document_number: row.reference_number,
        receipt_file_url: row.receipt_file_url,
        description: `Transferencia a ${row.to_bank_account?.name || 'cuenta destino'}${row.notes ? ` · ${row.notes}` : ''}`.trim(),
        source_type: 'bank_transfer_out',
        source_id: row.id,
        created_by: row.created_by || profile.id,
        updated_at: new Date().toISOString(),
      })
    }

    if (row.to_bank_account_id === bankAccount.id) {
      rows.push({
        organization_id: profile.organization_id,
        bank_account_id: bankAccount.id,
        movement_date: row.transfer_date,
        movement_type: 'credito',
        debit_amount: 0,
        credit_amount: n(row.amount),
        document_number: row.reference_number,
        receipt_file_url: row.receipt_file_url,
        description: `Transferencia desde ${row.from_bank_account?.name || 'cuenta origen'}${row.notes ? ` · ${row.notes}` : ''}`.trim(),
        source_type: 'bank_transfer_in',
        source_id: row.id,
        created_by: row.created_by || profile.id,
        updated_at: new Date().toISOString(),
      })
    }
  })

  await upsertBankMovements(rows)
}

export async function getBankReconciliationData(bankAccountId, dateFrom, dateTo) {
  const profile = await getProfile()
  const { data: bankAccount, error: bankError } = await supabase
    .from('bank_accounts')
    .select(`
      id,
      name,
      bank_name,
      account_number,
      currency,
      opening_balance,
      opening_balance_date,
      created_by,
      accounting_accounts ( code, name )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('id', bankAccountId)
    .single()

  if (bankError) throw new Error(bankError.message)

  await Promise.all([
    syncOpeningBalanceMovement(profile, bankAccount),
    syncBankTransferMovements(profile, bankAccount),
    syncSupplierPaymentBatchMovements(profile, bankAccount),
    syncExpenseMovements(profile, bankAccount),
    syncCollectionMovements(profile, bankAccount),
  ])

  let query = supabase
    .from('bank_movements')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('bank_account_id', bankAccountId)
    .order('movement_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (dateFrom) query = query.gte('movement_date', dateFrom)
  if (dateTo) query = query.lte('movement_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const movements = (data || []).map((row) => ({
    ...row,
    source_label: mapMovementSourceLabel(row.source_type),
  }))

  const totals = movements.reduce((acc, row) => {
    if (row.source_type === 'opening_balance') return acc
    acc.debit += n(row.debit_amount)
    acc.credit += n(row.credit_amount)
    if (!row.reconciled) {
      acc.pendingDebit += n(row.debit_amount)
      acc.pendingCredit += n(row.credit_amount)
    }
    return acc
  }, { debit: 0, credit: 0, pendingDebit: 0, pendingCredit: 0 })

  totals.openingBalance = n(bankAccount.opening_balance)
  totals.closingBalance = n(bankAccount.opening_balance) + totals.credit - totals.debit

  return {
    bankAccount,
    movements,
    totals,
  }
}

export async function toggleBankMovementReconciled(id, reconciled) {
  const { error } = await supabase
    .from('bank_movements')
    .update({
      reconciled,
      reconciled_at: reconciled ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
}
