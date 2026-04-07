import { useState, useEffect, useCallback } from 'react'
import { getDemandaData, getMermaByMaterial } from '../services/demandaService'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  getSuppliersForPurchaseOrders,
  createPurchaseOrder,
} from '../../compras/Services/purchaseOrdersService'

function fmt(value, decimals = 2) {
  const n = Number(value)
  if (isNaN(n)) return '0'
  return n % 1 === 0 ? n.toLocaleString('es-GT') : n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

const todayStr = new Date().toISOString().slice(0, 10)

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
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{material.code}</span>
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
            onClick={() => setExpanded(v => !v)}
            className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 whitespace-nowrap"
          >
            {expanded ? 'Ocultar' : `Ver pedidos (${material.orders.length})`}
          </button>
        </div>
      </div>

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

// ─── OC de emergencia panel ───────────────────────────────────────────────────

function OCEmergenciaPanel({ deficitItems, suppliers, mermaMap = {}, onClose, onDone }) {
  const [deliveryDate, setDeliveryDate]   = useState(todayStr)
  const [assignments, setAssignments]     = useState(() => {
    const init = {}
    deficitItems.forEach(m => {
      const rate = mermaMap[m.material_id] || 0
      const adjusted = rate > 0 ? m.deficit / (1 - rate) : m.deficit
      init[m.material_id] = { supplierId: '', qty: Math.ceil(adjusted) }
    })
    return init
  })
  const [generating, setGenerating] = useState(false)
  const [result, setResult]         = useState(null)  // { ok, err }

  function setField(materialId, field, value) {
    setAssignments(prev => ({ ...prev, [materialId]: { ...prev[materialId], [field]: value } }))
  }

  const activeCount = Object.values(assignments).filter(a => a.supplierId && Number(a.qty) > 0).length
  const uniqueSuppliers = [...new Set(
    Object.values(assignments).filter(a => a.supplierId).map(a => a.supplierId)
  )].length

  async function handleGenerate() {
    const groups = {}
    deficitItems.forEach(m => {
      const a = assignments[m.material_id]
      if (!a?.supplierId || !a?.qty || Number(a.qty) <= 0) return
      if (!groups[a.supplierId]) groups[a.supplierId] = []
      groups[a.supplierId].push({
        material_id: m.material_id,
        quantity: Number(a.qty),
        unit: m.base_unit,
        unit_cost: 0,
      })
    })

    if (!Object.keys(groups).length) {
      setResult({ ok: [], err: ['Asigna al menos un material con proveedor y cantidad.'] })
      return
    }

    setGenerating(true)
    const ok = [], err = []

    for (const [supplierId, items] of Object.entries(groups)) {
      const sup = suppliers.find(s => s.id === supplierId)
      try {
        await createPurchaseOrder({
          supplier_id: supplierId,
          delivery_date: deliveryDate,
          notes: 'OC de emergencia — déficit de demanda MP',
          items,
        })
        ok.push(`OC creada para ${sup?.name || supplierId} (${items.length} ítem${items.length !== 1 ? 's' : ''})`)
      } catch (e) {
        err.push(`${sup?.name || supplierId}: ${e.message}`)
      }
    }

    setGenerating(false)
    setResult({ ok, err })
    if (ok.length > 0) onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-stone-900">OC de emergencia — déficit MP</h2>
            <p className="text-sm text-stone-500 mt-0.5">
              Asigna proveedor por material. Entrega para hoy mismo.
            </p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl text-stone-400 hover:bg-stone-100">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Delivery date */}
        <div className="border-b border-stone-100 px-6 py-3 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-3">
              <span className="text-sm font-semibold text-stone-700">Fecha de entrega:</span>
              <input
                type="date"
                value={deliveryDate}
                onChange={e => setDeliveryDate(e.target.value)}
                className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-[#2f5d50]/10"
              />
            </label>
            {activeCount > 0 && (
              <span className="rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-semibold text-red-700">
                {activeCount} ítem{activeCount !== 1 ? 's' : ''} · {uniqueSuppliers} OC{uniqueSuppliers !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Materials */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-stone-100">
                <th className="py-2 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Material</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-red-400">Déficit</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-amber-500">Merma</th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider text-stone-400">A pedir</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Proveedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {deficitItems.map(m => {
                const a = assignments[m.material_id] || {}
                const rate = mermaMap[m.material_id] || 0
                const mermaQty = rate > 0 ? (m.deficit / (1 - rate)) - m.deficit : 0
                return (
                  <tr key={m.material_id} className="hover:bg-stone-50/50">
                    <td className="py-3 pr-3">
                      <p className="font-medium text-stone-800">{m.name}</p>
                      <p className="text-[11px] text-stone-400 font-mono">{m.code}</p>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="text-sm font-bold text-red-600">{fmt(m.deficit)}</span>
                      <span className="ml-1 text-xs text-stone-400">{m.base_unit}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {rate > 0 ? (
                        <div className="flex flex-col items-center leading-tight">
                          <span className="text-xs font-semibold text-amber-600">+{fmt(mermaQty)}</span>
                          <span className="text-[10px] text-stone-400">{(rate * 100).toFixed(1)}% merma</span>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number" min="0" step="0.5"
                        value={a.qty ?? ''}
                        onChange={e => setField(m.material_id, 'qty', e.target.value)}
                        className="w-24 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-center text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-[#2f5d50]/10"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={a.supplierId || ''}
                        onChange={e => setField(m.material_id, 'supplierId', e.target.value)}
                        className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-[#2f5d50]/10"
                      >
                        <option value="">— proveedor —</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Results */}
        {result && (
          <div className="border-t border-stone-100 px-6 py-4 space-y-2 shrink-0">
            {result.ok.map((msg, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
                <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {msg}
              </div>
            ))}
            {result.err.map((msg, i) => (
              <div key={i} className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{msg}</div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-stone-200 px-6 py-4 shrink-0">
          <p className="text-xs text-stone-400">Los precios quedan en Q 0 — editar en Órdenes de compra.</p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-2xl border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 transition"
            >
              {result?.ok?.length > 0 ? 'Cerrar' : 'Cancelar'}
            </button>
            {(!result || result.err?.length > 0) && (
              <button
                onClick={handleGenerate}
                disabled={generating || activeCount === 0}
                className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition disabled:opacity-50"
              >
                {generating
                  ? 'Generando...'
                  : `Generar ${uniqueSuppliers > 0 ? `${uniqueSuppliers} OC${uniqueSuppliers !== 1 ? 's' : ''}` : 'OCs'} urgentes`
                }
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DemandaMpPage() {
  const [data, setData]           = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [mermaMap, setMermaMap]   = useState({})
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [showOCPanel, setShowOCPanel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [demanda, sups, merma] = await Promise.all([
        getDemandaData(),
        getSuppliersForPurchaseOrders(),
        getMermaByMaterial().catch(() => ({})),   // non-blocking — fallback to empty
      ])
      setData(demanda)
      setSuppliers(sups)
      setMermaMap(merma)
    } catch (err) {
      setError(err.message || 'Error al cargar la demanda')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['orders', 'order_items', 'material_inventory_lots'], load)

  const totalMaterials = data.length
  const withDeficit    = data.filter(m => m.deficit > 0).length
  const covered        = data.filter(m => m.deficit <= 0).length
  const deficitItems   = data.filter(m => m.deficit > 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Inteligencia</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">Demanda de Materias Primas</h1>
          <p className="mt-1 text-sm text-stone-500">
            Materiales necesarios para pedidos pendientes de empacar.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap self-start">
          {deficitItems.length > 0 && (
            <button
              onClick={() => setShowOCPanel(true)}
              className="flex items-center gap-2 rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              OC urgente ({deficitItems.length} con déficit)
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="rounded-2xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50 transition disabled:opacity-60"
          >
            {loading ? 'Cargando…' : '↻ Actualizar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 animate-pulse rounded-3xl bg-stone-200" />
          ))}
        </div>
      )}

      {/* Summary */}
      {!loading && !error && data.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
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

      {!loading && !error && data.length === 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center">
          <p className="text-lg font-semibold text-emerald-800">Sin pedidos pendientes</p>
          <p className="mt-1 text-sm text-emerald-700">
            No hay pedidos en estado "confirmado" o "empacado" con unidades pendientes de empacar.
          </p>
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="space-y-4">
          {data.map(material => (
            <MaterialRow key={material.material_id} material={material} />
          ))}
        </div>
      )}

      {/* OC emergencia panel */}
      {showOCPanel && (
        <OCEmergenciaPanel
          deficitItems={deficitItems}
          suppliers={suppliers}
          mermaMap={mermaMap}
          onClose={() => setShowOCPanel(false)}
          onDone={() => { load(); setShowOCPanel(false) }}
        />
      )}
    </div>
  )
}
