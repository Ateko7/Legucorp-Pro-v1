import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmail } from '../services/authService'

export default function LoginPage() {
  const navigate = useNavigate()

  const [form, setForm] = useState({
    email: '',
    password: '',
  })

  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signInWithEmail(form.email, form.password)
      navigate('/')
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl border border-slate-200">
        <div className="mb-8">
          <div className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
            Legucorp Pro V1
          </div>
          <h1 className="mt-4 text-3xl font-bold text-slate-900">
            Bienvenido
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Inicia sesión para continuar al ERP.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Correo
            </label>
            <input
              name="email"
              type="email"
              placeholder="tucorreo@empresa.com"
              value={form.email}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Contraseña
            </label>
            <div className="flex gap-2">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={form.password}
                onChange={handleChange}
                className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 font-medium text-slate-700 hover:bg-slate-100"
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-green-700 px-4 py-3 font-semibold text-white shadow-lg transition hover:bg-green-800 disabled:opacity-60"
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <p className="mt-6 text-sm text-slate-500">
          ¿No tienes cuenta?{' '}
          <Link to="/registro" className="font-semibold text-green-700 hover:text-green-800">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  )
}