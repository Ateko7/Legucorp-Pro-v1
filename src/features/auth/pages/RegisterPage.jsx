import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerAdmin, registerWithInvitation } from '../services/authService'

export default function RegisterPage() {
  const navigate = useNavigate()

  const [isAdminCreator, setIsAdminCreator] = useState(false)
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

  const passwordsMatch = useMemo(() => {
    return form.password === form.confirmPassword
  }, [form.password, form.confirmPassword])

  function handleChange(e) {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!passwordsMatch) {
      setError('Las contraseñas no coinciden exactamente.')
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

        setMessage(
          `Cuenta creada. Código de invitación: ${result.onboarding?.invitation_code || ''}`
        )
      } else {
        await registerWithInvitation({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          invitationCode: form.invitationCode,
        })

        setMessage('Cuenta creada y vinculada a la empresa correctamente.')
      }

      setTimeout(() => {
        navigate('/')
      }, 1200)
    } catch (err) {
      setError(err.message || 'No se pudo completar el registro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-8 shadow-2xl border border-slate-200">
        <div className="mb-8">
          <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            Onboarding
          </div>
          <h1 className="mt-4 text-3xl font-bold text-slate-900">Crear cuenta</h1>
          <p className="mt-2 text-sm text-slate-500">
            Crea tu usuario y vincúlalo a una empresa o crea una nueva.
          </p>
        </div>

        <div className="mb-6 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <p className="font-semibold text-slate-800">¿Eres admin creador?</p>
            <p className="text-sm text-slate-500">
              Actívalo si este usuario va a crear la empresa por primera vez.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsAdminCreator((v) => !v)}
            className={`rounded-2xl px-4 py-2 font-semibold transition ${
              isAdminCreator
                ? 'bg-green-700 text-white hover:bg-green-800'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {isAdminCreator ? 'Sí' : 'No'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre completo">
            <input
              name="fullName"
              value={form.fullName}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
              required
            />
          </Field>

          <Field label="Correo">
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
              required
            />
          </Field>

          <Field label="Contraseña">
            <div className="flex gap-2">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 font-medium text-slate-700 hover:bg-slate-100"
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
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 font-medium text-slate-700 hover:bg-slate-100"
              >
                {showConfirmPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </Field>

          {isAdminCreator ? (
            <div className="md:col-span-2">
              <Field label="Nombre de la empresa">
                <input
                  name="organizationName"
                  value={form.organizationName}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
                  required
                />
              </Field>
            </div>
          ) : (
            <div className="md:col-span-2">
              <Field label="Código de invitación">
                <input
                  name="invitationCode"
                  value={form.invitationCode}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
                  required
                />
              </Field>
            </div>
          )}

          <div className="md:col-span-2">
            {!passwordsMatch && form.confirmPassword ? (
              <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Las contraseñas no coinciden.
              </div>
            ) : null}

            {error ? (
              <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {message ? (
              <div className="mb-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {message}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-green-700 px-4 py-3 font-semibold text-white shadow-lg transition hover:bg-green-800 disabled:opacity-60"
            >
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>

            <p className="mt-4 text-sm text-slate-500">
              ¿Ya tienes cuenta?{' '}
              <Link to="/login" className="font-semibold text-green-700 hover:text-green-800">
                Ingresar
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}