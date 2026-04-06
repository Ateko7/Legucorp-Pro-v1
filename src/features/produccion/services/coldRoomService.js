import { supabase } from '../../../lib/supabase'

function numberOrZero(value) {
  const n = Number(value)
  return Number.isNaN(n) ? 0 : n
}

async function getCurrentProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!user) throw new Error('No hay usuario autenticado.')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (profileError) throw profileError
  if (!profile?.organization_id) {
    throw new Error('El usuario no tiene organización asignada.')
  }

  return profile
}

function mapColdRoomLot(row) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    packaging_run_id: row.packaging_run_id,
    source_packaging_run_id: row.source_packaging_run_id,
    product_presentation_id: row.product_presentation_id,
    finished_lot_code: row.finished_lot_code,
    available_quantity: numberOrZero(row.available_quantity),
    original_quantity: numberOrZero(row.original_quantity),
    unit: row.unit,
    total_cost: numberOrZero(row.total_cost),
    unit_cost: numberOrZero(row.unit_cost),
    location: row.location || '',
    storage_location: row.storage_location || '',
    status: row.status || 'disponible',
    production_date: row.production_date || '',
    expiration_date: row.expiration_date || '',
    created_at: row.created_at,
    updated_at: row.updated_at,

    product_code: row.product_presentations?.code || '',
    product_name: row.product_presentations?.display_name || '',
    product_unit: row.product_presentations?.unit || '',
    product_net_weight: numberOrZero(row.product_presentations?.net_weight),
    shelf_life_days: numberOrZero(row.product_presentations?.shelf_life_days),
    product_base_name: row.product_presentations?.product_bases?.common_name || '',
  }
}

function daysUntil(dateString) {
  if (!dateString) return null

  const now = new Date()
  const target = new Date(dateString)

  if (Number.isNaN(target.getTime())) return null

  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())

  const diffMs = startOfTarget.getTime() - startOfNow.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

export async function getColdRoomLots() {
  const profile = await getCurrentProfile()

  const { data, error } = await supabase
    .from('finished_inventory_lots')
    .select(`
      *,
      product_presentations (
        id,
        code,
        display_name,
        net_weight,
        unit,
        shelf_life_days,
        product_bases (
          id,
          common_name
        )
      )
    `)
    .eq('organization_id', profile.organization_id)
    .or('storage_location.eq.cuarto_frio,location.eq.cuarto_frio')
    .order('expiration_date', { ascending: true })

  if (error) throw error

  return (data || []).map(mapColdRoomLot)
}

export async function getColdRoomDashboard() {
  const lots = await getColdRoomLots()

  const availableLots = lots.filter((lot) => numberOrZero(lot.available_quantity) > 0)
  const expiringSoon = availableLots.filter((lot) => {
    const days = daysUntil(lot.expiration_date)
    return days !== null && days >= 0 && days <= 3
  })

  const expired = availableLots.filter((lot) => {
    const days = daysUntil(lot.expiration_date)
    return days !== null && days < 0
  })

  const totalUnits = availableLots.reduce(
    (acc, lot) => acc + numberOrZero(lot.available_quantity),
    0
  )

  return {
    lots: lots.map((lot) => ({
      ...lot,
      days_to_expire: daysUntil(lot.expiration_date),
    })),
    summary: {
      totalLots: lots.length,
      availableLots: availableLots.length,
      totalUnits,
      expiringSoon: expiringSoon.length,
      expired: expired.length,
    },
  }
}

export async function updateColdRoomLotStatus({ lotId, status }) {
  if (!lotId) throw new Error('Lote requerido.')
  if (!status) throw new Error('Estado requerido.')

  const profile = await getCurrentProfile()

  const { data, error } = await supabase
    .from('finished_inventory_lots')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lotId)
    .eq('organization_id', profile.organization_id)
    .select(`
      *,
      product_presentations (
        id,
        code,
        display_name,
        net_weight,
        unit,
        shelf_life_days,
        product_bases (
          id,
          common_name
        )
      )
    `)
    .single()

  if (error) throw error
  return mapColdRoomLot(data)
}