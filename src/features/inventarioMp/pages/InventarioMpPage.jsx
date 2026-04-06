import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  getMaterialInventoryLots,
  updateMaterialInventoryLocation,
} from '../services/materialInventoryService'

export default function InventarioMpPage() {
  const [lots, setLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')

  const [showLocationModal, setShowLocationModal] = useState(false)
  const [selectedLot, setSelectedLot] = useState(null)
  const [locationValue, setLocationValue] = useState('')

  useEffect(() => {
    loadLots()
  }, [])

  async function loadLots() {
    setLoading(true)
    setError('')

    try {
      const data = await getMaterialInventoryLots()
      setLots(data)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el inventario')
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

  async function handleSaveLocation(e) {
    e.preventDefault()
    if (!selectedLot) return

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await updateMaterialInventoryLocation(selectedLot.id, locationValue)
      setSuccess('Ubicación actualizada correctamente.')
      await loadLots()

      setTimeout(() => {
        closeLocationModal()
      }, 700)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la ubicación')
    } finally {
      setSaving(false)
    }
  }

  const filteredLots = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return lots

    return lots.filter((lot) =>
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
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [lots, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Producción
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">
            Inventario de materia prima
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Consulta los lotes liberados disponibles para consumo en producción.
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
            placeholder="Buscar por lote, materia prima, proveedor, ubicación..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 md:max-w-md"
          />

          <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
            Total lotes: <span className="font-semibold text-stone-800">{filteredLots.length}</span>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">
            Cargando inventario...
          </div>
        ) : filteredLots.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay lotes en inventario de materia prima.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLots.map((lot) => (
              <div
                key={lot.id}
                className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
              >
                <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <div className="text-base font-semibold text-stone-800">
                      {lot.materials?.common_name || '—'}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      {lot.materials?.code || 'Sin código'}
                    </div>
                  </div>

                  <div className="text-sm text-stone-500">
                    Lote: {lot.internal_lot}
                  </div>

                  <div className="text-sm text-stone-500">
                    Prov.: {lot.suppliers?.name || '—'}
                  </div>

                  <div className="text-sm text-stone-500">
                    Disp.: {Number(lot.available_quantity || 0).toFixed(2)} {lot.unit}
                  </div>

                  <div className="text-sm text-stone-500">
                    Orig.: {Number(lot.original_quantity || 0).toFixed(2)} {lot.unit}
                  </div>

                  <div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        lot.status === 'disponible'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {lot.status}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 border-t border-stone-200 pt-3 text-sm text-stone-500 md:grid-cols-5">
                  <div>Fecha: {lot.received_date}</div>
                  <div>Ubicación: {lot.location || 'Sin asignar'}</div>
                  <div>Costo unit.: Q {Number(lot.unit_cost || 0).toFixed(4)}</div>
                  <div>Costo total: Q {Number(lot.total_cost || 0).toFixed(2)}</div>
                  <div>Lote proveedor: {lot.supplier_lot || '—'}</div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => openLocationModal(lot)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                  >
                    Editar ubicación
                  </button>
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
        isOpen={showLocationModal}
        onClose={closeLocationModal}
        title="Actualizar ubicación del lote"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveLocation} className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
            <div>
              <span className="font-semibold text-stone-800">Lote:</span>{' '}
              {selectedLot?.internal_lot || '—'}
            </div>
            <div className="mt-1">
              <span className="font-semibold text-stone-800">Materia prima:</span>{' '}
              {selectedLot?.materials?.common_name || '—'}
            </div>
          </div>

          <div>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">
                Ubicación
              </span>
              <input
                value={locationValue}
                onChange={(e) => setLocationValue(e.target.value)}
                placeholder="Ej. Cámara fría A / Rack 2 / Estante superior"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

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
    </div>
  )
}
