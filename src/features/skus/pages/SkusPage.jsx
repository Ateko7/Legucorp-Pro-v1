import { useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import Modal from '../../../components/ui/Modal'
import { createSku, getPackagingMaterials, getSkus } from '../services/skusService'

const emptyForm = {
  common_name: '',
  category: 'empacado',
  net_weight: '',
  unit: 'oz',
  shelf_life_days: '',
  suggested_price: '',
  packaging_material_id: '',
  status: 'activo',
}

export default function SkusPage() {
  const [skus, setSkus] = useState([])
  const [packagingMaterials, setPackagingMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    loadAll()
  }, [])
  useRealtimeRefresh(['skus', 'packaging_materials'], loadAll)

  async function loadAll() {
    setLoading(true)
    setError('')

    try {
      const [skusData, packagingData] = await Promise.all([
        getSkus(),
        getPackagingMaterials(),
      ])

      setSkus(skusData)
      setPackagingMaterials(packagingData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los SKUs')
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

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await createSku(form)
      setSuccess('SKU creado correctamente.')
      await loadAll()

      setTimeout(() => {
        closeModal()
      }, 700)
    } catch (err) {
      setError(err.message || 'No se pudo crear el SKU')
    } finally {
      setSaving(false)
    }
  }

  const filteredSkus = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return skus

    return skus.filter((sku) =>
      [
        sku.code,
        sku.common_name,
        sku.category,
        sku.unit,
        sku.packaging_material?.common_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [skus, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Comercial / Producción
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">SKUs</h1>
          <p className="mt-2 text-sm text-stone-500">
            Administra productos empacados y a granel, vinculando el tipo de empaque desde la base de datos.
          </p>
        </div>

        <button
          onClick={openModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nuevo SKU
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por código, nombre, categoría o empaque..."
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
            Cargando SKUs...
          </div>
        ) : filteredSkus.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay SKUs registrados todavía.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSkus.map((sku) => (
              <div
                key={sku.id}
                className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
              >
                <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <div className="text-base font-semibold text-stone-800">
                      {sku.common_name}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      Código: {sku.code}
                    </div>
                  </div>

                  <div className="text-sm text-stone-500">
                    {sku.category}
                  </div>

                  <div className="text-sm text-stone-500">
                    {Number(sku.net_weight || 0).toFixed(2)} {sku.unit}
                  </div>

                  <div className="text-sm text-stone-500">
                    Vida útil: {sku.shelf_life_days} días
                  </div>

                  <div className="text-sm text-stone-500">
                    Precio: Q {Number(sku.suggested_price || 0).toFixed(2)}
                  </div>

                  <div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        sku.status === 'activo'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {sku.status}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 border-t border-stone-200 pt-3 text-sm text-stone-500 md:grid-cols-3">
                  <div>Empaque: {sku.packaging_material?.common_name || '—'}</div>
                  <div>Unidad: {sku.unit}</div>
                  <div>Categoría: {sku.category}</div>
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

        {success ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}
      </section>

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Nuevo SKU"
        maxWidth="max-w-5xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2">
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
                <option value="empacado">Empacado</option>
                <option value="granel">Granel</option>
              </select>
            </Field>

            <Field label="Peso neto *">
              <input
                name="net_weight"
                type="number"
                step="0.0001"
                value={form.net_weight}
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

            <Field label="Vida de anaquel (días) *">
              <input
                name="shelf_life_days"
                type="number"
                value={form.shelf_life_days}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Precio sugerido (Q)">
              <input
                name="suggested_price"
                type="number"
                step="0.0001"
                value={form.suggested_price}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Tipo de empaque *">
              <select
                name="packaging_material_id"
                value={form.packaging_material_id}
                onChange={handleChange}
                required
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
          </section>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            Precio Sugerido: Se utiliza como referencia para ventas y reportes, pero no bloquea la creación de pedidos con otros precios. El precio final se define en cada pedido, permitiendo flexibilidad comercial.
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
              {saving ? 'Guardando...' : 'Guardar SKU'}
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