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

const ORG_FIELDS = 'id, name, address, phone, email, rtn, city, country, invitation_code, operator_invitation_code'

export async function getOrganization() {
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('organizations')
    .select(ORG_FIELDS)
    .eq('id', orgId)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateOrganization(payload) {
  const orgId = await getOrgId()
  const { data, error } = await supabase
    .from('organizations')
    .update({
      name: payload.name,
      address: payload.address || null,
      phone: payload.phone || null,
      email: payload.email || null,
      rtn: payload.rtn || null,
      city: payload.city || null,
      country: payload.country || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orgId)
    .select(ORG_FIELDS)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function regenerateInviteCode() {
  const orgId = await getOrgId()
  // Generate a random 8-char alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const { data, error } = await supabase
    .from('organizations')
    .update({ invitation_code: code, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select(ORG_FIELDS)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function regenerateOperatorInviteCode() {
  const orgId = await getOrgId()
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const { data, error } = await supabase
    .from('organizations')
    .update({ operator_invitation_code: code, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select(ORG_FIELDS)
    .single()
  if (error) throw new Error(error.message)
  return data
}
