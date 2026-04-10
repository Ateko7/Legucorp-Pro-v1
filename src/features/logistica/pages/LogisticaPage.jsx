import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  FUEL_TYPES,
  ROUTE_STATUS,
  STOP_STATUS,
  completeRouteStop,
  createRoute,
  fetchGuatemalaFuelPrices,
  finalizeRoute,
  formatDurationLabel,
  getFuelTypeLabel,
  getIncidentTypeLabel,
  getLogisticsModuleData,
  getRouteStatusLabel,
  getSeverityLabel,
  getStopStatusLabel,
  saveOfficialFuelPrice,
  saveExtraFuel,
  saveFuelHistoryEntry,
  saveLogisticsSettings,
  saveRouteIncident,
  saveVehicle,
  startRoute,
  toggleVehicleActive,
} from '../services/logisticaService'
import { createClaim } from '../../reclamos/services/reclamosService'

const TABS = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'crear', label: 'Crear ruta' },
  { key: 'detalle', label: 'Detalle ruta' },
  { key: 'piloto', label: 'Vista piloto' },
  { key: 'incidencias', label: 'Incidencias' },
  { key: 'configuracion', label: 'Configuracion' },
]

const INPUT =
  'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-[#2f5d50] focus:bg-white focus:ring-4 focus:ring-emerald-100'

const today = new Date().toISOString().slice(0, 10)

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function fmtQ(value) {
  return `Q ${n(value).toLocaleString('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function fmtKm(value) {
  return `${n(value).toLocaleString('es-GT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ children, tone = 'error' }) {
  const styles =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-red-200 bg-red-50 text-red-700'
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles}`}>{children}</div>
}

function KpiCard({ label, value, helper }) {
  return (
    <div className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">{label}</div>
      <div className="mt-3 text-2xl font-bold text-stone-800">{value}</div>
      {helper ? <div className="mt-2 text-sm text-stone-500">{helper}</div> : null}
    </div>
  )
}

function StatusPill({ children, tone = 'stone' }) {
  const styles = {
    stone: 'bg-stone-100 text-stone-700',
    amber: 'bg-amber-100 text-amber-800',
    emerald: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    sky: 'bg-sky-100 text-sky-700',
  }
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${styles[tone]}`}>{children}</span>
}

function routeTone(status) {
  if (status === ROUTE_STATUS.EN_RUTA) return 'amber'
  if (status === ROUTE_STATUS.FINALIZADA) return 'emerald'
  if (status === ROUTE_STATUS.CANCELADA) return 'red'
  return 'stone'
}

function stopTone(status) {
  if (status === STOP_STATUS.EN_CAMINO) return 'sky'
  if (status === STOP_STATUS.ENTREGADO) return 'emerald'
  if (status === STOP_STATUS.PARCIAL) return 'amber'
  if (status === STOP_STATUS.OMITIDO) return 'red'
  return 'stone'
}

function SectionCard({ title, subtitle, action, children }) {
  return (
    <section className="rounded-[30px] border border-stone-200 bg-white px-6 py-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-800">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-stone-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function MiniRouteMap({ route }) {
  const plantPoint =
    route?.plant_latitude != null && route?.plant_longitude != null
      ? {
          id: 'plant',
          type: 'planta',
          label: route.plant_name_snapshot || 'Planta',
          shortLabel: 'P',
          latitude: Number(route.plant_latitude),
          longitude: Number(route.plant_longitude),
          status: 'base',
          mapsLink:
            route.plant_latitude != null && route.plant_longitude != null
              ? `https://www.google.com/maps?q=${route.plant_latitude},${route.plant_longitude}`
              : '',
        }
      : null

  const orderPoints = (route?.ruta_pedidos || [])
    .filter((row) => row.delivery_latitude != null && row.delivery_longitude != null)
    .map((row) => ({
      id: row.id,
      type: 'cliente',
      label: row.client_name_snapshot || `Cliente ${row.sequence_no}`,
      shortLabel: String(row.sequence_no),
      latitude: Number(row.delivery_latitude),
      longitude: Number(row.delivery_longitude),
      status: row.status,
      mapsLink: row.delivery_latitude != null && row.delivery_longitude != null
        ? `https://www.google.com/maps?q=${row.delivery_latitude},${row.delivery_longitude}`
        : '',
    }))

  const points = [plantPoint, ...orderPoints].filter(Boolean)

  if (points.length < 2) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">
        Agrega coordenadas en planta y clientes para ver el mini mapa de la ruta.
      </div>
    )
  }

  const lats = points.map((point) => point.latitude)
  const lngs = points.map((point) => point.longitude)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const latRange = Math.max(maxLat - minLat, 0.0001)
  const lngRange = Math.max(maxLng - minLng, 0.0001)

  const width = 520
  const height = 260
  const padding = 28

  function project(point) {
    const x = padding + ((point.longitude - minLng) / lngRange) * (width - padding * 2)
    const y = height - padding - ((point.latitude - minLat) / latRange) * (height - padding * 2)
    return { ...point, x, y }
  }

  const projected = points.map(project)
  const orderedProjected = [
    projected.find((point) => point.type === 'planta'),
    ...projected.filter((point) => point.type === 'cliente').sort((a, b) => Number(a.shortLabel) - Number(b.shortLabel)),
    projected.find((point) => point.type === 'planta'),
  ].filter(Boolean)

  function pointTone(point) {
    if (point.type === 'planta') return { fill: '#2f5d50', text: '#ffffff', ring: '#cfe9df' }
    if (point.status === STOP_STATUS.ENTREGADO) return { fill: '#10b981', text: '#ffffff', ring: '#d1fae5' }
    if (point.status === STOP_STATUS.PARCIAL) return { fill: '#f59e0b', text: '#ffffff', ring: '#fef3c7' }
    if (point.status === STOP_STATUS.OMITIDO) return { fill: '#ef4444', text: '#ffffff', ring: '#fee2e2' }
    if (point.status === STOP_STATUS.EN_CAMINO) return { fill: '#0ea5e9', text: '#ffffff', ring: '#e0f2fe' }
    return { fill: '#1f2937', text: '#ffffff', ring: '#e7e5e4' }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[28px] border border-stone-200 bg-gradient-to-br from-[#f7f4ee] via-white to-[#eef7f2] p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] w-full">
          <defs>
            <pattern id="mini-route-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e7e5e4" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={width} height={height} fill="url(#mini-route-grid)" rx="22" />
          {orderedProjected.slice(0, -1).map((point, index) => {
            const nextPoint = orderedProjected[index + 1]
            return (
              <g key={`${point.id}-${index}`}>
                <line
                  x1={point.x}
                  y1={point.y}
                  x2={nextPoint.x}
                  y2={nextPoint.y}
                  stroke="#2f5d50"
                  strokeWidth="3"
                  strokeDasharray={point.type === 'planta' || nextPoint.type === 'planta' ? '8 6' : '0'}
                  opacity="0.75"
                />
              </g>
            )
          })}
          {projected.map((point) => {
            const tone = pointTone(point)
            return (
              <g key={point.id}>
                <circle cx={point.x} cy={point.y} r="18" fill={tone.ring} />
                <circle cx={point.x} cy={point.y} r="12" fill={tone.fill} />
                <text x={point.x} y={point.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={tone.text}>
                  {point.shortLabel}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projected
          .filter((point) => point.type === 'cliente')
          .sort((a, b) => Number(a.shortLabel) - Number(b.shortLabel))
          .map((point) => (
            <div key={point.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-stone-800">
                  {point.shortLabel}. {point.label}
                </div>
                <StatusPill tone={stopTone(point.status)}>{getStopStatusLabel(point.status)}</StatusPill>
              </div>
              <div className="mt-2 text-xs text-stone-500">
                {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
              </div>
              {point.mapsLink ? (
                <a href={point.mapsLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-[#2f5d50] hover:underline">
                  Abrir punto
                </a>
              ) : null}
            </div>
          ))}
      </div>
    </div>
  )
}

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Este navegador no soporta geolocalizacion'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: Number(position.coords.latitude).toFixed(7),
          longitude: Number(position.coords.longitude).toFixed(7),
          accuracy_meters: Math.round(Number(position.coords.accuracy || 0)),
        })
      },
      (error) => reject(new Error(error?.message || 'No se pudo obtener la ubicacion actual')),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    )
  })
}

function VehicleModal({ initialValue, saving, onClose, onSubmit }) {
  const [form, setForm] = useState(
    initialValue || {
      name: '',
      plate: '',
      fuel_type: 'diesel',
      fuel_efficiency_km_per_gallon: '',
      tank_capacity_gallons: '',
      notes: '',
    },
  )
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el vehiculo')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={initialValue?.id ? 'Editar vehiculo' : 'Nuevo vehiculo'} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          El codigo del vehiculo se genera automaticamente al guardar.
          {initialValue?.code ? (
            <span className="ml-1 font-semibold text-stone-700">Codigo actual: {initialValue.code}</span>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Nombre</span>
            <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Placa</span>
            <input value={form.plate} onChange={(e) => setForm((p) => ({ ...p, plate: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Combustible</span>
            <select value={form.fuel_type} onChange={(e) => setForm((p) => ({ ...p, fuel_type: e.target.value }))} className={INPUT}>
              {FUEL_TYPES.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Rendimiento km/galon</span>
            <input type="number" step="0.01" value={form.fuel_efficiency_km_per_gallon} onChange={(e) => setForm((p) => ({ ...p, fuel_efficiency_km_per_gallon: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Capacidad tanque</span>
            <input type="number" step="0.01" value={form.tank_capacity_gallons} onChange={(e) => setForm((p) => ({ ...p, tank_capacity_gallons: e.target.value }))} className={INPUT} />
          </label>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Notas</span>
          <textarea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={INPUT} />
        </label>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar vehiculo'}</button>
        </div>
      </form>
    </Modal>
  )
}

function FuelModal({ saving, onClose, onSubmit }) {
  const [form, setForm] = useState({ fuel_type: 'diesel', price_per_gallon: '', effective_date: today, notes: '' })
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el precio')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Nuevo precio de combustible" maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Tipo combustible</span>
          <select value={form.fuel_type} onChange={(e) => setForm((p) => ({ ...p, fuel_type: e.target.value }))} className={INPUT}>
            {FUEL_TYPES.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Precio por galon</span>
            <input type="number" step="0.01" value={form.price_per_gallon} onChange={(e) => setForm((p) => ({ ...p, price_per_gallon: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Fecha vigencia</span>
            <input type="date" value={form.effective_date} onChange={(e) => setForm((p) => ({ ...p, effective_date: e.target.value }))} className={INPUT} />
          </label>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Notas</span>
          <textarea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={INPUT} />
        </label>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar precio'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ClaimModal({ routeOrder, saving, onClose, onSubmit }) {
  const claimableItems = (routeOrder?.orders?.order_items || [])
    .map((item) => {
      const deliveredQuantity = Math.max(0, n(item.quantity_delivered) || n(item.quantity_packed) || n(item.quantity))
      return {
        order_item_id: item.id,
        product_presentation_id: item.product_presentations?.id || '',
        label: item.product_presentations?.display_name || item.product_presentations?.code || `Producto ${item.id?.slice(0, 6) || ''}`,
        unit: item.product_presentations?.unit || 'unid.',
        max_quantity: deliveredQuantity,
        unit_price: n(item.unit_price),
        standard_cost: n(item.product_presentations?.standard_cost),
      }
    })
    .filter((item) => item.max_quantity > 0)

  const [form, setForm] = useState({
    claimType: 'problema_entrega',
    description: '',
    claimItemId: claimableItems[0]?.order_item_id || '',
    quantity: claimableItems[0]?.max_quantity ? '1' : '',
  })
  const [error, setError] = useState('')
  const selectedItem = claimableItems.find((item) => item.order_item_id === form.claimItemId) || null
  const claimedQuantity = Math.max(0, n(form.quantity))
  const claimAmount = selectedItem ? claimedQuantity * n(selectedItem.unit_price) : 0
  const claimCostAmount = selectedItem ? claimedQuantity * n(selectedItem.standard_cost) : 0
  const potentialSaleLoss = claimAmount

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!selectedItem) {
      setError('Selecciona un producto reclamado')
      return
    }

    if (claimedQuantity <= 0 || claimedQuantity > n(selectedItem.max_quantity)) {
      setError('Las unidades reclamadas no son validas')
      return
    }

    try {
      await onSubmit({
        claimType: form.claimType,
        description: form.description,
        items: [{
          order_item_id: selectedItem.order_item_id,
          product_presentation_id: selectedItem.product_presentation_id,
          quantity: claimedQuantity,
          unit_price: selectedItem.unit_price,
          standard_cost: selectedItem.standard_cost,
        }],
      })
    } catch (err) {
      setError(err.message || 'No se pudo crear el reclamo')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Reportar reclamo" maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          <div className="font-semibold text-stone-800">{routeOrder?.client_name_snapshot}</div>
          <div className="mt-1">Pedido #{routeOrder?.orders?.order_number}</div>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Tipo de reclamo</span>
          <select value={form.claimType} onChange={(e) => setForm((prev) => ({ ...prev, claimType: e.target.value }))} className={INPUT}>
            <option value="calidad">Calidad</option>
            <option value="problema_entrega">Problema de entrega</option>
            <option value="cantidad">Cantidad</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Descripcion</span>
          <textarea rows={3} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} className={INPUT} />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Producto reclamado</span>
            <select value={form.claimItemId} onChange={(e) => setForm((prev) => ({ ...prev, claimItemId: e.target.value, quantity: '1' }))} className={INPUT}>
              <option value="">Selecciona un producto</option>
              {claimableItems.map((item) => (
                <option key={item.order_item_id} value={item.order_item_id}>
                  {item.label} · entregado {n(item.max_quantity).toFixed(2)} {item.unit}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Unidades reclamadas</span>
            <input type="number" step="0.01" min="0" max={selectedItem ? n(selectedItem.max_quantity) : undefined} value={form.quantity} onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))} className={INPUT} />
          </label>
        </div>
        {selectedItem ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Monto reclamo</div>
              <div className="mt-2 text-lg font-semibold text-stone-800">Q {fmtQ(claimAmount)}</div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Costo producto</div>
              <div className="mt-2 text-lg font-semibold text-stone-800">Q {fmtQ(claimCostAmount)}</div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Venta perdida potencial</div>
              <div className="mt-2 text-lg font-semibold text-stone-800">Q {fmtQ(potentialSaleLoss)}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Este pedido no tiene productos entregados disponibles para reclamar todavia.
          </div>
        )}
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-500">
          El reclamo se calcula automaticamente desde el producto, las unidades reclamadas, el precio vendido y el costo estandar del SKU.
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando...' : 'Crear reclamo'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function buildIncidentForm(route) {
  return {
    ruta_id: route?.id || '',
    ruta_pedido_id: route?.current_stop?.id || '',
    incident_type: 'trafico',
    severity: 'media',
    description: '',
    estimated_cost: '',
    support_file: null,
  }
}

function IncidentModal({ route, saving, onClose, onSubmit }) {
  const [form, setForm] = useState(() => buildIncidentForm(route))
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la incidencia')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Registrar incidencia" maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Las incidencias quedan ligadas a la ruta y sirven para explicar desviaciones de costo o retrasos.
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Cliente / parada</span>
          <select value={form.ruta_pedido_id} onChange={(e) => setForm((p) => ({ ...p, ruta_pedido_id: e.target.value }))} className={INPUT}>
            <option value="">Incidencia general de ruta</option>
            {(route?.ruta_pedidos || []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.sequence_no}. {row.client_name_snapshot}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Tipo</span>
            <select value={form.incident_type} onChange={(e) => setForm((p) => ({ ...p, incident_type: e.target.value }))} className={INPUT}>
              {INCIDENT_TYPES.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Severidad</span>
            <select value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value }))} className={INPUT}>
              {INCIDENT_SEVERITIES.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Descripcion</span>
          <textarea rows={4} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className={INPUT} />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Costo estimado</span>
            <input type="number" step="0.01" value={form.estimated_cost} onChange={(e) => setForm((p) => ({ ...p, estimated_cost: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Documento soporte</span>
            <input type="file" onChange={(e) => setForm((p) => ({ ...p, support_file: e.target.files?.[0] || null }))} className={INPUT} />
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar incidencia'}</button>
        </div>
      </form>
    </Modal>
  )
}

function buildExtraFuelForm(route) {
  return {
    ruta_id: route?.id || '',
    fuel_date: today,
    gallons: '',
    unit_price: '',
    reference_number: '',
    notes: '',
    support_file: null,
  }
}

function ExtraFuelModal({ route, saving, onClose, onSubmit }) {
  const [form, setForm] = useState(() => buildExtraFuelForm(route))
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el combustible extra')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Registrar combustible extra" maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Fecha</span>
            <input type="date" value={form.fuel_date} onChange={(e) => setForm((p) => ({ ...p, fuel_date: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Galones</span>
            <input type="number" step="0.01" value={form.gallons} onChange={(e) => setForm((p) => ({ ...p, gallons: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Precio unitario</span>
            <input type="number" step="0.01" value={form.unit_price} onChange={(e) => setForm((p) => ({ ...p, unit_price: e.target.value }))} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Boleta / referencia</span>
            <input value={form.reference_number} onChange={(e) => setForm((p) => ({ ...p, reference_number: e.target.value }))} className={INPUT} />
          </label>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Soporte</span>
          <input type="file" onChange={(e) => setForm((p) => ({ ...p, support_file: e.target.files?.[0] || null }))} className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Notas</span>
          <textarea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={INPUT} />
        </label>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar combustible'}</button>
        </div>
      </form>
    </Modal>
  )
}

function buildDeliveryItems(routeOrder) {
  return (routeOrder?.orders?.order_items || [])
    .map((item) => {
      const pending = Math.max(0, n(item.quantity_packed) - n(item.quantity_delivered))
      return {
        order_item_id: item.id,
        quantity_packed: pending,
        max_pending: pending,
        quantity_delivered: String(pending),
        display_name: item.product_presentations?.display_name || 'Producto',
        code: item.product_presentations?.code || '',
        unit: item.product_presentations?.unit || '',
      }
    })
    .filter((item) => item.max_pending > 0)
}

function DeliveryModal({ route, routeOrder, saving, onClose, onSubmit }) {
  const [items, setItems] = useState(() => buildDeliveryItems(routeOrder))
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [error, setError] = useState('')
  const [deliveryLocation, setDeliveryLocation] = useState(null)
  const [locating, setLocating] = useState(false)

  async function captureLocation() {
    setLocating(true)
    try {
      const location = await getBrowserLocation()
      setDeliveryLocation(location)
      return location
    } finally {
      setLocating(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      const currentLocation = deliveryLocation || await captureLocation()
      await onSubmit({
        route_id: route.id,
        ruta_pedido_id: routeOrder.id,
        delivery_items: items,
        photo_file: photoFile,
        notes,
        delivery_location: currentLocation,
      })
    } catch (err) {
      setError(err.message || 'No se pudo registrar la entrega')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Registrar entrega · ${routeOrder?.client_name_snapshot || ''}`} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Esta accion registra la entrega del cliente actual, actualiza el pedido y genera automaticamente el siguiente tramo.
        </div>
        <div className="space-y-3">
          {(items || []).length ? (
            items.map((item, index) => (
              <div key={item.order_item_id} className="grid gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 md:grid-cols-[1fr_140px]">
                <div>
                  <div className="text-sm font-semibold text-stone-800">{item.display_name}</div>
                  <div className="mt-1 text-xs text-stone-500">{item.code} · Pendiente {item.max_pending} {item.unit}</div>
                </div>
                <input type="number" min="0" max={item.max_pending} step="1" value={item.quantity_delivered} onChange={(e) => setItems((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, quantity_delivered: e.target.value } : row))} className={INPUT} />
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Este pedido ya no tiene cantidades pendientes para entregar.
            </div>
          )}
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Foto comprobante</span>
          <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} className={INPUT} />
        </label>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          La entrega guardara la ubicacion GPS actual del piloto en la ficha del cliente.
          {deliveryLocation ? (
            <span className="ml-1 font-semibold text-stone-700">
              {deliveryLocation.latitude}, {deliveryLocation.longitude}
              {deliveryLocation.accuracy_meters ? ` · ±${deliveryLocation.accuracy_meters}m` : ''}
            </span>
          ) : null}
        </div>
        <button type="button" onClick={captureLocation} disabled={locating || saving} className="w-full rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">
          {locating ? 'Capturando ubicacion...' : deliveryLocation ? 'Actualizar ubicacion GPS' : 'Capturar ubicacion GPS'}
        </button>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Notas</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={INPUT} />
        </label>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
          <button type="submit" disabled={saving || !(items || []).length} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Registrar entrega'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function LogisticaPage() {
  const [tab, setTab] = useState('resumen')
  const [workbench, setWorkbench] = useState(null)
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [fuelSyncingType, setFuelSyncingType] = useState('')
  const [fuelSyncInfo, setFuelSyncInfo] = useState(null)
  const [officialFuelData, setOfficialFuelData] = useState(null)
  const [officialFuelLoading, setOfficialFuelLoading] = useState(false)
  const [officialFuelError, setOfficialFuelError] = useState('')

  const [routeForm, setRouteForm] = useState({
    route_name: '',
    route_date: today,
    vehicle_id: '',
    driver_name: '',
    driver_phone: '',
    notes: '',
  })
  const [selectedOrders, setSelectedOrders] = useState([])
  const [settingsForm, setSettingsForm] = useState({
    plant_name: '',
    plant_address: '',
    plant_latitude: '',
    plant_longitude: '',
    default_currency: 'GTQ',
  })

  const [vehicleModal, setVehicleModal] = useState(null)
  const [showFuelModal, setShowFuelModal] = useState(false)
  const [showIncidentModal, setShowIncidentModal] = useState(false)
  const [showExtraFuelModal, setShowExtraFuelModal] = useState(false)
  const [deliveryTarget, setDeliveryTarget] = useState(null)
  const [claimTarget, setClaimTarget] = useState(null)

  const selectedRoute = workbench?.selectedRoute || null

  const loadData = useCallback(async (routeId = selectedRouteId) => {
    setLoading(true)
    setError('')
    try {
      const data = await getLogisticsModuleData(routeId)
      setWorkbench(data)
      setSelectedRouteId(data.selectedRoute?.id || null)
      setSettingsForm({
        plant_name: data.settings?.plant_name || '',
        plant_address: data.settings?.plant_address || '',
        plant_latitude: data.settings?.plant_latitude ?? '',
        plant_longitude: data.settings?.plant_longitude ?? '',
        default_currency: data.settings?.default_currency || 'GTQ',
      })
      setRouteForm((prev) => ({
        ...prev,
        vehicle_id: prev.vehicle_id || data.vehicles?.find((row) => row.is_active !== false)?.id || '',
      }))
    } catch (err) {
      setError(err.message || 'No se pudo cargar logistica')
    } finally {
      setLoading(false)
    }
  }, [selectedRouteId])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (tab !== 'configuracion') return
    if (officialFuelData || officialFuelLoading) return

    let active = true

    async function loadOfficialFuelData() {
      setOfficialFuelLoading(true)
      setOfficialFuelError('')
      try {
        const data = await fetchGuatemalaFuelPrices()
        if (active) setOfficialFuelData(data)
      } catch (err) {
        if (active) setOfficialFuelError(err.message || 'No se pudo consultar el precio oficial')
      } finally {
        if (active) setOfficialFuelLoading(false)
      }
    }

    loadOfficialFuelData()

    return () => {
      active = false
    }
  }, [tab, officialFuelData, officialFuelLoading])

  async function runAction(action, { reloadRouteId = selectedRouteId, after } = {}) {
    setSaving(true)
    setError('')
    try {
      const result = await action()
      if (after) after(result)
      await loadData(reloadRouteId ?? result ?? selectedRouteId)
    } catch (err) {
      setError(err.message || 'No se pudo completar la accion')
    } finally {
      setSaving(false)
    }
  }

  function addOrder(order) {
    if (selectedOrders.some((row) => row.order_id === order.id)) return
    setSelectedOrders((prev) => [
      ...prev,
      {
        order_id: order.id,
        order_number: order.order_number,
        client_id: order.client_id,
        client_name: order.client_name,
        delivery_address: order.delivery_address,
        delivery_latitude: order.delivery_latitude ?? '',
        delivery_longitude: order.delivery_longitude ?? '',
        total: order.total,
      },
    ])
  }

  function removeOrder(orderId) {
    setSelectedOrders((prev) => prev.filter((row) => row.order_id !== orderId))
  }

  function moveOrder(orderId, direction) {
    setSelectedOrders((prev) => {
      const index = prev.findIndex((row) => row.order_id === orderId)
      if (index < 0) return prev
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= prev.length) return prev
      const clone = [...prev]
      const temp = clone[index]
      clone[index] = clone[target]
      clone[target] = temp
      return clone
    })
  }

  const routeRows = useMemo(() => workbench?.routes || [], [workbench?.routes])
  const availableOrders = useMemo(() => workbench?.availableOrders || [], [workbench?.availableOrders])
  const incidents = useMemo(() => workbench?.incidents || [], [workbench?.incidents])
  const vehicles = useMemo(() => workbench?.vehicles || [], [workbench?.vehicles])
  const fuelHistory = useMemo(() => workbench?.fuelHistory || [], [workbench?.fuelHistory])
  const kpis = workbench?.kpis || {}
  const plantMapsLink = useMemo(() => {
    const lat = settingsForm.plant_latitude
    const lng = settingsForm.plant_longitude
    if (lat !== '' && lat != null && lng !== '' && lng != null) {
      return `https://www.google.com/maps?q=${lat},${lng}`
    }
    return settingsForm.plant_address
      ? `https://www.google.com/maps?q=${encodeURIComponent(settingsForm.plant_address)}`
      : ''
  }, [settingsForm.plant_address, settingsForm.plant_latitude, settingsForm.plant_longitude])
  const latestFuelByType = useMemo(() => {
    const map = {}
    for (const item of fuelHistory) {
      if (!map[item.fuel_type]) map[item.fuel_type] = item
    }
    return map
  }, [fuelHistory])

  const currentStop = selectedRoute?.current_stop || null

  function handleUseBrowserLocation() {
    if (!navigator.geolocation) {
      setError('Este navegador no soporta geolocalizacion')
      return
    }

    setGeoLoading(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSettingsForm((prev) => ({
          ...prev,
          plant_latitude: Number(position.coords.latitude).toFixed(7),
          plant_longitude: Number(position.coords.longitude).toFixed(7),
        }))
        setGeoLoading(false)
      },
      (geoError) => {
        setError(geoError?.message || 'No se pudo obtener la ubicacion actual')
        setGeoLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    )
  }

  async function handleSyncOfficialFuelPrice(fuelType) {
    setFuelSyncingType(fuelType)
    setFuelSyncInfo(null)
    setError('')
    try {
      const saved = await saveOfficialFuelPrice(fuelType)
      setFuelSyncInfo(saved)
      await loadData(selectedRouteId)
    } catch (err) {
      setError(err.message || 'No se pudo sincronizar el precio oficial')
    } finally {
      setFuelSyncingType('')
    }
  }

  async function refreshOfficialFuelData() {
    setOfficialFuelLoading(true)
    setOfficialFuelError('')
    try {
      const data = await fetchGuatemalaFuelPrices()
      setOfficialFuelData(data)
    } catch (err) {
      setOfficialFuelError(err.message || 'No se pudo consultar el precio oficial')
    } finally {
      setOfficialFuelLoading(false)
    }
  }

  async function handleStartRoute(routeId) {
    const location = await getBrowserLocation()
    await startRoute(routeId, location)
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[34px] border border-[#d8cdbf] bg-gradient-to-br from-[#fbf7f2] via-white to-[#f4ecdf] px-6 py-7 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9b8b78]">Logistica</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-800">Costeo real por ruta</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
              Ejecuta rutas con tramos autogenerados desde Google Maps, costea combustible por vehiculo y mira el impacto logistico acumulado por pedido.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => setTab('crear')} className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#264c42]">
              Nueva ruta
            </button>
            <button onClick={() => selectedRoute && setTab('piloto')} className="rounded-2xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50" disabled={!selectedRoute}>
              Vista piloto
            </button>
          </div>
        </div>
      </section>

      {error ? <Alert>{error}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Rutas activas" value={kpis.rutas_activas || 0} helper={`${kpis.pedidos_en_ruta || 0} paradas en curso`} />
        <KpiCard label="Km acumulados" value={fmtKm(kpis.km_totales || 0)} helper="Basado en tramos Google Maps" />
        <KpiCard label="Costo logistico" value={fmtQ(kpis.costo_total || 0)} helper={`Promedio pedido ${fmtQ(kpis.costo_promedio_pedido || 0)}`} />
        <KpiCard label="Costo por km" value={fmtQ(kpis.costo_promedio_km || 0)} helper={`${kpis.rutas_finalizadas || 0} rutas finalizadas`} />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((row) => (
          <button
            key={row.key}
            onClick={() => setTab(row.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === row.key ? 'bg-[#2f5d50] text-white shadow-sm' : 'bg-white text-stone-600 hover:bg-stone-100'
            }`}
          >
            {row.label}
          </button>
        ))}
      </div>

      {loading && !workbench ? (
        <div className="flex items-center justify-center rounded-[30px] border border-stone-200 bg-white px-6 py-16 shadow-sm">
          <Spinner />
        </div>
      ) : null}

      {!loading && tab === 'resumen' ? (
        <div className="space-y-6">
          <SectionCard title="Lista de rutas" subtitle="Rutas planificadas, activas y finalizadas con sus KPIs principales.">
            {routeRows.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-[0.18em] text-stone-400">
                    <tr>
                      <th className="px-3 py-3">Ruta</th>
                      <th className="px-3 py-3">Fecha</th>
                      <th className="px-3 py-3">Vehiculo</th>
                      <th className="px-3 py-3">Estado</th>
                      <th className="px-3 py-3">Pedidos</th>
                      <th className="px-3 py-3">Km</th>
                      <th className="px-3 py-3">Costo</th>
                      <th className="px-3 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeRows.map((route) => (
                      <tr key={route.id} className="border-t border-stone-100">
                        <td className="px-3 py-4">
                          <div className="font-semibold text-stone-800">Ruta #{route.route_number}</div>
                          <div className="text-xs text-stone-500">{route.route_name || route.driver_name || 'Sin alias'}</div>
                        </td>
                        <td className="px-3 py-4 text-stone-600">{route.route_date}</td>
                        <td className="px-3 py-4">
                          <div className="text-stone-700">{route.vehiculos?.name || 'Sin vehiculo'}</div>
                          <div className="text-xs text-stone-500">{route.vehiculos?.plate || ''}</div>
                        </td>
                        <td className="px-3 py-4"><StatusPill tone={routeTone(route.status)}>{getRouteStatusLabel(route.status)}</StatusPill></td>
                        <td className="px-3 py-4 text-stone-600">{route.total_orders}</td>
                        <td className="px-3 py-4 text-stone-600">{fmtKm(route.total_distance_km)}</td>
                        <td className="px-3 py-4 font-semibold text-stone-800">{fmtQ(route.total_route_cost)}</td>
                        <td className="px-3 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => { setSelectedRouteId(route.id); setTab('detalle'); loadData(route.id) }} className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                              Ver detalle
                            </button>
                            <button onClick={() => { setSelectedRouteId(route.id); setTab('piloto'); loadData(route.id) }} className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                              Piloto
                            </button>
                            {route.status === ROUTE_STATUS.PLANIFICADA ? (
                              <button onClick={() => runAction(() => handleStartRoute(route.id), { reloadRouteId: route.id, after: () => setSelectedRouteId(route.id) })} className="rounded-full bg-[#2f5d50] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#264c42]">
                                Iniciar
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">
                Aun no hay rutas creadas. Usa la pestaña de crear ruta para empezar.
              </div>
            )}
          </SectionCard>

          <SectionCard title="Pedidos disponibles para ruteo" subtitle="Solo se listan pedidos con cantidades empacadas pendientes y que no esten en otra ruta abierta.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {availableOrders.length ? availableOrders.map((order) => (
                <div key={order.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-stone-800">Pedido #{order.order_number}</div>
                      <div className="mt-1 text-sm text-stone-600">{order.client_name}</div>
                    </div>
                    <StatusPill tone={order.can_route ? 'emerald' : 'red'}>{order.can_route ? 'Listo' : 'Sin direccion'}</StatusPill>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-stone-500">
                    <div>Entrega: {order.delivery_date}</div>
                    <div>Pendiente: {order.pending_quantity}</div>
                    <div className="line-clamp-2">{order.delivery_address || 'Sin direccion'}</div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-sm font-semibold text-stone-800">{fmtQ(order.total)}</div>
                    <button onClick={() => { addOrder(order); setTab('crear') }} disabled={!order.can_route} className="rounded-full bg-[#2f5d50] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#264c42] disabled:opacity-40">
                      Agregar
                    </button>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500 md:col-span-2 xl:col-span-3">
                  No hay pedidos listos para asignar a una ruta en este momento.
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      ) : null}

      {!loading && tab === 'crear' ? (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Crear ruta" subtitle="Define vehiculo, piloto y secuencia de pedidos. La generacion de tramos ocurre al ejecutar la ruta.">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Alias ruta</span><input value={routeForm.route_name} onChange={(e) => setRouteForm((p) => ({ ...p, route_name: e.target.value }))} className={INPUT} /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Fecha ruta</span><input type="date" value={routeForm.route_date} onChange={(e) => setRouteForm((p) => ({ ...p, route_date: e.target.value }))} className={INPUT} /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Vehiculo</span><select value={routeForm.vehicle_id} onChange={(e) => setRouteForm((p) => ({ ...p, vehicle_id: e.target.value }))} className={INPUT}><option value="">Selecciona...</option>{vehicles.filter((row) => row.is_active !== false).map((row) => <option key={row.id} value={row.id}>{row.name} · {row.plate}</option>)}</select></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Piloto</span><input value={routeForm.driver_name} onChange={(e) => setRouteForm((p) => ({ ...p, driver_name: e.target.value }))} className={INPUT} /></label>
              <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Telefono piloto</span><input value={routeForm.driver_phone} onChange={(e) => setRouteForm((p) => ({ ...p, driver_phone: e.target.value }))} className={INPUT} /></label>
              <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Notas</span><textarea rows={3} value={routeForm.notes} onChange={(e) => setRouteForm((p) => ({ ...p, notes: e.target.value }))} className={INPUT} /></label>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => runAction(() => createRoute({ ...routeForm, orders: selectedOrders }), { reloadRouteId: null, after: (routeId) => { setSelectedOrders([]); setRouteForm((p) => ({ ...p, route_name: '', notes: '' })); setSelectedRouteId(routeId || null); setTab('detalle') } })} disabled={saving || !selectedOrders.length} className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
                {saving ? 'Guardando ruta...' : 'Guardar ruta'}
              </button>
              <button onClick={() => setSelectedOrders([])} type="button" className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                Limpiar secuencia
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Secuencia de pedidos" subtitle="Cada pedido absorbe el costo acumulado hasta su posicion, mas la salida y retorno prorrateados.">
            <div className="space-y-3">
              {selectedOrders.length ? selectedOrders.map((order, index) => (
                <div key={order.order_id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-sm font-bold text-[#2f5d50] shadow-sm">{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-stone-800">Pedido #{order.order_number} · {order.client_name}</div>
                      <div className="mt-2 text-xs text-stone-500">Direccion</div>
                      <textarea rows={2} value={order.delivery_address} onChange={(e) => setSelectedOrders((prev) => prev.map((row) => row.order_id === order.order_id ? { ...row, delivery_address: e.target.value } : row))} className={`${INPUT} mt-1`} />
                      <div className="mt-3 text-xs text-stone-500">
                        {order.delivery_latitude != null && order.delivery_latitude !== '' && order.delivery_longitude != null && order.delivery_longitude !== ''
                          ? `Ubicacion importada del cliente: ${order.delivery_latitude}, ${order.delivery_longitude}`
                          : 'Este pedido no tiene coordenadas guardadas en la ficha del cliente.'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => moveOrder(order.order_id, 'up')} type="button" className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-white">Subir</button>
                    <button onClick={() => moveOrder(order.order_id, 'down')} type="button" className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-white">Bajar</button>
                    <button onClick={() => removeOrder(order.order_id)} type="button" className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">Quitar</button>
                    <span className="ml-auto text-sm font-semibold text-stone-800">{fmtQ(order.total)}</span>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">
                  Agrega pedidos desde el resumen para construir la secuencia de la ruta.
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      ) : null}

      {!loading && tab === 'detalle' ? (
        selectedRoute ? (
          <div className="space-y-6">
            <SectionCard
              title={`Detalle ruta #${selectedRoute.route_number}`}
              subtitle={`${selectedRoute.route_name || 'Ruta sin alias'} · ${selectedRoute.route_date}`}
              action={
                <div className="flex flex-wrap gap-2">
                  {selectedRoute.status === ROUTE_STATUS.PLANIFICADA ? (
                    <button onClick={() => runAction(() => handleStartRoute(selectedRoute.id), { reloadRouteId: selectedRoute.id })} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
                      Iniciar ruta
                    </button>
                  ) : null}
                  {selectedRoute.status === ROUTE_STATUS.EN_RUTA && !currentStop ? (
                    <button onClick={() => runAction(() => finalizeRoute(selectedRoute.id), { reloadRouteId: selectedRoute.id })} className="rounded-2xl bg-stone-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-900">
                      Cerrar y costear
                    </button>
                  ) : null}
                  <button onClick={() => setShowExtraFuelModal(true)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                    Combustible extra
                  </button>
                  <button onClick={() => setShowIncidentModal(true)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                    Incidencia
                  </button>
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Estado" value={getRouteStatusLabel(selectedRoute.status)} helper={selectedRoute.driver_name || 'Piloto sin asignar'} />
                <KpiCard label="Costo total" value={fmtQ(selectedRoute.total_route_cost)} helper={`Km ${fmtKm(selectedRoute.total_distance_km)}`} />
                <KpiCard label="Duracion total" value={formatDurationLabel(n(selectedRoute.total_duration_minutes) * 60)} helper={`${selectedRoute.total_orders} pedidos`} />
                <KpiCard label="Combustible extra" value={fmtQ(selectedRoute.total_extra_fuel_cost)} helper={`${selectedRoute.total_incidents || 0} incidencias`} />
              </div>
            </SectionCard>

            <SectionCard title="Pedidos en secuencia" subtitle="Costo acumulado por pedido segun posicion de la ruta.">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-[0.18em] text-stone-400">
                    <tr>
                      <th className="px-3 py-3">Seq</th>
                      <th className="px-3 py-3">Pedido</th>
                      <th className="px-3 py-3">Estado</th>
                      <th className="px-3 py-3">Inicial</th>
                      <th className="px-3 py-3">Retorno</th>
                      <th className="px-3 py-3">Acumulado</th>
                      <th className="px-3 py-3">Extra</th>
                      <th className="px-3 py-3">Costo total</th>
                      <th className="px-3 py-3">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRoute.ruta_pedidos.map((row) => (
                      <tr key={row.id} className="border-t border-stone-100">
                        <td className="px-3 py-4 font-semibold text-stone-700">{row.sequence_no}</td>
                        <td className="px-3 py-4">
                          <div className="font-semibold text-stone-800">Pedido #{row.orders?.order_number}</div>
                          <div className="text-xs text-stone-500">{row.client_name_snapshot}</div>
                        </td>
                        <td className="px-3 py-4"><StatusPill tone={stopTone(row.status)}>{getStopStatusLabel(row.status)}</StatusPill></td>
                        <td className="px-3 py-4 text-stone-600">{fmtQ(row.allocated_initial_cost)}</td>
                        <td className="px-3 py-4 text-stone-600">{fmtQ(row.allocated_return_cost)}</td>
                        <td className="px-3 py-4 text-stone-600">{fmtQ(row.allocated_progressive_cost)}</td>
                        <td className="px-3 py-4 text-stone-600">{fmtQ(row.allocated_extra_fuel_cost)}</td>
                        <td className="px-3 py-4">
                          <div className="font-semibold text-stone-800">{fmtQ(row.allocated_total_cost)}</div>
                          {row.status === STOP_STATUS.ENTREGADO || row.status === STOP_STATUS.PARCIAL ? (
                            <button onClick={() => setClaimTarget(row)} className="mt-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                              Reportar reclamo
                            </button>
                          ) : null}
                        </td>
                        <td className={`px-3 py-4 font-semibold ${n(row.margin_amount) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtQ(row.margin_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="Mini mapa de ruta" subtitle="Vista visual de planta y clientes usando las coordenadas configuradas en la ruta.">
              <MiniRouteMap route={selectedRoute} />
            </SectionCard>

            <div className="grid gap-6 xl:grid-cols-2">
              <SectionCard title="Tramos autogenerados" subtitle="Cada tramo usa Google Maps y costo por combustible/rendimiento.">
                <div className="space-y-3">
                  {selectedRoute.ruta_tramos.length ? selectedRoute.ruta_tramos.map((segment) => (
                    <div key={segment.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-800">{segment.from_label} → {segment.to_label}</div>
                          <div className="mt-1 text-xs text-stone-500">{segment.segment_kind.replace('_', ' ')} · {formatDurationLabel(segment.duration_seconds)}</div>
                        </div>
                        <StatusPill tone="sky">Tramo {segment.sequence_no}</StatusPill>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl bg-white px-3 py-3 text-sm"><div className="text-xs text-stone-400">Distancia</div><div className="mt-1 font-semibold text-stone-800">{fmtKm(segment.distance_km)}</div></div>
                        <div className="rounded-2xl bg-white px-3 py-3 text-sm"><div className="text-xs text-stone-400">Combustible</div><div className="mt-1 font-semibold text-stone-800">{n(segment.estimated_gallons).toFixed(2)} gal</div></div>
                        <div className="rounded-2xl bg-white px-3 py-3 text-sm"><div className="text-xs text-stone-400">Costo</div><div className="mt-1 font-semibold text-stone-800">{fmtQ(segment.segment_cost)}</div></div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
                        <span>Precio usado {fmtQ(segment.fuel_price_per_gallon)}/gal</span>
                        {segment.fuel_price_effective_date ? <span>Vigencia {segment.fuel_price_effective_date}</span> : null}
                        {segment.fuel_price_source_name ? <span>Fuente {segment.fuel_price_source_name}</span> : null}
                        {segment.fuel_price_source_url ? <a href={segment.fuel_price_source_url} target="_blank" rel="noreferrer" className="font-semibold text-[#2f5d50] hover:underline">Ver fuente</a> : null}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">
                      Los tramos apareceran automaticamente cuando la ruta se inicie y se despachen los clientes.
                    </div>
                  )}
                </div>
              </SectionCard>

              <div className="space-y-6">
                <SectionCard title="Combustible extra" subtitle="Recargas no previstas que afectan el costo total de la ruta.">
                  <div className="space-y-3">
                    {selectedRoute.ruta_combustible_extra.length ? selectedRoute.ruta_combustible_extra.map((row) => (
                      <div key={row.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-semibold text-stone-800">{fmtQ(row.total_cost)}</div>
                          <div className="text-xs text-stone-500">{row.fuel_date}</div>
                        </div>
                        <div className="mt-2 text-xs text-stone-500">{n(row.gallons).toFixed(2)} gal · Q {n(row.unit_price).toFixed(2)}/gal · {row.reference_number || 'Sin referencia'}</div>
                        {row.support_file_url ? <a href={row.support_file_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-[#2f5d50] hover:underline">Ver soporte</a> : null}
                      </div>
                    )) : <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center text-sm text-stone-500">Sin registros de combustible extra.</div>}
                  </div>
                </SectionCard>

                <SectionCard title="Incidencias" subtitle="Eventos de ruta asociados a retrasos, rechazos o fallas operativas.">
                  <div className="space-y-3">
                    {selectedRoute.ruta_incidencias.length ? selectedRoute.ruta_incidencias.map((row) => (
                      <div key={row.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-stone-800">{getIncidentTypeLabel(row.incident_type)}</div>
                            <div className="mt-1 text-xs text-stone-500">{row.occurred_at?.slice(0, 16).replace('T', ' ')}</div>
                          </div>
                          <StatusPill tone={row.severity === 'alta' ? 'red' : row.severity === 'media' ? 'amber' : 'stone'}>{getSeverityLabel(row.severity)}</StatusPill>
                        </div>
                        <div className="mt-3 text-sm text-stone-600">{row.description}</div>
                        <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
                          <span>Costo estimado {fmtQ(row.estimated_cost)}</span>
                          {row.support_file_url ? <a href={row.support_file_url} target="_blank" rel="noreferrer" className="font-semibold text-[#2f5d50] hover:underline">Ver soporte</a> : null}
                        </div>
                      </div>
                    )) : <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center text-sm text-stone-500">La ruta aun no tiene incidencias registradas.</div>}
                  </div>
                </SectionCard>
              </div>
            </div>
          </div>
        ) : (
          <SectionCard title="Detalle ruta" subtitle="Selecciona una ruta desde el resumen para ver pedidos, tramos y costos.">
            <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">No hay una ruta seleccionada todavia.</div>
          </SectionCard>
        )
      ) : null}

      {!loading && tab === 'piloto' ? (
        routeRows.length ? (
          <div className="space-y-6">
            <SectionCard title="Rutas para piloto" subtitle="Selecciona cualquier ruta para abrir su vista operativa.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {routeRows.map((route) => (
                  <button
                    key={route.id}
                    onClick={() => {
                      setSelectedRouteId(route.id)
                      loadData(route.id)
                    }}
                    className={`rounded-3xl border px-4 py-4 text-left transition ${
                      selectedRoute?.id === route.id
                        ? 'border-[#2f5d50] bg-emerald-50/70 shadow-sm'
                        : 'border-stone-200 bg-white hover:bg-stone-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-stone-800">Ruta #{route.route_number}</div>
                        <div className="mt-1 text-xs text-stone-500">{route.route_name || route.driver_name || 'Sin alias'}</div>
                      </div>
                      <StatusPill tone={routeTone(route.status)}>{getRouteStatusLabel(route.status)}</StatusPill>
                    </div>
                    <div className="mt-3 text-xs text-stone-500">
                      {route.route_date} · {route.vehiculos?.name || 'Sin vehiculo'}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
                      <span>{route.total_orders} pedidos</span>
                      <span>{fmtKm(route.total_distance_km)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </SectionCard>

            {selectedRoute ? (
              <>
            <SectionCard title="Mapa rapido de ruta" subtitle="Vista visual de planta, clientes y secuencia para el piloto.">
              <MiniRouteMap route={selectedRoute} />
            </SectionCard>

            <SectionCard title="Vista movil de ruta activa" subtitle="Pensada para piloto: tramos, siguiente cliente, entrega, incidencias y combustible.">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-stone-200 bg-gradient-to-br from-[#f7fbfa] to-white px-5 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Ruta actual</div>
                        <div className="mt-2 text-2xl font-bold text-stone-800">#{selectedRoute.route_number}</div>
                        <div className="mt-2 text-sm text-stone-500">{selectedRoute.vehiculos?.name} · {selectedRoute.vehiculos?.plate}</div>
                      </div>
                      <StatusPill tone={routeTone(selectedRoute.status)}>{getRouteStatusLabel(selectedRoute.status)}</StatusPill>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl bg-white px-3 py-3 text-sm"><div className="text-xs text-stone-400">Pedidos</div><div className="mt-1 font-semibold text-stone-800">{selectedRoute.total_orders}</div></div>
                      <div className="rounded-2xl bg-white px-3 py-3 text-sm"><div className="text-xs text-stone-400">Km</div><div className="mt-1 font-semibold text-stone-800">{fmtKm(selectedRoute.total_distance_km)}</div></div>
                      <div className="rounded-2xl bg-white px-3 py-3 text-sm"><div className="text-xs text-stone-400">Costo</div><div className="mt-1 font-semibold text-stone-800">{fmtQ(selectedRoute.total_route_cost)}</div></div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Siguiente parada</div>
                    {currentStop ? (
                      <>
                        <div className="mt-3 text-xl font-semibold text-stone-800">{currentStop.client_name_snapshot}</div>
                        <div className="mt-2 text-sm leading-6 text-stone-600">{currentStop.delivery_address_snapshot}</div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {selectedRoute.status === ROUTE_STATUS.PLANIFICADA ? (
                            <button onClick={() => runAction(() => handleStartRoute(selectedRoute.id), { reloadRouteId: selectedRoute.id })} className="rounded-2xl bg-[#2f5d50] px-4 py-3 text-sm font-semibold text-white hover:bg-[#264c42]">
                              Iniciar ruta
                            </button>
                          ) : (
                            <button onClick={() => setDeliveryTarget(currentStop)} className="rounded-2xl bg-[#2f5d50] px-4 py-3 text-sm font-semibold text-white hover:bg-[#264c42]">
                              Registrar entrega
                            </button>
                          )}
                          <button onClick={() => setShowIncidentModal(true)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                            Incidencia
                          </button>
                          <button onClick={() => setShowExtraFuelModal(true)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                            Combustible extra
                          </button>
                          {selectedRoute.current_stop_maps_link ? <a href={selectedRoute.current_stop_maps_link} target="_blank" rel="noreferrer" className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Abrir mapa</a> : null}
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 space-y-4">
                        <div className="text-sm text-stone-500">No hay una parada activa. Si ya completaste todas las entregas, puedes cerrar la ruta para costear y prorratear el recorrido final.</div>
                        {selectedRoute.status === ROUTE_STATUS.EN_RUTA ? (
                          <button onClick={() => runAction(() => finalizeRoute(selectedRoute.id), { reloadRouteId: selectedRoute.id })} className="rounded-2xl bg-stone-800 px-4 py-3 text-sm font-semibold text-white hover:bg-stone-900">
                            Cerrar y costear ruta
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[28px] border border-stone-200 bg-white px-5 py-5 shadow-sm">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400">Secuencia de clientes</div>
                  <div className="mt-4 space-y-3">
                    {selectedRoute.ruta_pedidos.map((row) => (
                      <div key={row.id} className={`rounded-3xl border px-4 py-4 ${currentStop?.id === row.id ? 'border-[#2f5d50] bg-emerald-50/60' : 'border-stone-200 bg-stone-50'}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-sm font-bold text-[#2f5d50] shadow-sm">{row.sequence_no}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-stone-800">{row.client_name_snapshot}</div>
                                <div className="mt-1 text-xs text-stone-500">Pedido #{row.orders?.order_number}</div>
                              </div>
                              <StatusPill tone={stopTone(row.status)}>{getStopStatusLabel(row.status)}</StatusPill>
                            </div>
                            <div className="mt-2 text-xs leading-5 text-stone-500">{row.delivery_address_snapshot}</div>
                            <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
                              <span>Costo {fmtQ(row.allocated_total_cost)}</span>
                              <span>Margen {fmtQ(row.margin_amount)}</span>
                            </div>
                            {row.status === STOP_STATUS.ENTREGADO || row.status === STOP_STATUS.PARCIAL ? (
                              <button onClick={() => setClaimTarget(row)} className="mt-3 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
                                Reportar reclamo
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
              </>
            ) : (
              <SectionCard title="Vista piloto" subtitle="Selecciona una ruta de la lista para habilitar la operacion movil.">
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">No hay una ruta seleccionada todavia.</div>
              </SectionCard>
            )}
          </div>
        ) : (
          <SectionCard title="Vista piloto" subtitle="Selecciona una ruta para habilitar la operacion movil.">
            <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">No hay rutas disponibles todavia.</div>
          </SectionCard>
        )
      ) : null}

      {!loading && tab === 'incidencias' ? (
        <SectionCard title="Incidencias logisticas" subtitle="Historial consolidado de incidencias registradas por ruta o por cliente.">
          <div className="mb-5 flex justify-end">
            <button onClick={() => setShowIncidentModal(true)} disabled={!selectedRoute} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              Nueva incidencia
            </button>
          </div>
          <div className="space-y-3">
            {incidents.length ? incidents.map((row) => (
              <div key={row.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-stone-800">{getIncidentTypeLabel(row.incident_type)}</div>
                    <div className="mt-1 text-xs text-stone-500">Ruta #{row.rutas?.route_number} · {row.rutas?.route_date}</div>
                  </div>
                  <StatusPill tone={row.severity === 'alta' ? 'red' : row.severity === 'media' ? 'amber' : 'stone'}>{getSeverityLabel(row.severity)}</StatusPill>
                </div>
                <div className="mt-3 text-sm text-stone-600">{row.description}</div>
                <div className="mt-3 flex items-center gap-4 text-xs text-stone-500">
                  <span>{row.occurred_at?.slice(0, 16).replace('T', ' ')}</span>
                  <span>Costo estimado {fmtQ(row.estimated_cost)}</span>
                  {row.support_file_url ? <a href={row.support_file_url} target="_blank" rel="noreferrer" className="font-semibold text-[#2f5d50] hover:underline">Ver soporte</a> : null}
                </div>
              </div>
            )) : <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">No hay incidencias registradas.</div>}
          </div>
        </SectionCard>
      ) : null}

      {!loading && tab === 'configuracion' ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Ubicacion de planta" subtitle="Punto base usado para generar el tramo inicial y el retorno a planta.">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Nombre planta</span><input value={settingsForm.plant_name} onChange={(e) => setSettingsForm((p) => ({ ...p, plant_name: e.target.value }))} className={INPUT} /></label>
              <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Direccion</span><textarea rows={3} value={settingsForm.plant_address} onChange={(e) => setSettingsForm((p) => ({ ...p, plant_address: e.target.value }))} className={INPUT} /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Latitud</span><input type="number" step="0.0000001" value={settingsForm.plant_latitude} onChange={(e) => setSettingsForm((p) => ({ ...p, plant_latitude: e.target.value }))} className={INPUT} /></label>
              <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Longitud</span><input type="number" step="0.0000001" value={settingsForm.plant_longitude} onChange={(e) => setSettingsForm((p) => ({ ...p, plant_longitude: e.target.value }))} className={INPUT} /></label>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={handleUseBrowserLocation} disabled={geoLoading} className="rounded-2xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">
                {geoLoading ? 'Ubicando...' : 'Usar mi ubicacion'}
              </button>
              <button onClick={() => runAction(() => saveLogisticsSettings(settingsForm))} className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white hover:bg-[#264c42]">
                Guardar planta
              </button>
              {plantMapsLink ? <a href={plantMapsLink} target="_blank" rel="noreferrer" className="rounded-2xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Ver en mapa</a> : null}
            </div>
            <div className="mt-3 text-xs text-stone-500">
              Puedes capturar las coordenadas con GPS del navegador o mantener la direccion para que Google Maps la geocodifique al generar tramos.
            </div>
          </SectionCard>

          <div className="space-y-6">
            <SectionCard title="Vehiculos" subtitle="Rendimiento y tipo de combustible usados en el costeo por tramo." action={<button onClick={() => setVehicleModal({})} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Nuevo vehiculo</button>}>
              <div className="space-y-3">
                {vehicles.length ? vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-stone-800">{vehicle.name}</div>
                        <div className="mt-1 text-xs text-stone-500">{vehicle.plate} · {getFuelTypeLabel(vehicle.fuel_type)} · {n(vehicle.fuel_efficiency_km_per_gallon).toFixed(2)} km/gal</div>
                      </div>
                      <StatusPill tone={vehicle.is_active === false ? 'stone' : 'emerald'}>{vehicle.is_active === false ? 'Inactivo' : 'Activo'}</StatusPill>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => setVehicleModal(vehicle)} className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-white">Editar</button>
                      <button onClick={() => runAction(() => toggleVehicleActive(vehicle.id, vehicle.is_active === false))} className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-white">
                        {vehicle.is_active === false ? 'Activar' : 'Inactivar'}
                      </button>
                    </div>
                  </div>
                )) : <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">No hay vehiculos registrados.</div>}
              </div>
            </SectionCard>

            <SectionCard title="Configuracion combustible" subtitle="Historial de precios por galon para costear tramos automaticamente." action={<div className="flex flex-wrap gap-2"><button onClick={refreshOfficialFuelData} disabled={officialFuelLoading} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">{officialFuelLoading ? 'Consultando...' : 'Actualizar fuente oficial'}</button><button onClick={() => setShowFuelModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Nuevo precio</button></div>}>
              {officialFuelError ? (
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  No pude traer el precio oficial de Guatemala. {officialFuelError}
                </div>
              ) : null}
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                {FUEL_TYPES.map((row) => (
                  <div key={row.value} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                    <div className="text-sm font-semibold text-stone-800">{row.label}</div>
                    <div className="mt-1 text-xs text-stone-500">
                      {latestFuelByType[row.value]?.effective_date ? `Ultima vigencia ${latestFuelByType[row.value].effective_date}` : 'Sin precio cargado'}
                    </div>
                    <div className="mt-3 text-lg font-semibold text-stone-800">
                      {latestFuelByType[row.value]
                        ? fmtQ(latestFuelByType[row.value].price_per_gallon)
                        : officialFuelData?.prices?.[row.value]
                          ? fmtQ(officialFuelData.prices[row.value])
                          : 'Sin dato'}
                    </div>
                    {!latestFuelByType[row.value] && officialFuelData?.prices?.[row.value] ? (
                      <div className="mt-1 text-xs text-emerald-700">Vista previa oficial disponible</div>
                    ) : null}
                    <button
                      onClick={() => handleSyncOfficialFuelPrice(row.value)}
                      disabled={fuelSyncingType === row.value}
                      className="mt-4 w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                    >
                      {fuelSyncingType === row.value ? 'Consultando...' : 'Actualizar desde MEM Guatemala'}
                    </button>
                  </div>
                ))}
              </div>
              {fuelSyncInfo ? (
                <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  Se guardo {getFuelTypeLabel(fuelSyncInfo.fuel_type)} en {fmtQ(fuelSyncInfo.price_per_gallon)} desde fuente oficial de Guatemala.
                  {fuelSyncInfo.source_url ? (
                    <>
                      {' '}
                      <a href={fuelSyncInfo.source_url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                        Ver fuente
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-3">
                {fuelHistory.length ? fuelHistory.map((row) => (
                  <div key={row.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-stone-800">{getFuelTypeLabel(row.fuel_type)}</div>
                        <div className="mt-1 text-xs text-stone-500">Vigencia {row.effective_date}</div>
                      </div>
                      <div className="text-sm font-semibold text-stone-800">{fmtQ(row.price_per_gallon)}</div>
                    </div>
                    {row.notes ? <div className="mt-3 text-sm text-stone-600">{row.notes}</div> : null}
                  </div>
                )) : <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">No hay precios de combustible registrados.</div>}
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}

      {vehicleModal ? <VehicleModal initialValue={vehicleModal?.id ? vehicleModal : null} saving={saving} onClose={() => setVehicleModal(null)} onSubmit={(form) => runAction(() => saveVehicle(vehicleModal?.id ? { ...vehicleModal, ...form } : form), { after: () => setVehicleModal(null) })} /> : null}
      {showFuelModal ? <FuelModal saving={saving} onClose={() => setShowFuelModal(false)} onSubmit={(form) => runAction(() => saveFuelHistoryEntry(form), { after: () => setShowFuelModal(false) })} /> : null}
      {showIncidentModal && selectedRoute ? <IncidentModal key={`${selectedRoute.id}-${selectedRoute.current_stop?.id || 'route'}`} route={selectedRoute} saving={saving} onClose={() => setShowIncidentModal(false)} onSubmit={(form) => runAction(() => saveRouteIncident(form), { reloadRouteId: selectedRoute.id, after: () => setShowIncidentModal(false) })} /> : null}
      {showExtraFuelModal && selectedRoute ? <ExtraFuelModal key={selectedRoute.id} route={selectedRoute} saving={saving} onClose={() => setShowExtraFuelModal(false)} onSubmit={(form) => runAction(() => saveExtraFuel(form), { reloadRouteId: selectedRoute.id, after: () => setShowExtraFuelModal(false) })} /> : null}
      {deliveryTarget && selectedRoute ? <DeliveryModal key={deliveryTarget.id} route={selectedRoute} routeOrder={deliveryTarget} saving={saving} onClose={() => setDeliveryTarget(null)} onSubmit={(payload) => runAction(() => completeRouteStop(payload), { reloadRouteId: selectedRoute.id, after: () => setDeliveryTarget(null) })} /> : null}
      {claimTarget ? <ClaimModal routeOrder={claimTarget} saving={saving} onClose={() => setClaimTarget(null)} onSubmit={(form) => runAction(() => createClaim(claimTarget.order_id, form), { after: () => setClaimTarget(null) })} /> : null}
    </div>
  )
}
