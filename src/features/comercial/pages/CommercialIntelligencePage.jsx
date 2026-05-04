import CommercialAlertsTable from '../components/CommercialAlertsTable'
import CommercialStatCard from '../components/CommercialStatCard'
import { useCommercialModule } from '../hooks/useCommercialModule'
import { getCommercialIntelligencePageData, resolveCommercialAlert } from '../services/commercialService'

export default function CommercialIntelligencePage() {
  const { data, loading, error, reload } = useCommercialModule(getCommercialIntelligencePageData, {
    alerts: [],
    prospects: [],
    profitability: [],
  })

  async function handleResolve(item) {
    await resolveCommercialAlert(item.id)
    await reload()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-stone-900">Inteligencia comercial</h1>
        <p className="mt-1 text-sm text-stone-500">Detecta clientes en riesgo, prospectos calientes sin seguimiento, cotizaciones olvidadas y oportunidades de mejora comercial.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-stone-200 bg-white px-5 py-10 text-sm text-stone-500">Cargando inteligencia comercial...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CommercialStatCard label="Alertas nuevas" value={data.alerts.filter((item) => item.status === 'nueva').length} tone="red" />
        <CommercialStatCard label="Severidad crítica/alta" value={data.alerts.filter((item) => ['critica', 'alta'].includes(item.severity)).length} tone="amber" />
        <CommercialStatCard label="Prospectos sin seguimiento" value={data.alerts.filter((item) => String(item.alert_type).toLowerCase().includes('prospect')).length} />
        <CommercialStatCard label="Clientes no rentables" value={data.profitability.filter((item) => Number(item.net_margin || 0) <= 0).length} tone="red" />
      </div>

      <CommercialAlertsTable alerts={data.alerts} onResolve={handleResolve} />
    </div>
  )
}
