import { supabase } from '../../../lib/supabase'
import { ivaCalc } from '../../contabilidad/services/contabilidadService'

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('profiles').select('id, organization_id').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return data
}

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

function calcDueDate(baseDate, creditDays) {
  const d = new Date(baseDate)
  d.setDate(d.getDate() + (n(creditDays) || 0))
  return d.toISOString().slice(0, 10)
}

function agingBucket(daysOverdue) {
  if (daysOverdue <= 0) return { label: 'Al día', color: 'emerald' }
  if (daysOverdue <= 30) return { label: '1–30 días', color: 'amber' }
  if (daysOverdue <= 60) return { label: '31–60 días', color: 'orange' }
  if (daysOverdue <= 90) return { label: '61–90 días', color: 'red' }
  return { label: '+90 días', color: 'rose' }
}

export async function getCxCData(includeCollected = false) {
  const profile = await getProfile()
  const statuses = includeCollected
    ? ['facturado', 'en_logistica', 'entregado', 'cobrado']
    : ['facturado', 'en_logistica', 'entregado']

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, status, total, created_at, collected_at,
      clients ( id, commercial_name, nit, credit_days )
    `)
    .eq('organization_id', profile.organization_id)
    .in('status', statuses)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (data || []).map(o => {
    const { base, iva, total } = ivaCalc(n(o.total))
    const creditDays = n(o.clients?.credit_days)
    const dueDate = calcDueDate(o.created_at, creditDays)
    const due = new Date(dueDate)
    const diffMs = today - due
    const daysOverdue = Math.floor(diffMs / 86400000)
    const aging = agingBucket(o.status === 'cobrado' ? -999 : daysOverdue)
    return { ...o, base, iva, total, dueDate, daysOverdue: Math.max(0, daysOverdue), aging }
  })
}

export async function markAsCobrado(orderId) {
  const profile = await getProfile()

  const { error } = await supabase
    .from('orders')
    .update({ status: 'cobrado', collected_at: new Date().toISOString() })
    .eq('id', orderId)
  if (error) throw new Error(error.message)

  // Asiento: DR 1120 Banco / CR 1200 CxC
  try {
    const orgId = profile.organization_id
    const { data: order } = await supabase
      .from('orders').select('total, order_number, clients(commercial_name)').eq('id', orderId).single()
    const { base, iva, total } = ivaCalc(n(order?.total))

    const { data: accounts } = await supabase
      .from('accounting_accounts').select('id, code')
      .eq('organization_id', orgId).in('code', ['1120', '1200'])
    const acctMap = {}
    ;(accounts || []).forEach(a => { acctMap[a.code] = a.id })

    const { data: cc } = await supabase
      .from('cost_centers').select('id, code').eq('organization_id', orgId).eq('code', 'CC-04').maybeSingle()

    if (acctMap['1120'] && acctMap['1200']) {
      const { data: entry } = await supabase.from('journal_entries').insert({
        organization_id: orgId,
        entry_date: new Date().toISOString().slice(0, 10),
        description: `Cobro Pedido #${order?.order_number} — ${order?.clients?.commercial_name}`,
        reference_type: 'venta',
        reference_id: orderId,
        status: 'confirmado',
        created_by: profile.id,
      }).select().single()

      if (entry) {
        await supabase.from('journal_entry_lines').insert([
          { entry_id: entry.id, account_id: acctMap['1120'], cost_center_id: cc?.id || null, description: 'Cobro en banco', debit: total, credit: 0 },
          { entry_id: entry.id, account_id: acctMap['1200'], cost_center_id: cc?.id || null, description: 'Cancelación CxC', debit: 0, credit: total },
        ])
      }
    }
  } catch (e) { console.warn('Asiento de cobro no generado:', e.message) }
}
