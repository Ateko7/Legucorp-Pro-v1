function groupByDate(items) {
  return items.reduce((acc, item) => {
    const date = new Date(item.scheduled_at).toISOString().slice(0, 10)
    if (!acc[date]) acc[date] = []
    acc[date].push(item)
    return acc
  }, {})
}

export default function FollowupCalendar({ followups = [] }) {
  const grouped = groupByDate(followups)
  const dates = Object.keys(grouped).sort()

  return (
    <div className="rounded-2xl border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-stone-800">Calendario simple</h3>
      </div>
      <div className="space-y-4 p-4">
        {dates.length ? dates.map((date) => (
          <div key={date}>
            <div className="text-xs font-semibold text-stone-500">{new Date(`${date}T00:00:00`).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
            <div className="mt-2 space-y-2">
              {grouped[date].map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 px-3 py-3">
                  <div>
                    <div className="font-medium text-stone-800">{item.related_name}</div>
                    <div className="text-sm text-stone-500">{item.followup_type} · {item.responsible_name || 'Sin responsable'}</div>
                  </div>
                  <div className="text-sm text-stone-600">
                    {new Date(item.scheduled_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )) : <div className="text-sm text-stone-500">Sin seguimientos programados.</div>}
      </div>
    </div>
  )
}
