import { supabase } from '../../../lib/supabase'
import { MODULE_DEFINITIONS, getAllowedModules } from './moduleAccess'

/**
 * Inicia sesión con email y contraseña
 */
export async function signInWithEmail(email, password) {
  const cleanEmail = email?.trim().toLowerCase()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo iniciar sesión')
  }

  return data
}

/**
 * Cierra sesión
 */
export async function signOutUser() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw new Error(error.message || 'No se pudo cerrar sesión')
  }

  return true
}

/**
 * Obtiene la sesión actual
 */
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    throw new Error(error.message || 'No se pudo obtener la sesión')
  }

  return data.session
}

/**
 * Obtiene el usuario autenticado
 */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    throw new Error(error.message || 'No se pudo obtener el usuario actual')
  }

  return data.user
}

/**
 * Obtiene el perfil del usuario autenticado
 */
export async function getMyProfile() {
  const user = await getCurrentUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message || 'No se pudo obtener el perfil')
  }

  return data
}

export function getHomePathForProfile(profile) {
  if (profile?.role === 'operario') return '/marcacion'

  const allowedModules = getAllowedModules(profile)
  if (allowedModules.includes('dashboard')) return '/'

  const firstAllowed = MODULE_DEFINITIONS.find((module) => allowedModules.includes(module.key) && module.paths?.[0])
  return firstAllowed?.paths?.[0] || '/'
}

export async function getOperatorSetupStatus(profileParam = null) {
  const profile = profileParam || await getMyProfile()

  if (!profile || profile.role !== 'operario') {
    return { needsSetup: false, profile, empleado: null, biometria: null }
  }

  if (!profile.empleado_id || !profile.organization_id) {
    return { needsSetup: true, profile, empleado: null, biometria: null }
  }

  const [{ data: empleado, error: empleadoError }, { data: biometria, error: biometriaError }] = await Promise.all([
    supabase
      .from('empleados')
      .select('id, organization_id, sede_id, codigo_empleado, nombres, apellidos')
      .eq('id', profile.empleado_id)
      .eq('organization_id', profile.organization_id)
      .maybeSingle(),
    supabase
      .from('employee_biometrics')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .eq('empleado_id', profile.empleado_id)
      .eq('biometric_type', 'face')
      .eq('enrollment_status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (empleadoError) {
    throw new Error(empleadoError.message || 'No se pudo verificar el empleado del operario')
  }

  if (biometriaError) {
    throw new Error(biometriaError.message || 'No se pudo verificar la biometría del operario')
  }

  return {
    needsSetup: !empleado?.sede_id || !biometria,
    profile,
    empleado: empleado || null,
    biometria: biometria || null,
  }
}

export async function resolveHomePathForProfile(profileParam = null) {
  const profile = profileParam || await getMyProfile()

  if (profile?.role === 'operario') {
    const setup = await getOperatorSetupStatus(profile)
    return setup.needsSetup ? '/operario-onboarding' : '/marcacion'
  }

  return '/'
}

/**
 * Espera unos milisegundos
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Busca sesión activa varias veces por si Supabase tarda un poco
 */
async function waitForActiveSession({
  retries = 8,
  delayMs = 400,
} = {}) {
  for (let i = 0; i < retries; i += 1) {
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      throw new Error(error.message || 'No se pudo verificar la sesión')
    }

    if (data?.session) {
      return data.session
    }

    await delay(delayMs)
  }

  return null
}

/**
 * Registra un usuario que crea empresa y queda como admin_1
 */
export async function registerAdmin({
  email,
  password,
  fullName,
  organizationName,
}) {
  const cleanEmail = email?.trim().toLowerCase()
  const cleanFullName = fullName?.trim()
  const cleanOrganizationName = organizationName?.trim()

  if (!cleanEmail) {
    throw new Error('El correo es obligatorio')
  }

  if (!password) {
    throw new Error('La contraseña es obligatoria')
  }

  if (!cleanOrganizationName) {
    throw new Error('El nombre de la empresa es obligatorio')
  }

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo crear el usuario')
  }

  const session = await waitForActiveSession()

  if (!session) {
    throw new Error(
      'El usuario fue creado en autenticación, pero no quedó una sesión activa. Revisa si la confirmación por email está activada en Supabase.'
    )
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'complete_admin_onboarding',
    {
      p_org_name: cleanOrganizationName,
      p_full_name: cleanFullName || null,
    }
  )

  if (rpcError) {
    throw new Error(
      `Usuario creado, pero falló el onboarding de empresa: ${rpcError.message}`
    )
  }

  return {
    auth: data,
    onboarding: rpcData,
    session,
  }
}

/**
 * Registra un usuario que se une a una empresa con código de invitación
 */
export async function registerWithInvitation({
  email,
  password,
  fullName,
  invitationCode,
}) {
  const cleanEmail = email?.trim().toLowerCase()
  const cleanFullName = fullName?.trim()
  const cleanInvitationCode = invitationCode?.trim().toUpperCase()

  if (!cleanEmail) {
    throw new Error('El correo es obligatorio')
  }

  if (!password) {
    throw new Error('La contraseña es obligatoria')
  }

  if (!cleanInvitationCode) {
    throw new Error('El código de invitación es obligatorio')
  }

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo crear el usuario')
  }

  const session = await waitForActiveSession()

  if (!session) {
    throw new Error(
      'El usuario fue creado en autenticación, pero no quedó una sesión activa. Revisa si la confirmación por email está activada en Supabase.'
    )
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'complete_invited_onboarding',
    {
      p_invitation_code: cleanInvitationCode,
      p_full_name: cleanFullName || null,
    }
  )

  if (rpcError) {
    throw new Error(
      `Usuario creado, pero falló la vinculación a empresa: ${rpcError.message}`
    )
  }

  return {
    auth: data,
    onboarding: rpcData,
    session,
  }
}

/**
 * Registra un operario con código compartido
 */
export async function registerOperatorWithInvitation({
  email,
  password,
  fullName,
  invitationCode,
}) {
  const cleanEmail = email?.trim().toLowerCase()
  const cleanFullName = fullName?.trim()
  const cleanInvitationCode = invitationCode?.trim().toUpperCase()

  if (!cleanEmail) {
    throw new Error('El correo es obligatorio')
  }

  if (!password) {
    throw new Error('La contraseña es obligatoria')
  }

  if (!cleanInvitationCode) {
    throw new Error('El código de operario es obligatorio')
  }

  let data = null
  const { data: signUpData, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
  })

  if (error) {
    const alreadyRegistered = /already registered/i.test(error.message || '')

    if (!alreadyRegistered) {
      throw new Error(error.message || 'No se pudo crear el usuario')
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    })

    if (signInError) {
      throw new Error(
        'Ese correo ya existe en autenticación. Inicia sesión con esa cuenta o elimínala en Supabase Auth para volver a registrarla.'
      )
    }

    data = signInData
  } else {
    data = signUpData
  }

  const session = await waitForActiveSession()

  if (!session) {
    throw new Error(
      'El usuario fue creado en autenticación, pero no quedó una sesión activa. Revisa si la confirmación por email está activada en Supabase.'
    )
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'complete_operator_onboarding',
    {
      p_invitation_code: cleanInvitationCode,
      p_full_name: cleanFullName || null,
    }
  )

  if (rpcError) {
    throw new Error(
      `Usuario creado, pero falló la vinculación del operario: ${rpcError.message}`
    )
  }

  return {
    auth: data,
    onboarding: rpcData,
    session,
  }
}

/**
 * Reenvía email de recuperación de contraseña
 * No es crítico ahorita, pero te lo dejo listo
 */
export async function sendPasswordRecovery(email) {
  const cleanEmail = email?.trim().toLowerCase()

  const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: window.location.origin,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo enviar el correo de recuperación')
  }

  return data
}

/**
 * Cambia contraseña del usuario autenticado
 */
export async function updateMyPassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (error) {
    throw new Error(error.message || 'No se pudo actualizar la contraseña')
  }

  return data
}

