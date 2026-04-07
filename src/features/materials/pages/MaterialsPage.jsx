import { useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import Modal from '../../../components/ui/Modal'
import {
  createMaterial,
  deleteMaterial,
  getMaterials,
  getSuppliersForSelect,
  updateMaterial,
} from '../services/materialsService'

const CATEGORY_OPTIONS = [
  { value: 'materia_prima_vegetal', label: 'Materia prima vegetal' },
  { value: 'material_empaque', label: 'Material de empaque' },
  { value: 'insumo_proceso', label: 'Insumo de proceso' },
  { value: 'producto_granel', label: 'Producto a granel' },
  { value: 'quimico_sanitizante', label: 'Químico / sanitizante' },
  { value: 'otros', label: 'Otros' },
]

const emptyForm = {
  common_name: '',
  category: 'materia_prima_vegetal',
  base_unit: 'lb',
  purchase_presentation: '',
  preferred_supplier_id: '',
  estimated_cost: '',
  shelf_life_days: '',
  requires_lot: true,
  requires_temperature: false,
  minimum_stock: '',
  status: 'activo',
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])
  useRealtimeRefresh(['materials', 'suppliers'], loadAll)

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [materialsData, suppliersData] = await Promise.all([getMaterials(), getSuppliersForSelect()])
      setMaterials(materialsData)
      setSuppliers(suppliersData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las materias primas')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  function openEditModal(material) {
    setForm({
      common_name: material.common_name || '',
      category: material.category || 'materia_prima_vegetal',
      base_unit: material.base_unit || 'lb',
      purchase_presentation: material.purchase_presentation || '',
      preferred_supplier_id: material.preferred_supplier_id || '',
      estimated_cost: String(material.estimated_cost ?? ''),
      shelf_life_days: String(material.shelf_life_days ?? ''),
      requires_lot: Boolean(material.requires_lot),
      requires_temperature: Boolean(material.requires_temperature),
      minimum_stock: String(material.minimum_stock ?? ''),
      status: material.status || 'activo',
    })
    setEditingId(material.id)
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setSaving(false)
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteMaterial(deleteTarget.id)
      setDeleteTarget(null)
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo eliminar la materia prima')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (editingId) {
        await updateMaterial(editingId, form)
        setSuccess('Materia prima actualizada correctamente.')
      } else {
        await createMaterial(form)
        setSuccess('Materia prima creada correctamente.')
      }
      await loadAll()
      setTimeout(closeModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la materia prima')
    } finally {
      setSaving(false)
    }
  }

  const filteredMaterials = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return materials

    return materials.filter((material) =>
      [
        material.code,
        material.common_name,
        material.category,
        material.base_unit,
        material.purchase_presentation,
        material.preferred_supplier?.name,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term))
    )
  }, [materials, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Abastecimiento
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Materias primas</h1>
          <p className="mt-2 text-sm text-stone-500">
            Administra el catálogo base de materias primas, empaque e insumos de proceso.
          </p>
        </div>

        <button
          onClick={openModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nueva materia prima
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por código, nombre, categoría o proveedor..."
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
            Cargando materias primas...
          </div>
        ) : filteredMaterials.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay materias primas registradas todavía.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMaterials.map((material) => (
              <div
                key={material.id}
                className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
              >
                <div className="grid gap-3 md:grid-cols-[1.1fr_1.2fr_1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <div className="text-base font-semibold text-stone-800">
                      {material.common_name}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      Código: {material.code}
                    </div>
                  </div>

                  <div className="text-sm text-stone-500">
                    {formatCategory(material.category)}
                  </div>

                  <div className="text-sm text-stone-500">
                    Unidad: {material.base_unit}
                  </div>

                  <div className="text-sm text-stone-500">
                    Costo est.: Q {Number(material.estimated_cost || 0).toFixed(2)}
                  </div>

                  <div className="text-sm text-stone-500">
                    Prov.: {material.preferred_supplier?.name || '—'}
                  </div>

                  <div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        material.status === 'activo'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {material.status}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(material)}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setDeleteTarget(material)}
                      className="rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      Desactivar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </section>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Desactivar materia prima?</h3>
            <p className="mt-2 text-sm text-stone-600">
              <strong>{deleteTarget.common_name}</strong> pasará a estado inactivo.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Desactivando...' : 'Desactivar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Editar materia prima' : 'Nueva materia prima'}
        maxWidth="max-w-5xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre común *">
              <input
                name="common_name"
                value={form.common_name}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Categoría *">
              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Unidad base *">
              <input
                name="base_unit"
                value={form.base_unit}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Presentación de compra">
              <input
                name="purchase_presentation"
                value={form.purchase_presentation}
                onChange={handleChange}
                placeholder="Ej. saco 25 lb, rollo, caja, etc."
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Proveedor preferido">
              <select
                name="preferred_supplier_id"
                value={form.preferred_supplier_id}
                onChange={handleChange}
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

            <Field label="Costo estimado (Q)">
              <input
                name="estimated_cost"
                type="number"
                step="0.0001"
                value={form.estimated_cost}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Vida útil (días)">
              <input
                name="shelf_life_days"
                type="number"
                value={form.shelf_life_days}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Stock mínimo">
              <input
                name="minimum_stock"
                type="number"
                step="0.0001"
                value={form.minimum_stock}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Estado">
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ToggleField
              label="¿Requiere lote?"
              name="requires_lot"
              checked={form.requires_lot}
              onChange={handleChange}
            />

            <ToggleField
              label="¿Requiere temperatura?"
              name="requires_temperature"
              checked={form.requires_temperature}
              onChange={handleChange}
            />
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
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar materia prima'}
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

function ToggleField({ label, name, checked, onChange }) {
  return (
    <label className="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 accent-[#2f5d50]"
      />
    </label>
  )
}

function formatCategory(category) {
  const found = CATEGORY_OPTIONS.find((item) => item.value === category)
  return found ? found.label : category
}