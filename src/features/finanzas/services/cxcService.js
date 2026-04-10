import { supabase } from '../../../lib/supabase'
import { ivaCalc, postAccountingEvent } from '../../contabilidad/services/contabilidadService'
import { generateSalesCommission } from '../../vendedores/services/vendedoresService'

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function getFileExtension(file) {
  const raw = (file?.name || '').split('.').pop()?.trim().toLowerCase()
  if (!raw) return 'pdf'
  return raw.replace(/[^a-z0-9]/g, '') || 'pdf'
}

function calcDueDate(baseDate, creditDays) {
  const d = new Date(baseDate)
  d.setDate(d.getDate() + (n(creditDays) || 0))
  return d.toISOString().slice(0, 10)
}

function agingBucket(daysOverdue) {
  if (daysOverdue <= 0) return { label: 'Al dia', color: 'emerald' }
  if (daysOverdue <= 30) return { label: '1-30 dias', color: 'amber' }
  if (daysOverdue <= 60) return { label: '31-60 dias', color: 'orange' }
  if (daysOverdue <= 90) return { label: '61-90 dias', color: 'red' }
  return { label: '+90 dias', color: 'rose' }
}

async function uploadCollectionReceipt(file, orderId) {
  const { data: { user } } = await supabase.auth.getUser()
  const ext = getFileExtension(file)
  const path = `${user.id}/${orderId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('collection-receipts')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('collection-receipts').getPublicUrl(path)
  return data.publicUrl
}

async function getBankAccountForProfile(profile, bankAccountId) {
  if (!bankAccountId) throw new Error('Debes seleccionar una cuenta bancaria')

  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id, bank_name, account_number, accounting_account_id')
    .eq('organization_id', profile.organization_id)
    .eq('id', bankAccountId)
    .eq('is_active', true)
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getCxCData(includeCollected = false) {
  const profile = await getProfile()
  const statuses = includeCollected
    ? ['facturado', 'en_logistica', 'entregado', 'cobrado']
    : ['facturado', 'en_logistica', 'entregado']

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      status,
      total,
      created_at,
      collected_at,
      collection_bank_name,
      collection_account_number,
      collection_reference,
      collection_receipt_file_url,
      clients ( id, commercial_name, nit, credit_days )
    `)
    .eq('organization_id', profile.organization_id)
    .in('status', statuses)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (data || []).map((order) => {
    const { base, iva, total } = ivaCalc(n(order.total))
    const creditDays = n(order.clients?.credit_days)
    const dueDate = calcDueDate(order.created_at, creditDays)
    const due = new Date(dueDate)
    const diffMs = today - due
    const daysOverdue = Math.floor(diffMs / 86400000)
    const aging = agingBucket(order.status === 'cobrado' ? -999 : daysOverdue)
    return {
      ...order,
      base,
      iva,
      total,
      dueDate,
      daysOverdue: Math.max(0, daysOverdue),
      aging,
    }
  })
}

export async function markAsCobrado(orderId, {
  bankAccountId = '',
  collectionReference = '',
  collectionReceiptFile = null,
} = {}) {
  const profile = await getProfile()
  const bankAccount = await getBankAccountForProfile(profile, bankAccountId)
  const collection_bank_name = String(bankAccount.bank_name || '').trim()
  const collection_account_number = String(bankAccount.account_number || '').trim()
  const collection_reference = String(collectionReference || '').trim()

  if (!collection_bank_name) {
    throw new Error('Debes ingresar el banco al que se acredito el cobro')
  }

  if (!collection_account_number) {
    throw new Error('Debes ingresar el numero de cuenta al que se acredito el cobro')
  }

  if (!collection_reference) {
    throw new Error('Debes ingresar el numero de boleta o documento del cobro')
  }

  if (!collectionReceiptFile) {
    throw new Error('Debes adjuntar la boleta de cobro en PDF')
  }

  const collection_receipt_file_url = await uploadCollectionReceipt(collectionReceiptFile, orderId)

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'cobrado',
      collected_at: new Date().toISOString(),
      collection_bank_name,
      collection_account_number,
      collection_bank_account_id: bankAccount.id,
      collection_reference,
      collection_receipt_file_url,
    })
    .eq('id', orderId)

  if (error) throw new Error(error.message)

  try {
    const orgId = profile.organization_id
    const { data: order } = await supabase
      .from('orders')
      .select('total, order_number, client_id, clients(id, commercial_name)')
      .eq('id', orderId)
      .single()

    const { total } = ivaCalc(n(order?.total))

    const { data: cc } = await supabase
      .from('cost_centers')
      .select('id, code')
      .eq('organization_id', orgId)
      .eq('code', 'CC-04')
      .maybeSingle()

    const bankAccountingAccountId = bankAccount.accounting_account_id
    if (!bankAccountingAccountId) throw new Error('La cuenta bancaria no tiene cuenta contable asociada')

    await postAccountingEvent({
      eventCode: 'COBRO_CLIENTE',
      entryDate: new Date().toISOString().slice(0, 10),
      description: `Cobro Pedido #${order?.order_number} - ${order?.clients?.commercial_name || 'Cliente'}`,
      referenceType: 'venta',
      referenceId: orderId,
      sourceType: 'cxc_collection',
      sourceId: orderId,
      payload: {
        total,
        order_number: order?.order_number,
        bank_accounting_account_id: bankAccountingAccountId,
        admin_cost_center_id: cc?.id || null,
        dimension_order_id: orderId,
        dimension_client_id: order?.client_id || order?.clients?.id || null,
        collection_reference,
      },
    })
  } catch (e) {
    console.warn('Asiento de cobro no generado:', e.message)
  }

  try {
    await generateSalesCommission(orderId)
  } catch (e) {
    console.warn('Comision no generada al cobrar:', e.message)
  }
}
