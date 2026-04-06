import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { createProductBase, deleteProductBase, getProductBases, updateProductBase } from '../services/productBasesService'
import {
  createProductPresentation,
  deleteProductPresentation,
  getPackagingMaterialsForPresentations,
  getSombrillasForPresentations,
  getProductPresentationsByBase,
  updateProductPresentation,
} from '../services/productPresentationsService'

const emptyBaseForm = {
  common_name: '',
  category: '',
  status: 'activo',
}

const emptyPresentationForm = {
  product_base_id: '',
  display_name: '',
  net_weight: '',
  unit: 'oz',
  shelf_life_days: '',
  suggested_price: '',
  packaging_material_id: '',
  packaging_quantity: '1',
  status: 'activo',
  producto_sombrilla_id: '',
  peso_neto_kg: '',
}

export default function ProductBasesPage() {
  const [productBases, setProductBases] = useState([])
  const [expandedBaseId, setExpandedBaseId] = useState(null)
  const [presentationsByBase, setPresentationsByBase] = useState({})
  const [packagingMaterials, setPackagingMaterials] = useState([])
  const [sombrillas, setSombrillas] = useState([])

  const [loading, setLoading] = useState(true)
  const [savingBase, setSavingBase] = useState(false)
  const [savingPresentation, setSavingPresentation] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')

  const [showBaseModal, setShowBaseModal] = useState(false)
  const [showPresentationModal, setShowPresentationModal] = useState(false)
  const [baseForm, setBaseForm] = useState(emptyBaseForm)
  const [presentationForm, setPresentationForm] = useState(emptyPresentationForm)
  const [editingBaseId, setEditingBaseId] = useState(null)
  const [editingPresentationId, setEditingPresentationId] = useState(null)
  const [deleteBaseTarget, setDeleteBaseTarget] = useState(null)
  const [deletePresentationTarget, setDeletePresentationTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { loadInitial() }, [])

  async function loadInitial() {
    setLoading(true)
    setError('')
    try {
      const [basesData, packagingData, sombrillaData] = await Promise.all([
        getProductBases(),
        getPackagingMaterialsForPresentations(),
        getSombrillasForPresentations(),
      ])
      setProductBases(basesData)
      setPackagingMaterials(packagingData)
      setSombrillas(sombrillaData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los productos base')
    } finally {
      setLoading(false)
    }
  }

  async function loadPresentations(productBaseId) {
    try {
      const data = await getProductPresentationsByBase(productBaseId)
      setPresentationsByBase((prev) => ({ ...prev, [productBaseId]: data }))
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las presentaciones')
    }
  }

  async function handleToggleExpand(productBaseId) {
    if (expandedBaseId === productBaseId) { setExpandedBaseId(null); return }
    setExpandedBaseId(productBaseId)
    if (!presentationsByBase[productBaseId]) await loadPresentations(productBaseId)
  }

  function openBaseModal() {
    setBaseForm(emptyBaseForm)
    setEditingBaseId(null)
    setError('')
    setSuccess('')
    setShowBaseModal(true)
  }

  function openEditBaseModal(base) {
    setBaseForm({ common_name: base.common_name || '', category: base.category || '', status: base.status || 'activo' })
    setEditingBaseId(base.id)
    setError('')
    setSuccess('')
    setShowBaseModal(true)
  }

  function closeBaseModal() {
    setShowBaseModal(false)
    setEditingBaseId(null)
    setSavingBase(false)
  }

  function openPresentationModal(productBase) {
    setPresentationForm({ ...emptyPresentationForm, product_base_id: productBase.id, display_name: productBase.common_name })
    setEditingPresentationId(null)
    setError('')
    setSuccess('')
    setShowPresentationModal(true)
  }

  function openEditPresentationModal(presentation) {
    setPresentationForm({
      product_base_id: presentation.product_base_id,
      display_name: presentation.display_name || '',
      net_weight: String(presentation.net_weight ?? ''),
      unit: presentation.unit || 'oz',
      shelf_life_days: String(presentation.shelf_life_days ?? ''),
      suggested_price: String(presentation.suggested_price ?? ''),
      packaging_material_id:  presentation.packaging_material_id || '',
      packaging_quantity:     String(presentation.packaging_quantity ?? '1'),
      status:                 presentation.status || 'activo',
      producto_sombrilla_id:  presentation.producto_sombrilla_id || '',
      peso_neto_kg:           presentation.peso_neto_kg != null ? String(presentation.peso_neto_kg) : '',
    })
    setEditingPresentationId(presentation.id)
    setError('')
    setSuccess('')
    setShowPresentationModal(true)
  }

  function closePresentationModal() {
    setShowPresentationModal(false)
    setEditingPresentationId(null)
    setSavingPresentation(false)
  }

  function handleBaseChange(e) {
    const { name, value } = e.target
    setBaseForm((prev) => ({ ...prev, [name]: value }))
  }

  function handlePresentationChange(e) {
    const { name, value } = e.target
    setPresentationForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleDeleteBase() {
    if (!deleteBaseTarget) return
    setDeleting(true)
    try {
      await deleteProductBase(deleteBaseTarget.id)
      setDeleteBaseTarget(null)
      await loadInitial()
    } catch (err) {
      setError(err.message || 'No se pudo desactivar el producto base')
      setDeleteBaseTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeletePresentation() {
    if (!deletePresentationTarget) return
    setDeleting(true)
    try {
      await deleteProductPresentation(deletePresentationTarget.id)
      setDeletePresentationTarget(null)
      await loadPresentations(deletePresentationTarget.product_base_id)
    } catch (err) {
      setError(err.message || 'No se pudo desactivar la presentación')
      setDeletePresentationTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleBaseSubmit(e) {
    e.preventDefault()
    setSavingBase(true)
    setError('')
    setSuccess('')
    try {
      if (editingBaseId) {
        await updateProductBase(editingBaseId, baseForm)
        setSuccess('Producto base actualizado correctamente.')
      } else {
        await createProductBase(baseForm)
        setSuccess('Producto base creado correctamente.')
      }
      await loadInitial()
      setTimeout(closeBaseModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el producto base')
    } finally {
      setSavingBase(false)
    }
  }

  async function handlePresentationSubmit(e) {
    e.preventDefault()
    setSavingPresentation(true)
    setError('')
    setSuccess('')
    try {
      if (editingPresentationId) {
        await updateProductPresentation(editingPresentationId, presentationForm)
        setSuccess('Presentación actualizada correctamente.')
        await loadPresentations(presentationForm.product_base_id)
      } else {
        const created = await createProductPresentation(presentationForm)
        setSuccess('Presentación creada correctamente.')
        await loadPresentations(created.product_base_id)
      }
      await loadInitial()
      setTimeout(closePresentationModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la presentación')
    } finally {
      setSavingPresentation(false)
    }
  }

  const filteredProductBases = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return productBases

    return productBases.filter((item) =>
      [item.code, item.common_name, item.category, item.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [productBases, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Productos
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Productos base</h1>
          <p className="mt-2 text-sm text-stone-500">
            Crea el producto madre y administra sus presentaciones desde el mismo módulo.
          </p>
        </div>

        <button
          onClick={openBaseModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nuevo producto base
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por código, nombre o categoría..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 md:max-w-md"
          />

          <button
            onClick={loadInitial}
            className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
          >
            Recargar
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">
            Cargando productos base...
          </div>
        ) : filteredProductBases.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay productos base registrados todavía.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredProductBases.map((item) => {
              const presentations = presentationsByBase[item.id] || []
              const isExpanded = expandedBaseId === item.id

              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
                >
                  <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr_auto_auto] md:items-center">
                    <div>
                      <div className="text-base font-semibold text-stone-800">
                        {item.common_name}
                      </div>
                      <div className="mt-1 text-sm text-stone-500">
                        Código: {item.code}
                      </div>
                    </div>

                    <div className="text-sm text-stone-500">
                      Categoría: {item.category || '—'}
                    </div>

                    <div className="text-sm text-stone-500">
                      Creado: {new Date(item.created_at).toLocaleDateString()}
                    </div>

                    <div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          item.status === 'activo'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-stone-200 text-stone-700'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleToggleExpand(item.id)}
                        className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                      >
                        {isExpanded ? 'Ocultar presentaciones' : 'Ver presentaciones'}
                      </button>

                      <button
                        onClick={() => openEditBaseModal(item)}
                        className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                      >
                        Editar
                      </button>

                      <button
                        onClick={() => setDeleteBaseTarget(item)}
                        className="rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        Desactivar
                      </button>

                      <button
                        onClick={() => openPresentationModal(item)}
                        className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#264c42]"
                      >
                        + Presentación
                      </button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="mt-4 border-t border-stone-200 pt-4">
                      {presentations.length === 0 ? (
                        <div className="rounded-xl bg-white px-4 py-3 text-sm text-stone-500">
                          Este producto base todavía no tiene presentaciones.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {presentations.map((presentation) => (
                            <div
                              key={presentation.id}
                              className="grid gap-3 rounded-xl bg-white px-4 py-3 text-sm text-stone-600 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto]"
                            >
                              <div>
                                <div className="font-semibold text-stone-800">
                                  {presentation.display_name}
                                </div>
                                <div className="text-xs text-stone-500">
                                  {presentation.code}
                                </div>
                              </div>

                              <div>
                                {Number(presentation.net_weight || 0).toFixed(2)} {presentation.unit}
                              </div>

                              <div>
                                Vida útil: {presentation.shelf_life_days} días
                              </div>

                              <div>
                                Precio: Q {Number(presentation.suggested_price || 0).toFixed(2)}
                              </div>

                              <div>
                                Empaque: {presentation.packaging_material?.common_name || '—'}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={() => openEditPresentationModal(presentation)}
                                  className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-white"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => setDeletePresentationTarget(presentation)}
                                  className="rounded-xl border border-red-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                                >
                                  Desactivar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
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

      {deleteBaseTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Desactivar producto base?</h3>
            <p className="mt-2 text-sm text-stone-600">
              <strong>{deleteBaseTarget.common_name}</strong> pasará a estado inactivo.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteBaseTarget(null)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">Cancelar</button>
              <button onClick={handleDeleteBase} disabled={deleting} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">{deleting ? 'Desactivando...' : 'Desactivar'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {deletePresentationTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Desactivar presentación?</h3>
            <p className="mt-2 text-sm text-stone-600">
              <strong>{deletePresentationTarget.display_name}</strong> pasará a estado inactivo.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeletePresentationTarget(null)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">Cancelar</button>
              <button onClick={handleDeletePresentation} disabled={deleting} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">{deleting ? 'Desactivando...' : 'Desactivar'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={showBaseModal}
        onClose={closeBaseModal}
        title={editingBaseId ? 'Editar producto base' : 'Nuevo producto base'}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleBaseSubmit} className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre del producto base *">
              <input
                name="common_name"
                value={baseForm.common_name}
                onChange={handleBaseChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Categoría">
              <input
                name="category"
                value={baseForm.category}
                onChange={handleBaseChange}
                placeholder="Ej. ensalada, mix, hoja individual"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Estado">
              <select
                name="status"
                value={baseForm.status}
                onChange={handleBaseChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </Field>
          </section>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            El código del producto base se generará automáticamente.
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 md:flex-row md:justify-end">
            <button
              type="button"
              onClick={closeBaseModal}
              className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={savingBase}
              className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {savingBase ? 'Guardando...' : editingBaseId ? 'Actualizar producto base' : 'Guardar producto base'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showPresentationModal}
        onClose={closePresentationModal}
        title={editingPresentationId ? 'Editar presentación' : 'Nueva presentación'}
        maxWidth="max-w-5xl"
      >
        <form onSubmit={handlePresentationSubmit} className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre de la presentación *">
              <input
                name="display_name"
                value={presentationForm.display_name}
                onChange={handlePresentationChange}
                required
                placeholder="Ej. Bistro Salad Mix 6 oz"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Peso neto *">
              <input
                name="net_weight"
                type="number"
                step="0.0001"
                value={presentationForm.net_weight}
                onChange={handlePresentationChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Unidad *">
              <input
                name="unit"
                value={presentationForm.unit}
                onChange={handlePresentationChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Vida de anaquel (días) *">
              <input
                name="shelf_life_days"
                type="number"
                value={presentationForm.shelf_life_days}
                onChange={handlePresentationChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Precio sugerido (Q)">
              <input
                name="suggested_price"
                type="number"
                step="0.0001"
                value={presentationForm.suggested_price}
                onChange={handlePresentationChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Material de empaque">
              <select
                name="packaging_material_id"
                value={presentationForm.packaging_material_id}
                onChange={handlePresentationChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Seleccionar empaque</option>
                {packagingMaterials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.common_name} {material.code ? `(${material.code})` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Cantidad de empaque">
              <input
                name="packaging_quantity"
                type="number"
                step="0.0001"
                value={presentationForm.packaging_quantity}
                onChange={handlePresentationChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Estado">
              <select
                name="status"
                value={presentationForm.status}
                onChange={handlePresentationChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </Field>

            {sombrillas.length > 0 && (
              <>
                <Field label="Producto sombrilla (exportación)">
                  <select
                    name="producto_sombrilla_id"
                    value={presentationForm.producto_sombrilla_id}
                    onChange={handlePresentationChange}
                    className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">Sin sombrilla</option>
                    {sombrillas.map(s => (
                      <option key={s.id} value={s.id}>{s.nombre}{s.codigo ? ` (${s.codigo})` : ''}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Peso neto kg (override exportación)">
                  <input
                    name="peso_neto_kg"
                    type="number"
                    step="0.0001"
                    value={presentationForm.peso_neto_kg}
                    onChange={handlePresentationChange}
                    placeholder="Calculado de peso neto + unidad si vacío"
                    className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                  />
                </Field>
              </>
            )}
          </section>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            El código de la presentación se generará automáticamente.
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 md:flex-row md:justify-end">
            <button
              type="button"
              onClick={closePresentationModal}
              className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={savingPresentation}
              className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {savingPresentation ? 'Guardando...' : editingPresentationId ? 'Actualizar presentación' : 'Guardar presentación'}
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