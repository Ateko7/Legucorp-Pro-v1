import { supabase } from '../../../lib/supabase'

function normalizeCoordinate(value, { min, max, label }) {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  if (Number.isNaN(parsed)) throw new Error(`${label} no es valida`)
  if (parsed < min || parsed > max) throw new Error(`${label} esta fuera de rango`)
  return parsed
}

function normalizeDeliveryLocation(latitudeValue, longitudeValue) {
  const latitude = normalizeCoordinate(latitudeValue, { min: -90, max: 90, label: 'La latitud' })
  const longitude = normalizeCoordinate(longitudeValue, { min: -180, max: 180, label: 'La longitud' })

  if ((latitude == null) !== (longitude == null)) {
    throw new Error('Debes guardar latitud y longitud juntas')
  }

  if (latitude === 0 && longitude === 0) {
    throw new Error('Las coordenadas 0,0 no son una ubicacion valida para entrega')
  }

  return { latitude, longitude }
}

async function replaceClientAddresses(clientId, addresses) {
  const { error } = await supabase.rpc('replace_client_addresses', {
    p_client_id: clientId,
    p_addresses: addresses,
  })

  if (error) {
    throw new Error(error.message || 'No se pudieron actualizar las direcciones del cliente')
  }
}

export async function getClients() {
  const { data, error } = await supabase
    .from('clients')
    .select(`
      *,
      client_addresses (
        id,
        address_label,
        address_line,
        is_default
      ),
      salespeople (
        id,
        name
      )
    `)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message || 'No se pudieron cargar los clientes')
  return data || []
}

export async function getSalespeopleForClients() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  const { data, error } = await supabase
    .from('salespeople')
    .select('id, name, commission_pct')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'activo')
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function createClient(payload) {
  const deliveryLocation = normalizeDeliveryLocation(payload.delivery_latitude, payload.delivery_longitude)
  const {
    commercial_name,
    legal_name,
    nit,
    main_address,
    credit_days,
    main_contact,
    phone,
    email,
    channel,
    delivery_conditions,
    salesperson_id,
    status = 'activo',
    addresses = [],
  } = payload

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', (await supabase.auth.getUser()).data.user.id)
    .single()

  if (profileError) throw new Error(profileError.message || 'No se pudo obtener la organización del usuario')

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      organization_id: profile.organization_id,
      commercial_name,
      legal_name: legal_name || null,
      nit: nit || null,
      main_address: main_address || null,
      delivery_latitude: deliveryLocation.latitude,
      delivery_longitude: deliveryLocation.longitude,
      credit_days: Number(credit_days || 0),
      main_contact: main_contact || null,
      phone: phone || null,
      email: email || null,
      channel: channel || null,
      delivery_conditions: delivery_conditions || null,
      salesperson_id: salesperson_id || null,
      status,
      es_exportacion:       !!payload.es_exportacion,
      pais:                 payload.pais || null,
      moneda_default:       payload.moneda_default || 'GTQ',
      facturar_por_sombrilla: !!payload.facturar_por_sombrilla,
    })
    .select()
    .single()

  if (error) throw new Error(error.message || 'No se pudo crear el cliente')

  if (addresses.length > 0) {
    const addressRows = addresses
      .filter((a) => a.address_line?.trim())
      .map((a, index) => ({
        address_label: a.address_label || null,
        address_line: a.address_line,
        is_default: !!a.is_default || index === 0,
      }))

    if (addressRows.length > 0) {
      await replaceClientAddresses(client.id, addressRows)
    }
  }

  return client
}

export async function deleteClient(id) {
  const { error } = await supabase
    .from('clients')
    .update({ status: 'inactivo' })
    .eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar el cliente')
}

export async function updateClient(id, payload) {
  const deliveryLocation = normalizeDeliveryLocation(payload.delivery_latitude, payload.delivery_longitude)
  const {
    commercial_name,
    legal_name,
    nit,
    main_address,
    credit_days,
    main_contact,
    phone,
    email,
    channel,
    delivery_conditions,
    salesperson_id,
    status,
    addresses = [],
  } = payload

  const { error } = await supabase
    .from('clients')
    .update({
      commercial_name,
      legal_name: legal_name || null,
      nit: nit || null,
      main_address: main_address || null,
      delivery_latitude: deliveryLocation.latitude,
      delivery_longitude: deliveryLocation.longitude,
      credit_days: Number(credit_days || 0),
      main_contact: main_contact || null,
      phone: phone || null,
      email: email || null,
      channel: channel || null,
      delivery_conditions: delivery_conditions || null,
      salesperson_id: salesperson_id || null,
      status,
      es_exportacion:       !!payload.es_exportacion,
      pais:                 payload.pais || null,
      moneda_default:       payload.moneda_default || 'GTQ',
      facturar_por_sombrilla: !!payload.facturar_por_sombrilla,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo actualizar el cliente')

  const addressRows = addresses
    .filter((a) => a.address_line?.trim())
    .map((a, index) => ({
      address_label: a.address_label || null,
      address_line: a.address_line,
      is_default: !!a.is_default || index === 0,
    }))

  await replaceClientAddresses(id, addressRows)
}
