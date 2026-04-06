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
  { code: '1200', name: 'Cuentas por Cobrar Clientes',        account_type: 'activo',  normal_balance: 'debito'  },
  { code: '1300', name: 'Inventario Producto Terminado',      account_type: 'activo',  normal_balance: 'debito'  },
  { code: '1400', name: 'Inventario Materias Primas',         account_type: 'activo',  normal_balance: 'debito'  },
  { code: '2100', name: 'Cuentas por Pagar Proveedores',      account_type: 'pasivo',  normal_balance: 'credito' },
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

export async function initAccounting() {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  const [{ count: acctCount }, { count: ccCount }] = await Promise.all([
    supabase.from('accounting_accounts').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('cost_centers').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
  ])

  if (!acctCount) {
    await supabase.from('accounting_accounts').insert(
      DEFAULT_ACCOUNTS.map(a => ({ ...a, organization_id: orgId }))
    )
  }
  // Seed solo si no hay ningún CC; los duplicados ya se limpiaron con la migración
  if (!ccCount) {
    await supabase.from('cost_centers').insert(
      DEFAULT_COST_CENTERS.map(c => ({ ...c, organization_id: orgId, is_active: true }))
    )
  }
}

// ─── Catálogo de cuentas ──────────────────────────────────────────────────────

export async function getAccounts() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('accounting_accounts')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
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
      journal_entry_lines (
        id, debit, credit, description,
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
    .eq('reference_type', 'venta')
    .eq('reference_id', orderId)
    .maybeSingle()
  if (existing) return

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_number, total, clients ( commercial_name )')
    .eq('id', orderId)
    .single()
  if (orderErr) throw new Error(orderErr.message)

  const { base, iva, total } = ivaCalc(n(order.total))

  const { data: accounts } = await supabase
    .from('accounting_accounts')
    .select('id, code')
    .eq('organization_id', orgId)
    .in('code', ['1200', '4100', '2200'])

  const acctMap = {}
  ;(accounts || []).forEach(a => { acctMap[a.code] = a.id })

  const { data: ccs } = await supabase
    .from('cost_centers')
    .select('id, code')
    .eq('organization_id', orgId)
    .in('code', ['CC-02', 'CC-04'])
  const ccMap = {}
  ;(ccs || []).forEach(c => { ccMap[c.code] = c.id })

  if (!acctMap['1200'] || !acctMap['4100'] || !acctMap['2200']) {
    throw new Error('Catálogo de cuentas incompleto. Inicializa la contabilidad primero.')
  }

  const { data: entry, error: entryErr } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: orgId,
      entry_date:      new Date().toISOString().slice(0, 10),
      description:     `Venta Pedido #${order.order_number} — ${order.clients?.commercial_name}`,
      reference_type:  'venta',
      reference_id:    orderId,
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
      description: `CxC Pedido #${order.order_number}`,
      debit: total, credit: 0,
    },
    {
      entry_id: entry.id, account_id: acctMap['4100'],
      cost_center_id: ccMap['CC-02'] || null,
      description: `Ventas Pedido #${order.order_number}`,
      debit: 0, credit: base,
    },
    {
      entry_id: entry.id, account_id: acctMap['2200'],
      cost_center_id: ccMap['CC-04'] || null,
      description: `IVA 12% Pedido #${order.order_number}`,
      debit: 0, credit: iva,
    },
  ]

  const { error: linesErr } = await supabase.from('journal_entry_lines').insert(lines)
  if (linesErr) throw new Error(linesErr.message)
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
