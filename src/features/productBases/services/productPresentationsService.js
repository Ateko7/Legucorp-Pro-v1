import { supabase } from '../../../lib/supabase'

export async function getProductPresentationsByBase(productBaseId) {
  const { data, error } = await supabase
    .from('product_presentations')
    .select(`
      *,
      packaging_material:materials (
        id,
        code,
        common_name,
        base_unit
      )
    `)
    .eq('product_base_id', productBaseId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las presentaciones')
  }

  return data || []
}

export async function getSombrillasForPresentations() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  const { data, error } = await supabase
    .from('productos_sombrilla')
    .select('id, nombre, codigo, codigo_arancelario')
    .eq('organization_id', profile.organization_id)
    .eq('activo', true)
    .order('nombre')
  if (error) throw new Error(error.message)
  return data || []
}

export async function getPackagingMaterialsForPresentations() {
  const { data, error } = await supabase
    .from('materials')
    .select('id, code, common_name, base_unit')
    .eq('status', 'activo')
    .eq('category', 'material_empaque')
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

export async function createProductPresentation(payload) {
  const {
    product_base_id,
    display_name,
    net_weight,
    unit,
    shelf_life_days,
    suggested_price,
    packaging_material_id,
    packaging_quantity,
    status = 'activo',
  } = payload

  if (!product_base_id) {
    throw new Error('Debes seleccionar un producto base')
  }

  if (!display_name?.trim()) {
    throw new Error('El nombre de la presentación es obligatorio')
  }

  const { organizationId, userId } = await getMyOrganizationContext()

  const { data: generatedCode, error: codeError } = await supabase.rpc(
    'generate_product_presentation_code',
    { p_organization_id: organizationId }
  )

  if (codeError) {
    throw new Error(codeError.message || 'No se pudo generar el código de la presentación')
  }

  const { data, error } = await supabase
    .from('product_presentations')
    .insert({
      organization_id: organizationId,
      product_base_id,
      code: generatedCode,
      display_name: display_name.trim(),
      net_weight: Number(net_weight || 0),
      unit: unit?.trim() || 'oz',
      shelf_life_days: Number(shelf_life_days || 0),
      suggested_price: Number(suggested_price || 0),
      standard_cost: 0,
      packaging_material_id:  packaging_material_id || null,
      packaging_quantity:     Number(packaging_quantity || 1),
      producto_sombrilla_id:  payload.producto_sombrilla_id || null,
      peso_neto_kg:           payload.peso_neto_kg ? Number(payload.peso_neto_kg) : null,
      status,
      created_by: userId,
    })
    .select(`
      *,
      packaging_material:materials (
        id,
        code,
        common_name,
        base_unit
      )
    `)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo crear la presentación')
  }

  return data
}

export async function deleteProductPresentation(id) {
  const { error } = await supabase
    .from('product_presentations')
    .update({ status: 'inactivo' })
    .eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar la presentación')
}

export async function updateProductPresentation(id, payload) {
  const {
    display_name,
    net_weight,
    unit,
    shelf_life_days,
    suggested_price,
    packaging_material_id,
    packaging_quantity,
    status,
  } = payload

  if (!display_name?.trim()) throw new Error('El nombre de la presentación es obligatorio')

  const { error } = await supabase
    .from('product_presentations')
    .update({
      display_name: display_name.trim(),
      net_weight: Number(net_weight || 0),
      unit: unit?.trim() || 'oz',
      shelf_life_days: Number(shelf_life_days || 0),
      suggested_price: Number(suggested_price || 0),
      packaging_material_id:  packaging_material_id || null,
      packaging_quantity:     Number(packaging_quantity || 1),
      producto_sombrilla_id:  payload.producto_sombrilla_id || null,
      peso_neto_kg:           payload.peso_neto_kg ? Number(payload.peso_neto_kg) : null,
      status,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo actualizar la presentación')
}