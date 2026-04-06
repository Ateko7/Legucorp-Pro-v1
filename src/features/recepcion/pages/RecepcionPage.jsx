import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  createReception,
  getOpenPurchaseOrders,
  getReceptionMaterials,
  getReceptionSuppliers,
  getReceptions,
  releaseReception,
  rejectReception,
} from '../services/receptionService'

const emptyForm = {
  purchase_order_id: '',
  purchase_order_item_id: '',
  supplier_id: '',
  material_id: '',
  supplier_lot: '',
  received_date: new Date().toISOString().slice(0, 10),
  quantity_received: '',
  quantity_accepted: '',
  unit: '',
  quality_notes: '',
  unit_cost: '',
}

export default function RecepcionPage() {
  const [receptions, setReceptions] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [materials, setMaterials] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusLoadingId, setStatusLoadingId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')

    try {
      const [receptionsData, suppliersData, materialsData, purchaseOrdersData] =
        await Promise.all([
          getReceptions(),
          getReceptionSuppliers(),
          getReceptionMaterials(),
          getOpenPurchaseOrders(),
        ])

      setReceptions(receptionsData)
      setSuppliers(suppliersData)
      setMaterials(materialsData)
      setPurchaseOrders(purchaseOrdersData)
    } catch (err) {
      setError(err.message || 'No se pudo cargar recepción')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setForm({
      ...emptyForm,
      received_date: new Date().toISOString().slice(0, 10),
    })
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

    if (name === 'purchase_order_id') {
      const selectedPO = purchaseOrders.find((po) => po.id === value)

      setForm((prev) => ({
        ...prev,
        purchase_order_id: value,
        purchase_order_item_id: '',
        supplier_id: selectedPO?.supplier_id || '',
        material_id: '',
        unit: '',
        unit_cost: '',
      }))
      return
    }

    if (name === 'purchase_order_item_id') {
      const selectedPO = purchaseOrders.find((po) => po.id === form.purchase_order_id)
      const selectedItem = selectedPO?.purchase_order_items?.find((item) => item.id === value)

      setForm((prev) => ({
        ...prev,
        purchase_order_item_id: value,
        material_id: selectedItem?.material_id || '',
        unit: selectedItem?.unit || selectedItem?.materials?.base_unit || '',
        unit_cost:
          selectedItem?.unit_cost !== undefined && selectedItem?.unit_cost !== null
            ? String(selectedItem.unit_cost)
            : '',
      }))
      return
    }

    if (name === 'material_id' && !form.purchase_order_id) {
      const selectedMaterial = materials.find((m) => m.id === value)

      setForm((prev) => ({
        ...prev,
        material_id: value,
        unit: selectedMaterial?.base_unit || '',
      }))
      return
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await createReception(form)
      setSuccess('Recepción creada correctamente.')
      await loadAll()

      setTimeout(() => {
        closeModal()
      }, 700)
    } catch (err) {
      setError(err.message || 'No se pudo crear la recepción')
    } finally {
      setSaving(false)
    }
  }

  async function handleRelease(receptionId) {
    setStatusLoadingId(receptionId)
    setError('')
    setSuccess('')

    try {
      await releaseReception(receptionId)
      setSuccess('Lote liberado y enviado al inventario correctamente.')
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo liberar el lote')
    } finally {
      setStatusLoadingId(null)
    }
  }

  async function handleReject(receptionId) {
    setStatusLoadingId(receptionId)
    setError('')
    setSuccess('')

    try {
      await rejectReception(receptionId)
      setSuccess('Lote rechazado correctamente.')
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo rechazar el lote')
    } finally {
      setStatusLoadingId(null)
    }
  }

  const selectedPO = useMemo(() => {
    return purchaseOrders.find((po) => po.id === form.purchase_order_id) || null
  }, [purchaseOrders, form.purchase_order_id])

  const availablePOItems = useMemo(() => {
    return selectedPO?.purchase_order_items || []
  }, [selectedPO])

  const calculatedRejected = useMemo(() => {
    const received = Number(form.quantity_received || 0)
    const accepted = Number(form.quantity_accepted || 0)
    return Math.max(received - accepted, 0)
  }, [form.quantity_received, form.quantity_accepted])

  const calculatedLotCost = useMemo(() => {
    const received = Number(form.quantity_received || 0)
    const unitCost = Number(form.unit_cost || 0)
    return received * unitCost
  }, [form.quantity_received, form.unit_cost])

  const filteredReceptions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return receptions

    return receptions.filter((row) =>
      [
        row.internal_lot,
        row.supplier_lot,
        row.status,
        row.suppliers?.name,
        row.materials?.common_name,
        row.materials?.code,
        row.purchase_orders?.order_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [receptions, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Abastecimiento
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Recepción</h1>
          <p className="mt-2 text-sm text-stone-500">
            Registra ingresos de materia prima y luego libera o rechaza el lote desde el listado.
          </p>
        </div>

        <button
          onClick={openModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nueva recepción
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por lote, proveedor, orden de compra, materia prima o estado..."
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
            Cargando recepciones...
          </div>
        ) : filteredReceptions.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay recepciones registradas todavía.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReceptions.map((row) => (
              <div
                key={row.id}
                className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
              >
                <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <div className="text-base font-semibold text-stone-800">
                      {row.materials?.common_name || '—'}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      {row.materials?.code || 'Sin código'}
                    </div>
                  </div>

                  <div className="text-sm text-stone-500">
                    Prov.: {row.suppliers?.name || '—'}
                  </div>

                  <div className="text-sm text-stone-500">
                    Lote: {row.internal_lot}
                  </div>

                  <div className="text-sm text-stone-500">
                    {Number(row.quantity_received || 0).toFixed(2)} {row.unit}
                  </div>

                  <div className="text-sm text-stone-500">
                    OC: {row.purchase_orders?.order_number || '—'}
                  </div>

                  <div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        row.status === 'liberado'
                          ? 'bg-emerald-100 text-emerald-800'
                          : row.status === 'rechazado'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 border-t border-stone-200 pt-3 text-sm text-stone-500 md:grid-cols-5">
                  <div>Fecha: {row.received_date}</div>
                  <div>Aceptado: {Number(row.quantity_accepted || 0).toFixed(2)}</div>
                  <div>Rechazado: {Number(row.quantity_rejected || 0).toFixed(2)}</div>
                  <div>Costo lote: Q {Number(row.real_cost || 0).toFixed(2)}</div>
                  <div>Lote proveedor: {row.supplier_lot || '—'}</div>
                </div>

                {row.status === 'recibido' ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={() => handleRelease(row.id)}
                      disabled={statusLoadingId === row.id}
                      className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                    >
                      {statusLoadingId === row.id ? 'Procesando...' : 'Liberar lote'}
                    </button>

                    <button
                      onClick={() => handleReject(row.id)}
                      disabled={statusLoadingId === row.id}
                      className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                    >
                      {statusLoadingId === row.id ? 'Procesando...' : 'Rechazar lote'}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
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

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Nueva recepción"
        maxWidth="max-w-5xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Orden de compra">
              <select
                name="purchase_order_id"
                value={form.purchase_order_id}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Sin orden de compra</option>
                {purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.order_number} - {po.suppliers?.name || 'Sin proveedor'}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Línea de orden de compra">
              <select
                name="purchase_order_item_id"
                value={form.purchase_order_item_id}
                onChange={handleChange}
                disabled={!form.purchase_order_id}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition disabled:cursor-not-allowed disabled:opacity-50 focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Seleccionar línea</option>
                {availablePOItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.materials?.common_name || 'Materia prima'} - {Number(item.quantity).toFixed(2)} {item.unit}
                  </option>
                ))}
              </select>
            </Field>

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

            <Field label="Materia prima *">
              <select
                name="material_id"
                value={form.material_id}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Seleccionar materia prima</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.common_name} ({material.code})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Lote proveedor">
              <input
                name="supplier_lot"
                value={form.supplier_lot}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Fecha de recepción *">
              <input
                name="received_date"
                type="date"
                value={form.received_date}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Unidad *">
              <input
                name="unit"
                value={form.unit}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Costo unitario *">
              <input
                name="unit_cost"
                type="number"
                step="0.0001"
                value={form.unit_cost}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Cantidad recibida *">
              <input
                name="quantity_received"
                type="number"
                step="0.0001"
                value={form.quantity_received}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Cantidad aceptada *">
              <input
                name="quantity_accepted"
                type="number"
                step="0.0001"
                value={form.quantity_accepted}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <ReadOnlyField
              label="Cantidad rechazada"
              value={`${calculatedRejected.toFixed(2)} ${form.unit || ''}`.trim()}
            />

            <ReadOnlyField
              label="Costo total del lote"
              value={`Q ${calculatedLotCost.toFixed(2)}`}
            />
          </section>

          <section>
            <Field label="Notas de calidad">
              <textarea
                name="quality_notes"
                rows={4}
                value={form.quality_notes}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>
          </section>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            El lote interno no se escribe manualmente. Se generará automáticamente al guardar.
            El estado inicial del lote será <span className="font-semibold">recibido</span>.
            Luego podrás <span className="font-semibold">liberarlo</span> o <span className="font-semibold">rechazarlo</span> desde el listado.
          </div>

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
              {saving ? 'Guardando...' : 'Guardar recepción'}
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

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-stone-700">{label}</span>
      <div className="w-full rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3 text-stone-700">
        {value || '—'}
      </div>
    </div>
  )
}