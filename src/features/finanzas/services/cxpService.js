import { supabase } from '../../../lib/supabase'

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('profiles').select('id, organization_id').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return data
}

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

function calcDueDate(baseDate, paymentDays) {
  const d = new Date(baseDate)
  d.setDate(d.getDate() + (n(paymentDays) || 30))
  return d.toISOString().slice(0, 10)
}

function agingBucket(daysOverdue) {
  if (daysOverdue <= 0) return { label: 'Al día', color: 'emerald' }
  if (daysOverdue <= 30) return { label: '1–30 días', color: 'amber' }
  if (daysOverdue <= 60) return { label: '31–60 días', color: 'orange' }
  if (daysOverdue <= 90) return { label: '61–90 días', color: 'red' }
  return { label: '+90 días', color: 'rose' }
}

export async function getCxPData(includePaid = false) {
  const profile = await getProfile()

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      id, order_number, status, payment_status, created_at, paid_at,
      suppliers ( id, name, nit, payment_days ),
      purchase_order_items ( quantity, unit_cost )
    `)
    .eq('organization_id', profile.organization_id)
    .in('payment_status', includePaid ? ['pendiente', 'pagado'] : ['pendiente'])
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (data || []).map(po => {
    const total = (po.purchase_order_items || []).reduce(
      (acc, i) => acc + n(i.quantity) * n(i.unit_cost), 0
    )
    const paymentDays = n(po.suppliers?.payment_days) || 30
    const dueDate = calcDueDate(po.created_at, paymentDays)
    const due = new Date(dueDate)
    const diffMs = today - due
    const daysOverdue = Math.floor(diffMs / 86400000)
    const aging = agingBucket(po.payment_status === 'pagado' ? -999 : daysOverdue)
    return { ...po, total, dueDate, daysOverdue: Math.max(0, daysOverdue), aging }
  })
}

export async function markAsPagado(poId) {
  const profile = await getProfile()

  const { error } = await supabase
    .from('purchase_orders')
    .update({ payment_status: 'pagado', paid_at: new Date().toISOString() })
    .eq('id', poId)
  if (error) throw new Error(error.message)

  // Asiento: DR 2100 CxP / CR 1120 Banco
  try {
    const orgId = profile.organization_id
    const { data: po } = await supabase
      .from('purchase_orders')
      .select('order_number, suppliers(name), purchase_order_items(quantity, unit_cost)')
      .eq('id', poId).single()
    const total = (po?.purchase_order_items || []).reduce((acc, i) => acc + n(i.quantity) * n(i.unit_cost), 0)

    const { data: accounts } = await supabase
      .from('accounting_accounts').select('id, code')
      .eq('organization_id', orgId).in('code', ['2100', '1120'])
    const acctMap = {}
    ;(accounts || []).forEach(a => { acctMap[a.code] = a.id })

    const { data: cc } = await supabase
      .from('cost_centers').select('id').eq('organization_id', orgId).eq('code', 'CC-04').maybeSingle()

    if (acctMap['2100'] && acctMap['1120']) {
      const { data: entry } = await supabase.from('journal_entries').insert({
        organization_id: orgId,
        entry_date: new Date().toISOString().slice(0, 10),
        description: `Pago OC #${po?.order_number} — ${po?.suppliers?.name}`,
        reference_type: 'compra',
        reference_id: poId,
        status: 'confirmado',
        created_by: profile.id,
      }).select().single()

      if (entry) {
        await supabase.from('journal_entry_lines').insert([
          { entry_id: entry.id, account_id: acctMap['2100'], cost_center_id: cc?.id || null, description: 'Cancelación CxP', debit: total, credit: 0 },
          { entry_id: entry.id, account_id: acctMap['1120'], cost_center_id: cc?.id || null, description: 'Pago en banco', debit: 0, credit: total },
        ])
      }
    }
  } catch (e) { console.warn('Asiento de pago no generado:', e.message) }
}
