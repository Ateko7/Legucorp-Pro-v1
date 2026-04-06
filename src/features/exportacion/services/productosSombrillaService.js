import { supabase } from '../../../lib/supabase'

async function getOrgId() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return data.organization_id
}

export async function getSombrillas() {
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('productos_sombrilla')
    .select('*')
    .eq('organization_id', orgId)
    .order('nombre')
  if (error) throw new Error(error.message)
  return data || []
}

export async function createSombrilla(payload) {
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('productos_sombrilla')
    .insert({ ...payload, organization_id: orgId })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateSombrilla(id, payload) {
  const { data, error } = await supabase
    .from('productos_sombrilla')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteSombrilla(id) {
  const { error } = await supabase
    .from('productos_sombrilla')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}
