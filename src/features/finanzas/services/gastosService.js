import { supabase } from '../../../lib/supabase'
import { postAccountingEvent } from '../../contabilidad/services/contabilidadService'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

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

const EXPENSE_ACCOUNT_CODE = {
  produccion: '6200',
  logistica: '6300',
  comercial: '6100',
  administrativo: '6100',
}

function getFileExtension(file) {
  const raw = (file?.name || '').split('.').pop()?.trim().toLowerCase()
  if (!raw) return 'pdf'
  return raw.replace(/[^a-z0-9]/g, '') || 'pdf'
}

async function uploadExpenseDocument(file, expenseId, kind) {
  const { data: { user } } = await supabase.auth.getUser()
  const ext = getFileExtension(file)
  const path = `${user.id}/${expenseId}/${kind}-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('expense-documents')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('expense-documents').getPublicUrl(path)
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

async function ensureExpensePaymentAccounts(orgId, expenseType) {
  const expenseAccountCode = EXPENSE_ACCOUNT_CODE[expenseType] || '6100'
  const { data: accounts, error } = await supabase
    .from('accounting_accounts')
    .select('id, code')
    .eq('organization_id', orgId)
    .in('code', [expenseAccountCode, '1120'])

  if (error) throw new Error(error.message)

  const map = {}
  ;(accounts || []).forEach((account) => {
    map[account.code] = account.id
  })
  return { expenseAccountCode, accountMap: map }
}

async function createExpensePaymentEntryWithBank({ expense, profile }) {
  if (expense.journal_entry_id) return expense.journal_entry_id

  const { expenseAccountCode, accountMap } = await ensureExpensePaymentAccounts(
    profile.organization_id,
    expense.expense_type
  )

  let bankAccountCodeId = accountMap['1120']
  if (expense.bank_account_id) {
    const { data: bankAccount, error: bankError } = await supabase
      .from('bank_accounts')
      .select('accounting_account_id')
      .eq('organization_id', profile.organization_id)
      .eq('id', expense.bank_account_id)
      .maybeSingle()

    if (bankError) throw new Error(bankError.message)
    if (bankAccount?.accounting_account_id) {
      bankAccountCodeId = bankAccount.accounting_account_id
    }
  }

  if (!accountMap[expenseAccountCode] || !bankAccountCodeId) {
    throw new Error('Catalogo de cuentas incompleto para registrar el pago del gasto')
  }

  const entryId = await postAccountingEvent({
    eventCode: 'GASTO_OPERATIVO',
    entryDate: expense.paid_at?.slice(0, 10) || expense.expense_date,
    description: `Gasto pagado: ${expense.description}`,
    referenceType: 'gasto',
    referenceId: expense.id,
    sourceType: 'expense',
    sourceId: expense.id,
    payload: {
      amount: n(expense.amount),
      description: expense.description,
      expense_account_id: accountMap[expenseAccountCode],
      bank_accounting_account_id: bankAccountCodeId,
      cost_center_id: expense.cost_center_id || null,
    },
  })

  await supabase
    .from('expenses')
    .update({ journal_entry_id: entryId })
    .eq('id', expense.id)

  return entryId
}

async function _createExpensePaymentEntry({ expense, profile }) {
  if (expense.journal_entry_id) return expense.journal_entry_id

  const { expenseAccountCode, accountMap } = await ensureExpensePaymentAccounts(
    profile.organization_id,
    expense.expense_type
  )

  if (!accountMap[expenseAccountCode] || !accountMap['1120']) {
    throw new Error('Catálogo de cuentas incompleto para registrar el pago del gasto')
  }

  const entryId = await postAccountingEvent({
    eventCode: 'GASTO_OPERATIVO',
    entryDate: expense.paid_at?.slice(0, 10) || expense.expense_date,
    description: `Gasto pagado: ${expense.description}`,
    referenceType: 'gasto',
    referenceId: expense.id,
    sourceType: 'expense',
    sourceId: expense.id,
    payload: {
      amount: n(expense.amount),
      description: expense.description,
      expense_account_id: accountMap[expenseAccountCode],
      bank_accounting_account_id: accountMap['1120'],
      cost_center_id: expense.cost_center_id || null,
    },
  })

  await supabase
    .from('expenses')
    .update({ journal_entry_id: entryId })
    .eq('id', expense.id)

  return entryId
}

export async function getGastos(dateFrom, dateTo) {
  const profile = await getProfile()

  let query = supabase
    .from('expenses')
    .select(`
      id,
      expense_date,
      description,
      amount,
      expense_type,
      status,
      invoice_number,
      invoice_date,
      invoice_file_url,
      payment_reference,
      payment_receipt_file_url,
      paid_at,
      created_at,
      supplier_accounts_payable_id,
      supplier_payment_batch_id,
      cost_centers ( id, code, name ),
      suppliers ( id, name ),
      journal_entry_id
    `)
    .eq('organization_id', profile.organization_id)
    .order('expense_date', { ascending: false })

  if (dateFrom) query = query.gte('expense_date', dateFrom)
  if (dateTo) query = query.lte('expense_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message || 'No se pudieron cargar los gastos')
  return data || []
}

export async function createGasto({ fecha, descripcion, monto, cost_center_id, expense_type }) {
  const profile = await getProfile()
  const amount = n(monto)

  if (!cost_center_id) throw new Error('Debes seleccionar un centro de costo')
  if (amount <= 0) throw new Error('El monto debe ser mayor a cero')
  if (!descripcion?.trim()) throw new Error('La descripción es requerida')

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      organization_id: profile.organization_id,
      expense_date: fecha || new Date().toISOString().slice(0, 10),
      description: descripcion.trim(),
      amount,
      cost_center_id,
      expense_type: expense_type || 'administrativo',
      status: 'pendiente_factura',
      created_by: profile.id,
    })
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo crear el gasto')
  return expense
}

export async function registerExpenseInvoice(expenseId, { invoiceNumber, invoiceDate, invoiceFile }) {
  const profile = await getProfile()
  const invoice_number = String(invoiceNumber || '').trim()
  if (!invoice_number) throw new Error('Debes ingresar el número de factura')
  if (!invoiceFile) throw new Error('Debes adjuntar la factura en PDF')

  const invoice_file_url = await uploadExpenseDocument(invoiceFile, expenseId, 'invoice')

  const { data, error } = await supabase
    .from('expenses')
    .update({
      invoice_number,
      invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
      invoice_file_url,
      invoice_uploaded_at: new Date().toISOString(),
      invoice_uploaded_by: profile.id,
      status: 'pendiente_pago',
    })
    .eq('id', expenseId)
    .eq('organization_id', profile.organization_id)
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo registrar la factura del gasto')
  return data
}

export async function markExpenseAsPagado(
  expenseId,
  { paymentReference, bankAccountId, paymentReceiptFile }
) {
  const profile = await getProfile()
  const payment_reference = String(paymentReference || '').trim()

  if (!payment_reference) throw new Error('Debes ingresar el número de boleta')
  if (!paymentReceiptFile) throw new Error('Debes adjuntar la boleta de pago en PDF')
  const bankAccount = await getBankAccountForProfile(profile, bankAccountId)
  const payment_bank_name = String(bankAccount.bank_name || '').trim()
  const payment_account_number = String(bankAccount.account_number || '').trim()
  if (!payment_bank_name) throw new Error('Debes ingresar el banco desde el que se realizó el débito')
  if (!payment_account_number) throw new Error('Debes ingresar el número de cuenta desde el que se realizó el débito')

  const { data: current, error: loadError } = await supabase
    .from('expenses')
    .select(`
      id,
      organization_id,
      expense_date,
      description,
      amount,
      expense_type,
      cost_center_id,
      status,
      invoice_number,
      invoice_file_url,
      journal_entry_id
    `)
    .eq('id', expenseId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (loadError) throw new Error(loadError.message)
  if (!current.invoice_number || !current.invoice_file_url) {
    throw new Error('No se puede pagar un gasto sin factura adjunta')
  }

  const payment_receipt_file_url = await uploadExpenseDocument(paymentReceiptFile, expenseId, 'payment')
  const paidAt = new Date().toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('expenses')
    .update({
      payment_reference: payment_reference,
      payment_bank_name,
      payment_account_number,
      bank_account_id: bankAccount.id,
      payment_receipt_file_url,
      paid_at: paidAt,
      paid_by: profile.id,
      status: 'pagado',
    })
    .eq('id', expenseId)
    .eq('organization_id', profile.organization_id)
    .select()
    .single()

  if (updateError) throw new Error(updateError.message || 'No se pudo registrar el pago del gasto')

  try {
    await createExpensePaymentEntryWithBank({ expense: updated, profile })
  } catch (accountingError) {
    console.warn('Asiento de pago de gasto no generado:', accountingError.message)
  }

  return updated
}

export async function ensureSupplierPaymentExpense({
  cxpRow,
  paymentBatchId,
  paymentReference,
  bankAccountId,
  paymentBankName,
  paymentAccountNumber,
  paymentReceiptFileUrl,
  paidAt,
  paidBy,
  profile,
}) {
  const { data: existing } = await supabase
    .from('expenses')
    .select('id')
    .eq('supplier_accounts_payable_id', cxpRow.id)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: productionCc, error: ccError } = await supabase
    .from('cost_centers')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('code', 'CC-01')
    .eq('is_active', true)
    .maybeSingle()

  if (ccError) throw new Error(ccError.message)
  if (!productionCc?.id) throw new Error('No se encontró el centro de costo de producción (CC-01)')

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      organization_id: profile.organization_id,
      expense_date: paidAt.slice(0, 10),
      description: `CxP proveedor pagada: ${cxpRow.suppliers?.name || 'Proveedor'} · ${cxpRow.invoice_number || cxpRow.description || ''}`.trim(),
      amount: n(cxpRow.paid_amount || cxpRow.net_payable_amount || cxpRow.payable_amount),
      cost_center_id: productionCc.id,
      expense_type: 'produccion',
      supplier_id: cxpRow.supplier_id,
      supplier_accounts_payable_id: cxpRow.id,
      supplier_payment_batch_id: paymentBatchId,
      bank_account_id: bankAccountId || null,
      invoice_number: cxpRow.invoice_number,
      invoice_date: cxpRow.invoice_date || paidAt.slice(0, 10),
      invoice_file_url: cxpRow.invoice_file_url,
      invoice_uploaded_at: cxpRow.invoice_uploaded_at || paidAt,
      invoice_uploaded_by: cxpRow.invoice_uploaded_by || paidBy,
      payment_reference: paymentReference,
      payment_bank_name: paymentBankName,
      payment_account_number: paymentAccountNumber,
      payment_receipt_file_url: paymentReceiptFileUrl,
      paid_at: paidAt,
      paid_by: paidBy,
      status: 'pagado',
      created_by: profile.id,
    })
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo reflejar la CxP pagada como gasto')

  try {
    await createExpensePaymentEntryWithBank({ expense, profile })
  } catch (accountingError) {
    console.warn('Asiento de gasto por CxP pagada no generado:', accountingError.message)
  }

  return expense.id
}

export async function deleteGasto(gastoId) {
  await supabase.from('expenses').update({ journal_entry_id: null }).eq('id', gastoId)

  const { error } = await supabase.from('expenses').delete().eq('id', gastoId)
  if (error) throw new Error(error.message || 'No se pudo eliminar el gasto')
}

export async function getGastosSummary(dateFrom, dateTo) {
  const profile = await getProfile()

  let query = supabase
    .from('expenses')
    .select(`
      amount,
      expense_type,
      cost_centers ( id, code, name )
    `)
    .eq('organization_id', profile.organization_id)

  if (dateFrom) query = query.gte('expense_date', dateFrom)
  if (dateTo) query = query.lte('expense_date', dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const byCC = {}
  ;(data || []).forEach((gasto) => {
    const cc = gasto.cost_centers
    if (!cc) return
    if (!byCC[cc.id]) byCC[cc.id] = { code: cc.code, name: cc.name, total: 0, count: 0 }
    byCC[cc.id].total += n(gasto.amount)
    byCC[cc.id].count += 1
  })

  return Object.values(byCC).sort((a, b) => a.code.localeCompare(b.code))
}
