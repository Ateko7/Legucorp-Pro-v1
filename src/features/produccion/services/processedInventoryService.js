import { supabase } from '../../../lib/supabase';

function numberOrZero(value) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

async function getCurrentProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error('No hay usuario autenticado.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, organization_id, full_name, email')
    .eq('id', user.id)
    .single();

  if (profileError) throw profileError;
  if (!profile?.organization_id) {
    throw new Error('El usuario no tiene organización asignada.');
  }

  return profile;
}

function mapProcessedLot(row) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    process_run_id: row.process_run_id,
    source_output_id: row.source_output_id,
    material_id: row.material_id,
    processed_stage: row.processed_stage,
    processed_type: row.processed_type,
    internal_lot: row.internal_lot,
    available_quantity: numberOrZero(row.available_quantity),
    original_quantity: numberOrZero(row.original_quantity),
    unit: row.unit,
    accumulated_cost: numberOrZero(row.accumulated_cost),
    location: row.location || '',
    status: row.status || 'disponible',
    created_at: row.created_at,
    updated_at: row.updated_at,
    material_name: row.materials?.common_name || '',
    material_code: row.materials?.code || '',
    run_process_date: row.material_process_runs?.process_date || null,
    source_internal_lot: row.material_process_runs?.source_internal_lot || '',
  };
}

export async function getProcessedInventoryLots() {
  const profile = await getCurrentProfile();

  const { data, error } = await supabase
    .from('processed_inventory_lots')
    .select(`
      *,
      materials (
        id,
        code,
        common_name,
        category
      ),
      material_process_runs:process_run_id (
        id,
        process_date,
        source_internal_lot,
        status
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map(mapProcessedLot);
}

export async function updateProcessedInventoryLot({
  lotId,
  location,
  status,
}) {
  if (!lotId) throw new Error('El lote es requerido.');

  const profile = await getCurrentProfile();

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (location !== undefined) payload.location = location;
  if (status !== undefined) payload.status = status;

  const { data, error } = await supabase
    .from('processed_inventory_lots')
    .update(payload)
    .eq('id', lotId)
    .eq('organization_id', profile.organization_id)
    .select(`
      *,
      materials (
        id,
        code,
        common_name,
        category
      ),
      material_process_runs:process_run_id (
        id,
        process_date,
        source_internal_lot,
        status
      )
    `)
    .single();

  if (error) throw error;
  return mapProcessedLot(data);
}

export async function getProcessedInventoryDashboard() {
  const lots = await getProcessedInventoryLots();

  const availableLots = lots.filter((lot) => numberOrZero(lot.available_quantity) > 0);
  const totalAvailableQty = availableLots.reduce((acc, lot) => acc + numberOrZero(lot.available_quantity), 0);
  const miniLots = availableLots.filter((lot) => lot.processed_type === 'mini').length;
  const normalLots = availableLots.filter((lot) => lot.processed_type !== 'mini').length;

  return {
    lots,
    summary: {
      totalLots: lots.length,
      availableLots: availableLots.length,
      totalAvailableQty,
      miniLots,
      normalLots,
    },
  };
}