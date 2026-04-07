import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  createPurchaseOrder,
  getMaterialsForPurchaseOrders,
  getPurchaseOrders,
  getSuppliersForPurchaseOrders,
  updatePurchaseOrderStatus,
} from '../Services/purchaseOrdersService'

const emptyItem = {
  material_id: '',
  quantity: '',
  unit: '',
  unit_cost: '',
}

const emptyForm = {
  supplier_id: '',
  delivery_date: '',
  notes: '',
  items: [{ ...emptyItem }],
}

// ─── WhatsApp helper ──────────────────────────────────────────────────────────

function cleanPhone(raw) {
  if (!raw) return null
  // Strip everything except digits
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  // If already has country code (>= 10 digits), use as-is
  if (digits.length >= 10) return digits
  // Guatemalan local 8-digit numbers → add 502
  if (digits.length === 8) return '502' + digits
  return digits
}

function buildWhatsAppMessage(order) {
  const supplier = order.suppliers?.name || 'Proveedor'
  const items = order.purchase_order_items || []
  const total = items.reduce((a, i) => a + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0)
  const date = new Date().toLocaleDateString('es-GT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const lines = items.map(i => {
    const qty = Number(i.quantity || 0)
    const name = i.materials?.common_name || 'Material'
    return `  • ${name}: *${qty.toLocaleString('es-GT', { maximumFractionDigits: 2 })} ${i.unit}*`
  }).join('\n')

  return (
    `*ORDEN DE COMPRA ${order.order_number}*\n` +
    `Legucorp Pro · ${date}\n\n` +
    `*Proveedor:* ${supplier}\n` +
    `*Entrega:* ${order.delivery_date || '—'}\n\n` +
    `*Materiales solicitados:*\n${lines}\n\n` +
    (total > 0 ? `*Total estimado:* Q ${total.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` : '') +
    (order.notes ? `_Notas: ${order.notes}_\n\n` : '') +
    `_Enviado desde Legucorp Pro ERP_`
  )
}

function sendWhatsApp(order) {
  const phone = cleanPhone(order.suppliers?.phone)
  const msg = buildWhatsAppMessage(order)
  const encoded = encodeURIComponent(msg)
  const url = phone
    ? `https://wa.me/${phone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

// ─────────────────────────────────────────────────────────────────────────────

export default function OrdenesCompraPage() {
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [materials, setMaterials] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusLoadingId, setStatusLoadingId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [cancelTarget, setCancelTarget] = useState(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')

    try {
      const [ordersData, suppliersData, materialsData] = await Promise.all([
        getPurchaseOrders(),
        getSuppliersForPurchaseOrders(),
        getMaterialsForPurchaseOrders(),
      ])

      setOrders(ordersData)
      setSuppliers(suppliersData)
      setMaterials(materialsData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las órdenes de compra')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setForm(emptyForm)
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setSaving(false)
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  function handleItemChange(index, field, value) {
    setForm((prev) => {
      const nextItems = [...prev.items]

      if (field === 'material_id') {
        const selectedMaterial = materials.find((m) => m.id === value)
        nextItems[index] = {
          ...nextItems[index],
          material_id: value,
          unit: selectedMaterial?.base_unit || '',
        }
      } else {
        nextItems[index] = {
          ...nextItems[index],
          [field]: value,
        }
      }

      return {
        ...prev,
        items: nextItems,
      }
    })
  }

  function addItem() {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { ...emptyItem }],
    }))
  }

  function removeItem(index) {
    setForm((prev) => {
      const filtered = prev.items.filter((_, i) => i !== index)
      return {
        ...prev,
        items: filtered.length ? filtered : [{ ...emptyItem }],
      }
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await createPurchaseOrder(form)
      setSuccess('Orden de compra creada correctamente.')
      await loadAll()

      setTimeout(() => {
        closeModal()
      }, 700)
    } catch (err) {
      setError(err.message || 'No se pudo crear la orden de compra')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(orderId, status) {
    setStatusLoadingId(orderId)
    setError('')
    setSuccess('')

    try {
      await updatePurchaseOrderStatus(orderId, status)
      setSuccess('Estado de la orden actualizado correctamente.')
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el estado')
    } finally {
      setStatusLoadingId(null)
    }
  }

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return orders

    return orders.filter((order) =>
      [
        order.order_number,
        order.status,
        order.suppliers?.name,
        order.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [orders, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Abastecimiento
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Órdenes de compra</h1>
          <p className="mt-2 text-sm text-stone-500">
            Crea órdenes de compra con múltiples materias primas para enlazarlas luego con recepción.
          </p>
        </div>

        <button
          onClick={openModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nueva orden
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por número, proveedor o estado..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 md:max-w-md"
          />

          <button
            onClick={loadAll}
            className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
          >
            Recargar
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">
            Cargando órdenes de compra...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay órdenes de compra registradas todavía.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => {
              const total = (order.purchase_order_items || []).reduce(
                (acc, item) => acc + Number(item.quantity || 0) * Number(item.unit_cost || 0),
                0
              )

              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
                >
                  <div className="grid gap-4 md:grid-cols-[1.1fr_1fr_1fr_1fr_auto] md:items-center">
                    <div>
                      <div className="text-base font-semibold text-stone-800">
                        {order.order_number}
                      </div>
                      <div className="mt-1 text-sm text-stone-500">
                        {order.suppliers?.name || 'Sin proveedor'}
                      </div>
                    </div>

                    <div className="text-sm text-stone-500">
                      Fecha entrega: {order.delivery_date || '—'}
                    </div>

                    <div className="text-sm text-stone-500">
                      Líneas: {order.purchase_order_items?.length || 0}
                    </div>

                    <div className="text-sm text-stone-500">
                      Total: Q {total.toFixed(2)}
                    </div>

                    <div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          order.status === 'abierta'
                            ? 'bg-amber-100 text-amber-800'
                            : order.status === 'enviada'
                            ? 'bg-blue-100 text-blue-700'
                            : order.status === 'parcial'
                            ? 'bg-orange-100 text-orange-700'
                            : order.status === 'cerrada'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-stone-200 pt-4">
                    {(order.purchase_order_items || []).map((item) => (
                      <div
                        key={item.id}
                        className="grid gap-3 rounded-xl bg-white px-4 py-3 text-sm text-stone-600 md:grid-cols-[1.2fr_1fr_1fr_1fr]"
                      >
                        <div>
                          {item.materials?.common_name || 'Materia prima'} ({item.materials?.code || '—'})
                        </div>
                        <div>
                          {Number(item.quantity || 0).toFixed(2)} {item.unit}
                        </div>
                        <div>
                          Q {Number(item.unit_cost || 0).toFixed(4)}
                        </div>
                        <div>
                          Q {(Number(item.quantity || 0) * Number(item.unit_cost || 0)).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    {/* WhatsApp */}
                    <button
                      onClick={() => sendWhatsApp(order)}
                      className="flex items-center gap-1.5 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                      title={order.suppliers?.phone ? `Enviar a ${order.suppliers.phone}` : 'Enviar por WhatsApp (sin teléfono registrado)'}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      WhatsApp{!order.suppliers?.phone && ' (sin tel.)'}
                    </button>

                    <button
                      onClick={() => handleStatusChange(order.id, 'enviada')}
                      disabled={statusLoadingId === order.id}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
                    >
                      {statusLoadingId === order.id ? 'Procesando...' : 'Marcar enviada'}
                    </button>

                    <button
                      onClick={() => handleStatusChange(order.id, 'parcial')}
                      disabled={statusLoadingId === order.id}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
                    >
                      {statusLoadingId === order.id ? 'Procesando...' : 'Marcar parcial'}
                    </button>

                    <button
                      onClick={() => handleStatusChange(order.id, 'cerrada')}
                      disabled={statusLoadingId === order.id}
                      className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                    >
                      {statusLoadingId === order.id ? 'Procesando...' : 'Cerrar orden'}
                    </button>

                    <button
                      onClick={() => setCancelTarget(order)}
                      disabled={statusLoadingId === order.id}
                      className="rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}
      </section>

      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Cancelar orden de compra?</h3>
            <p className="mt-2 text-sm text-stone-600">
              La OC <strong>{cancelTarget.order_number}</strong> pasará a estado cancelada.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Volver
              </button>
              <button
                onClick={async () => {
                  await handleStatusChange(cancelTarget.id, 'cancelada')
                  setCancelTarget(null)
                }}
                disabled={statusLoadingId === cancelTarget.id}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {statusLoadingId === cancelTarget.id ? 'Cancelando...' : 'Cancelar orden'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Nueva orden de compra"
        maxWidth="max-w-6xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Proveedor *">
              <select
                name="supplier_id"
                value={form.supplier_id}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Seleccionar proveedor</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Fecha de entrega">
              <input
                name="delivery_date"
                type="date"
                value={form.delivery_date}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>
          </section>

          <section>
            <Field label="Notas">
              <textarea
                name="notes"
                rows={3}
                value={form.notes}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-stone-800">Líneas de la orden</h3>
              <button
                type="button"
                onClick={addItem}
                className="rounded-2xl border border-[#2f5d50] px-4 py-2 text-sm font-semibold text-[#2f5d50] transition hover:bg-emerald-50"
              >
                + Agregar línea
              </button>
            </div>

            <div className="space-y-3">
              {form.items.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1.5fr_0.9fr_0.8fr_0.9fr_auto]"
                >
                  <select
                    value={item.material_id}
                    onChange={(e) => handleItemChange(index, 'material_id', e.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">Seleccionar materia prima</option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.common_name} ({material.code})
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    step="0.0001"
                    placeholder="Cantidad"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                  />

                  <input
                    placeholder="Unidad"
                    value={item.unit}
                    onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                  />

                  <input
                    type="number"
                    step="0.0001"
                    placeholder="Costo unit."
                    value={item.unit_cost}
                    onChange={(e) => handleItemChange(index, 'unit_cost', e.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                  />

                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          </section>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 md:flex-row md:justify-end">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar orden'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}