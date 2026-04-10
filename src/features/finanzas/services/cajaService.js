import { supabase } from '../../../lib/supabase'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

const EXPENSE_ACCOUNT_CODE = {
  produccion: '6200',
  logistica: '6300',
  comercial: '6100',
  administrativo: '6100',
}

async function getProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('No se pudo obtener el usuario autenticado')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

function getFileExtension(file) {
  const raw = String(file?.name || '').split('.').pop()?.trim().toLowerCase()
  if (!raw) return 'pdf'
  return raw.replace(/[^a-z0-9]/g, '') || 'pdf'
}

async function uploadCashBoxDocument(file, entityId, kind) {
  if (!file) return null
  const { data: { user } } = await supabase.auth.getUser()
  const ext = getFileExtension(file)
  const path = `${user.id}/${entityId}/${kind}-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('cash-box-documents')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('cash-box-documents').getPublicUrl(path)
  return data.publicUrl
}

async function getNextCashAccountingCode(orgId) {
  const { data, error } = await supabase
    .from('accounting_accounts')
    .select('code')
    .eq('organization_id', orgId)
    .like('code', '111%')

  if (error) throw new Error(error.message)

  const maxCode = (data || []).reduce((max, row) => {
    const parsed = parseInt(row.code, 10)
    if (Number.isNaN(parsed) || parsed >= 1120) return max
    return Math.max(max, parsed)
  }, 1110)

  return String(maxCode + 1)
}

async function ensureCashClearingAccount(orgId) {
  const { data: existing, error: loadError } = await supabase
    .from('accounting_accounts')
    .select('id')
    .eq('organization_id', orgId)
    .eq('code', '1135')
    .maybeSingle()

  if (loadError) throw new Error(loadError.message)
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('accounting_accounts')
    .insert({
      organization_id: orgId,
      code: '1135',
      name: 'Liquidaciones de caja pendientes',
      account_type: 'activo',
      normal_balance: 'debito',
      is_active: true,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data.id
}

async function getBankAccountForProfile(profile, bankAccountId) {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('id, name, bank_name, account_number, accounting_account_id')
    .eq('organization_id', profile.organization_id)
    .eq('id', bankAccountId)
    .eq('is_active', true)
    .single()

  if (error) throw new Error(error.message)
  return data
}

async function getCashBoxForProfile(profile, cashBoxId) {
  const { data, error } = await supabase
    .from('cash_boxes')
    .select('id, name, box_type, accounting_account_id, is_active')
    .eq('organization_id', profile.organization_id)
    .eq('id', cashBoxId)
    .single()

  if (error) throw new Error(error.message)
  return data
}

async function getAccountsByCodes(orgId, codes) {
  const { data, error } = await supabase
    .from('accounting_accounts')
    .select('id, code')
    .eq('organization_id', orgId)
    .in('code', codes)

  if (error) throw new Error(error.message)

  const map = {}
  ;(data || []).forEach((row) => {
    map[row.code] = row.id
  })
  return map
}

async function createJournalEntry({ profile, entry_date, description, lines, reference_id }) {
  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: profile.organization_id,
      entry_date,
      description,
      reference_type: 'ajuste',
      reference_id,
      status: 'confirmado',
      created_by: profile.id,
    })
    .select()
    .single()

  if (entryError) throw new Error(entryError.message)

  const payload = lines.map((line) => ({
    entry_id: entry.id,
    account_id: line.account_id,
    cost_center_id: line.cost_center_id || null,
    description: line.description || description,
    debit: n(line.debit),
    credit: n(line.credit),
  }))

  const { error: linesError } = await supabase
    .from('journal_entry_lines')
    .insert(payload)

  if (linesError) throw new Error(linesError.message)
  return entry.id
}

function buildMovementSummary(movement) {
  if (movement.movement_type === 'fondeo') return 'Fondeo desde banco'
  if (movement.movement_type === 'compra_mp') {
    const material = movement.materials?.code
      ? `${movement.materials.code} · ${movement.materials.common_name || 'Materia prima'}`
      : movement.materials?.common_name || 'Compra MP'
    return material
  }
  if (movement.movement_type === 'gasto') return movement.description || 'Gasto menor'
  return movement.description || movement.movement_type
}

function decorateBoxes(boxes, movements) {
  return (boxes || []).map((box) => {
    const related = movements.filter((movement) => movement.cash_box_id === box.id)
    const totalFunding = related
      .filter((movement) => movement.movement_type === 'fondeo')
      .reduce((acc, movement) => acc + n(movement.amount), 0)
    const totalSpent = related
      .filter((movement) => movement.movement_type !== 'fondeo')
      .reduce((acc, movement) => acc + n(movement.amount), 0)
    const pendingLiquidationAmount = related
      .filter((movement) => movement.status === 'pendiente_liquidacion')
      .reduce((acc, movement) => acc + n(movement.amount), 0)
    const pendingLiquidationCount = related
      .filter((movement) => movement.status === 'pendiente_liquidacion')
      .length

    return {
      ...box,
      current_balance: totalFunding - totalSpent,
      total_funding: totalFunding,
      total_spent: totalSpent,
      pending_liquidation_amount: pendingLiquidationAmount,
      pending_liquidation_count: pendingLiquidationCount,
      recent_movements: related.slice(0, 10).map((movement) => ({
        ...movement,
        summary: buildMovementSummary(movement),
      })),
    }
  })
}

export async function getCajaModuleData(includeInactive = false) {
  const profile = await getProfile()

  let boxesQuery = supabase
    .from('cash_boxes')
    .select(`
      id,
      name,
      box_type,
      description,
      is_active,
      accounting_account_id,
      created_at,
      accounting_accounts (
        id,
        code,
        name
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('name')

  if (!includeInactive) boxesQuery = boxesQuery.eq('is_active', true)

  const [boxesRes, movementsRes, liquidationsRes, bankAccountsRes, suppliersRes, materialsRes, costCentersRes] = await Promise.all([
    boxesQuery,
    supabase
      .from('cash_box_movements')
      .select(`
        id,
        cash_box_id,
        movement_date,
        movement_type,
        amount,
        quantity,
        unit_cost,
        description,
        expense_type,
        reference_number,
        support_file_url,
        status,
        bank_account_id,
        liquidation_id,
        suppliers ( id, name ),
        materials ( id, code, common_name ),
        cost_centers ( id, code, name ),
        bank_accounts ( id, name, bank_name, account_number ),
        cash_box_liquidations (
          id,
          invoice_number,
          invoice_date
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('movement_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('cash_box_liquidations')
      .select(`
        id,
        cash_box_id,
        liquidation_date,
        invoice_number,
        invoice_date,
        invoice_file_url,
        total_amount,
        notes,
        cash_boxes ( id, name, box_type )
      `)
      .eq('organization_id', profile.organization_id)
      .order('liquidation_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('bank_accounts')
      .select('id, name, bank_name, account_number')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .order('bank_name'),
    supabase
      .from('suppliers')
      .select('id, name')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('name'),
    supabase
      .from('materials')
      .select('id, code, common_name, category')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('common_name'),
    supabase
      .from('cost_centers')
      .select('id, code, name')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .order('code'),
  ])

  if (boxesRes.error) throw new Error(boxesRes.error.message)
  if (movementsRes.error) throw new Error(movementsRes.error.message)
  if (liquidationsRes.error) throw new Error(liquidationsRes.error.message)
  if (bankAccountsRes.error) throw new Error(bankAccountsRes.error.message)
  if (suppliersRes.error) throw new Error(suppliersRes.error.message)
  if (materialsRes.error) throw new Error(materialsRes.error.message)
  if (costCentersRes.error) throw new Error(costCentersRes.error.message)

  const movements = movementsRes.data || []

  return {
    boxes: decorateBoxes(boxesRes.data || [], movements),
    movements: movements.map((movement) => ({
      ...movement,
      summary: buildMovementSummary(movement),
    })),
    liquidations: liquidationsRes.data || [],
    bankAccounts: bankAccountsRes.data || [],
    suppliers: suppliersRes.data || [],
    materials: materialsRes.data || [],
    costCenters: costCentersRes.data || [],
  }
}

export async function saveCashBox({ id, name, box_type, description, is_active = true }) {
  const profile = await getProfile()
  const cleanName = String(name || '').trim()
  const cleanType = String(box_type || '').trim()
  const cleanDescription = String(description || '').trim()

  if (!cleanName) throw new Error('Debes ingresar el nombre de la caja')
  if (!['mercado', 'caja_chica'].includes(cleanType)) {
    throw new Error('Debes seleccionar el tipo de caja')
  }

  if (id) {
    const { data: existing, error: loadError } = await supabase
      .from('cash_boxes')
      .select('id, accounting_account_id')
      .eq('organization_id', profile.organization_id)
      .eq('id', id)
      .single()

    if (loadError) throw new Error(loadError.message)

    const { error } = await supabase
      .from('cash_boxes')
      .update({
        name: cleanName,
        box_type: cleanType,
        description: cleanDescription || null,
        is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) throw new Error(error.message)

    if (existing?.accounting_account_id) {
      const { error: accountError } = await supabase
        .from('accounting_accounts')
        .update({
          name: `Caja ${cleanName}`,
          is_active,
        })
        .eq('id', existing.accounting_account_id)

      if (accountError) throw new Error(accountError.message)
    }

    return id
  }

  const nextCode = await getNextCashAccountingCode(profile.organization_id)
  const { data: account, error: accountError } = await supabase
    .from('accounting_accounts')
    .insert({
      organization_id: profile.organization_id,
      code: nextCode,
      name: `Caja ${cleanName}`,
      account_type: 'activo',
      normal_balance: 'debito',
      is_active: true,
    })
    .select('id')
    .single()

  if (accountError) throw new Error(accountError.message)

  const { data: cashBox, error } = await supabase
    .from('cash_boxes')
    .insert({
      organization_id: profile.organization_id,
      accounting_account_id: account.id,
      name: cleanName,
      box_type: cleanType,
      description: cleanDescription || null,
      is_active: true,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return cashBox.id
}

export async function toggleCashBoxActive(id, is_active) {
  const profile = await getProfile()
  const { data: box, error: loadError } = await supabase
    .from('cash_boxes')
    .select('id, accounting_account_id')
    .eq('organization_id', profile.organization_id)
    .eq('id', id)
    .single()

  if (loadError) throw new Error(loadError.message)

  const { error } = await supabase
    .from('cash_boxes')
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)

  if (box?.accounting_account_id) {
    const { error: accountError } = await supabase
      .from('accounting_accounts')
      .update({ is_active })
      .eq('id', box.accounting_account_id)

    if (accountError) throw new Error(accountError.message)
  }
}

export async function createCashBoxFunding({
  cash_box_id,
  movement_date,
  amount,
  bank_account_id,
  reference_number,
  support_file,
  description,
}) {
  const profile = await getProfile()
  const cleanAmount = n(amount)
  const cleanDate = movement_date || new Date().toISOString().slice(0, 10)
  const cleanReference = String(reference_number || '').trim()
  const cleanDescription = String(description || '').trim()

  if (!cash_box_id) throw new Error('Debes seleccionar la caja a fondear')
  if (!bank_account_id) throw new Error('Debes seleccionar la cuenta bancaria de origen')
  if (cleanAmount <= 0) throw new Error('El monto del fondeo debe ser mayor a cero')
  if (!cleanReference) throw new Error('Debes ingresar la referencia o boleta del débito')

  const [cashBox, bankAccount] = await Promise.all([
    getCashBoxForProfile(profile, cash_box_id),
    getBankAccountForProfile(profile, bank_account_id),
  ])

  if (!cashBox.is_active) throw new Error('La caja seleccionada está inactiva')

  const { data: movement, error: movementError } = await supabase
    .from('cash_box_movements')
    .insert({
      organization_id: profile.organization_id,
      cash_box_id,
      movement_date: cleanDate,
      movement_type: 'fondeo',
      amount: cleanAmount,
      bank_account_id,
      reference_number: cleanReference,
      description: cleanDescription || `Fondeo ${cashBox.name}`,
      status: 'registrado',
      created_by: profile.id,
    })
    .select()
    .single()

  if (movementError) throw new Error(movementError.message)

  const supportFileUrl = support_file
    ? await uploadCashBoxDocument(support_file, movement.id, 'funding')
    : null

  if (supportFileUrl) {
    const { error: updateMovementError } = await supabase
      .from('cash_box_movements')
      .update({
        support_file_url: supportFileUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', movement.id)

    if (updateMovementError) throw new Error(updateMovementError.message)
  }

  const journalEntryId = await createJournalEntry({
    profile,
    entry_date: cleanDate,
    description: `Fondeo de ${cashBox.name} desde ${bankAccount.name}`,
    reference_id: movement.id,
    lines: [
      {
        account_id: cashBox.accounting_account_id,
        description: `Fondeo ${cashBox.name}`,
        debit: cleanAmount,
        credit: 0,
      },
      {
        account_id: bankAccount.accounting_account_id,
        description: `Débito banco ${bankAccount.name}`,
        debit: 0,
        credit: cleanAmount,
      },
    ],
  })

  const { error: movementLinkError } = await supabase
    .from('cash_box_movements')
    .update({
      journal_entry_id: journalEntryId,
      support_file_url: supportFileUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', movement.id)

  if (movementLinkError) throw new Error(movementLinkError.message)

  const { error: bankMovementError } = await supabase
    .from('bank_movements')
    .insert({
      organization_id: profile.organization_id,
      bank_account_id: bankAccount.id,
      movement_date: cleanDate,
      movement_type: 'debito',
      debit_amount: cleanAmount,
      credit_amount: 0,
      document_number: cleanReference,
      receipt_file_url: supportFileUrl,
      description: `Fondeo ${cashBox.name}`,
      source_type: 'cash_box_funding',
      source_id: movement.id,
      created_by: profile.id,
    })

  if (bankMovementError) throw new Error(bankMovementError.message)

  return movement.id
}

export async function createCashBoxDisbursement({
  cash_box_id,
  movement_date,
  movement_type,
  amount,
  quantity,
  unit_cost,
  supplier_id,
  material_id,
  cost_center_id,
  expense_type,
  reference_number,
  description,
  support_file,
}) {
  const profile = await getProfile()
  const cleanType = String(movement_type || '').trim()
  const cleanDate = movement_date || new Date().toISOString().slice(0, 10)
  const cleanReference = String(reference_number || '').trim()
  const cleanDescription = String(description || '').trim()
  const cleanQuantity = n(quantity)
  const cleanUnitCost = n(unit_cost)
  let cleanAmount = n(amount)

  if (!cash_box_id) throw new Error('Debes seleccionar la caja')
  if (!['compra_mp', 'gasto'].includes(cleanType)) {
    throw new Error('Tipo de salida no válido')
  }

  if (cleanType === 'compra_mp') {
    if (!material_id) throw new Error('Debes seleccionar la materia prima')
    if (cleanQuantity > 0 && cleanUnitCost > 0) {
      cleanAmount = cleanQuantity * cleanUnitCost
    }
  }

  if (cleanType === 'gasto') {
    if (!cost_center_id) throw new Error('Debes seleccionar el centro de costo')
    if (!expense_type) throw new Error('Debes seleccionar el tipo de gasto')
  }

  if (cleanAmount <= 0) throw new Error('El monto de la salida debe ser mayor a cero')

  const cashBox = await getCashBoxForProfile(profile, cash_box_id)
  if (!cashBox.is_active) throw new Error('La caja seleccionada está inactiva')

  const clearingAccountId = await ensureCashClearingAccount(profile.organization_id)

  const { data: movement, error: movementError } = await supabase
    .from('cash_box_movements')
    .insert({
      organization_id: profile.organization_id,
      cash_box_id,
      movement_date: cleanDate,
      movement_type: cleanType,
      amount: cleanAmount,
      quantity: cleanType === 'compra_mp' && cleanQuantity > 0 ? cleanQuantity : null,
      unit_cost: cleanType === 'compra_mp' && cleanUnitCost > 0 ? cleanUnitCost : null,
      supplier_id: supplier_id || null,
      material_id: cleanType === 'compra_mp' ? material_id : null,
      cost_center_id: cleanType === 'gasto' ? cost_center_id : null,
      expense_type: cleanType === 'gasto' ? expense_type : null,
      reference_number: cleanReference || null,
      description: cleanDescription || null,
      status: 'pendiente_liquidacion',
      created_by: profile.id,
    })
    .select()
    .single()

  if (movementError) throw new Error(movementError.message)

  const supportFileUrl = support_file
    ? await uploadCashBoxDocument(support_file, movement.id, 'support')
    : null

  if (supportFileUrl) {
    const { error: updateMovementError } = await supabase
      .from('cash_box_movements')
      .update({
        support_file_url: supportFileUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', movement.id)

    if (updateMovementError) throw new Error(updateMovementError.message)
  }

  const summaryDescription = cleanType === 'compra_mp'
    ? `Salida caja ${cashBox.name} pendiente de liquidar por compra MP`
    : `Salida caja ${cashBox.name} pendiente de liquidar por gasto`

  const journalEntryId = await createJournalEntry({
    profile,
    entry_date: cleanDate,
    description: summaryDescription,
    reference_id: movement.id,
    lines: [
      {
        account_id: clearingAccountId,
        cost_center_id: cleanType === 'gasto' ? cost_center_id : null,
        description: cleanDescription || summaryDescription,
        debit: cleanAmount,
        credit: 0,
      },
      {
        account_id: cashBox.accounting_account_id,
        cost_center_id: cleanType === 'gasto' ? cost_center_id : null,
        description: `Salida de ${cashBox.name}`,
        debit: 0,
        credit: cleanAmount,
      },
    ],
  })

  const { error: finalUpdateError } = await supabase
    .from('cash_box_movements')
    .update({
      journal_entry_id: journalEntryId,
      support_file_url: supportFileUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', movement.id)

  if (finalUpdateError) throw new Error(finalUpdateError.message)

  return movement.id
}

export async function liquidateCashBoxMovements({
  cash_box_id,
  movement_ids,
  invoice_number,
  invoice_date,
  invoice_file,
  notes,
}) {
  const profile = await getProfile()
  const cleanInvoiceNumber = String(invoice_number || '').trim()
  const cleanInvoiceDate = invoice_date || new Date().toISOString().slice(0, 10)
  const cleanNotes = String(notes || '').trim()
  const ids = Array.isArray(movement_ids) ? movement_ids.filter(Boolean) : []

  if (!cash_box_id) throw new Error('Debes seleccionar la caja a liquidar')
  if (!ids.length) throw new Error('Debes seleccionar movimientos pendientes para liquidar')
  if (!cleanInvoiceNumber) throw new Error('Debes ingresar el número de factura grupal')
  if (!invoice_file) throw new Error('Debes adjuntar la factura grupal en PDF')

  const cashBox = await getCashBoxForProfile(profile, cash_box_id)
  const clearingAccountId = await ensureCashClearingAccount(profile.organization_id)

  const { data: movements, error: movementsError } = await supabase
    .from('cash_box_movements')
    .select(`
      id,
      cash_box_id,
      movement_type,
      amount,
      cost_center_id,
      expense_type,
      material_id,
      materials ( id, code, common_name )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('cash_box_id', cash_box_id)
    .eq('status', 'pendiente_liquidacion')
    .in('id', ids)

  if (movementsError) throw new Error(movementsError.message)
  if ((movements || []).length !== ids.length) {
    throw new Error('Solo puedes liquidar movimientos pendientes de la caja seleccionada')
  }

  const totalAmount = (movements || []).reduce((acc, movement) => acc + n(movement.amount), 0)
  const { data: liquidation, error: liquidationError } = await supabase
    .from('cash_box_liquidations')
    .insert({
      organization_id: profile.organization_id,
      cash_box_id,
      liquidation_date: cleanInvoiceDate,
      invoice_number: cleanInvoiceNumber,
      invoice_date: cleanInvoiceDate,
      notes: cleanNotes || null,
      total_amount: totalAmount,
      created_by: profile.id,
    })
    .select()
    .single()

  if (liquidationError) throw new Error(liquidationError.message)

  const invoiceFileUrl = await uploadCashBoxDocument(invoice_file, liquidation.id, 'invoice')
  const { error: updateLiquidationError } = await supabase
    .from('cash_box_liquidations')
    .update({
      invoice_file_url: invoiceFileUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', liquidation.id)

  if (updateLiquidationError) throw new Error(updateLiquidationError.message)

  const expenseCodes = Array.from(new Set(
    (movements || [])
      .filter((movement) => movement.movement_type === 'gasto')
      .map((movement) => EXPENSE_ACCOUNT_CODE[movement.expense_type] || '6100')
  ))

  const accountMap = await getAccountsByCodes(profile.organization_id, ['1400', '1135', ...expenseCodes])
  if (!accountMap['1400']) throw new Error('No se encontró la cuenta 1400 Inventario Materias Primas')
  if (!accountMap['1135'] && clearingAccountId) accountMap['1135'] = clearingAccountId

  const groupedExpenseLines = {}
  const lines = []

  ;(movements || []).forEach((movement) => {
    if (movement.movement_type === 'compra_mp') {
      lines.push({
        account_id: accountMap['1400'],
        description: `Liquidación MP ${movement.materials?.code || ''} ${movement.materials?.common_name || ''}`.trim(),
        debit: n(movement.amount),
        credit: 0,
      })
      return
    }

    const accountCode = EXPENSE_ACCOUNT_CODE[movement.expense_type] || '6100'
    const key = `${accountCode}:${movement.cost_center_id || 'none'}`
    if (!groupedExpenseLines[key]) {
      groupedExpenseLines[key] = {
        account_id: accountMap[accountCode],
        cost_center_id: movement.cost_center_id || null,
        description: `Liquidación gasto de caja · ${movement.expense_type || 'administrativo'}`,
        debit: 0,
        credit: 0,
      }
    }
    groupedExpenseLines[key].debit += n(movement.amount)
  })

  lines.push(...Object.values(groupedExpenseLines))
  lines.push({
    account_id: accountMap['1135'] || clearingAccountId,
    description: `Liquidación ${cashBox.name} factura ${cleanInvoiceNumber}`,
    debit: 0,
    credit: totalAmount,
  })

  const journalEntryId = await createJournalEntry({
    profile,
    entry_date: cleanInvoiceDate,
    description: `Liquidación de ${cashBox.name} · factura ${cleanInvoiceNumber}`,
    reference_id: liquidation.id,
    lines,
  })

  const { error: linkLiquidationError } = await supabase
    .from('cash_box_liquidations')
    .update({
      invoice_file_url: invoiceFileUrl,
      journal_entry_id: journalEntryId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', liquidation.id)

  if (linkLiquidationError) throw new Error(linkLiquidationError.message)

  const { error: movementsUpdateError } = await supabase
    .from('cash_box_movements')
    .update({
      status: 'liquidado',
      liquidation_id: liquidation.id,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (movementsUpdateError) throw new Error(movementsUpdateError.message)

  return liquidation.id
}
