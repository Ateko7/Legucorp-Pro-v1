const INPUT = 'mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-700 outline-none focus:border-[#2f5d50]'

const emptyProspect = {
  commercial_name: '',
  legal_name: '',
  nit: '',
  contact_name: '',
  contact_role: '',
  phone: '',
  whatsapp: '',
  email: '',
  commercial_address: '',
  zone: '',
  channel: '',
  business_type: '',
  lead_source: '',
  interest_category: '',
  estimated_volume: '',
  estimated_monthly_potential: '',
  closing_probability: 0,
  status: 'nuevo',
  observations: '',
  loss_reason: '',
}

export function getEmptyProspect() {
  return { ...emptyProspect }
}

function optionValue(item) {
  return typeof item === 'string' ? item : item?.code || ''
}

function optionLabel(item) {
  return typeof item === 'string' ? item : item?.label || item?.code || ''
}

export default function ProspectForm({ value, onChange, catalogs = {}, mode = 'create' }) {
  function patch(field, nextValue) {
    onChange((prev) => ({ ...prev, [field]: nextValue }))
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium text-stone-700">Nombre comercial *
        <input className={INPUT} value={value.commercial_name || ''} onChange={(e) => patch('commercial_name', e.target.value)} required />
      </label>
      <label className="text-sm font-medium text-stone-700">Razon social
        <input className={INPUT} value={value.legal_name || ''} onChange={(e) => patch('legal_name', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">NIT
        <input className={INPUT} value={value.nit || ''} onChange={(e) => patch('nit', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Contacto principal
        <input className={INPUT} value={value.contact_name || ''} onChange={(e) => patch('contact_name', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Cargo
        <input className={INPUT} value={value.contact_role || ''} onChange={(e) => patch('contact_role', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Telefono
        <input className={INPUT} value={value.phone || ''} onChange={(e) => patch('phone', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">WhatsApp
        <input className={INPUT} value={value.whatsapp || ''} onChange={(e) => patch('whatsapp', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Correo
        <input className={INPUT} type="email" value={value.email || ''} onChange={(e) => patch('email', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700 md:col-span-2">Direccion
        <input className={INPUT} value={value.commercial_address || ''} onChange={(e) => patch('commercial_address', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Zona
        <input className={INPUT} value={value.zone || ''} onChange={(e) => patch('zone', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Canal potencial
        <select className={INPUT} value={value.channel || ''} onChange={(e) => patch('channel', e.target.value)}>
          <option value="">Selecciona</option>
          {(catalogs.channels || []).map((item) => <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-stone-700">Tipo de negocio
        <input className={INPUT} value={value.business_type || ''} onChange={(e) => patch('business_type', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Fuente
        <select className={INPUT} value={value.lead_source || ''} onChange={(e) => patch('lead_source', e.target.value)}>
          <option value="">Selecciona</option>
          {(catalogs.leadSources || []).map((item) => <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-stone-700">Producto o categoria
        <input className={INPUT} value={value.interest_category || ''} onChange={(e) => patch('interest_category', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Volumen estimado
        <input className={INPUT} type="number" step="0.01" value={value.estimated_volume || ''} onChange={(e) => patch('estimated_volume', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Potencial mensual estimado
        <input className={INPUT} type="number" step="0.01" value={value.estimated_monthly_potential || ''} onChange={(e) => patch('estimated_monthly_potential', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Probabilidad de cierre
        <input className={INPUT} type="number" min="0" max="100" value={value.closing_probability || 0} onChange={(e) => patch('closing_probability', e.target.value)} />
      </label>
      <label className="text-sm font-medium text-stone-700">Estado
        <select className={INPUT} value={value.status || 'nuevo'} onChange={(e) => patch('status', e.target.value)}>
          {(catalogs.prospectStates || []).map((item) => (
            <option key={optionValue(item)} value={optionValue(item)}>{optionLabel(item)}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-stone-700 md:col-span-2">Observaciones
        <textarea className={`${INPUT} min-h-24`} value={value.observations || ''} onChange={(e) => patch('observations', e.target.value)} />
      </label>
      {mode === 'edit' || value.status === 'perdido' ? (
        <label className="text-sm font-medium text-stone-700 md:col-span-2">Motivo de perdida
          <input className={INPUT} value={value.loss_reason || ''} onChange={(e) => patch('loss_reason', e.target.value)} />
        </label>
      ) : null}
    </div>
  )
}
