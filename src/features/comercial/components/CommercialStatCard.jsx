function formatValue(value, format) {
  if (format === 'money') {
    return `Q ${Number(value || 0).toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  if (format === 'percent') {
    return `${Number(value || 0).toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
  }
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString('es-GT')
    : value
}

export default function CommercialStatCard({ label, value, hint, tone = 'stone', format }) {
  const toneClasses = {
    stone: 'text-stone-900',
    green: 'text-emerald-800',
    amber: 'text-amber-700',
    red: 'text-rose-700',
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="text-sm font-medium text-stone-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClasses[tone] || toneClasses.stone}`}>
        {formatValue(value, format)}
      </div>
      {hint ? <div className="mt-2 text-xs text-stone-500">{hint}</div> : null}
    </div>
  )
}
