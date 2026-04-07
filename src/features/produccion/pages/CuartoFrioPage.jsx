import { useEffect, useMemo, useState } from 'react'
import {
  getColdRoomDashboard,
  updateColdRoomLotStatus,
} from '../services/coldRoomService'

function n(value) { const x = Number(value); return Number.isNaN(x) ? 0 : x }
function fmt(value) { return n(value).toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }
function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('es-GT')
}

function getExpiryTone(days) {
  if (days === null || days === undefined) return 'neutral'
  if (days < 0) return 'danger'
  if (days <= 3) return 'warning'
  return 'success'
}
function getExpiryLabel(days) {
  if (days === null || days === undefined) return 'Sin fecha'
  if (days < 0) return `Vencido (${Math.abs(days)}d)`
  if (days === 0) return 'Vence hoy'
  if (days === 1) return '1 día'
  return `${days} días`
}

const STATUS_TONE = {
  disponible: 'bg-emerald-100 text-emerald-800',
  bloqueado:  'bg-amber-100 text-amber-800',
  agotado:    'bg-stone-100 text-stone-500',
}

export default function CuartoFrioPage() {
  const [loading, setLoading]   = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')
  const [lots, setLots]         = useState([])
  const [summary, setSummary]   = useState({ totalLots: 0, availableLots: 0, totalUnits: 0, expiringSoon: 0, expired: 0 })
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true); setError('')
    try {
      const data = await getColdRoomDashboard()
      setLots(data.lots || [])
      setSummary(data.summary || {})
    } catch (err) {
      setError(err.message || 'No se pudo cargar cuarto frío')
    } finally {
      setLoading(false)
    }
  }

  async function handleStatusChange(lotId, status) {
    setSavingId(lotId); setError(''); setSuccess('')
    try {
      await updateColdRoomLotStatus({ lotId, status })
      setSuccess('Estado actualizado.')
      setTimeout(() => setSuccess(''), 2500)
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el estado')
    } finally {
      setSavingId('')
    }
  }

  const filteredLots = useMemo(() => {
    const term = search.trim().toLowerCase()
    return lots.filter((lot) => {
      const matchesSearch = !term || [lot.finished_lot_code, lot.product_code, lot.product_name, lot.product_base_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
      const matchesStatus = statusFilter === 'todos' || lot.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [lots, search, statusFilter])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Inventarios</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">Cuarto frío</h1>
          <p className="mt-1 text-sm text-stone-500">Producto terminado empacado disponible en frío.</p>
        </div>
        <button
          onClick={loadAll}
          className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50"
        >
          Recargar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Total lotes',      value: summary.totalLots,              hint: 'Registrados' },
          { label: 'Disponibles',      value: summary.availableLots,          hint: 'Con existencia' },
          { label: 'Unidades',         value: fmt(summary.totalUnits),        hint: 'Stock total' },
          { label: 'Próx. a vencer',   value: summary.expiringSoon,           hint: 'Dentro de 3 días' },
          { label: 'Vencidos',         value: summary.expired,                hint: 'Requieren revisión' },
        ].map(({ label, value, hint }) => (
          <div key={label} className="rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-stone-900">{value}</p>
            <p className="mt-0.5 text-xs text-stone-400">{hint}</p>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {error   && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      {/* Filters + table */}
      <div className="rounded-3xl border border-stone-200 bg-white shadow-sm">
        {/* Filter bar */}
        <div className="flex flex-col gap-3 border-b border-stone-100 px-5 py-4 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Buscar por producto, código o lote..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-800 outline-none transition focus:border-[#2f5d50] focus:bg-white focus:ring-4 focus:ring-[#2f5d50]/10"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-700 outline-none transition focus:border-[#2f5d50] focus:ring-4 focus:ring-[#2f5d50]/10"
          >
            <option value="todos">Todos los estados</option>
            <option value="disponible">Disponible</option>
            <option value="bloqueado">Bloqueado</option>
            <option value="agotado">Agotado</option>
          </select>
          <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
            {filteredLots.length} lote{filteredLots.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-stone-200 border-t-[#2f5d50]" />
          </div>
        ) : filteredLots.length === 0 ? (
          <div className="py-16 text-center text-sm text-stone-400">
            No hay lotes en cuarto frío{statusFilter !== 'todos' ? ` con estado "${statusFilter}"` : ''}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50/60">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Producto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Lote</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Disponible</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Costo unit.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Producción</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Vencimiento</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Cambiar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredLots.map((lot) => {
                  const expiryTone = getExpiryTone(lot.days_to_expire)
                  const expiryLabel = getExpiryLabel(lot.days_to_expire)
                  const expiryColor = {
                    neutral: 'text-stone-400',
                    success: 'text-emerald-600',
                    warning: 'text-amber-600 font-semibold',
                    danger:  'text-red-600 font-semibold',
                  }[expiryTone]

                  return (
                    <tr key={lot.id} className="transition hover:bg-stone-50/60">
                      <td className="px-5 py-3">
                        <p className="font-medium text-stone-800">{lot.product_name || '—'}</p>
                        <p className="text-xs text-stone-400">{lot.product_code || ''}{lot.product_base_name ? ` · ${lot.product_base_name}` : ''}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-stone-600">{lot.finished_lot_code}</td>
                      <td className="px-4 py-3 text-right font-semibold text-stone-800">
                        {fmt(lot.available_quantity)} <span className="text-xs font-normal text-stone-400">{lot.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-stone-600">
                        {lot.unit_cost ? `Q ${fmt(lot.unit_cost)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-stone-600">{fmtDate(lot.production_date)}</td>
                      <td className="px-4 py-3">
                        <p className="text-stone-600">{fmtDate(lot.expiration_date)}</p>
                        <p className={`text-xs ${expiryColor}`}>{expiryLabel}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[lot.status] || STATUS_TONE.agotado}`}>
                          {lot.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={lot.status}
                          onChange={(e) => handleStatusChange(lot.id, e.target.value)}
                          disabled={savingId === lot.id}
                          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none transition focus:border-[#2f5d50] focus:ring-2 focus:ring-[#2f5d50]/10 disabled:opacity-50"
                        >
                          <option value="disponible">Disponible</option>
                          <option value="bloqueado">Bloqueado</option>
                          <option value="agotado">Agotado</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
