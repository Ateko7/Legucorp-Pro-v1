import { supabase } from '../../../lib/supabase'

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getUsersWithAccess() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, is_admin, erp_access_mode, erp_allowed_modules, created_at')
    .eq('organization_id', profile.organization_id)
    .order('full_name', { ascending: true })

  if (error) throw new Error(error.message)
  return data || []
}

export async function updateUserAccess(userId, payload) {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('profiles')
    .update({
      erp_access_mode: payload.erp_access_mode,
      erp_allowed_modules: payload.erp_access_mode === 'limited' ? payload.erp_allowed_modules || [] : [],
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', profile.organization_id)
    .eq('id', userId)
    .select('id, full_name, email, role, is_active, is_admin, erp_access_mode, erp_allowed_modules, created_at')
    .single()

  if (error) throw new Error(error.message)
  return data
}
