import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  getMyProfile,
  registerAdmin,
  registerOperatorWithInvitation,
  registerWithInvitation,
  resolveHomePathForProfile,
} from '../services/authService'

const INP = 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800 outline-none transition focus:border-[#2f5d50] focus:bg-white focus:ring-4 focus:ring-[#2f5d50]/10'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const [accountMode, setAccountMode] = useState('staff')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    organizationName: '',
    invitationCode: '',
  })

  const isAdminCreator = accountMode === 'admin'
  const isOperator = accountMode === 'operator'
  const passwordsMatch = useMemo(() => form.password === form.confirmPassword, [form.password, form.confirmPassword])

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!passwordsMatch) {
      setError('Las contraseñas no coinciden.')
      return
    }

    if (form.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    setLoading(true)
    try {
      if (isAdminCreator) {
        const result = await registerAdmin({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          organizationName: form.organizationName,
        })
        setMessage(`Cuenta creada. Código de invitación: ${result.onboarding?.invitation_code || ''}`)
      } else if (isOperator) {
        await registerOperatorWithInvitation({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          invitationCode: form.invitationCode,
        })
        setMessage('Cuenta de operario creada y vinculada correctamente.')
      } else {
        await registerWithInvitation({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          invitationCode: form.invitationCode,
        })
        setMessage('Cuenta creada y vinculada a la empresa correctamente.')
      }

      setTimeout(async () => {
        const profile = await getMyProfile().catch(() => null)
        navigate(await resolveHomePathForProfile(profile))
      }, 1200)
    } catch (err) {
      setError(err.message || 'No se pudo completar el registro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f1e8] px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-md">
            <img src="/Logo Leume Impresiones CMYK (1).png" alt="Legucorp" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Crear cuenta</h1>
          <p className="mt-1 text-sm text-stone-500">Vincula tu usuario a una empresa o crea una nueva</p>
        </div>

        <div className="rounded-3xl border border-[#dccfbe] bg-white p-7 shadow-sm">
          <div className="mb-6 space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div>
              <p className="text-sm font-semibold text-stone-800">Tipo de cuenta</p>
              <p className="mt-0.5 text-xs text-stone-500">Elige cómo te vas a registrar dentro de Legucorp Pro.</p>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <button
                type="button"
                onClick={() => setAccountMode('staff')}
                className={`rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                  accountMode === 'staff' ? 'bg-[#2f5d50] text-white' : 'bg-white text-stone-700 hover:bg-stone-100'
                }`}
              >
                Invitación empresa
              </button>
              <button
                type="button"
                onClick={() => setAccountMode('operator')}
                className={`rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                  accountMode === 'operator' ? 'bg-[#2f5d50] text-white' : 'bg-white text-stone-700 hover:bg-stone-100'
                }`}
              >
                Operario
              </button>
              <button
                type="button"
                onClick={() => setAccountMode('admin')}
                className={`rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                  accountMode === 'admin' ? 'bg-[#2f5d50] text-white' : 'bg-white text-stone-700 hover:bg-stone-100'
                }`}
              >
                Crear empresa
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre completo">
              <input name="fullName" value={form.fullName} onChange={handleChange} required className={INP} placeholder="Tu nombre" />
            </Field>

            <Field label="Correo electrónico">
              <input name="email" type="email" value={form.email} onChange={handleChange} required className={INP} placeholder="tu@empresa.com" />
            </Field>

            <Field label="Contraseña">
              <div className="flex gap-2">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={handleChange}
                  required
                  className={INP}
                  placeholder="Mín. 6 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="shrink-0 rounded-2xl border border-stone-300 bg-stone-50 px-3 text-xs font-semibold text-stone-600 hover:bg-stone-100"
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </Field>

            <Field label="Confirmar contraseña">
              <div className="flex gap-2">
                <input
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={handleChange}
                  required
                  className={INP}
                  placeholder="Repetir contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="shrink-0 rounded-2xl border border-stone-300 bg-stone-50 px-3 text-xs font-semibold text-stone-600 hover:bg-stone-100"
                >
                  {showConfirmPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </Field>

            <div className="md:col-span-2">
              {isAdminCreator ? (
                <Field label="Nombre de la empresa">
                  <input
                    name="organizationName"
                    value={form.organizationName}
                    onChange={handleChange}
                    required
                    className={INP}
                    placeholder="Ej. Legucorp S.A."
                  />
                </Field>
              ) : (
                <Field label={isOperator ? 'Código de operario' : 'Código de invitación'}>
                  <input
                    name="invitationCode"
                    value={form.invitationCode}
                    onChange={handleChange}
                    required
                    className={INP}
                    placeholder={isOperator ? 'Código general para operarios' : 'Código de 8 caracteres'}
                  />
                </Field>
              )}
            </div>

            <div className="md:col-span-2 space-y-3">
              {!passwordsMatch && form.confirmPassword && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Las contraseñas no coinciden.</div>
              )}
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              )}
              {message && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#264c42] disabled:opacity-60"
              >
                {loading ? 'Creando cuenta...' : 'Crear cuenta'}
              </button>

              <p className="text-center text-sm text-stone-500">
                ¿Ya tienes cuenta?{' '}
                <Link to="/login" className="font-semibold text-[#2f5d50] hover:underline">Ingresar</Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

