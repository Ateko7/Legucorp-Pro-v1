import { supabase } from '../../../lib/supabase'

async function getProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) throw new Error('No se pudo obtener el usuario activo')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message || 'No se pudo obtener la organizacion')
  return data
}

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function clean(value) {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0
    const value = char === 'x' ? random : (random & 0x3 | 0x8)
    return value.toString(16)
  })
}

function buildClientCode(client) {
  const source = client?.nit || client?.commercial_name || client?.legal_name || client?.id || 'SV'
  const normalized = String(source)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 16)
  return `IC-${normalized || 'SV'}`
}

async function getClientForPartner(clientId, organizationId) {
  if (!clientId) return null

  const { data, error } = await supabase
    .from('clients')
    .select('id, commercial_name, legal_name, nit, moneda_default')
    .eq('id', clientId)
    .eq('organization_id', organizationId)
    .single()

  if (error) throw new Error(error.message || 'No se pudo cargar el cliente seleccionado')
  return data
}

export async function getFelIntercompanyDashboard() {
  const profile = await getProfile()

  const [
    partnersResult,
    agreementsResult,
    certsResult,
    felDocsResult,
    snapshotsResult,
    transactionsResult,
    integrationEventsResult,
    pricingRulesResult,
    pricingLogsResult,
    clientsResult,
    outboxResult,
    inboxResult,
  ] = await Promise.all([
    supabase
      .from('intercompany_partners')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('intercompany_price_agreements')
      .select('*, intercompany_partners(codigo, nombre)')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('fel_certificadores')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('fel_documents')
      .select('*, fel_document_lines(*)')
      .eq('organization_id', profile.organization_id)
      .order('fecha_emision', { ascending: false })
      .limit(50),
    supabase
      .from('transfer_pricing_snapshots')
      .select('*, intercompany_partners(codigo, nombre)')
      .eq('organization_id', profile.organization_id)
      .order('calculated_at', { ascending: false })
      .limit(50),
    supabase
      .from('intercompany_transactions')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('integration_events')
      .select('*, intercompany_transactions(transaction_code, status)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('transfer_pricing_rules')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('valid_from', { ascending: false })
      .limit(50),
    supabase
      .from('transfer_pricing_logs')
      .select('*, intercompany_transactions(transaction_code)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('clients')
      .select('id, commercial_name, legal_name, nit, is_intercompany, intercompany_partner_id')
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('commercial_name', { ascending: true }),
    supabase
      .from('intercompany_outbox')
      .select('*, intercompany_partners(codigo, nombre)')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('intercompany_inbox')
      .select('*, intercompany_partners(codigo, nombre)')
      .eq('organization_id', profile.organization_id)
      .order('received_at', { ascending: false })
      .limit(50),
  ])

  const firstError = [
    partnersResult.error,
    agreementsResult.error,
    certsResult.error,
    felDocsResult.error,
    snapshotsResult.error,
    transactionsResult.error,
    integrationEventsResult.error,
    pricingRulesResult.error,
    pricingLogsResult.error,
    clientsResult.error,
    outboxResult.error,
    inboxResult.error,
  ].find(Boolean)

  if (firstError) throw new Error(firstError.message || 'No se pudo cargar FEL/intercompany')

  return {
    partners: partnersResult.data || [],
    agreements: agreementsResult.data || [],
    certificadores: certsResult.data || [],
    felDocuments: felDocsResult.data || [],
    snapshots: snapshotsResult.data || [],
    transactions: transactionsResult.data || [],
    integrationEvents: integrationEventsResult.data || [],
    pricingRules: pricingRulesResult.data || [],
    pricingLogs: pricingLogsResult.data || [],
    clients: clientsResult.data || [],
    outbox: outboxResult.data || [],
    inbox: inboxResult.data || [],
  }
}

export async function saveIntercompanyPartner(payload, id = null) {
  const profile = await getProfile()
  const selectedClient = await getClientForPartner(clean(payload.default_client_id), profile.organization_id)
  const generatedCode = selectedClient ? buildClientCode(selectedClient) : `IC-${Date.now().toString().slice(-8)}`
  const row = {
    organization_id: profile.organization_id,
    codigo: clean(payload.codigo) || generatedCode,
    nombre: clean(payload.nombre) || selectedClient?.commercial_name || selectedClient?.legal_name || 'Cliente intercompany',
    tax_id: clean(payload.tax_id) || selectedClient?.nit || 'CF',
    partner_org_id: clean(payload.partner_org_id) || generateId(),
    endpoint_url: clean(payload.endpoint_url),
    public_key: clean(payload.public_key),
    shared_secret_vault_ref: clean(payload.shared_secret_vault_ref),
    currency: clean(payload.currency) || selectedClient?.moneda_default || 'GTQ',
    default_payment_terms: n(payload.default_payment_terms || 30),
    default_client_id: clean(payload.default_client_id),
    default_fel_tipo_documento: clean(payload.default_fel_tipo_documento) || 'FACT',
    is_active: payload.is_active !== false,
    notas: clean(payload.notas),
  }

  if (!row.codigo || !row.nombre || !row.tax_id) {
    throw new Error('Codigo, nombre y NIT son requeridos')
  }

  if (id) {
    const { error } = await supabase
      .from('intercompany_partners')
      .update(row)
      .eq('id', id)
      .eq('organization_id', profile.organization_id)

    if (error) throw new Error(error.message || 'No se pudo actualizar el partner')
    return
  }

  const { error } = await supabase
    .from('intercompany_partners')
    .insert({ ...row, created_by: profile.id })

  if (error) throw new Error(error.message || 'No se pudo crear el partner')
}

export async function savePriceAgreement(payload, id = null) {
  const profile = await getProfile()
  const scopeType = clean(payload.scope_type) || 'global'
  const row = {
    organization_id: profile.organization_id,
    partner_id: clean(payload.partner_id),
    scope_type: scopeType,
    sku_id: scopeType === 'sku' ? clean(payload.sku_id) : null,
    product_base_id: scopeType === 'product' ? clean(payload.product_base_id) : null,
    category: scopeType === 'category' ? clean(payload.category) : null,
    method: clean(payload.method) || 'cost_plus',
    markup_pct: n(payload.markup_pct),
    currency: clean(payload.currency) || 'GTQ',
    valid_from: clean(payload.valid_from),
    valid_to: clean(payload.valid_to),
    tp_study_ref: clean(payload.tp_study_ref),
    tp_study_url: clean(payload.tp_study_url),
    is_active: payload.is_active !== false,
    notas: clean(payload.notas),
  }

  if (!row.partner_id || !row.valid_from) throw new Error('Partner y vigencia inicial son requeridos')
  if (scopeType === 'category' && !row.category) throw new Error('La categoria es requerida para alcance categoria')
  if (scopeType === 'product' && !row.product_base_id) throw new Error('El producto base es requerido para alcance producto')
  if (scopeType === 'sku' && !row.sku_id) throw new Error('El SKU es requerido para alcance SKU')

  if (id) {
    const { error } = await supabase
      .from('intercompany_price_agreements')
      .update(row)
      .eq('id', id)
      .eq('organization_id', profile.organization_id)

    if (error) throw new Error(error.message || 'No se pudo actualizar el acuerdo')
    return
  }

  const { error } = await supabase
    .from('intercompany_price_agreements')
    .insert({ ...row, created_by: profile.id })

  if (error) throw new Error(error.message || 'No se pudo crear el acuerdo')
}

export async function saveFelCertificador(payload, id = null) {
  const profile = await getProfile()
  const row = {
    organization_id: profile.organization_id,
    nombre: clean(payload.nombre),
    adapter_key: clean(payload.adapter_key) || 'mock',
    endpoint: clean(payload.endpoint),
    credentials_vault_ref: clean(payload.credentials_vault_ref),
    ambiente: clean(payload.ambiente) || 'sandbox',
    is_default: !!payload.is_default,
    is_active: payload.is_active !== false,
  }

  if (!row.nombre || !row.endpoint || !row.credentials_vault_ref) {
    throw new Error('Nombre, endpoint y referencia Vault son requeridos')
  }

  if (id) {
    const { error } = await supabase
      .from('fel_certificadores')
      .update(row)
      .eq('id', id)
      .eq('organization_id', profile.organization_id)

    if (error) throw new Error(error.message || 'No se pudo actualizar el certificador')
    return
  }

  const { error } = await supabase.from('fel_certificadores').insert(row)
  if (error) throw new Error(error.message || 'No se pudo crear el certificador')
}
