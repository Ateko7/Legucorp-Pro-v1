import { useEffect, useState, useCallback } from 'react'
import { getGastos, createGasto, deleteGasto, getGastosSummary } from '../services/gastosService'
import { getCostCenters } from '../../contabilidad/services/contabilidadService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const today       = new Date().toISOString().slice(0, 10)
const firstOfMonth = today.slice(0, 7) + '-01'

const EXPENSE_TYPE_LABEL = {
  administrativo: 'Administrativo',
  produccion:     'Producción',
  logistica:      'Logística',
  comercial:      'Comercial',
}

const EXPENSE_TYPE_COLOR = {
  administrativo: 'bg-blue-100 text-blue-700',
  produccion:     'bg-emerald-100 text-emerald-700',
  logistica:      'bg-orange-100 text-orange-700',
  comercial:      'bg-purple-100 text-purple-700',
}

const CC_DEFAULT_TYPE = {
  'CC-01': 'produccion',
  'CC-02': 'comercial',
  'CC-03': 'logistica',
  'CC-04': 'administrativo',
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}
function Alert({ type = 'error', children }) {
  const s = {
    error:   'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${s[type]}`}>{children}</div>
}

// ─── Modal nuevo gasto ────────────────────────────────────────────────────────

function NuevoGastoModal({ centers, onClose, onSaved }) {
  const [form, setForm] = useState({
    fecha:        today,
    descripcion:  '',
    monto:        '',
    cost_center_id: '',
    expense_type: 'administrativo',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function handleCC(id) {
    const cc = centers.find(c => c.id === id)
    const tipo = cc ? (CC_DEFAULT_TYPE[cc.code] || 'administrativo') : 'administrativo'
    setForm(p => ({ ...p, cost_center_id: id, expense_type: tipo }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await createGasto(form)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <h3 className="font-semibold text-stone-800">Registrar gasto</h3>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <Alert type="error">{error}</Alert>}

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Fecha *</span>
              <input type="date" required value={form.fecha}
                onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
            </label>
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Monto (Q) *</span>
              <input type="number" min="0.01" step="0.01" required value={form.monto}
                onChange={e => setForm(p => ({ ...p, monto: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
            </label>
          </div>

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Descripción *</span>
            <input required value={form.descripcion}
              onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
              placeholder="Ej. Combustible camión, servicio de limpieza…"
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
          </label>

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Centro de costo *</span>
            <select required value={form.cost_center_id}
              onChange={e => handleCC(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
              <option value="">Seleccionar…</option>
              {centers.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Tipo de gasto</span>
            <select value={form.expense_type}
              onChange={e => setForm(p => ({ ...p, expense_type: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
              {Object.entries(EXPENSE_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-stone-400">Determina la cuenta contable (6100 / 6200 / 6300)</p>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando…' : 'Registrar gasto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Confirmar eliminación ────────────────────────────────────────────────────

function DeleteConfirmModal({ gasto, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [error,    setError]    = useState('')

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteGasto(gasto.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl p-6 space-y-4">
        <h3 className="font-semibold text-stone-800">Eliminar gasto</h3>
        {error && <Alert type="error">{error}</Alert>}
        <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-stone-500">Descripción</span>
            <span className="font-medium text-stone-800">{gasto.description}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Monto</span>
            <span className="font-bold text-stone-900">Q {fmt(gasto.amount)}</span>
          </div>
        </div>
        <p className="text-xs text-stone-400">El asiento contable asociado se conserva por integridad.</p>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex-1 rounded-2xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function GastosPage() {
  const [gastos,    setGastos]    = useState([])
  const [summary,   setSummary]   = useState([])
  const [centers,   setCenters]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [dateFrom,  setDateFrom]  = useState(firstOfMonth)
  const [dateTo,    setDateTo]    = useState(today)
  const [showModal, setShowModal] = useState(false)
  const [deleting,  setDeleting]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [g, s, cc] = await Promise.all([
        getGastos(dateFrom, dateTo),
        getGastosSummary(dateFrom, dateTo),
        getCostCenters(),
      ])
      setGastos(g)
      setSummary(s)
      setCenters(cc)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const totalGastos = gastos.reduce((a, g) => a + n(g.amount), 0)
  const maxCC = summary.length > 0 ? Math.max(...summary.map(c => c.total)) : 1

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Cabecera */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Finanzas</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Gastos</h1>
            <p className="mt-1 text-sm text-stone-500">Control de egresos por centro de costo con asiento automático.</p>
          </div>
          <button onClick={() => setShowModal(true)}
            className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] transition">
            + Registrar gasto
          </button>
        </div>

        {error && <Alert type="error">{error}</Alert>}

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="block text-xs font-medium text-stone-500 mb-1">Desde</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-stone-500 mb-1">Hasta</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <button onClick={load}
            className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
            Consultar
          </button>
        </div>

        {/* KPI total */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Total de gastos</p>
            <p className="mt-2 text-3xl font-bold text-white">Q {fmt(totalGastos)}</p>
            <p className="mt-1 text-xs text-emerald-200">{gastos.length} registro{gastos.length !== 1 ? 's' : ''} en el período</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Centros activos en período</p>
            <p className="mt-2 text-3xl font-bold text-stone-900">{summary.length}</p>
            <p className="mt-1 text-xs text-stone-400">
              {summary.length > 0
                ? `Mayor: ${summary.reduce((a, b) => a.total > b.total ? a : b).name}`
                : 'Sin datos'}
            </p>
          </div>
        </div>

        {/* Barras por CC */}
        {summary.length > 0 && (
          <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Distribución por centro de costo</h3>
            {summary.map(cc => (
              <div key={cc.code} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-stone-700">{cc.code} — {cc.name}</span>
                  <span className="font-bold text-stone-900">Q {fmt(cc.total)}</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-stone-100">
                  <div
                    className="h-2.5 rounded-full bg-[#2f5d50] transition-all"
                    style={{ width: `${maxCC > 0 ? (cc.total / maxCC) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-stone-400">{cc.count} registro{cc.count !== 1 ? 's' : ''} · {totalGastos > 0 ? ((cc.total / totalGastos) * 100).toFixed(1) : 0}% del total</p>
              </div>
            ))}
          </div>
        )}

        {/* Lista de gastos */}
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : gastos.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center">
            <p className="text-stone-400">No hay gastos registrados en el período.</p>
            <button onClick={() => setShowModal(true)}
              className="mt-3 rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
              + Registrar primer gasto
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {gastos.map(g => (
              <div key={g.id} className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-stone-900">{g.description}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${EXPENSE_TYPE_COLOR[g.expense_type]}`}>
                        {EXPENSE_TYPE_LABEL[g.expense_type]}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-stone-400 flex-wrap">
                      <span>{g.expense_date}</span>
                      {g.cost_centers && (
                        <span className="font-medium text-stone-500">
                          {g.cost_centers.code} · {g.cost_centers.name}
                        </span>
                      )}
                      {g.journal_entry_id && (
                        <span className="text-emerald-600">✓ Asiento generado</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-xl font-bold text-stone-900">Q {fmt(g.amount)}</p>
                    <button onClick={() => setDeleting(g)}
                      className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition">
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal nuevo gasto */}
      {showModal && (
        <NuevoGastoModal
          centers={centers}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load() }}
        />
      )}

      {/* Modal eliminar */}
      {deleting && (
        <DeleteConfirmModal
          gasto={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); load() }}
        />
      )}
    </div>
  )
}
