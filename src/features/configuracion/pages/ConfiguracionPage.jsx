import { useEffect, useState } from 'react'
import {
  getOrganization,
  updateOrganization,
  regenerateInviteCode,
} from '../../organization/services/organizationService'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  )
}

const INP = 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100'

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="mb-5 border-b border-stone-100 pb-4">
        <h2 className="text-base font-semibold text-stone-800">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Invite code block ────────────────────────────────────────────────────────

function InviteCodeBlock({ org, onOrgUpdate }) {
  const [regenerating, setRegenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  const code = org?.invitation_code

  async function handleRegenerate() {
    if (!window.confirm('¿Generar un nuevo código? El código anterior dejará de funcionar.')) return
    setRegenerating(true)
    setErr('')
    try {
      const updated = await regenerateInviteCode()
      onOrgUpdate(updated)
    } catch (e) {
      setErr(e.message)
    } finally {
      setRegenerating(false)
    }
  }

  function handleCopy() {
    if (!code) return
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <SectionCard
      title="Código de invitación"
      subtitle="Comparte este código con las personas que deseas agregar a tu organización. Al registrarse, ingresan este código para unirse automáticamente."
    >
      {code ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-3 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-6 py-4">
            <span className="flex-1 text-center font-mono text-3xl font-bold tracking-[0.3em] text-emerald-800 select-all">
              {code}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleCopy}
              className={`rounded-2xl px-5 py-3 text-sm font-semibold transition ${
                copied
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
              }`}
            >
              {copied ? '✓ Copiado' : 'Copiar código'}
            </button>
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
            >
              {regenerating ? 'Generando...' : 'Regenerar código'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-stone-500">No hay código de invitación generado aún.</p>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:opacity-50"
          >
            {regenerating ? 'Generando...' : 'Generar código de invitación'}
          </button>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-4 rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3 text-xs text-stone-500">
        <strong>Cómo funciona:</strong> El nuevo usuario se registra en el ERP y, al completar su perfil, ingresa este código de 8 caracteres para unirse a tu organización. Una vez dentro, tendrá acceso a los módulos según su rol.
      </div>
    </SectionCard>
  )
}

// ─── Organization data form ───────────────────────────────────────────────────

function OrgDataForm({ org, onOrgUpdate }) {
  const [form, setForm] = useState({
    name: '', address: '', city: '', country: 'Guatemala',
    phone: '', email: '', rtn: '',
  })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (org) setForm({
      name:    org.name    || '',
      address: org.address || '',
      city:    org.city    || '',
      country: org.country || 'Guatemala',
      phone:   org.phone   || '',
      email:   org.email   || '',
      rtn:     org.rtn     || '',
    })
  }, [org])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setErr('El nombre de la empresa es obligatorio'); return }
    setSaving(true)
    setErr('')
    setSuccess(false)
    try {
      const updated = await updateOrganization(form)
      onOrgUpdate(updated)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  function set(key) {
    return (e) => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  return (
    <SectionCard
      title="Datos de la empresa"
      subtitle="Esta información aparece en las etiquetas de empaque, documentos y reportes del ERP."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nombre de la empresa *">
          <input type="text" value={form.name} onChange={set('name')} required className={INP} placeholder="Ej. Legucorp S.A." />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="RTN / NIT">
            <input type="text" value={form.rtn} onChange={set('rtn')} className={INP} placeholder="Ej. 0801-1990-12345" />
          </Field>
          <Field label="Teléfono">
            <input type="text" value={form.phone} onChange={set('phone')} className={INP} placeholder="Ej. +502 2222-3333" />
          </Field>
        </div>

        <Field label="Email">
          <input type="email" value={form.email} onChange={set('email')} className={INP} placeholder="correo@empresa.com" />
        </Field>

        <Field label="Dirección">
          <input type="text" value={form.address} onChange={set('address')} className={INP} placeholder="Calle, zona, número..." />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ciudad">
            <input type="text" value={form.city} onChange={set('city')} className={INP} placeholder="Ej. Guatemala" />
          </Field>
          <Field label="País">
            <input type="text" value={form.country} onChange={set('country')} className={INP} placeholder="Ej. Guatemala" />
          </Field>
        </div>

        {err && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        )}
        {success && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            ✓ Datos guardados correctamente.
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-2xl bg-[#2f5d50] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConfiguracionPage() {
  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getOrganization()
      .then(setOrg)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-stone-500">
        Cargando configuración...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Sistema</p>
        <h1 className="text-3xl font-semibold text-stone-800">Configuración</h1>
        <p className="mt-2 text-sm text-stone-500">
          Datos de la organización y gestión de acceso al ERP.
        </p>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {org && (
        <>
          <OrgDataForm org={org} onOrgUpdate={setOrg} />
          <InviteCodeBlock org={org} onOrgUpdate={setOrg} />
        </>
      )}
    </div>
  )
}
