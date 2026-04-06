import { useState, useEffect, useCallback } from 'react'
import { getDemandaData } from '../services/demandaService'

function fmt(value, decimals = 2) {
  const n = Number(value)
  if (isNaN(n)) return '0'
  return n % 1 === 0 ? n.toLocaleString('es-GT') : n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

function DeficitBadge({ deficit, unit }) {
  if (deficit > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
        ↑ déficit {fmt(deficit)} {unit}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
      ✓ excedente {fmt(Math.abs(deficit))} {unit}
    </span>
  )
}

function MaterialRow({ material }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* Main row */}
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              {material.code}
            </span>
            <DeficitBadge deficit={material.deficit} unit={material.base_unit} />
          </div>
          <p className="text-base font-semibold text-stone-800 truncate">{material.name}</p>
        </div>

        <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
          <div className="text-center">
            <p className="text-xs text-stone-500 uppercase tracking-wider">Necesario</p>
            <p className="text-base font-semibold text-stone-800">
              {fmt(material.needed_qty)} <span className="text-xs text-stone-500">{material.base_unit}</span>
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-stone-500 uppercase tracking-wider">En stock</p>
            <p className="text-base font-semibold text-stone-800">
              {fmt(material.stock_qty)} <span className="text-xs text-stone-500">{material.base_unit}</span>
            </p>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 whitespace-nowrap"
          >
            {expanded ? 'Ocultar' : `Ver pedidos (${material.orders.length})`}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-stone-100 bg-[#faf9f7] px-5 py-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Pedidos que generan esta demanda
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200">
                  <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Pedido</th>
                  <th className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Presentación</th>
                  <th className="pb-2 pr-4 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Uds. pendientes</th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Materia prima</th>
                </tr>
              </thead>
              <tbody>
                {material.orders.map((o, idx) => (
                  <tr key={idx} className="border-b border-stone-100 last:border-0">
                    <td className="py-2 pr-4 font-semibold text-stone-800">#{o.order_number}</td>
                    <td className="py-2 pr-4 text-stone-600">{o.presentation_name}</td>
                    <td className="py-2 pr-4 text-right text-stone-600">{fmt(o.pending_units)}</td>
                    <td className="py-2 text-right font-semibold text-stone-800">
                      {fmt(o.material_needed)} <span className="text-xs text-stone-400">{o.recipe_unit || material.base_unit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DemandaMpPage() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getDemandaData()
      setData(result)
    } catch (err) {
      setError(err.message || 'Error al cargar la demanda')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const totalMaterials = data.length
  const withDeficit = data.filter((m) => m.deficit > 0).length
  const covered = data.filter((m) => m.deficit <= 0).length

  return (
    <div className="min-h-screen bg-[#f2eadf] px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Inteligencia de abastecimiento
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-800">
            Demanda de Materias Primas
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Materiales necesarios para pedidos pendientes de empacar (confirmado / empacado parcial).
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60 self-start"
        >
          {loading ? 'Cargando…' : '↻ Actualizar'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-3xl bg-stone-200" />
          ))}
        </div>
      )}

      {/* Summary bar */}
      {!loading && !error && data.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Total materiales</p>
            <p className="mt-1 text-3xl font-bold text-stone-800">{totalMaterials}</p>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">Con déficit</p>
            <p className="mt-1 text-3xl font-bold text-red-700">{withDeficit}</p>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Cubiertos</p>
            <p className="mt-1 text-3xl font-bold text-emerald-700">{covered}</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && data.length === 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
          <p className="text-lg font-semibold text-emerald-800">Sin pedidos pendientes</p>
          <p className="mt-1 text-sm text-emerald-700">
            No hay pedidos en estado "confirmado" o "empacado" con unidades pendientes de empacar.
          </p>
        </div>
      )}

      {/* Material list */}
      {!loading && !error && data.length > 0 && (
        <div className="space-y-4">
          {data.map((material) => (
            <MaterialRow key={material.material_id} material={material} />
          ))}
        </div>
      )}
    </div>
  )
}
