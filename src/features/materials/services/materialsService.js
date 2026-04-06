import { supabase } from '../../../lib/supabase'

export async function getMaterials() {
  const { data, error } = await supabase
    .from('materials')
    .select(`
      *,
      preferred_supplier:suppliers (
        id,
        name
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las materias primas')
  }

  return data || []
}

export async function getSuppliersForSelect() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('status', 'activo')
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los proveedores')
  }

  return data || []
}

function buildCodeBase(name) {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    return words[0].slice(0, 3)
  }
  return words[0].slice(0, 2) + words[1].slice(0, 2)
}

async function generateMaterialCode(name, organizationId) {
  const base = buildCodeBase(name)

  const { data: existing } = await supabase
    .from('materials')
    .select('code')
    .eq('organization_id', organizationId)
    .ilike('code', `${base}%`)

  const taken = new Set((existing || []).map((r) => r.code))

  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

export async function createMaterial(payload) {
  const {
    common_name,
    category,
    base_unit,
    purchase_presentation,
    preferred_supplier_id,
    estimated_cost,
    shelf_life_days,
    requires_lot,
    requires_temperature,
    minimum_stock,
    status = 'activo',
  } = payload

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('No se pudo obtener el usuario autenticado')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error(profileError.message || 'No se pudo obtener la organización del usuario')
  }

  if (!profile?.organization_id) {
    throw new Error('El usuario no tiene organization_id asignado')
  }

  const resolvedCode = await generateMaterialCode(common_name, profile.organization_id)

  const insertPayload = {
    organization_id: profile.organization_id,
    code: resolvedCode,
    common_name: common_name?.trim(),
    category,
    base_unit: base_unit?.trim(),
    purchase_presentation: purchase_presentation?.trim() || null,
    preferred_supplier_id: preferred_supplier_id || null,
    estimated_cost: Number(estimated_cost || 0),
    shelf_life_days:
      shelf_life_days === '' || shelf_life_days === null || shelf_life_days === undefined
        ? null
        : Number(shelf_life_days),
    requires_lot: Boolean(requires_lot),
    requires_temperature: Boolean(requires_temperature),
    minimum_stock: Number(minimum_stock || 0),
    status,
    created_by: user.id,
  }

  const { data, error } = await supabase
    .from('materials')
    .insert(insertPayload)
    .select(`
      *,
      preferred_supplier:suppliers (
        id,
        name
      )
    `)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo crear la materia prima')
  }

  return data
}

export async function deleteMaterial(id) {
  const { error } = await supabase
    .from('materials')
    .update({ status: 'inactivo' })
    .eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar la materia prima')
}

export async function updateMaterial(id, payload) {
  const {
    common_name,
    category,
    base_unit,
    purchase_presentation,
    preferred_supplier_id,
    estimated_cost,
    shelf_life_days,
    requires_lot,
    requires_temperature,
    minimum_stock,
    status,
  } = payload

  const { error } = await supabase
    .from('materials')
    .update({
      common_name: common_name?.trim(),
      category,
      base_unit: base_unit?.trim(),
      purchase_presentation: purchase_presentation?.trim() || null,
      preferred_supplier_id: preferred_supplier_id || null,
      estimated_cost: Number(estimated_cost || 0),
      shelf_life_days: shelf_life_days === '' || shelf_life_days == null ? null : Number(shelf_life_days),
      requires_lot: Boolean(requires_lot),
      requires_temperature: Boolean(requires_temperature),
      minimum_stock: Number(minimum_stock || 0),
      status,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo actualizar la materia prima')
}