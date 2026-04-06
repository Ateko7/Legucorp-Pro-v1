import { supabase } from '../../../lib/supabase'

export async function getProductBasesForRecipes() {
  const { data, error } = await supabase
    .from('product_bases')
    .select('id, code, common_name, category, status')
    .eq('status', 'activo')
    .order('common_name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los productos base')
  }

  return data || []
}

export async function getMaterialsForProductBaseRecipes() {
  const { data, error } = await supabase
    .from('materials')
    .select('id, code, common_name, category, status')
    .eq('status', 'activo')
    .in('category', ['materia_prima_vegetal', 'producto_granel'])
    .order('common_name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las materias primas')
  }

  return data || []
}

export async function getAllProductBaseRecipes() {
  const { data, error } = await supabase
    .from('product_base_recipes')
    .select(`
      *,
      product_bases (
        id,
        code,
        common_name
      ),
      materials (
        id,
        code,
        common_name
      )
    `)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar las recetas')
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

export async function saveProductBaseRecipe({ productBaseId, items }) {
  if (!productBaseId) {
    throw new Error('Debes seleccionar un producto base')
  }

  const validItems = items.filter(
    (item) => item.material_id && Number(item.percentage || 0) > 0
  )

  if (validItems.length === 0) {
    throw new Error('Debes agregar al menos una materia prima con porcentaje mayor a 0')
  }

  const total = validItems.reduce(
    (acc, item) => acc + Number(item.percentage || 0),
    0
  )

  if (Math.abs(total - 100) > 0.01) {
    throw new Error(`La receta debe sumar 100%. Actualmente suma ${total.toFixed(4)}%`)
  }

  const { organizationId, userId } = await getMyOrganizationContext()

  const { data: currentRecipeRows, error: currentError } = await supabase
    .from('product_base_recipes')
    .select('material_id, percentage')
    .eq('product_base_id', productBaseId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  if (currentError) {
    throw new Error(currentError.message || 'No se pudo leer la receta actual')
  }

  const snapshot = {
    previous: currentRecipeRows || [],
    next: validItems.map((item) => ({
      material_id: item.material_id,
      percentage: Number(item.percentage),
    })),
    changed_at: new Date().toISOString(),
  }

  const { error: historyError } = await supabase
    .from('product_base_recipe_history')
    .insert({
      organization_id: organizationId,
      product_base_id: productBaseId,
      recipe_snapshot: snapshot,
      changed_by: userId,
    })

  if (historyError) {
    throw new Error(historyError.message || 'No se pudo guardar el historial')
  }

  const { error: deactivateError } = await supabase
    .from('product_base_recipes')
    .update({ is_active: false })
    .eq('product_base_id', productBaseId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  if (deactivateError) {
    throw new Error(deactivateError.message || 'No se pudo desactivar la receta anterior')
  }

  const insertRows = validItems.map((item) => ({
    organization_id: organizationId,
    product_base_id: productBaseId,
    material_id: item.material_id,
    percentage: Number(item.percentage),
    is_active: true,
    created_by: userId,
  }))

  const { error: insertError } = await supabase
    .from('product_base_recipes')
    .insert(insertRows)

  if (insertError) {
    throw new Error(insertError.message || 'No se pudo guardar la nueva receta')
  }

  return true
}

export async function deleteProductBaseRecipe(productBaseId) {
  const { organizationId } = await getMyOrganizationContext()
  const { error } = await supabase
    .from('product_base_recipes')
    .update({ is_active: false })
    .eq('product_base_id', productBaseId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
  if (error) throw new Error(error.message || 'No se pudo eliminar la receta')
}