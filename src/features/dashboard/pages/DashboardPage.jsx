import { useEffect, useState, useCallback } from 'react'
import { getOperativoDashboard, getFinancieroDashboard, getKpiManoObra } from '../services/dashboardService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v) { return Number(v || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function n(v)   { return Number(v || 0) }

function Spinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-[#2f5d50]" />
    </div>
  )
}

function Bar({ value, max, color = 'bg-[#2f5d50]' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function MiniBarChart({ data, valueFmt }) {
  const max = Math.max(...data.map(d => d.value), 1)
  const label = valueFmt || ((d) => `Q${fmt(d.value)}`)
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map(d => {
        const pct = (d.value / max) * 100
        const has = d.value > 0
        return (
          <div key={d.date} className="group relative flex flex-1 flex-col items-center">
            <div className={`w-full rounded-t transition-all ${has ? 'bg-[#2f5d50]' : 'bg-stone-100'}`}
              style={{ height: `${Math.max(pct, has ? 8 : 4)}%` }} />
            {has && (
              <div className="absolute bottom-full mb-1 hidden group-hover:flex whitespace-nowrap rounded-lg bg-stone-800 px-2 py-1 text-xs text-white shadow-lg z-10">
                {d.date.slice(5)} · {label(d)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
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

// ─── Constantes ───────────────────────────────────────────────────────────────

const STATUS_LABEL = {
  confirmado: 'Confirmado', empacado: 'Empacado', despachado: 'Despachado',
  facturado: 'Facturado', en_logistica: 'En logística', entregado: 'Entregado', cobrado: 'Cobrado',
}
const STATUS_COLOR = {
  confirmado:   'bg-blue-100 text-blue-700',
  empacado:     'bg-amber-100 text-amber-700',
  despachado:   'bg-purple-100 text-purple-700',
  facturado:    'bg-sky-100 text-sky-700',
  en_logistica: 'bg-orange-100 text-orange-700',
  entregado:    'bg-teal-100 text-teal-700',
  cobrado:      'bg-emerald-100 text-emerald-700',
}

// ─── Helpers Costo MO ────────────────────────────────────────────────────────

function tendenciaLabel(t) {
  if (t === 'bajo')   return '↓ Bajo promedio 7d — eficiente'
  if (t === 'alto')   return '↑ Sobre promedio 7d — revisar'
  if (t === 'normal') return '→ Normal vs. promedio 7d'
  return 'Sin datos comparativos'
}

// ─── Dashboard Operativo ──────────────────────────────────────────────────────

function OperativoDashboard() {
  const [data,    setData]    = useState(null)
  const [kpiMO,   setKpiMO]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [opRes, moRes] = await Promise.allSettled([
        getOperativoDashboard(),
        getKpiManoObra(),
      ])
      if (opRes.status === 'rejected') throw new Error(opRes.reason?.message || 'Error cargando dashboard')
      setData(opRes.value)
      setKpiMO(moRes.status === 'fulfilled' ? moRes.value : null)
    }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>

  const { orders, inventory, expiringLots, topProducts, mpItems, revenueChart, processRuns, pendingPOs } = data
  const activeOrders = (orders.byStatus.confirmado || 0) + (orders.byStatus.empacado || 0) + (orders.byStatus.despachado || 0)
  const lowStockMp   = mpItems.filter(m => m.alert)
  const inLogistica  = (orders.byStatus.en_logistica || 0) + (orders.byStatus.entregado || 0)

  return (
    <div className="space-y-6">
      {/* KPIs principales */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard
          label="Pedidos activos"
          value={activeOrders}
          sub={`${orders.byStatus.confirmado || 0} confirmados · ${orders.byStatus.empacado || 0} empacados`}
          accent
        />
        <KPICard
          label="En logística"
          value={inLogistica}
          sub={`${orders.byStatus.en_logistica || 0} en ruta · ${orders.byStatus.entregado || 0} entregados`}
        />
        <KPICard
          label="Inventario terminado"
          value={`${inventory.totalUnits.toFixed(0)} uds`}
          sub={`${inventory.items.length} SKU${inventory.items.length !== 1 ? 's' : ''} disponibles`}
        />
        <KPICard
          label="Alertas MP"
          value={lowStockMp.length > 0 ? `${lowStockMp.length} bajo mínimo` : '✓ Sin alertas'}
          sub={lowStockMp.length > 0 ? lowStockMp.map(m => m.name).join(', ') : 'Stock de materias primas OK'}
          warn={lowStockMp.length > 0}
        />
      </div>

      {/* KPI Costo Mano de Obra */}
      {kpiMO && (
        <>
          {kpiMO.hoy?.observacion_inconsistencia && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
              <span className="font-bold shrink-0">⚠</span>
              <span>{kpiMO.hoy.observacion_inconsistencia}</span>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KPICard
              label="Costo MO/lb hoy"
              value={kpiMO.hoy?.costo_mano_obra_por_libra != null ? `Q ${fmt(kpiMO.hoy.costo_mano_obra_por_libra)}` : '—'}
              sub={tendenciaLabel(kpiMO.tendencia)}
              accent={kpiMO.tendencia === 'bajo'}
              warn={kpiMO.tendencia === 'alto'}
            />
            <KPICard
              label="Costo laboral hoy"
              value={kpiMO.hoy ? `Q ${fmt(kpiMO.hoy.costo_laboral_total_dia)}` : '—'}
              sub={`${kpiMO.hoy?.total_colaboradores_marcados ?? 0} colaboradores marcados`}
            />
            <KPICard
              label="Libras producidas hoy"
              value={kpiMO.hoy ? `${fmt(kpiMO.hoy.libras_producidas_dia)} lb` : '—'}
              sub={`${kpiMO.hoy?.runs_produccion ?? 0} runs de empaque`}
            />
            <KPICard
              label="Promedio MO/lb 7d"
              value={kpiMO.prom7d != null ? `Q ${fmt(kpiMO.prom7d)}` : '—'}
              sub={kpiMO.prom30d != null ? `Últ. 30d: Q ${fmt(kpiMO.prom30d)}/lb` : 'Últimos 7 días'}
            />
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Mano de obra</p>
                <h3 className="text-lg font-bold text-stone-800">Costo MO/lb — últimos 14 días</h3>
              </div>
              {kpiMO.tendencia !== 'sin_datos' && (
                <span className={`rounded-2xl px-3 py-1 text-xs font-semibold ${
                  kpiMO.tendencia === 'bajo' ? 'bg-emerald-50 text-emerald-700' :
                  kpiMO.tendencia === 'alto' ? 'bg-red-50 text-red-700' :
                  'bg-stone-50 text-stone-500'
                }`}>
                  {kpiMO.tendencia === 'bajo' ? '↓ Bajo promedio' : kpiMO.tendencia === 'alto' ? '↑ Sobre promedio' : '→ Normal'}
                </span>
              )}
            </div>
            <MiniBarChart
              data={kpiMO.tendencia14.map(d => ({ date: d.fecha, value: Number(d.costo_mano_obra_por_libra || 0) }))}
              valueFmt={(d) => `Q${d.value.toFixed(4)}/lb`}
            />
            <div className="mt-2 flex justify-between text-xs text-stone-300">
              <span>{kpiMO.tendencia14[0]?.fecha.slice(5)}</span>
              <span>{kpiMO.tendencia14[kpiMO.tendencia14.length - 1]?.fecha.slice(5)}</span>
            </div>
          </div>
        </>
      )}

      {/* Fila media */}
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">

        {/* Gráfico revenue 14 días */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pedidos emitidos</p>
              <h3 className="text-lg font-bold text-stone-800">Últimos 14 días</h3>
            </div>
            <span className="rounded-2xl bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Q {fmt(revenueChart.reduce((a, d) => a + d.value, 0))}
            </span>
          </div>
          <MiniBarChart data={revenueChart} />
          <div className="mt-2 flex justify-between text-xs text-stone-300">
            <span>{revenueChart[0]?.date.slice(5)}</span>
            <span>{revenueChart[revenueChart.length - 1]?.date.slice(5)}</span>
          </div>
        </div>

        {/* Estado de pedidos */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Flujo operativo</p>
          <h3 className="mt-1 mb-4 text-lg font-bold text-stone-800">Pedidos por estado</h3>
          {Object.keys(STATUS_LABEL).filter(s => orders.byStatus[s]).length === 0 ? (
            <p className="text-sm text-stone-400">Sin pedidos registrados.</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(STATUS_LABEL).map(([key, label]) => {
                const count = orders.byStatus[key] || 0
                if (!count) return null
                return (
                  <div key={key} className="flex items-center justify-between">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOR[key]}`}>{label}</span>
                    <div className="flex flex-1 items-center gap-3 ml-3">
                      <Bar value={count} max={orders.total} />
                      <span className="w-5 text-right text-sm font-bold text-stone-700">{count}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fila producción */}
      <div className="grid gap-5 xl:grid-cols-3">

        {/* Procesos MP activos + OC pendientes */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Producción</p>
            <h3 className="mt-1 text-lg font-bold text-stone-800">Procesos activos</h3>
          </div>
          {processRuns.length === 0 ? (
            <p className="text-sm text-stone-400">Sin procesos MP en curso.</p>
          ) : (
            <div className="space-y-2">
              {processRuns.slice(0, 4).map(r => (
                <div key={r.id} className="flex items-center justify-between rounded-2xl bg-stone-50 px-4 py-2.5">
                  <span className="text-sm text-stone-700 font-medium capitalize">{r.current_stage?.replace('_', ' ')}</span>
                  <span className="text-xs font-semibold text-stone-500">{n(r.input_quantity).toFixed(1)} kg entrada</span>
                </div>
              ))}
              {processRuns.length > 4 && (
                <p className="text-xs text-stone-400 text-center">+{processRuns.length - 4} más</p>
              )}
            </div>
          )}

          {pendingPOs.length > 0 && (
            <>
              <div className="border-t border-stone-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">OC pendientes recepción</p>
                <div className="space-y-2">
                  {pendingPOs.slice(0, 3).map(po => (
                    <div key={po.id} className="flex items-center justify-between">
                      <span className="text-sm text-stone-700">#{po.order_number}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-400">{po.suppliers?.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          po.status === 'parcial' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
                        }`}>{po.status}</span>
                      </div>
                    </div>
                  ))}
                  {pendingPOs.length > 3 && <p className="text-xs text-stone-400">+{pendingPOs.length - 3} más</p>}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Inventario terminado */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Cuarto frío</p>
          <h3 className="mt-1 mb-4 text-lg font-bold text-stone-800">Stock disponible</h3>
          {inventory.items.length === 0 ? (
            <p className="text-sm text-stone-400">Sin inventario registrado.</p>
          ) : (
            <div className="space-y-3">
              {inventory.items.map(item => (
                <div key={item.code}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-stone-800 truncate max-w-[160px]">{item.name}</span>
                    <span className="font-bold text-stone-900">{n(item.total).toFixed(0)} <span className="text-xs font-normal text-stone-400">{item.unit}</span></span>
                  </div>
                  <Bar value={item.total} max={inventory.items[0].total} />
                </div>
              ))}
            </div>
          )}
          {expiringLots.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">⚠ Vencen en 7 días</p>
              {expiringLots.map(l => (
                <div key={l.finished_lot_code} className="flex justify-between text-xs text-amber-800">
                  <span>{l.product_presentations?.code} · {l.finished_lot_code}</span>
                  <span className="font-semibold">{l.expiration_date}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stock MP */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Abastecimiento</p>
          <h3 className="mt-1 mb-4 text-lg font-bold text-stone-800">Stock materias primas</h3>
          {mpItems.length === 0 ? (
            <p className="text-sm text-stone-400">Sin datos de inventario MP.</p>
          ) : (
            <div className="space-y-3">
              {mpItems.slice(0, 7).map(m => (
                <div key={m.code}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-1.5 font-medium text-stone-800 truncate max-w-[150px]">
                      {m.alert && <span className="h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" />}
                      {m.name}
                    </span>
                    <span className={`font-bold ${m.alert ? 'text-red-600' : 'text-stone-900'}`}>
                      {n(m.stock).toFixed(1)} <span className="text-xs font-normal text-stone-400">{m.unit}</span>
                    </span>
                  </div>
                  <Bar value={m.stock} max={Math.max(m.minimum * 2, m.stock, 1)} color={m.alert ? 'bg-red-400' : 'bg-[#2f5d50]'} />
                  {m.minimum > 0 && <p className="mt-0.5 text-xs text-stone-400">Mínimo: {m.minimum} {m.unit}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top productos */}
      {topProducts.length > 0 && (
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Comercial</p>
          <h3 className="mt-1 mb-4 text-lg font-bold text-stone-800">Top productos por ventas</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {topProducts.map((p, idx) => (
              <div key={p.code} className="rounded-2xl bg-stone-50 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2f5d50] text-xs font-bold text-white">{idx + 1}</span>
                  <span className="text-sm font-semibold text-stone-800 truncate">{p.name}</span>
                </div>
                <div className="flex justify-between text-xs text-stone-500">
                  <span>{p.units} uds</span>
                  <span className="font-bold text-stone-900">Q {fmt(p.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Dashboard Financiero ─────────────────────────────────────────────────────

function FinancieroDashboard() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await getFinancieroDashboard()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <Spinner />
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>

  const { cxc, cxp, gastos, revenue, quotes, revMes } = data
  const maxGastoCC = gastos.porCC.length > 0 ? Math.max(...gastos.porCC.map(c => c.total)) : 1

  const agingRows = [
    { label: 'Al día',     value: cxc.aging.alDia, color: 'bg-emerald-500' },
    { label: '1–30 días',  value: cxc.aging.d30,   color: 'bg-amber-400' },
    { label: '31–60 días', value: cxc.aging.d60,   color: 'bg-orange-400' },
    { label: '61–90 días', value: cxc.aging.d90,   color: 'bg-red-400' },
    { label: '+90 días',   value: cxc.aging.dMas,  color: 'bg-rose-600' },
  ].filter(r => r.value > 0)

  return (
    <div className="space-y-6">

      {/* KPIs principales */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard
          label="Revenue mes actual"
          value={`Q ${fmt(revMes)}`}
          sub="Pedidos facturados y cobrados"
          accent
        />
        <KPICard
          label="Cobrado total"
          value={`Q ${fmt(revenue.cobrado)}`}
          sub={`Q ${fmt(revenue.pendiente)} pendiente de cobro`}
        />
        <KPICard
          label="CxC pendiente"
          value={`Q ${fmt(cxc.total)}`}
          sub={`${cxc.count} documento${cxc.count !== 1 ? 's' : ''} · Q ${fmt(cxc.vencido)} vencido`}
          warn={cxc.vencido > 0}
        />
        <KPICard
          label="CxP pendiente"
          value={`Q ${fmt(cxp.total)}`}
          sub={`${cxp.count} OC · Q ${fmt(cxp.vencido)} vencido`}
          warn={cxp.vencido > 0}
        />
      </div>

      {/* Fila media */}
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">

        {/* Aging CxC */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Cuentas por cobrar</p>
          <h3 className="mt-1 mb-1 text-lg font-bold text-stone-800">Antigüedad de saldos</h3>
          <p className="text-sm text-stone-400 mb-5">Total: <span className="font-bold text-stone-700">Q {fmt(cxc.total)}</span></p>

          {agingRows.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-medium">
              ✓ Sin cuentas por cobrar pendientes
            </div>
          ) : (
            <div className="space-y-3">
              {agingRows.map(row => (
                <div key={row.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-stone-700">{row.label}</span>
                    <span className="font-bold text-stone-900">Q {fmt(row.value)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                    <div className={`h-full rounded-full ${row.color} transition-all`}
                      style={{ width: `${cxc.total > 0 ? (row.value / cxc.total) * 100 : 0}%` }} />
                  </div>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {cxc.total > 0 ? ((row.value / cxc.total) * 100).toFixed(1) : 0}% del total CxC
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Resumen CxP */}
          {cxp.total > 0 && (
            <div className="mt-5 pt-5 border-t border-stone-100">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">Cuentas por pagar</p>
              <div className="flex items-center justify-between rounded-2xl bg-stone-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-stone-800">Q {fmt(cxp.total)}</p>
                  <p className="text-xs text-stone-400">{cxp.count} OC pendientes</p>
                </div>
                {cxp.vencido > 0 && (
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-600">Q {fmt(cxp.vencido)}</p>
                    <p className="text-xs text-red-400">Vencido</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Gastos del mes por CC */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Gastos operativos</p>
          <h3 className="mt-1 mb-1 text-lg font-bold text-stone-800">Mes actual por CC</h3>
          <p className="text-sm text-stone-400 mb-5">Total: <span className="font-bold text-stone-700">Q {fmt(gastos.mes)}</span></p>

          {gastos.porCC.length === 0 ? (
            <p className="text-sm text-stone-400">Sin gastos registrados este mes.</p>
          ) : (
            <div className="space-y-4">
              {gastos.porCC.map(cc => (
                <div key={cc.code}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-stone-700">{cc.code} — {cc.name}</span>
                    <span className="font-bold text-stone-900">Q {fmt(cc.total)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#2f5d50] transition-all"
                      style={{ width: `${(cc.total / maxGastoCC) * 100}%` }} />
                  </div>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {gastos.mes > 0 ? ((cc.total / gastos.mes) * 100).toFixed(1) : 0}% del total
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fila baja: cotizaciones + resumen cobro */}
      <div className="grid gap-5 md:grid-cols-2">

        {/* Cotizaciones */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pipeline comercial</p>
          <h3 className="mt-1 mb-5 text-lg font-bold text-stone-800">Cotizaciones</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Total</p>
              <p className="mt-1 text-2xl font-bold text-stone-900">{quotes.total}</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Emitidas</p>
              <p className="mt-1 text-2xl font-bold text-sky-700">{quotes.emitidas}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Aceptadas</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{quotes.aceptadas}</p>
            </div>
          </div>
          {quotes.total > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-stone-400 mb-1">
                <span>Tasa de conversión</span>
                <span className="font-semibold text-stone-700">
                  {((quotes.aceptadas / quotes.total) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${(quotes.aceptadas / quotes.total) * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Balance cobrado vs pendiente */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Estado de cobranza</p>
          <h3 className="mt-1 mb-5 text-lg font-bold text-stone-800">Cobrado vs. pendiente</h3>
          {(revenue.cobrado + revenue.pendiente) === 0 ? (
            <p className="text-sm text-stone-400">Sin datos de revenue.</p>
          ) : (
            <>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-emerald-700">Cobrado</span>
                    <span className="font-bold text-emerald-700">Q {fmt(revenue.cobrado)}</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-stone-100 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${((revenue.cobrado) / (revenue.cobrado + revenue.pendiente)) * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-amber-700">Por cobrar</span>
                    <span className="font-bold text-amber-700">Q {fmt(revenue.pendiente)}</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-stone-100 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: `${((revenue.pendiente) / (revenue.cobrado + revenue.pendiente)) * 100}%` }} />
                  </div>
                </div>
              </div>
              <div className="mt-5 flex justify-between rounded-2xl bg-stone-50 px-4 py-3 text-sm font-semibold">
                <span className="text-stone-500">Total facturado</span>
                <span className="text-stone-900">Q {fmt(revenue.cobrado + revenue.pendiente)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [tab, setTab] = useState('operativo')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
            {tab === 'operativo' ? 'Panel operativo' : 'Panel financiero'}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900">Dashboard</h1>
          <p className="mt-1 text-sm text-stone-500">
            {new Date().toLocaleDateString('es-GT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 rounded-2xl border border-stone-200 bg-white p-1 w-fit">
          <button onClick={() => setTab('operativo')}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
              tab === 'operativo'
                ? 'bg-[#2f5d50] text-white shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}>
            Producción
          </button>
          <button onClick={() => setTab('financiero')}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
              tab === 'financiero'
                ? 'bg-[#2f5d50] text-white shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}>
            Financiero
          </button>
        </div>
      </div>

      {tab === 'operativo'  && <OperativoDashboard />}
      {tab === 'financiero' && <FinancieroDashboard />}
    </div>
  )
}
