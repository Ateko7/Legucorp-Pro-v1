function badgeClass(severity) {
  if (severity === 'critica') return 'bg-rose-100 text-rose-700'
  if (severity === 'alta') return 'bg-orange-100 text-orange-700'
  if (severity === 'media') return 'bg-amber-100 text-amber-700'
  return 'bg-stone-100 text-stone-600'
}

export default function CommercialAlertsTable({ alerts = [], onResolve, compact = false }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
      <div className="border-b border-stone-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-stone-800">Alertas comerciales</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
            <tr>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Relacionado</th>
              <th className="px-4 py-3 text-left">Severidad</th>
              <th className="px-4 py-3 text-left">Descripcion</th>
              <th className="px-4 py-3 text-left">Responsable</th>
              <th className="px-4 py-3 text-left">Estado</th>
              {!compact ? <th className="px-4 py-3 text-left">Accion</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {alerts.length ? alerts.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-medium text-stone-800">{item.alert_type}</td>
                <td className="px-4 py-3 text-stone-600">{item.related_name || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass(item.severity)}`}>{item.severity}</span>
                </td>
                <td className="px-4 py-3 text-stone-600">{item.description || item.title}</td>
                <td className="px-4 py-3 text-stone-600">{item.responsible_name || '-'}</td>
                <td className="px-4 py-3 text-stone-600">{item.status}</td>
                {!compact ? (
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onResolve?.(item)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                    >
                      Marcar resuelta
                    </button>
                  </td>
                ) : null}
              </tr>
            )) : (
              <tr><td colSpan={compact ? 6 : 7} className="px-4 py-8 text-center text-stone-500">Sin alertas activas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
