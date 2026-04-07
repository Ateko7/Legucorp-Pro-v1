import { supabase } from '../../../lib/supabase'

export async function getSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'No se pudieron cargar los proveedores')
  }

  return data || []
}

export async function createSupplier(payload) {
  const {
    name,
    nit,
    contact_name,
    phone,
    email,
    payment_days,
    tax_regime = 'pagos_trimestrales',
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

  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      organization_id: profile.organization_id,
      name,
      nit: nit || null,
      contact_name: contact_name || null,
      phone: phone || null,
      email: email || null,
      payment_days: Number(payment_days || 0),
      tax_regime,
      status,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    throw new Error(error.message || 'No se pudo crear el proveedor')
  }

  return data
}

export async function deleteSupplier(id) {
  const { error } = await supabase
    .from('suppliers')
    .update({ status: 'inactivo' })
    .eq('id', id)
  if (error) throw new Error(error.message || 'No se pudo eliminar el proveedor')
}

export async function updateSupplier(id, payload) {
  const { name, nit, contact_name, phone, email, payment_days, tax_regime, status } = payload

  const { error } = await supabase
    .from('suppliers')
    .update({
      name,
      nit: nit || null,
      contact_name: contact_name || null,
      phone: phone || null,
      email: email || null,
      payment_days: Number(payment_days || 0),
      tax_regime,
      status,
    })
    .eq('id', id)

  if (error) throw new Error(error.message || 'No se pudo actualizar el proveedor')
}
