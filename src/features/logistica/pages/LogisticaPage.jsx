import { useEffect, useState, useCallback } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  getLogisticsOrders,
  getOrderForDelivery,
  assignLogistics,
  uploadDeliveryPhoto,
  recordDelivery,
} from '../services/logisticaService'
import { createClaim } from '../../reclamos/services/reclamosService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const STATUS_STYLE = {
  facturado:    { bg: 'bg-sky-100',    text: 'text-sky-800'    },
  en_logistica: { bg: 'bg-orange-100', text: 'text-orange-800' },
  entregado:    { bg: 'bg-teal-100',   text: 'text-teal-800'   },
}
const STATUS_LABEL = {
  facturado: 'Facturado', en_logistica: 'En logística', entregado: 'Entregado',
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || { bg: 'bg-stone-100', text: 'text-stone-600' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ type = 'error', children }) {
  const styles = { error: 'border-red-200 bg-red-50 text-red-700', success: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[type]}`}>{children}</div>
}

// ─── Modal: Asignar logística ─────────────────────────────────────────────────

function AssignModal({ order, onClose, onSaved }) {
  const existing = order.order_logistics?.[0] || {}
  const [truck, setTruck] = useState(existing.truck || '')
  const [route, setRoute] = useState(existing.route || '')
  const [driverName, setDriverName] = useState(existing.driver_name || '')
  const [notes, setNotes] = useState(existing.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await assignLogistics(order.id, { truck, route, driverName, notes })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <h3 className="font-semibold text-stone-800">Asignar logística</h3>
            <p className="text-sm text-stone-500 mt-0.5">Pedido #{order.order_number} · {order.clients?.commercial_name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <Alert type="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Camión / placa</span>
              <input value={truck} onChange={e => setTruck(e.target.value)} placeholder="P-123XY"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
            </label>
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Ruta</span>
              <input value={route} onChange={e => setRoute(e.target.value)} placeholder="Zona norte"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
            </label>
          </div>
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Piloto / conductor</span>
            <input value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Nombre del piloto"
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
          </label>
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Notas</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Instrucciones de entrega..."
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
          </label>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando...' : 'Asignar y enviar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal: Nuevo reclamo (desde logística) ───────────────────────────────────

function NewClaimModal({ order, onClose, onSaved }) {
  const [claimType, setClaimType] = useState('calidad')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Productos afectados: { [orderItemId]: qty_string }
  const [affectedQtys, setAffectedQtys] = useState({})

  const items = order.order_items || []

  // Costos calculados automáticamente
  const costAmount = items.reduce((acc, item) => {
    const qty = n(affectedQtys[item.id] || 0)
    const unitCost = n(item.product_presentations?.standard_cost)
    return acc + qty * unitCost
  }, 0)

  // Costo de oportunidad (hipotético, no entra en balance)
  const opportunityCost = items.reduce((acc, item) => {
    const qty = n(affectedQtys[item.id] || 0)
    const salePrice = n(item.unit_price)
    return acc + qty * salePrice
  }, 0)

  const totalAffected = Object.values(affectedQtys).reduce((acc, v) => acc + n(v), 0)

  function setQty(itemId, val) {
    setAffectedQtys(prev => ({ ...prev, [itemId]: val }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (totalAffected === 0) { setError('Selecciona al menos un producto afectado'); return }
    setSaving(true)
    setError('')
    try {
      // Build description with affected items detail
      const itemsDetail = items
        .filter(i => n(affectedQtys[i.id]) > 0)
        .map(i => `${i.product_presentations?.display_name}: ${n(affectedQtys[i.id])} ${i.product_presentations?.unit}`)
        .join(', ')
      const fullDescription = description
        ? `${description} | Productos: ${itemsDetail}`
        : `Productos afectados: ${itemsDetail}`

      await createClaim(order.id, {
        claimType,
        description: fullDescription,
        amount: opportunityCost,   // costo de oportunidad registrado
        costAmount,                // costo real de producción (entra en balance)
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl my-4">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <h3 className="font-semibold text-stone-800">Reportar reclamo</h3>
            <p className="text-sm text-stone-500 mt-0.5">Pedido #{order.order_number} · {order.clients?.commercial_name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <Alert type="error">{error}</Alert>}

          {/* Tipo */}
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">Tipo de reclamo *</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'calidad', label: 'Calidad', icon: '⚠️' },
                { key: 'problema_entrega', label: 'Entrega', icon: '🚛' },
                { key: 'cantidad', label: 'Cantidad', icon: '📦' },
              ].map(({ key, label, icon }) => (
                <button key={key} type="button" onClick={() => setClaimType(key)}
                  className={`rounded-2xl border p-3 text-sm font-medium text-center transition ${
                    claimType === key
                      ? 'border-[#2f5d50] bg-emerald-50 text-[#2f5d50]'
                      : 'border-stone-200 text-stone-600 hover:border-stone-300'
                  }`}>
                  <div className="text-lg mb-1">{icon}</div>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Descripción */}
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Descripción del problema *</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} required
              placeholder="Describe lo que ocurrió..."
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
          </label>

          {/* Productos afectados */}
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">Productos afectados y cantidad</p>
            <div className="space-y-2">
              {items.map(item => {
                const pres = item.product_presentations
                const maxQty = n(item.quantity_delivered) || n(item.quantity_packed)
                const qty = n(affectedQtys[item.id] || 0)
                const unitCost = n(pres?.standard_cost)
                return (
                  <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 items-center rounded-2xl border border-stone-200 bg-stone-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-stone-800">{pres?.display_name}</p>
                      <p className="text-xs text-stone-400">
                        {pres?.code} · Entregado: {maxQty} {pres?.unit}
                        {unitCost > 0 && ` · Costo unit.: Q ${fmt(unitCost)}`}
                      </p>
                      {qty > 0 && unitCost > 0 && (
                        <p className="text-xs text-red-600 font-medium mt-0.5">Costo real: Q {fmt(qty * unitCost)}</p>
                      )}
                    </div>
                    <input
                      type="number" step="1" min="0" max={maxQty}
                      value={affectedQtys[item.id] || ''}
                      onChange={e => setQty(item.id, e.target.value)}
                      placeholder="0"
                      className="w-20 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-center outline-none focus:border-[#2f5d50]"
                    />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Resumen de costos */}
          {totalAffected > 0 && (
            <div className="rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-stone-700">Costo de producción perdido</span>
                <span className="font-bold text-red-600">Q {fmt(costAmount)}</span>
              </div>
              <p className="text-xs text-stone-400">Entra en el balance de costos de reclamos.</p>
              <div className="flex justify-between text-sm pt-1 border-t border-stone-200">
                <span className="text-stone-500">Costo de oportunidad (hipotético)</span>
                <span className="text-stone-500">Q {fmt(opportunityCost)}</span>
              </div>
              <p className="text-xs text-stone-400">Valor de venta no realizada — referencial, no afecta balance.</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving || !description.trim() || totalAffected === 0}
              className="flex-1 rounded-2xl bg-red-600 py-3 text-sm font-semibold text-white shadow-md hover:bg-red-700 disabled:opacity-50">
              {saving ? 'Enviando...' : 'Reportar reclamo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal: Registrar entrega ──────────────────────────────────────────────────

function DeliveryModal({ orderId, onClose, onSaved }) {
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deliveryItems, setDeliveryItems] = useState([])
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getOrderForDelivery(orderId)
      .then(data => {
        setOrder(data)
        // Initialize delivery quantities to remaining (packed - already delivered)
        const items = (data.order_items || []).map(item => {
          const alreadyDelivered = (data.order_deliveries || [])
            .flatMap(d => d.order_delivery_items || [])
            .filter(di => di.order_item_id === item.id)
            .reduce((acc, di) => acc + n(di.quantity_delivered), 0)
          const pending = n(item.quantity_packed) - alreadyDelivered
          return {
            order_item_id: item.id,
            display_name: item.product_presentations?.display_name,
            code: item.product_presentations?.code,
            unit: item.product_presentations?.unit,
            quantity_packed: n(item.quantity_packed),
            already_delivered: alreadyDelivered,
            pending,
            quantity_delivered: String(Math.max(0, pending)),
          }
        }).filter(i => i.pending > 0)
        setDeliveryItems(items)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [orderId])

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      let photoUrl = null
      if (photoFile) {
        photoUrl = await uploadDeliveryPhoto(photoFile)
      }
      await recordDelivery(orderId, {
        deliveryItems: deliveryItems.map(i => ({
          order_item_id: i.order_item_id,
          quantity_packed: i.quantity_packed,
          quantity_delivered: n(i.quantity_delivered),
        })),
        photoUrl,
        notes,
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function updateQty(id, val) {
    setDeliveryItems(prev => prev.map(i => i.order_item_id === id ? { ...i, quantity_delivered: val } : i))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl my-4">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <h3 className="font-semibold text-stone-800">Registrar entrega</h3>
            {order && <p className="text-sm text-stone-500 mt-0.5">Pedido #{order.order_number} · {order.clients?.commercial_name}</p>}
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">✕</button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && <Alert type="error">{error}</Alert>}

            {/* Logística info */}
            {order?.order_logistics?.[0] && (
              <div className="rounded-2xl bg-orange-50 px-4 py-3 text-sm text-orange-800 space-y-1">
                {order.order_logistics[0].truck && <div><span className="font-medium">Camión:</span> {order.order_logistics[0].truck}</div>}
                {order.order_logistics[0].route && <div><span className="font-medium">Ruta:</span> {order.order_logistics[0].route}</div>}
                {order.order_logistics[0].driver_name && <div><span className="font-medium">Piloto:</span> {order.order_logistics[0].driver_name}</div>}
              </div>
            )}

            {/* Cantidades a entregar */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-stone-700">Cantidades entregadas</h4>
              {deliveryItems.length === 0 ? (
                <p className="text-sm text-stone-400">Todos los productos ya fueron entregados.</p>
              ) : (
                deliveryItems.map(item => (
                  <div key={item.order_item_id} className="grid grid-cols-[1fr_auto] gap-3 items-center rounded-2xl border border-stone-200 bg-stone-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-stone-800">{item.display_name}</p>
                      <p className="text-xs text-stone-400">{item.code} · Pendiente: {item.pending} {item.unit}</p>
                    </div>
                    <input
                      type="number" step="1" min="0" max={item.pending}
                      value={item.quantity_delivered}
                      onChange={e => updateQty(item.order_item_id, e.target.value)}
                      className="w-20 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-center outline-none focus:border-[#2f5d50]"
                    />
                  </div>
                ))
              )}
            </div>

            {/* Foto de constancia */}
            <div>
              <label className="block mb-1 text-sm font-medium text-stone-700">
                Foto de constancia de entrega
              </label>
              <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 px-4 py-5 cursor-pointer hover:border-[#2f5d50] transition">
                {photoPreview ? (
                  <img src={photoPreview} alt="preview" className="max-h-40 rounded-xl object-cover" />
                ) : (
                  <>
                    <span className="text-2xl">📷</span>
                    <span className="text-sm text-stone-500">Toca para tomar foto o seleccionar archivo</span>
                  </>
                )}
                <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
              </label>
            </div>

            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Notas de entrega</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Observaciones del piloto..."
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
            </label>

            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
              <button type="submit" disabled={saving || deliveryItems.every(i => n(i.quantity_delivered) === 0)}
                className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#264c42] disabled:opacity-50">
                {saving ? 'Registrando...' : 'Confirmar entrega'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function LogisticaPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assigningOrder, setAssigningOrder] = useState(null)
  const [deliveringOrderId, setDeliveringOrderId] = useState(null)
  const [claimingOrder, setClaimingOrder] = useState(null)
  const [statusFilter, setStatusFilter] = useState('todos')

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getLogisticsOrders()
      setOrders(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])
  useRealtimeRefresh(['orders', 'order_items'], loadOrders)

  const filtered = statusFilter === 'todos'
    ? orders
    : orders.filter(o => o.status === statusFilter)

  const counts = {
    todos: orders.length,
    facturado: orders.filter(o => o.status === 'facturado').length,
    en_logistica: orders.filter(o => o.status === 'en_logistica').length,
    entregado: orders.filter(o => o.status === 'entregado').length,
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ERP · Distribución</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Logística</h1>
            <p className="mt-1 text-sm text-stone-500">Asignación de rutas y registro de entregas.</p>
          </div>
          <button onClick={loadOrders} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
            Actualizar
          </button>
        </div>

        {error && <Alert type="error">{error}</Alert>}

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: 'Por asignar', value: counts.facturado, color: 'text-sky-700' },
            { label: 'En ruta', value: counts.en_logistica, color: 'text-orange-700' },
            { label: 'Entregados', value: counts.entregado, color: 'text-teal-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-3xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
              <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filtros */}
        <div className="flex gap-2 flex-wrap">
          {[
            { key: 'todos', label: 'Todos' },
            { key: 'facturado', label: 'Por asignar' },
            { key: 'en_logistica', label: 'En ruta' },
            { key: 'entregado', label: 'Entregados' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                statusFilter === key
                  ? 'bg-[#2f5d50] text-white shadow-sm'
                  : 'bg-white border border-stone-200 text-stone-600 hover:border-stone-300'
              }`}>
              {label} {counts[key] > 0 && <span className="ml-1 opacity-70">({counts[key]})</span>}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-3xl border border-stone-200 bg-white py-16">
            <Spinner />
            <span className="text-sm text-stone-500">Cargando...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-16 text-center">
            <p className="text-stone-400">No hay pedidos en este estado.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(order => {
              const log = order.order_logistics?.[0]
              const deliveries = order.order_deliveries || []
              const items = order.order_items || []
              const totalPacked = items.reduce((acc, i) => acc + n(i.quantity_packed), 0)
              const totalDelivered = items.reduce((acc, i) => acc + n(i.quantity_delivered), 0)
              const hasPartialDelivery = deliveries.length > 0 && totalDelivered < totalPacked

              return (
                <div key={order.id} className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-bold text-stone-900">Pedido #{order.order_number}</span>
                        <StatusBadge status={order.status} />
                        {hasPartialDelivery && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                            Entrega parcial
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-stone-600 font-medium">{order.clients?.commercial_name}</p>
                      <p className="text-xs text-stone-400">{order.clients?.main_address} · Entrega: {order.delivery_date}</p>
                      {log && (
                        <div className="flex gap-4 text-xs text-stone-500 mt-1 flex-wrap">
                          {log.truck && <span>🚛 {log.truck}</span>}
                          {log.route && <span>🗺 {log.route}</span>}
                          {log.driver_name && <span>👤 {log.driver_name}</span>}
                        </div>
                      )}
                      {/* Progreso de entrega */}
                      {totalPacked > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 w-32 rounded-full bg-stone-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-teal-500 transition-all"
                              style={{ width: `${Math.min(100, (totalDelivered / totalPacked) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-stone-400">{totalDelivered}/{totalPacked} entregados</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <p className="text-lg font-bold text-stone-900">Q {fmt(order.total)}</p>
                      <div className="flex gap-2 flex-wrap justify-end">
                        {order.status === 'facturado' && (
                          <button
                            onClick={() => setAssigningOrder(order)}
                            className="rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition"
                          >
                            Asignar ruta →
                          </button>
                        )}
                        {order.status === 'en_logistica' && (
                          <>
                            <button
                              onClick={() => setAssigningOrder(order)}
                              className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition"
                            >
                              Editar ruta
                            </button>
                            <button
                              onClick={() => setDeliveringOrderId(order.id)}
                              className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42] transition"
                            >
                              Registrar entrega
                            </button>
                          </>
                        )}
                        {order.status === 'entregado' && (
                          <div className="flex gap-2 flex-wrap justify-end">
                            {deliveries.map((d, i) => d.delivery_photo_url && (
                              <a key={i} href={d.delivery_photo_url} target="_blank" rel="noreferrer"
                                className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 transition">
                                📷 Constancia {i + 1}
                              </a>
                            ))}
                            <button
                              onClick={() => setClaimingOrder(order)}
                              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 transition"
                            >
                              Reportar reclamo
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {assigningOrder && (
        <AssignModal
          order={assigningOrder}
          onClose={() => setAssigningOrder(null)}
          onSaved={() => { setAssigningOrder(null); loadOrders() }}
        />
      )}

      {deliveringOrderId && (
        <DeliveryModal
          orderId={deliveringOrderId}
          onClose={() => setDeliveringOrderId(null)}
          onSaved={() => { setDeliveringOrderId(null); loadOrders() }}
        />
      )}

      {claimingOrder && (
        <NewClaimModal
          order={claimingOrder}
          onClose={() => setClaimingOrder(null)}
          onSaved={() => { setClaimingOrder(null); loadOrders() }}
        />
      )}
    </div>
  )
}
