import { supabase } from '../../../lib/supabase'

export async function getSkus() {
  const { data, error } = await supabase
    .from('skus')
    .select(`
      *,
      packaging_material:materials (
        id,
        code,
        common_name,
        base_unit,
        estimated_cost,
        status
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los SKUs')
  }

  return data || []
}

export async function getPackagingMaterials() {
  const { data, error } = await supabase
    .from('materials')
    .select(`
      id,
      code,
      common_name,
      base_unit,
      estimated_cost,
      status,
      category
    `)
    .eq('category', 'material_empaque')
    .eq('status', 'activo')
    .order('common_name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los materiales de empaque')
  }

  return data || []
}

async function getMyOrganizationContext() {
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

  return {
    organizationId: profile.organization_id,
    userId: user.id,
  }
}

export async function createSku(payload) {
  const {
    common_name,
    category,
    net_weight,
    unit,
    shelf_life_days,
    suggested_price,
    packaging_material_id,
    status = 'activo',
  } = payload

  if (!common_name?.trim()) {
    throw new Error('El nombre común es obligatorio')
  }

  if (!category) {
    throw new Error('La categoría es obligatoria')
  }

  if (!unit?.trim()) {
    throw new Error('La unidad es obligatoria')
  }

  if (!packaging_material_id) {
    throw new Error('Debes seleccionar un tipo de empaque')
  }

  const { organizationId, userId } = await getMyOrganizationContext()

  const { data: generatedCode, error: codeError } = await supabase.rpc(
    'generate_sku_code',
    {
      p_organization_id: organizationId,
    }
  )

  if (codeError) {
    throw new Error(codeError.message || 'No se pudo generar el código automático del SKU')
  }

  if (!generatedCode) {
    throw new Error('No se recibió un código automático para el SKU')
  }

  const insertPayload = {
    organization_id: organizationId,
    code: generatedCode,
    common_name: common_name.trim(),
    category,
    net_weight: Number(net_weight || 0),
    unit: unit.trim(),
    shelf_life_days: Number(shelf_life_days || 0),
    suggested_price: Number(suggested_price || 0),
    standard_cost: 0,
    packaging_cost: 0,
    packaging_material_id,
    status,
    created_by: userId,
  }

  const { data, error } = await supabase
    .from('skus')
    .insert(insertPayload)
    .select(`
      *,
      packaging_material:materials (
        id,
        code,
        common_name,
        base_unit,
        estimated_cost,
        status
      )
    `)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo crear el SKU')
  }

  return data
}