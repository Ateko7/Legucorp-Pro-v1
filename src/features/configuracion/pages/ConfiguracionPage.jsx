import { useEffect, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  getOrganization,
  updateOrganization,
  regenerateInviteCode,
  regenerateOperatorInviteCode,
} from '../../organization/services/organizationService'

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

function CodeCard({
  title,
  subtitle,
  code,
  copied,
  regenerating,
  onCopy,
  onRegenerate,
  tone = 'emerald',
}) {
  const tones = {
    emerald: {
      wrap: 'border-emerald-300 bg-emerald-50',
      code: 'text-emerald-800',
      copied: 'bg-emerald-100 text-emerald-700',
      regen: 'border-emerald-200 bg-white text-stone-700 hover:bg-stone-50',
    },
    blue: {
      wrap: 'border-blue-300 bg-blue-50',
      code: 'text-blue-800',
      copied: 'bg-blue-100 text-blue-700',
      regen: 'border-blue-200 bg-white text-stone-700 hover:bg-stone-50',
    },
  }

  const style = tones[tone] || tones.emerald

  return (
    <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-stone-800">{title}</p>
        <p className="mt-1 text-xs text-stone-500">{subtitle}</p>
      </div>

      <div className={`rounded-2xl border-2 border-dashed px-5 py-4 text-center ${style.wrap}`}>
        <span className={`font-mono text-3xl font-black tracking-[0.28em] ${style.code}`}>
          {code || '--------'}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onCopy}
          className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
            copied ? style.copied : 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
          }`}
        >
          {copied ? 'Copiado' : 'Copiar código'}
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition disabled:opacity-60 ${style.regen}`}
        >
          {regenerating ? 'Generando...' : 'Regenerar'}
        </button>
      </div>
    </div>
  )
}

function OrgDataModal({ org, onOrgUpdate, isOpen, onClose }) {
  const [form, setForm] = useState({
    name: '',
    address: '',
    city: '',
    country: 'Guatemala',
    phone: '',
    email: '',
    rtn: '',
  })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!org) return
    setForm({
      name: org.name || '',
      address: org.address || '',
      city: org.city || '',
      country: org.country || 'Guatemala',
      phone: org.phone || '',
      email: org.email || '',
      rtn: org.rtn || '',
    })
  }, [org, isOpen])

  function set(key) {
    return (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setErr('El nombre de la empresa es obligatorio')
      return
    }

    setSaving(true)
    setErr('')
    setSuccess(false)
    try {
      const updated = await updateOrganization(form)
      onOrgUpdate(updated)
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 700)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Editar datos de la empresa" maxWidth="max-w-3xl">
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

        {err && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
        {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Datos guardados correctamente.</div>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:opacity-60">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function ConfiguracionPage() {
  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showOrgModal, setShowOrgModal] = useState(false)
  const [copiedCode, setCopiedCode] = useState('')
  const [regenTarget, setRegenTarget] = useState('')

  useEffect(() => {
    getOrganization()
      .then(setOrg)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function handleCopy(codeKey) {
    const code = org?.[codeKey]
    if (!code) return
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(codeKey)
      setTimeout(() => setCopiedCode(''), 2000)
    })
  }

  async function handleRegenerate(type) {
    const question = type === 'operator'
      ? '¿Generar un nuevo código para operarios? El anterior dejará de funcionar.'
      : '¿Generar un nuevo código de invitación? El anterior dejará de funcionar.'
    if (!window.confirm(question)) return

    setRegenTarget(type)
    setError('')
    try {
      const updated = type === 'operator'
        ? await regenerateOperatorInviteCode()
        : await regenerateInviteCode()
      setOrg(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setRegenTarget('')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-stone-500">
        Cargando configuración...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Sistema</p>
        <h1 className="text-3xl font-semibold text-stone-800">Configuración</h1>
        <p className="mt-2 text-sm text-stone-500">
          Administra los códigos de acceso y edita los datos de la empresa solo cuando lo necesites.
        </p>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {org && (
        <>
          <SectionCard
            title="Empresa"
            subtitle="Resumen corto para que esta pantalla no quede cargada con toda la ficha."
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-stone-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-400">Empresa</p>
                  <p className="mt-1 text-sm font-semibold text-stone-800">{org.name || 'Sin nombre'}</p>
                </div>
                <div className="rounded-2xl bg-stone-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-400">Email</p>
                  <p className="mt-1 text-sm font-semibold text-stone-800">{org.email || 'Sin correo'}</p>
                </div>
                <div className="rounded-2xl bg-stone-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-400">Teléfono</p>
                  <p className="mt-1 text-sm font-semibold text-stone-800">{org.phone || 'Sin teléfono'}</p>
                </div>
                <div className="rounded-2xl bg-stone-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-400">Ubicación</p>
                  <p className="mt-1 text-sm font-semibold text-stone-800">
                    {[org.city, org.country].filter(Boolean).join(', ') || 'Sin ubicación'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowOrgModal(true)}
                className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#264c42]"
              >
                Editar datos
              </button>
            </div>
          </SectionCard>

          <SectionCard
            title="Códigos de acceso"
            subtitle="Usa un código distinto para usuarios normales y otro para operarios."
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <CodeCard
                title="Código de invitación"
                subtitle="Este código lo usan usuarios normales para entrar al ERP completo según su rol."
                code={org.invitation_code}
                copied={copiedCode === 'invitation_code'}
                regenerating={regenTarget === 'staff'}
                onCopy={() => handleCopy('invitation_code')}
                onRegenerate={() => handleRegenerate('staff')}
                tone="emerald"
              />

              <CodeCard
                title="Código de operarios"
                subtitle="Este código lo usan cuentas operativas. Al registrarse, el sistema crea automáticamente su ficha en Nómina."
                code={org.operator_invitation_code}
                copied={copiedCode === 'operator_invitation_code'}
                regenerating={regenTarget === 'operator'}
                onCopy={() => handleCopy('operator_invitation_code')}
                onRegenerate={() => handleRegenerate('operator')}
                tone="blue"
              />
            </div>
          </SectionCard>

          <OrgDataModal
            org={org}
            onOrgUpdate={setOrg}
            isOpen={showOrgModal}
            onClose={() => setShowOrgModal(false)}
          />
        </>
      )}
    </div>
  )
}

