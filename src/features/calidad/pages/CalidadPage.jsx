import { useEffect, useState, useCallback } from 'react'
import {
  getConfiguracion, saveConfiguracion,
  getInspecciones, completarInspeccion, cancelarInspeccion, liberarLote,
  getDashboardCalidad, getSkusEmpacadosHoy,
} from '../services/calidadService'
import { ejecutarMuestreo, getRankingRiesgo, agregarMuestreoManual } from '../services/muestreoService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { return Number(v || 0) }
function fmt2(v) { return n(v).toFixed(2) }

const RESULTADO_LABEL = {
  liberado:                 'Liberado',
  liberado_con_observacion: 'Con observación',
  retenido:                 'Retenido',
  rechazado:                'Rechazado',
}
const RESULTADO_COLOR = {
  liberado:                 'bg-emerald-100 text-emerald-700',
  liberado_con_observacion: 'bg-amber-100 text-amber-700',
  retenido:                 'bg-orange-100 text-orange-700',
  rechazado:                'bg-red-100 text-red-700',
}
const STATUS_COLOR = {
  pendiente:   'bg-blue-100 text-blue-700',
  en_proceso:  'bg-purple-100 text-purple-700',
  completada:  'bg-emerald-100 text-emerald-700',
  cancelada:   'bg-stone-100 text-stone-500',
}
const NIVEL_DEFECTO = ['menor', 'mayor', 'critico']
const NIVEL_COLOR   = {
  menor:   'bg-stone-100 text-stone-600',
  mayor:   'bg-orange-100 text-orange-700',
  critico: 'bg-red-100 text-red-700',
}

// ─── UI primitivos ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-[#2f5d50]" />
    </div>
  )
}

function Badge({ label, color }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>{label}</span>
}

function KPICard({ label, value, sub, accent, warn }) {
  let cls = 'bg-white border-stone-200'
  if (accent) cls = 'bg-[#2f5d50] border-[#2f5d50]'
  if (warn)   cls = 'bg-red-600 border-red-600'
  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${cls}`}>
      <p className={`text-xs font-semibold uppercase tracking-widest ${accent || warn ? 'text-white/70' : 'text-stone-400'}`}>{label}</p>
      <p className={`mt-2 text-3xl font-bold tracking-tight ${accent || warn ? 'text-white' : 'text-stone-900'}`}>{value}</p>
      {sub && <p className={`mt-1 text-xs ${accent || warn ? 'text-white/60' : 'text-stone-400'}`}>{sub}</p>}
    </div>
  )
}

function RiskBar({ value }) {
  const pct = Math.min(100, Math.round(n(value) * 100))
  const color = pct >= 70 ? 'bg-red-400' : pct >= 50 ? 'bg-amber-400' : 'bg-[#2f5d50]'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-8 text-right text-xs font-bold ${pct >= 70 ? 'text-red-600' : pct >= 50 ? 'text-amber-600' : 'text-stone-700'}`}>
        {pct}%
      </span>
    </div>
  )
}

// ─── Modal: Completar Inspección ──────────────────────────────────────────────

function CompletarModal({ inspeccion, onClose, onSave }) {
  const [form, setForm] = useState({
    resultado:               'liberado',
    unidades_inspeccionadas: inspeccion?.tamano_muestra || 5,
    unidades_defectuosas:    0,
    observaciones:           '',
  })
  const [defectos,      setDefectos]      = useState([])
  const [nuevoDefecto,  setNuevoDefecto]  = useState({ tipo_defecto: '', cantidad: 1, nivel: 'menor' })
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  // Sumar defectos → unidades defectuosas automáticamente
  useEffect(() => {
    const total = defectos.reduce((s, d) => s + n(d.cantidad), 0)
    setForm(f => ({ ...f, unidades_defectuosas: total }))
  }, [defectos])

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addDefecto() {
    if (!nuevoDefecto.tipo_defecto.trim()) return
    setDefectos(d => [...d, { ...nuevoDefecto }])
    setNuevoDefecto({ tipo_defecto: '', cantidad: 1, nivel: 'menor' })
  }

  function setND(k, v) { setNuevoDefecto(d => ({ ...d, [k]: v })) }

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await onSave(inspeccion.id, {
        ...form,
        unidades_inspeccionadas: n(form.unidades_inspeccionadas),
        unidades_defectuosas:    n(form.unidades_defectuosas),
        defectos,
      })
    } catch (e) { setError(e.message); setSaving(false) }
  }

  const sku = inspeccion?.product_presentations
  const lot = inspeccion?.finished_inventory_lots

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-xl">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-stone-900">Completar inspección</h2>
            <p className="text-sm text-stone-500">
              {sku?.display_name || sku?.code}
              {lot ? ` · Lote ${lot.finished_lot_code}` : ''}
              {inspeccion?.tamano_muestra ? ` · ${inspeccion.tamano_muestra} unds` : ''}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100 text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-5">

          {/* Resultado */}
          <div>
            <p className="mb-2 text-sm font-semibold text-stone-700">Resultado *</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(RESULTADO_LABEL).map(([val, lbl]) => {
                const activeColor =
                  val === 'liberado'                 ? 'bg-emerald-500 border-emerald-500 text-white' :
                  val === 'liberado_con_observacion' ? 'bg-amber-500 border-amber-500 text-white' :
                  val === 'retenido'                 ? 'bg-orange-500 border-orange-500 text-white' :
                                                      'bg-red-500 border-red-500 text-white'
                return (
                  <button key={val} onClick={() => setF('resultado', val)}
                    className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                      form.resultado === val ? activeColor : 'border-stone-200 text-stone-600 hover:border-stone-300 bg-white'
                    }`}>
                    {lbl}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Unidades */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block mb-1 text-sm font-medium text-stone-700">Unidades inspeccionadas</label>
              <input type="number" min="1" value={form.unidades_inspeccionadas}
                onChange={e => setF('unidades_inspeccionadas', e.target.value)}
                className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium text-stone-700">Unidades defectuosas</label>
              <input type="number" min="0" value={form.unidades_defectuosas}
                onChange={e => setF('unidades_defectuosas', e.target.value)}
                className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
            </div>
          </div>

          {/* Defectos */}
          <div>
            <p className="mb-2 text-sm font-semibold text-stone-700">Defectos encontrados</p>
            <div className="rounded-2xl border border-stone-200 p-3 space-y-2">
              {defectos.length === 0 && (
                <p className="py-2 text-center text-xs text-stone-400">Sin defectos registrados</p>
              )}
              {defectos.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge label={d.nivel} color={NIVEL_COLOR[d.nivel]} />
                    <span className="font-medium text-stone-800">{d.tipo_defecto}</span>
                    <span className="text-stone-400">×{d.cantidad}</span>
                  </div>
                  <button onClick={() => setDefectos(prev => prev.filter((_, j) => j !== i))}
                    className="text-stone-300 hover:text-red-400 text-lg leading-none">×</button>
                </div>
              ))}
              {/* Agregar defecto */}
              <div className="flex gap-2 pt-1">
                <input placeholder="Tipo de defecto" value={nuevoDefecto.tipo_defecto}
                  onChange={e => setND('tipo_defecto', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addDefecto()}
                  className="flex-1 rounded-xl border border-stone-200 px-3 py-2 text-xs focus:border-[#2f5d50] focus:outline-none" />
                <input type="number" min="1" value={nuevoDefecto.cantidad}
                  onChange={e => setND('cantidad', n(e.target.value))}
                  className="w-14 rounded-xl border border-stone-200 px-2 py-2 text-xs focus:border-[#2f5d50] focus:outline-none" />
                <select value={nuevoDefecto.nivel} onChange={e => setND('nivel', e.target.value)}
                  className="rounded-xl border border-stone-200 px-2 py-2 text-xs focus:border-[#2f5d50] focus:outline-none">
                  {NIVEL_DEFECTO.map(nv => <option key={nv} value={nv}>{nv}</option>)}
                </select>
                <button onClick={addDefecto}
                  className="rounded-xl bg-[#2f5d50] px-3 py-2 text-xs font-bold text-white hover:bg-[#264c42]">+</button>
              </div>
            </div>
          </div>

          {/* Observaciones */}
          <div>
            <label className="block mb-1 text-sm font-medium text-stone-700">Observaciones</label>
            <textarea rows={3} value={form.observaciones}
              onChange={e => setF('observaciones', e.target.value)}
              placeholder="Describe los hallazgos de la inspección..."
              className="w-full resize-none rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
          </div>

          {/* Aviso bloqueo */}
          {['retenido', 'rechazado'].includes(form.resultado) && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠ Este resultado <strong>bloqueará el lote</strong> asociado e impedirá su despacho hasta liberación manual.
            </div>
          )}

          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-stone-100 bg-white px-6 py-4">
          <button onClick={onClose}
            className="rounded-2xl border border-stone-200 px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-2xl bg-[#2f5d50] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar resultado'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Muestreo manual ───────────────────────────────────────────────────

function MuestreoManualModal({ skusHoy, onClose, onSave }) {
  const [skuId,  setSkuId]  = useState('')
  const [lotId,  setLotId]  = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const skuSeleccionado = skusHoy.find(s => s.product_presentation_id === skuId)
  const lotes           = skuSeleccionado?.lotes || []

  async function handleSave() {
    if (!skuId) { setError('Selecciona un SKU'); return }
    setSaving(true); setError('')
    try {
      await onSave(skuId, lotId || null)
      onClose()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
          <h2 className="text-lg font-bold text-stone-900">Agregar muestreo manual</h2>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-stone-700">SKU *</label>
            <select value={skuId} onChange={e => { setSkuId(e.target.value); setLotId('') }}
              className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
              <option value="">Seleccionar SKU...</option>
              {skusHoy.map(s => (
                <option key={s.product_presentation_id} value={s.product_presentation_id}>
                  {s.sku?.code} — {s.sku?.display_name}
                </option>
              ))}
            </select>
          </div>
          {lotes.length > 0 && (
            <div>
              <label className="block mb-1 text-sm font-medium text-stone-700">Lote (opcional)</label>
              <select value={lotId} onChange={e => setLotId(e.target.value)}
                className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none">
                <option value="">Sin lote específico</option>
                {lotes.map(l => (
                  <option key={l.id} value={l.id}>{l.finished_lot_code}{l.bloqueado_calidad ? ' 🔒' : ''}</option>
                ))}
              </select>
            </div>
          )}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-3 border-t border-stone-100 px-6 py-4">
          <button onClick={onClose}
            className="rounded-2xl border border-stone-200 px-5 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-2xl bg-[#2f5d50] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Creando...' : 'Crear inspección'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Dashboard ───────────────────────────────────────────────────────────

function TabDashboard({ onTabChange }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    setLoading(true)
    getDashboardCalidad()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />
  if (error)   return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
  if (!data)   return null

  const { hoy, stats30, trend, riesgoRanking, enVigilancia, lotesBlockeados, histReciente, umbralVigilancia } = data

  return (
    <div className="space-y-6">

      {/* Lotes bloqueados */}
      {lotesBlockeados.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="mb-1.5 text-sm font-bold text-red-800">🔒 {lotesBlockeados.length} lote(s) bloqueado(s) por calidad</p>
          <div className="flex flex-wrap gap-2">
            {lotesBlockeados.map(l => (
              <span key={l.id} className="rounded-full bg-red-100 px-3 py-0.5 text-xs font-semibold text-red-700">
                {l.product_presentations?.code} · {l.finished_lot_code}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard
          label="Muestreos hoy"
          value={hoy.total}
          sub={`${hoy.pendientes} pendientes · ${hoy.completadas} completadas`}
          accent
        />
        <KPICard
          label="Rechazos hoy"
          value={hoy.rechazadas}
          sub={hoy.rechazadas > 0 ? 'Lotes bloqueados' : 'Sin rechazos'}
          warn={hoy.rechazadas > 0}
        />
        <KPICard
          label="Inspecciones 30d"
          value={stats30.total}
          sub={`${stats30.rechazadas} rechaz. · ${stats30.retenidas} reten.`}
        />
        <KPICard
          label="Tasa de rechazo 30d"
          value={`${stats30.tasaRechazo}%`}
          sub={stats30.total > 0 ? `${stats30.rechazadas} de ${stats30.total}` : 'Sin datos'}
          warn={stats30.tasaRechazo > 10}
        />
      </div>

      {/* Trend + Vigilancia */}
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">

        {/* Tendencia 14 días */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Tendencia de calidad</p>
          <h3 className="mt-1 mb-4 text-lg font-bold text-stone-800">Inspecciones últimos 14 días</h3>
          <div className="flex items-end gap-1 h-20">
            {trend.map(d => {
              const maxVal = Math.max(...trend.map(t => t.total), 1)
              const h = (d.total / maxVal) * 100
              return (
                <div key={d.fecha} className="group relative flex flex-1 flex-col justify-end" style={{ height: '100%' }}>
                  {d.total > 0 ? (
                    <div className="w-full flex flex-col justify-end rounded-t overflow-hidden" style={{ height: `${Math.max(h, 8)}%` }}>
                      {d.rechazados > 0 && (
                        <div className="w-full bg-red-400" style={{ height: `${(d.rechazados / d.total) * 100}%`, minHeight: 4 }} />
                      )}
                      {d.retenidos > 0 && (
                        <div className="w-full bg-amber-400" style={{ height: `${(d.retenidos / d.total) * 100}%`, minHeight: 4 }} />
                      )}
                      {d.observaciones > 0 && (
                        <div className="w-full bg-yellow-300" style={{ height: `${(d.observaciones / d.total) * 100}%`, minHeight: 4 }} />
                      )}
                      <div className="w-full flex-1 bg-[#2f5d50]" style={{ minHeight: 4 }} />
                    </div>
                  ) : (
                    <div className="w-full rounded bg-stone-100" style={{ height: 4 }} />
                  )}
                  {d.total > 0 && (
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex whitespace-nowrap rounded-lg bg-stone-800 px-2 py-1 text-xs text-white shadow z-10">
                      {d.fecha.slice(5)} · {d.total}{d.rechazados > 0 ? ` · ${d.rechazados}R` : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex justify-between text-xs text-stone-300">
            <span>{trend[0]?.fecha.slice(5)}</span>
            <span>{trend[trend.length - 1]?.fecha.slice(5)}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-stone-500">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[#2f5d50]" /> Liberado</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-yellow-300" /> Observación</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-amber-400" /> Retenido</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-red-400" /> Rechazado</span>
          </div>
        </div>

        {/* SKUs en vigilancia */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Control de riesgo</p>
          <h3 className="mt-1 mb-4 text-lg font-bold text-stone-800">
            SKUs en vigilancia
            <span className="ml-2 text-xs font-normal text-stone-400">(≥ {Math.round(umbralVigilancia * 100)}%)</span>
          </h3>
          {enVigilancia.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
              ✓ Sin SKUs en vigilancia reforzada
            </div>
          ) : (
            <div className="space-y-2.5">
              {enVigilancia.slice(0, 7).map(r => (
                <div key={r.product_presentation_id || r.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-sm font-semibold text-stone-800">{r.product_presentations?.code}</span>
                      {r.ultimo_resultado && (
                        <Badge label={RESULTADO_LABEL[r.ultimo_resultado] || r.ultimo_resultado}
                          color={RESULTADO_COLOR[r.ultimo_resultado] || 'bg-stone-100 text-stone-600'} />
                      )}
                    </div>
                  </div>
                  <RiskBar value={r.probabilidad_final} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ranking + Historial */}
      <div className="grid gap-5 xl:grid-cols-2">

        {/* Ranking completo */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Muestreo inteligente</p>
              <h3 className="text-lg font-bold text-stone-800">Ranking de riesgo por SKU</h3>
            </div>
            <button onClick={() => onTabChange('muestreos')}
              className="rounded-2xl border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">
              Ir a muestreos →
            </button>
          </div>
          {riesgoRanking.length === 0 ? (
            <p className="text-sm text-stone-400">Ejecuta el motor de muestreo para generar el ranking.</p>
          ) : (
            <div className="space-y-2.5">
              {riesgoRanking.slice(0, 8).map((r, idx) => (
                <div key={r.product_presentation_id || r.id} className="flex items-center gap-3">
                  <span className="w-4 shrink-0 text-xs font-bold text-stone-400">{idx + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-0.5">
                      <span className="text-sm font-medium text-stone-800">{r.product_presentations?.code}</span>
                      {r.seleccionado && (
                        <span className="rounded-full bg-[#2f5d50]/10 px-2 py-0.5 text-xs font-semibold text-[#2f5d50]">seleccionado</span>
                      )}
                    </div>
                    <RiskBar value={r.probabilidad_final} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inspecciones recientes */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Historial reciente</p>
              <h3 className="text-lg font-bold text-stone-800">Últimas inspecciones</h3>
            </div>
            <button onClick={() => onTabChange('inspecciones')}
              className="rounded-2xl border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">
              Ver todas →
            </button>
          </div>
          {histReciente.length === 0 ? (
            <p className="text-sm text-stone-400">Sin inspecciones completadas aún.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs text-stone-400">
                    <th className="pb-2 font-semibold">Fecha</th>
                    <th className="pb-2 font-semibold">SKU</th>
                    <th className="pb-2 font-semibold">Resultado</th>
                    <th className="pb-2 font-semibold text-right">Def%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {histReciente.map(i => (
                    <tr key={i.id}>
                      <td className="py-2 text-stone-500">{i.fecha}</td>
                      <td className="py-2 font-medium text-stone-800">{i.product_presentations?.code}</td>
                      <td className="py-2">
                        {i.resultado && <Badge label={RESULTADO_LABEL[i.resultado]} color={RESULTADO_COLOR[i.resultado]} />}
                      </td>
                      <td className="py-2 text-right text-stone-500">
                        {i.tasa_defectos != null ? `${fmt2(i.tasa_defectos)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Muestreos del día ───────────────────────────────────────────────────

function TabMuestreos() {
  const [inspeccionesHoy, setInspeccionesHoy] = useState([])
  const [skusHoy,         setSkusHoy]         = useState([])
  const [ranking,         setRanking]         = useState([])
  const [loading,         setLoading]         = useState(true)
  const [running,         setRunning]         = useState(false)
  const [resultado,       setResultado]       = useState(null)
  const [error,           setError]           = useState('')
  const [completarModal,  setCompletarModal]  = useState(null)
  const [manualModal,     setManualModal]     = useState(false)
  const [showRanking,     setShowRanking]     = useState(false)

  const hoy = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [hoyData, skus, rank] = await Promise.all([
        getInspecciones({ fecha: hoy }),
        getSkusEmpacadosHoy(),
        getRankingRiesgo(),
      ])
      setInspeccionesHoy(hoyData)
      setSkusHoy(skus)
      setRanking(rank)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [hoy])

  useEffect(() => { load() }, [load])

  async function handleEjecutar() {
    setRunning(true); setError(''); setResultado(null)
    try {
      const res = await ejecutarMuestreo()
      setResultado(res)
      await load()
    } catch (e) { setError(e.message) }
    finally { setRunning(false) }
  }

  async function handleCompletar(id, data) {
    await completarInspeccion(id, data)
    setCompletarModal(null)
    await load()
  }

  async function handleCancelar(id) {
    if (!confirm('¿Cancelar esta inspección?')) return
    await cancelarInspeccion(id)
    await load()
  }

  async function handleManual(skuId, lotId) {
    await agregarMuestreoManual(skuId, lotId)
    await load()
  }

  const pendientes  = inspeccionesHoy.filter(i => i.status === 'pendiente')
  const completadas = inspeccionesHoy.filter(i => i.status === 'completada')
  const canceladas  = inspeccionesHoy.filter(i => i.status === 'cancelada')

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">

      {/* Motor */}
      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Motor de selección</p>
            <h3 className="mt-1 text-lg font-bold text-stone-800">Muestreo aleatorio inteligente — {hoy}</h3>
            <p className="mt-1 text-sm text-stone-500">
              {skusHoy.length} SKU(s) empacado(s) hoy disponibles · {inspeccionesHoy.filter(i => i.origen === 'muestreo' && i.status !== 'cancelada').length} muestreo(s) generado(s)
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowRanking(r => !r)}
              className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
              {showRanking ? 'Ocultar ranking' : 'Ver ranking'}
            </button>
            <button onClick={() => setManualModal(true)} disabled={skusHoy.length === 0}
              className="rounded-2xl border border-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-[#2f5d50] hover:bg-[#2f5d50]/5 disabled:opacity-40">
              + Manual
            </button>
            <button onClick={handleEjecutar} disabled={running || skusHoy.length === 0}
              className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {running ? 'Ejecutando...' : 'Generar muestreo'}
            </button>
          </div>
        </div>

        {resultado && (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-medium ${
            resultado.seleccionados.length > 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-stone-200 bg-stone-50 text-stone-600'
          }`}>
            ✓ {resultado.mensaje}
          </div>
        )}
        {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      </div>

      {/* Ranking de probabilidades */}
      {showRanking && (
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm font-bold text-stone-700">Probabilidad de selección por SKU</p>
          {ranking.length === 0 ? (
            <p className="text-sm text-stone-400">Sin datos. Ejecuta el motor para calcular probabilidades.</p>
          ) : (
            <div className="space-y-3">
              {ranking.slice(0, 12).map((r, idx) => {
                const sku = r.sku || r.product_presentations
                return (
                  <div key={r.product_presentation_id || r.id} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-xs font-bold text-stone-400">{idx + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-stone-800">{sku?.code}</span>
                        <div className="flex items-center gap-2">
                          {r.ultimo_resultado && (
                            <Badge label={RESULTADO_LABEL[r.ultimo_resultado] || r.ultimo_resultado}
                              color={RESULTADO_COLOR[r.ultimo_resultado] || ''} />
                          )}
                          {r.reclamos_usados > 0 && (
                            <span className="text-xs text-red-500 font-semibold">{r.reclamos_usados} recl.</span>
                          )}
                        </div>
                      </div>
                      <RiskBar value={r.probabilidad_final} />
                      <div className="mt-0.5 flex gap-3 text-xs text-stone-400">
                        {r.ajuste_resultado !== 0 && (
                          <span>ajuste: {r.ajuste_resultado > 0 ? '+' : ''}{Math.round(r.ajuste_resultado * 100)}%</span>
                        )}
                        <span>{r.resultados_usados} inspect. usadas</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Pendientes */}
      {pendientes.length > 0 && (
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pendientes de ejecución</p>
          <h3 className="mt-1 mb-4 text-lg font-bold text-stone-800">{pendientes.length} inspección(es) pendiente(s)</h3>
          <div className="space-y-3">
            {pendientes.map(i => (
              <div key={i.id} className="flex items-center justify-between rounded-2xl border border-stone-100 bg-stone-50 px-5 py-3.5">
                <div>
                  <p className="font-semibold text-stone-800">
                    {i.product_presentations?.display_name || i.product_presentations?.code}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-stone-400">
                    <span className="capitalize">{i.origen}</span>
                    {i.finished_inventory_lots && <span>· Lote {i.finished_inventory_lots.finished_lot_code}</span>}
                    <span>· {i.tamano_muestra} unds a inspeccionar</span>
                    <span className="font-semibold text-stone-600">· Riesgo: {Math.round(n(i.probabilidad_usada) * 100)}%</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleCancelar(i.id)}
                    className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-500 hover:bg-stone-100">
                    Cancelar
                  </button>
                  <button onClick={() => setCompletarModal(i)}
                    className="rounded-xl bg-[#2f5d50] px-4 py-2 text-xs font-semibold text-white hover:bg-[#264c42]">
                    Inspeccionar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completadas hoy */}
      {completadas.length > 0 && (
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="mb-3 text-sm font-bold text-stone-700">Completadas hoy ({completadas.length})</p>
          <div className="space-y-2">
            {completadas.map(i => (
              <div key={i.id} className="flex items-center justify-between rounded-2xl bg-stone-50 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-stone-800">{i.product_presentations?.code}</p>
                  <p className="text-xs text-stone-400">
                    {i.unidades_inspeccionadas} unds · {fmt2(i.tasa_defectos ?? 0)}% defectos
                    {i.observaciones ? ` · ${i.observaciones.slice(0, 60)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {i.lote_bloqueado && <span className="text-xs font-semibold text-red-500">🔒 lote</span>}
                  {i.resultado && <Badge label={RESULTADO_LABEL[i.resultado]} color={RESULTADO_COLOR[i.resultado]} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {inspeccionesHoy.length === 0 && !running && (
        <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 p-10 text-center">
          <p className="text-stone-500 text-sm">Sin muestreos generados hoy.</p>
          <p className="text-stone-400 text-xs mt-1">Pulsa "Generar muestreo" para ejecutar el motor de selección.</p>
        </div>
      )}

      {completarModal && (
        <CompletarModal
          inspeccion={completarModal}
          onClose={() => setCompletarModal(null)}
          onSave={handleCompletar}
        />
      )}

      {manualModal && (
        <MuestreoManualModal
          skusHoy={skusHoy}
          onClose={() => setManualModal(false)}
          onSave={handleManual}
        />
      )}
    </div>
  )
}

// ─── Tab: Inspecciones ────────────────────────────────────────────────────────

function TabInspecciones() {
  const [inspecciones,   setInspecciones]   = useState([])
  const [loading,        setLoading]        = useState(true)
  const [filtros,        setFiltros]        = useState({
    desde:    new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10),
    hasta:    new Date().toISOString().slice(0, 10),
    status:   '',
    resultado: '',
  })
  const [completarModal, setCompletarModal] = useState(null)
  const [error,          setError]          = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getInspecciones(filtros)
      setInspecciones(data)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [filtros])

  useEffect(() => { load() }, [load])

  async function handleCompletar(id, data) {
    await completarInspeccion(id, data)
    setCompletarModal(null)
    await load()
  }

  async function handleLiberar(i) {
    if (!confirm('¿Liberar este lote? Se removerá el bloqueo de calidad.')) return
    await liberarLote(i.id, i.finished_lot_id)
    await load()
  }

  const grupos = {}
  for (const i of inspecciones) {
    if (!grupos[i.fecha]) grupos[i.fecha] = []
    grupos[i.fecha].push(i)
  }

  return (
    <div className="space-y-4">

      {/* Filtros */}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Desde', field: 'desde', type: 'date' },
            { label: 'Hasta', field: 'hasta', type: 'date' },
          ].map(({ label, field, type }) => (
            <div key={field}>
              <label className="block mb-1 text-xs text-stone-400">{label}</label>
              <input type={type} value={filtros[field]}
                onChange={e => setFiltros(f => ({ ...f, [field]: e.target.value }))}
                className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none" />
            </div>
          ))}
          <div>
            <label className="block mb-1 text-xs text-stone-400">Estado</label>
            <select value={filtros.status} onChange={e => setFiltros(f => ({ ...f, status: e.target.value }))}
              className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none">
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="completada">Completada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
          <div>
            <label className="block mb-1 text-xs text-stone-400">Resultado</label>
            <select value={filtros.resultado} onChange={e => setFiltros(f => ({ ...f, resultado: e.target.value }))}
              className="rounded-2xl border border-stone-200 px-3 py-2 text-sm focus:border-[#2f5d50] focus:outline-none">
              <option value="">Todos</option>
              {Object.entries(RESULTADO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? <Spinner /> : Object.keys(grupos).length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 p-8 text-center">
          <p className="text-sm text-stone-400">Sin inspecciones en el rango seleccionado.</p>
        </div>
      ) : (
        Object.entries(grupos).map(([fecha, items]) => (
          <div key={fecha} className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
            <p className="mb-3 text-sm font-bold text-stone-600">{fecha}</p>
            <div className="space-y-2">
              {items.map(i => (
                <div key={i.id}
                  className="flex flex-col gap-2 rounded-2xl border border-stone-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-stone-800">
                        {i.product_presentations?.code}
                      </p>
                      <span className="text-xs text-stone-400 capitalize">{i.origen}</span>
                      {i.lote_bloqueado && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">🔒 bloqueado</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-stone-400">
                      {i.product_presentations?.display_name}
                      {i.finished_inventory_lots && ` · Lote ${i.finished_inventory_lots.finished_lot_code}`}
                      {i.unidades_inspeccionadas ? ` · ${i.unidades_inspeccionadas} unds` : ''}
                      {i.tasa_defectos != null ? ` · ${fmt2(i.tasa_defectos)}% def.` : ''}
                    </p>
                    {i.observaciones && (
                      <p className="mt-0.5 text-xs italic text-stone-500">{i.observaciones}</p>
                    )}
                    {i.defectos_inspeccion?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {i.defectos_inspeccion.map((d, j) => (
                          <span key={j} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${NIVEL_COLOR[d.nivel]}`}>
                            {d.tipo_defecto} ×{d.cantidad}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge label={i.status} color={STATUS_COLOR[i.status] || ''} />
                    {i.resultado && <Badge label={RESULTADO_LABEL[i.resultado]} color={RESULTADO_COLOR[i.resultado]} />}
                    {i.status === 'pendiente' && (
                      <button onClick={() => setCompletarModal(i)}
                        className="rounded-xl bg-[#2f5d50] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#264c42]">
                        Inspeccionar
                      </button>
                    )}
                    {i.lote_bloqueado && i.finished_lot_id && (
                      <button onClick={() => handleLiberar(i)}
                        className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                        Liberar lote
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {completarModal && (
        <CompletarModal
          inspeccion={completarModal}
          onClose={() => setCompletarModal(null)}
          onSave={handleCompletar}
        />
      )}
    </div>
  )
}

// ─── Tab: Configuración ───────────────────────────────────────────────────────

function TabConfiguracion() {
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState('')

  useEffect(() => {
    getConfiguracion().then(setConfig).catch(e => setError(e.message))
  }, [])

  function set(k, v) { setConfig(c => ({ ...c, [k]: v })) }

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      await saveConfiguracion(config)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (!config) return <Spinner />

  function NumField({ label, field, step = 0.01, min = 0, max = 1, help }) {
    return (
      <div>
        <label className="block mb-1 text-sm font-medium text-stone-700">{label}</label>
        {help && <p className="mb-1.5 text-xs text-stone-400">{help}</p>}
        <input type="number" step={step} min={min} max={max}
          value={config[field]}
          onChange={e => set(field, Number(e.target.value))}
          className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
      </div>
    )
  }

  function IntField({ label, field, min = 1, max = 365, help }) {
    return (
      <div>
        <label className="block mb-1 text-sm font-medium text-stone-700">{label}</label>
        {help && <p className="mb-1.5 text-xs text-stone-400">{help}</p>}
        <input type="number" step={1} min={min} max={max}
          value={config[field]}
          onChange={e => set(field, parseInt(e.target.value))}
          className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-[#2f5d50] focus:outline-none" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">

      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Parámetros base</p>
        <h3 className="mt-1 mb-5 text-lg font-bold text-stone-800">Probabilidad y límites</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumField field="probabilidad_base"    label="Probabilidad base"    help="Probabilidad inicial de cualquier SKU (0–1)" />
          <NumField field="probabilidad_minima"  label="Probabilidad mínima"  help="Piso: ningún SKU puede bajar de este valor" />
          <NumField field="probabilidad_maxima"  label="Probabilidad máxima"  help="Techo: ningún SKU puede superar este valor" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <IntField field="tamano_muestra_base"  label="Tamaño de muestra (unds)"  help="Unidades a inspeccionar por muestreo" min={1} max={100} />
          <NumField field="umbral_vigilancia"    label="Umbral vigilancia reforzada" help="% a partir del cual aparece en alerta de vigilancia" />
        </div>
      </div>

      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Ponderación</p>
        <h3 className="mt-1 mb-5 text-lg font-bold text-stone-800">Ajuste por historial</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField field="peso_reclamos"          label="Peso por reclamo de calidad" help="Incremento de probabilidad por cada reclamo en ventana" />
          <NumField field="peso_no_conformidades"  label="Peso por no conformidad"     help="Incremento por cada inspección no-liberada en ventana" />
        </div>
      </div>

      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Ajuste dinámico</p>
        <h3 className="mt-1 mb-5 text-lg font-bold text-stone-800">Modificadores por resultado reciente</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumField field="ajuste_rechazo"    label="Ajuste — Rechazado / Retenido" help="Suma a la probabilidad si el último resultado fue grave" />
          <NumField field="ajuste_observacion" label="Ajuste — Con observación"      help="Suma si el último resultado fue con observación" />
          <NumField field="ajuste_limpio"     label="Reducción — Liberado"          help="Resta si el último resultado fue completamente limpio" />
        </div>
      </div>

      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Ventanas de historial</p>
        <h3 className="mt-1 mb-5 text-lg font-bold text-stone-800">Rango de análisis</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <IntField field="ventana_reclamos"   label="Ventana reclamos (días)"    help="Días hacia atrás para contar reclamos de calidad" />
          <IntField field="ventana_resultados" label="Ventana resultados (días)"  help="Días hacia atrás para analizar resultados de inspección" />
        </div>
      </div>

      {/* Vista previa fórmula */}
      <div className="rounded-3xl border border-stone-100 bg-stone-50 p-5">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-400">Vista previa — fórmula activa</p>
        <div className="space-y-0.5 font-mono text-xs text-stone-600">
          <p>probabilidad_final = clamp(</p>
          <p className="pl-6">{config.probabilidad_base} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;← base</p>
          <p className="pl-6">+ reclamos × {config.peso_reclamos}</p>
          <p className="pl-6">+ no_conformidades × {config.peso_no_conformidades}</p>
          <p className="pl-6">+ resultado: +{config.ajuste_rechazo} | +{config.ajuste_observacion} | -{config.ajuste_limpio}</p>
          <p className="pl-4">→ min {config.probabilidad_minima}, max {config.probabilidad_maxima}</p>
          <p>)</p>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {saved && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">✓ Configuración guardada correctamente</div>}

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="rounded-2xl bg-[#2f5d50] px-6 py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

const TABS = [
  { key: 'dashboard',      label: 'Dashboard' },
  { key: 'muestreos',      label: 'Muestreos del día' },
  { key: 'inspecciones',   label: 'Inspecciones' },
  { key: 'configuracion',  label: 'Configuración' },
]

export default function CalidadPage() {
  const [tab, setTab] = useState('dashboard')
  const hoyStr = new Date().toLocaleDateString('es-GT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Control de calidad</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900">Calidad</h1>
          <p className="mt-1 text-sm capitalize text-stone-500">{hoyStr}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-stone-200 bg-white p-1 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? 'bg-[#2f5d50] text-white shadow-sm' : 'text-stone-500 hover:text-stone-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard'     && <TabDashboard    onTabChange={setTab} />}
      {tab === 'muestreos'     && <TabMuestreos />}
      {tab === 'inspecciones'  && <TabInspecciones />}
      {tab === 'configuracion' && <TabConfiguracion />}
    </div>
  )
}
