import { useEffect, useMemo, useState } from 'react'
import {
  getColdRoomDashboard,
  updateColdRoomLotStatus,
} from '../services/coldRoomService'

function numberOrZero(value) {
  const n = Number(value)
  return Number.isNaN(n) ? 0 : n
}

function formatNumber(value) {
  return numberOrZero(value).toLocaleString('es-GT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('es-GT')
}

function EmptyState({ text }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center text-sm text-stone-500">
      {text}
    </div>
  )
}

function StatusPill({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-700',
  }

  return (
    <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tones[tone] || tones.neutral}`}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-stone-800">{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-400">{hint}</div> : null}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}

function getExpiryTone(days) {
  if (days === null) return 'neutral'
  if (days < 0) return 'danger'
  if (days <= 3) return 'warning'
  return 'success'
}

function getExpiryLabel(days) {
  if (days === null) return 'Sin fecha'
  if (days < 0) return 'Vencido'
  if (days === 0) return 'Vence hoy'
  if (days === 1) return 'Vence en 1 día'
  return `Vence en ${days} días`
}

export default function CuartoFrioPage() {
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lots, setLots] = useState([])
  const [summary, setSummary] = useState({
    totalLots: 0,
    availableLots: 0,
    totalUnits: 0,
    expiringSoon: 0,
    expired: 0,
  })

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')

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
    setSavingId(lotId)
    setError('')
    setSuccess('')

    try {
      await updateColdRoomLotStatus({ lotId, status })
      setSuccess('Estado actualizado correctamente.')
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
      const matchesSearch =
        !term ||
        [
          lot.finished_lot_code,
          lot.product_code,
          lot.product_name,
          lot.product_base_name,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term))

      const matchesStatus =
        statusFilter === 'todos' ? true : lot.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [lots, search, statusFilter])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Inventario
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Cuarto frío</h1>
          <p className="mt-2 text-sm text-stone-500">
            Visualiza el producto terminado empacado, sus lotes, fechas y disponibilidad en cuarto frío.
          </p>
        </div>

        <button
          onClick={loadAll}
          className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
        >
          Recargar
        </button>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Total lotes" value={summary.totalLots} hint="Registrados en cuarto frío" />
        <KpiCard label="Disponibles" value={summary.availableLots} hint="Con existencia" />
        <KpiCard label="Unidades" value={formatNumber(summary.totalUnits)} hint="Stock disponible" />
        <KpiCard label="Próx. a vencer" value={summary.expiringSoon} hint="Dentro de 3 días" />
        <KpiCard label="Vencidos" value={summary.expired} hint="Requieren revisión" />
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Buscar">
              <input
                type="text"
                placeholder="Buscar por lote o producto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Estado">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="todos">Todos</option>
                <option value="disponible">Disponible</option>
                <option value="bloqueado">Bloqueado</option>
                <option value="agotado">Agotado</option>
              </select>
            </Field>
          </div>

          <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            {filteredLots.length} lote{filteredLots.length === 1 ? '' : 's'}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">
            Cargando cuarto frío...
          </div>
        ) : filteredLots.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay lotes en cuarto frío.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredLots.map((lot) => (
              <div
                key={lot.id}
                className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-base font-semibold text-stone-800">
                      {lot.product_name}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      Código: {lot.product_code || '—'} · Lote: {lot.finished_lot_code}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      Base: {lot.product_base_name || '—'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={getExpiryTone(lot.days_to_expire)}>
                      {getExpiryLabel(lot.days_to_expire)}
                    </StatusPill>

                    <StatusPill tone={lot.status === 'disponible' ? 'success' : lot.status === 'bloqueado' ? 'warning' : 'neutral'}>
                      {lot.status}
                    </StatusPill>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 border-t border-stone-200 pt-4 md:grid-cols-2 xl:grid-cols-4">
                  <InfoMini
                    label="Disponible"
                    value={`${formatNumber(lot.available_quantity)} ${lot.unit}`}
                  />
                  <InfoMini
                    label="Costo unitario"
                    value={formatNumber(lot.unit_cost)}
                  />
                  <InfoMini
                    label="Producción"
                    value={formatDate(lot.production_date)}
                  />
                  <InfoMini
                    label="Vencimiento"
                    value={formatDate(lot.expiration_date)}
                  />
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InfoMini
                    label="Ubicación"
                    value={lot.storage_location || lot.location || 'cuarto_frio'}
                  />
                  <InfoMini
                    label="Peso neto SKU"
                    value={`${formatNumber(lot.product_net_weight)} ${lot.product_unit || ''}`}
                  />
                  <InfoMini
                    label="Vida útil"
                    value={`${formatNumber(lot.shelf_life_days)} días`}
                  />
                  <div className="rounded-xl bg-white px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-stone-400">Cambiar estado</div>
                    <select
                      value={lot.status}
                      onChange={(e) => handleStatusChange(lot.id, e.target.value)}
                      disabled={savingId === lot.id}
                      className="mt-2 w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 disabled:opacity-60"
                    >
                      <option value="disponible">Disponible</option>
                      <option value="bloqueado">Bloqueado</option>
                      <option value="agotado">Agotado</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function InfoMini({ label, value }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-stone-800">{value}</div>
    </div>
  )
}
