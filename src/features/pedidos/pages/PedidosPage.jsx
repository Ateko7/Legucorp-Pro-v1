import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  getOrders,
  getOrderById,
  getClients,
  getPresentations,
  getInventoryByPresentation,
  createOrder,
  updateOrder,
  updateOrderStatus,
  facturarOrder,
  packOrderItem,
  dispatchOrder,
  printOrderPDF,
  ORDER_STATUS,
  STATUS_LABEL,
  STATUS_FLOW,
} from '../services/pedidosService'
import { getFacturaPorPedido, generarFactura } from '../../exportacion/services/exportacionService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayStr = new Date().toISOString().slice(0, 10)

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }

function moneyInput(v) {
  return n(v).toFixed(2)
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_STYLE = {
  confirmado:   { bg: 'bg-blue-100',   text: 'text-blue-800'   },
  empacado:     { bg: 'bg-amber-100',  text: 'text-amber-800'  },
  despachado:   { bg: 'bg-purple-100', text: 'text-purple-800' },
  facturado:    { bg: 'bg-sky-100',    text: 'text-sky-800'    },
  en_logistica: { bg: 'bg-orange-100', text: 'text-orange-800' },
  entregado:    { bg: 'bg-teal-100',   text: 'text-teal-800'   },
  cobrado:      { bg: 'bg-green-100',  text: 'text-green-800'  },
}

// ─── Componentes base ─────────────────────────────────────────────────────────

function StatusBadge({ status, large }) {
  const s = STATUS_STYLE[status] || { bg: 'bg-stone-100', text: 'text-stone-600' }
  return (
    <span className={`inline-flex items-center rounded-full font-semibold ${s.bg} ${s.text} ${large ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ type = 'error', children }) {
  const styles = {
    error:   'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warn:    'border-amber-200 bg-amber-50 text-amber-700',
  }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[type]}`}>{children}</div>
}

function BackButton({ onClick, label = 'Volver a pedidos' }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 text-sm font-medium text-stone-500 hover:text-stone-800 transition">
      <span>←</span> {label}
    </button>
  )
}

// ─── Indicador de inventario ──────────────────────────────────────────────────

function InventoryIndicator({ presentationId, needed, inventory }) {
  const lots = inventory?.[presentationId] || []
  const available = lots.reduce((acc, l) => acc + n(l.available_quantity), 0)
  if (!needed) return null
  if (available >= n(needed)) {
    return <span className="text-xs font-medium text-emerald-600">✓ {fmt(available)} disp.</span>
  }
  return <span className="text-xs font-medium text-red-500">⚠ {fmt(available)} disp. (faltan {fmt(n(needed) - available)})</span>
}

// ─── Formulario de nuevo / editar pedido ─────────────────────────────────────

function OrderForm({ initial, clients, presentations, onSave, onCancel, saving }) {
  const isEdit = Boolean(initial?.id)

  const [clientId, setClientId] = useState(initial?.client_id || '')
  const [deliveryDate, setDeliveryDate] = useState(initial?.delivery_date || todayStr)
  const [notes, setNotes] = useState(initial?.notes || '')
  const [items, setItems] = useState(() => {
    if (initial?.order_items?.length) {
      return initial.order_items.map((i) => ({
        _key: i.id,
        product_presentation_id: i.product_presentation_id,
        quantity: String(i.quantity),
        unit_price: moneyInput(i.unit_price),
      }))
    }
    return [{ _key: Date.now(), product_presentation_id: '', quantity: '', unit_price: '' }]
  })

  const selectedClient = clients.find((c) => c.id === clientId)

  function addItem() {
    setItems((prev) => [...prev, { _key: Date.now(), product_presentation_id: '', quantity: '', unit_price: '' }])
  }

  function removeItem(key) {
    setItems((prev) => prev.filter((i) => i._key !== key))
  }

  function updateItem(key, field, value) {
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i
      const updated = { ...i, [field]: value }
      // Auto-fill precio sugerido al seleccionar producto
      if (field === 'product_presentation_id') {
        const pres = presentations.find((p) => p.id === value)
        if (pres) updated.unit_price = moneyInput(pres.suggested_price)
      }
      return updated
    }))
  }

  const total = items.reduce((acc, i) => acc + n(i.unit_price) * n(i.quantity), 0)
  const canSubmit = clientId && deliveryDate && items.length > 0 &&
    items.every((i) => i.product_presentation_id && n(i.quantity) > 0 && n(i.unit_price) >= 0)

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      clientId,
      deliveryDate,
      notes,
      items: items.map((i) => ({
        product_presentation_id: i.product_presentation_id,
        quantity: n(i.quantity),
        unit_price: n(i.unit_price),
      })),
    })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{isEdit ? 'Editar pedido' : 'Nuevo pedido'}</h1>
          <p className="mt-1 text-sm text-stone-500">Completa los datos del pedido y los productos solicitados.</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition">
          Cancelar
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cliente + fecha */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-5">
          <h2 className="text-base font-semibold text-stone-800">Datos del pedido</h2>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="block mb-1.5 text-sm font-medium text-stone-700">Cliente *</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100 transition"
              >
                <option value="">Selecciona un cliente</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.commercial_name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block mb-1.5 text-sm font-medium text-stone-700">Fecha de entrega *</span>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100 transition"
              />
            </label>
          </div>

          {/* Info automática del cliente */}
          {selectedClient && (
            <div className="grid gap-3 rounded-2xl bg-stone-50 px-4 py-4 text-sm md:grid-cols-3">
              <div><span className="text-stone-400">NIT:</span> <span className="font-medium text-stone-700">{selectedClient.nit || 'CF'}</span></div>
              <div><span className="text-stone-400">Dirección:</span> <span className="font-medium text-stone-700">{selectedClient.main_address || '—'}</span></div>
              <div><span className="text-stone-400">Teléfono:</span> <span className="font-medium text-stone-700">{selectedClient.phone || '—'}</span></div>
            </div>
          )}

          {selectedClient?.facturar_por_sombrilla && (
            <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <span className="text-base">🌐</span>
              <span>
                <strong>Cliente de exportación</strong> — {selectedClient.pais || 'destino externo'}.
                Este pedido generará factura consolidada por producto sombrilla en USD.
              </span>
            </div>
          )}
        </div>

        {/* Productos */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-800">Productos</h2>
            <button type="button" onClick={addItem} className="flex items-center gap-1.5 rounded-2xl bg-stone-100 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-200 transition">
              + Agregar producto
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, idx) => {
              return (
                <div key={item._key} className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[2fr_1fr_1fr_auto]">
                  <label className="block">
                    {idx === 0 && <span className="block mb-1 text-xs font-medium text-stone-500">Producto</span>}
                    <select
                      value={item.product_presentation_id}
                      onChange={(e) => updateItem(item._key, 'product_presentation_id', e.target.value)}
                      required
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100 transition"
                    >
                      <option value="">Selecciona</option>
                      {presentations.map((p) => (
                        <option key={p.id} value={p.id}>{p.display_name} ({p.net_weight} {p.unit})</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    {idx === 0 && <span className="block mb-1 text-xs font-medium text-stone-500">Cantidad</span>}
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(item._key, 'quantity', e.target.value)}
                      placeholder="0"
                      required
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100 transition"
                    />
                  </label>

                  <label className="block">
                    {idx === 0 && <span className="block mb-1 text-xs font-medium text-stone-500">Precio unit. (Q)</span>}
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.unit_price}
                      onChange={(e) => updateItem(item._key, 'unit_price', e.target.value)}
                      placeholder="0.00"
                      required
                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100 transition"
                    />
                  </label>

                  <div className="flex flex-col justify-end gap-1">
                    {idx === 0 && <span className="block mb-1 text-xs font-medium text-stone-500 invisible">—</span>}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-700 min-w-[70px]">
                        Q {fmt(n(item.unit_price) * n(item.quantity))}
                      </span>
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeItem(item._key)} className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-500 transition">✕</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Total */}
          <div className="flex justify-end rounded-2xl bg-stone-100 px-5 py-3">
            <span className="text-base font-bold text-stone-800">Total: Q {fmt(total)}</span>
          </div>
        </div>

        {/* Notas */}
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="block mb-1.5 text-sm font-medium text-stone-700">Notas del pedido</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Instrucciones especiales, condiciones de entrega..."
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100 transition"
            />
          </label>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-2xl border border-stone-300 px-6 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || saving}
            className="rounded-2xl bg-[#2f5d50] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#264c42] disabled:opacity-50 transition"
          >
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear pedido'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Modal de empacar ítem (multi-lote) ──────────────────────────────────────

function PackItemModal({ item, inventory, onPack, onClose, saving }) {
  const pres = item?.product_presentations
  const lots = inventory?.[item?.product_presentation_id] || []
  const pendiente = n(item?.quantity) - n(item?.quantity_packed)

  // { [lotId]: qty string }
  const [lotQtys, setLotQtys] = useState({})

  const totalAsigning = Object.values(lotQtys).reduce((acc, v) => acc + n(v), 0)
  const remaining = pendiente - totalAsigning

  function setLotQty(lotId, val) {
    setLotQtys(prev => ({ ...prev, [lotId]: val }))
  }

  function fillAll(lot) {
    const canTake = Math.min(n(lot.available_quantity), Math.max(0, remaining + n(lotQtys[lot.id] || 0)))
    setLotQtys(prev => ({ ...prev, [lot.id]: String(canTake) }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const assignments = lots
      .filter(l => n(lotQtys[l.id]) > 0)
      .map(l => ({ finishedLotId: l.id, quantity: n(lotQtys[l.id]) }))
    onPack({ orderItemId: item.id, lotAssignments: assignments })
  }

  const canSubmit = totalAsigning > 0 && totalAsigning <= pendiente &&
    lots.every(l => n(lotQtys[l.id] || 0) <= n(l.available_quantity))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl my-4">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <h3 className="font-semibold text-stone-800">Empacar desde inventario</h3>
            <p className="text-sm text-stone-500 mt-0.5">{pres?.display_name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100 transition">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Resumen */}
          <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-stone-500">Pedido:</span>
              <span className="font-medium">{n(item?.quantity)} unid.</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500">Ya empacado:</span>
              <span className="font-medium">{n(item?.quantity_packed)} unid.</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-stone-200 pt-1 mt-1">
              <span className="text-stone-700">Pendiente:</span>
              <span className="text-[#2f5d50]">{pendiente} unid.</span>
            </div>
            {totalAsigning > 0 && (
              <div className="flex justify-between text-xs pt-1 border-t border-stone-200">
                <span className="text-stone-500">Seleccionado:</span>
                <span className={`font-semibold ${totalAsigning > pendiente ? 'text-red-600' : 'text-emerald-600'}`}>
                  {totalAsigning} / {pendiente} unid.
                </span>
              </div>
            )}
          </div>

          {lots.length === 0 ? (
            <Alert type="warn">No hay inventario disponible para este producto.</Alert>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-700">Lotes disponibles — ingresa cantidad por lote</p>
                {lots.map(lot => {
                  const qty = lotQtys[lot.id] || ''
                  const qtyNum = n(qty)
                  const overLot = qtyNum > n(lot.available_quantity)
                  const overPending = totalAsigning > pendiente
                  return (
                    <div key={lot.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-stone-800 truncate">{lot.finished_lot_code}</p>
                          <p className="text-xs text-stone-400">
                            Disponible: <span className="font-semibold text-stone-600">{n(lot.available_quantity)}</span> unid.
                            {lot.expiration_date && ` · Vence: ${lot.expiration_date}`}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number" step="1" min="0"
                            max={n(lot.available_quantity)}
                            value={qty}
                            onChange={e => setLotQty(lot.id, e.target.value)}
                            placeholder="0"
                            className={`w-20 rounded-xl border px-3 py-2 text-sm text-center outline-none focus:ring-2 transition ${
                              overLot || (overPending && qtyNum > 0)
                                ? 'border-red-400 bg-red-50 focus:ring-red-100'
                                : 'border-stone-300 bg-white focus:border-[#2f5d50] focus:ring-emerald-100'
                            }`}
                          />
                          <button type="button" onClick={() => fillAll(lot)}
                            className="text-xs text-[#2f5d50] hover:underline whitespace-nowrap">
                            Usar {Math.min(n(lot.available_quantity), Math.max(0, remaining + n(lotQtys[lot.id] || 0)))}
                          </button>
                        </div>
                      </div>
                      {overLot && (
                        <p className="mt-1 text-xs text-red-600">Supera lo disponible en este lote.</p>
                      )}
                    </div>
                  )
                })}
              </div>
              {totalAsigning > pendiente && (
                <Alert type="error">La cantidad seleccionada ({totalAsigning}) supera el pendiente ({pendiente}).</Alert>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition">
                  Cancelar
                </button>
                <button type="submit" disabled={!canSubmit || saving}
                  className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#264c42] disabled:opacity-50 transition">
                  {saving ? 'Empacando...' : `Confirmar (${totalAsigning} unid.)`}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}

// ─── Vista detalle del pedido ─────────────────────────────────────────────────

function DispatchCostsModal({ order, onDispatch, onClose, saving }) {
  const [freightCost, setFreightCost] = useState('')
  const [insuranceCost, setInsuranceCost] = useState('')
  const freight = n(freightCost)
  const insurance = n(insuranceCost)

  function submit(event) {
    event.preventDefault()
    onDispatch({ freight_cost: freight, insurance_cost: insurance })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-stone-200 px-5 py-4">
          <h3 className="text-base font-semibold text-stone-900">Costos intercompany</h3>
          <p className="mt-1 text-sm text-stone-500">Pedido #{order?.order_number}</p>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">Flete</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={freightCost}
                onChange={(event) => setFreightCost(event.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">Seguro</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={insuranceCost}
                onChange={(event) => setInsuranceCost(event.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100"
              />
            </label>
          </div>
          <div className="flex justify-between rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
            <span className="text-stone-600">Total costos</span>
            <span className="font-semibold text-stone-900">Q {fmt(freight + insurance)}</span>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Procesando...' : 'Generar despacho'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function OrderDetailView({ orderId, inventory, onBack, onStatusChange, onEdit }) {
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [packingItem, setPackingItem] = useState(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [facturaExport, setFacturaExport] = useState(null)
  const [showFacturaPreview, setShowFacturaPreview] = useState(false)
  const [showDispatchCosts, setShowDispatchCosts] = useState(false)

  const loadOrder = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getOrderById(orderId)
      setOrder(data)
      // Load export invoice if order is exportacion
      if (data?.es_exportacion || data?.clients?.facturar_por_sombrilla) {
        const factura = await getFacturaPorPedido(orderId)
        setFacturaExport(factura)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => { loadOrder() }, [loadOrder])

  async function handleStatusChange(newStatus) {
    setSaving(true)
    setError('')
    try {
      await updateOrderStatus(orderId, newStatus)
        // Al facturar: asiento contable
        if (newStatus === ORDER_STATUS.FACTURADO) {
          try {
            const { generateSalesEntry } = await import('../../contabilidad/services/contabilidadService')
            await generateSalesEntry(orderId)
          } catch (e) {
            console.warn('Asiento contable no generado:', e.message)
          }
        }
      await loadOrder()
      onStatusChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDispatch(costs = {}) {
    setSaving(true)
    setError('')
    try {
      await dispatchOrder(orderId, costs)
      setShowDispatchCosts(false)
      await loadOrder()
      onStatusChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleFacturar() {
    setSaving(true)
    setError('')
    try {
      await facturarOrder(orderId)
      try {
        const { generateSalesEntry } = await import('../../contabilidad/services/contabilidadService')
        await generateSalesEntry(orderId)
      } catch (e) {
        console.warn('Asiento contable no generado:', e.message)
      }
      await loadOrder()
      onStatusChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePack({ orderItemId, lotAssignments }) {
    setSaving(true)
    setError('')
    try {
      await packOrderItem({ orderId, orderItemId, lotAssignments })
      setPackingItem(null)
      await loadOrder()
      onStatusChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <Spinner />
      <p className="text-sm text-stone-500">Cargando pedido...</p>
    </div>
  )

  if (!order) return <Alert type="error">No se encontró el pedido.</Alert>

  const client = order.clients
  const items = order.order_items || []
  const packings = order.order_packings || []
  const status = order.status
  const currentIdx = STATUS_FLOW.indexOf(status)
  const isEditable = !['en_logistica', 'entregado', 'cobrado'].includes(status)
  const isIntercompany = order.tipo_pedido === 'intercompany' ||
    !!order.intercompany_partner_id ||
    !!order.clients?.is_intercompany ||
    !!order.clients?.intercompany_partner_id

  // Chequeo de inventario
  const inventoryOk = items.every((item) => {
    const lots = inventory?.[item.product_presentation_id] || []
    const available = lots.reduce((acc, l) => acc + n(l.available_quantity), 0)
    const pendiente = n(item.quantity) - n(item.quantity_packed)
    return available >= pendiente
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <BackButton onClick={onBack} />
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-stone-900">Pedido #{order.order_number}</h1>
            <StatusBadge status={status} large />
          </div>
          <p className="text-sm text-stone-500">
            {client?.commercial_name} · Entrega: {order.delivery_date}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* PDF individual */}
          {(status === ORDER_STATUS.EMPACADO || status === ORDER_STATUS.DESPACHADO || status === ORDER_STATUS.FACTURADO) && (
            <button
              onClick={() => printOrderPDF(order)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition"
            >
              🖨 Generar PDF
            </button>
          )}

          {/* Editar */}
          {isEditable && (
            <button
              onClick={() => onEdit(order)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition"
            >
              Editar pedido
            </button>
          )}

          {/* Cancelar pedido */}
          {(status === ORDER_STATUS.CONFIRMADO || status === ORDER_STATUS.EMPACADO) && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
            >
              Cancelar pedido
            </button>
          )}

          {/* Botón inteligente según estado */}
          {/* Despacho parcial: disponible desde CONFIRMADO si hay algo empacado */}
          {status === ORDER_STATUS.CONFIRMADO && items.some(i => n(i.quantity_packed) > 0) && (
            <button
              onClick={() => isIntercompany ? setShowDispatchCosts(true) : handleDispatch()}
              disabled={saving}
              className="rounded-2xl bg-purple-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-purple-600 transition disabled:opacity-50"
            >
              {saving ? 'Procesando...' : 'Despacho parcial →'}
            </button>
          )}

          {status === ORDER_STATUS.EMPACADO && (
            <button
              onClick={() => isIntercompany ? setShowDispatchCosts(true) : handleDispatch()}
              disabled={saving}
              className="rounded-2xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-purple-700 transition disabled:opacity-50"
            >
              {saving ? 'Procesando...' : 'Generar despacho →'}
            </button>
          )}

          {status === ORDER_STATUS.DESPACHADO && (
            <>
              {(order.es_exportacion || order.clients?.facturar_por_sombrilla) && (
                facturaExport ? (
                  <button
                    onClick={() => navigate('/exportacion')}
                    className="rounded-2xl border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 transition"
                  >
                    Ver factura exportación #{facturaExport.numero || 'borrador'}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowFacturaPreview(true)}
                    disabled={saving}
                    className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    Generar factura exportación
                  </button>
                )
              )}
              <button
                onClick={handleFacturar}
                disabled={saving}
                className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-sky-700 transition disabled:opacity-50"
              >
                {saving ? 'Facturando...' : 'Facturar'}
              </button>
            </>
          )}

          {status === ORDER_STATUS.FACTURADO && (
            <span className="rounded-2xl bg-orange-100 px-4 py-2.5 text-sm font-semibold text-orange-700">
              Pendiente en Logística →
            </span>
          )}

          {status === ORDER_STATUS.EN_LOGISTICA && (
            <span className="rounded-2xl bg-orange-100 px-4 py-2.5 text-sm font-semibold text-orange-700">
              En ruta de entrega
            </span>
          )}
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {/* Timeline de estado */}
      <div className="rounded-3xl border border-stone-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-center gap-0 overflow-x-auto">
          {STATUS_FLOW.map((s, idx) => {
            const done = idx <= currentIdx
            const active = idx === currentIdx
            return (
              <div key={s} className="flex items-center flex-shrink-0">
                <div className={`flex flex-col items-center gap-1 ${active ? 'opacity-100' : done ? 'opacity-80' : 'opacity-30'}`}>
                  <div className={`h-3 w-3 rounded-full ${active ? 'bg-[#2f5d50] ring-4 ring-emerald-100' : done ? 'bg-[#2f5d50]' : 'bg-stone-300'}`} />
                  <span className={`text-xs font-medium whitespace-nowrap ${active ? 'text-[#2f5d50]' : 'text-stone-500'}`}>
                    {STATUS_LABEL[s]}
                  </span>
                </div>
                {idx < STATUS_FLOW.length - 1 && (
                  <div className={`h-0.5 w-10 mx-1 flex-shrink-0 ${idx < currentIdx ? 'bg-[#2f5d50]' : 'bg-stone-200'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Info del cliente */}
      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-400">Cliente</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Nombre', value: client?.commercial_name },
            { label: 'NIT', value: client?.nit || 'CF' },
            { label: 'Dirección', value: client?.main_address },
            { label: 'Teléfono', value: client?.phone },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-stone-400">{label}</p>
              <p className="mt-0.5 text-sm font-medium text-stone-800">{value || '—'}</p>
            </div>
          ))}
        </div>
        {order.notes && (
          <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
            <span className="font-medium text-stone-700">Notas: </span>{order.notes}
          </div>
        )}
      </div>

      {/* Indicador de inventario global */}
      {status === ORDER_STATUS.CONFIRMADO && (
        <Alert type={inventoryOk ? 'success' : 'warn'}>
          {inventoryOk
            ? '✓ Hay inventario suficiente para completar este pedido.'
            : '⚠ No hay inventario suficiente para todos los productos. Revisa cada ítem.'}
        </Alert>
      )}

      {/* Ítems del pedido */}
      <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-400">Productos del pedido</h2>
        </div>
        <div className="divide-y divide-stone-100">
          {items.map((item) => {
            const pres = item.product_presentations
            const itemPackings = packings.filter((p) => p.order_item_id === item.id)
            const pendiente = n(item.quantity) - n(item.quantity_packed)
            const isPacked = pendiente <= 0
            const canPack = (status === ORDER_STATUS.CONFIRMADO || status === ORDER_STATUS.EMPACADO) && !isPacked

            return (
              <div key={item.id} className="px-6 py-4">
                <div className="grid gap-3 md:grid-cols-[2fr_repeat(4,1fr)_auto] items-center">
                  <div>
                    <p className="font-medium text-stone-800">{pres?.display_name || '—'}</p>
                    <p className="text-xs text-stone-400">{pres?.code} · {pres?.net_weight} {pres?.unit}</p>
                    {status === ORDER_STATUS.CONFIRMADO && (
                      <div className="mt-1">
                        <InventoryIndicator
                          presentationId={item.product_presentation_id}
                          needed={pendiente}
                          inventory={inventory}
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-stone-400">Pedido</p>
                    <p className="font-semibold text-stone-800">{n(item.quantity)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-stone-400">Empacado</p>
                    <p className={`font-semibold ${isPacked ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {n(item.quantity_packed)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-stone-400">Precio</p>
                    <p className="font-medium text-stone-700">Q {fmt(item.unit_price)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-stone-400">Subtotal</p>
                    <p className="font-semibold text-stone-800">Q {fmt(item.subtotal)}</p>
                  </div>
                  <div>
                    {canPack ? (
                      <button
                        onClick={() => setPackingItem(item)}
                        className="rounded-xl bg-[#2f5d50] px-3 py-2 text-xs font-semibold text-white hover:bg-[#264c42] transition whitespace-nowrap"
                      >
                        Empacar
                      </button>
                    ) : isPacked ? (
                      <span className="text-xs font-semibold text-emerald-600">✓ Completo</span>
                    ) : null}
                  </div>
                </div>

                {/* Detalle de packings */}
                {itemPackings.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {itemPackings.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                        <span>📦 {n(p.quantity_packed)} unid.</span>
                        <span>Lote: {p.finished_inventory_lots?.finished_lot_code}</span>
                        <span className="text-emerald-400">{p.packed_at?.slice(0, 10)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Total */}
        <div className="flex justify-end px-6 py-4 border-t border-stone-100 bg-stone-50">
          <div className="text-right">
            <p className="text-xs text-stone-400">Total del pedido</p>
            <p className="text-xl font-bold text-stone-900">Q {fmt(order.total)}</p>
          </div>
        </div>
      </div>

      {/* Modal empacar */}
      {packingItem && (
        <PackItemModal
          item={packingItem}
          inventory={inventory}
          onPack={handlePack}
          onClose={() => setPackingItem(null)}
          saving={saving}
        />
      )}

      {showCancelConfirm && order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Cancelar pedido?</h3>
            <p className="mt-2 text-sm text-stone-600">
              El pedido <strong>#{order.order_number}</strong> pasará a estado cancelado. Esta acción no se puede deshacer.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Volver
              </button>
              <button
                onClick={async () => {
                  setShowCancelConfirm(false)
                  await handleStatusChange(ORDER_STATUS.CANCELADO)
                  onBack()
                }}
                disabled={saving}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {saving ? 'Cancelando...' : 'Cancelar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFacturaPreview && order && (
        <FacturaTcModal
          orderId={orderId}
          onClose={() => setShowFacturaPreview(false)}
          onGenerated={(factura) => {
            setFacturaExport(factura)
            setShowFacturaPreview(false)
          }}
        />
      )}

      {showDispatchCosts && (
        <DispatchCostsModal
          order={order}
          onDispatch={handleDispatch}
          onClose={() => setShowDispatchCosts(false)}
          saving={saving}
        />
      )}
    </div>
  )
}

// ─── Mini modal tipo de cambio para generar factura exportación ───────────────

function FacturaTcModal({ orderId, onClose, onGenerated }) {
  const [tcInput, setTcInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [err, setErr] = useState('')

  async function handleGenerar() {
    const tc = Number(tcInput)
    if (!tc || tc <= 0) { setErr('Ingrese el tipo de cambio (ej. 7.75)'); return }
    setGenerating(true)
    setErr('')
    try {
      const factura = await generarFactura(orderId, { tipoCambio: tc })
      onGenerated(factura)
    } catch (e) {
      setErr(e.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-stone-800 mb-1">Generar factura de exportación</h3>
        <p className="text-sm text-stone-500 mb-4">Ingrese el tipo de cambio para convertir el total del pedido a USD.</p>
        <label className="block text-xs font-semibold text-stone-500 mb-1">Tipo de cambio (GTQ / USD)</label>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-stone-500">Q</span>
          <input
            type="number"
            step="0.0001"
            placeholder="ej. 7.7500"
            value={tcInput}
            onChange={e => setTcInput(e.target.value)}
            autoFocus
            className="flex-1 rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100"
          />
          <span className="text-sm text-stone-500">/ USD</span>
        </div>
        {err && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-3 mt-2">
          <button onClick={onClose} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button
            onClick={handleGenerar}
            disabled={generating}
            className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? 'Generando…' : 'Generar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Orden de producción ──────────────────────────────────────────────────────

function downloadProductionOrder(orders, presentations) {
  const presMap = {}
  presentations.forEach(p => { presMap[p.id] = p })

  const byPres = {}
  orders
    .filter(o => ['confirmado', 'empacado'].includes(o.status))
    .forEach(order => {
      ;(order.order_items || []).forEach(item => {
        const pending = n(item.quantity) - n(item.quantity_packed)
        if (pending <= 0) return
        const pid = item.product_presentation_id
        if (!byPres[pid]) {
          const p = presMap[pid] || {}
          byPres[pid] = { code: p.code || '—', name: p.display_name || pid, unit: p.unit || '', qty: 0 }
        }
        byPres[pid].qty += pending
      })
    })

  const rows = Object.values(byPres).sort((a, b) => a.code.localeCompare(b.code))
  if (rows.length === 0) { alert('No hay productos pendientes de empacar en pedidos confirmados.'); return }

  const date = new Date().toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' })
  const dateFile = new Date().toISOString().slice(0, 10)
  const totalQty = rows.reduce((a, r) => a + r.qty, 0)

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const strCell = v => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`
  const numCell = v => `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
  const boldCell = v => `<Cell ss:StyleID="bold"><Data ss:Type="String">${esc(v)}</Data></Cell>`
  const headerCell = v => `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(v)}</Data></Cell>`

  const dataRows = rows.map(r =>
    `<Row>${strCell(r.code)}${strCell(r.name)}${numCell(r.qty)}${strCell(r.unit)}</Row>`
  ).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  <Styles>
    <Style ss:ID="bold">
      <Font ss:Bold="1" ss:Size="11"/>
    </Style>
    <Style ss:ID="header">
      <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="11"/>
      <Interior ss:Color="#2F5D50" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="title">
      <Font ss:Bold="1" ss:Size="14"/>
    </Style>
    <Style ss:ID="total">
      <Font ss:Bold="1" ss:Size="11"/>
      <Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Orden de Producción">
    <Table ss:DefaultColumnWidth="120">
      <Column ss:Width="80"/>
      <Column ss:Width="220"/>
      <Column ss:Width="120"/>
      <Column ss:Width="80"/>
      <Row ss:Height="24">
        <Cell ss:StyleID="title"><Data ss:Type="String">ORDEN DE PRODUCCIÓN</Data></Cell>
      </Row>
      <Row>
        <Cell><Data ss:Type="String">Generado: ${esc(date)}</Data></Cell>
      </Row>
      <Row/>
      <Row ss:Height="20">
        ${headerCell('Código')}${headerCell('Presentación / Producto')}${headerCell('Cantidad')}${headerCell('Unidad')}
      </Row>
      ${dataRows}
      <Row/>
      <Row>
        ${boldCell('TOTAL')}${boldCell('')}<Cell ss:StyleID="total"><Data ss:Type="Number">${totalQty}</Data></Cell>${boldCell('')}
      </Row>
    </Table>
  </Worksheet>
</Workbook>`

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orden-produccion-${dateFile}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Vista de queue (lista) ───────────────────────────────────────────────────

function QueueView({ orders, loading, inventory, presentations, onNew, onSelect, onRefresh, onBulkPDF }) {
  const [statusFilter, setStatusFilter] = useState('todos')

  const counts = useMemo(() => {
    const c = { todos: orders.length }
    STATUS_FLOW.forEach((s) => { c[s] = orders.filter((o) => o.status === s).length })
    return c
  }, [orders])

  const filtered = useMemo(() => {
    if (statusFilter === 'todos') return orders
    return orders.filter((o) => o.status === statusFilter)
  }, [orders, statusFilter])

  const totalPendiente = useMemo(() => (
    orders.filter((o) => o.status === ORDER_STATUS.CONFIRMADO || o.status === ORDER_STATUS.EMPACADO)
      .reduce((acc, o) => acc + n(o.total), 0)
  ), [orders])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ERP · Ventas</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900">Pedidos</h1>
          <p className="mt-1 text-sm text-stone-500">Gestión de pedidos, empaque y despacho.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {orders.some((o) => o.status === ORDER_STATUS.EMPACADO) && (
            <button
              onClick={onBulkPDF}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition"
            >
              🖨 PDFs empacados
            </button>
          )}
          {orders.some((o) => ['confirmado', 'empacado'].includes(o.status)) && (
            <button
              onClick={() => downloadProductionOrder(orders, presentations)}
              className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 transition"
            >
              📋 Orden de producción
            </button>
          )}
          <button onClick={onRefresh} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50 transition">
            Actualizar
          </button>
          <button
            onClick={onNew}
            className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-[#264c42] transition"
          >
            + Nuevo pedido
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Total pedidos', value: counts.todos },
          { label: 'Confirmados', value: counts.confirmado || 0 },
          { label: 'Empacados', value: counts.empacado || 0 },
          { label: 'Valor pendiente', value: `Q ${fmt(totalPendiente)}` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-3xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-stone-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros de estado */}
      <div className="flex gap-2 flex-wrap">
        {[{ key: 'todos', label: 'Todos' }, ...STATUS_FLOW.map((s) => ({ key: s, label: STATUS_LABEL[s] }))].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              statusFilter === key
                ? 'bg-[#2f5d50] text-white shadow-sm'
                : 'bg-white border border-stone-200 text-stone-600 hover:border-stone-300'
            }`}
          >
            {label} {counts[key] > 0 && <span className="ml-1 opacity-70">({counts[key]})</span>}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-3xl border border-stone-200 bg-white py-16">
          <Spinner />
          <span className="text-sm text-stone-500">Cargando pedidos...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-16 text-center">
          <p className="text-stone-400">No hay pedidos {statusFilter !== 'todos' ? `con estado "${STATUS_LABEL[statusFilter]}"` : 'registrados'}.</p>
          {statusFilter === 'todos' && (
            <button onClick={onNew} className="mt-4 rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] transition">
              Crear primer pedido
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const client = order.clients
            const items = order.order_items || []
            const totalItems = items.length
            const totalPacked = items.filter((i) => n(i.quantity_packed) >= n(i.quantity)).length

            // Chequeo rápido de inventario para confirmados
            const hasInventoryWarning = order.status === ORDER_STATUS.CONFIRMADO && items.some((item) => {
              const lots = inventory?.[item.product_presentation_id] || []
              const available = lots.reduce((acc, l) => acc + n(l.available_quantity), 0)
              const needed = n(item.quantity) - n(item.quantity_packed)
              return available < needed
            })

            return (
              <button
                key={order.id}
                onClick={() => onSelect(order.id)}
                className="w-full rounded-3xl border border-stone-200 bg-white px-6 py-5 text-left shadow-sm hover:border-stone-300 hover:shadow-md transition group"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-sm font-bold text-stone-600">
                      #{order.order_number}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-stone-900">{client?.commercial_name || '—'}</span>
                        <StatusBadge status={order.status} />
                        {hasInventoryWarning && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚠ Sin inventario</span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-stone-400 flex-wrap">
                        <span>Entrega: {order.delivery_date}</span>
                        <span>·</span>
                        <span>{totalItems} SKU{totalItems !== 1 ? 's' : ''}</span>
                        {order.status !== ORDER_STATUS.CONFIRMADO && (
                          <>
                            <span>·</span>
                            <span className={totalPacked === totalItems ? 'text-emerald-500' : 'text-amber-500'}>
                              {totalPacked}/{totalItems} empacados
                            </span>
                          </>
                        )}
                        {order.channel !== 'manual' && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">{order.channel}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-bold text-stone-900">Q {fmt(order.total)}</p>
                      <p className="text-xs text-stone-400">{order.created_at?.slice(0, 10)}</p>
                    </div>
                    <span className="text-stone-300 group-hover:text-stone-500 transition text-lg">→</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function PedidosPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState('queue') // 'queue' | 'nuevo' | 'detalle' | 'editar'
  const [orders, setOrders] = useState([])
  const [clients, setClients] = useState([])
  const [presentations, setPresentations] = useState([])
  const [inventory, setInventory] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [editingOrder, setEditingOrder] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError('')
    const [rOrders, rClients, rPresentations, rInventory] = await Promise.allSettled([
      getOrders(),
      getClients(),
      getPresentations(),
      getInventoryByPresentation(),
    ])
    if (rOrders.status === 'fulfilled') setOrders(rOrders.value)
    else setError(rOrders.reason?.message || 'Error al cargar pedidos')
    if (rClients.status === 'fulfilled') setClients(rClients.value)
    if (rPresentations.status === 'fulfilled') setPresentations(rPresentations.value)
    if (rInventory.status === 'fulfilled') setInventory(rInventory.value)
    else console.error('Inventario no cargó:', rInventory.reason?.message)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])
  useRealtimeRefresh(['orders', 'order_items'], loadAll)

  useEffect(() => {
    const orderId = searchParams.get('order')
    if (!orderId) return
    setSelectedOrderId(orderId)
    setView('detalle')
  }, [searchParams])

  async function handleCreate(payload) {
    setSaving(true)
    setError('')
    try {
      await createOrder(payload)
      await loadAll()
      setView('queue')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(payload) {
    setSaving(true)
    setError('')
    try {
      await updateOrder(editingOrder.id, payload)
      await loadAll()
      setSelectedOrderId(editingOrder.id)
      setView('detalle')
      setEditingOrder(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleBulkPDF() {
    const packed = orders.filter((o) => o.status === ORDER_STATUS.EMPACADO)
    for (const o of packed) {
      const detail = await getOrderById(o.id)
      printOrderPDF(detail)
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  function goToDetail(orderId) {
    setSearchParams({ order: orderId })
    setSelectedOrderId(orderId)
    setView('detalle')
  }

  function goToEdit(order) {
    setEditingOrder(order)
    setView('editar')
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl">
        {error && view === 'queue' && (
          <div className="mb-4">
            <Alert type="error">{error}</Alert>
          </div>
        )}

        {view === 'queue' && (
          <QueueView
            orders={orders}
            loading={loading}
            inventory={inventory}
            presentations={presentations}
            onNew={() => setView('nuevo')}
            onSelect={goToDetail}
            onRefresh={loadAll}
            onBulkPDF={handleBulkPDF}
          />
        )}

        {view === 'nuevo' && (
          <OrderForm
            clients={clients}
            presentations={presentations}
            onSave={handleCreate}
            onCancel={() => setView('queue')}
            saving={saving}
          />
        )}

        {view === 'editar' && editingOrder && (
          <OrderForm
            initial={editingOrder}
            clients={clients}
            presentations={presentations}
            onSave={handleEdit}
            onCancel={() => { setView('detalle'); setEditingOrder(null) }}
            saving={saving}
          />
        )}

        {view === 'detalle' && selectedOrderId && (
          <OrderDetailView
            orderId={selectedOrderId}
            inventory={inventory}
            onBack={() => { setSearchParams({}); setView('queue') }}
            onStatusChange={loadAll}
            onEdit={goToEdit}
          />
        )}
      </div>

    </div>
  )
}
