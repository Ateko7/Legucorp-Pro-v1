import { supabase } from '../../../lib/supabase'
import { postAccountingEvent } from '../../contabilidad/services/contabilidadService'

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles').select('id, organization_id').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return data
}

// ─── CRUD Vendedores ───────────────────────────────────────────────────────────

export async function getSalespeople() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('salespeople')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function createSalesperson({ name, phone, email, commission_pct }) {
  const profile = await getProfile()
  const pct = Number(commission_pct ?? 0.04)
  const { data, error } = await supabase
    .from('salespeople')
    .insert({
      organization_id: profile.organization_id,
      name:            name?.trim(),
      phone:           phone || null,
      email:           email || null,
      commission_pct:  pct,
      created_by:      profile.id,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateSalesperson(id, { name, phone, email, commission_pct, status }) {
  const { error } = await supabase
    .from('salespeople')
    .update({
      name:           name?.trim(),
      phone:          phone || null,
      email:          email || null,
      commission_pct: Number(commission_pct ?? 0.04),
      status,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteSalesperson(id) {
  const { error } = await supabase
    .from('salespeople')
    .update({ status: 'inactivo', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Generar comisión al cobrar pedido ───────────────────────────────────────
// Llama a esta función desde CxC cuando status → 'cobrado'
// Calcula 4% (o el % del vendedor) sobre total sin IVA

export async function generateSalesCommission(orderId) {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  // 1. Traer datos del pedido + cliente + vendedor
  const { data: order, error: oErr } = await supabase
    .from('orders')
    .select(`
      id, total, iva_rate, organization_id, created_at,
      order_number,
      clients (
        id, commercial_name, salesperson_id,
        salespeople ( id, name, commission_pct )
      )
    `)
    .eq('id', orderId)
    .single()

  if (oErr) throw new Error(oErr.message)
  if (!order) throw new Error('Pedido no encontrado')

  const salesperson = order.clients?.salespeople
  if (!salesperson) return null  // venta directa, sin comisión

  // Evita duplicar comisión si ya fue generada antes para este pedido.
  const { data: existingExpense } = await supabase
    .from('expenses')
    .select('id')
    .eq('organization_id', orgId)
    .eq('expense_type', 'comercial')
    .eq('source_order_id', orderId)
    .maybeSingle()

  if (existingExpense?.id) return null

  // 2. Calcular base sin IVA
  const total      = Number(order.total || 0)
  const ivaRate    = Number(order.iva_rate ?? 0.12)
  const basesinIva = total / (1 + ivaRate)
  const commission = +(basesinIva * Number(salesperson.commission_pct)).toFixed(2)

  if (commission <= 0) return null

  // 3. Buscar CC Comercial (CC-02) de la organización
  const { data: cc } = await supabase
    .from('cost_centers')
    .select('id')
    .eq('organization_id', orgId)
    .eq('code', 'CC-02')
    .single()

  const ccId = cc?.id || null

  // 4. Crear gasto de comisión
  const { data: expense, error: eErr } = await supabase
    .from('expenses')
    .insert({
      organization_id: orgId,
      expense_date:    new Date().toISOString().slice(0, 10),
      description:     `Comisión vendedor ${salesperson.name} – Pedido #${order.order_number}`,
      amount:          commission,
      cost_center_id:  ccId,
      expense_type:    'comercial',
      source_order_id: orderId,
      created_by:      profile.id,
    })
    .select()
    .single()

  if (eErr) throw new Error(eErr.message)

  // 5. Asiento contable: DR 6100 Gastos Comerciales / CR 2100 Comisiones por pagar
  try {
    const entryId = await postAccountingEvent({
      eventCode: 'COMISION_VENDEDOR',
      entryDate: expense.expense_date,
      description: `Comision ${salesperson.name} - Pedido #${order.order_number}`,
      referenceType: 'comision',
      referenceId: expense.id,
      sourceType: 'expense',
      sourceId: expense.id,
      payload: {
        commission,
        description: expense.description,
        cost_center_id: ccId,
        dimension_order_id: orderId,
        dimension_client_id: order.clients?.id || null,
      },
    })

    await supabase.from('expenses').update({ journal_entry_id: entryId }).eq('id', expense.id)
    /*
    const { data: accounts } = await supabase
      .from('accounting_accounts')
      .select('id, code')
      .eq('organization_id', orgId)
      .in('code', ['6100', '2100'])

    const acctMap = {}
    ;(accounts || []).forEach(a => { acctMap[a.code] = a.id })

    if (acctMap['6100'] && acctMap['2100']) {
      const { data: entry } = await supabase
        .from('journal_entries')
        .insert({
          organization_id: orgId,
          entry_date:      expense.expense_date,
          description:     `Comisión ${salesperson.name} – Pedido #${order.order_number}`,
          reference_type:  'comision',
          reference_id:    expense.id,
          status:          'confirmado',
          created_by:      profile.id,
        })
        .select()
        .single()

      if (entry) {
        await supabase.from('journal_entry_lines').insert([
          { entry_id: entry.id, account_id: acctMap['6100'], cost_center_id: ccId, description: expense.description, debit: commission, credit: 0 },
          { entry_id: entry.id, account_id: acctMap['2100'], cost_center_id: ccId, description: 'Comisión por pagar', debit: 0, credit: commission },
        ])

        await supabase.from('expenses').update({ journal_entry_id: entry.id }).eq('id', expense.id)
      }
    }
    */
  } catch (e) {
    console.warn('Asiento de comisión no generado:', e.message)
  }

  return expense
}

// ─── Resumen de comisiones por vendedor ───────────────────────────────────────

export async function getCommissionSummary({ dateFrom, dateTo } = {}) {
  const profile = await getProfile()

  let query = supabase
    .from('expenses')
    .select(`
      amount, expense_date, description, source_order_id,
      orders!source_order_id ( order_number, total, status )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('expense_type', 'comercial')
    .not('source_order_id', 'is', null)

  if (dateFrom) query = query.gte('expense_date', dateFrom)
  if (dateTo)   query = query.lte('expense_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []).filter((row) => row.orders?.status === 'cobrado')
}
