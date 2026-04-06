import { supabase } from '../../../lib/supabase'

export async function getProductBases() {
  const { data, error } = await supabase
    .from('product_bases')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los productos base')
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

export async function createProductBase(payload) {
  const {
    common_name,
    category,
    status = 'activo',
  } = payload

  if (!common_name?.trim()) {
    throw new Error('El nombre del producto base es obligatorio')
  }

  const { organizationId, userId } = await getMyOrganizationContext()

  const { data: generatedCode, error: codeError } = await supabase.rpc(
    'generate_product_base_code',
    { p_organization_id: organizationId }
  )

  if (codeError) {
    throw new Error(codeError.message || 'No se pudo generar el código automático')
  }

  const { data, error } = await supabase
    .from('product_bases')
    .insert({
      organization_id: organizationId,
      code: generatedCode,
      common_name: common_name.trim(),
      category: category?.trim() || null,
      status,
      created_by: userId,
    })
    .select()
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo crear el producto base')
  }

  return data
}

export async function deleteProductBase(id) {
  const { error } = await supabase
    .from('product_bases')
    .update({ status: 'inactivo' })
    .eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar el producto base')
}

export async function updateProductBase(id, payload) {
  const { common_name, category, status } = payload

  if (!common_name?.trim()) throw new Error('El nombre del producto base es obligatorio')

  const { error } = await supabase
    .from('product_bases')
    .update({ common_name: common_name.trim(), category: category?.trim() || null, status })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo actualizar el producto base')
}