import { supabase } from '../../../lib/supabase'

export async function getMaterialInventoryLots() {
  const { data, error } = await supabase
    .from('material_inventory_lots')
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
        category
      ),
      material_receptions (
        id,
        received_date,
        status
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudo cargar el inventario de materia prima')
  }

  return data || []
}

export async function updateMaterialInventoryLocation(lotId, location) {
  const { data, error } = await supabase
    .from('material_inventory_lots')
    .update({
      location: location?.trim() || null,
    })
    .eq('id', lotId)
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
        category
      ),
      material_receptions (
        id,
        received_date,
        status
      )
    `)
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar la ubicación del lote')
  }

  return data
}