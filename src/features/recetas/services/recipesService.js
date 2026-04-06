import { supabase } from '../../../lib/supabase'

export async function getSkusForRecipes() {
  const { data, error } = await supabase
    .from('skus')
    .select('id, code, common_name, category, status')
    .eq('status', 'activo')
    .order('common_name', { ascending: true })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los SKUs')
  }

  return data || []
}

export async function getMaterialsForRecipes() {
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

export async function getAllRecipes() {
  const { data, error } = await supabase
    .from('sku_recipes')
    .select(`
      *,
      skus (
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

export async function saveSkuRecipe({ skuId, items }) {
  if (!skuId) {
    throw new Error('Debes seleccionar un SKU')
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

  if (profileError || !profile?.organization_id) {
    throw new Error('No se pudo obtener la organización del usuario')
  }

  const organizationId = profile.organization_id

  const { data: currentRecipeRows, error: currentError } = await supabase
    .from('sku_recipes')
    .select('material_id, percentage')
    .eq('sku_id', skuId)
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
    .from('sku_recipe_history')
    .insert({
      organization_id: organizationId,
      sku_id: skuId,
      recipe_snapshot: snapshot,
      changed_by: user.id,
    })

  if (historyError) {
    throw new Error(historyError.message || 'No se pudo guardar el historial de receta')
  }

  const { error: deactivateError } = await supabase
    .from('sku_recipes')
    .update({ is_active: false })
    .eq('sku_id', skuId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)

  if (deactivateError) {
    throw new Error(deactivateError.message || 'No se pudo actualizar la receta actual')
  }

  const insertRows = validItems.map((item) => ({
    organization_id: organizationId,
    sku_id: skuId,
    material_id: item.material_id,
    percentage: Number(item.percentage),
    is_active: true,
    created_by: user.id,
  }))

  const { error: insertError } = await supabase
    .from('sku_recipes')
    .insert(insertRows)

  if (insertError) {
    throw new Error(insertError.message || 'No se pudo guardar la nueva receta')
  }

  return true
}