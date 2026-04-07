import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  getPackagingInventoryLots,
  updatePackagingInventoryLocation,
  updateMaterialMinimumStock,
} from '../services/packagingInventoryService'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'

export default function InventarioEmpaquePage() {
  const [lots, setLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')

  const [showLocationModal, setShowLocationModal] = useState(false)
  const [showMinModal, setShowMinModal] = useState(false)
  const [selectedLot, setSelectedLot] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [locationValue, setLocationValue] = useState('')
  const [minimumStockValue, setMinimumStockValue] = useState('')

  useEffect(() => {
    loadLots()
  }, [])
  useRealtimeRefresh(['material_inventory_lots', 'materials'], loadLots)

  async function loadLots() {
    setLoading(true)
    setError('')
    try {
      const data = await getPackagingInventoryLots()
      setLots(data)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el inventario de empaque')
    } finally {
      setLoading(false)
    }
  }

  function openLocationModal(lot) {
    setSelectedLot(lot)
    setLocationValue(lot.location || '')
    setError('')
    setSuccess('')
    setShowLocationModal(true)
  }

  function closeLocationModal() {
    setSelectedLot(null)
    setLocationValue('')
    setSaving(false)
    setShowLocationModal(false)
  }

  function openMinModal(group) {
    setSelectedGroup(group)
    setMinimumStockValue(String(group.minimum_stock ?? 0))
    setError('')
    setSuccess('')
    setShowMinModal(true)
  }

  function closeMinModal() {
    setSelectedGroup(null)
    setMinimumStockValue('')
    setSaving(false)
    setShowMinModal(false)
  }

  async function handleSaveLocation(e) {
    e.preventDefault()
    if (!selectedLot) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updatePackagingInventoryLocation(selectedLot.id, locationValue)
      setSuccess('Ubicación actualizada correctamente.')
      await loadLots()
      setTimeout(closeLocationModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la ubicación')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveMinimum(e) {
    e.preventDefault()
    if (!selectedGroup) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updateMaterialMinimumStock(selectedGroup.material_id, minimumStockValue)
      setSuccess('Stock mínimo actualizado correctamente.')
      await loadLots()
      setTimeout(closeMinModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el stock mínimo')
    } finally {
      setSaving(false)
    }
  }

  // Agrupar lotes por material y sumar cantidades
  const groupedMaterials = useMemo(() => {
    const term = search.trim().toLowerCase()

    const filtered = term
      ? lots.filter((lot) =>
          [
            lot.internal_lot,
            lot.supplier_lot,
            lot.location,
            lot.status,
            lot.suppliers?.name,
            lot.materials?.common_name,
            lot.materials?.code,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term))
        )
      : lots

    const groups = new Map()

    for (const lot of filtered) {
      const matId = lot.material_id
      if (!groups.has(matId)) {
        groups.set(matId, {
          material_id: matId,
          material: lot.materials,
          unit: lot.unit,
          minimum_stock: Number(lot.materials?.minimum_stock ?? 0),
          total_available: 0,
          total_cost: 0,
          lots: [],
        })
      }
      const g = groups.get(matId)
      g.lots.push(lot)
      g.total_available += Number(lot.available_quantity || 0)
      g.total_cost += Number(lot.total_cost || 0)
    }

    return Array.from(groups.values())
  }, [lots, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Producción / Abastecimiento
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">
            Inventario de material de empaque
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Consulta el inventario total por tipo de empaque, define mínimos y administra ubicaciones por lote.
          </p>
        </div>

        <button
          onClick={loadLots}
          className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
        >
          Recargar inventario
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por lote, empaque, proveedor o ubicación..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 md:max-w-md"
          />

          <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
            Materiales: <span className="font-semibold text-stone-800">{groupedMaterials.length}</span>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">
            Cargando inventario de empaque...
          </div>
        ) : groupedMaterials.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay lotes de empaque en inventario.
          </div>
        ) : (
          <div className="space-y-4">
            {groupedMaterials.map((group) => {
              const belowMin = group.total_available < group.minimum_stock
              return (
                <div
                  key={group.material_id}
                  className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4"
                >
                  {/* Encabezado del material */}
                  <div className="grid gap-4 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center">
                    <div>
                      <div className="text-base font-semibold text-stone-800">
                        {group.material?.common_name || '—'}
                      </div>
                      <div className="mt-1 text-sm text-stone-500">
                        {group.material?.code || 'Sin código'}
                      </div>
                    </div>

                    <div className="text-sm text-stone-600">
                      <span className="text-stone-400">Disponible total:</span>{' '}
                      <span className="font-semibold text-stone-800">
                        {group.total_available.toFixed(2)} {group.unit}
                      </span>
                    </div>

                    <div className="text-sm text-stone-600">
                      <span className="text-stone-400">Mínimo:</span>{' '}
                      <span className="font-semibold text-stone-800">
                        {group.minimum_stock.toFixed(2)} {group.unit}
                      </span>
                    </div>

                    <div className="text-sm text-stone-600">
                      <span className="text-stone-400">Costo total:</span>{' '}
                      <span className="font-semibold text-stone-800">
                        Q {group.total_cost.toFixed(2)}
                      </span>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        belowMin
                          ? 'bg-red-100 text-red-700'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {belowMin ? 'alerta' : 'ok'}
                    </span>
                  </div>

                  {/* Lotes individuales */}
                  <div className="mt-4 space-y-2 border-t border-stone-200 pt-3">
                    {group.lots.map((lot) => (
                      <div
                        key={lot.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm text-stone-500"
                      >
                        <div className="flex flex-wrap gap-4">
                          <span>Lote: <span className="font-medium text-stone-700">{lot.internal_lot}</span></span>
                          <span>Prov.: <span className="font-medium text-stone-700">{lot.suppliers?.name || '—'}</span></span>
                          <span>Disp.: <span className="font-medium text-stone-700">{Number(lot.available_quantity || 0).toFixed(2)} {lot.unit}</span></span>
                          <span>Ubic.: <span className="font-medium text-stone-700">{lot.location || 'Sin asignar'}</span></span>
                          <span>Fecha: <span className="font-medium text-stone-700">{lot.received_date || '—'}</span></span>
                        </div>
                        <button
                          onClick={() => openLocationModal(lot)}
                          className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-white"
                        >
                          Editar ubicación
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Acción de mínimo a nivel material */}
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => openMinModal(group)}
                      className="rounded-2xl border border-[#2f5d50] bg-white px-4 py-2 text-sm font-semibold text-[#2f5d50] transition hover:bg-emerald-50"
                    >
                      Definir mínimo
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

      <Modal
        isOpen={showLocationModal}
        onClose={closeLocationModal}
        title="Actualizar ubicación del lote"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveLocation} className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            <div>
              <span className="font-semibold text-stone-800">Lote:</span> {selectedLot?.internal_lot || '—'}
            </div>
            <div className="mt-1">
              <span className="font-semibold text-stone-800">Empaque:</span> {selectedLot?.materials?.common_name || '—'}
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Ubicación</span>
            <input
              value={locationValue}
              onChange={(e) => setLocationValue(e.target.value)}
              placeholder="Ej. Bodega de empaque / Estante A / Rack 1"
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 md:flex-row md:justify-end">
            <button
              type="button"
              onClick={closeLocationModal}
              className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar ubicación'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showMinModal}
        onClose={closeMinModal}
        title="Definir stock mínimo"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveMinimum} className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            <div>
              <span className="font-semibold text-stone-800">Material:</span> {selectedGroup?.material?.common_name || '—'}
            </div>
            <div className="mt-1">
              <span className="font-semibold text-stone-800">Total disponible:</span>{' '}
              {selectedGroup?.total_available.toFixed(2)} {selectedGroup?.unit}
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">
              Stock mínimo ({selectedGroup?.unit})
            </span>
            <input
              type="number"
              step="0.01"
              value={minimumStockValue}
              onChange={(e) => setMinimumStockValue(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 md:flex-row md:justify-end">
            <button
              type="button"
              onClick={closeMinModal}
              className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar mínimo'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
