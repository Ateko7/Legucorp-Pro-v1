const INPUT = 'mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-700 outline-none focus:border-[#2f5d50]'

function optionValue(item) {
  return typeof item === 'string' ? item : item?.code || ''
}

function optionLabel(item) {
  return typeof item === 'string' ? item : item?.label || item?.code || ''
}

export function getEmptyFollowup() {
  return {
    related_kind: 'prospecto',
    prospect_id: '',
    client_id: '',
    followup_type: 'llamada',
    scheduled_date: '',
    scheduled_time: '',
    priority: 'media',
    status: 'pendiente',
    result: '',
    next_action: '',
    notes: '',
    reminder: '',
  }
}

export default function FollowupForm({ value, onChange, prospects = [], clients = [], catalogs = {} }) {
  function patch(field, nextValue) {
    onChange((prev) => ({ ...prev, [field]: nextValue }))
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium text-stone-700">Relacionado con
        <select className={INPUT} value={value.related_kind || 'prospecto'} onChange={(e) => patch('related_kind', e.target.value)}>
          <option value="prospecto">Prospecto</option>
          <option value="cliente">Cliente</option>
        </select>
      </label>
      {value.related_kind === 'cliente' ? (
        <label className="text-sm font-medium text-stone-700">Cliente
          <select className={INPUT} value={value.client_id || ''} onChange={(e) => patch('client_id', e.target.value)}>
            <option value="">Selecciona cliente</option>
            {clients.map((item) => <option key={item.id} value={item.id}>{item.commercial_name}</option>)}
          </select>
        </label>
      ) : (
        <label className="text-sm font-medium text-stone-700">Prospecto
          <select className={INPUT} value={value.prospect_id || ''} onChange={(e) => patch('prospect_id', e.target.value)}>
            <option value="">Selecciona prospecto</option>
            {prospects.map((item) => <option key={item.id} value={item.id}>{item.commercial_name}</option>)}
          </select>
        </label>
      )}
      <label className="text-sm font-medium text-stone-700">Tipo de seguimiento
        <select className={INPUT} value={value.followup_type || 'llamada'} onChange={(e) => patch('followup_type', e.target.value)}>
          {(catalogs.followupTypes || []).map((item) => <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-stone-700">Prioridad
        <select className={INPUT} value={value.priority || 'media'} onChange={(e) => patch('priority', e.target.value)}>
          <option value="baja">Baja</option>
          <option value="media">Media</option>
          <option value="alta">Alta</option>
          <option value="urgente">Urgente</option>
        </select>
      </label>
      <label className="text-sm font-medium text-stone-700">Fecha programada
        <input className={INPUT} type="date" value={value.scheduled_date || ''} onChange={(e) => patch('scheduled_date', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Hora programada
        <input className={INPUT} type="time" value={value.scheduled_time || ''} onChange={(e) => patch('scheduled_time', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700 md:col-span-2">Notas
        <textarea className={`${INPUT} min-h-24`} value={value.notes || ''} onChange={(e) => patch('notes', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700 md:col-span-2">Proxima accion
        <textarea className={`${INPUT} min-h-20`} value={value.next_action || ''} onChange={(e) => patch('next_action', e.target.value)} />
      </label>
    </div>
  )
}
