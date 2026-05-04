import * as XLSX from 'xlsx'
import { supabase } from '../../../lib/supabase'

const SHEETS = {
  suppliers: {
    label: 'Proveedores',
    aliases: ['suppliers', 'proveedores'],
    required: ['name'],
    sample: {
      name: 'Finca La Esperanza',
      nit: '12345678',
      contact_name: 'Juan Perez',
      phone: '55555555',
      email: 'compras@fincaesperanza.com',
      payment_days: 15,
      tax_regime: 'pagos_trimestrales',
      status: 'activo',
    },
  },
  clients: {
    label: 'Clientes',
    aliases: ['clients', 'clientes'],
    required: ['commercial_name'],
    sample: {
      commercial_name: 'Super TAP',
      legal_name: 'SUPER TAP S.A.',
      nit: '104255625',
      main_address: 'Boulevard Industrial Norte',
      delivery_latitude: '',
      delivery_longitude: '',
      credit_days: 30,
      main_contact: 'Compras',
      phone: '55555555',
      email: 'compras@supertap.com',
      channel: 'mayorista',
      delivery_conditions: '',
      status: 'activo',
      es_exportacion: false,
      pais: 'GT',
      moneda_default: 'GTQ',
      facturar_por_sombrilla: false,
      address_1_label: 'Principal',
      address_1: 'Boulevard Industrial Norte',
      address_2_label: '',
      address_2: '',
    },
  },
  materials: {
    label: 'Materias primas',
    aliases: ['materials', 'materias primas', 'materias_primas'],
    required: ['common_name', 'category', 'base_unit'],
    sample: {
      code: '',
      common_name: 'Espinaca',
      category: 'materia_prima_vegetal',
      base_unit: 'lb',
      purchase_presentation: 'caja',
      preferred_supplier_name: '',
      estimated_cost: 4.25,
      shelf_life_days: 7,
      requires_lot: true,
      requires_temperature: true,
      minimum_stock: 100,
      status: 'activo',
    },
  },
  product_bases: {
    label: 'Productos base',
    aliases: ['product_bases', 'productos base', 'productos_base'],
    required: ['common_name'],
    sample: {
      code: '',
      common_name: 'Espinaca',
      category: 'Leafy greens',
      status: 'activo',
    },
  },
  product_presentations: {
    label: 'Presentaciones',
    aliases: ['product_presentations', 'presentaciones'],
    required: ['product_base_name', 'display_name'],
    sample: {
      code: '',
      product_base_name: 'Espinaca',
      product_base_code: '',
      display_name: 'Espinaca sin Tallo 16 Onz',
      net_weight: 16,
      unit: 'oz',
      shelf_life_days: 10,
      suggested_price: 14.57,
      packaging_material_name: '',
      packaging_material_code: '',
      packaging_quantity: 1,
      peso_neto_kg: 0.4536,
      barcode: '',
      status: 'activo',
    },
  },
  client_prices: {
    label: 'Precios cliente',
    aliases: ['client_prices', 'precios cliente', 'precios_cliente'],
    required: ['client_name', 'product_display_name', 'agreed_price'],
    sample: {
      client_name: 'Super TAP',
      client_nit: '104255625',
      product_display_name: 'Espinaca sin Tallo 16 Onz',
      product_code: '',
      agreed_price: 14.57,
      valid_from: new Date().toISOString().slice(0, 10),
      valid_until: '',
      is_active: true,
      notes: 'Precio inicial',
    },
  },
}

const VALID_MATERIAL_CATEGORIES = new Set([
  'materia_prima_vegetal',
  'material_empaque',
  'insumo_proceso',
  'producto_granel',
  'quimico_sanitizante',
  'otros',
])

const VALID_SUPPLIER_TAX_REGIMES = new Set([
  'pequeno_contribuyente',
  'pagos_trimestrales',
  'sujeto_a_retencion',
])

function n(value) {
  const num = Number(value)
  return Number.isNaN(num) ? 0 : num
}

function text(value) {
  return String(value ?? '').trim()
}

function key(value) {
  return text(value).toLowerCase()
}

function normalizedKey(value) {
  return key(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function bool(value, fallback = false) {
  if (value === '' || value == null) return fallback
  if (typeof value === 'boolean') return value
  const normalized = key(value)
  if (['true', '1', 'si', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return fallback
}

function maybeNumber(value, fallback = null) {
  if (value === '' || value == null) return fallback
  const num = Number(value)
  return Number.isNaN(num) ? fallback : num
}

function dateValue(value, fallback = '') {
  if (!value) return fallback
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    }
  }
  return String(value).slice(0, 10)
}

function rowHasData(row) {
  return Object.values(row).some((value) => text(value) !== '')
}

function normalizeSheetName(value) {
  return text(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function resolveWorkbookSheetName(workbook, config, fallbackName) {
  const availableSheetNames = workbook.SheetNames || []
  const aliasSet = new Set([fallbackName, ...(config.aliases || [])].map(normalizeSheetName))
  return availableSheetNames.find((sheetName) => aliasSet.has(normalizeSheetName(sheetName))) || null
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }).filter(rowHasData)
}

function buildWorkbookMaps(data) {
  const maps = {
    clientsByName: new Map(),
    clientsByNit: new Map(),
    productBasesByName: new Map(),
    productBasesByCode: new Map(),
    presentationsByName: new Map(),
    presentationsByCode: new Map(),
  }

  ;(data.clients || []).forEach((row) => {
    if (text(row.commercial_name)) maps.clientsByName.set(normalizedKey(row.commercial_name), row)
    if (text(row.nit)) maps.clientsByNit.set(normalizedKey(row.nit), row)
  })

  ;(data.product_bases || []).forEach((row) => {
    if (text(row.common_name)) maps.productBasesByName.set(normalizedKey(row.common_name), row)
    if (text(row.code)) maps.productBasesByCode.set(normalizedKey(row.code), row)
  })

  ;(data.product_presentations || []).forEach((row) => {
    if (text(row.display_name)) maps.presentationsByName.set(normalizedKey(row.display_name), row)
    if (text(row.code)) maps.presentationsByCode.set(normalizedKey(row.code), row)
  })

  return maps
}

function inferProductBaseFromDisplayName(displayName, productBasesByName) {
  const normalizedDisplayName = normalizedKey(displayName)
  if (!normalizedDisplayName) return null

  let bestMatch = null
  let bestLength = 0

  for (const [baseName, row] of productBasesByName.entries()) {
    const normalizedBaseName = normalizedKey(baseName)
    if (
      normalizedDisplayName === normalizedBaseName ||
      normalizedDisplayName.startsWith(`${normalizedBaseName} `) ||
      normalizedDisplayName.startsWith(`${normalizedBaseName}-`)
    ) {
      if (normalizedBaseName.length > bestLength) {
        bestMatch = row
        bestLength = normalizedBaseName.length
      }
    }
  }

  return bestMatch
}

const LOWERCASE_COLUMNS = new Set(['category', 'tax_regime', 'status', 'base_unit'])

function normalizeRows(rows) {
  return rows.map((row, index) => {
    const normalized = { _row: index + 2 }
    Object.entries(row).forEach(([column, value]) => {
      const col = text(column)
      normalized[col] = LOWERCASE_COLUMNS.has(col) && typeof value === 'string' ? value.trim().toLowerCase() : value
    })
    return normalized
  })
}

export function downloadImportTemplate() {
  const workbook = XLSX.utils.book_new()

  Object.entries(SHEETS).forEach(([sheetName, config]) => {
    const headers = Object.keys(config.sample)
    const worksheet = XLSX.utils.json_to_sheet([config.sample], { header: headers })
    XLSX.utils.book_append_sheet(workbook, worksheet, config.label || sheetName)
  })

  XLSX.writeFile(workbook, 'legucorp-import-template.xlsx')
}

export async function readImportWorkbook(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const parsed = {}
  let matchedSheets = 0

  Object.entries(SHEETS).forEach(([sheetName, config]) => {
    const workbookSheetName = resolveWorkbookSheetName(workbook, config, sheetName)
    if (workbookSheetName) matchedSheets += 1
    parsed[sheetName] = normalizeRows(sheetRows(workbook, workbookSheetName))
  })

  if (!matchedSheets) {
    throw new Error('El archivo no coincide con la plantilla de importacion. Descarga la plantilla y vuelve a intentarlo.')
  }

  return parsed
}

export function validateWorkbookData(data) {
  const errors = []
  const counts = {}
  const workbookMaps = buildWorkbookMaps(data)

  Object.entries(SHEETS).forEach(([sheetName, config]) => {
    const rows = data[sheetName] || []
    counts[sheetName] = rows.length
    rows.forEach((row) => {
      config.required.forEach((column) => {
        const hasValue =
          column === 'product_base_name'
            ? text(row.product_base_name) || text(row.product_base_code) || inferProductBaseFromDisplayName(row.display_name, workbookMaps.productBasesByName)
            : column === 'client_name'
              ? text(row.client_name) || text(row.client_nit)
              : column === 'product_display_name'
                ? text(row.product_display_name) || text(row.product_code)
                : text(row[column])

        if (!hasValue) {
          errors.push({ sheet: sheetName, row: row._row, message: `Falta ${column}` })
        }
      })

      if (sheetName === 'materials' && text(row.category) && !VALID_MATERIAL_CATEGORIES.has(text(row.category))) {
        errors.push({ sheet: sheetName, row: row._row, message: `Categoria invalida: ${row.category}` })
      }

      if (sheetName === 'suppliers' && text(row.tax_regime) && !VALID_SUPPLIER_TAX_REGIMES.has(text(row.tax_regime))) {
        errors.push({ sheet: sheetName, row: row._row, message: `Regimen fiscal invalido: ${row.tax_regime}` })
      }

      if (sheetName === 'product_presentations') {
        const productBase =
          (text(row.product_base_code) && workbookMaps.productBasesByCode.get(normalizedKey(row.product_base_code))) ||
          (text(row.product_base_name) && workbookMaps.productBasesByName.get(normalizedKey(row.product_base_name))) ||
          inferProductBaseFromDisplayName(row.display_name, workbookMaps.productBasesByName)

        if (!productBase) {
          errors.push({ sheet: sheetName, row: row._row, message: 'No se pudo resolver el producto base para esta presentacion' })
        }
      }

      if (sheetName === 'client_prices') {
        const client =
          (text(row.client_nit) && workbookMaps.clientsByNit.get(normalizedKey(row.client_nit))) ||
          (text(row.client_name) && workbookMaps.clientsByName.get(normalizedKey(row.client_name)))

        const presentation =
          (text(row.product_code) && workbookMaps.presentationsByCode.get(normalizedKey(row.product_code))) ||
          (text(row.product_display_name) && workbookMaps.presentationsByName.get(normalizedKey(row.product_display_name)))

        if (!client) {
          errors.push({ sheet: sheetName, row: row._row, message: 'Cliente no encontrado en la hoja de clientes' })
        }

        if (!presentation) {
          errors.push({ sheet: sheetName, row: row._row, message: 'Presentacion no encontrada en la hoja de presentaciones' })
        }
      }
    })
  })

  return { errors, counts }
}

async function getContext() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('No active user session')

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (error || !profile?.organization_id) throw new Error('User profile has no organization')
  return { organizationId: profile.organization_id, userId: user.id }
}

async function loadReferenceData(organizationId) {
  const [clients, materials, productBases, presentations, suppliers] = await Promise.all([
    supabase.from('clients').select('id, commercial_name, nit').eq('organization_id', organizationId),
    supabase.from('materials').select('id, code, common_name').eq('organization_id', organizationId),
    supabase.from('product_bases').select('id, code, common_name').eq('organization_id', organizationId),
    supabase.from('product_presentations').select('id, code, display_name').eq('organization_id', organizationId),
    supabase.from('suppliers').select('id, name, nit').eq('organization_id', organizationId),
  ])

  for (const result of [clients, materials, productBases, presentations, suppliers]) {
    if (result.error) throw new Error(result.error.message)
  }

  return {
    clients: clients.data || [],
    materials: materials.data || [],
    productBases: productBases.data || [],
    presentations: presentations.data || [],
    suppliers: suppliers.data || [],
  }
}

async function replaceClientAddresses(clientId, addresses, rowNumber) {
  const { error } = await supabase.rpc('replace_client_addresses', {
    p_client_id: clientId,
    p_addresses: addresses,
  })

  if (error) {
    throw new Error(`client_addresses row ${rowNumber}: ${error.message}`)
  }
}

function buildMaps(refs) {
  const map = {
    clientsByName: new Map(),
    clientsByNit: new Map(),
    materialsByName: new Map(),
    materialsByCode: new Map(),
    productBasesByName: new Map(),
    productBasesByCode: new Map(),
    presentationsByName: new Map(),
    presentationsByCode: new Map(),
    suppliersByName: new Map(),
    suppliersByNit: new Map(),
  }

  refs.clients.forEach((item) => {
    map.clientsByName.set(key(item.commercial_name), item)
    if (item.nit) map.clientsByNit.set(key(item.nit), item)
  })
  refs.materials.forEach((item) => {
    map.materialsByName.set(key(item.common_name), item)
    if (item.code) map.materialsByCode.set(key(item.code), item)
  })
  refs.productBases.forEach((item) => {
    map.productBasesByName.set(key(item.common_name), item)
    if (item.code) map.productBasesByCode.set(key(item.code), item)
  })
  refs.presentations.forEach((item) => {
    map.presentationsByName.set(key(item.display_name), item)
    if (item.code) map.presentationsByCode.set(key(item.code), item)
  })
  refs.suppliers.forEach((item) => {
    map.suppliersByName.set(key(item.name), item)
    if (item.nit) map.suppliersByNit.set(key(item.nit), item)
  })

  return map
}

async function upsertSuppliers(rows, context, maps, log) {
  for (const row of rows) {
    const nit = text(row.nit)
    const existing = (nit && maps.suppliersByNit.get(key(nit))) || maps.suppliersByName.get(key(row.name))
    const payload = {
      name: text(row.name),
      nit: nit || null,
      contact_name: text(row.contact_name) || null,
      phone: text(row.phone) || null,
      email: text(row.email) || null,
      payment_days: n(row.payment_days),
      tax_regime: text(row.tax_regime) || 'pagos_trimestrales',
      status: text(row.status) || 'activo',
    }

    let supplier
    if (existing) {
      const { data, error } = await supabase.from('suppliers').update(payload).eq('id', existing.id).select().single()
      if (error) throw new Error(`suppliers row ${row._row}: ${error.message}`)
      supplier = data
      log.updated += 1
    } else {
      const { data, error } = await supabase.from('suppliers').insert({
        ...payload,
        organization_id: context.organizationId,
        created_by: context.userId,
      }).select().single()
      if (error) throw new Error(`suppliers row ${row._row}: ${error.message}`)
      supplier = data
      log.created += 1
    }

    maps.suppliersByName.set(key(supplier.name), supplier)
    if (supplier.nit) maps.suppliersByNit.set(key(supplier.nit), supplier)
  }
}

async function generateMaterialCode(commonName, organizationId) {
  const words = text(commonName).toUpperCase().split(/\s+/).filter(Boolean)
  const base = words.length === 1 ? words[0].slice(0, 3) : `${words[0].slice(0, 2)}${words[1].slice(0, 2)}`

  const { data } = await supabase
    .from('materials')
    .select('code')
    .eq('organization_id', organizationId)
    .ilike('code', `${base}%`)

  const taken = new Set((data || []).map((row) => row.code))
  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

async function upsertClients(rows, context, maps, log) {
  for (const row of rows) {
    const nit = text(row.nit)
    const existing = (nit && maps.clientsByNit.get(key(nit))) || maps.clientsByName.get(key(row.commercial_name))
    const payload = {
      commercial_name: text(row.commercial_name),
      legal_name: text(row.legal_name) || null,
      nit: nit || null,
      main_address: text(row.main_address) || null,
      delivery_latitude: maybeNumber(row.delivery_latitude),
      delivery_longitude: maybeNumber(row.delivery_longitude),
      credit_days: n(row.credit_days),
      main_contact: text(row.main_contact) || null,
      phone: text(row.phone) || null,
      email: text(row.email) || null,
      channel: text(row.channel) || null,
      delivery_conditions: text(row.delivery_conditions) || null,
      status: text(row.status) || 'activo',
      es_exportacion: bool(row.es_exportacion),
      pais: text(row.pais) || null,
      moneda_default: text(row.moneda_default) || 'GTQ',
      facturar_por_sombrilla: bool(row.facturar_por_sombrilla),
    }

    let client
    if (existing) {
      const { data, error } = await supabase.from('clients').update(payload).eq('id', existing.id).select().single()
      if (error) throw new Error(`clients row ${row._row}: ${error.message}`)
      client = data
      log.updated += 1
    } else {
      const { data, error } = await supabase.from('clients').insert({
        ...payload,
        organization_id: context.organizationId,
        created_by: context.userId,
      }).select().single()
      if (error) throw new Error(`clients row ${row._row}: ${error.message}`)
      client = data
      log.created += 1
    }

    maps.clientsByName.set(key(client.commercial_name), client)
    if (client.nit) maps.clientsByNit.set(key(client.nit), client)

    const addressRows = [
      { label: row.address_1_label, line: row.address_1 },
      { label: row.address_2_label, line: row.address_2 },
    ].filter((address) => text(address.line)).map((address, index) => ({
      address_label: text(address.label) || null,
      address_line: text(address.line),
      is_default: index === 0,
    }))

    if (addressRows.length) {
      await replaceClientAddresses(client.id, addressRows, row._row)
    }
  }
}

async function upsertMaterials(rows, context, maps, log) {
  for (const row of rows) {
    const supplier = text(row.preferred_supplier_name)
      ? maps.suppliersByName.get(key(row.preferred_supplier_name))
      : null
    if (text(row.preferred_supplier_name) && !supplier) {
      throw new Error(`materials row ${row._row}: supplier not found`)
    }

    const existing = (text(row.code) && maps.materialsByCode.get(key(row.code))) || maps.materialsByName.get(key(row.common_name))
    const code = text(row.code) || existing?.code || await generateMaterialCode(row.common_name, context.organizationId)
    const payload = {
      code,
      common_name: text(row.common_name),
      category: text(row.category) || null,
      base_unit: text(row.base_unit),
      purchase_presentation: text(row.purchase_presentation) || null,
      preferred_supplier_id: supplier?.id || null,
      estimated_cost: n(row.estimated_cost),
      shelf_life_days: maybeNumber(row.shelf_life_days),
      requires_lot: bool(row.requires_lot, true),
      requires_temperature: bool(row.requires_temperature),
      minimum_stock: n(row.minimum_stock),
      status: text(row.status) || 'activo',
    }

    let material
    if (existing) {
      const { data, error } = await supabase.from('materials').update(payload).eq('id', existing.id).select().single()
      if (error) throw new Error(`materials row ${row._row}: ${error.message}`)
      material = data
      log.updated += 1
    } else {
      const { data, error } = await supabase.from('materials').insert({
        ...payload,
        organization_id: context.organizationId,
        created_by: context.userId,
      }).select().single()
      if (error) throw new Error(`materials row ${row._row}: ${error.message}`)
      material = data
      log.created += 1
    }

    maps.materialsByName.set(key(material.common_name), material)
    maps.materialsByCode.set(key(material.code), material)
  }
}

async function upsertProductBases(rows, context, maps, log) {
  for (const row of rows) {
    const existing = (text(row.code) && maps.productBasesByCode.get(key(row.code))) || maps.productBasesByName.get(key(row.common_name))
    let code = text(row.code) || existing?.code
    if (!code) {
      const { data, error } = await supabase.rpc('generate_product_base_code', { p_organization_id: context.organizationId })
      if (error) throw new Error(`product_bases row ${row._row}: ${error.message}`)
      code = data
    }

    const payload = {
      code,
      common_name: text(row.common_name),
      category: text(row.category) || null,
      status: text(row.status) || 'activo',
    }

    let productBase
    if (existing) {
      const { data, error } = await supabase.from('product_bases').update(payload).eq('id', existing.id).select().single()
      if (error) throw new Error(`product_bases row ${row._row}: ${error.message}`)
      productBase = data
      log.updated += 1
    } else {
      const { data, error } = await supabase.from('product_bases').insert({
        ...payload,
        organization_id: context.organizationId,
        created_by: context.userId,
      }).select().single()
      if (error) throw new Error(`product_bases row ${row._row}: ${error.message}`)
      productBase = data
      log.created += 1
    }

    maps.productBasesByName.set(key(productBase.common_name), productBase)
    maps.productBasesByCode.set(key(productBase.code), productBase)
  }
}

async function upsertProductPresentations(rows, context, maps, log) {
  for (const row of rows) {
    const productBase =
      (text(row.product_base_code) && maps.productBasesByCode.get(key(row.product_base_code))) ||
      maps.productBasesByName.get(key(row.product_base_name)) ||
      inferProductBaseFromDisplayName(row.display_name, maps.productBasesByName)
    if (!productBase) throw new Error(`product_presentations row ${row._row}: product base not found`)

    const packagingMaterial = (text(row.packaging_material_code) && maps.materialsByCode.get(key(row.packaging_material_code))) ||
      (text(row.packaging_material_name) && maps.materialsByName.get(key(row.packaging_material_name))) ||
      null

    if ((text(row.packaging_material_code) || text(row.packaging_material_name)) && !packagingMaterial) {
      throw new Error(`product_presentations row ${row._row}: packaging material not found`)
    }

    const existing = (text(row.code) && maps.presentationsByCode.get(key(row.code))) || maps.presentationsByName.get(key(row.display_name))
    let code = text(row.code) || existing?.code
    if (!code) {
      const { data, error } = await supabase.rpc('generate_product_presentation_code', { p_organization_id: context.organizationId })
      if (error) throw new Error(`product_presentations row ${row._row}: ${error.message}`)
      code = data
    }

    const payload = {
      product_base_id: productBase.id,
      code,
      display_name: text(row.display_name),
      net_weight: n(row.net_weight),
      unit: text(row.unit) || 'oz',
      shelf_life_days: n(row.shelf_life_days),
      suggested_price: n(row.suggested_price),
      packaging_material_id: packagingMaterial?.id || null,
      packaging_quantity: n(row.packaging_quantity) || 1,
      peso_neto_kg: maybeNumber(row.peso_neto_kg),
      barcode: text(row.barcode) || null,
      status: text(row.status) || 'activo',
    }

    let presentation
    if (existing) {
      const { data, error } = await supabase.from('product_presentations').update(payload).eq('id', existing.id).select().single()
      if (error) throw new Error(`product_presentations row ${row._row}: ${error.message}`)
      presentation = data
      log.updated += 1
    } else {
      const { data, error } = await supabase.from('product_presentations').insert({
        ...payload,
        organization_id: context.organizationId,
        created_by: context.userId,
        standard_cost: 0,
      }).select().single()
      if (error) throw new Error(`product_presentations row ${row._row}: ${error.message}`)
      presentation = data
      log.created += 1
    }

    maps.presentationsByName.set(key(presentation.display_name), presentation)
    maps.presentationsByCode.set(key(presentation.code), presentation)
  }
}

async function upsertClientPrices(rows, context, maps, log) {
  for (const row of rows) {
    const client = (text(row.client_nit) && maps.clientsByNit.get(key(row.client_nit))) ||
      maps.clientsByName.get(key(row.client_name))
    if (!client) throw new Error(`client_prices row ${row._row}: client not found`)

    const presentation = (text(row.product_code) && maps.presentationsByCode.get(key(row.product_code))) ||
      maps.presentationsByName.get(key(row.product_display_name))
    if (!presentation) throw new Error(`client_prices row ${row._row}: product presentation not found`)

    await supabase
      .from('client_agreed_prices')
      .update({ is_active: false })
      .eq('client_id', client.id)
      .eq('product_presentation_id', presentation.id)
      .eq('is_active', true)

    const { error } = await supabase.from('client_agreed_prices').insert({
      organization_id: context.organizationId,
      client_id: client.id,
      product_presentation_id: presentation.id,
      agreed_price: n(row.agreed_price),
      valid_from: dateValue(row.valid_from, new Date().toISOString().slice(0, 10)),
      valid_until: dateValue(row.valid_until, null),
      is_active: bool(row.is_active, true),
      notes: text(row.notes) || null,
    })
    if (error) throw new Error(`client_prices row ${row._row}: ${error.message}`)
    log.created += 1
  }
}

export async function importWorkbookData(data) {
  const validation = validateWorkbookData(data)
  if (validation.errors.length) {
    throw new Error(`Fix ${validation.errors.length} validation error(s) before importing`)
  }

  const context = await getContext()
  const refs = await loadReferenceData(context.organizationId)
  const maps = buildMaps(refs)
  const summary = {
    suppliers: { created: 0, updated: 0 },
    clients: { created: 0, updated: 0 },
    materials: { created: 0, updated: 0 },
    product_bases: { created: 0, updated: 0 },
    product_presentations: { created: 0, updated: 0 },
    client_prices: { created: 0, updated: 0 },
  }

  await upsertSuppliers(data.suppliers || [], context, maps, summary.suppliers)
  await upsertClients(data.clients || [], context, maps, summary.clients)
  await upsertMaterials(data.materials || [], context, maps, summary.materials)
  await upsertProductBases(data.product_bases || [], context, maps, summary.product_bases)
  await upsertProductPresentations(data.product_presentations || [], context, maps, summary.product_presentations)
  await upsertClientPrices(data.client_prices || [], context, maps, summary.client_prices)

  return summary
}

export { SHEETS }
