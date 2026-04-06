import { supabase } from '../../../lib/supabase'

export async function getPackagingInventoryLots() {
  const { data, error } = await supabase
    .from('packaging_inventory_lots')
    .select(`
      *,
      suppliers (
        id,
        name
      ),
      materials (
        id,
        code,
        common_name,
        base_unit,
        category,
        minimum_stock
      ),
      material_receptions (
        id,
        received_date,
        status
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudo cargar el inventario de empaque')
  }

  return data || []
}

export async function updatePackagingInventoryLocation(lotId, location) {
  const { data, error } = await supabase
    .from('packaging_inventory_lots')
    .update({
      location: location?.trim() || null,
    })
    .eq('id', lotId)
    .select()
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar la ubicación')
  }

  return data
}

export async function updateMaterialMinimumStock(materialId, minimumStock) {
  const min = Number(minimumStock || 0)

  const { error } = await supabase
    .from('materials')
    .update({ minimum_stock: min })
    .eq('id', materialId)

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar el stock mínimo')
  }
}