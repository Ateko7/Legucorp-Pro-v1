import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signInWithEmail } from '../services/authService'

const INP = 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800 outline-none transition focus:border-[#2f5d50] focus:bg-white focus:ring-4 focus:ring-[#2f5d50]/10'

export default function LoginPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
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
    <div className="flex min-h-screen items-center justify-center bg-[#f6f1e8] px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-md overflow-hidden">
            <img src="/Logo Leume Impresiones CMYK (1).png" alt="Legucorp" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">Legucorp Pro</h1>
          <p className="mt-1 text-sm text-stone-500">Inicia sesión para continuar</p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-[#dccfbe] bg-white p-7 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-stone-700">Correo electrónico</label>
              <input
                name="email"
                type="email"
                placeholder="tu@empresa.com"
                value={form.email}
                onChange={handleChange}
                required
                className={INP}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-stone-700">Contraseña</label>
              <div className="flex gap-2">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={handleChange}
                  required
                  className={INP}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="shrink-0 rounded-2xl border border-stone-300 bg-stone-50 px-3 py-3 text-xs font-semibold text-stone-600 transition hover:bg-stone-100"
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-stone-500">
          ¿No tienes cuenta?{' '}
          <Link to="/registro" className="font-semibold text-[#2f5d50] hover:underline">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  )
}
