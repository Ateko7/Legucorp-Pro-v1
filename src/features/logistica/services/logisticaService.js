import { supabase } from '../../../lib/supabase'

export const ROUTE_STATUS = {
  PLANIFICADA: 'planificada',
  EN_RUTA: 'en_ruta',
  FINALIZADA: 'finalizada',
  CANCELADA: 'cancelada',
}

export const STOP_STATUS = {
  PENDIENTE: 'pendiente',
  EN_CAMINO: 'en_camino',
  ENTREGADO: 'entregado',
  PARCIAL: 'parcial',
  OMITIDO: 'omitido',
}

export const FUEL_TYPES = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'gasolina_regular', label: 'Gasolina regular' },
  { value: 'gasolina_super', label: 'Gasolina super' },
]

export const INCIDENT_TYPES = [
  { value: 'cliente_ausente', label: 'Cliente ausente' },
  { value: 'rechazo_cliente', label: 'Rechazo cliente' },
  { value: 'averia', label: 'Averia vehiculo' },
  { value: 'trafico', label: 'Trafico / retraso' },
  { value: 'documentacion', label: 'Documentacion' },
  { value: 'otra', label: 'Otra' },
]

export const INCIDENT_SEVERITIES = [
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
]

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function hasValidCoordinates(latitudeValue, longitudeValue) {
  const latitude = Number(latitudeValue)
  const longitude = Number(longitudeValue)

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return false
  if (latitude < -90 || latitude > 90) return false
  if (longitude < -180 || longitude > 180) return false
  if (latitude === 0 && longitude === 0) return false

  return true
}

function normalizeCoordinatePair(latitudeValue, longitudeValue) {
  if (!hasValidCoordinates(latitudeValue, longitudeValue)) return null
  return {
    latitude: Number(latitudeValue),
    longitude: Number(longitudeValue),
  }
}

function round2(value) {
  return Math.round(n(value) * 100) / 100
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(value) {
  return value ? String(value).slice(0, 10) : todayKey()
}

function sortByDateDesc(a, b) {
  return String(b.effective_date || b.created_at || '').localeCompare(String(a.effective_date || a.created_at || ''))
}

function getFileExtension(file) {
  const raw = (file?.name || '').split('.').pop()?.trim().toLowerCase()
  if (!raw) return 'pdf'
  return raw.replace(/[^a-z0-9]/g, '') || 'pdf'
}

async function generateVehicleCode(profile) {
  const prefix = 'VEH'

  const { data, error } = await supabase
    .from('vehiculos')
    .select('code')
    .eq('organization_id', profile.organization_id)
    .ilike('code', `${prefix}-%`)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const used = new Set(
    (data || [])
      .map((row) => String(row.code || '').trim().toUpperCase())
      .filter(Boolean),
  )

  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `${prefix}-${String(index).padStart(4, '0')}`
    if (!used.has(candidate)) return candidate
  }

  throw new Error('No se pudo generar un codigo automatico para el vehiculo')
}

function buildDefaultSettings(organization) {
  return {
    plant_name: organization?.name || 'Planta principal',
    plant_address: organization?.address || '',
    plant_latitude: '',
    plant_longitude: '',
    default_currency: 'GTQ',
  }
}

function getStopMapsLink(stop) {
  if (!stop) return ''
  if (hasValidCoordinates(stop.latitude, stop.longitude)) {
    return `https://www.google.com/maps?q=${stop.latitude},${stop.longitude}`
  }
  return stop.address ? `https://www.google.com/maps?q=${encodeURIComponent(stop.address)}` : ''
}

function parseDurationLabel(seconds) {
  const totalMinutes = Math.max(0, Math.round(n(seconds) / 60))
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

async function getProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id) throw new Error('Sesion no disponible')

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id, full_name')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

async function getOrganization(profile) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, address, city, country')
    .eq('id', profile.organization_id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

async function uploadDeliveryPhoto(file) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ext = getFileExtension(file)
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from('delivery-photos')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('delivery-photos').getPublicUrl(path)
  return data.publicUrl
}

async function uploadRouteDocument(file, folder = 'general') {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ext = getFileExtension(file)
  const path = `${user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from('logistics-route-documents')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from('logistics-route-documents').getPublicUrl(path)
  return data.publicUrl
}

async function invokeGoogleRouteMetrics(origin, destination) {
  const { data, error } = await supabase.functions.invoke('google-route-metrics', {
    body: { origin, destination },
  })

  if (error) {
    let details = error.message || 'No se pudo consultar Google Maps'
    const response = error.context

    if (response && typeof response.json === 'function') {
      try {
        const payload = await response.json()
        const parts = [
          payload?.error,
          payload?.stage ? `stage=${payload.stage}` : null,
        ].filter(Boolean)
        if (parts.length) details = parts.join(' · ')
      } catch {
        // Keep the original message if the function error body can't be parsed.
      }
    }

    throw new Error(details)
  }

  if (!data) {
    throw new Error('Google Maps no devolvio datos')
  }

  return data
}

async function invokeGuatemalaFuelPrices() {
  const { data, error } = await supabase.functions.invoke('gt-fuel-prices', {
    body: {},
  })

  if (error) {
    throw new Error(error.message || 'No se pudo consultar precios de combustible')
  }

  if (!data) {
    throw new Error('La fuente de combustible no devolvio datos')
  }

  return data
}

async function getCurrentFuelPrice(profile, fuelType, routeDate) {
  const { data, error } = await supabase
    .from('historial_combustible')
    .select('id, fuel_type, price_per_gallon, effective_date, notes')
    .eq('organization_id', profile.organization_id)
    .eq('fuel_type', fuelType)
    .lte('effective_date', fmtDate(routeDate))
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No hay precio de combustible configurado para ${fuelType}`)
  return data
}

function getFuelSourceMeta(fuelPrice) {
  const notes = String(fuelPrice?.notes || '').trim()
  const sourceUrlMatch = notes.match(/https?:\/\/\S+/i)

  if (/precio oficial guatemala/i.test(notes) || /mem guatemala/i.test(notes)) {
    return {
      sourceName: 'MEM Guatemala',
      sourceUrl: sourceUrlMatch?.[0] || 'https://mem.gob.gt/que-hacemos/hidrocarburos/comercializacion-downstream/precios-combustible-nacionales/',
    }
  }

  return {
    sourceName: 'Manual',
    sourceUrl: sourceUrlMatch?.[0] || null,
  }
}

function getRouteStartPoint(route) {
  const actualStart = normalizeCoordinatePair(route?.actual_start_latitude, route?.actual_start_longitude)
  if (actualStart) {
    return {
      label: route?.plant_name_snapshot || 'Salida real',
      address: route?.plant_address_snapshot || '',
      latitude: actualStart.latitude,
      longitude: actualStart.longitude,
    }
  }

  return {
    label: route?.plant_name_snapshot || 'Planta',
    address: route?.plant_address_snapshot || '',
    latitude: route?.plant_latitude ?? null,
    longitude: route?.plant_longitude ?? null,
  }
}

function getRouteStopPoint(route, routeOrder) {
  if (!routeOrder) {
    return getRouteStartPoint(route)
  }

  return {
    label: routeOrder.client_name_snapshot || `Cliente ${routeOrder.sequence_no}`,
    address: routeOrder.delivery_address_snapshot || '',
    latitude: routeOrder.delivery_latitude ?? null,
    longitude: routeOrder.delivery_longitude ?? null,
  }
}

function buildRouteSummary(route) {
  const orders = [...(route.ruta_pedidos || [])].sort((a, b) => n(a.sequence_no) - n(b.sequence_no))
  const segments = [...(route.ruta_tramos || [])].sort((a, b) => n(a.sequence_no) - n(b.sequence_no))
  const incidents = route.ruta_incidencias || []
  const extraFuel = route.ruta_combustible_extra || []
  const currentStop =
    orders.find((row) => n(row.sequence_no) === n(route.current_stop_sequence)) ||
    orders.find((row) => [STOP_STATUS.PENDIENTE, STOP_STATUS.EN_CAMINO].includes(row.status))

  return {
    ...route,
    ruta_pedidos: orders,
    ruta_tramos: segments,
    ruta_incidencias: [...incidents].sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || ''))),
    ruta_combustible_extra: [...extraFuel].sort((a, b) => String(b.fuel_date || '').localeCompare(String(a.fuel_date || ''))),
    current_stop: currentStop || null,
    current_stop_maps_link: getStopMapsLink(currentStop ? getRouteStopPoint(route, currentStop) : null),
    total_incidents: incidents.length,
    total_extra_fuel_cost: round2(extraFuel.reduce((acc, row) => acc + n(row.total_cost), 0)),
    total_progressive_cost: round2(orders.reduce((acc, row) => acc + n(row.allocated_total_cost), 0)),
  }
}

function computeKpis(routes) {
  const activeRoutes = routes.filter((row) => row.status === ROUTE_STATUS.EN_RUTA)
  const plannedRoutes = routes.filter((row) => row.status === ROUTE_STATUS.PLANIFICADA)
  const completedRoutes = routes.filter((row) => row.status === ROUTE_STATUS.FINALIZADA)
  const totalKm = round2(routes.reduce((acc, row) => acc + n(row.total_distance_km), 0))
  const totalCost = round2(routes.reduce((acc, row) => acc + n(row.total_route_cost), 0))
  const totalOrders = routes.reduce((acc, row) => acc + n(row.total_orders), 0)
  const openStops = routes.reduce(
    (acc, route) =>
      acc +
      (route.ruta_pedidos || []).filter((row) =>
        [STOP_STATUS.PENDIENTE, STOP_STATUS.EN_CAMINO].includes(row.status)
      ).length,
    0,
  )

  return {
    rutas_activas: activeRoutes.length,
    rutas_planificadas: plannedRoutes.length,
    rutas_finalizadas: completedRoutes.length,
    pedidos_en_ruta: openStops,
    km_totales: totalKm,
    costo_total: totalCost,
    costo_promedio_pedido: totalOrders ? round2(totalCost / totalOrders) : 0,
    costo_promedio_km: totalKm ? round2(totalCost / totalKm) : 0,
  }
}

async function getAvailableOrders(profile) {
  const { data: openRoutes, error: openRoutesError } = await supabase
    .from('rutas')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .in('status', [ROUTE_STATUS.PLANIFICADA, ROUTE_STATUS.EN_RUTA])

  if (openRoutesError) throw new Error(openRoutesError.message)

  const openRouteIds = (openRoutes || []).map((row) => row.id)
  let assignedOrderIds = []

  if (openRouteIds.length) {
    const { data: assignments, error: assignmentsError } = await supabase
      .from('ruta_pedidos')
      .select('order_id')
      .eq('organization_id', profile.organization_id)
      .in('ruta_id', openRouteIds)

    if (assignmentsError) throw new Error(assignmentsError.message)
    assignedOrderIds = (assignments || []).map((row) => row.order_id)
  }

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      delivery_date,
      status,
      total,
      notes,
      clients (
        id,
        commercial_name,
        main_address,
        phone,
        delivery_latitude,
        delivery_longitude
      ),
      order_items (
        id,
        quantity,
        quantity_packed,
        quantity_delivered,
        subtotal
      )
    `)
    .eq('organization_id', profile.organization_id)
    .in('status', ['empacado', 'despachado', 'facturado', 'en_logistica'])
    .order('delivery_date', { ascending: true })

  if (error) throw new Error(error.message)

  return (orders || [])
    .filter((order) => !assignedOrderIds.includes(order.id))
    .map((order) => {
      const packed = round2((order.order_items || []).reduce((acc, item) => acc + n(item.quantity_packed), 0))
      const delivered = round2((order.order_items || []).reduce((acc, item) => acc + n(item.quantity_delivered), 0))
      const pending = round2(Math.max(0, packed - delivered))
      return {
        id: order.id,
        order_number: order.order_number,
        delivery_date: order.delivery_date,
        status: order.status,
        total: round2(order.total),
        client_id: order.clients?.id || null,
        client_name: order.clients?.commercial_name || `Cliente ${order.id}`,
        delivery_address: order.clients?.main_address || '',
        delivery_latitude: order.clients?.delivery_latitude ?? null,
        delivery_longitude: order.clients?.delivery_longitude ?? null,
        phone: order.clients?.phone || '',
        pending_quantity: pending,
        packed_quantity: packed,
        can_route: pending > 0,
      }
    })
    .filter((order) => order.pending_quantity > 0)
}

async function getRouteDetail(routeId, profileArg = null) {
  const profile = profileArg || (await getProfile())

  const { data, error } = await supabase
    .from('rutas')
    .select(`
      *,
      vehiculos (
        id,
        code,
        name,
        plate,
        fuel_type,
        fuel_efficiency_km_per_gallon,
        tank_capacity_gallons,
        is_active
      ),
      ruta_pedidos (
        *,
        orders (
          id,
          order_number,
          status,
          total,
          delivery_date,
          clients (
            id,
            commercial_name,
            phone,
            main_address
          ),
          order_items (
            id,
            quantity,
            quantity_packed,
            quantity_delivered,
            unit_price,
            subtotal,
            product_presentations (
              id,
              code,
              display_name,
              unit,
              standard_cost
            )
          )
        )
      ),
      ruta_tramos (
        *
      ),
      ruta_incidencias (
        *
      ),
      ruta_combustible_extra (
        *
      )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('id', routeId)
    .single()

  if (error) throw new Error(error.message)
  return buildRouteSummary(data)
}

async function syncOrderLogisticsAssignments(profile, route, vehicle, orderIds) {
  const routeLabel = route.route_name?.trim() || `Ruta #${route.route_number}`
  const truckLabel = vehicle?.plate?.trim() || vehicle?.name?.trim() || null

  for (const orderId of orderIds) {
    const { data: existing, error: existingError } = await supabase
      .from('order_logistics')
      .select('id')
      .eq('order_id', orderId)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) throw new Error(existingError.message)

    const payload = {
      truck: truckLabel,
      route: routeLabel,
      driver_name: route.driver_name || null,
      notes: route.notes || null,
      updated_at: new Date().toISOString(),
    }

    if (existing?.id) {
      const { error } = await supabase
        .from('order_logistics')
        .update(payload)
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase
        .from('order_logistics')
        .insert({
          organization_id: profile.organization_id,
          order_id: orderId,
          truck: payload.truck,
          route: payload.route,
          driver_name: payload.driver_name,
          notes: payload.notes,
          assigned_by: profile.id,
        })

      if (error) throw new Error(error.message)
    }
  }
}

async function recordOrderDelivery(profile, orderId, { deliveryItems, photoUrl, notes }) {
  const itemsWithQty = (deliveryItems || []).filter((item) => n(item.quantity_delivered) > 0)
  if (!itemsWithQty.length) throw new Error('Ingresa al menos una cantidad entregada')

  const totalPacked = itemsWithQty.reduce((acc, item) => acc + n(item.quantity_packed), 0)
  const totalDelivering = itemsWithQty.reduce((acc, item) => acc + n(item.quantity_delivered), 0)
  const isPartial = totalDelivering < totalPacked

  const { data: delivery, error: deliveryError } = await supabase
    .from('order_deliveries')
    .insert({
      organization_id: profile.organization_id,
      order_id: orderId,
      is_partial: isPartial,
      delivery_photo_url: photoUrl || null,
      notes: notes || null,
      delivered_by: profile.id,
    })
    .select('id')
    .single()

  if (deliveryError) throw new Error(deliveryError.message)

  const { error: itemsError } = await supabase
    .from('order_delivery_items')
    .insert(
      itemsWithQty.map((item) => ({
        delivery_id: delivery.id,
        order_item_id: item.order_item_id,
        quantity_delivered: n(item.quantity_delivered),
      })),
    )

  if (itemsError) throw new Error(itemsError.message)

  for (const item of itemsWithQty) {
    const { data: currentItem, error: currentError } = await supabase
      .from('order_items')
      .select('id, quantity_delivered')
      .eq('id', item.order_item_id)
      .single()

    if (currentError) throw new Error(currentError.message)

    const { error: updateItemError } = await supabase
      .from('order_items')
      .update({
        quantity_delivered: round2(n(currentItem?.quantity_delivered) + n(item.quantity_delivered)),
      })
      .eq('id', item.order_item_id)

    if (updateItemError) throw new Error(updateItemError.message)
  }

  const { data: allItems, error: allItemsError } = await supabase
    .from('order_items')
    .select('quantity_packed, quantity_delivered')
    .eq('order_id', orderId)

  if (allItemsError) throw new Error(allItemsError.message)

  const allDelivered = (allItems || []).every((item) => n(item.quantity_delivered) >= n(item.quantity_packed))

  const { error: orderStatusError } = await supabase
    .from('orders')
    .update({ status: allDelivered ? 'entregado' : 'en_logistica' })
    .eq('id', orderId)

  if (orderStatusError) throw new Error(orderStatusError.message)

  return { deliveryId: delivery.id, allDelivered, isPartial }
}

async function recalculateRouteCosts(profile, routeId) {
  const route = await getRouteDetail(routeId, profile)
  const orders = route.ruta_pedidos || []
  const segments = route.ruta_tramos || []
  const extraFuelRows = route.ruta_combustible_extra || []
  const costableOrders = orders.filter((row) => row.status !== STOP_STATUS.OMITIDO)
  const divisor = Math.max(1, costableOrders.length)

  const initialSegment = segments.find((row) => row.segment_kind === 'salida_planta')
  const returnSegment = segments.find((row) => row.segment_kind === 'retorno_planta')
  const interSegments = segments
    .filter((row) => row.segment_kind === 'intercliente')
    .sort((a, b) => n(a.sequence_no) - n(b.sequence_no))

  const initialShare = round2(n(initialSegment?.segment_cost) / divisor)
  const returnShare = round2(n(returnSegment?.segment_cost) / divisor)
  const extraFuelTotal = round2(extraFuelRows.reduce((acc, row) => acc + n(row.total_cost), 0))
  const extraFuelShare = round2(extraFuelTotal / divisor)

  for (const order of orders) {
    if (order.status === STOP_STATUS.OMITIDO) {
      const { error } = await supabase
        .from('ruta_pedidos')
        .update({
          allocated_initial_cost: 0,
          allocated_return_cost: 0,
          allocated_progressive_cost: 0,
          allocated_extra_fuel_cost: 0,
          allocated_total_cost: 0,
          margin_amount: round2(n(order.order_total_snapshot)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
      if (error) throw new Error(error.message)
      continue
    }

    const progressive = round2(
      interSegments
        .filter((segment) => n(segment.sequence_no) <= n(order.sequence_no))
        .reduce((acc, segment) => acc + n(segment.segment_cost), 0),
    )

    const total = round2(initialShare + returnShare + progressive + extraFuelShare)
    const margin = round2(n(order.order_total_snapshot) - total)

    const { error } = await supabase
      .from('ruta_pedidos')
      .update({
        allocated_initial_cost: initialShare,
        allocated_return_cost: returnShare,
        allocated_progressive_cost: progressive,
        allocated_extra_fuel_cost: extraFuelShare,
        allocated_total_cost: total,
        margin_amount: margin,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)

    if (error) throw new Error(error.message)
  }

  const totalDistance = round2(segments.reduce((acc, row) => acc + n(row.distance_km), 0))
  const totalDuration = round2(segments.reduce((acc, row) => acc + n(row.duration_minutes), 0))
  const totalSegmentCost = round2(segments.reduce((acc, row) => acc + n(row.segment_cost), 0))

  const { error: routeError } = await supabase
    .from('rutas')
    .update({
      total_orders: orders.length,
      total_distance_km: totalDistance,
      total_duration_minutes: totalDuration,
      total_segment_cost: totalSegmentCost,
      total_extra_fuel_cost: extraFuelTotal,
      total_route_cost: round2(totalSegmentCost + extraFuelTotal),
      updated_at: new Date().toISOString(),
    })
    .eq('id', routeId)

  if (routeError) throw new Error(routeError.message)
}

async function createSegment(profile, route, fromOrder, toOrder, segmentKind, generatedFromEvent) {
  const totalOrders = route.ruta_pedidos?.length || route.total_orders || 0
  const sequenceNo =
    segmentKind === 'salida_planta'
      ? 1
      : segmentKind === 'retorno_planta'
        ? totalOrders + 1
        : n(toOrder?.sequence_no)

  const { data: existing, error: existingError } = await supabase
    .from('ruta_tramos')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('ruta_id', route.id)
    .eq('sequence_no', sequenceNo)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message)
  if (existing?.id) return existing

  const origin = getRouteStopPoint(route, fromOrder)
  const destination = getRouteStopPoint(route, toOrder)

  if (!origin.address && (!origin.latitude || !origin.longitude)) {
    throw new Error('La planta no tiene ubicacion configurada para generar el tramo')
  }
  if (!destination.address && (!destination.latitude || !destination.longitude)) {
    throw new Error('El cliente no tiene direccion valida para generar el tramo')
  }

  const routeMetrics = await invokeGoogleRouteMetrics(origin, destination)
  const fuelPrice = await getCurrentFuelPrice(profile, route.vehiculos?.fuel_type, route.route_date)
  const fuelSourceMeta = getFuelSourceMeta(fuelPrice)
  const distanceKm = n(routeMetrics.distance_km)
  const estimatedGallons = route.vehiculos?.fuel_efficiency_km_per_gallon
    ? round2(distanceKm / n(route.vehiculos.fuel_efficiency_km_per_gallon))
    : 0
  const segmentCost = round2(estimatedGallons * n(fuelPrice.price_per_gallon))

  const { error } = await supabase
    .from('ruta_tramos')
    .insert({
      organization_id: profile.organization_id,
      ruta_id: route.id,
      sequence_no: sequenceNo,
      segment_kind: segmentKind,
      generated_from_event: generatedFromEvent,
      from_stop_type: segmentKind === 'salida_planta' ? 'planta' : 'cliente',
      to_stop_type: segmentKind === 'retorno_planta' ? 'planta' : 'cliente',
      from_ruta_pedido_id: fromOrder?.id || null,
      to_ruta_pedido_id: toOrder?.id || null,
      from_label: origin.label || 'Origen',
      to_label: destination.label || 'Destino',
      origin_address: origin.address || null,
      destination_address: destination.address || null,
      origin_latitude: origin.latitude,
      origin_longitude: origin.longitude,
      destination_latitude: destination.latitude,
      destination_longitude: destination.longitude,
      distance_meters: Math.round(n(routeMetrics.distance_meters)),
      duration_seconds: Math.round(n(routeMetrics.duration_seconds)),
      distance_km: round2(distanceKm),
      duration_minutes: round2(routeMetrics.duration_minutes),
      fuel_history_id: fuelPrice.id,
      fuel_price_per_gallon: round2(fuelPrice.price_per_gallon),
      fuel_price_effective_date: fuelPrice.effective_date,
      fuel_price_source_name: fuelSourceMeta.sourceName,
      fuel_price_source_url: fuelSourceMeta.sourceUrl,
      vehicle_efficiency_km_per_gallon: round2(route.vehiculos?.fuel_efficiency_km_per_gallon),
      estimated_gallons: round2(estimatedGallons),
      segment_cost: round2(segmentCost),
      google_maps_response: {
        provider: routeMetrics.provider,
        raw: routeMetrics.raw,
        polyline: routeMetrics.polyline || null,
      },
      created_by: profile.id,
    })

  if (error) throw new Error(error.message)
}

export async function getLogisticsModuleData(selectedRouteId = null) {
  const profile = await getProfile()
  const organization = await getOrganization(profile)

  const [
    settingsRes,
    vehiclesRes,
    fuelHistoryRes,
    routesRes,
    incidentsRes,
    availableOrders,
  ] = await Promise.all([
    supabase
      .from('logistics_settings')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .maybeSingle(),
    supabase
      .from('vehiculos')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('historial_combustible')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('rutas')
      .select(`
        *,
        vehiculos (
          id,
          name,
          plate,
          fuel_type,
          fuel_efficiency_km_per_gallon
        ),
        ruta_pedidos (
          id,
          status,
          sequence_no,
          client_name_snapshot,
          allocated_total_cost,
          margin_amount
        ),
        ruta_tramos (
          id,
          sequence_no,
          segment_kind,
          distance_km,
          duration_minutes,
          segment_cost
        ),
        ruta_incidencias (
          id,
          severity
        ),
        ruta_combustible_extra (
          id,
          total_cost
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('route_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('ruta_incidencias')
      .select(`
        *,
        rutas (
          id,
          route_number,
          route_name,
          route_date
        )
      `)
      .eq('organization_id', profile.organization_id)
      .order('occurred_at', { ascending: false })
      .limit(60),
    getAvailableOrders(profile),
  ])

  if (settingsRes.error) throw new Error(settingsRes.error.message)
  if (vehiclesRes.error) throw new Error(vehiclesRes.error.message)
  if (fuelHistoryRes.error) throw new Error(fuelHistoryRes.error.message)
  if (routesRes.error) throw new Error(routesRes.error.message)
  if (incidentsRes.error) throw new Error(incidentsRes.error.message)

  const routes = (routesRes.data || []).map(buildRouteSummary)
  const selectedId = selectedRouteId || routes.find((route) => route.status === ROUTE_STATUS.EN_RUTA)?.id || routes[0]?.id || null
  const selectedRoute = selectedId ? await getRouteDetail(selectedId, profile) : null

  return {
    organization,
    settings: settingsRes.data || buildDefaultSettings(organization),
    vehicles: vehiclesRes.data || [],
    fuelHistory: [...(fuelHistoryRes.data || [])].sort(sortByDateDesc),
    routes,
    incidents: incidentsRes.data || [],
    availableOrders,
    selectedRoute,
    kpis: computeKpis(routes),
  }
}

export async function saveLogisticsSettings(payload) {
  const profile = await getProfile()
  const organization = await getOrganization(profile)
  const base = buildDefaultSettings(organization)

  const cleanPayload = {
    organization_id: profile.organization_id,
    plant_name: String(payload.plant_name || base.plant_name || '').trim() || base.plant_name,
    plant_address: String(payload.plant_address || base.plant_address || '').trim(),
    plant_latitude: payload.plant_latitude === '' || payload.plant_latitude == null ? null : Number(payload.plant_latitude),
    plant_longitude: payload.plant_longitude === '' || payload.plant_longitude == null ? null : Number(payload.plant_longitude),
    default_currency: String(payload.default_currency || 'GTQ').trim().toUpperCase() || 'GTQ',
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('logistics_settings')
    .upsert(cleanPayload, { onConflict: 'organization_id' })

  if (error) throw new Error(error.message)
}

export async function saveVehicle(payload) {
  const profile = await getProfile()
  const generatedCode = String(payload.code || '').trim() || (await generateVehicleCode(profile))
  const cleanPayload = {
    organization_id: profile.organization_id,
    code: generatedCode,
    name: String(payload.name || '').trim(),
    plate: String(payload.plate || '').trim(),
    fuel_type: payload.fuel_type,
    fuel_efficiency_km_per_gallon: round2(payload.fuel_efficiency_km_per_gallon),
    tank_capacity_gallons:
      payload.tank_capacity_gallons === '' || payload.tank_capacity_gallons == null
        ? null
        : round2(payload.tank_capacity_gallons),
    is_active: payload.is_active !== false,
    notes: String(payload.notes || '').trim() || null,
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  }

  if (!cleanPayload.name) throw new Error('Debes ingresar el nombre del vehiculo')
  if (!cleanPayload.plate) throw new Error('Debes ingresar la placa')
  if (!cleanPayload.fuel_type) throw new Error('Selecciona el tipo de combustible')
  if (n(cleanPayload.fuel_efficiency_km_per_gallon) <= 0) {
    throw new Error('El rendimiento del vehiculo debe ser mayor a 0')
  }

  if (payload.id) {
    const { error } = await supabase
      .from('vehiculos')
      .update(cleanPayload)
      .eq('id', payload.id)
      .eq('organization_id', profile.organization_id)

    if (error) throw new Error(error.message)
    return payload.id
  }

  const { data, error } = await supabase
    .from('vehiculos')
    .insert(cleanPayload)
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data.id
}

export async function toggleVehicleActive(vehicleId, shouldBeActive) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('vehiculos')
    .update({ is_active: shouldBeActive, updated_at: new Date().toISOString() })
    .eq('id', vehicleId)
    .eq('organization_id', profile.organization_id)

  if (error) throw new Error(error.message)
}

export async function saveFuelHistoryEntry(payload) {
  const profile = await getProfile()
  const cleanPayload = {
    organization_id: profile.organization_id,
    fuel_type: payload.fuel_type,
    price_per_gallon: round2(payload.price_per_gallon),
    effective_date: payload.effective_date || todayKey(),
    notes: String(payload.notes || '').trim() || null,
    created_by: profile.id,
    updated_at: new Date().toISOString(),
  }

  if (!cleanPayload.fuel_type) throw new Error('Selecciona el tipo de combustible')
  if (n(cleanPayload.price_per_gallon) <= 0) throw new Error('El precio por galon debe ser mayor a 0')

  const { error } = await supabase
    .from('historial_combustible')
    .insert(cleanPayload)

  if (error) throw new Error(error.message)
}

export async function fetchGuatemalaFuelPrices() {
  return invokeGuatemalaFuelPrices()
}

export async function saveOfficialFuelPrice(fuelType) {
  const official = await invokeGuatemalaFuelPrices()
  const price = n(official?.prices?.[fuelType])

  if (price <= 0) {
    throw new Error(`No se encontro precio oficial para ${getFuelTypeLabel(fuelType)}`)
  }

  await saveFuelHistoryEntry({
    fuel_type: fuelType,
    price_per_gallon: price,
    effective_date: todayKey(),
    notes: `Precio oficial Guatemala (${official?.source_name || 'fuente publica'}) · ${official?.source_url || ''}`.trim(),
  })

  return {
    fuel_type: fuelType,
    price_per_gallon: round2(price),
    source_name: official?.source_name || 'Fuente publica',
    source_url: official?.source_url || null,
    fetched_at: official?.fetched_at || null,
  }
}

export async function createRoute(payload) {
  const profile = await getProfile()
  const organization = await getOrganization(profile)
  const { data: settings } = await supabase
    .from('logistics_settings')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .maybeSingle()

  const selectedOrders = Array.isArray(payload.orders) ? payload.orders.filter((row) => row.order_id || row.id) : []
  if (!selectedOrders.length) throw new Error('Agrega al menos un pedido a la ruta')
  if (!payload.vehicle_id) throw new Error('Selecciona un vehiculo')

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehiculos')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('id', payload.vehicle_id)
    .single()

  if (vehicleError) throw new Error(vehicleError.message)

  const plant = settings || buildDefaultSettings(organization)
  const normalizedOrders = selectedOrders.map((row, index) => {
    const address = String(row.delivery_address || row.delivery_address_snapshot || '').trim()
    const latitude = row.delivery_latitude == null || row.delivery_latitude === '' ? null : Number(row.delivery_latitude)
    const longitude = row.delivery_longitude == null || row.delivery_longitude === '' ? null : Number(row.delivery_longitude)
    const hasCoords = hasValidCoordinates(latitude, longitude)
    return {
      organization_id: profile.organization_id,
      order_id: row.order_id || row.id,
      client_id: row.client_id || null,
      sequence_no: index + 1,
      status: STOP_STATUS.PENDIENTE,
      client_name_snapshot: String(row.client_name || row.client_name_snapshot || `Cliente ${index + 1}`),
      delivery_address_snapshot: address,
      delivery_latitude: hasCoords ? latitude : null,
      delivery_longitude: hasCoords ? longitude : null,
      order_total_snapshot: round2(row.total || row.order_total_snapshot),
    }
  })

  const { data: route, error: routeError } = await supabase
    .from('rutas')
    .insert({
      organization_id: profile.organization_id,
      route_name: String(payload.route_name || '').trim() || null,
      route_date: payload.route_date || todayKey(),
      vehicle_id: payload.vehicle_id,
      driver_name: String(payload.driver_name || '').trim() || null,
      driver_phone: String(payload.driver_phone || '').trim() || null,
      status: ROUTE_STATUS.PLANIFICADA,
      current_stop_sequence: 0,
      plant_name_snapshot: String(plant.plant_name || organization.name || 'Planta'),
      plant_address_snapshot: String(plant.plant_address || organization.address || '').trim() || null,
      plant_latitude: plant.plant_latitude === '' || plant.plant_latitude == null ? null : Number(plant.plant_latitude),
      plant_longitude: plant.plant_longitude === '' || plant.plant_longitude == null ? null : Number(plant.plant_longitude),
      notes: String(payload.notes || '').trim() || null,
      total_orders: selectedOrders.length,
      created_by: profile.id,
    })
    .select('*')
    .single()

  if (routeError) throw new Error(routeError.message)

  const routeOrdersPayload = normalizedOrders.map((row) => ({
    ...row,
    ruta_id: route.id,
  }))

  const { error: routeOrdersError } = await supabase
    .from('ruta_pedidos')
    .insert(routeOrdersPayload)

  if (routeOrdersError) throw new Error(routeOrdersError.message)

  const orderIds = routeOrdersPayload.map((row) => row.order_id)
  const { error: orderStatusError } = await supabase
    .from('orders')
    .update({ status: 'en_logistica' })
    .in('id', orderIds)
    .eq('organization_id', profile.organization_id)

  if (orderStatusError) throw new Error(orderStatusError.message)

  await syncOrderLogisticsAssignments(profile, route, vehicle, orderIds)
  return route.id
}

export async function startRoute(routeId, actualStartLocation = null) {
  const profile = await getProfile()
  const route = await getRouteDetail(routeId, profile)

  if (route.status === ROUTE_STATUS.FINALIZADA) throw new Error('La ruta ya fue finalizada')

  const firstOrder = route.ruta_pedidos?.[0]
  if (!firstOrder) throw new Error('La ruta no tiene pedidos')

  const actualStart = normalizeCoordinatePair(actualStartLocation?.latitude, actualStartLocation?.longitude)

  const { error: routeError } = await supabase
    .from('rutas')
    .update({
      status: ROUTE_STATUS.EN_RUTA,
      started_at: route.started_at || new Date().toISOString(),
      current_stop_sequence: firstOrder.sequence_no,
      actual_start_latitude: actualStart?.latitude ?? route.actual_start_latitude ?? null,
      actual_start_longitude: actualStart?.longitude ?? route.actual_start_longitude ?? null,
      actual_start_recorded_at: actualStart ? new Date().toISOString() : route.actual_start_recorded_at ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', routeId)
    .eq('organization_id', profile.organization_id)

  if (routeError) throw new Error(routeError.message)

  const { error: firstOrderError } = await supabase
    .from('ruta_pedidos')
    .update({
      status: STOP_STATUS.EN_CAMINO,
      dispatched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', firstOrder.id)
    .eq('organization_id', profile.organization_id)

  if (firstOrderError) throw new Error(firstOrderError.message)
}

export async function completeRouteStop({ route_id, ruta_pedido_id, delivery_items, photo_file, notes, delivery_location }) {
  const profile = await getProfile()
  let route = await getRouteDetail(route_id, profile)

  if (route.status === ROUTE_STATUS.PLANIFICADA) {
    await startRoute(route_id)
    route = await getRouteDetail(route_id, profile)
  }

  if (route.status === ROUTE_STATUS.FINALIZADA) throw new Error('La ruta ya esta finalizada')

  const routeOrder = route.ruta_pedidos.find((row) => row.id === ruta_pedido_id)
  if (!routeOrder) throw new Error('No se encontro el pedido dentro de la ruta')

  const photoUrl = photo_file ? await uploadDeliveryPhoto(photo_file) : null

  const result = await recordOrderDelivery(profile, routeOrder.order_id, {
    deliveryItems: delivery_items,
    photoUrl,
    notes,
  })

  if (routeOrder.client_id && delivery_location?.latitude != null && delivery_location?.longitude != null) {
    const { error: clientLocationError } = await supabase
      .from('clients')
      .update({
        delivery_latitude: Number(delivery_location.latitude),
        delivery_longitude: Number(delivery_location.longitude),
        location_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', routeOrder.client_id)
      .eq('organization_id', profile.organization_id)

    if (clientLocationError) throw new Error(clientLocationError.message)
  }

  const newStatus = result.allDelivered ? STOP_STATUS.ENTREGADO : STOP_STATUS.PARCIAL

  const { error: stopUpdateError } = await supabase
    .from('ruta_pedidos')
    .update({
      status: newStatus,
      delivered_at: new Date().toISOString(),
      delivery_latitude: delivery_location?.latitude != null ? Number(delivery_location.latitude) : routeOrder.delivery_latitude ?? null,
      delivery_longitude: delivery_location?.longitude != null ? Number(delivery_location.longitude) : routeOrder.delivery_longitude ?? null,
      delivery_photo_url: photoUrl || routeOrder.delivery_photo_url || null,
      delivery_notes: String(notes || '').trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', routeOrder.id)
    .eq('organization_id', profile.organization_id)

  if (stopUpdateError) throw new Error(stopUpdateError.message)

  if (result.allDelivered) {
    const { error: bridgeError } = await supabase.rpc('enqueue_intercompany_delivery_confirmation', {
      p_order_id: routeOrder.order_id,
      p_delivery_id: result.deliveryId,
    })

    if (bridgeError) throw new Error(bridgeError.message)
  }

  const nextOrder = route.ruta_pedidos.find((row) => n(row.sequence_no) > n(routeOrder.sequence_no) && row.status !== STOP_STATUS.OMITIDO)

  if (nextOrder) {
    const { error: nextOrderError } = await supabase
      .from('ruta_pedidos')
      .update({
        status: STOP_STATUS.EN_CAMINO,
        dispatched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', nextOrder.id)
      .eq('organization_id', profile.organization_id)

    if (nextOrderError) throw new Error(nextOrderError.message)

    const { error: routeError } = await supabase
      .from('rutas')
      .update({
        status: ROUTE_STATUS.EN_RUTA,
        current_stop_sequence: nextOrder.sequence_no,
        updated_at: new Date().toISOString(),
      })
      .eq('id', route_id)
      .eq('organization_id', profile.organization_id)

    if (routeError) throw new Error(routeError.message)
  } else {
    const { error: routeError } = await supabase
      .from('rutas')
      .update({
        status: ROUTE_STATUS.EN_RUTA,
        current_stop_sequence: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', route_id)
      .eq('organization_id', profile.organization_id)

    if (routeError) throw new Error(routeError.message)
  }

}

export async function finalizeRoute(routeId) {
  const profile = await getProfile()
  const route = await getRouteDetail(routeId, profile)

  if (route.status === ROUTE_STATUS.FINALIZADA) throw new Error('La ruta ya fue finalizada')

  const routeOrders = [...(route.ruta_pedidos || [])].sort((a, b) => n(a.sequence_no) - n(b.sequence_no))
  const pendingStops = routeOrders.filter((row) => [STOP_STATUS.PENDIENTE, STOP_STATUS.EN_CAMINO].includes(row.status))
  if (pendingStops.length) throw new Error('Debes completar u omitir todas las paradas antes de cerrar la ruta')

  const visitedStops = routeOrders.filter((row) => row.status !== STOP_STATUS.OMITIDO)
  if (!visitedStops.length) throw new Error('La ruta no tiene paradas para costear')

  const startPoint = getRouteStartPoint(route)
  if (!startPoint.address && !hasValidCoordinates(startPoint.latitude, startPoint.longitude)) {
    throw new Error('La ruta no tiene una ubicacion inicial valida para costear')
  }

  const { error: deleteSegmentsError } = await supabase
    .from('ruta_tramos')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('ruta_id', routeId)

  if (deleteSegmentsError) throw new Error(deleteSegmentsError.message)

  await createSegment(profile, route, null, visitedStops[0], 'salida_planta', 'inicio_ruta')

  for (let index = 1; index < visitedStops.length; index += 1) {
    await createSegment(profile, route, visitedStops[index - 1], visitedStops[index], 'intercliente', 'despacho_cliente')
  }

  await createSegment(profile, route, visitedStops[visitedStops.length - 1], null, 'retorno_planta', 'retorno_ruta')

  const { error: routeError } = await supabase
    .from('rutas')
    .update({
      status: ROUTE_STATUS.FINALIZADA,
      current_stop_sequence: 0,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', routeId)
    .eq('organization_id', profile.organization_id)

  if (routeError) throw new Error(routeError.message)

  await recalculateRouteCosts(profile, routeId)
}

export async function saveRouteIncident(payload) {
  const profile = await getProfile()
  let supportUrl = null
  if (payload.support_file) supportUrl = await uploadRouteDocument(payload.support_file, 'incidencias')

  const { error } = await supabase
    .from('ruta_incidencias')
    .insert({
      organization_id: profile.organization_id,
      ruta_id: payload.ruta_id,
      ruta_pedido_id: payload.ruta_pedido_id || null,
      incident_type: payload.incident_type,
      severity: payload.severity || 'media',
      description: String(payload.description || '').trim(),
      support_file_url: supportUrl,
      estimated_cost: round2(payload.estimated_cost),
      occurred_at: payload.occurred_at || new Date().toISOString(),
      created_by: profile.id,
    })

  if (error) throw new Error(error.message)
}

export async function saveExtraFuel(payload) {
  const profile = await getProfile()
  let supportUrl = null
  if (payload.support_file) supportUrl = await uploadRouteDocument(payload.support_file, 'combustible-extra')

  const totalCost = round2(n(payload.gallons) * n(payload.unit_price))
  if (totalCost <= 0) throw new Error('El combustible extra debe tener un costo mayor a 0')

  const { error } = await supabase
    .from('ruta_combustible_extra')
    .insert({
      organization_id: profile.organization_id,
      ruta_id: payload.ruta_id,
      fuel_date: payload.fuel_date || todayKey(),
      gallons: round2(payload.gallons),
      unit_price: round2(payload.unit_price),
      total_cost: totalCost,
      reference_number: String(payload.reference_number || '').trim() || null,
      support_file_url: supportUrl,
      notes: String(payload.notes || '').trim() || null,
      created_by: profile.id,
    })

  if (error) throw new Error(error.message)

  await recalculateRouteCosts(profile, payload.ruta_id)
}

export function getRouteStatusLabel(status) {
  if (status === ROUTE_STATUS.PLANIFICADA) return 'Planificada'
  if (status === ROUTE_STATUS.EN_RUTA) return 'En ruta'
  if (status === ROUTE_STATUS.FINALIZADA) return 'Finalizada'
  if (status === ROUTE_STATUS.CANCELADA) return 'Cancelada'
  return status || 'Sin estado'
}

export function getStopStatusLabel(status) {
  if (status === STOP_STATUS.PENDIENTE) return 'Pendiente'
  if (status === STOP_STATUS.EN_CAMINO) return 'En camino'
  if (status === STOP_STATUS.ENTREGADO) return 'Entregado'
  if (status === STOP_STATUS.PARCIAL) return 'Entrega parcial'
  if (status === STOP_STATUS.OMITIDO) return 'Omitido'
  return status || 'Sin estado'
}

export function getIncidentTypeLabel(value) {
  return INCIDENT_TYPES.find((row) => row.value === value)?.label || value
}

export function getSeverityLabel(value) {
  return INCIDENT_SEVERITIES.find((row) => row.value === value)?.label || value
}

export function getFuelTypeLabel(value) {
  return FUEL_TYPES.find((row) => row.value === value)?.label || value
}

export function buildStopMapsLink(stop) {
  return getStopMapsLink(stop)
}

export function formatDurationLabel(seconds) {
  return parseDurationLabel(seconds)
}
