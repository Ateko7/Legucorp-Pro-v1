import { supabase } from '../../../lib/supabase'
import { ensureAccountingTemplatesCurrent, postAccountingEvent } from '../../contabilidad/services/contabilidadService'

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

async function uploadCommissionPaymentReceipt(file, batchId) {
  const { data: { user } } = await supabase.auth.getUser()
  const ext = getFileExtension(file)
  const path = `${user.id}/${batchId}/receipt-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('commission-payment-receipts')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('commission-payment-receipts').getPublicUrl(path)
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

function resolveSalesperson(row) {
  return row.salespeople || row.orders?.clients?.salespeople || null
}

function normalizeCommissionRow(row) {
  const salesperson = resolveSalesperson(row)
  return {
    ...row,
    salesperson,
    salesperson_name: salesperson?.name || 'Sin vendedor',
    client_name: row.orders?.clients?.commercial_name || 'Cliente',
    order_number: row.orders?.order_number || '',
    commission_status: row.sales_commission_payment_batch_id ? 'pagada' : (row.commission_status || 'pendiente_pago'),
  }
}

function buildCommissionSummary(rows) {
  const grouped = new Map()

  rows.forEach((row) => {
    const salesperson = row.salesperson
    if (!salesperson?.id) return

    const current = grouped.get(salesperson.id) || {
      salesperson_id: salesperson.id,
      salesperson_name: salesperson.name,
      commission_pct: n(row.commission_pct ?? salesperson.commission_pct) * 100,
      total_generated: 0,
      total_pending: 0,
      total_paid: 0,
      pending_count: 0,
      paid_count: 0,
      rows: [],
    }

    current.total_generated += n(row.amount)
    if (row.commission_status === 'pagada') {
      current.total_paid += n(row.amount)
      current.paid_count += 1
    } else {
      current.total_pending += n(row.amount)
      current.pending_count += 1
    }
    current.rows.push(row)
    grouped.set(salesperson.id, current)
  })

  return Array.from(grouped.values()).sort((a, b) => b.total_generated - a.total_generated)
}

async function getCommissionRows(profile, { dateFrom, dateTo, salespersonId, onlyPending = false } = {}) {
  let query = supabase
    .from('expenses')
    .select(`
      id,
      expense_date,
      description,
      amount,
      source_order_id,
      salesperson_id,
      commission_base_amount,
      commission_pct,
      commission_status,
      payment_reference,
      paid_at,
      sales_commission_payment_batch_id,
      salespeople:salesperson_id (
        id,
        name,
        commission_pct
      ),
      orders!source_order_id (
        id,
        order_number,
        total,
        status,
        collected_at,
        clients (
          id,
          commercial_name,
          salesperson_id,
          salespeople (
            id,
            name,
            commission_pct
          )
        )
      )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('expense_type', 'comercial')
    .not('source_order_id', 'is', null)
    .order('expense_date', { ascending: false })

  if (dateFrom) query = query.gte('expense_date', dateFrom)
  if (dateTo) query = query.lte('expense_date', dateTo)
  if (salespersonId) query = query.eq('salesperson_id', salespersonId)
  if (onlyPending) query = query.is('sales_commission_payment_batch_id', null)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (data || [])
    .filter((row) => row.orders?.status === 'cobrado')
    .map(normalizeCommissionRow)
    .filter((row) => !salespersonId || row.salesperson?.id === salespersonId)
}

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
      name: name?.trim(),
      phone: phone || null,
      email: email || null,
      commission_pct: pct,
      created_by: profile.id,
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
      name: name?.trim(),
      phone: phone || null,
      email: email || null,
      commission_pct: Number(commission_pct ?? 0.04),
      status,
      updated_at: new Date().toISOString(),
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

export async function generateSalesCommission(orderId) {
  const profile = await getProfile()
  const orgId = profile.organization_id

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(`
      id,
      total,
      iva_rate,
      order_number,
      clients (
        id,
        commercial_name,
        salesperson_id,
        salespeople (
          id,
          name,
          commission_pct
        )
      )
    `)
    .eq('id', orderId)
    .single()

  if (orderError) throw new Error(orderError.message)
  if (!order) throw new Error('Pedido no encontrado')

  const salesperson = order.clients?.salespeople
  if (!salesperson) return null

  const { data: existingExpense } = await supabase
    .from('expenses')
    .select('id')
    .eq('organization_id', orgId)
    .eq('expense_type', 'comercial')
    .eq('source_order_id', orderId)
    .maybeSingle()

  if (existingExpense?.id) return null

  const total = n(order.total)
  const ivaRate = n(order.iva_rate ?? 0.12)
  const baseSinIva = total / (1 + ivaRate)
  const commissionPct = Number(salesperson.commission_pct || 0)
  const commission = +(baseSinIva * commissionPct).toFixed(2)

  if (commission <= 0) return null

  const { data: cc } = await supabase
    .from('cost_centers')
    .select('id')
    .eq('organization_id', orgId)
    .eq('code', 'CC-02')
    .single()

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .insert({
      organization_id: orgId,
      expense_date: new Date().toISOString().slice(0, 10),
      description: `Comision vendedor ${salesperson.name} - Pedido #${order.order_number}`,
      amount: commission,
      cost_center_id: cc?.id || null,
      expense_type: 'comercial',
      source_order_id: orderId,
      salesperson_id: salesperson.id,
      commission_base_amount: +baseSinIva.toFixed(2),
      commission_pct: commissionPct,
      commission_status: 'pendiente_pago',
      created_by: profile.id,
    })
    .select()
    .single()

  if (expenseError) throw new Error(expenseError.message)

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
        cost_center_id: cc?.id || null,
        dimension_order_id: orderId,
        dimension_client_id: order.clients?.id || null,
      },
    })

    await supabase
      .from('expenses')
      .update({ journal_entry_id: entryId })
      .eq('id', expense.id)
  } catch (accountingError) {
    console.warn('Asiento de comision no generado:', accountingError.message)
  }

  return expense
}

export async function getCommissionSummary({ dateFrom, dateTo, salespersonId } = {}) {
  const profile = await getProfile()
  return getCommissionRows(profile, { dateFrom, dateTo, salespersonId })
}

export async function getCommissionPaymentBatches({ dateFrom, dateTo, salespersonId } = {}) {
  const profile = await getProfile()
  let query = supabase
    .from('sales_commission_payment_batches')
    .select(`
      id,
      payment_reference,
      payment_date,
      period_from,
      period_to,
      total_amount,
      receipt_file_url,
      debit_bank_name,
      debit_account_number,
      salesperson_id,
      salespeople (
        id,
        name
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (dateFrom) query = query.gte('payment_date', dateFrom)
  if (dateTo) query = query.lte('payment_date', dateTo)
  if (salespersonId) query = query.eq('salesperson_id', salespersonId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || []
}

export async function paySalesCommissionBatch({
  salespersonId,
  dateFrom,
  dateTo,
  paymentDate,
  paymentReference,
  bankAccountId,
  paymentReceiptFile,
  notes = '',
}) {
  const profile = await getProfile()
  if (!salespersonId) throw new Error('Debes seleccionar un vendedor')
  if (!dateFrom || !dateTo) throw new Error('Debes indicar el periodo a pagar')

  const paymentReferenceClean = String(paymentReference || '').trim()
  if (!paymentReferenceClean) throw new Error('Debes ingresar el numero de boleta')
  if (!paymentReceiptFile) throw new Error('Debes adjuntar la boleta de pago en PDF')

  const bankAccount = await getBankAccountForProfile(profile, bankAccountId)
  const pendingRows = await getCommissionRows(profile, {
    dateFrom,
    dateTo,
    salespersonId,
    onlyPending: true,
  })

  if (!pendingRows.length) {
    throw new Error('No hay comisiones pendientes para ese vendedor en el periodo seleccionado')
  }

  const salesperson = pendingRows[0]?.salesperson
  if (!salesperson?.id) {
    throw new Error('No se pudo identificar el vendedor de las comisiones seleccionadas')
  }

  const paymentDateValue = paymentDate || new Date().toISOString().slice(0, 10)
  const totalAmount = +pendingRows.reduce((acc, row) => acc + n(row.amount), 0).toFixed(2)

  const { data: cc } = await supabase
    .from('cost_centers')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('code', 'CC-02')
    .maybeSingle()

  const { data: batch, error: batchError } = await supabase
    .from('sales_commission_payment_batches')
    .insert({
      organization_id: profile.organization_id,
      salesperson_id: salesperson.id,
      period_from: dateFrom,
      period_to: dateTo,
      payment_date: paymentDateValue,
      payment_reference: paymentReferenceClean,
      total_amount: totalAmount,
      bank_account_id: bankAccount.id,
      debit_bank_name: String(bankAccount.bank_name || '').trim() || null,
      debit_account_number: String(bankAccount.account_number || '').trim() || null,
      notes: String(notes || '').trim() || null,
      created_by: profile.id,
    })
    .select()
    .single()

  if (batchError) throw new Error(batchError.message)

  const receiptUrl = await uploadCommissionPaymentReceipt(paymentReceiptFile, batch.id)
  const paidAt = new Date().toISOString()

  const { error: updateExpensesError } = await supabase
    .from('expenses')
    .update({
      sales_commission_payment_batch_id: batch.id,
      commission_status: 'pagada',
      payment_reference: paymentReferenceClean,
      payment_receipt_file_url: receiptUrl,
      paid_at: paidAt,
      paid_by: profile.id,
      bank_account_id: bankAccount.id,
      payment_bank_name: String(bankAccount.bank_name || '').trim() || null,
      payment_account_number: String(bankAccount.account_number || '').trim() || null,
    })
    .in('id', pendingRows.map((row) => row.id))
    .eq('organization_id', profile.organization_id)

  if (updateExpensesError) throw new Error(updateExpensesError.message)

  try {
    await ensureAccountingTemplatesCurrent(profile.organization_id)

    const entryId = await postAccountingEvent({
      eventCode: 'PAGO_COMISION_VENDEDOR',
      entryDate: paymentDateValue,
      description: `Pago comision ${salesperson.name} - ${dateFrom} a ${dateTo}`,
      referenceType: 'comision',
      referenceId: batch.id,
      sourceType: 'sales_commission_payment_batch',
      sourceId: batch.id,
      payload: {
        total_amount: totalAmount,
        payment_reference: paymentReferenceClean,
        salesperson_name: salesperson.name,
        bank_accounting_account_id: bankAccount.accounting_account_id,
        cost_center_id: cc?.id || null,
      },
    })

    await supabase
      .from('sales_commission_payment_batches')
      .update({
        receipt_file_url: receiptUrl,
        journal_entry_id: entryId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', batch.id)
  } catch (accountingError) {
    console.warn('Asiento de pago de comision no generado:', accountingError.message)

    await supabase
      .from('sales_commission_payment_batches')
      .update({
        receipt_file_url: receiptUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', batch.id)
  }

  return {
    ...batch,
    receipt_file_url: receiptUrl,
    salesperson,
  }
}

export function summarizeCommissionsBySalesperson(rows) {
  return buildCommissionSummary(rows)
}
