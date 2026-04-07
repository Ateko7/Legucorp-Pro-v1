import { useEffect, useState, useCallback } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  getCierres,
  getCierreById,
  generarCierreDiario,
  generarCierreSemanal,
  generarCierreMensual,
  cambiarEstadoCierre,
  actualizarObservaciones,
  deleteCierre,
  rangoParaDiario,
  rangoParaSemanal,
  rangoParaMensual,
} from '../services/cierresService'

// ─── Helpers ───────────────────────────────────────────────────────────────────
function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v, dec = 2) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtQ(v) { return `Q${fmt(v)}` }
function fmtLb(v) { return `${fmt(v)} lb` }
function fmtPorc(v) { return `${fmt(v)}%` }
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' })
}
function today() { return new Date().toISOString().slice(0, 10) }
function currentYear() { return new Date().getFullYear() }
function currentMonth() { return new Date().getMonth() + 1 }

const ESTADO_COLORS = {
  borrador:   'bg-stone-100 text-stone-600',
  calculado:  'bg-blue-100 text-blue-700',
  revisado:   'bg-amber-100 text-amber-700',
  cerrado:    'bg-emerald-100 text-emerald-800',
}
const SEVERIDAD_COLORS = {
  info:    'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  error:   'bg-red-50 border-red-200 text-red-700',
}
const SEVERIDAD_ICON = { info: 'ℹ', warning: '⚠', error: '✕' }

const TIPO_LABELS = { diario: 'Diario', semanal: 'Semanal', mensual: 'Mensual' }
const MONTHS = [
  '', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

// ─── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-stone-200',
    success: 'border-emerald-200 bg-emerald-50/40',
    warning: 'border-amber-200 bg-amber-50/40',
    danger:  'border-red-200 bg-red-50/40',
  }
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-stone-800">{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-400">{sub}</div>}
    </div>
  )
}

function StatusPill({ estado }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${ESTADO_COLORS[estado] || ESTADO_COLORS.borrador}`}>
      {estado}
    </span>
  )
}

function SectionTitle({ children }) {
  return (
    <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-stone-500">{children}</h3>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}

function inputCls() {
  return 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100'
}

function Btn({ onClick, disabled, variant = 'primary', className = '', children }) {
  const variants = {
    primary:  'bg-[#2f5d50] text-white hover:bg-[#264c42]',
    ghost:    'border border-stone-300 bg-white text-stone-700 hover:bg-stone-100',
    danger:   'bg-red-600 text-white hover:bg-red-700',
    amber:    'bg-amber-600 text-white hover:bg-amber-700',
    blue:     'bg-blue-600 text-white hover:bg-blue-700',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

function EmptyState({ text }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-500">
      {text}
    </div>
  )
}

// ─── Generate panel ────────────────────────────────────────────────────────────

function GenerarPanel({ tab, onGenerated }) {
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [fecha, setFecha]       = useState(today())
  const [semana, setSemana]     = useState(today())
  const [anio, setAnio]         = useState(currentYear())
  const [mes, setMes]           = useState(currentMonth())

  async function handleGenerar() {
    setLoading(true)
    setError('')
    try {
      let cierre
      if (tab === 'diario')   cierre = await generarCierreDiario(fecha)
      if (tab === 'semanal')  cierre = await generarCierreSemanal(semana)
      if (tab === 'mensual')  cierre = await generarCierreMensual(anio, mes)
      onGenerated(cierre)
    } catch (e) {
      setError(e.message || 'No se pudo generar el cierre')
    } finally {
      setLoading(false)
    }
  }

  // Preview range
  let rango = ''
  if (tab === 'diario')  { const r = rangoParaDiario(fecha); rango = fmtDate(r.inicio) }
  if (tab === 'semanal') { const r = rangoParaSemanal(semana); rango = `${fmtDate(r.inicio)} → ${fmtDate(r.fin)}` }
  if (tab === 'mensual') { const r = rangoParaMensual(anio, mes); rango = `${fmtDate(r.inicio)} → ${fmtDate(r.fin)}` }

  return (
    <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
      <SectionTitle>Generar / Recalcular cierre {TIPO_LABELS[tab]}</SectionTitle>

      <div className="grid gap-4 md:grid-cols-3">
        {tab === 'diario' && (
          <Field label="Fecha">
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls()} />
          </Field>
        )}
        {tab === 'semanal' && (
          <Field label="Cualquier día de la semana">
            <input type="date" value={semana} onChange={e => setSemana(e.target.value)} className={inputCls()} />
          </Field>
        )}
        {tab === 'mensual' && (
          <>
            <Field label="Año">
              <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))} min="2020" max="2099" className={inputCls()} />
            </Field>
            <Field label="Mes">
              <select value={mes} onChange={e => setMes(Number(e.target.value))} className={inputCls()}>
                {MONTHS.slice(1).map((m, i) => (
                  <option key={i+1} value={i+1}>{m}</option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="flex flex-col justify-end">
          <div className="mb-2 text-xs text-stone-500">Período: <span className="font-medium text-stone-700">{rango}</span></div>
          <Btn onClick={handleGenerar} disabled={loading}>
            {loading ? 'Calculando...' : 'Generar cierre'}
          </Btn>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
    </div>
  )
}

// ─── Cierre list card ──────────────────────────────────────────────────────────

function CierreCard({ cierre, onSelect, onDelete }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e) {
    e.stopPropagation()
    if (!window.confirm('¿Eliminar este cierre?')) return
    setDeleting(true)
    try { await deleteCierre(cierre.id); onDelete(cierre.id) }
    catch (err) { alert(err.message) }
    finally { setDeleting(false) }
  }

  return (
    <div
      onClick={() => onSelect(cierre.id)}
      className="cursor-pointer rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill estado={cierre.estado} />
            <span className="text-sm text-stone-500">
              {cierre.tipo_periodo === 'diario'  && fmtDate(cierre.fecha_inicio)}
              {cierre.tipo_periodo === 'semanal' && `${fmtDate(cierre.fecha_inicio)} → ${fmtDate(cierre.fecha_fin)}`}
              {cierre.tipo_periodo === 'mensual' && `${MONTHS[new Date(cierre.fecha_inicio+'T00:00:00').getMonth()+1]} ${new Date(cierre.fecha_inicio+'T00:00:00').getFullYear()}`}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-500">
            <span>Ventas <strong className="text-stone-700">{fmtQ(cierre.ventas_total)}</strong></span>
            <span>Costo <strong className="text-stone-700">{fmtQ(cierre.costo_total)}</strong></span>
            <span>Utilidad <strong className={n(cierre.utilidad_bruta) >= 0 ? 'text-emerald-700' : 'text-red-600'}>{fmtQ(cierre.utilidad_bruta)}</strong></span>
            <span>Margen <strong>{fmtPorc(cierre.margen_bruto)}</strong></span>
            <span>Producción <strong>{fmtLb(cierre.libras_producidas)}</strong></span>
            {n(cierre.costo_por_libra) > 0 && <span>Q/lb <strong>{fmtQ(cierre.costo_por_libra)}</strong></span>}
          </div>
        </div>
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          {cierre.estado !== 'cerrado' && (
            <Btn variant="danger" disabled={deleting} onClick={handleDelete}>
              {deleting ? '...' : 'Eliminar'}
            </Btn>
          )}
          <Btn variant="ghost" onClick={() => onSelect(cierre.id)}>Ver detalle →</Btn>
        </div>
      </div>

      {(cierre.resumen_alertas || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {cierre.resumen_alertas.slice(0, 3).map((a, i) => (
            <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${SEVERIDAD_COLORS[a.severidad]}`}>
              {SEVERIDAD_ICON[a.severidad]} {a.descripcion}
            </span>
          ))}
          {cierre.resumen_alertas.length > 3 && (
            <span className="inline-flex items-center rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-xs text-stone-500">
              +{cierre.resumen_alertas.length - 3} más
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Detail view ───────────────────────────────────────────────────────────────

function CierreDetail({ cierreId, onBack, onStateChange }) {
  const [cierre, setCierre] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [obs, setObs] = useState('')
  const [savingObs, setSavingObs] = useState(false)
  const [changingState, setChangingState] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getCierreById(cierreId)
      setCierre(data)
      setObs(data.observaciones || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [cierreId])

  useEffect(() => { load() }, [load])

  async function handleSaveObs() {
    setSavingObs(true)
    try { await actualizarObservaciones(cierreId, obs); await load() }
    catch (e) { alert(e.message) }
    finally { setSavingObs(false) }
  }

  async function handleEstado(nuevoEstado) {
    if (!window.confirm(`¿Cambiar estado a "${nuevoEstado}"?`)) return
    setChangingState(true)
    try {
      await cambiarEstadoCierre(cierreId, nuevoEstado)
      await load()
      onStateChange?.()
    } catch (e) { alert(e.message) }
    finally { setChangingState(false) }
  }

  if (loading) return <div className="py-16 text-center text-sm text-stone-500">Cargando cierre...</div>
  if (error)   return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
  if (!cierre) return null

  const c = cierre

  const nextEstados = {
    borrador:  ['calculado'],
    calculado: ['revisado', 'cerrado'],
    revisado:  ['cerrado'],
    cerrado:   [],
  }[c.estado] || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <button onClick={onBack} className="mb-1 text-sm text-stone-500 hover:text-stone-700">← Volver a lista</button>
          <h2 className="text-2xl font-bold text-stone-800">
            Cierre {TIPO_LABELS[c.tipo_periodo]} —{' '}
            {c.tipo_periodo === 'diario' ? fmtDate(c.fecha_inicio) : `${fmtDate(c.fecha_inicio)} a ${fmtDate(c.fecha_fin)}`}
          </h2>
          <div className="mt-1 flex items-center gap-3">
            <StatusPill estado={c.estado} />
            {c.fecha_cierre && <span className="text-xs text-stone-400">Cerrado: {new Date(c.fecha_cierre).toLocaleDateString('es-GT')}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {nextEstados.map(s => (
            <Btn key={s} variant={s === 'cerrado' ? 'primary' : s === 'revisado' ? 'amber' : 'blue'} onClick={() => handleEstado(s)} disabled={changingState}>
              {changingState ? '...' : `Marcar ${s}`}
            </Btn>
          ))}
        </div>
      </div>

      {/* KPI row: Producción */}
      <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <SectionTitle>Producción</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Libras producidas"  value={fmtLb(c.libras_producidas)} />
          <KpiCard label="Unidades producidas" value={fmt(c.unidades_producidas, 0)} />
          <KpiCard label="Runs de empaque"    value={n(c.total_runs)} />
          <KpiCard label="Merma"              value={fmtLb(c.merma_libras)} sub={fmtPorc(c.merma_porcentaje)}
            tone={n(c.merma_porcentaje) > 15 ? 'danger' : n(c.merma_porcentaje) > 10 ? 'warning' : 'neutral'} />
          <KpiCard label="Costo/lb"           value={n(c.costo_por_libra) > 0 ? fmtQ(c.costo_por_libra) : '—'} />
        </div>
      </div>

      {/* Ventas & Rentabilidad */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <SectionTitle>Pedidos / Ventas</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard label="Pedidos totales"    value={n(c.total_pedidos)} />
            <KpiCard label="Despachados"         value={n(c.pedidos_despachados)} tone="success" />
            <KpiCard label="Pendientes"          value={n(c.pedidos_pendientes)} tone={n(c.pedidos_pendientes)>0?'warning':'neutral'} />
            <KpiCard label="Ventas"              value={fmtQ(c.ventas_total)} tone="success" />
          </div>
        </div>

        <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <SectionTitle>Rentabilidad</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard label="Costo total"    value={fmtQ(c.costo_total)} />
            <KpiCard label="Utilidad bruta" value={fmtQ(c.utilidad_bruta)}
              tone={n(c.utilidad_bruta) >= 0 ? 'success' : 'danger'} />
            <KpiCard label="Margen bruto"  value={fmtPorc(c.margen_bruto)}
              tone={n(c.margen_bruto) >= 20 ? 'success' : n(c.margen_bruto) >= 0 ? 'warning' : 'danger'} />
            <KpiCard label="Ventas netas"  value={fmtQ(c.ventas_total)} />
          </div>
        </div>
      </div>

      {/* Costos desglosados */}
      <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <SectionTitle>Desglose de costos</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Costo MP (procesado)" value={fmtQ(c.costo_mp)} />
          <KpiCard label="Costo empaque mat."   value={fmtQ(c.costo_empaque_mat)} />
          <KpiCard label="Costo laboral"        value={fmtQ(c.costo_laboral)} />
          <KpiCard label="Gastos operativos"    value={fmtQ(c.costo_gastos)} />
        </div>
      </div>

      {/* Calidad */}
      <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <SectionTitle>Calidad e incidencias</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Inspecciones"   value={n(c.inspecciones_total)} />
          <KpiCard label="Rechazadas"     value={n(c.inspecciones_rechazadas)}
            tone={n(c.inspecciones_rechazadas)>0?'danger':'neutral'} />
          <KpiCard label="Retenidas"      value={n(c.inspecciones_retenidas)}
            tone={n(c.inspecciones_retenidas)>0?'warning':'neutral'} />
          <KpiCard label="Tasa rechazo"   value={fmtPorc(c.tasa_rechazo)}
            tone={n(c.tasa_rechazo)>10?'danger':n(c.tasa_rechazo)>5?'warning':'neutral'} />
          <KpiCard label="Reclamos"       value={n(c.reclamos_total)}
            tone={n(c.reclamos_total)>3?'danger':n(c.reclamos_total)>0?'warning':'neutral'} />
        </div>
      </div>

      {/* Alertas */}
      {(cierre.eventos || []).length > 0 && (
        <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <SectionTitle>Alertas detectadas</SectionTitle>
          <div className="space-y-3">
            {cierre.eventos.map(e => (
              <div key={e.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${SEVERIDAD_COLORS[e.severidad]}`}>
                <span className="mt-0.5 shrink-0 font-bold">{SEVERIDAD_ICON[e.severidad]}</span>
                <span>{e.descripcion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detalle por SKU */}
      {(cierre.detalle_sku || []).length > 0 && (
        <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <SectionTitle>Detalle por SKU</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <th className="pb-3 pr-4">SKU</th>
                  <th className="pb-3 pr-4 text-right">Prod. (und)</th>
                  <th className="pb-3 pr-4 text-right">Prod. (lb)</th>
                  <th className="pb-3 pr-4 text-right">Vtas. und</th>
                  <th className="pb-3 pr-4 text-right">Vtas. Q</th>
                  <th className="pb-3 pr-4 text-right">Costo Q</th>
                  <th className="pb-3 text-right">Margen</th>
                </tr>
              </thead>
              <tbody>
                {cierre.detalle_sku.map(s => (
                  <tr key={s.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-stone-800">{s.sku_nombre}</div>
                      <div className="text-xs text-stone-400">{s.sku_code}</div>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-stone-700">{fmt(s.produccion_unidades, 0)}</td>
                    <td className="py-2.5 pr-4 text-right text-stone-700">{fmt(s.produccion_libras)}</td>
                    <td className="py-2.5 pr-4 text-right text-stone-700">{fmt(s.ventas_unidades, 0)}</td>
                    <td className="py-2.5 pr-4 text-right font-medium text-stone-800">{fmtQ(s.ventas_monto)}</td>
                    <td className="py-2.5 pr-4 text-right text-stone-700">{fmtQ(s.costo_total)}</td>
                    <td className={`py-2.5 text-right font-semibold ${n(s.margen) >= 20 ? 'text-emerald-700' : n(s.margen) >= 0 ? 'text-amber-700' : 'text-red-600'}`}>
                      {fmtPorc(s.margen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Observaciones */}
      <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <SectionTitle>Observaciones</SectionTitle>
        <textarea
          value={obs}
          onChange={e => setObs(e.target.value)}
          disabled={c.estado === 'cerrado'}
          rows={4}
          placeholder="Añade observaciones o notas sobre este cierre..."
          className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 disabled:opacity-60"
        />
        {c.estado !== 'cerrado' && (
          <div className="mt-3">
            <Btn onClick={handleSaveObs} disabled={savingObs} variant="ghost">
              {savingObs ? 'Guardando...' : 'Guardar observaciones'}
            </Btn>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab list ──────────────────────────────────────────────────────────────────

function TabList({ active, onChange }) {
  return (
    <div className="flex gap-2">
      {['diario','semanal','mensual'].map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition ${
            active === t
              ? 'bg-[#2f5d50] text-white shadow-sm'
              : 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
          }`}
        >
          {TIPO_LABELS[t]}
        </button>
      ))}
    </div>
  )
}

// ─── Summary dashboard bar ─────────────────────────────────────────────────────

function DashboardBar({ cierres }) {
  const last = cierres[0]
  if (!last) return null
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <KpiCard label="Último período" value={fmtDate(last.fecha_inicio)} sub={TIPO_LABELS[last.tipo_periodo]} />
      <KpiCard label="Ventas"         value={fmtQ(last.ventas_total)} tone="success" />
      <KpiCard label="Costo total"    value={fmtQ(last.costo_total)} />
      <KpiCard label="Utilidad"       value={fmtQ(last.utilidad_bruta)}
        tone={n(last.utilidad_bruta) >= 0 ? 'success' : 'danger'} />
      <KpiCard label="Costo/lb"       value={n(last.costo_por_libra) > 0 ? fmtQ(last.costo_por_libra) : '—'} />
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CierresPage() {
  const [tab, setTab]               = useState('diario')
  const [cierres, setCierres]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const loadCierres = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getCierres({ tipo_periodo: tab })
      setCierres(data)
    } catch (e) {
      setError(e.message || 'No se pudieron cargar los cierres')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { setSelectedId(null); loadCierres() }, [loadCierres])
  useRealtimeRefresh(['cierres_produccion', 'orders', 'purchase_orders'], loadCierres)

  function handleGenerated(cierre) {
    setSelectedId(cierre.id)
    loadCierres()
  }

  function handleDelete(id) {
    setCierres(prev => prev.filter(c => c.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  if (selectedId) {
    return (
      <div className="space-y-8">
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Finanzas</p>
          <h1 className="text-3xl font-semibold text-stone-800">Cierres Operativos</h1>
        </section>
        <CierreDetail
          cierreId={selectedId}
          onBack={() => { setSelectedId(null); loadCierres() }}
          onStateChange={loadCierres}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Finanzas</p>
          <h1 className="text-3xl font-semibold text-stone-800">Cierres Operativos</h1>
          <p className="mt-2 text-sm text-stone-500">
            Control diario, semanal y mensual de producción, ventas, costos y rentabilidad.
          </p>
        </div>
        <button onClick={loadCierres} className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100">
          Recargar
        </button>
      </section>

      {/* Dashboard summary of last cierre in this tab */}
      {cierres.length > 0 && !loading && <DashboardBar cierres={cierres} />}

      {/* Tabs */}
      <TabList active={tab} onChange={setTab} />

      {/* Generate panel */}
      <GenerarPanel tab={tab} onGenerated={handleGenerated} />

      {/* List */}
      <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <SectionTitle>Historial de cierres {TIPO_LABELS[tab].toLowerCase()}s</SectionTitle>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">Cargando...</div>
        ) : cierres.length === 0 ? (
          <EmptyState text={`No hay cierres ${TIPO_LABELS[tab].toLowerCase()}s generados aún.`} />
        ) : (
          <div className="space-y-4">
            {cierres.map(c => (
              <CierreCard
                key={c.id}
                cierre={c}
                onSelect={setSelectedId}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
