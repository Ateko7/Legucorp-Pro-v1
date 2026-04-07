import { useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import Modal from '../../../components/ui/Modal'
import {
  deleteProductBaseRecipe,
  getAllProductBaseRecipes,
  getMaterialsForProductBaseRecipes,
  getProductBasesForRecipes,
  saveProductBaseRecipe,
} from '../services/productBaseRecipesService'

const emptyItem = {
  material_id: '',
  percentage: '',
}

export default function ProductBaseRecipesPage() {
  const [productBases, setProductBases] = useState([])
  const [materials, setMaterials] = useState([])
  const [recipes, setRecipes] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [selectedProductBaseId, setSelectedProductBaseId] = useState('')
  const [items, setItems] = useState([{ ...emptyItem }])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadAll()
  }, [])
  useRealtimeRefresh(['product_bases', 'product_base_recipes', 'materials'], loadAll)

  async function loadAll() {
    setLoading(true)
    setError('')

    try {
      const [productBasesData, materialsData, recipesData] = await Promise.all([
        getProductBasesForRecipes(),
        getMaterialsForProductBaseRecipes(),
        getAllProductBaseRecipes(),
      ])

      setProductBases(productBasesData)
      setMaterials(materialsData)
      setRecipes(recipesData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las recetas')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setSelectedProductBaseId('')
    setItems([{ ...emptyItem }])
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setSaving(false)
  }

  function handleItemChange(index, field, value) {
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        [field]: value,
      }
      return next
    })
  }

  function addItem() {
    setItems((prev) => [...prev, { ...emptyItem }])
  }

  function removeItem(index) {
    setItems((prev) => {
      const filtered = prev.filter((_, i) => i !== index)
      return filtered.length > 0 ? filtered : [{ ...emptyItem }]
    })
  }

  function openEditModal(recipeGroup) {
    setSelectedProductBaseId(recipeGroup.productBaseId)
    setItems(
      recipeGroup.items.map((item) => ({
        material_id: item.materialId,
        percentage: String(item.percentage),
      }))
    )
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteProductBaseRecipe(deleteTarget.productBaseId)
      setDeleteTarget(null)
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo eliminar la receta')
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
      await saveProductBaseRecipe({
        productBaseId: selectedProductBaseId,
        items,
      })

      setSuccess('Receta guardada correctamente.')
      await loadAll()

      setTimeout(() => {
        closeModal()
      }, 700)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la receta')
    } finally {
      setSaving(false)
    }
  }

  const totalPercentage = useMemo(() => {
    return items.reduce((acc, item) => acc + Number(item.percentage || 0), 0)
  }, [items])

  const groupedRecipes = useMemo(() => {
    const map = new Map()

    for (const row of recipes) {
      const productBaseId = row.product_bases?.id
      if (!productBaseId) continue

      if (!map.has(productBaseId)) {
        map.set(productBaseId, {
          productBaseId,
          productBaseCode: row.product_bases.code,
          productBaseName: row.product_bases.common_name,
          items: [],
        })
      }

      map.get(productBaseId).items.push({
        id: row.id,
        materialId: row.materials?.id,
        materialCode: row.materials?.code,
        materialName: row.materials?.common_name,
        percentage: Number(row.percentage || 0),
      })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.productBaseName.localeCompare(b.productBaseName)
    )
  }, [recipes])

  const filteredRecipes = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return groupedRecipes

    return groupedRecipes.filter((recipe) =>
      [
        recipe.productBaseCode,
        recipe.productBaseName,
        ...recipe.items.map((item) => item.materialCode),
        ...recipe.items.map((item) => item.materialName),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [groupedRecipes, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Producción
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">
            Recetas de producto base
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Define la composición de cada producto base. Las presentaciones comparten esta receta.
          </p>
        </div>

        <button
          onClick={openModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nueva receta
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por producto base o materia prima..."
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
            Cargando recetas...
          </div>
        ) : filteredRecipes.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay recetas registradas todavía.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRecipes.map((recipe) => {
              const total = recipe.items.reduce((acc, item) => acc + item.percentage, 0)

              return (
                <div
                  key={recipe.productBaseId}
                  className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-base font-semibold text-stone-800">
                        {recipe.productBaseName}
                      </div>
                      <div className="mt-1 text-sm text-stone-500">
                        Código: {recipe.productBaseCode}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                        Total: {total.toFixed(2)}%
                      </div>

                      <button
                        onClick={() => openEditModal(recipe)}
                        className="rounded-2xl border border-[#2f5d50] px-4 py-2 text-sm font-semibold text-[#2f5d50] transition hover:bg-emerald-50"
                      >
                        Editar receta
                      </button>

                      <button
                        onClick={() => setDeleteTarget(recipe)}
                        className="rounded-2xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-stone-200 pt-4">
                    {recipe.items.map((item) => (
                      <div
                        key={item.id}
                        className="grid gap-3 rounded-xl bg-white px-4 py-3 text-sm text-stone-600 md:grid-cols-[1fr_1fr_auto]"
                      >
                        <div>{item.materialName}</div>
                        <div>{item.materialCode}</div>
                        <div className="font-semibold text-stone-800">
                          {item.percentage.toFixed(4)}%
                        </div>
                      </div>
                    ))}
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

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Eliminar receta?</h3>
            <p className="mt-2 text-sm text-stone-600">
              Se desactivará la receta de <strong>{deleteTarget.productBaseName}</strong>. Esta acción es reversible creando una nueva receta.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">Cancelar</button>
              <button onClick={handleDelete} disabled={deleting} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">{deleting ? 'Eliminando...' : 'Eliminar'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Receta de producto base"
        maxWidth="max-w-6xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <Field label="Producto base *">
            <select
              value={selectedProductBaseId}
              onChange={(e) => setSelectedProductBaseId(e.target.value)}
              required
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">Seleccionar producto base</option>
              {productBases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.common_name} ({item.code})
                </option>
              ))}
            </select>
          </Field>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-stone-800">
                Materias primas
              </h3>

              <button
                type="button"
                onClick={addItem}
                className="rounded-2xl border border-[#2f5d50] px-4 py-2 text-sm font-semibold text-[#2f5d50] transition hover:bg-emerald-50"
              >
                + Agregar materia prima
              </button>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1.6fr_1fr_auto]"
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
                    placeholder="%"
                    value={item.percentage}
                    onChange={(e) => handleItemChange(index, 'percentage', e.target.value)}
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

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            Total actual: <span className="font-semibold">{totalPercentage.toFixed(4)}%</span>. La suma debe ser <span className="font-semibold">100%</span>. Puedes editar porcentajes, agregar materias primas o quitarlas.
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
              {saving ? 'Guardando...' : 'Guardar receta'}
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