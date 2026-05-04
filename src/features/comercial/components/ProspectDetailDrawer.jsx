import Drawer from './Drawer'

function StatusBadge({ status }) {
  const palette = {
    nuevo: 'bg-stone-200 text-stone-700',
    contactado: 'bg-sky-100 text-sky-700',
    interesado: 'bg-emerald-100 text-emerald-700',
    cotizacion_enviada: 'bg-amber-100 text-amber-700',
    negociacion: 'bg-orange-100 text-orange-700',
    prueba_producto: 'bg-violet-100 text-violet-700',
    aprobado: 'bg-emerald-100 text-emerald-800',
    convertido: 'bg-[#dce8e2] text-[#2f5d50]',
    perdido: 'bg-rose-100 text-rose-700',
    sin_respuesta: 'bg-stone-100 text-stone-600',
    pausado: 'bg-stone-100 text-stone-600',
  }
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${palette[status] || palette.nuevo}`}>{status?.replaceAll('_', ' ')}</span>
}

export default function ProspectDetailDrawer({ open, onClose, prospect, followups = [] }) {
  if (!prospect) return null

  return (
    <Drawer open={open} onClose={onClose} title={prospect.commercial_name}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={prospect.status} />
          <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-700">
            {Number(prospect.closing_probability || 0)}% probabilidad
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Info label="Contacto" value={prospect.contact_name} />
          <Info label="Cargo" value={prospect.contact_role} />
          <Info label="Telefono" value={prospect.phone} />
          <Info label="Correo" value={prospect.email} />
          <Info label="Canal" value={prospect.channel} />
          <Info label="Fuente" value={prospect.lead_source} />
          <Info label="Producto de interes" value={prospect.interest_category} />
          <Info label="Potencial mensual" value={`Q ${Number(prospect.estimated_monthly_potential || 0).toLocaleString('es-GT')}`} />
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-900">Historial de seguimientos</h3>
          <div className="mt-4 space-y-3">
            {followups.length ? followups.map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-200 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-stone-800">{item.followup_type}</div>
                  <div className="text-xs text-stone-500">{new Date(item.scheduled_at).toLocaleString('es-GT')}</div>
                </div>
                <div className="mt-1 text-sm text-stone-600">{item.notes || item.next_action || 'Sin notas'}</div>
              </div>
            )) : <div className="text-sm text-stone-500">Sin seguimientos registrados.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-900">Observaciones</h3>
          <p className="mt-3 text-sm leading-6 text-stone-600">{prospect.observations || 'Sin observaciones registradas.'}</p>
        </section>
      </div>
    </Drawer>
  )
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="mt-2 text-sm text-stone-800">{value || 'Sin dato'}</div>
    </div>
  )
}
