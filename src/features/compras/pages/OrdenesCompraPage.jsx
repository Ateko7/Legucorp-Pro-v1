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