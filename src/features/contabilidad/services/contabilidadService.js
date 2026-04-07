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

  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: profile.organization_id,
      entry_date: cleanDate,
      description: `Transferencia bancaria ${cleanReference}: ${fromAccount.name} a ${toAccount.name}`,
      reference_type: 'ajuste',
      reference_id: transfer.id,
      status: 'confirmado',
      created_by: profile.id,
    })
    .select()
    .single()

  if (entryError) throw new Error(entryError.message)

  const { error: linesError } = await supabase
    .from('journal_entry_lines')
    .insert([
      {
        entry_id: entry.id,
        account_id: toAccount.accounting_account_id,
        description: `Transferencia recibida ${cleanReference}`,
        debit: cleanAmount,
        credit: 0,
      },
      {
        entry_id: entry.id,
        account_id: fromAccount.accounting_account_id,
        description: `Transferencia enviada ${cleanReference}`,
        debit: 0,
        credit: cleanAmount,
      },
    ])

  if (linesError) throw new Error(linesError.message)

  const { error: journalLinkError } = await supabase
    .from('bank_transfers')
    .update({
      journal_entry_id: entry.id,
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

function mapMovementSourceLabel(sourceType) {
  if (sourceType === 'opening_balance') return 'Saldo inicial'
  if (sourceType === 'bank_transfer_out') return 'Transferencia enviada'
  if (sourceType === 'bank_transfer_in') return 'Transferencia recibida'
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
