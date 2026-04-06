import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  getAllRecipes,
  getMaterialsForRecipes,
  getSkusForRecipes,
  saveSkuRecipe,
} from '../services/recipesService'

const emptyItem = {
  material_id: '',
  percentage: '',
}

export default function RecetasPage() {
  const [skus, setSkus] = useState([])
  const [materials, setMaterials] = useState([])
  const [recipes, setRecipes] = useState([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [selectedSkuId, setSelectedSkuId] = useState('')
  const [items, setItems] = useState([{ ...emptyItem }])

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')

    try {
      const [skusData, materialsData, recipesData] = await Promise.all([
        getSkusForRecipes(),
        getMaterialsForRecipes(),
        getAllRecipes(),
      ])

      setSkus(skusData)
      setMaterials(materialsData)
      setRecipes(recipesData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las recetas')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setSelectedSkuId('')
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
      return filtered.length ? filtered : [{ ...emptyItem }]
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await saveSkuRecipe({
        skuId: selectedSkuId,
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

  const groupedRecipes = useMemo(() => {
    const map = new Map()

    for (const row of recipes) {
      const skuId = row.skus?.id
      if (!skuId) continue

      if (!map.has(skuId)) {
        map.set(skuId, {
          skuId,
          skuCode: row.skus.code,
          skuName: row.skus.common_name,
          items: [],
        })
      }

      map.get(skuId).items.push({
        id: row.id,
        materialCode: row.materials?.code,
        materialName: row.materials?.common_name,
        percentage: Number(row.percentage || 0),
      })
    }

    return Array.from(map.values())
  }, [recipes])

  const filteredRecipes = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return groupedRecipes

    return groupedRecipes.filter((recipe) =>
      [
        recipe.skuCode,
        recipe.skuName,
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
          <h1 className="text-3xl font-semibold text-stone-800">Recetas</h1>
          <p className="mt-2 text-sm text-stone-500">
            Define la composición de cada SKU usando porcentajes editables de materias primas.
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
            placeholder="Buscar por SKU o materia prima..."
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
                  key={recipe.skuId}
                  className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-base font-semibold text-stone-800">
                        {recipe.skuName}
                      </div>
                      <div className="mt-1 text-sm text-stone-500">
                        Código: {recipe.skuCode}
                      </div>
                    </div>

                    <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                      Total: {total.toFixed(2)}%
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

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Nueva receta"
        maxWidth="max-w-6xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <Field label="SKU *">
            <select
              value={selectedSkuId}
              onChange={(e) => setSelectedSkuId(e.target.value)}
              required
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            >
              <option value="">Seleccionar SKU</option>
              {skus.map((sku) => (
                <option key={sku.id} value={sku.id}>
                  {sku.common_name} ({sku.code})
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
            La suma total de la receta debe ser <span className="font-semibold">100%</span>.
            Los porcentajes son completamente editables e intercambiables.
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