import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import { getAlertCenterData, syncAlertCenter, updateAlertStatus } from '../services/alertCenterService'

const INPUT = 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100'

const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'today', label: 'Hoy' },
  { key: 'production', label: 'Producción' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'purchases', label: 'Compras' },
  { key: 'quality', label: 'Calidad' },
]

function levelTone(level) {
  if (level === 'critical') return 'border-red-200 bg-red-50 text-red-700'
  if (level === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

function statusTone(status) {
  if (status === 'reviewing') return 'bg-amber-100 text-amber-700'
  if (status === 'resolved') return 'bg-emerald-100 text-emerald-700'
  return 'bg-red-100 text-red-700'
}

function CounterCard({ label, value, tone }) {
  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${tone}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </div>
  )
}

function FilterButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? 'bg-[#2f5d50] text-white shadow-sm'
          : 'border border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
      }`}
    >
      {children}
    </button>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-3 text-sm last:border-b-0">
      <div className="font-medium text-stone-500">{label}</div>
      <div className="text-right text-stone-800">{value}</div>
    </div>
  )
}

export default function AlertCenterPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState({ counts: {}, alerts: [], total: 0, hasMore: false })
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)

  const loadAlerts = useCallback(async ({ reset = false, nextPage = 1, query = '', currentFilter = filter, sync = false } = {}) => {
    const targetPage = reset ? 1 : nextPage
    setLoading(true)
    setError('')
    try {
      const data = await getAlertCenterData({
        filter: currentFilter,
        page: targetPage,
        pageSize: 15,
        search: query,
        sync,
      })
      setPayload({
        ...data,
        alerts: data.alerts,
      })
      setPage(targetPage)
      setLastUpdatedAt(new Date())
    } catch (err) {
      setError(err.message || 'No se pudo cargar el centro de alertas')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    loadAlerts({ reset: true, sync: true })
  }, [loadAlerts])

  useRealtimeRefresh(
    [
      'alerts',
      'material_inventory_lots',
      'materials',
      'material_process_runs',
      'material_process_stage_outputs',
      'programas_agricolas',
      'programa_entregas',
      'supplier_scorecards',
      'inspecciones_calidad',
    ],
    () => loadAlerts({ reset: true, sync: false }),
    { debounceMs: 2000, minIntervalMs: 300000 },
  )

  async function handleSearchSubmit(e) {
    e.preventDefault()
    await syncAlertCenter()
    await loadAlerts({ reset: true, query: search, sync: false })
  }

  async function handleRefreshNow() {
    try {
      setLoading(true)
      setError('')
      await syncAlertCenter()
      await loadAlerts({ reset: true, query: search, sync: false })
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el centro de alertas')
      setLoading(false)
    }
  }

  async function handleStatusChange(alertId, status) {
    try {
      await updateAlertStatus(alertId, status)
      await loadAlerts({ reset: true, sync: false })
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la alerta')
    }
  }

  function handlePrimaryAction(alert) {
    if (alert.status === 'active') {
      handleStatusChange(alert.id, 'reviewing')
    }
    navigate(alert.action_url)
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Operación</p>
          <h1 className="text-3xl font-semibold text-stone-800">Centro de alertas</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-500">
            Detección, priorización y acción inmediata sobre lo que está mal en inventario, producción, compras y calidad.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-right text-xs text-stone-500">
            Ultima actualizacion:{' '}
            <span className="font-medium text-stone-700">
              {lastUpdatedAt ? lastUpdatedAt.toLocaleString('es-GT') : 'Sin datos aun'}
            </span>
          </div>
          <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleSearchSubmit}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar alerta, lote, proveedor o material..."
              className={`${INPUT} min-w-[280px]`}
            />
            <button type="submit" className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#264c42]">
              Buscar
            </button>
            <button
              type="button"
              onClick={handleRefreshNow}
              disabled={loading}
              className="rounded-2xl border border-emerald-700 bg-white px-5 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Actualizar ahora
            </button>
          </form>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <CounterCard label="Críticas" value={payload.counts.critical || 0} tone="border-red-200 bg-red-50 text-red-700" />
        <CounterCard label="Riesgos" value={payload.counts.warning || 0} tone="border-amber-200 bg-amber-50 text-amber-700" />
        <CounterCard label="Informativas" value={payload.counts.info || 0} tone="border-sky-200 bg-sky-50 text-sky-700" />
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <FilterButton key={item.key} active={filter === item.key} onClick={() => setFilter(item.key)}>
              {item.label}
            </FilterButton>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="rounded-[28px] border border-stone-200 bg-white px-6 py-16 text-center text-sm text-stone-500 shadow-sm">
          Cargando alertas operativas...
        </div>
      ) : (
        <section className="space-y-4">
          {(payload.alerts || []).length ? (
            (payload.alerts || []).map((alert) => (
              <article key={alert.id} className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelTone(alert.level)}`}>
                        {alert.level_label}
                      </span>
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
                        {alert.area_label}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(alert.status)}`}>
                        {alert.status === 'active' ? 'Activa' : alert.status === 'reviewing' ? 'En revisión' : 'Resuelta'}
                      </span>
                    </div>

                    <h2 className="mt-3 text-xl font-semibold text-stone-900">{alert.title}</h2>
                    <p className="mt-2 text-sm text-stone-600">{alert.description}</p>

                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-stone-400">
                      <span>{new Date(alert.created_at).toLocaleString('es-GT')}</span>
                      <span>{alert.entity_type}</span>
                      {alert.metadata?.material_name ? <span>{alert.metadata.material_name}</span> : null}
                      {alert.metadata?.supplier_name ? <span>{alert.metadata.supplier_name}</span> : null}
                      {alert.metadata?.lot_code ? <span>Lote {alert.metadata.lot_code}</span> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:w-[320px] xl:justify-end">
                    <button onClick={() => setSelectedAlert(alert)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
                      Ver detalle
                    </button>
                    <button onClick={() => handlePrimaryAction(alert)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42]">
                      {alert.action_label}
                    </button>
                    {alert.status !== 'reviewing' ? (
                      <button onClick={() => handleStatusChange(alert.id, 'reviewing')} className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100">
                        En revisión
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-[28px] border border-dashed border-stone-300 bg-white px-6 py-16 text-center text-sm text-stone-500 shadow-sm">
              No hay alertas activas para este filtro.
            </div>
          )}

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => loadAlerts({ reset: false, nextPage: Math.max(1, page - 1) })}
              disabled={page <= 1 || loading}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Anterior
            </button>
            <div className="text-sm text-stone-500">Página {page}</div>
            <button
              onClick={() => loadAlerts({ reset: false, nextPage: page + 1 })}
              disabled={!payload.hasMore || loading}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </section>
      )}

      <Modal isOpen={!!selectedAlert} onClose={() => setSelectedAlert(null)} title="Detalle de alerta" maxWidth="max-w-2xl">
        {selectedAlert ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${levelTone(selectedAlert.level)}`}>{selectedAlert.level_label}</span>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">{selectedAlert.area_label}</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(selectedAlert.status)}`}>
                {selectedAlert.status === 'active' ? 'Activa' : selectedAlert.status === 'reviewing' ? 'En revisión' : 'Resuelta'}
              </span>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-stone-900">{selectedAlert.title}</h3>
              <p className="mt-2 text-sm text-stone-600">{selectedAlert.description}</p>
            </div>

            <div className="rounded-[24px] border border-stone-200 bg-stone-50 px-5 py-3">
              <DetailRow label="Área" value={selectedAlert.area_label} />
              <DetailRow label="Fecha" value={new Date(selectedAlert.created_at).toLocaleString('es-GT')} />
              <DetailRow label="Entidad" value={selectedAlert.entity_type} />
              <DetailRow label="Estado" value={selectedAlert.status} />
              <DetailRow label="Ruta de acción" value={selectedAlert.action_url} />
            </div>

            {selectedAlert.metadata && Object.keys(selectedAlert.metadata).length ? (
              <div className="rounded-[24px] border border-stone-200 bg-white px-5 py-3">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Contexto</div>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-stone-600">
                  {JSON.stringify(selectedAlert.metadata, null, 2)}
                </pre>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3">
              {selectedAlert.status !== 'reviewing' ? (
                <button onClick={() => handleStatusChange(selectedAlert.id, 'reviewing')} className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100">
                  Marcar en revisión
                </button>
              ) : null}
              <button onClick={() => handlePrimaryAction(selectedAlert)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42]">
                {selectedAlert.action_label}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
