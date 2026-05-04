import { useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import Modal from '../../../components/ui/Modal'
import {
  createBulkReceptions,
  createReception,
  getOpenPurchaseOrders,
  getReceptionMaterials,
  getReceptionSuppliers,
  getReceptions,
  releaseReception,
  rejectReception,
} from '../services/receptionService'
import {
  createInspeccion,
  getInspecciones,
  getSpecTemplates,
  completarInspeccion,
  evaluateInspectionDraft,
  RESULTADOS_CALIDAD,
} from '../../calidad/services/calidadService'

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
  bulk_items: [],
}

const RESULTADO_LABEL = {
  liberado: 'Liberado',
  liberado_con_observacion: 'Con observacion',
  retenido: 'Retenido',
  rechazado: 'Rechazado',
}

const RESULTADO_COLOR = {
  liberado: 'bg-emerald-100 text-emerald-700',
  liberado_con_observacion: 'bg-amber-100 text-amber-700',
  retenido: 'bg-orange-100 text-orange-700',
  rechazado: 'bg-red-100 text-red-700',
}

const SEVERITY_COLOR = {
  menor: 'bg-stone-100 text-stone-700',
  mayor: 'bg-orange-100 text-orange-700',
  critico: 'bg-red-100 text-red-700',
}

function toBulkItem(item) {
  return {
    purchase_order_item_id: item.id,
    material_id: item.material_id,
    material_name: item.materials?.common_name || 'Materia prima',
    material_code: item.materials?.code || '',
    supplier_lot: '',
    quantity_ordered: Number(item.quantity || 0),
    quantity_received: String(item.quantity || ''),
    quantity_accepted: String(item.quantity || ''),
    unit: item.unit || item.materials?.base_unit || '',
    unit_cost: item.unit_cost !== undefined && item.unit_cost !== null ? String(item.unit_cost) : '',
    quality_notes: '',
  }
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
  const [qualityModal, setQualityModal] = useState(null)
  const [qualityTemplates, setQualityTemplates] = useState([])
  const [receptionInspections, setReceptionInspections] = useState([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    loadAll()
  }, [])
  useRealtimeRefresh(['purchase_orders', 'material_inventory_lots', 'material_receptions'], loadAll)

  async function loadAll() {
    setLoading(true)
    setError('')

    try {
      const [receptionsData, suppliersData, materialsData, purchaseOrdersData, templates, inspections] =
        await Promise.all([
          getReceptions(),
          getReceptionSuppliers(),
          getReceptionMaterials(),
          getOpenPurchaseOrders(),
          getSpecTemplates('recepcion_mp'),
          getInspecciones({
            inspection_stage: 'recepcion_mp',
            desde: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10),
            hasta: new Date().toISOString().slice(0, 10),
            limit: 300,
          }),
        ])

      setReceptions(receptionsData)
      setSuppliers(suppliersData)
      setMaterials(materialsData)
      setPurchaseOrders(purchaseOrdersData)
      setQualityTemplates(templates)
      setReceptionInspections(inspections)
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
        bulk_items: (selectedPO?.purchase_order_items || []).map(toBulkItem),
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

  function handleBulkItemChange(index, field, value) {
    setForm((prev) => ({
      ...prev,
      bulk_items: prev.bulk_items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      if (form.purchase_order_id) {
        const payload = {
          purchase_order_id: form.purchase_order_id,
          supplier_id: form.supplier_id,
          received_date: form.received_date,
          quality_notes: form.quality_notes,
          items: form.bulk_items,
        }

        const created = await createBulkReceptions(payload)
        setSuccess(`Se crearon ${created.length} recepción(es) de la orden correctamente.`)
      } else {
        await createReception(form)
        setSuccess('Recepción creada correctamente.')
      }

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

  async function handleStartQualityInspection(row) {
    setStatusLoadingId(row.id)
    setError('')
    setSuccess('')

    try {
      const existing = receptionInspections.find(
        (inspection) =>
          inspection.source_reception_id === row.id &&
          inspection.status !== 'cancelada'
      )

      if (existing) {
        setQualityModal(existing)
      } else {
        const inspection = await createInspeccion({
          inspection_stage: 'recepcion_mp',
          source_reception_id: row.id,
          spec_template_id: qualityTemplates[0]?.id || null,
          origen: 'manual',
          tamano_muestra: 1,
          observaciones: row.quality_notes || '',
        })
        setQualityModal(inspection)
      }
    } catch (err) {
      setError(err.message || 'No se pudo abrir la inspeccion de calidad.')
    } finally {
      setStatusLoadingId(null)
    }
  }

  async function handleCompleteReceptionInspection(inspectionId, payload) {
    const saved = await completarInspeccion(inspectionId, payload)

    if (saved.resultado === 'liberado' || saved.resultado === 'liberado_con_observacion') {
      await handleRelease(saved.source_reception_id)
      setSuccess('Inspeccion aprobada y lote liberado al inventario.')
    } else if (saved.resultado === 'rechazado') {
      await handleReject(saved.source_reception_id)
      setSuccess('Inspeccion rechazada y recepcion marcada como rechazada.')
    } else {
      setSuccess('Inspeccion guardada. La recepcion quedo retenida pendiente de resolucion.')
    }

    setQualityModal(null)
    await loadAll()
  }

  const selectedPO = useMemo(() => {
    return purchaseOrders.find((po) => po.id === form.purchase_order_id) || null
  }, [purchaseOrders, form.purchase_order_id])

  const calculatedRejected = useMemo(() => {
    const received = Number(form.quantity_received || 0)
    const accepted = Number(form.quantity_accepted || 0)
    return Math.max(received - accepted, 0)
  }, [form.quantity_received, form.quantity_accepted])

  const calculatedLotCost = useMemo(() => {
    const accepted = Number(form.quantity_accepted || 0)
    const unitCost = Number(form.unit_cost || 0)
    return accepted * unitCost
  }, [form.quantity_accepted, form.unit_cost])

  const bulkSummary = useMemo(() => {
    return (form.bulk_items || []).reduce(
      (acc, item) => {
        const received = Number(item.quantity_received || 0)
        const accepted = Number(item.quantity_accepted || 0)
        const cost = accepted * Number(item.unit_cost || 0)
        acc.totalLines += 1
        acc.totalReceived += received
        acc.totalAccepted += accepted
        acc.totalCost += cost
        return acc
      },
      { totalLines: 0, totalReceived: 0, totalAccepted: 0, totalCost: 0 }
    )
  }, [form.bulk_items])

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

  const inspectionByReceptionId = useMemo(() => {
    const map = {}
    for (const inspection of receptionInspections) {
      if (!inspection.source_reception_id) continue
      if (!map[inspection.source_reception_id]) {
        map[inspection.source_reception_id] = inspection
      }
    }
    return map
  }, [receptionInspections])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Abastecimiento
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Recepción</h1>
          <p className="mt-2 text-sm text-stone-500">
            Registra ingresos de materia prima, incluyendo recepción masiva de todas las líneas de una OC enviada.
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

                {inspectionByReceptionId[row.id] ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${RESULTADO_COLOR[inspectionByReceptionId[row.id].resultado] || 'bg-stone-100 text-stone-700'}`}>
                      Calidad: {inspectionByReceptionId[row.id].resultado ? RESULTADO_LABEL[inspectionByReceptionId[row.id].resultado] : inspectionByReceptionId[row.id].status}
                    </span>
                    {inspectionByReceptionId[row.id].spec_template?.name ? (
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
                        {inspectionByReceptionId[row.id].spec_template.name}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {row.status === 'recibido' ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={() => handleStartQualityInspection(row)}
                      disabled={statusLoadingId === row.id}
                      className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:opacity-60"
                    >
                      {statusLoadingId === row.id ? 'Abriendo...' : inspectionByReceptionId[row.id] ? 'Continuar inspeccion' : 'Inspeccion de calidad'}
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
        maxWidth="max-w-6xl"
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
                    {po.order_number} - {po.suppliers?.name || 'Sin proveedor'} ({po.purchase_order_items?.length || 0} líneas)
                  </option>
                ))}
              </select>
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

            <Field label="Proveedor *">
              <select
                name="supplier_id"
                value={form.supplier_id}
                onChange={handleChange}
                required
                disabled={!!form.purchase_order_id}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition disabled:cursor-not-allowed disabled:opacity-60 focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Seleccionar proveedor</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>

            {!form.purchase_order_id ? (
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
            ) : (
              <ReadOnlyField
                label="Proveedor de la OC"
                value={selectedPO?.suppliers?.name || '—'}
              />
            )}
          </section>

          {form.purchase_order_id ? (
            <>
              <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-stone-800">Recepción masiva de OC</h3>
                    <p className="text-sm text-stone-500">
                      Captura todas las materias primas de {selectedPO?.order_number || 'la orden'} en una sola operación.
                    </p>
                  </div>
                  <div className="text-sm text-stone-600">
                    {bulkSummary.totalLines} líneas · Recibido {bulkSummary.totalReceived.toFixed(2)} · Aceptado {bulkSummary.totalAccepted.toFixed(2)} · Costo Q {bulkSummary.totalCost.toFixed(2)}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                {(form.bulk_items || []).map((item, index) => {
                  const rejected = Math.max(Number(item.quantity_received || 0) - Number(item.quantity_accepted || 0), 0)
                  const lineCost = Number(item.quantity_accepted || 0) * Number(item.unit_cost || 0)

                  return (
                    <div key={item.purchase_order_item_id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                      <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h4 className="font-semibold text-stone-800">{item.material_name}</h4>
                          <p className="text-sm text-stone-500">{item.material_code || 'Sin código'} · Pedido {Number(item.quantity_ordered || 0).toFixed(2)} {item.unit}</p>
                        </div>
                        <div className="text-sm text-stone-500">Costo línea: Q {lineCost.toFixed(2)}</div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                        <Field label="Lote proveedor">
                          <input
                            value={item.supplier_lot}
                            onChange={(e) => handleBulkItemChange(index, 'supplier_lot', e.target.value)}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                          />
                        </Field>

                        <Field label="Cantidad recibida">
                          <input
                            type="number"
                            step="0.0001"
                            value={item.quantity_received}
                            onChange={(e) => handleBulkItemChange(index, 'quantity_received', e.target.value)}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                          />
                        </Field>

                        <Field label="Cantidad aceptada">
                          <input
                            type="number"
                            step="0.0001"
                            value={item.quantity_accepted}
                            onChange={(e) => handleBulkItemChange(index, 'quantity_accepted', e.target.value)}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                          />
                        </Field>

                        <ReadOnlyField label="Rechazada" value={`${rejected.toFixed(2)} ${item.unit || ''}`.trim()} />

                        <Field label="Costo unitario">
                          <input
                            type="number"
                            step="0.0001"
                            value={item.unit_cost}
                            onChange={(e) => handleBulkItemChange(index, 'unit_cost', e.target.value)}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                          />
                        </Field>

                        <ReadOnlyField label="Costo total" value={`Q ${lineCost.toFixed(2)}`} />
                      </div>

                      <div className="mt-4">
                        <Field label="Notas de calidad de la línea">
                          <textarea
                            rows={3}
                            value={item.quality_notes}
                            onChange={(e) => handleBulkItemChange(index, 'quality_notes', e.target.value)}
                            className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                          />
                        </Field>
                      </div>
                    </div>
                  )
                })}
              </section>
            </>
          ) : (
            <>
              <section className="grid gap-4 md:grid-cols-2">
                <Field label="Línea de orden de compra">
                  <select
                    name="purchase_order_item_id"
                    value={form.purchase_order_item_id}
                    onChange={handleChange}
                    disabled
                    className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition disabled:cursor-not-allowed disabled:opacity-50 focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">Seleccionar línea</option>
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
            </>
          )}

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            El lote interno no se escribe manualmente. Se generará automáticamente al guardar.
            El estado inicial del lote será <span className="font-semibold">recibido</span>.
            Luego podrás hacer la <span className="font-semibold">inspeccion de calidad</span> desde el listado para liberarlo, retenerlo o rechazarlo.
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
              {saving ? 'Guardando...' : form.purchase_order_id ? 'Guardar recepciones de OC' : 'Guardar recepción'}
            </button>
          </div>
        </form>
      </Modal>

      {qualityModal ? (
        <ReceptionQualityModal
          inspection={qualityModal}
          onClose={() => setQualityModal(null)}
          onSave={handleCompleteReceptionInspection}
        />
      ) : null}
    </div>
  )
}

function ReceptionQualityModal({ inspection, onClose, onSave }) {
  const [measurements, setMeasurements] = useState(
    (inspection.spec_rules || []).map((rule) => ({
      spec_rule_id: rule.id,
      actual_numeric: '',
      actual_boolean: null,
      actual_text: '',
      actual_count: '',
      notes: '',
    }))
  )
  const [defectos, setDefectos] = useState([])
  const [draftDefect, setDraftDefect] = useState({ tipo_defecto: '', cantidad: 1, nivel: 'menor' })
  const [form, setForm] = useState({
    resultado: inspection.resultado || '',
    unidades_inspeccionadas: inspection.unidades_inspeccionadas || inspection.tamano_muestra || 1,
    unidades_defectuosas: 0,
    observaciones: inspection.observaciones || '',
    override_reason: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [manualResult, setManualResult] = useState(Boolean(inspection.resultado))

  useEffect(() => {
    setForm((current) => ({
      ...current,
      unidades_defectuosas: defectos.reduce((sum, item) => sum + Number(item.cantidad || 0), 0),
    }))
  }, [defectos])

  const preview = useMemo(
    () => evaluateInspectionDraft(inspection.spec_rules || [], measurements, defectos),
    [inspection.spec_rules, measurements, defectos]
  )

  useEffect(() => {
    if (!manualResult) {
      setForm((current) => ({ ...current, resultado: preview.resultado_automatico }))
    }
  }, [preview.resultado_automatico, manualResult])

  function updateMeasurement(ruleId, nextValue) {
    setMeasurements((current) => current.map((item) => (item.spec_rule_id === ruleId ? nextValue : item)))
  }

  function addDefect() {
    if (!draftDefect.tipo_defecto.trim()) return
    setDefectos((current) => [...current, { ...draftDefect, cantidad: parseInt(draftDefect.cantidad || 1, 10) || 1 }])
    setDraftDefect({ tipo_defecto: '', cantidad: 1, nivel: 'menor' })
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSave(inspection.id, {
        ...form,
        measurements,
        defectos,
      })
    } catch (err) {
      setError(err.message || 'No se pudo guardar la inspeccion.')
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Inspeccion de calidad de recepcion" maxWidth="max-w-5xl">
      <div className="space-y-6">
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
          <p className="text-sm font-semibold text-stone-800">{inspection.source_label}</p>
          <p className="mt-1 text-xs text-stone-500">{inspection.spec_template?.name || 'Plantilla de recepción'}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            {(inspection.spec_rules || []).map((rule) => {
              const currentValue = measurements.find((item) => item.spec_rule_id === rule.id) || { spec_rule_id: rule.id }
              const evaluated = preview.measurements.find((item) => item.spec_rule_id === rule.id)
              return (
                <div key={rule.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-stone-800">{rule.label}</p>
                      <p className="mt-1 text-xs text-stone-400">
                        {rule.measurement_type}
                        {rule.unit ? ` · ${rule.unit}` : ''}
                        {rule.min_value != null ? ` · Min ${rule.min_value}` : ''}
                        {rule.max_value != null ? ` · Max ${rule.max_value}` : ''}
                        {rule.defect_threshold != null ? ` · Umbral ${rule.defect_threshold}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SEVERITY_COLOR[rule.severity] || SEVERITY_COLOR.menor}`}>{rule.severity}</span>
                      {evaluated ? (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${evaluated.pass ? 'bg-emerald-100 text-emerald-700' : RESULTADO_COLOR[evaluated.decision_effect]}`}>
                          {evaluated.pass ? 'Cumple' : `Falla · ${RESULTADO_LABEL[evaluated.decision_effect]}`}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ReceptionMeasurementField rule={rule} value={currentValue} onChange={(next) => updateMeasurement(rule.id, next)} />
                </div>
              )
            })}

            <div className="rounded-2xl border border-stone-200 p-4">
              <p className="mb-3 text-sm font-semibold text-stone-800">Defectos observados</p>
              <div className="space-y-2">
                {defectos.map((defecto, index) => (
                  <div key={`${defecto.tipo_defecto}-${index}`} className="flex items-center justify-between rounded-2xl bg-stone-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SEVERITY_COLOR[defecto.nivel] || SEVERITY_COLOR.menor}`}>{defecto.nivel}</span>
                      <span className="text-sm font-medium text-stone-800">{defecto.tipo_defecto}</span>
                      <span className="text-xs text-stone-400">x{defecto.cantidad}</span>
                    </div>
                    <button type="button" onClick={() => setDefectos((current) => current.filter((_, innerIndex) => innerIndex !== index))} className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-red-500">
                      x
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_90px_140px_48px]">
                <input value={draftDefect.tipo_defecto} onChange={(e) => setDraftDefect((current) => ({ ...current, tipo_defecto: e.target.value }))} placeholder="Tipo de defecto" className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-none" />
                <input type="number" min="1" value={draftDefect.cantidad} onChange={(e) => setDraftDefect((current) => ({ ...current, cantidad: e.target.value }))} className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-none" />
                <select value={draftDefect.nivel} onChange={(e) => setDraftDefect((current) => ({ ...current, nivel: e.target.value }))} className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-none">
                  <option value="menor">Menor</option>
                  <option value="mayor">Mayor</option>
                  <option value="critico">Critico</option>
                </select>
                <button type="button" onClick={addDefect} className="rounded-2xl bg-[#2f5d50] px-3 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">+</button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-stone-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Resultado automatico</p>
              <div className="mt-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${RESULTADO_COLOR[preview.resultado_automatico]}`}>
                  {RESULTADO_LABEL[preview.resultado_automatico]}
                </span>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                {preview.failing_rules} criterio(s) fuera de tolerancia
                {preview.top_severity ? ` · severidad maxima ${preview.top_severity}` : ''}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-stone-700">Resultado final</label>
              <div className="grid grid-cols-2 gap-2">
                {RESULTADOS_CALIDAD.map((result) => (
                  <button
                    key={result}
                    type="button"
                    onClick={() => {
                      setManualResult(true)
                      setForm((current) => ({ ...current, resultado: result }))
                    }}
                    className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                      form.resultado === result ? 'border-[#2f5d50] bg-[#2f5d50] text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    {RESULTADO_LABEL[result]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unidades inspeccionadas">
                <input type="number" min="1" value={form.unidades_inspeccionadas} onChange={(e) => setForm((current) => ({ ...current, unidades_inspeccionadas: e.target.value }))} className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
              </Field>
              <Field label="Unidades defectuosas">
                <input type="number" min="0" value={form.unidades_defectuosas} onChange={(e) => setForm((current) => ({ ...current, unidades_defectuosas: e.target.value }))} className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
              </Field>
            </div>

            <Field label="Observaciones">
              <textarea rows={4} value={form.observaciones} onChange={(e) => setForm((current) => ({ ...current, observaciones: e.target.value }))} className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
            </Field>

            <Field label="Justificacion de override">
              <textarea rows={3} value={form.override_reason} onChange={(e) => setForm((current) => ({ ...current, override_reason: e.target.value }))} className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100" />
            </Field>
          </div>
        </div>

        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="flex justify-end gap-3 border-t border-stone-200 pt-5">
          <button type="button" onClick={onClose} className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60">
            {saving ? 'Guardando...' : 'Guardar inspeccion'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ReceptionMeasurementField({ rule, value, onChange }) {
  if (rule.measurement_type === 'numeric') {
    return <input type="number" step="0.01" value={value.actual_numeric ?? ''} onChange={(e) => onChange({ ...value, actual_numeric: e.target.value })} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-none" />
  }

  if (rule.measurement_type === 'boolean') {
    return (
      <select value={value.actual_boolean == null ? '' : value.actual_boolean ? 'true' : 'false'} onChange={(e) => onChange({ ...value, actual_boolean: e.target.value === '' ? null : e.target.value === 'true' })} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-none">
        <option value="">Seleccionar...</option>
        <option value="true">Cumple</option>
        <option value="false">No cumple</option>
      </select>
    )
  }

  if (rule.measurement_type === 'select') {
    return <input value={value.actual_text || ''} onChange={(e) => onChange({ ...value, actual_text: e.target.value })} placeholder={`Permitidos: ${(rule.allowed_values || []).join(', ')}`} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-none" />
  }

  return <input type="number" min="0" step="1" value={value.actual_count ?? ''} onChange={(e) => onChange({ ...value, actual_count: e.target.value })} className="w-full rounded-2xl border border-stone-200 px-4 py-2.5 text-sm focus:border-emerald-700 focus:outline-none" />
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
