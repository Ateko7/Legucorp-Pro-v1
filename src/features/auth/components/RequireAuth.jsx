import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { getHomePathForProfile, getMyProfile } from '../services/authService'
import { canAccessPath } from '../services/moduleAccess'

export default function RequireAuth({ children, allowedRoles = null, blockedRoles = null, redirectTo = null }) {
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    let mounted = true

    async function loadSession() {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) {
        const myProfile = await getMyProfile().catch(() => null)
        if (!mounted) return
        setProfile(myProfile)
      } else {
        setProfile(null)
      }
      setLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (!newSession?.user) {
        setProfile(null)
        setLoading(false)
        return
      }

      getMyProfile()
        .then((myProfile) => {
          if (!mounted) return
          setProfile(myProfile)
          setLoading(false)
        })
        .catch(() => {
          if (!mounted) return
          setProfile(null)
          setLoading(false)
        })
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return <div style={{ padding: 24 }}>Cargando sesión...</div>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  const role = profile?.role || null
  const isBlocked = Array.isArray(blockedRoles) && role && blockedRoles.includes(role)
  const isAllowed = !Array.isArray(allowedRoles) || !role || allowedRoles.includes(role)
  const hasPathAccess = canAccessPath(profile, location.pathname)

  if (isBlocked || !isAllowed || !hasPathAccess) {
    return <Navigate to={redirectTo || getHomePathForProfile(profile)} replace state={{ from: location }} />
  }

  return children
}
