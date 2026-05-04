import { useMemo } from 'react'
import CommercialAlertsTable from '../components/CommercialAlertsTable'
import CommercialStatCard from '../components/CommercialStatCard'
import { useCommercialModule } from '../hooks/useCommercialModule'
import { getCommercialDashboard } from '../services/commercialService'

export default function CommercialDashboardPage() {
  const { data, loading, error } = useCommercialModule(getCommercialDashboard, {
    kpis: {},
    salesByChannel: [],
    salesByClient: [],
    riskClients: [],
    profitabilityHighlights: [],
    followups: [],
    alerts: [],
  })

  const cards = useMemo(() => ([
    { label: 'Ventas del mes', value: data.kpis.monthSales, format: 'money' },
    { label: 'Ventas vs presupuesto', value: data.kpis.salesVsBudget, format: 'percent', tone: data.kpis.salesVsBudget >= 100 ? 'green' : 'amber' },
    { label: 'Clientes activos', value: data.kpis.clientsActive },
    { label: 'Clientes inactivos', value: data.kpis.clientsInactive, tone: 'amber' },
    { label: 'Clientes nuevos', value: data.kpis.newClients, tone: 'green' },
    { label: 'Caida de compra', value: data.kpis.clientDropOff, tone: 'red' },
    { label: 'Prospectos nuevos', value: data.kpis.prospectNew },
    { label: 'Prospectos en seguimiento', value: data.kpis.prospectInFollowup },
    { label: 'Prospectos convertidos', value: data.kpis.prospectConverted, tone: 'green' },
    { label: 'Cotizaciones enviadas', value: data.kpis.quotesSent },
    { label: 'Cotizaciones aprobadas', value: data.kpis.quotesApproved, tone: 'green' },
    { label: 'Cotizaciones perdidas', value: data.kpis.quotesLost, tone: 'red' },
    { label: 'Tasa de conversion', value: data.kpis.conversionRate, format: 'percent' },
    { label: 'Seguimientos pendientes', value: data.kpis.followupsPending },
    { label: 'Seguimientos vencidos', value: data.kpis.followupsOverdue, tone: 'red' },
    { label: 'Seguimientos realizados', value: data.kpis.followupsDone, tone: 'green' },
    { label: 'Clientes con margen bajo', value: data.kpis.lowMarginClients, tone: 'amber' },
    { label: 'Clientes no rentables', value: data.kpis.unprofitableClients, tone: 'red' },
    { label: 'CxC comercial vencida', value: data.kpis.cxcOverdue, tone: 'amber' },
    { label: 'Reclamos abiertos', value: data.kpis.claimsOpen, tone: 'amber' },
  ]), [data])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-stone-900">Dashboard comercial</h1>
        <p className="text-sm text-stone-500">Seguimiento diario de ventas, pipeline, riesgo comercial y rentabilidad sin salir del ERP.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-stone-200 bg-white px-5 py-10 text-sm text-stone-500">Cargando dashboard comercial...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <CommercialStatCard key={card.label} {...card} />)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-900">Ventas por canal</h2>
          </div>
          <div className="space-y-4 p-4">
            {data.salesByChannel.map((item) => {
              const max = Math.max(...data.salesByChannel.map((row) => row.value), 1)
              return (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-stone-700">{item.label}</span>
                    <span className="font-medium text-stone-800">Q {item.value.toLocaleString('es-GT')}</span>
                  </div>
                  <div className="h-2 rounded-full bg-stone-100">
                    <div className="h-2 rounded-full bg-[#2f5d50]" style={{ width: `${(item.value / max) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-900">Seguimientos del dia</h2>
          </div>
          <div className="space-y-3 p-4">
            {data.followups.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-200 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-stone-800">{item.related_name}</div>
                  <div className="text-xs text-stone-500">{new Date(item.scheduled_at).toLocaleDateString('es-GT')}</div>
                </div>
                <div className="mt-1 text-sm text-stone-500">{item.followup_type} · {item.status}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-900">Clientes en riesgo</h2>
          </div>
          <div className="space-y-3 p-4">
            {data.riskClients.length ? data.riskClients.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-xl border border-stone-200 px-3 py-3">
                <div className="font-medium text-stone-800">{item.title}</div>
                <div className="mt-1 text-sm text-stone-500">{item.description}</div>
              </div>
            )) : <div className="text-sm text-stone-500">Sin clientes en riesgo hoy.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-900">Rentabilidad destacada</h2>
          </div>
          <div className="space-y-3 p-4">
            {data.profitabilityHighlights.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-xl border border-stone-200 px-3 py-3 sm:grid-cols-[1fr_auto_auto]">
                <div>
                  <div className="font-medium text-stone-800">{item.client_name}</div>
                  <div className="text-sm text-stone-500">{item.classification}</div>
                </div>
                <div className="text-sm text-stone-600">Q {Number(item.net_sales || 0).toLocaleString('es-GT')}</div>
                <div className={`text-sm font-semibold ${Number(item.net_margin_pct || 0) >= 0.2 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {(Number(item.net_margin_pct || 0) * 100).toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <CommercialAlertsTable alerts={data.alerts.slice(0, 8)} compact />
    </div>
  )
}
