import Drawer from './Drawer'

function money(value) {
  return `Q ${Number(value || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(value) {
  return `${(Number(value || 0) * 100).toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export default function CustomerProfitabilityDetail({ open, onClose, row }) {
  if (!row) return null

  return (
    <Drawer open={open} onClose={onClose} title={row.client_name}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Metric label="Ventas netas" value={money(row.net_sales)} />
        <Metric label="Margen neto" value={money(row.net_margin)} />
        <Metric label="% margen neto" value={pct(row.net_margin_pct)} />
        <Metric label="Costo logistico" value={money(row.estimated_logistics_cost)} />
        <Metric label="Volumen" value={Number(row.purchased_volume || 0).toLocaleString('es-GT')} />
        <Metric label="Frecuencia" value={`${Number(row.purchase_frequency || 0).toLocaleString('es-GT')} pedidos`} />
      </div>

      <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-900">Clasificacion</h3>
        <div className="mt-3 text-sm text-stone-700">{row.classification || 'Sin clasificacion'}</div>
      </section>

      <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-900">Recomendaciones</h3>
        <div className="mt-3 space-y-2">
          {(row.recommendations || []).length ? row.recommendations.map((item) => (
            <div key={item} className="rounded-xl border border-stone-200 px-3 py-3 text-sm text-stone-700">{item}</div>
          )) : <div className="text-sm text-stone-500">Sin recomendaciones automáticas.</div>}
        </div>
      </section>
    </Drawer>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-stone-900">{value}</div>
    </div>
  )
}
