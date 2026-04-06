import { supabase } from '../../../lib/supabase'

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles').select('id, organization_id').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return data
}

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

// ─── Cuenta de gasto por tipo ─────────────────────────────────────────────────
// produccion → 6200, logistica → 6300, comercial/administrativo → 6100

const EXPENSE_ACCOUNT_CODE = {
  produccion:    '6200',
  logistica:     '6300',
  comercial:     '6100',
  administrativo:'6100',
}

// ─── Gastos ───────────────────────────────────────────────────────────────────

export async function getGastos(dateFrom, dateTo) {
  const profile = await getProfile()

  let query = supabase
    .from('expenses')
    .select(`
      id, expense_date, description, amount, expense_type, created_at,
      cost_centers ( id, code, name ),
      journal_entry_id
    `)
    .eq('organization_id', profile.organization_id)
    .order('expense_date', { ascending: false })

  if (dateFrom) query = query.gte('expense_date', dateFrom)
  if (dateTo)   query = query.lte('expense_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

export async function createGasto({ fecha, descripcion, monto, cost_center_id, expense_type }) {
  const profile = await getProfile()
  const orgId   = profile.organization_id
  const amount  = n(monto)

  if (!cost_center_id) throw new Error('Debes seleccionar un centro de costo')
  if (amount <= 0)      throw new Error('El monto debe ser mayor a cero')
  if (!descripcion?.trim()) throw new Error('La descripción es requerida')

  const tipo = expense_type || 'administrativo'

  // ─ Crear registro de gasto ─────────────────────────────────────────────────
  const { data: expense, error: expErr } = await supabase
    .from('expenses')
    .insert({
      organization_id: orgId,
      expense_date:    fecha || new Date().toISOString().slice(0, 10),
      description:     descripcion.trim(),
      amount,
      cost_center_id,
      expense_type:    tipo,
      created_by:      profile.id,
    })
    .select()
    .single()
  if (expErr) throw new Error(expErr.message)

  // ─ Generar asiento contable ────────────────────────────────────────────────
  try {
    const acctCode = EXPENSE_ACCOUNT_CODE[tipo] || '6100'

    const { data: accounts } = await supabase
      .from('accounting_accounts')
      .select('id, code')
      .eq('organization_id', orgId)
      .in('code', [acctCode, '1120'])

    const acctMap = {}
    ;(accounts || []).forEach(a => { acctMap[a.code] = a.id })

    if (acctMap[acctCode] && acctMap['1120']) {
      const { data: entry, error: entryErr } = await supabase
        .from('journal_entries')
        .insert({
          organization_id: orgId,
          entry_date:      expense.expense_date,
          description:     `Gasto: ${expense.description}`,
          reference_type:  'gasto',
          reference_id:    expense.id,
          status:          'confirmado',
          created_by:      profile.id,
        })
        .select()
        .single()
      if (!entryErr && entry) {
        await supabase.from('journal_entry_lines').insert([
          {
            entry_id:       entry.id,
            account_id:     acctMap[acctCode],
            cost_center_id,
            description:    expense.description,
            debit:          amount,
            credit:         0,
          },
          {
            entry_id:       entry.id,
            account_id:     acctMap['1120'],
            cost_center_id,
            description:    'Pago en banco',
            debit:          0,
            credit:         amount,
          },
        ])

        // Vincular asiento al gasto
        await supabase
          .from('expenses')
          .update({ journal_entry_id: entry.id })
          .eq('id', expense.id)
      }
    }
  } catch (e) {
    console.warn('Asiento de gasto no generado:', e.message)
  }

  return expense
}

export async function deleteGasto(gastoId) {
  // Primero desvincular el asiento (se mantiene por integridad contable)
  await supabase.from('expenses').update({ journal_entry_id: null }).eq('id', gastoId)

  const { error } = await supabase.from('expenses').delete().eq('id', gastoId)
  if (error) throw new Error(error.message)
}

// ─── Resumen por centro de costo (gastos directos) ───────────────────────────

export async function getGastosSummary(dateFrom, dateTo) {
  const profile = await getProfile()

  let query = supabase
    .from('expenses')
    .select(`
      amount, expense_type,
      cost_centers ( id, code, name )
    `)
    .eq('organization_id', profile.organization_id)

  if (dateFrom) query = query.gte('expense_date', dateFrom)
  if (dateTo)   query = query.lte('expense_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const byCC = {}
  ;(data || []).forEach(g => {
    const cc = g.cost_centers
    if (!cc) return
    if (!byCC[cc.id]) byCC[cc.id] = { code: cc.code, name: cc.name, total: 0, count: 0 }
    byCC[cc.id].total += n(g.amount)
    byCC[cc.id].count++
  })

  return Object.values(byCC).sort((a, b) => a.code.localeCompare(b.code))
}
