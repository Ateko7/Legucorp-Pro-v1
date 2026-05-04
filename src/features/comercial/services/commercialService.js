import * as XLSX from 'xlsx'
import { supabase } from '../../../lib/supabase'
import { convertProspectToClient } from '../../cotizaciones/services/cotizacionesService'
import {
  COMMERCIAL_CATALOG_DEFAULTS,
  COMMERCIAL_PERMISSIONS_DEFAULTS,
  COMMERCIAL_RULE_DEFAULTS,
  mockAlerts,
  mockFollowups,
  mockProfitability,
  mockProspects,
} from './commercialMockData'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function text(value) {
  return String(value ?? '').trim()
}

function normalizeText(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeDigits(value) {
  return text(value).replace(/\D+/g, '')
}

function normalizeCommercialChannel(value) {
  const normalized = normalizeText(value)

  if (!normalized) return ''
  if (['horeca', 'foodservice', 'restaurantes', 'restaurante'].includes(normalized)) return 'HORECA'
  if (['particular', 'directo', 'consumidor_final'].includes(normalized)) return 'Particular'
  if (['retail', 'supermercado', 'supermercados'].includes(normalized)) return 'Retail'
  if (['distribuidor', 'distribuidores', 'mayorista', 'mayoristas'].includes(normalized)) return 'Distribuidores'
  if (['tienda', 'tiendas', 'detalle'].includes(normalized)) return 'Tiendas'

  return ''
}

function catalogCodeFromLabel(label) {
  return normalizeText(label).replace(/\s+/g, '_')
}

function toCatalogOption(item) {
  if (item && typeof item === 'object') {
    return {
      code: item.code || catalogCodeFromLabel(item.label),
      label: item.label || item.code || '',
    }
  }

  return {
    code: catalogCodeFromLabel(item),
    label: text(item),
  }
}

function toCatalogOptions(items = []) {
  return items.map(toCatalogOption)
}

function isoDate(value) {
  return value ? new Date(value).toISOString() : null
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString()
}

async function getProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) throw new Error('No se pudo identificar al usuario')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

const COMMERCIAL_ALLOW_MOCKS = import.meta.env.DEV || import.meta.env.VITE_ALLOW_COMMERCIAL_MOCKS === 'true'

function isRecoverableMissingResourceError(error) {
  const code = error?.code || error?.originalError?.code
  const message = error?.message || ''
  return ['42P01', '42703', '42883', 'PGRST204', 'PGRST205'].includes(code) ||
    /does not exist|not found|schema cache/i.test(message)
}

function resolveFallback(fallback, allowMock) {
  if (allowMock && COMMERCIAL_ALLOW_MOCKS) return fallback.mock
  return fallback.base
}

async function safeQuery(factory, {
  fallback = { base: null, mock: null },
  allowMock = false,
  allowMissingResource = false,
  label = 'datos',
} = {}) {
  try {
    const result = await factory()
    if (result?.error) throw result.error
    return result?.data ?? resolveFallback(fallback, allowMock)
  } catch (error) {
    if (allowMissingResource && isRecoverableMissingResourceError(error)) {
      return resolveFallback(fallback, allowMock)
    }

    throw new Error(error?.message || `No se pudo cargar ${label}`)
  }
}

function normalizeStatusLabel(value) {
  return String(value || '').replaceAll('_', ' ')
}

function buildChannels(clients, prospects) {
  return [...COMMERCIAL_CATALOG_DEFAULTS.channels]
}

function computeQuoteStatusStats(quotes) {
  return {
    sent: quotes.filter((item) => item.status === 'emitida').length,
    approved: quotes.filter((item) => ['aceptada', 'convertida'].includes(item.status)).length,
    lost: quotes.filter((item) => item.status === 'rechazada').length,
  }
}

function computeProspectStats(prospects) {
  return {
    newCount: prospects.filter((item) => item.status === 'nuevo').length,
    inProgress: prospects.filter((item) => !['convertido', 'perdido', 'descartado'].includes(item.status)).length,
    converted: prospects.filter((item) => item.status === 'convertido').length,
  }
}

function computeFollowupBuckets(followups) {
  const now = new Date()
  const todayKey = now.toISOString().slice(0, 10)
  return {
    pending: followups.filter((item) => item.status === 'pendiente').length,
    overdue: followups.filter((item) => ['vencido', 'pendiente'].includes(item.status) && new Date(item.scheduled_at) < now).length,
    done: followups.filter((item) => item.status === 'realizado').length,
    today: followups.filter((item) => String(item.scheduled_at || '').slice(0, 10) === todayKey),
  }
}

function mapProspectFromDb(row, salespeopleMap = new Map()) {
  return {
    ...row,
    contact_role: row.contact_role || '',
    whatsapp: row.whatsapp || '',
    business_type: row.business_type || '',
    lead_source: row.lead_source || '',
    interest_category: row.interest_category || '',
    estimated_volume: n(row.estimated_volume),
    estimated_monthly_potential: n(row.estimated_monthly_potential),
    closing_probability: n(row.closing_probability),
    observations: row.observations || row.commercial_notes || '',
    channel: normalizeCommercialChannel(row.channel),
    salesperson_name: salespeopleMap.get(row.responsible_id)?.name || salespeopleMap.get(row.salesperson_id)?.name || '',
  }
}

function mapFollowupRow(row, lookup) {
  return {
    ...row,
    related_name: row.clients?.commercial_name || row.prospects?.commercial_name || row.related_name || 'Sin referencia',
    related_type: row.client_id ? 'cliente' : 'prospecto',
    responsible_name: lookup.salespeople.get(row.responsible_id)?.name || '',
  }
}

async function findExistingProspectMatch(input, organizationId, excludeId = null) {
  const prospects = await safeQuery(
    () => supabase.from('prospects').select('id, commercial_name, nit, email, phone').eq('organization_id', organizationId),
    { fallback: { base: [], mock: [] }, label: 'prospectos' },
  )

  const pool = (prospects || []).filter((item) => item.id !== excludeId)
  const nit = normalizeDigits(input.nit)
  const email = normalizeText(input.email)
  const phone = normalizeDigits(input.phone)
  const commercialName = normalizeText(input.commercial_name)

  if (nit) {
    const match = pool.find((item) => normalizeDigits(item.nit) === nit)
    if (match) return match
  }

  if (email) {
    const match = pool.find((item) => normalizeText(item.email) === email)
    if (match) return match
  }

  if (phone) {
    const match = pool.find((item) => normalizeDigits(item.phone) === phone)
    if (match) return match
  }

  if (commercialName) {
    return pool.find((item) => normalizeText(item.commercial_name) === commercialName) || null
  }

  return null
}

export async function getCommercialBootstrap() {
  const profile = await getProfile()

  const [clients, salespeople, prospects, quotes, orders, followups, alerts, settings, catalogs, snapshots, claims] = await Promise.all([
    safeQuery(() => supabase.from('clients').select('id, commercial_name, channel, status, salesperson_id, created_at, credit_days').eq('organization_id', profile.organization_id), { fallback: { base: [], mock: [] }, label: 'clientes' }),
    safeQuery(() => supabase.from('salespeople').select('id, name, status').eq('organization_id', profile.organization_id), { fallback: { base: [], mock: [] }, label: 'vendedores' }),
    safeQuery(() => supabase.from('prospects').select('*').eq('organization_id', profile.organization_id).order('created_at', { ascending: false }), { fallback: { base: [], mock: mockProspects }, allowMock: true, allowMissingResource: true, label: 'prospectos' }),
    safeQuery(() => supabase.from('quotes').select('id, client_id, prospect_id, status, created_at, valid_until, quote_number').eq('organization_id', profile.organization_id), { fallback: { base: [], mock: [] }, label: 'cotizaciones' }),
    safeQuery(() => supabase.from('orders').select('id, client_id, total, status, created_at, delivery_date, channel').eq('organization_id', profile.organization_id), { fallback: { base: [], mock: [] }, label: 'pedidos' }),
    safeQuery(() => supabase.from('crm_followups').select('*, clients (commercial_name), prospects (commercial_name)').eq('organization_id', profile.organization_id).order('scheduled_at', { ascending: true }), { fallback: { base: [], mock: mockFollowups }, allowMock: true, allowMissingResource: true, label: 'seguimientos CRM' }),
    safeQuery(() => supabase.from('crm_commercial_alerts').select('*').eq('organization_id', profile.organization_id).order('detected_at', { ascending: false }), { fallback: { base: [], mock: mockAlerts }, allowMock: true, allowMissingResource: true, label: 'alertas comerciales' }),
    safeQuery(() => supabase.from('crm_commercial_settings').select('setting_key, setting_value').eq('organization_id', profile.organization_id), { fallback: { base: [], mock: [] }, allowMock: true, allowMissingResource: true, label: 'configuracion comercial' }),
    safeQuery(() => supabase.from('crm_commercial_catalogs').select('catalog_type, code, label, sort_order').eq('organization_id', profile.organization_id).eq('is_active', true).order('sort_order'), { fallback: { base: [], mock: [] }, allowMock: true, allowMissingResource: true, label: 'catalogos comerciales' }),
    safeQuery(() => supabase.from('crm_customer_profitability_snapshots').select('*').eq('organization_id', profile.organization_id).order('snapshot_month', { ascending: false }), { fallback: { base: [], mock: mockProfitability }, allowMock: true, allowMissingResource: true, label: 'rentabilidad por cliente' }),
    safeQuery(() => supabase.from('claims').select('id, client_id, status, created_at').eq('organization_id', profile.organization_id), { fallback: { base: [], mock: [] }, allowMissingResource: true, label: 'reclamos' }),
  ])

  const salespeopleMap = new Map((salespeople || []).map((item) => [item.id, item]))
  const prospectsMapped = (prospects || []).map((row) => mapProspectFromDb(row, salespeopleMap))
  const lookup = { salespeople: salespeopleMap }
  const followupsMapped = (followups || []).map((row) => mapFollowupRow(row, lookup))

  const settingsMap = (settings || []).reduce((acc, row) => {
    acc[row.setting_key] = row.setting_value
    return acc
  }, {})

  const catalogMap = {}
  ;(catalogs || []).forEach((row) => {
    if (!catalogMap[row.catalog_type]) catalogMap[row.catalog_type] = []
    catalogMap[row.catalog_type].push({ code: row.code, label: row.label })
  })

  return {
    profile,
    clients: clients || [],
    salespeople: salespeople || [],
    prospects: prospectsMapped,
    quotes: quotes || [],
    orders: orders || [],
    followups: followupsMapped,
    alerts: alerts || [],
    claims: claims || [],
    profitability: snapshots || [],
    settings: {
      rules: settingsMap.commercial_rules || COMMERCIAL_RULE_DEFAULTS,
      permissions: settingsMap.commercial_permissions || COMMERCIAL_PERMISSIONS_DEFAULTS,
    },
    catalogs: {
      ...COMMERCIAL_CATALOG_DEFAULTS,
      channels: catalogMap.channel || buildChannels(clients || [], prospectsMapped),
      prospectStates: catalogMap.prospect_status || toCatalogOptions(COMMERCIAL_CATALOG_DEFAULTS.prospectStates),
      followupTypes: catalogMap.followup_type || toCatalogOptions(COMMERCIAL_CATALOG_DEFAULTS.followupTypes),
      leadSources: catalogMap.lead_source || toCatalogOptions(COMMERCIAL_CATALOG_DEFAULTS.leadSources),
      alertTypes: catalogMap.alert_type || toCatalogOptions(COMMERCIAL_CATALOG_DEFAULTS.alertTypes),
    },
  }
}

export async function getCommercialDashboard() {
  const bootstrap = await getCommercialBootstrap()
  const monthStart = startOfMonth()
  const currentOrders = bootstrap.orders.filter((item) => String(item.created_at || '').slice(0, 10) >= monthStart.slice(0, 10) && item.status !== 'cancelado')
  const currentRevenue = currentOrders.reduce((acc, item) => acc + n(item.total), 0)
  const budgetTarget = currentRevenue > 0 ? currentRevenue * 1.12 : 0
  const clientsActive = bootstrap.clients.filter((item) => item.status === 'activo').length
  const clientsInactive = bootstrap.clients.filter((item) => item.status !== 'activo').length
  const newClients = bootstrap.clients.filter((item) => String(item.created_at || '').slice(0, 10) >= monthStart.slice(0, 10)).length
  const quoteStats = computeQuoteStatusStats(bootstrap.quotes)
  const prospectStats = computeProspectStats(bootstrap.prospects)
  const followupStats = computeFollowupBuckets(bootstrap.followups)
  const profitableRows = bootstrap.profitability

  const lowMarginClients = profitableRows.filter((item) => n(item.net_margin_pct) < n(bootstrap.settings.rules.min_margin_pct)).length
  const unprofitable = profitableRows.filter((item) => n(item.net_margin) <= 0).length
  const lowPurchase = bootstrap.alerts.filter((item) => String(item.alert_type || '').toLowerCase().includes('inactivo') || String(item.alert_type || '').toLowerCase().includes('caida')).length
  const cxcOverdue = bootstrap.alerts.filter((item) => String(item.alert_type || '').toLowerCase().includes('mora')).length
  const claimsOpen = bootstrap.claims.filter((item) => item.status !== 'resuelto' && item.status !== 'cerrado').length

  const salesByChannel = Object.values(currentOrders.reduce((acc, item) => {
    const key = normalizeCommercialChannel(item.channel) || 'Sin canal'
    if (!acc[key]) acc[key] = { label: key, value: 0 }
    acc[key].value += n(item.total)
    return acc
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6)

  const salesByClient = Object.values(currentOrders.reduce((acc, item) => {
    const key = item.client_id || 'sin-cliente'
    if (!acc[key]) acc[key] = { label: bootstrap.clients.find((client) => client.id === item.client_id)?.commercial_name || 'Sin cliente', value: 0 }
    acc[key].value += n(item.total)
    return acc
  }, {})).sort((a, b) => b.value - a.value).slice(0, 8)

  const riskClients = bootstrap.alerts.slice(0, 5).map((item) => ({
    title: item.title || item.description,
    description: item.recommended_action || item.description,
    severity: item.severity,
  }))

  return {
    ...bootstrap,
    kpis: {
      monthSales: currentRevenue,
      salesVsBudget: budgetTarget > 0 ? (currentRevenue / budgetTarget) * 100 : 0,
      clientsActive,
      clientsInactive,
      newClients,
      clientDropOff: lowPurchase,
      prospectNew: prospectStats.newCount,
      prospectInFollowup: prospectStats.inProgress,
      prospectConverted: prospectStats.converted,
      quotesSent: quoteStats.sent,
      quotesApproved: quoteStats.approved,
      quotesLost: quoteStats.lost,
      conversionRate: bootstrap.quotes.length ? (quoteStats.approved / bootstrap.quotes.length) * 100 : 0,
      followupsPending: followupStats.pending,
      followupsOverdue: followupStats.overdue,
      followupsDone: followupStats.done,
      lowMarginClients,
      unprofitableClients: unprofitable,
      cxcOverdue,
      claimsOpen,
    },
    salesByChannel,
    salesByClient,
    riskClients,
    profitabilityHighlights: profitableRows.slice(0, 5),
    todayFollowups: followupStats.today,
  }
}

export async function getProspectsPageData() {
  const bootstrap = await getCommercialBootstrap()
  return {
    prospects: bootstrap.prospects,
    followups: bootstrap.followups,
    catalogs: bootstrap.catalogs,
    clients: bootstrap.clients,
    salespeople: bootstrap.salespeople,
  }
}

export async function saveProspect(input, existingId = null) {
  const profile = await getProfile()
  const duplicate = await findExistingProspectMatch(input, profile.organization_id, existingId)
  if (duplicate) {
    throw new Error('Ya existe un prospecto con ese nombre, NIT, correo o telefono. Revisa antes de crear un duplicado.')
  }

  const payload = {
    organization_id: profile.organization_id,
    commercial_name: input.commercial_name,
    legal_name: input.legal_name || null,
    nit: input.nit || null,
    contact_name: input.contact_name || null,
    contact_role: input.contact_role || null,
    phone: input.phone || null,
    whatsapp: input.whatsapp || null,
    email: input.email || null,
    commercial_address: input.commercial_address || null,
    zone: input.zone || null,
    channel: normalizeCommercialChannel(input.channel) || null,
    business_type: input.business_type || null,
    lead_source: input.lead_source || null,
    interest_category: input.interest_category || null,
    estimated_volume: n(input.estimated_volume),
    estimated_monthly_potential: n(input.estimated_monthly_potential),
    closing_probability: n(input.closing_probability),
    status: input.status || 'nuevo',
    observations: input.observations || null,
    loss_reason: input.loss_reason || null,
    responsible_id: input.responsible_id || null,
    first_contact_date: input.first_contact_date || null,
    last_contact_at: input.last_contact_at || null,
    next_followup_at: input.next_followup_at || null,
  }

  if (existingId) {
    const { data, error } = await supabase
      .from('prospects')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', existingId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await supabase.from('prospects').insert({ ...payload, created_by: profile.id }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function markProspectLost(prospectId, lossReason) {
  const { error } = await supabase
    .from('prospects')
    .update({ status: 'perdido', loss_reason: lossReason, updated_at: new Date().toISOString() })
    .eq('id', prospectId)
  if (error) throw new Error(error.message)
}

export async function convertCommercialProspect(prospectId) {
  const profile = await getProfile()
  return convertProspectToClient(prospectId, profile.organization_id, profile.id)
}

export async function getFollowupsPageData() {
  const bootstrap = await getCommercialBootstrap()
  return bootstrap
}

export async function saveFollowup(input) {
  const profile = await getProfile()
  const scheduledAt = isoDate(`${input.scheduled_date}T${input.scheduled_time || '09:00'}:00`)
  const payload = {
    organization_id: profile.organization_id,
    client_id: input.related_kind === 'cliente' ? input.client_id || null : null,
    prospect_id: input.related_kind === 'prospecto' ? input.prospect_id || null : null,
    followup_type: input.followup_type,
    responsible_id: input.responsible_id || null,
    scheduled_at: scheduledAt,
    priority: input.priority || 'media',
    status: input.status || 'pendiente',
    result: input.result || null,
    next_action: input.next_action || null,
    notes: input.notes || null,
    reminder_at: input.reminder || null,
    created_by: profile.id,
    updated_by: profile.id,
  }
  const { data, error } = await supabase.from('crm_followups').insert(payload).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function completeFollowup(followupId, nextAction) {
  const { data, error } = await supabase.rpc('crm_complete_followup', {
    p_followup_id: followupId,
    p_result: 'Realizado',
    p_next_action: nextAction || null,
    p_next_scheduled_at: null,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function reprogramFollowup(followupId, scheduledAt) {
  const { data, error } = await supabase
    .from('crm_followups')
    .update({ status: 'reprogramado', scheduled_at: scheduledAt, updated_at: new Date().toISOString() })
    .eq('id', followupId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function getCustomerProfitabilityPageData() {
  const bootstrap = await getCommercialBootstrap()
  return bootstrap
}

export async function getCommercialIntelligencePageData() {
  const bootstrap = await getCommercialBootstrap()
  return bootstrap
}

export async function resolveCommercialAlert(alertId) {
  const { error } = await supabase
    .from('crm_commercial_alerts')
    .update({ status: 'resuelta', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', alertId)
  if (error) throw new Error(error.message)
}

export async function getCommercialSettingsPageData() {
  const bootstrap = await getCommercialBootstrap()
  return bootstrap
}

export async function saveCommercialSettings({ rules, permissions }) {
  const profile = await getProfile()
  const rows = [
    {
      organization_id: profile.organization_id,
      setting_key: 'commercial_rules',
      setting_value: rules,
      updated_by: profile.id,
      created_by: profile.id,
    },
    {
      organization_id: profile.organization_id,
      setting_key: 'commercial_permissions',
      setting_value: permissions,
      updated_by: profile.id,
      created_by: profile.id,
    },
  ]

  const { error } = await supabase.from('crm_commercial_settings').upsert(rows, {
    onConflict: 'organization_id,setting_key',
    ignoreDuplicates: false,
  })
  if (error) throw new Error(error.message)
}

export function exportRowsToWorkbook({ fileName, sheets }) {
  const workbook = XLSX.utils.book_new()
  sheets.forEach((sheet) => {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows || [])
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
  })
  XLSX.writeFile(workbook, fileName)
}

export { normalizeStatusLabel }
