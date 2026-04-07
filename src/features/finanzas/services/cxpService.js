import { supabase } from '../../../lib/supabase'
import { ensureSupplierPaymentExpense } from './gastosService'

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

function calcDueDate(baseDate, paymentDays) {
  const d = new Date(baseDate)
  d.setDate(d.getDate() + (n(paymentDays) || 30))
  return d.toISOString().slice(0, 10)
}

function agingBucket(daysOverdue, status) {
  if (status === 'pendiente_factura') return { label: 'Pendiente factura', color: 'stone' }
  if (daysOverdue <= 0) return { label: 'Al dia', color: 'emerald' }
  if (daysOverdue <= 30) return { label: '1-30 dias', color: 'amber' }
  if (daysOverdue <= 60) return { label: '31-60 dias', color: 'orange' }
  if (daysOverdue <= 90) return { label: '61-90 dias', color: 'red' }
  return { label: '+90 dias', color: 'rose' }
}

function getFileExtension(file) {
  const raw = (file?.name || '').split('.').pop()?.trim().toLowerCase()
  if (!raw) return 'pdf'
  return raw.replace(/[^a-z0-9]/g, '') || 'pdf'
}

function generateBatchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const SUPPLIER_TAX_REGIMES = {
  pequeno_contribuyente: {
    ivaRate: 0.05,
    retentionRate: 0,
  },
  pagos_trimestrales: {
    ivaRate: 0.12,
    retentionRate: 0,
  },
  sujeto_a_retencion: {
    ivaRate: 0.12,
    retentionRate: null,
  },
}

function roundMoney(value) {
  return Math.round((n(value) + Number.EPSILON) * 100) / 100
}

function computeSupplierTaxBreakdown(baseAmount, taxRegime) {
  const subtotal = roundMoney(baseAmount)
  const normalizedRegime = taxRegime || 'pagos_trimestrales'
  const config = SUPPLIER_TAX_REGIMES[normalizedRegime] || SUPPLIER_TAX_REGIMES.pagos_trimestrales
  const ivaRate = config.ivaRate
  const ivaAmount = roundMoney(subtotal * ivaRate)
  const retentionRate = normalizedRegime === 'sujeto_a_retencion'
    ? (subtotal > 30000 ? 0.07 : 0.05)
    : (config.retentionRate || 0)
  const withholdingAmount = roundMoney(subtotal * retentionRate)
  const totalAmount = roundMoney(subtotal + ivaAmount)
  const netPayableAmount = roundMoney(totalAmount - withholdingAmount)

  return {
    invoice_tax_regime: normalizedRegime,
    invoice_subtotal_amount: subtotal,
    invoice_iva_rate: ivaRate,
    invoice_iva_amount: ivaAmount,
    invoice_total_amount: totalAmount,
    withholding_rate: retentionRate,
    withholding_amount: withholdingAmount,
    net_payable_amount: netPayableAmount,
  }
}

function getPendingAmount(row) {
  return n(row.net_payable_amount) > 0 ? n(row.net_payable_amount) : n(row.payable_amount)
}

async function ensureSupplierAccountingAccounts(orgId) {
  const requiredAccounts = [
    { code: '1150', name: 'IVA Crédito Fiscal Compras', account_type: 'activo', normal_balance: 'debito' },
    { code: '2120', name: 'Retenciones por Pagar', account_type: 'pasivo', normal_balance: 'credito' },
  ]

  const { data: existing, error } = await supabase
    .from('accounting_accounts')
    .select('id, code')
    .eq('organization_id', orgId)
    .in('code', requiredAccounts.map((account) => account.code))

  if (error) throw new Error(error.message)

  const existingCodes = new Set((existing || []).map((account) => account.code))
  const missing = requiredAccounts.filter((account) => !existingCodes.has(account.code))

  if (missing.length) {
    const { error: insertError } = await supabase
      .from('accounting_accounts')
      .insert(missing.map((account) => ({ ...account, organization_id: orgId, is_active: true })))

    if (insertError) throw new Error(insertError.message)
  }
}

async function createSupplierInvoiceJournalEntry({ row, profile, breakdown }) {
  if (row.invoice_journal_entry_id) return row.invoice_journal_entry_id

  await ensureSupplierAccountingAccounts(profile.organization_id)

  const { data: existing } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('reference_type', 'cxp_factura')
    .eq('reference_id', row.id)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: accounts, error: accountsError } = await supabase
    .from('accounting_accounts')
    .select('id, code')
    .eq('organization_id', profile.organization_id)
    .in('code', ['1400', '1150', '2100', '2120'])

  if (accountsError) throw new Error(accountsError.message)

  const accountMap = {}
  ;(accounts || []).forEach((account) => {
    accountMap[account.code] = account.id
  })

  if (!accountMap['1400'] || !accountMap['2100']) {
    throw new Error('Catálogo contable incompleto para generar la CxP del proveedor')
  }

  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: profile.organization_id,
      entry_date: row.invoice_date || new Date().toISOString().slice(0, 10),
      description: `Factura proveedor ${row.suppliers?.name || ''} ${row.invoice_number || ''}`.trim(),
      reference_type: 'cxp_factura',
      reference_id: row.id,
      status: 'confirmado',
      created_by: profile.id,
    })
    .select()
    .single()

  if (entryError) throw new Error(entryError.message)

  const lines = [
    {
      entry_id: entry.id,
      account_id: accountMap['1400'],
      description: `Materia prima procesada ${row.internalLot || ''}`.trim(),
      debit: breakdown.invoice_subtotal_amount,
      credit: 0,
    },
    {
      entry_id: entry.id,
      account_id: accountMap['2100'],
      description: `CxP proveedor ${row.suppliers?.name || ''}`.trim(),
      debit: 0,
      credit: breakdown.net_payable_amount,
    },
  ]

  if (breakdown.invoice_iva_amount > 0 && accountMap['1150']) {
    lines.splice(1, 0, {
      entry_id: entry.id,
      account_id: accountMap['1150'],
      description: `IVA compra ${row.invoice_number || ''}`.trim(),
      debit: breakdown.invoice_iva_amount,
      credit: 0,
    })
  }

  if (breakdown.withholding_amount > 0 && accountMap['2120']) {
    lines.push({
      entry_id: entry.id,
      account_id: accountMap['2120'],
      description: `Retención proveedor ${row.suppliers?.name || ''}`.trim(),
      debit: 0,
      credit: breakdown.withholding_amount,
    })
  }

  const { error: linesError } = await supabase
    .from('journal_entry_lines')
    .insert(lines)

  if (linesError) throw new Error(linesError.message)

  return entry.id
}

export async function uploadSupplierInvoice(file, cxpId) {
  const { data: { user } } = await supabase.auth.getUser()
  const ext = getFileExtension(file)
  const path = `${user.id}/${cxpId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('supplier-invoices')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('supplier-invoices').getPublicUrl(path)
  return data.publicUrl
}

export async function uploadSupplierPaymentReceipt(file, paymentReference, supplierId) {
  const { data: { user } } = await supabase.auth.getUser()
  const ext = getFileExtension(file)
  const safeReference = String(paymentReference || 'boleta')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .slice(0, 80) || 'boleta'
  const path = `${user.id}/${supplierId}/${safeReference}-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('supplier-payment-receipts')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('supplier-payment-receipts').getPublicUrl(path)
  return data.publicUrl
}

function canPay(row) {
  return !!row.invoice_number && !!row.invoice_file_url && row.status !== 'pagado'
}

export async function getCxPData(includePaid = false) {
  const profile = await getProfile()

  let query = supabase
    .from('supplier_accounts_payable')
    .select(`
      id,
      source_type,
      source_inventory_lot_id,
      processed_inventory_lot_id,
      output_id,
      description,
      original_amount,
      accepted_supplier_waste_percentage,
      supplier_discount_amount,
      payable_amount,
      invoice_tax_regime,
      invoice_subtotal_amount,
      invoice_iva_rate,
      invoice_iva_amount,
      invoice_total_amount,
      invoice_number,
      invoice_date,
      invoice_file_url,
      invoice_uploaded_at,
      withholding_rate,
      withholding_amount,
      net_payable_amount,
      invoice_journal_entry_id,
      payment_reference,
      payment_batch_id,
      paid_amount,
      paid_at,
      status,
      created_at,
      updated_at,
      suppliers (
        id,
        name,
        nit,
        payment_days,
        tax_regime
      ),
      source_inventory_lot:source_inventory_lot_id (
        id,
        internal_lot,
        supplier_lot
      ),
      processed_inventory_lot:processed_inventory_lot_id (
        id,
        internal_lot,
        original_quantity,
        unit,
        accumulated_cost,
        materials (
          id,
          code,
          common_name
        )
      ),
      output:output_id (
        id,
        stage,
        output_lot_code,
        output_quantity,
        unit
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  if (!includePaid) query = query.neq('status', 'pagado')

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (data || []).map((row) => {
    const baseDate = row.invoice_date || row.created_at
    const dueDate = row.status === 'pendiente_factura'
      ? null
      : calcDueDate(baseDate, row.suppliers?.payment_days)

    const due = dueDate ? new Date(dueDate) : null
    const diffMs = due ? today - due : 0
    const daysOverdue = due ? Math.floor(diffMs / 86400000) : 0
    const aging = agingBucket(row.status === 'pagado' ? -999 : daysOverdue, row.status)

    return {
      ...row,
      dueDate,
      daysOverdue: Math.max(0, daysOverdue),
      aging,
      canPay: canPay(row),
      displayAmount: getPendingAmount(row),
      materialName:
        row.processed_inventory_lot?.materials?.common_name ||
        row.description ||
        'Materia prima procesada',
      materialCode: row.processed_inventory_lot?.materials?.code || null,
      internalLot:
        row.processed_inventory_lot?.internal_lot ||
        row.output?.output_lot_code ||
        row.source_inventory_lot?.internal_lot ||
        '—',
    }
  })
}

export async function registerSupplierInvoice(cxpId, { invoiceNumber, invoiceDate, invoiceFile, notes }) {
  const profile = await getProfile()

  const invoice_number = String(invoiceNumber || '').trim()
  if (!invoice_number) throw new Error('Ingresa el numero de factura')

  const { data: current, error: currentError } = await supabase
    .from('supplier_accounts_payable')
    .select(`
      id,
      payable_amount,
      invoice_file_url,
      invoice_tax_regime,
      invoice_subtotal_amount,
      invoice_iva_rate,
      invoice_iva_amount,
      invoice_total_amount,
      withholding_rate,
      withholding_amount,
      net_payable_amount,
      invoice_journal_entry_id,
      suppliers (
        id,
        name,
        tax_regime
      )
    `)
    .eq('id', cxpId)
    .eq('organization_id', profile.organization_id)
    .single()

  if (currentError) throw new Error(currentError.message)

  const invoice_file_url = invoiceFile
    ? await uploadSupplierInvoice(invoiceFile, cxpId)
    : current?.invoice_file_url

  if (!invoice_file_url) {
    throw new Error('Debes subir la factura antes de habilitar el pago')
  }

  const breakdown = current?.invoice_journal_entry_id
    ? {
        invoice_tax_regime: current.invoice_tax_regime || current?.suppliers?.tax_regime || 'pagos_trimestrales',
        invoice_subtotal_amount: n(current.invoice_subtotal_amount) || n(current.payable_amount),
        invoice_iva_rate: n(current.invoice_iva_rate),
        invoice_iva_amount: n(current.invoice_iva_amount),
        invoice_total_amount: n(current.invoice_total_amount) || n(current.payable_amount),
        withholding_rate: n(current.withholding_rate),
        withholding_amount: n(current.withholding_amount),
        net_payable_amount: n(current.net_payable_amount) || n(current.payable_amount),
      }
    : computeSupplierTaxBreakdown(
        current?.payable_amount,
        current?.suppliers?.tax_regime
      )

  const updatePayload = {
    invoice_number,
    invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
    invoice_file_url,
    invoice_uploaded_at: new Date().toISOString(),
    invoice_uploaded_by: profile.id,
    ...breakdown,
    status: 'pendiente_pago',
    updated_at: new Date().toISOString(),
  }

  if (notes?.trim()) updatePayload.description = notes.trim()

  const { data, error } = await supabase
    .from('supplier_accounts_payable')
    .update(updatePayload)
    .eq('id', cxpId)
    .eq('organization_id', profile.organization_id)
    .select()
    .single()

  if (error) throw new Error(error.message)

  try {
    const journalEntryId = await createSupplierInvoiceJournalEntry({
      row: {
        ...data,
        suppliers: current?.suppliers,
        internalLot: null,
      },
      profile,
      breakdown,
    })

    if (journalEntryId && !data.invoice_journal_entry_id) {
      await supabase
        .from('supplier_accounts_payable')
        .update({ invoice_journal_entry_id: journalEntryId })
        .eq('id', data.id)
    }
  } catch (accountingError) {
    console.warn('Asiento de factura CxP no generado:', accountingError.message)
  }

  return data
}

export async function markAsPagado(
  cxpId,
  {
    paymentReference = '',
    bankAccountId = '',
    paymentReceiptFile,
    paidAmount,
  } = {}
) {
  const profile = await getProfile()
  const payment_reference = String(paymentReference || '').trim()

  if (!payment_reference) {
    throw new Error('Debes ingresar el numero de documento de pago')
  }

  const { data: row, error: loadError } = await supabase
    .from('supplier_accounts_payable')
    .select(`
      id,
      organization_id,
      supplier_id,
      payable_amount,
      net_payable_amount,
      invoice_number,
      invoice_date,
      invoice_file_url,
      invoice_uploaded_at,
      invoice_uploaded_by,
      description,
      processed_inventory_lot_id,
      withholding_amount,
      suppliers ( name )
    `)
    .eq('id', cxpId)
    .single()

  if (loadError) throw new Error(loadError.message)
  if (!row.invoice_number || !row.invoice_file_url) {
    throw new Error('No se puede registrar pago sin factura subida')
  }

  const paid_amount = n(paidAmount) > 0 ? n(paidAmount) : getPendingAmount(row)

    await applySupplierCxPPayment({
      cxpRows: [row],
      paidAmountsById: { [cxpId]: paid_amount },
      paymentReference: payment_reference,
      bankAccountId,
      paymentReceiptFile,
      profile,
    })
}

async function applySupplierCxPPayment({
  cxpRows,
  paidAmountsById,
  paymentReference,
  bankAccountId,
  paymentReceiptFile,
  profile,
}) {
  const paidAt = new Date().toISOString()
  const totalPaid = cxpRows.reduce((acc, row) => acc + n(paidAmountsById[row.id] ?? getPendingAmount(row)), 0)
  const supplierId = cxpRows[0]?.supplier_id

if (!paymentReceiptFile) {
    throw new Error('Debes subir la boleta de pago en PDF')
  }
  const bankAccount = await getBankAccountForProfile(profile, bankAccountId)
  const paymentBankName = String(bankAccount.bank_name || '').trim()
  const paymentAccountNumber = String(bankAccount.account_number || '').trim()
  if (!String(paymentBankName || '').trim()) {
    throw new Error('Debes ingresar el banco desde el que se realizó el débito')
  }
  if (!String(paymentAccountNumber || '').trim()) {
    throw new Error('Debes ingresar el número de cuenta desde el que se realizó el débito')
  }

  const receiptFileUrl = await uploadSupplierPaymentReceipt(paymentReceiptFile, paymentReference, supplierId)

  const { data: batch, error: batchError } = await supabase
    .from('supplier_payment_batches')
    .insert({
      organization_id: profile.organization_id,
      supplier_id: supplierId,
        payment_reference: paymentReference,
        payment_date: paidAt.slice(0, 10),
        total_amount: totalPaid,
        receipt_file_url: receiptFileUrl,
        bank_account_id: bankAccount.id,
        debit_bank_name: String(paymentBankName || '').trim(),
        debit_account_number: String(paymentAccountNumber || '').trim(),
        created_by: profile.id,
        updated_at: paidAt,
      })
    .select()
    .single()

  if (batchError) throw new Error(batchError.message)

  for (const row of cxpRows) {
    const paid_amount = n(paidAmountsById[row.id] ?? getPendingAmount(row))

    const { error } = await supabase
      .from('supplier_accounts_payable')
      .update({
        status: 'pagado',
        paid_amount,
        paid_at: paidAt,
        paid_by: profile.id,
        payment_reference: paymentReference,
        payment_batch_id: batch.id,
        updated_at: paidAt,
      })
      .eq('id', row.id)

    if (error) throw new Error(error.message)

    try {
      await ensureSupplierPaymentExpense({
        cxpRow: {
          ...row,
          paid_amount,
        },
        paymentBatchId: batch.id,
        paymentReference,
        bankAccountId: bankAccount.id,
        paymentBankName,
        paymentAccountNumber,
        paymentReceiptFileUrl: receiptFileUrl,
        paidAt,
        paidBy: profile.id,
        profile,
      })
    } catch (expenseError) {
      console.warn('Gasto de producción por CxP pagada no generado:', expenseError.message)
    }
  }

  try {
    const orgId = profile.organization_id
    const { data: accounts } = await supabase
      .from('accounting_accounts')
      .select('id, code')
      .eq('organization_id', orgId)
      .in('code', ['2100', '1120'])

    const acctMap = {}
    ;(accounts || []).forEach((a) => { acctMap[a.code] = a.id })

    if (acctMap['2100'] && acctMap['1120']) {
      const { data: entry } = await supabase
        .from('journal_entries')
        .insert({
          organization_id: orgId,
          entry_date: new Date().toISOString().slice(0, 10),
          description: `Pago multiple CxP proveedor - Boleta ${paymentReference} - ${cxpRows[0]?.suppliers?.name || ''}`.trim(),
          reference_type: 'compra',
          reference_id: batch.id,
          status: 'confirmado',
          created_by: profile.id,
        })
        .select()
        .single()

      if (entry) {
        await supabase.from('journal_entry_lines').insert([
          {
            entry_id: entry.id,
            account_id: acctMap['2100'],
            description: 'Cancelacion CxP proveedor',
            debit: totalPaid,
            credit: 0,
          },
          {
            entry_id: entry.id,
            account_id: bankAccount.accounting_account_id || acctMap['1120'],
            description: 'Pago en banco',
            debit: 0,
            credit: totalPaid,
          },
        ])
      }
    }
  } catch (e) {
    console.warn('Asiento de pago CxP no generado:', e.message)
  }
}

export async function markManyAsPagado(
  cxpIds,
  {
    paymentReference = '',
    bankAccountId = '',
    paymentReceiptFile,
    paidAmountsById = {},
  } = {}
) {
  const profile = await getProfile()
  const payment_reference = String(paymentReference || '').trim()

  if (!Array.isArray(cxpIds) || cxpIds.length === 0) {
    throw new Error('Debes seleccionar al menos una factura para pagar')
  }

  if (!payment_reference) {
    throw new Error('Debes ingresar el numero de documento de pago')
  }

  const { data: rows, error } = await supabase
    .from('supplier_accounts_payable')
    .select(`
      id,
      organization_id,
      supplier_id,
      payable_amount,
      net_payable_amount,
      invoice_number,
      invoice_date,
      invoice_file_url,
      description,
      invoice_uploaded_at,
      invoice_uploaded_by,
      withholding_amount,
      suppliers ( name )
    `)
    .in('id', cxpIds)

  if (error) throw new Error(error.message)
  if (!rows || rows.length !== cxpIds.length) throw new Error('No se pudieron cargar todas las CxP seleccionadas')

  const supplierIds = [...new Set(rows.map((row) => row.supplier_id).filter(Boolean))]
  if (supplierIds.length !== 1) {
    throw new Error('Solo puedes pagar juntas facturas del mismo proveedor')
  }

  const invalid = rows.find((row) => !row.invoice_number || !row.invoice_file_url)
  if (invalid) {
    throw new Error('Todas las facturas seleccionadas deben tener factura subida')
  }

  await applySupplierCxPPayment({
    cxpRows: rows,
    paidAmountsById,
    paymentReference: payment_reference,
    bankAccountId,
    paymentReceiptFile,
    profile,
  })
}

export async function getSupplierPaymentReportData(month) {
  const profile = await getProfile()
  const normalizedMonth = month || new Date().toISOString().slice(0, 7)
  const monthStart = `${normalizedMonth}-01`
  const monthEnd = new Date(`${normalizedMonth}-01T00:00:00`)
  monthEnd.setMonth(monthEnd.getMonth() + 1)
  monthEnd.setDate(0)
  const monthEndStr = monthEnd.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('supplier_payment_batches')
    .select(`
      id,
      payment_reference,
      payment_date,
      total_amount,
      receipt_file_url,
      debit_bank_name,
      debit_account_number,
      suppliers (
        id,
        name,
        nit
      ),
      supplier_accounts_payable (
        id,
        invoice_number,
        invoice_date,
        invoice_file_url,
        invoice_total_amount,
        withholding_amount,
        net_payable_amount,
        paid_amount,
        processed_inventory_lot:processed_inventory_lot_id (
          internal_lot
        )
      )
    `)
    .eq('organization_id', profile.organization_id)
    .gte('payment_date', monthStart)
    .lte('payment_date', monthEndStr)
    .order('payment_date', { ascending: false })

  if (error) throw new Error(error.message)
  return data || []
}
