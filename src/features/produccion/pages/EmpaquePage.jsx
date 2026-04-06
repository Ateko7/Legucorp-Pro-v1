import { useEffect, useMemo, useState } from 'react'
import {
  calculateRecipeRequirements,
  createPackagingRunStrictRecipe,
  getPackagingFormData,
} from '../services/packagingService'

const todayString = new Date().toISOString().slice(0, 10)

function numberOrZero(value) {
  const n = Number(value)
  return Number.isNaN(n) ? 0 : n
}

function formatNumber(value) {
  return numberOrZero(value).toLocaleString('es-GT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function buildDefaultFinishedLotCode(presentation, runDate) {
  if (!presentation) return ''
  const datePart = (runDate || todayString).replaceAll('-', '')
  return `${presentation.code || 'PT'}-${datePart}`
}

function StatusPill({ covered }) {
  return (
    <div
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        covered
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {covered ? 'Cubierto' : 'Pendiente'}
    </div>
  )
}

function KpiCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-stone-800">{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-400">{hint}</div> : null}
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

function InfoMini({ label, value }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-stone-800">{value}</div>
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="py-12 text-center text-sm text-stone-500">
      {text}
    </div>
  )
}

function MaterialSelectionCard({
  requirement,
  lots,
  selectedIds,
  onToggle,
  selectedAvailable,
}) {
  if (!lots.length) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
        <div className="text-sm text-stone-500">
          No hay inventario procesado disponible para {requirement.material_name}.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-base font-semibold text-stone-800">
            {requirement.material_name}
          </div>
          <div className="mt-1 text-sm text-stone-500">
            {formatNumber(requirement.percentage)}% · requerido {formatNumber(requirement.required_lb)} lb
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-full bg-stone-200 px-3 py-1 text-xs font-semibold text-stone-700">
            Seleccionado: {formatNumber(selectedAvailable)} lb
          </div>
          <StatusPill covered={numberOrZero(selectedAvailable) >= numberOrZero(requirement.required_lb)} />
        </div>
      </div>

      <div className="space-y-2 border-t border-stone-200 pt-4">
        {lots.map((lot) => {
          const checked = selectedIds.includes(lot.id)

          return (
            <label
              key={lot.id}
              className={`grid cursor-pointer gap-3 rounded-xl border px-4 py-3 text-sm transition md:grid-cols-[auto_1.1fr_0.8fr_0.8fr_1fr] ${
                checked
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-stone-200 bg-white hover:bg-stone-50'
              }`}
            >
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(requirement.material_id, lot.id)}
                  className="h-4 w-4 rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
                />
              </div>

              <div>
                <div className="font-semibold text-stone-800">{lot.internal_lot}</div>
                <div className="mt-1 text-xs text-stone-500">Lote procesado</div>
              </div>

              <div>
                <div className="text-stone-800">{lot.processed_type || 'unico'}</div>
                <div className="mt-1 text-xs text-stone-500">Tipo</div>
              </div>

              <div>
                <div className="font-semibold text-stone-800">
                  {formatNumber(lot.available_quantity)} {lot.unit}
                </div>
                <div className="mt-1 text-xs text-stone-500">Disponible</div>
              </div>

              <div>
                <div className="text-stone-800">{lot.location || '—'}</div>
                <div className="mt-1 text-xs text-stone-500">Ubicación</div>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export default function EmpaquePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [presentations, setPresentations] = useState([])
  const [processedLots, setProcessedLots] = useState([])
  const [recipes, setRecipes] = useState([])

  const [productPresentationId, setProductPresentationId] = useState('')
  const [runDate, setRunDate] = useState(todayString)
  const [quantityPacked, setQuantityPacked] = useState('')
  const [finishedLotCode, setFinishedLotCode] = useState('')
  const [notes, setNotes] = useState('')

  const [selectedProcessedLotIdsByMaterial, setSelectedProcessedLotIdsByMaterial] = useState({})

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')

    try {
      const data = await getPackagingFormData()
      setPresentations(data.presentations || [])
      setProcessedLots(data.processedLots || [])
      setRecipes(data.recipes || [])
    } catch (err) {
      setError(err.message || 'No se pudo cargar el módulo de empaque')
    } finally {
      setLoading(false)
    }
  }

  const selectedPresentation = useMemo(() => {
    return presentations.find((p) => p.id === productPresentationId) || null
  }, [presentations, productPresentationId])

  const recipeItems = useMemo(() => {
    if (!selectedPresentation) return []
    return recipes.filter(
      (r) => r.product_base_id === selectedPresentation.product_base_id
    )
  }, [recipes, selectedPresentation])

  const requirements = useMemo(() => {
    return calculateRecipeRequirements(
      selectedPresentation,
      numberOrZero(quantityPacked),
      recipeItems
    )
  }, [selectedPresentation, quantityPacked, recipeItems])

  useEffect(() => {
    if (selectedPresentation) {
      setFinishedLotCode(buildDefaultFinishedLotCode(selectedPresentation, runDate))
      setSelectedProcessedLotIdsByMaterial({})
    }
  }, [selectedPresentation, runDate])

  function toggleProcessedLot(materialId, lotId) {
    setSelectedProcessedLotIdsByMaterial((prev) => {
      const current = prev[materialId] || []
      const updated = current.includes(lotId)
        ? current.filter((id) => id !== lotId)
        : [...current, lotId]

      return {
        ...prev,
        [materialId]: updated,
      }
    })
  }

  function getAvailableForMaterial(materialId) {
    return processedLots.filter((lot) => lot.material_id === materialId)
  }

  function getSelectedAvailableForMaterial(materialId) {
    const selectedIds = selectedProcessedLotIdsByMaterial[materialId] || []
    return getAvailableForMaterial(materialId)
      .filter((lot) => selectedIds.includes(lot.id))
      .reduce((acc, lot) => acc + numberOrZero(lot.available_quantity), 0)
  }

  const recipeCovered = useMemo(() => {
    return (requirements.perMaterial || []).every(
      (req) =>
        numberOrZero(getSelectedAvailableForMaterial(req.material_id)) >=
        numberOrZero(req.required_lb)
    )
  }, [requirements.perMaterial, selectedProcessedLotIdsByMaterial, processedLots])

  const estimatedProcessedCost = useMemo(() => {
    let total = 0

    for (const req of requirements.perMaterial || []) {
      const selectedIds = selectedProcessedLotIdsByMaterial[req.material_id] || []
      const selectedLots = getAvailableForMaterial(req.material_id).filter((lot) =>
        selectedIds.includes(lot.id)
      )

      let remaining = numberOrZero(req.required_lb)

      for (const lot of selectedLots) {
        if (remaining <= 0) break

        const available = numberOrZero(lot.available_quantity)
        const used = Math.min(available, remaining)
        const unitCost =
          numberOrZero(lot.original_quantity) > 0
            ? numberOrZero(lot.accumulated_cost) / numberOrZero(lot.original_quantity)
            : 0

        total += used * unitCost
        remaining -= used
      }
    }

    return total
  }, [requirements.perMaterial, selectedProcessedLotIdsByMaterial, processedLots])

  const estimatedUnitCost =
    numberOrZero(quantityPacked) > 0
      ? estimatedProcessedCost / numberOrZero(quantityPacked)
      : 0

  const productionDate = runDate

  const expirationDate = useMemo(() => {
    if (!selectedPresentation?.shelf_life_days || !runDate) return runDate || '—'
    const result = new Date(
      new Date(runDate).getTime() +
        selectedPresentation.shelf_life_days * 24 * 60 * 60 * 1000
    )
    return result.toISOString().slice(0, 10)
  }, [runDate, selectedPresentation])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await createPackagingRunStrictRecipe({
        productPresentationId,
        runDate,
        quantityPacked: numberOrZero(quantityPacked),
        finishedLotCode,
        notes,
        selectedProcessedLotIdsByMaterial,
      })

      setSuccess('Empaque registrado correctamente y enviado a inventario de cuarto frío.')
      setProductPresentationId('')
      setQuantityPacked('')
      setFinishedLotCode('')
      setNotes('')
      setSelectedProcessedLotIdsByMaterial({})
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo registrar el empaque')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Producción
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Empaque</h1>
          <p className="mt-2 text-sm text-stone-500">
            Empaca producto por stock consumiendo materia prima procesada según receta exacta
            del producto base y enviándolo a cuarto frío.
          </p>
        </div>

        <button
          type="submit"
          form="empaque-form"
          disabled={saving || !recipeCovered}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
        >
          {saving ? 'Registrando...' : 'Terminar empaque'}
        </button>
      </section>

      <form id="empaque-form" onSubmit={handleSubmit} className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Peso unitario"
            value={`${formatNumber(requirements.weightPerUnitLb)} lb`}
            hint="Conversión automática"
          />
          <KpiCard
            label="Peso total empacado"
            value={`${formatNumber(requirements.packedWeightLb)} lb`}
            hint="Cantidad × peso neto"
          />
          <KpiCard
            label="Materiales receta"
            value={requirements.perMaterial.length}
            hint="MP requeridas"
          />
          <KpiCard
            label="Costo estimado"
            value={formatNumber(estimatedProcessedCost)}
            hint="Consumo exacto"
          />
          <KpiCard
            label="Costo unitario"
            value={formatNumber(estimatedUnitCost)}
            hint="Estimado"
          />
        </section>

        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-stone-800">Datos del empaque</h2>
            <p className="mt-1 text-sm text-stone-500">
              Selecciona producto, fecha, cantidad empacada y lote terminado.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Producto *">
              <select
                value={productPresentationId}
                onChange={(e) => setProductPresentationId(e.target.value)}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">Selecciona un producto</option>
                {presentations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} ({formatNumber(p.net_weight)} {p.unit})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Fecha de producción *">
              <input
                type="date"
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Cantidad empacada *">
              <input
                type="number"
                step="0.01"
                value={quantityPacked}
                onChange={(e) => setQuantityPacked(e.target.value)}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Lote de producto terminado *">
              <input
                type="text"
                value={finishedLotCode}
                onChange={(e) => setFinishedLotCode(e.target.value)}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>
          </div>

          {selectedPresentation ? (
            <div className="mt-5 grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-2 xl:grid-cols-3">
              <InfoMini label="Producto base" value={selectedPresentation.product_base_name || '—'} />
              <InfoMini label="Peso neto" value={`${formatNumber(selectedPresentation.net_weight)} ${selectedPresentation.unit}`} />
              <InfoMini label="Peso convertido" value={`${formatNumber(requirements.weightPerUnitLb)} lb`} />
              <InfoMini label="Fecha producción" value={productionDate || '—'} />
              <InfoMini label="Fecha vencimiento" value={expirationDate || '—'} />
              <InfoMini label="Destino inventario" value="cuarto_frio" />
            </div>
          ) : null}

          <div className="mt-4">
            <Field label="Notas">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>
          </div>
        </section>

        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-stone-800">Receta calculada</h2>
              <p className="mt-1 text-sm text-stone-500">
                El sistema calcula automáticamente la cantidad exacta de materia prima requerida.
              </p>
            </div>
            <StatusPill covered={recipeCovered} />
          </div>

          {selectedPresentation ? (
            requirements.perMaterial.length ? (
              <div className="space-y-3">
                {requirements.perMaterial.map((req) => (
                  <div
                    key={req.material_id}
                    className="grid gap-3 rounded-xl bg-stone-50/70 px-4 py-3 text-sm text-stone-600 md:grid-cols-[1.4fr_0.6fr_0.9fr_0.9fr_auto]"
                  >
                    <div className="font-semibold text-stone-800">{req.material_name}</div>
                    <div>{formatNumber(req.percentage)}%</div>
                    <div>{formatNumber(req.required_lb)} lb</div>
                    <div>{formatNumber(getSelectedAvailableForMaterial(req.material_id))} lb</div>
                    <div>
                      <StatusPill
                        covered={
                          numberOrZero(getSelectedAvailableForMaterial(req.material_id)) >=
                          numberOrZero(req.required_lb)
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="Este producto no tiene receta activa." />
            )
          ) : (
            <EmptyState text="Selecciona un producto para calcular la receta." />
          )}
        </section>

        {(requirements.perMaterial || []).map((req) => {
          const lots = getAvailableForMaterial(req.material_id)
          const selectedIds = selectedProcessedLotIdsByMaterial[req.material_id] || []

          return (
            <section
              key={req.material_id}
              className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-stone-800">
                    Lotes de {req.material_name}
                  </h2>
                  <p className="mt-1 text-sm text-stone-500">
                    Selecciona los lotes procesados con los que cubrirás {formatNumber(req.required_lb)} lb.
                  </p>
                </div>
                <StatusPill
                  covered={numberOrZero(getSelectedAvailableForMaterial(req.material_id)) >= numberOrZero(req.required_lb)}
                />
              </div>

              <MaterialSelectionCard
                requirement={req}
                lots={lots}
                selectedIds={selectedIds}
                onToggle={toggleProcessedLot}
                selectedAvailable={getSelectedAvailableForMaterial(req.material_id)}
              />
            </section>
          )
        })}

        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-stone-800">Resumen final</h2>
            <p className="mt-1 text-sm text-stone-500">
              Cuando registres, el sistema generará el lote, calculará vencimiento y lo enviará a cuarto frío.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Cantidad empacada"
              value={`${formatNumber(quantityPacked)} unidad`}
            />
            <KpiCard
              label="Peso total empacado"
              value={`${formatNumber(requirements.packedWeightLb)} lb`}
            />
            <KpiCard
              label="Costo total estimado"
              value={formatNumber(estimatedProcessedCost)}
            />
            <KpiCard
              label="Costo unitario estimado"
              value={formatNumber(estimatedUnitCost)}
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={saving || !recipeCovered}
              className="rounded-2xl bg-[#2f5d50] px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Registrando empaque...' : 'Terminar empaque'}
            </button>
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
      </form>
    </div>
  )
}