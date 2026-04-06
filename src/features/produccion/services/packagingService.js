import { supabase } from '../../../lib/supabase';

function numberOrZero(value) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function round2(value) {
  return Math.round(numberOrZero(value) * 100) / 100;
}

function ensureRequired(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${fieldName} es requerido.`);
  }
}

function ensurePositiveNumber(value, fieldName) {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`${fieldName} debe ser un número válido mayor o igual a 0.`);
  }
  return n;
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

function convertWeightToLb(weight, unit) {
  const value = numberOrZero(weight);
  const normalizedUnit = String(unit || '').trim().toLowerCase();

  if (!value) return 0;

  if (['lb', 'libra', 'libras'].includes(normalizedUnit)) return round2(value);
  if (['oz', 'onza', 'onzas'].includes(normalizedUnit)) return round2(value / 16);

  throw new Error(`Unidad no soportada para conversión a lb: ${unit}`);
}

function convertPresentationWeightToLb(netWeight, unit) {
  return convertWeightToLb(netWeight, unit);
}

function mapPresentation(row) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    product_base_id: row.product_base_id,
    code: row.code,
    display_name: row.display_name,
    net_weight: numberOrZero(row.net_weight),
    unit: row.unit,
    shelf_life_days: numberOrZero(row.shelf_life_days),
    suggested_price: numberOrZero(row.suggested_price),
    standard_cost: numberOrZero(row.standard_cost),
    packaging_material_id: row.packaging_material_id,
    packaging_quantity: numberOrZero(row.packaging_quantity),
    status: row.status,
    product_base_name: row.product_bases?.common_name || '',
  };
}

function mapRecipeItem(row) {
  return {
    id: row.id,
    product_base_id: row.product_base_id,
    material_id: row.material_id,
    percentage: numberOrZero(row.percentage),
    material_name: row.materials?.common_name || '',
    material_code: row.materials?.code || '',
  };
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
    material_name: row.materials?.common_name || '',
    material_code: row.materials?.code || '',
  };
}

function mapPackagingLot(row) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    material_id: row.material_id,
    internal_lot: row.internal_lot,
    available_quantity: numberOrZero(row.available_quantity),
    unit: row.unit,
    unit_cost: numberOrZero(row.unit_cost),
    status: row.status || 'disponible',
  };
}

function groupProcessedLotsByMaterial(lots) {
  const grouped = new Map();

  for (const lot of lots) {
    if (!grouped.has(lot.material_id)) {
      grouped.set(lot.material_id, []);
    }
    grouped.get(lot.material_id).push(lot);
  }

  return grouped;
}

function allocateRequiredQuantityFromSelectedLots(selectedLots, requiredQty) {
  const totalAvailable = round2(
    selectedLots.reduce((acc, lot) => acc + numberOrZero(lot.available_quantity), 0)
  );

  if (requiredQty <= 0) return [];
  if (!selectedLots.length) return [];

  if (totalAvailable < requiredQty) {
    throw new Error('Los lotes seleccionados no cubren la cantidad requerida.');
  }

  let remaining = round2(requiredQty);
  const allocations = [];

  for (const lot of selectedLots) {
    if (remaining <= 0) break;

    const available = numberOrZero(lot.available_quantity);
    const used = round2(Math.min(available, remaining));

    if (used > 0) {
      allocations.push({
        lot_id: lot.id,
        quantity_used: used,
      });
      remaining = round2(remaining - used);
    }
  }

  if (remaining > 0) {
    throw new Error('No se pudo distribuir completamente la cantidad requerida.');
  }

  return allocations;
}

function allocateRequiredQuantityAuto(lots, requiredQty) {
  const totalAvailable = round2(
    lots.reduce((acc, lot) => acc + numberOrZero(lot.available_quantity), 0)
  );

  if (requiredQty <= 0) return [];
  if (!lots.length) return [];

  if (totalAvailable < requiredQty) {
    throw new Error('No hay suficiente inventario para cubrir la cantidad requerida.');
  }

  let remaining = round2(requiredQty);
  const allocations = [];

  for (const lot of lots) {
    if (remaining <= 0) break;

    const available = numberOrZero(lot.available_quantity);
    const used = round2(Math.min(available, remaining));

    if (used > 0) {
      allocations.push({
        lot_id: lot.id,
        quantity_used: used,
      });
      remaining = round2(remaining - used);
    }
  }

  if (remaining > 0) {
    throw new Error('No se pudo distribuir completamente la cantidad requerida.');
  }

  return allocations;
}

export function calculateRecipeRequirements(presentation, quantityPacked, recipeItems) {
  if (!presentation) {
    return {
      weightPerUnitLb: 0,
      packedWeightLb: 0,
      perMaterial: [],
    };
  }

  const qtyPacked = numberOrZero(quantityPacked);
  const weightPerUnitLb = convertPresentationWeightToLb(
    presentation.net_weight,
    presentation.unit
  );
  const packedWeightLb = round2(weightPerUnitLb * qtyPacked);

  const perMaterial = (recipeItems || []).map((item) => ({
    material_id: item.material_id,
    material_name: item.material_name,
    material_code: item.material_code,
    percentage: numberOrZero(item.percentage),
    required_lb: round2(packedWeightLb * (numberOrZero(item.percentage) / 100)),
  }));

  return {
    weightPerUnitLb,
    packedWeightLb,
    perMaterial,
  };
}

export async function getPackagingFormData() {
  const profile = await getCurrentProfile();

  const [presentationsRes, processedLotsRes, recipesRes] = await Promise.all([
    supabase
      .from('product_presentations')
      .select(`
        *,
        product_bases (
          id,
          common_name
        )
      `)
      .eq('organization_id', profile.organization_id)
      .eq('status', 'activo')
      .order('display_name', { ascending: true }),

    supabase
      .from('processed_inventory_lots')
      .select(`
        *,
        materials (
          id,
          code,
          common_name,
          category
        )
      `)
      .eq('organization_id', profile.organization_id)
      .gt('available_quantity', 0)
      .in('status', ['disponible', 'parcial'])
      .order('created_at', { ascending: true }),

    supabase
      .from('product_base_recipes')
      .select(`
        *,
        materials (
          id,
          code,
          common_name
        )
      `)
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true),
  ]);

  if (presentationsRes.error) throw presentationsRes.error;
  if (processedLotsRes.error) throw processedLotsRes.error;
  if (recipesRes.error) throw recipesRes.error;

  return {
    presentations: (presentationsRes.data || []).map(mapPresentation),
    processedLots: (processedLotsRes.data || []).map(mapProcessedLot),
    recipes: (recipesRes.data || []).map(mapRecipeItem),
  };
}

export async function createPackagingRunStrictRecipe({
  productPresentationId,
  runDate,
  quantityPacked,
  finishedLotCode,
  notes = '',
  selectedProcessedLotIdsByMaterial = {},
}) {
  ensureRequired(productPresentationId, 'Producto');
  ensureRequired(runDate, 'Fecha de producción');
  ensureRequired(finishedLotCode, 'Lote terminado');

  const qtyPacked = ensurePositiveNumber(quantityPacked, 'Cantidad empacada');
  if (qtyPacked <= 0) {
    throw new Error('La cantidad empacada debe ser mayor que 0.');
  }

  const profile = await getCurrentProfile();

  const [presentationRes, processedLotsRes, recipesRes] = await Promise.all([
    supabase
      .from('product_presentations')
      .select(`
        *,
        product_bases (
          id,
          common_name
        )
      `)
      .eq('id', productPresentationId)
      .eq('organization_id', profile.organization_id)
      .single(),

    supabase
      .from('processed_inventory_lots')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .gt('available_quantity', 0),

    supabase
      .from('product_base_recipes')
      .select(`
        *,
        materials (
          id,
          code,
          common_name
        )
      `)
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true),
  ]);

  if (presentationRes.error) throw presentationRes.error;
  if (processedLotsRes.error) throw processedLotsRes.error;
  if (recipesRes.error) throw recipesRes.error;

  const presentation = mapPresentation(presentationRes.data);
  const allProcessedLots = (processedLotsRes.data || []).map((row) => ({
    ...row,
    available_quantity: numberOrZero(row.available_quantity),
    original_quantity: numberOrZero(row.original_quantity),
    accumulated_cost: numberOrZero(row.accumulated_cost),
  }));
  const allRecipes = (recipesRes.data || []).map(mapRecipeItem);

  const recipeItems = allRecipes.filter(
    (item) => item.product_base_id === presentation.product_base_id
  );

  if (!recipeItems.length) {
    throw new Error('El producto no tiene receta activa asociada en product_base_recipes.');
  }

  const recipeSum = round2(
    recipeItems.reduce((acc, item) => acc + numberOrZero(item.percentage), 0)
  );

  if (recipeSum !== 100) {
    throw new Error(`La receta debe sumar 100%. Actualmente suma ${recipeSum}%.`);
  }

  const requirements = calculateRecipeRequirements(
    presentation,
    qtyPacked,
    recipeItems
  );

  const processedLotsByMaterial = groupProcessedLotsByMaterial(allProcessedLots);

  const normalizedProcessedInputs = [];
  let totalProcessedCost = 0;

  for (const req of requirements.perMaterial) {
    const selectedIds = selectedProcessedLotIdsByMaterial[req.material_id] || [];
    if (!selectedIds.length) {
      throw new Error(`Debes seleccionar al menos un lote para ${req.material_name}.`);
    }

    const availableLotsForMaterial = processedLotsByMaterial.get(req.material_id) || [];
    const selectedLotsForMaterial = availableLotsForMaterial.filter((lot) =>
      selectedIds.includes(lot.id)
    );

    if (!selectedLotsForMaterial.length) {
      throw new Error(`No hay lotes válidos seleccionados para ${req.material_name}.`);
    }

    const allocations = allocateRequiredQuantityFromSelectedLots(
      selectedLotsForMaterial,
      req.required_lb
    );

    for (const allocation of allocations) {
      const lot = selectedLotsForMaterial.find((x) => x.id === allocation.lot_id);
      if (!lot) {
        throw new Error(`No se encontró el lote seleccionado de ${req.material_name}.`);
      }

      const unitCost =
        numberOrZero(lot.original_quantity) > 0
          ? numberOrZero(lot.accumulated_cost) / numberOrZero(lot.original_quantity)
          : 0;

      const totalCost = round2(unitCost * numberOrZero(allocation.quantity_used));
      totalProcessedCost += totalCost;

      normalizedProcessedInputs.push({
        lot,
        input_type: 'procesado',
        source_lot_id: lot.id,
        material_id: lot.material_id,
        quantity_used: round2(allocation.quantity_used),
        unit: 'lb',
        unit_cost: round2(unitCost),
        total_cost: totalCost,
      });
    }
  }

  const [packagingPresentationRes, packagingLotsRes] = await Promise.all([
    supabase
      .from('product_presentations')
      .select('packaging_material_id, packaging_quantity')
      .eq('id', productPresentationId)
      .single(),

    supabase
      .from('packaging_inventory_lots')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .gt('available_quantity', 0),
  ]);

  if (packagingPresentationRes.error) throw packagingPresentationRes.error;
  if (packagingLotsRes.error) throw packagingLotsRes.error;

  const packagingMaterialId = packagingPresentationRes.data?.packaging_material_id || null;
  const packagingQtyPerUnit = numberOrZero(packagingPresentationRes.data?.packaging_quantity);

  let packagingInputs = [];
  let totalPackagingCost = 0;

  if (packagingMaterialId && packagingQtyPerUnit > 0) {
    const compatiblePackagingLots = (packagingLotsRes.data || [])
      .map(mapPackagingLot)
      .filter((lot) => lot.material_id === packagingMaterialId);

    const requiredPackagingQty = round2(packagingQtyPerUnit * qtyPacked);

    if (!compatiblePackagingLots.length) {
      throw new Error('No hay inventario disponible del material de empaque requerido.');
    }

    const packagingAllocations = allocateRequiredQuantityAuto(
      compatiblePackagingLots,
      requiredPackagingQty
    );

    packagingInputs = packagingAllocations.map((allocation) => {
      const lot = compatiblePackagingLots.find((x) => x.id === allocation.lot_id);
      if (!lot) {
        throw new Error('No se encontró uno de los lotes automáticos de empaque.');
      }

      const unitCost = numberOrZero(lot.unit_cost);
      const totalCost = round2(unitCost * numberOrZero(allocation.quantity_used));
      totalPackagingCost += totalCost;

      return {
        lot,
        input_type: 'empaque',
        source_lot_id: lot.id,
        material_id: lot.material_id,
        quantity_used: round2(allocation.quantity_used),
        unit: lot.unit,
        unit_cost: round2(unitCost),
        total_cost: totalCost,
      };
    });
  }

  const totalInputWeightLb = round2(
    normalizedProcessedInputs.reduce((acc, input) => acc + numberOrZero(input.quantity_used), 0)
  );

  const packedWeightLb = round2(requirements.packedWeightLb);
  const wasteWeightLb = round2(totalInputWeightLb - packedWeightLb);
  const wastePercentage =
    totalInputWeightLb > 0
      ? round2((wasteWeightLb / totalInputWeightLb) * 100)
      : 0;

  const totalCost = round2(totalProcessedCost + totalPackagingCost);
  const unitCost = qtyPacked > 0 ? round2(totalCost / qtyPacked) : 0;

  const productionDate = runDate;
  const expirationDate = presentation.shelf_life_days
    ? new Date(new Date(runDate).getTime() + presentation.shelf_life_days * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    : runDate;

  const { data: packagingRun, error: packagingRunError } = await supabase
    .from('packaging_runs')
    .insert({
      organization_id: profile.organization_id,
      product_presentation_id: presentation.id,
      run_date: runDate,
      finished_lot_code: finishedLotCode,
      quantity_produced: qtyPacked,
      unit: 'unidad',
      status: 'completado',
      notes,
      total_cost: totalCost,
      unit_cost: unitCost,
      total_input_weight_lb: totalInputWeightLb,
      packed_weight_lb: packedWeightLb,
      waste_weight_lb: wasteWeightLb,
      waste_percentage: wastePercentage,
      created_by: profile.id,
    })
    .select()
    .single();

  if (packagingRunError) throw packagingRunError;

  const inputsPayload = [...normalizedProcessedInputs, ...packagingInputs].map((input) => ({
    packaging_run_id: packagingRun.id,
    organization_id: profile.organization_id,
    input_type: input.input_type,
    source_lot_id: input.source_lot_id,
    material_id: input.material_id,
    quantity_used: input.quantity_used,
    unit: input.unit,
    unit_cost: input.unit_cost,
    total_cost: input.total_cost,
  }));

  if (inputsPayload.length) {
    const { error: inputsError } = await supabase
      .from('packaging_run_inputs')
      .insert(inputsPayload);

    if (inputsError) throw inputsError;
  }

  for (const input of normalizedProcessedInputs) {
    const lot = input.lot;
    const newAvailable = round2(numberOrZero(lot.available_quantity) - numberOrZero(input.quantity_used));
    const newStatus = newAvailable <= 0 ? 'agotado' : 'parcial';

    const { error } = await supabase
      .from('processed_inventory_lots')
      .update({
        available_quantity: newAvailable,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lot.id)
      .eq('organization_id', profile.organization_id);

    if (error) throw error;
  }

  for (const input of packagingInputs) {
    const lot = input.lot;
    const newAvailable = round2(numberOrZero(lot.available_quantity) - numberOrZero(input.quantity_used));
    const newStatus = newAvailable <= 0 ? 'agotado' : 'parcial';

    const { error } = await supabase
      .from('packaging_inventory_lots')
      .update({
        available_quantity: newAvailable,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lot.id)
      .eq('organization_id', profile.organization_id);

    if (error) throw error;
  }

  const { data: finishedLot, error: finishedLotError } = await supabase
    .from('finished_inventory_lots')
    .insert({
      organization_id: profile.organization_id,
      packaging_run_id: packagingRun.id,
      source_packaging_run_id: packagingRun.id,
      product_presentation_id: presentation.id,
      finished_lot_code: finishedLotCode,
      available_quantity: qtyPacked,
      original_quantity: qtyPacked,
      unit: 'unidad',
      total_cost: totalCost,
      unit_cost: unitCost,
      location: 'cuarto_frio',
      storage_location: 'cuarto_frio',
      status: 'disponible',
      production_date: productionDate,
      expiration_date: expirationDate,
      created_by: profile.id,
    })
    .select()
    .single();

  if (finishedLotError) throw finishedLotError;

  // Actualizar costo estándar en la presentación con el costo unitario real de este lote
  if (unitCost > 0) {
    await supabase
      .from('product_presentations')
      .update({ standard_cost: unitCost })
      .eq('id', presentation.id)
  }

  return {
    packagingRun,
    finishedLot,
    requirements,
    productionDate,
    expirationDate,
  };
}