import { useMemo, useState } from 'react'
import CommercialStatCard from '../components/CommercialStatCard'
import CustomerProfitabilityDetail from '../components/CustomerProfitabilityDetail'
import { useCommercialModule } from '../hooks/useCommercialModule'
import { exportRowsToWorkbook, getCustomerProfitabilityPageData } from '../services/commercialService'

function pct(value) {
  return `${(Number(value || 0) * 100).toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export default function CustomerProfitabilityPage() {
  const { data, loading, error } = useCommercialModule(getCustomerProfitabilityPageData, { profitability: [] })
  const [selected, setSelected] = useState(null)

  const summary = useMemo(() => {
    const rows = data.profitability || []
    return {
      profitable: rows.filter((item) => Number(item.net_margin || 0) > 0).length,
      lowMargin: rows.filter((item) => Number(item.net_margin_pct || 0) < 0.12).length,
      strategic: rows.filter((item) => String(item.classification || '').toLowerCase().includes('alto volumen')).length,
      totalNetSales: rows.reduce((acc, item) => acc + Number(item.net_sales || 0), 0),
    }
  }, [data.profitability])

  function handleExport() {
    exportRowsToWorkbook({
      fileName: 'rentabilidad-clientes.xlsx',
      sheets: [
        {
          name: 'Rentabilidad',
          rows: (data.profitability || []).map((item) => ({
            cliente: item.client_name,
            canal: item.channel,
            ventas_netas: item.net_sales,
            margen_neto: item.net_margin,
            margen_neto_pct: pct(item.net_margin_pct),
            clasificacion: item.classification,
          })),
        },
      ],
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">Rentabilidad por cliente</h1>
          <p className="mt-1 text-sm text-stone-500">Cruza ventas, costos, logística y reclamos para priorizar clientes, renegociar condiciones y detectar cuentas no rentables.</p>
        </div>
        <button type="button" onClick={handleExport} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-white">
          Exportar Excel
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-stone-200 bg-white px-5 py-10 text-sm text-stone-500">Cargando rentabilidad...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CommercialStatCard label="Clientes rentables" value={summary.profitable} tone="green" />
        <CommercialStatCard label="Margen bajo" value={summary.lowMargin} tone="amber" />
        <CommercialStatCard label="Clientes estrategicos" value={summary.strategic} />
        <CommercialStatCard label="Ventas netas" value={summary.totalNetSales} format="money" />
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
              <tr>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Canal</th>
                <th className="px-4 py-3 text-left">Ventas netas</th>
                <th className="px-4 py-3 text-left">Costo logístico</th>
                <th className="px-4 py-3 text-left">Margen neto</th>
                <th className="px-4 py-3 text-left">% margen neto</th>
                <th className="px-4 py-3 text-left">Clasificación</th>
                <th className="px-4 py-3 text-left">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {(data.profitability || []).map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium text-stone-800">{item.client_name}</td>
                  <td className="px-4 py-3 text-stone-600">{item.channel || '-'}</td>
                  <td className="px-4 py-3 text-stone-600">Q {Number(item.net_sales || 0).toLocaleString('es-GT')}</td>
                  <td className="px-4 py-3 text-stone-600">Q {Number(item.estimated_logistics_cost || 0).toLocaleString('es-GT')}</td>
                  <td className="px-4 py-3 text-stone-600">Q {Number(item.net_margin || 0).toLocaleString('es-GT')}</td>
                  <td className={`px-4 py-3 font-semibold ${Number(item.net_margin_pct || 0) < 0.12 ? 'text-rose-700' : 'text-emerald-700'}`}>{pct(item.net_margin_pct)}</td>
                  <td className="px-4 py-3 text-stone-600">{item.classification}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setSelected(item)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerProfitabilityDetail open={!!selected} onClose={() => setSelected(null)} row={selected} />
    </div>
  )
}
