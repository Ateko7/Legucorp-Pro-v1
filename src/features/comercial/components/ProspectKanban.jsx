const STATUSES = ['nuevo', 'contactado', 'interesado', 'cotizacion_enviada', 'negociacion', 'prueba_producto', 'aprobado', 'convertido', 'perdido']

export default function ProspectKanban({ prospects, onOpen }) {
  const grouped = STATUSES.map((status) => ({
    status,
    items: prospects.filter((item) => item.status === status),
  }))

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      {grouped.map((group) => (
        <section key={group.status} className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-stone-800">{group.status.replaceAll('_', ' ')}</h3>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">{group.items.length}</span>
            </div>
          </div>
          <div className="space-y-3 p-3">
            {group.items.length ? group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                className="block w-full rounded-xl border border-stone-200 bg-[#faf9f7] px-3 py-3 text-left hover:border-[#cbbca8]"
              >
                <div className="font-medium text-stone-800">{item.commercial_name}</div>
                <div className="mt-1 text-sm text-stone-500">{item.contact_name || 'Sin contacto'} · {Number(item.closing_probability || 0)}%</div>
                <div className="mt-2 text-xs text-stone-500">{item.channel || 'Sin canal'}</div>
              </button>
            )) : <div className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-sm text-stone-400">Sin prospectos</div>}
          </div>
        </section>
      ))}
    </div>
  )
}
