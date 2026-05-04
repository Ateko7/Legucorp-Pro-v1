import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  QUALITY_STAGES,
  RESULTADOS_CALIDAD,
  evaluateInspectionDraft,
  getConfiguracion,
  saveConfiguracion,
  getDashboardCalidad,
  getInspecciones,
  createInspeccion,
  completarInspeccion,
  liberarLote,
  cancelarInspeccion,
  getSpecTemplates,
  saveSpecTemplate,
  saveSpecRule,
  getInspectionSources,
  getNonConformities,
  updateNonConformity,
} from '../services/calidadService'
import { ejecutarMuestreo } from '../services/muestreoService'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function fmt2(value) {
  return n(value).toFixed(2)
}

const RESULTADO_LABEL = {
  liberado: 'Liberado',
  liberado_con_observacion: 'Con observacion',
  retenido: 'Retenido',
  rechazado: 'Rechazado',
}

const RESULTADO_COLOR = {
  liberado: 'bg-emerald-100 text-emerald-700',
  liberado_con_observacion: 'bg-amber-100 text-amber-700',
  retenido: 'bg-orange-100 text-orange-700',
  rechazado: 'bg-red-100 text-red-700',
}

const STATUS_COLOR = {
  pendiente: 'bg-blue-100 text-blue-700',
  en_proceso: 'bg-violet-100 text-violet-700',
  completada: 'bg-emerald-100 text-emerald-700',
  cancelada: 'bg-stone-100 text-stone-600',
}

const SEVERITY_COLOR = {
  menor: 'bg-stone-100 text-stone-700',
  mayor: 'bg-orange-100 text-orange-700',
  critico: 'bg-red-100 text-red-700',
}

const NC_STATUS_COLOR = {
  abierta: 'bg-red-100 text-red-700',
  en_investigacion: 'bg-amber-100 text-amber-700',
  accion_en_curso: 'bg-blue-100 text-blue-700',
  cerrada: 'bg-emerald-100 text-emerald-700',
  vencida: 'bg-rose-100 text-rose-700',
}

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'inspecciones', label: 'Inspecciones' },
  { key: 'no_conformidades', label: 'No conformidades' },
  { key: 'especificaciones', label: 'Especificaciones' },
  { key: 'configuracion', label: 'Configuracion de muestreo' },
]

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-[#2f5d50]" />
    </div>
  )
}

function Card({ title, subtitle, actions, children }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      {(title || subtitle || actions) && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title && <h3 className="text-lg font-bold text-stone-900">{title}</h3>}
            {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

function Badge({ label, color }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>{label}</span>
}

function EmptyState({ text }) {
  return (
    <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 p-10 text-center text-sm text-stone-500">
      {text}
    </div>
  )
}

function StageBadge({ stage }) {
  const meta = QUALITY_STAGES.find((item) => item.key === stage)
  return <Badge label={meta?.label || stage} color="bg-stone-100 text-stone-700" />
}

function KpiCard({ label, value, sub, tone = 'default' }) {
  const cls =
    tone === 'danger'
      ? 'bg-red-600 border-red-600 text-white'
      : tone === 'brand'
        ? 'bg-[#2f5d50] border-[#2f5d50] text-white'
        : 'bg-white border-stone-200 text-stone-900'

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${cls}`}>
      <p className={`text-xs font-semibold uppercase tracking-widest ${tone === 'default' ? 'text-stone-400' : 'text-white/70'}`}>{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
      {sub ? <p className={`mt-1 text-xs ${tone === 'default' ? 'text-stone-400' : 'text-white/70'}`}>{sub}</p> : null}
    </div>
  )
}

function ResultButtons({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {RESULTADOS_CALIDAD.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
            value === item
              ? item === 'liberado'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : item === 'liberado_con_observacion'
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : item === 'retenido'
                    ? 'border-orange-500 bg-orange-500 text-white'
                    : 'border-red-500 bg-red-500 text-white'
              : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
          }`}
        >
          {RESULTADO_LABEL[item]}
        </button>
      ))}
    </div>
  )
}

function MeasurementField({ rule, value, onChange }) {
  if (rule.measurement_type === 'numeric') {
    return (
      <input
        type="number"
        step="0.01"
        value={value.actual_numeric ?? ''}
        onChange={(e) => onChange({ ...value, actual_numeric: e.target.value })}
        className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none"
      />
    )
  }

  if (rule.measurement_type === 'boolean') {
    return (
      <select
        value={value.actual_boolean == null ? '' : value.actual_boolean ? 'true' : 'false'}
        onChange={(e) => onChange({ ...value, actual_boolean: e.target.value === '' ? null : e.target.value === 'true' })}
        className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none"
      >
        <option value="">Seleccionar...</option>
        <option value="true">Cumple</option>
        <option value="false">No cumple</option>
      </select>
    )
  }

  if (rule.measurement_type === 'select') {
    return (
      <input
        value={value.actual_text || ''}
        onChange={(e) => onChange({ ...value, actual_text: e.target.value })}
        placeholder={`Permitidos: ${(rule.allowed_values || []).join(', ')}`}
        className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none"
      />
    )
  }

  return (
    <input
      type="number"
      min="0"
      step="1"
      value={value.actual_count ?? ''}
      onChange={(e) => onChange({ ...value, actual_count: e.target.value })}
      className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none"
    />
  )
}

function DefectsEditor({ defectos, onChange }) {
  const [draft, setDraft] = useState({ tipo_defecto: '', cantidad: 1, nivel: 'menor' })

  function addDefect() {
    if (!draft.tipo_defecto.trim()) return
    onChange([...defectos, { ...draft, cantidad: parseInt(draft.cantidad || 1, 10) || 1 }])
    setDraft({ tipo_defecto: '', cantidad: 1, nivel: 'menor' })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {defectos.length === 0 ? (
          <p className="text-xs text-stone-400">Sin defectos registrados.</p>
        ) : (
          defectos.map((defecto, index) => (
            <div key={`${defecto.tipo_defecto}-${index}`} className="flex items-center justify-between rounded-2xl bg-stone-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge label={defecto.nivel} color={SEVERITY_COLOR[defecto.nivel] || SEVERITY_COLOR.menor} />
                <span className="text-sm font-medium text-stone-800">{defecto.tipo_defecto}</span>
                <span className="text-xs text-stone-400">x{defecto.cantidad}</span>
              </div>
              <button
                type="button"
                onClick={() => onChange(defectos.filter((_, innerIndex) => innerIndex !== index))}
                className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-red-500"
              >
                x
              </button>
            </div>
          ))
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_90px_140px_48px]">
        <input
          value={draft.tipo_defecto}
          onChange={(e) => setDraft((current) => ({ ...current, tipo_defecto: e.target.value }))}
          placeholder="Tipo de defecto"
          className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none"
        />
        <input
          type="number"
          min="1"
          value={draft.cantidad}
          onChange={(e) => setDraft((current) => ({ ...current, cantidad: e.target.value }))}
          className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none"
        />
        <select
          value={draft.nivel}
          onChange={(e) => setDraft((current) => ({ ...current, nivel: e.target.value }))}
          className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none"
        >
          <option value="menor">Menor</option>
          <option value="mayor">Mayor</option>
          <option value="critico">Critico</option>
        </select>
        <button
          type="button"
          onClick={addDefect}
          className="rounded-2xl bg-[#2f5d50] px-3 py-2 text-sm font-semibold text-white hover:bg-[#264c42]"
        >
          +
        </button>
      </div>
    </div>
  )
}

function ModalShell({ title, subtitle, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-stone-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-stone-900">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-stone-500">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">
            x
          </button>
        </div>
        <div className="space-y-5 p-6">{children}</div>
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-stone-100 bg-white px-6 py-4">
          {footer}
        </div>
      </div>
    </div>
  )
}

function CreateInspectionModal({ onClose, onCreated }) {
  const [sources, setSources] = useState(null)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    inspection_stage: 'recepcion_mp',
    spec_template_id: '',
    source_reception_id: '',
    source_process_output_id: '',
    source_processed_lot_id: '',
    finished_lot_id: '',
    origen: 'manual',
    tamano_muestra: 5,
    observaciones: '',
  })

  useEffect(() => {
    let active = true
    async function load() {
      try {
        setLoading(true)
        const [loadedSources, loadedTemplates] = await Promise.all([getInspectionSources(), getSpecTemplates()])
        if (!active) return
        setSources(loadedSources)
        setTemplates(loadedTemplates)
      } catch (err) {
        if (!active) return
        setError(err.message || 'No se pudo cargar el formulario.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  const templatesForStage = templates.filter((item) => item.inspection_stage === form.inspection_stage)

  useEffect(() => {
    if (!templatesForStage.length) return
    setForm((current) => ({
      ...current,
      spec_template_id: templatesForStage.some((item) => item.id === current.spec_template_id)
        ? current.spec_template_id
        : templatesForStage[0].id,
    }))
  }, [form.inspection_stage, templatesForStage.length])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const payload = {
        inspection_stage: form.inspection_stage,
        spec_template_id: form.spec_template_id || null,
        origen: form.origen,
        tamano_muestra: parseInt(form.tamano_muestra || 5, 10) || 5,
        observaciones: form.observaciones,
      }

      if (form.inspection_stage === 'recepcion_mp') payload.source_reception_id = form.source_reception_id || null
      if (form.inspection_stage === 'proceso') {
        payload.source_process_output_id = form.source_process_output_id || null
        payload.source_processed_lot_id = form.source_processed_lot_id || null
      }
      if (form.inspection_stage === 'empaque_final') payload.finished_lot_id = form.finished_lot_id || null

      if (
        (form.inspection_stage === 'recepcion_mp' && !payload.source_reception_id) ||
        (form.inspection_stage === 'proceso' && !payload.source_process_output_id && !payload.source_processed_lot_id) ||
        (form.inspection_stage === 'empaque_final' && !payload.finished_lot_id)
      ) {
        throw new Error('Selecciona el objeto a inspeccionar para la etapa elegida.')
      }

      const inspection = await createInspeccion(payload)
      await onCreated(inspection)
    } catch (err) {
      setError(err.message || 'No se pudo crear la inspeccion.')
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Nueva inspeccion"
      subtitle="Una sola experiencia para recepcion, proceso y empaque."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-2xl border border-stone-200 px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">Cancelar</button>
          <button onClick={handleSave} disabled={saving || loading} className="rounded-2xl bg-[#2f5d50] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Creando...' : 'Crear inspeccion'}
          </button>
        </>
      }
    >
      {loading ? <Spinner /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">Etapa</label>
              <select value={form.inspection_stage} onChange={(e) => setForm({
                inspection_stage: e.target.value,
                spec_template_id: '',
                source_reception_id: '',
                source_process_output_id: '',
                source_processed_lot_id: '',
                finished_lot_id: '',
                origen: form.origen,
                tamano_muestra: form.tamano_muestra,
                observaciones: form.observaciones,
              })} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                {QUALITY_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">Plantilla</label>
              <select value={form.spec_template_id} onChange={(e) => update('spec_template_id', e.target.value)} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                <option value="">Seleccionar...</option>
                {templatesForStage.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">Tamanio de muestra</label>
              <input type="number" min="1" value={form.tamano_muestra} onChange={(e) => update('tamano_muestra', e.target.value)} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
            </div>
          </div>

          {form.inspection_stage === 'recepcion_mp' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">Recepcion a inspeccionar</label>
              <select value={form.source_reception_id} onChange={(e) => update('source_reception_id', e.target.value)} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                <option value="">Seleccionar recepcion...</option>
                {(sources?.receptions || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.received_date} · {item.materials?.common_name} · {item.internal_lot} · {item.suppliers?.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.inspection_stage === 'proceso' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-700">Sublote de proceso</label>
                <select value={form.source_process_output_id} onChange={(e) => {
                  update('source_process_output_id', e.target.value)
                  update('source_processed_lot_id', '')
                }} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                  <option value="">Seleccionar sublote...</option>
                  {(sources?.processOutputs || []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.stage} · {item.output_lot_code} · {item.materials?.common_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-700">Lote procesado</label>
                <select value={form.source_processed_lot_id} onChange={(e) => {
                  update('source_processed_lot_id', e.target.value)
                  update('source_process_output_id', '')
                }} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                  <option value="">Seleccionar lote procesado...</option>
                  {(sources?.processedLots || []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.internal_lot} · {item.materials?.common_name} · {fmt2(item.available_quantity)} {item.unit}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {form.inspection_stage === 'empaque_final' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">Lote terminado</label>
              <select value={form.finished_lot_id} onChange={(e) => update('finished_lot_id', e.target.value)} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                <option value="">Seleccionar lote...</option>
                {(sources?.finishedLots || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.production_date} · {item.finished_lot_code} · {item.product_presentations?.display_name || item.product_presentations?.code}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">Notas iniciales</label>
            <textarea rows={3} value={form.observaciones} onChange={(e) => update('observaciones', e.target.value)} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
          </div>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </>
      )}
    </ModalShell>
  )
}

function CompleteInspectionModal({ inspeccion, onClose, onSaved }) {
  const [measurements, setMeasurements] = useState(
    (inspeccion.spec_rules || []).map((rule) => {
      const existing = (inspeccion.measurements || []).find((item) => item.spec_rule_id === rule.id)
      return {
        spec_rule_id: rule.id,
        actual_numeric: existing?.actual_numeric ?? '',
        actual_boolean: existing?.actual_boolean ?? null,
        actual_text: existing?.actual_text ?? '',
        actual_count: existing?.actual_count ?? '',
        notes: existing?.notes ?? '',
      }
    })
  )
  const [defectos, setDefectos] = useState(inspeccion.defectos_inspeccion || [])
  const [form, setForm] = useState({
    resultado: inspeccion.resultado || '',
    unidades_inspeccionadas: inspeccion.unidades_inspeccionadas || inspeccion.tamano_muestra || 5,
    unidades_defectuosas: inspeccion.unidades_defectuosas || 0,
    observaciones: inspeccion.observaciones || '',
    override_reason: '',
  })
  const [lockedResult, setLockedResult] = useState(Boolean(inspeccion.resultado))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setForm((current) => ({
      ...current,
      unidades_defectuosas: defectos.reduce((sum, item) => sum + n(item.cantidad), 0),
    }))
  }, [defectos])

  const preview = useMemo(
    () => evaluateInspectionDraft(inspeccion.spec_rules || [], measurements, defectos),
    [inspeccion.spec_rules, measurements, defectos]
  )

  useEffect(() => {
    if (!lockedResult) {
      setForm((current) => ({ ...current, resultado: preview.resultado_automatico }))
    }
  }, [preview.resultado_automatico, lockedResult])

  function setMeasurement(ruleId, nextValue) {
    setMeasurements((current) => current.map((item) => (item.spec_rule_id === ruleId ? nextValue : item)))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSaved(inspeccion.id, {
        ...form,
        measurements,
        defectos,
      })
    } catch (err) {
      setError(err.message || 'No se pudo completar la inspeccion.')
      setSaving(false)
    }
  }

  const resultIsSofter = RESULTADOS_CALIDAD.indexOf(form.resultado) < RESULTADOS_CALIDAD.indexOf(preview.resultado_automatico)

  return (
    <ModalShell
      title="Completar inspeccion"
      subtitle={`${inspeccion.source_label} · ${inspeccion.spec_template?.name || 'Sin plantilla'}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-2xl border border-stone-200 px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="rounded-2xl bg-[#2f5d50] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar resultado'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <Card title="Criterios de inspeccion" subtitle="Cada medicion se evalua contra tolerancias y severidad.">
            <div className="space-y-4">
              {(inspeccion.spec_rules || []).map((rule) => {
                const currentValue = measurements.find((item) => item.spec_rule_id === rule.id) || { spec_rule_id: rule.id }
                const measured = preview.measurements.find((item) => item.spec_rule_id === rule.id)
                return (
                  <div key={rule.id} className="rounded-2xl border border-stone-200 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-stone-800">{rule.label}</p>
                        <p className="mt-1 text-xs text-stone-400">
                          {rule.measurement_type}
                          {rule.unit ? ` · ${rule.unit}` : ''}
                          {rule.min_value != null ? ` · Min ${rule.min_value}` : ''}
                          {rule.max_value != null ? ` · Max ${rule.max_value}` : ''}
                          {rule.defect_threshold != null ? ` · Umbral ${rule.defect_threshold}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge label={rule.severity} color={SEVERITY_COLOR[rule.severity] || SEVERITY_COLOR.menor} />
                        {measured ? (
                          <Badge
                            label={measured.pass ? 'Cumple' : `Falla · ${RESULTADO_LABEL[measured.decision_effect]}`}
                            color={measured.pass ? 'bg-emerald-100 text-emerald-700' : RESULTADO_COLOR[measured.decision_effect]}
                          />
                        ) : null}
                      </div>
                    </div>
                    <MeasurementField rule={rule} value={currentValue} onChange={(next) => setMeasurement(rule.id, next)} />
                  </div>
                )
              })}
            </div>
          </Card>

          <Card title="Defectos observados">
            <DefectsEditor defectos={defectos} onChange={setDefectos} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Decision" subtitle="El sistema sugiere el resultado en base a los criterios fallidos.">
            <div className="space-y-4">
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Resultado automatico</p>
                <div className="mt-2">
                  <Badge label={RESULTADO_LABEL[preview.resultado_automatico]} color={RESULTADO_COLOR[preview.resultado_automatico]} />
                </div>
                <p className="mt-2 text-xs text-stone-500">
                  {preview.failing_rules} criterio(s) fuera de tolerancia
                  {preview.top_severity ? ` · severidad maxima ${preview.top_severity}` : ''}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-stone-700">Resultado final</label>
                <ResultButtons value={form.resultado} onChange={(next) => {
                  setLockedResult(true)
                  setForm((current) => ({ ...current, resultado: next }))
                }} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-stone-700">Unidades inspeccionadas</label>
                  <input type="number" min="1" value={form.unidades_inspeccionadas} onChange={(e) => setForm((current) => ({ ...current, unidades_inspeccionadas: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-stone-700">Unidades defectuosas</label>
                  <input type="number" min="0" value={form.unidades_defectuosas} onChange={(e) => setForm((current) => ({ ...current, unidades_defectuosas: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-stone-700">Observaciones</label>
                <textarea rows={4} value={form.observaciones} onChange={(e) => setForm((current) => ({ ...current, observaciones: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              </div>

              {resultIsSofter ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-stone-700">Justificacion de override</label>
                  <textarea rows={3} value={form.override_reason} onChange={(e) => setForm((current) => ({ ...current, override_reason: e.target.value }))} className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm focus:border-red-300 focus:outline-none" />
                </div>
              ) : null}

              {['retenido', 'rechazado'].includes(form.resultado) ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Este resultado bloqueara operativamente el objeto inspeccionado y generara una no conformidad si la severidad lo amerita.
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </ModalShell>
  )
}

function NonConformityModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    status: item.status || 'abierta',
    root_cause: item.root_cause || '',
    corrective_action: item.corrective_action || '',
    preventive_action: item.preventive_action || '',
    due_date: item.due_date || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSaved(item.id, form)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la no conformidad.')
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Actualizar no conformidad"
      subtitle={item.title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-2xl border border-stone-200 px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="rounded-2xl bg-[#2f5d50] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">Estado</label>
          <select value={form.status} onChange={(e) => setForm((current) => ({ ...current, status: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
            <option value="abierta">Abierta</option>
            <option value="en_investigacion">En investigacion</option>
            <option value="accion_en_curso">Accion en curso</option>
            <option value="cerrada">Cerrada</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-700">Fecha compromiso</label>
          <input type="date" value={form.due_date} onChange={(e) => setForm((current) => ({ ...current, due_date: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">Causa raiz</label>
        <textarea rows={3} value={form.root_cause} onChange={(e) => setForm((current) => ({ ...current, root_cause: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">Accion correctiva</label>
        <textarea rows={3} value={form.corrective_action} onChange={(e) => setForm((current) => ({ ...current, corrective_action: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">Accion preventiva</label>
        <textarea rows={3} value={form.preventive_action} onChange={(e) => setForm((current) => ({ ...current, preventive_action: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
      </div>
      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </ModalShell>
  )
}

function DashboardTab({ onGoToInspections }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await getDashboardCalidad()
      setData(next)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['inspecciones_calidad', 'quality_non_conformities', 'material_inventory_lots', 'material_process_stage_outputs', 'processed_inventory_lots', 'finished_inventory_lots'], load)

  if (loading) return <Spinner />
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
  if (!data) return null

  const blockedTotal = (data.lotesBlockeados.recepcion?.length || 0) + (data.lotesBlockeados.proceso?.length || 0) + (data.lotesBlockeados.empaque?.length || 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Inspecciones hoy" value={data.hoy.total} sub={`${data.hoy.pendientes} pendientes · ${data.hoy.completadas} completadas`} tone="brand" />
        <KpiCard label="Rechazos hoy" value={data.hoy.rechazadas} sub="Resultados criticos del dia" tone={data.hoy.rechazadas > 0 ? 'danger' : 'default'} />
        <KpiCard label="No conformidades abiertas" value={data.nonConformities.abiertas} sub={`${data.nonConformities.vencidas} vencidas`} />
        <KpiCard label="Objetos bloqueados" value={blockedTotal} sub={`Costo estimado de no calidad: ${data.costEstimate}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card title="Tasa de rechazo por etapa" subtitle="Separada por recepcion, proceso y empaque.">
          <div className="space-y-3">
            {data.byStage.map((stage) => (
              <div key={stage.key} className="rounded-2xl border border-stone-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-800">{stage.label}</p>
                    <p className="mt-1 text-xs text-stone-400">{stage.total} inspeccion(es) · {stage.retenidos} retenidos · {stage.rechazados} rechazados</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-stone-900">{fmt2(stage.tasa_rechazo)}%</p>
                    <p className="text-xs text-stone-400">tasa rechazo</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Bloqueos activos" subtitle="Materia prima, proceso y producto terminado." actions={<button onClick={() => onGoToInspections()} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50">Ver inspecciones</button>}>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400">Recepcion</p>
              {(data.lotesBlockeados.recepcion || []).length === 0 ? <p className="text-sm text-stone-400">Sin bloqueos.</p> : (
                <div className="space-y-2">
                  {data.lotesBlockeados.recepcion.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
                      {item.materials?.common_name || item.internal_lot} · {item.internal_lot}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400">Proceso</p>
              {(data.lotesBlockeados.proceso || []).length === 0 ? <p className="text-sm text-stone-400">Sin bloqueos.</p> : (
                <div className="space-y-2">
                  {data.lotesBlockeados.proceso.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
                      {item.output_lot_code || item.internal_lot}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400">Empaque</p>
              {(data.lotesBlockeados.empaque || []).length === 0 ? <p className="text-sm text-stone-400">Sin bloqueos.</p> : (
                <div className="space-y-2">
                  {data.lotesBlockeados.empaque.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
                      {item.product_presentations?.code} · {item.finished_lot_code}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Top defectos" subtitle="Acumulado por defectos registrados en inspecciones completadas.">
          {data.topDefects.length === 0 ? <EmptyState text="Aun no hay defectos consolidados en el periodo." /> : (
            <div className="space-y-2">
              {data.topDefects.map((item) => (
                <div key={item.tipo_defecto} className="flex items-center justify-between rounded-2xl bg-stone-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-stone-800">{item.tipo_defecto}</span>
                    <Badge label={item.max_severity} color={SEVERITY_COLOR[item.max_severity] || SEVERITY_COLOR.menor} />
                  </div>
                  <span className="text-sm font-bold text-stone-700">{item.total}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Ranking de riesgo" subtitle={`Vigilancia reforzada a partir de ${fmt2(data.umbralVigilancia * 100)}%.`}>
          {data.riesgoRanking.length === 0 ? <EmptyState text="Aun no hay ranking de riesgo guardado para hoy." /> : (
            <div className="space-y-2">
              {data.riesgoRanking.map((item) => {
                const pct = Math.round(n(item.probabilidad_final) * 100)
                return (
                  <div key={item.id || item.product_presentation_id} className="rounded-2xl border border-stone-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-stone-800">{item.product_presentations?.display_name || item.product_presentations?.code}</p>
                        <p className="mt-1 text-xs text-stone-400">Score: {fmt2(item.score_riesgo)}</p>
                      </div>
                      <Badge label={`${pct}%`} color={pct >= 70 ? 'bg-red-100 text-red-700' : pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function InspectionsTab() {
  const [inspecciones, setInspecciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filtros, setFiltros] = useState({
    desde: new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10),
    hasta: new Date().toISOString().slice(0, 10),
    status: '',
    resultado: '',
    inspection_stage: '',
  })
  const [completeModal, setCompleteModal] = useState(null)
  const [createModal, setCreateModal] = useState(false)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getInspecciones(filtros)
      setInspecciones(data)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las inspecciones.')
    } finally {
      setLoading(false)
    }
  }, [filtros])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['inspecciones_calidad', 'quality_inspection_measurements', 'defectos_inspeccion', 'quality_non_conformities', 'finished_inventory_lots', 'material_inventory_lots', 'material_process_stage_outputs', 'processed_inventory_lots'], load)

  async function handleGenerateMuestreo() {
    setRunning(true)
    setError('')
    try {
      await ejecutarMuestreo()
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo ejecutar el muestreo.')
    } finally {
      setRunning(false)
    }
  }

  async function handleSaveInspection(id, payload) {
    await completarInspeccion(id, payload)
    setCompleteModal(null)
    await load()
  }

  async function handleRelease(inspection) {
    const reason = window.prompt('Motivo de liberacion manual')
    if (!reason) return
    await liberarLote(inspection.id, inspection.finished_lot_id, { reason })
    await load()
  }

  async function handleCancel(id) {
    if (!window.confirm('Cancelar esta inspeccion pendiente?')) return
    await cancelarInspeccion(id)
    await load()
  }

  const grouped = inspecciones.reduce((acc, item) => {
    if (!acc[item.fecha]) acc[item.fecha] = []
    acc[item.fecha].push(item)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <Card
        title="Cola operativa de inspecciones"
        subtitle="Pendientes de recepcion, proceso y empaque en una sola vista."
        actions={(
          <div className="flex flex-wrap gap-2">
            <button onClick={handleGenerateMuestreo} disabled={running} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">
              {running ? 'Generando...' : 'Generar muestreo'}
            </button>
            <button onClick={() => setCreateModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">
              Nueva inspeccion
            </button>
          </div>
        )}
      >
        <div className="grid gap-3 md:grid-cols-5">
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros((current) => ({ ...current, desde: e.target.value }))} className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none" />
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros((current) => ({ ...current, hasta: e.target.value }))} className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none" />
          <select value={filtros.inspection_stage} onChange={(e) => setFiltros((current) => ({ ...current, inspection_stage: e.target.value }))} className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none">
            <option value="">Todas las etapas</option>
            {QUALITY_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select value={filtros.status} onChange={(e) => setFiltros((current) => ({ ...current, status: e.target.value }))} className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none">
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="completada">Completada</option>
            <option value="cancelada">Cancelada</option>
          </select>
          <select value={filtros.resultado} onChange={(e) => setFiltros((current) => ({ ...current, resultado: e.target.value }))} className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none">
            <option value="">Todos los resultados</option>
            {RESULTADOS_CALIDAD.map((item) => <option key={item} value={item}>{RESULTADO_LABEL[item]}</option>)}
          </select>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {loading ? <Spinner /> : Object.keys(grouped).length === 0 ? <EmptyState text="No hay inspecciones en el rango seleccionado." /> : (
        Object.entries(grouped).map(([fecha, items]) => (
          <Card key={fecha} title={fecha}>
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-stone-100 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StageBadge stage={item.inspection_stage} />
                        <Badge label={item.status} color={STATUS_COLOR[item.status] || STATUS_COLOR.pendiente} />
                        {item.resultado ? <Badge label={RESULTADO_LABEL[item.resultado]} color={RESULTADO_COLOR[item.resultado]} /> : null}
                        {item.lote_bloqueado ? <Badge label="Bloqueado" color="bg-red-100 text-red-700" /> : null}
                        {item.non_conformity ? <Badge label={`NC ${item.non_conformity.status}`} color={NC_STATUS_COLOR[item.non_conformity.status] || NC_STATUS_COLOR.abierta} /> : null}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-stone-800">{item.source_label}</p>
                        <p className="mt-1 text-xs text-stone-400">
                          {item.spec_template?.name || 'Sin plantilla'}
                          {item.unidades_inspeccionadas ? ` · ${item.unidades_inspeccionadas} unds` : ''}
                          {item.tasa_defectos != null ? ` · ${fmt2(item.tasa_defectos)}% defectos` : ''}
                        </p>
                        {item.observaciones ? <p className="mt-1 text-xs italic text-stone-500">{item.observaciones}</p> : null}
                      </div>
                      {(item.defectos_inspeccion || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.defectos_inspeccion.map((defecto, index) => (
                            <span key={`${item.id}-${index}`} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_COLOR[defecto.nivel] || SEVERITY_COLOR.menor}`}>
                              {defecto.tipo_defecto} x{defecto.cantidad}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.status === 'pendiente' ? (
                        <>
                          <button onClick={() => setCompleteModal(item)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">Inspeccionar</button>
                          <button onClick={() => handleCancel(item.id)} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50">Cancelar</button>
                        </>
                      ) : null}
                      {item.lote_bloqueado ? (
                        <button onClick={() => handleRelease(item)} className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
                          Liberar manualmente
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      {createModal ? <CreateInspectionModal onClose={() => setCreateModal(false)} onCreated={async () => { setCreateModal(false); await load() }} /> : null}
      {completeModal ? <CompleteInspectionModal inspeccion={completeModal} onClose={() => setCompleteModal(null)} onSaved={handleSaveInspection} /> : null}
    </div>
  )
}

function NonConformitiesTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [stage, setStage] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getNonConformities({ status, inspection_stage: stage })
      setRows(data)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las no conformidades.')
    } finally {
      setLoading(false)
    }
  }, [status, stage])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['quality_non_conformities', 'quality_corrective_actions', 'inspecciones_calidad'], load)

  async function handleSave(id, payload) {
    await updateNonConformity(id, payload)
    setEditing(null)
    await load()
  }

  return (
    <div className="space-y-4">
      <Card title="No conformidades y CAPA" subtitle="Seguimiento de disposiciones, causa raiz y acciones correctivas.">
        <div className="grid gap-3 md:grid-cols-2">
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none">
            <option value="">Todas las etapas</option>
            {QUALITY_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none">
            <option value="">Todos los estados</option>
            <option value="abierta">Abierta</option>
            <option value="en_investigacion">En investigacion</option>
            <option value="accion_en_curso">Accion en curso</option>
            <option value="cerrada">Cerrada</option>
            <option value="vencida">Vencida</option>
          </select>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <Spinner /> : rows.length === 0 ? <EmptyState text="No hay no conformidades para el filtro actual." /> : (
        <div className="space-y-3">
          {rows.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StageBadge stage={item.inspection_stage} />
                    <Badge label={item.status} color={NC_STATUS_COLOR[item.status] || NC_STATUS_COLOR.abierta} />
                    <Badge label={item.severity} color={SEVERITY_COLOR[item.severity] || SEVERITY_COLOR.menor} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-stone-800">{item.title}</p>
                    <p className="mt-1 text-xs text-stone-400">{item.inspection?.source_label || item.defect_detected}</p>
                    {item.due_date ? <p className="mt-1 text-xs text-stone-400">Compromiso: {item.due_date}</p> : null}
                  </div>
                  <div className="grid gap-1 text-xs text-stone-500">
                    <p><span className="font-semibold text-stone-700">Disposicion:</span> {item.immediate_disposition}</p>
                    {item.root_cause ? <p><span className="font-semibold text-stone-700">Causa raiz:</span> {item.root_cause}</p> : null}
                    {item.corrective_action ? <p><span className="font-semibold text-stone-700">Correctiva:</span> {item.corrective_action}</p> : null}
                    {item.preventive_action ? <p><span className="font-semibold text-stone-700">Preventiva:</span> {item.preventive_action}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setEditing(item)} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50">Actualizar</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing ? <NonConformityModal item={editing} onClose={() => setEditing(null)} onSaved={handleSave} /> : null}
    </div>
  )
}

function SpecsTab() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [templateForm, setTemplateForm] = useState({
    inspection_stage: 'recepcion_mp',
    name: '',
    description: '',
  })
  const [ruleForm, setRuleForm] = useState({
    template_id: '',
    sort_order: 99,
    code: '',
    label: '',
    measurement_type: 'numeric',
    unit: '',
    min_value: '',
    max_value: '',
    expected_boolean: '',
    allowed_values_text: '',
    defect_threshold: '',
    severity: 'menor',
    decision_effect: 'liberado_con_observacion',
  })
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savingRule, setSavingRule] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getSpecTemplates()
      setTemplates(data)
      if (data.length && !ruleForm.template_id) {
        setRuleForm((current) => ({ ...current, template_id: data[0].id }))
      }
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las especificaciones.')
    } finally {
      setLoading(false)
    }
  }, [ruleForm.template_id])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['quality_spec_templates', 'quality_spec_rules'], load)

  async function handleSaveTemplate() {
    setSavingTemplate(true)
    setError('')
    try {
      await saveSpecTemplate(templateForm)
      setTemplateForm({ inspection_stage: 'recepcion_mp', name: '', description: '' })
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo guardar la plantilla.')
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleSaveRule() {
    setSavingRule(true)
    setError('')
    try {
      await saveSpecRule(ruleForm.template_id, {
        ...ruleForm,
        allowed_values: ruleForm.allowed_values_text
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      })
      setRuleForm((current) => ({
        ...current,
        code: '',
        label: '',
        unit: '',
        min_value: '',
        max_value: '',
        expected_boolean: '',
        allowed_values_text: '',
        defect_threshold: '',
      }))
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el criterio.')
    } finally {
      setSavingRule(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card title="Plantillas por etapa" subtitle="Catalogo base de especificaciones y tolerancias.">
          {loading ? <Spinner /> : templates.length === 0 ? <EmptyState text="Aun no hay plantillas." /> : (
            <div className="space-y-4">
              {templates.map((template) => (
                <div key={template.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StageBadge stage={template.inspection_stage} />
                    <p className="text-sm font-semibold text-stone-800">{template.name}</p>
                  </div>
                  {template.description ? <p className="mt-2 text-sm text-stone-500">{template.description}</p> : null}
                  <div className="mt-3 space-y-2">
                    {(template.rules || []).map((rule) => (
                      <div key={rule.id} className="rounded-2xl bg-stone-50 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-stone-800">{rule.label}</p>
                            <p className="text-xs text-stone-400">
                              {rule.measurement_type}
                              {rule.unit ? ` · ${rule.unit}` : ''}
                              {rule.min_value != null ? ` · Min ${rule.min_value}` : ''}
                              {rule.max_value != null ? ` · Max ${rule.max_value}` : ''}
                              {rule.defect_threshold != null ? ` · Umbral ${rule.defect_threshold}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge label={rule.severity} color={SEVERITY_COLOR[rule.severity] || SEVERITY_COLOR.menor} />
                            <Badge label={RESULTADO_LABEL[rule.decision_effect]} color={RESULTADO_COLOR[rule.decision_effect]} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Nueva plantilla">
            <div className="space-y-3">
              <select value={templateForm.inspection_stage} onChange={(e) => setTemplateForm((current) => ({ ...current, inspection_stage: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                {QUALITY_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
              <input value={templateForm.name} onChange={(e) => setTemplateForm((current) => ({ ...current, name: e.target.value }))} placeholder="Nombre de plantilla" className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              <textarea rows={3} value={templateForm.description} onChange={(e) => setTemplateForm((current) => ({ ...current, description: e.target.value }))} placeholder="Descripcion" className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              <button onClick={handleSaveTemplate} disabled={savingTemplate} className="w-full rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
                {savingTemplate ? 'Guardando...' : 'Crear plantilla'}
              </button>
            </div>
          </Card>

          <Card title="Nuevo criterio">
            <div className="space-y-3">
              <select value={ruleForm.template_id} onChange={(e) => setRuleForm((current) => ({ ...current, template_id: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                <option value="">Seleccionar plantilla...</option>
                {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={ruleForm.code} onChange={(e) => setRuleForm((current) => ({ ...current, code: e.target.value }))} placeholder="Codigo" className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
                <input value={ruleForm.label} onChange={(e) => setRuleForm((current) => ({ ...current, label: e.target.value }))} placeholder="Nombre del criterio" className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={ruleForm.measurement_type} onChange={(e) => setRuleForm((current) => ({ ...current, measurement_type: e.target.value }))} className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                  <option value="numeric">Numerico</option>
                  <option value="boolean">Booleano</option>
                  <option value="select">Texto controlado</option>
                  <option value="defect_count">Conteo de defectos</option>
                </select>
                <input value={ruleForm.unit} onChange={(e) => setRuleForm((current) => ({ ...current, unit: e.target.value }))} placeholder="Unidad" className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input type="number" step="0.01" value={ruleForm.min_value} onChange={(e) => setRuleForm((current) => ({ ...current, min_value: e.target.value }))} placeholder="Minimo" className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
                <input type="number" step="0.01" value={ruleForm.max_value} onChange={(e) => setRuleForm((current) => ({ ...current, max_value: e.target.value }))} placeholder="Maximo" className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              </div>
              {ruleForm.measurement_type === 'boolean' ? (
                <select value={ruleForm.expected_boolean} onChange={(e) => setRuleForm((current) => ({ ...current, expected_boolean: e.target.value }))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                  <option value="">Esperado...</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : null}
              {ruleForm.measurement_type === 'select' ? (
                <input value={ruleForm.allowed_values_text} onChange={(e) => setRuleForm((current) => ({ ...current, allowed_values_text: e.target.value }))} placeholder="Valores permitidos separados por coma" className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              ) : null}
              {ruleForm.measurement_type === 'defect_count' ? (
                <input type="number" min="0" value={ruleForm.defect_threshold} onChange={(e) => setRuleForm((current) => ({ ...current, defect_threshold: e.target.value }))} placeholder="Umbral maximo" className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={ruleForm.severity} onChange={(e) => setRuleForm((current) => ({ ...current, severity: e.target.value }))} className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                  <option value="menor">Menor</option>
                  <option value="mayor">Mayor</option>
                  <option value="critico">Critico</option>
                </select>
                <select value={ruleForm.decision_effect} onChange={(e) => setRuleForm((current) => ({ ...current, decision_effect: e.target.value }))} className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                  <option value="liberado_con_observacion">Observacion</option>
                  <option value="retenido">Retener</option>
                  <option value="rechazado">Rechazar</option>
                </select>
              </div>
              <button onClick={handleSaveRule} disabled={savingRule || !ruleForm.template_id} className="w-full rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
                {savingRule ? 'Guardando...' : 'Crear criterio'}
              </button>
            </div>
          </Card>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </div>
  )
}

function ConfigTab() {
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getConfiguracion().then(setConfig).catch((err) => setError(err.message || 'No se pudo cargar la configuracion.'))
  }, [])

  function setValue(field, value) {
    setConfig((current) => ({ ...current, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await saveConfiguracion(config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la configuracion.')
    } finally {
      setSaving(false)
    }
  }

  if (!config) return <Spinner />

  const NumField = ({ label, field, help, step = 0.01, min = 0, max = 1 }) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-stone-700">{label}</label>
      {help ? <p className="mb-1.5 text-xs text-stone-400">{help}</p> : null}
      <input type="number" step={step} min={min} max={max} value={config[field]} onChange={(e) => setValue(field, Number(e.target.value))} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
    </div>
  )

  const IntField = ({ label, field, help, min = 1, max = 365 }) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-stone-700">{label}</label>
      {help ? <p className="mb-1.5 text-xs text-stone-400">{help}</p> : null}
      <input type="number" min={min} max={max} step="1" value={config[field]} onChange={(e) => setValue(field, parseInt(e.target.value, 10) || 0)} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
    </div>
  )

  return (
    <div className="max-w-4xl space-y-6">
      <Card title="Parametros base" subtitle="Probabilidad, tamanio de muestra y umbral de vigilancia.">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumField field="probabilidad_base" label="Probabilidad base" help="Probabilidad inicial de cualquier SKU" />
          <NumField field="probabilidad_minima" label="Probabilidad minima" help="Piso del motor" />
          <NumField field="probabilidad_maxima" label="Probabilidad maxima" help="Techo del motor" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <IntField field="tamano_muestra_base" label="Tamanio de muestra" help="Unidades por muestreo" min={1} max={100} />
          <NumField field="umbral_vigilancia" label="Umbral vigilancia reforzada" help="A partir de este % el SKU aparece destacado" />
        </div>
      </Card>

      <Card title="Ponderacion por historial">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField field="peso_reclamos" label="Peso por reclamo" help="Incremento por cada reclamo en la ventana" />
          <NumField field="peso_no_conformidades" label="Peso por no conformidad" help="Incremento por resultados no liberados" />
        </div>
      </Card>

      <Card title="Ajustes por resultado reciente">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumField field="ajuste_rechazo" label="Ajuste rechazo/retenido" help="Suma si el ultimo resultado fue grave" />
          <NumField field="ajuste_observacion" label="Ajuste observacion" help="Suma si el ultimo resultado fue con observacion" />
          <NumField field="ajuste_limpio" label="Reduccion liberado" help="Resta si el historial reciente viene limpio" />
        </div>
      </Card>

      <Card title="Ventanas de analisis">
        <div className="grid gap-4 sm:grid-cols-2">
          <IntField field="ventana_reclamos" label="Ventana reclamos (dias)" help="Dias hacia atras para reclamos" />
          <IntField field="ventana_resultados" label="Ventana resultados (dias)" help="Dias hacia atras para inspecciones" />
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {saved ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">Configuracion guardada correctamente.</div> : null}

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="rounded-2xl bg-[#2f5d50] px-6 py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar configuracion'}
        </button>
      </div>
    </div>
  )
}

export default function CalidadPage() {
  const [tab, setTab] = useState('dashboard')
  const hoyStr = new Date().toLocaleDateString('es-GT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Control operativo de calidad</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900">Calidad</h1>
          <p className="mt-1 text-sm capitalize text-stone-500">{hoyStr}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-stone-200 bg-white p-1 w-fit">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              tab === item.key ? 'bg-[#2f5d50] text-white shadow-sm' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' ? <DashboardTab onGoToInspections={() => setTab('inspecciones')} /> : null}
      {tab === 'inspecciones' ? <InspectionsTab /> : null}
      {tab === 'no_conformidades' ? <NonConformitiesTab /> : null}
      {tab === 'especificaciones' ? <SpecsTab /> : null}
      {tab === 'configuracion' ? <ConfigTab /> : null}
    </div>
  )
}
