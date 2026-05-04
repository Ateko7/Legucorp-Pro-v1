import { useEffect, useState } from 'react'
import { useCommercialModule } from '../hooks/useCommercialModule'
import { getCommercialSettingsPageData, saveCommercialSettings } from '../services/commercialService'

const INPUT = 'mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-700 outline-none focus:border-[#2f5d50]'

export default function CommercialSettingsPage() {
  const { data, loading, error, reload } = useCommercialModule(getCommercialSettingsPageData, {
    settings: { rules: {}, permissions: {} },
    catalogs: {},
  })
  const [formState, setFormState] = useState(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!formState && data.settings) {
      setFormState(data.settings)
    }
  }, [data.settings, formState])

  if (!formState) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold text-stone-900">Configuración comercial</h1>
        <div className="rounded-2xl border border-stone-200 bg-white px-5 py-10 text-sm text-stone-500">{loading ? 'Cargando configuración...' : 'Preparando configuración...'}</div>
      </div>
    )
  }

  function patchRule(key, value) {
    setFormState((prev) => ({
      ...prev,
      rules: { ...prev.rules, [key]: value },
    }))
  }

  function patchPermission(role, value) {
    setFormState((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [role]: value.split(',').map((item) => item.trim()).filter(Boolean) },
    }))
  }

  async function handleSave() {
    setSaving(true)
    setSuccess('')
    await saveCommercialSettings(formState)
    setSuccess('Configuración comercial guardada.')
    await reload()
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">Configuración comercial</h1>
          <p className="mt-1 text-sm text-stone-500">Catálogos, reglas y permisos para operar el refuerzo CRM sin tocar código.</p>
        </div>
        <button type="button" onClick={handleSave} disabled={saving} className="rounded-xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">Reglas comerciales</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Object.entries(formState.rules).map(([key, value]) => (
              <label key={key} className="text-sm font-medium text-stone-700">
                {key}
                <input className={INPUT} value={value} onChange={(e) => patchRule(key, Number(e.target.value))} />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">Permisos por rol</h2>
          <div className="mt-4 space-y-4">
            {Object.entries(formState.permissions).map(([role, permissions]) => (
              <label key={role} className="block text-sm font-medium text-stone-700">
                {role}
                <input className={INPUT} value={(permissions || []).join(', ')} onChange={(e) => patchPermission(role, e.target.value)} />
              </label>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-stone-900">Catálogos comerciales activos</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(data.catalogs).map(([key, values]) => (
            <div key={key} className="rounded-2xl border border-stone-200 bg-[#faf9f7] p-4">
              <div className="font-medium text-stone-800">{key}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(values || []).map((item) => (
                  <span key={item} className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-600">{item}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
