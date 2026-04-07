import { useState, useEffect, useCallback } from 'react'
import { getProyeccionData } from '../services/proyeccionService'
import {
  getSuppliersForPurchaseOrders,
  createPurchaseOrder,
} from '../../compras/Services/purchaseOrdersService'

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = [
  { dow: 1, short: 'Lun' },
  { dow: 2, short: 'Mar' },
  { dow: 3, short: 'Mié' },
  { dow: 4, short: 'Jue' },
  { dow: 5, short: 'Vie' },
  { dow: 6, short: 'Sáb' },
  { dow: 0, short: 'Dom' },
]
const WEEK_OPTIONS = [4, 8, 12]

function fmt(v, d = 1) {
  const n = Number(v)
  return isNaN(n) ? '—' : n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: d })
}

const todayDow = new Date().getDay()

function todayDateStr() {
  return new Date().toISOString().slice(0, 10)
}

// Add N calendar days to today and return YYYY-MM-DD
function addDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ─── Cell confidence tint ─────────────────────────────────────────────────────
function cellBg(day, rowMax) {
  if (!day || day.avg === 0) return ''
  const pct = rowMax > 0 ? day.suggested / rowMax : 0
  if (pct > 0.8) return 'bg-[#2f5d50]/10'
  if (pct > 0.5) return 'bg-[#2f5d50]/6'
  if (pct > 0.2) return 'bg-[#2f5d50]/3'
  return ''
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProyeccionComprasPage() {
  const [weeks, setWeeks]         = useState(4)
  const [data, setData]           = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  // OC panel
  const [showPanel, setShowPanel]         = useState(false)
  const [deliveryDate, setDeliveryDate]   = useState(addDays(1))
  const [assignments, setAssignments]     = useState({})   // { [materialId]: { supplierId, qty } }
  const [generating, setGenerating]       = useState(false)
  const [genResult, setGenResult]         = useState(null) // { ok: [], err: [] }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [proj, sups] = await Promise.all([
        getProyeccionData(weeks),
        getSuppliersForPurchaseOrders(),
      ])
      setData(proj)
      setSuppliers(sups)
    } catch (e) {
      setError(e.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [weeks])

  useEffect(() => { load() }, [load])

  // Pre-fill assignments when opening panel: qty = today's suggested
  function openPanel() {
    const init = {}
    data.forEach((m) => {
      const day = m.days[todayDow]
      init[m.material_id] = {
        supplierId: '',
        qty: day && day.suggested > 0 ? Math.ceil(day.suggested) : '',
      }
    })
    setAssignments(init)
    setGenResult(null)
    setShowPanel(true)
  }

  function setAssignment(materialId, field, value) {
    setAssignments(prev => ({
      ...prev,
      [materialId]: { ...prev[materialId], [field]: value },
    }))
  }

  // Group assignments by supplier and fire one createPurchaseOrder per supplier
  async function handleGenerate() {
    // Build groups: supplierId → [{ material_id, quantity, unit, unit_cost }]
    const groups = {}
    data.forEach((m) => {
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

    if (Object.keys(groups).length === 0) {
      setGenResult({ ok: [], err: ['Asigna al menos un material con proveedor y cantidad.'] })
      return
    }

    setGenerating(true)
    const ok = []
    const err = []

    for (const [supplierId, items] of Object.entries(groups)) {
      const sup = suppliers.find(s => s.id === supplierId)
      try {
        await createPurchaseOrder({
          supplier_id: supplierId,
          delivery_date: deliveryDate,
          notes: `Generada automáticamente desde Proyección de compras`,
          items,
        })
        ok.push(`OC creada para ${sup?.name || supplierId} (${items.length} ítem${items.length !== 1 ? 's' : ''})`)
      } catch (e) {
        err.push(`${sup?.name || supplierId}: ${e.message}`)
      }
    }

    setGenerating(false)
    setGenResult({ ok, err })
    if (ok.length > 0) load() // refresh
  }

  // Rows with at least one day with data
  const hasData = data.length > 0

  // Per-row max suggested (for color intensity)
  function rowMax(material) {
    return Math.max(...DAYS.map(d => material.days[d.dow]?.suggested || 0), 0.001)
  }

  // How many suppliers assigned in panel
  const supplierCount = Object.values(assignments).filter(a => a?.supplierId).length
  const uniqueSuppliers = [...new Set(
    Object.values(assignments).filter(a => a?.supplierId).map(a => a.supplierId)
  )].length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Inteligencia</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">Proyección de compras</h1>
          <p className="mt-1 text-sm text-stone-500">
            Estadística histórica por día de la semana. Genera órdenes de compra automáticas desde aquí.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period */}
          <div className="flex overflow-hidden rounded-xl border border-stone-300 bg-white shadow-sm">
            {WEEK_OPTIONS.map(w => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`px-3 py-2 text-sm font-semibold transition ${
                  weeks === w ? 'bg-[#2f5d50] text-white' : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {w}sem
              </button>
            ))}
          </div>
          <button
            onClick={openPanel}
            disabled={!hasData}
            className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#264c42] disabled:opacity-40"
          >
            + Generar órdenes de compra
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Matrix table */}
      <div className="rounded-3xl border border-stone-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-stone-200 border-t-[#2f5d50]" />
          </div>
        ) : !hasData ? (
          <div className="py-20 text-center text-sm text-stone-400">
            Sin historial de recepciones en las últimas {weeks} semanas.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '780px' }}>
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50/70">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400 w-[220px]">
                    Material
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-stone-400 w-16">
                    Und.
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-stone-400 w-20">
                    Prom/sem
                  </th>
                  {DAYS.map(({ dow, short }) => (
                    <th
                      key={dow}
                      className={`px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider w-[90px] ${
                        dow === todayDow
                          ? 'bg-[#2f5d50]/8 text-[#2f5d50]'
                          : 'text-stone-400'
                      }`}
                    >
                      {short}
                      {dow === todayDow && (
                        <span className="ml-1 text-[10px] font-bold text-[#2f5d50]">●</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.map((material) => {
                  const rMax = rowMax(material)
                  return (
                    <tr key={material.material_id} className="hover:bg-stone-50/50 transition">
                      {/* Material */}
                      <td className="px-5 py-3">
                        <p className="font-medium text-stone-800 leading-tight">{material.name}</p>
                        <p className="text-[11px] text-stone-400 font-mono">{material.code}</p>
                      </td>
                      {/* Unit */}
                      <td className="px-3 py-3 text-center text-xs text-stone-500">{material.base_unit}</td>
                      {/* Weekly avg */}
                      <td className="px-3 py-3 text-center">
                        <span className="text-sm font-semibold text-stone-700">{fmt(material.weekly_avg)}</span>
                      </td>
                      {/* Day cells */}
                      {DAYS.map(({ dow }) => {
                        const day = material.days[dow]
                        const hasDay = day && day.avg > 0
                        const isToday = dow === todayDow
                        return (
                          <td
                            key={dow}
                            className={`px-2 py-2 text-center ${isToday ? 'bg-[#2f5d50]/5' : ''} ${hasDay ? cellBg(day, rMax) : ''}`}
                          >
                            {hasDay ? (
                              <div>
                                <p className={`text-sm font-bold leading-tight ${isToday ? 'text-[#2f5d50]' : 'text-stone-800'}`}>
                                  {fmt(day.suggested)}
                                </p>
                                <p className="text-[10px] text-stone-400 leading-tight mt-0.5">
                                  {fmt(day.min, 0)}–{fmt(day.max, 0)}
                                </p>
                              </div>
                            ) : (
                              <span className="text-stone-200 text-xs">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        {hasData && !loading && (
          <div className="border-t border-stone-100 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-stone-400">
            <span><strong className="text-stone-600">Número grande</strong> = sugerido (prom + 0.5σ)</span>
            <span><strong className="text-stone-500">min–max</strong> = rango histórico de días con recepción</span>
            <span>Columna <span className="font-semibold text-[#2f5d50]">verde</span> = hoy</span>
            <span className="ml-auto">{data.length} materias primas · últimas {weeks} semanas</span>
          </div>
        )}
      </div>

      {/* ─── OC Generation Panel (modal) ──────────────────────────────────────── */}
      {showPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="flex w-full max-w-3xl flex-col rounded-3xl bg-white shadow-2xl max-h-[90vh]">

            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-stone-900">Generar órdenes de compra</h2>
                <p className="text-sm text-stone-500 mt-0.5">
                  Asigna proveedor y cantidad por material. Se creará una OC por cada proveedor.
                </p>
              </div>
              <button
                onClick={() => setShowPanel(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-stone-400 hover:bg-stone-100 transition"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Delivery date */}
            <div className="border-b border-stone-100 px-6 py-4 shrink-0">
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-stone-700">Fecha de entrega:</span>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                    min={todayDateStr()}
                    className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-[#2f5d50]/10"
                  />
                </label>
                {supplierCount > 0 && (
                  <span className="rounded-full bg-[#2f5d50]/10 px-3 py-1 text-xs font-semibold text-[#2f5d50]">
                    {supplierCount} ítem{supplierCount !== 1 ? 's' : ''} · {uniqueSuppliers} OC{uniqueSuppliers !== 1 ? 's' : ''} a generar
                  </span>
                )}
              </div>
            </div>

            {/* Materials table */}
            <div className="flex-1 overflow-y-auto px-6 py-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-stone-100">
                    <th className="py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Material</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-stone-400">Cantidad</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-stone-400">Und.</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Proveedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {data.map((m) => {
                    const a = assignments[m.material_id] || {}
                    const dayData = m.days[todayDow]
                    return (
                      <tr key={m.material_id} className="hover:bg-stone-50/50">
                        <td className="py-3 pr-3">
                          <p className="font-medium text-stone-800">{m.name}</p>
                          <p className="text-[11px] text-stone-400 font-mono">{m.code}</p>
                          {dayData && dayData.avg > 0 && (
                            <p className="text-[11px] text-[#2f5d50]">
                              Sugerido hoy: {fmt(dayData.suggested)} {m.base_unit}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={a.qty ?? ''}
                            onChange={e => setAssignment(m.material_id, 'qty', e.target.value)}
                            placeholder="0"
                            className="w-24 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-center text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-[#2f5d50]/10"
                          />
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-stone-500">{m.base_unit}</td>
                        <td className="px-3 py-3">
                          <select
                            value={a.supplierId || ''}
                            onChange={e => setAssignment(m.material_id, 'supplierId', e.target.value)}
                            className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-[#2f5d50]/10"
                          >
                            <option value="">— sin asignar —</option>
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

            {/* Result messages */}
            {genResult && (
              <div className="border-t border-stone-100 px-6 py-4 space-y-2 shrink-0">
                {genResult.ok.map((msg, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800">
                    <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {msg}
                  </div>
                ))}
                {genResult.err.map((msg, i) => (
                  <div key={i} className="rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{msg}</div>
                ))}
              </div>
            )}

            {/* Footer actions */}
            <div className="flex items-center justify-between border-t border-stone-200 px-6 py-4 shrink-0">
              <p className="text-xs text-stone-400">
                Los precios unitarios quedan en Q 0 — edítalos en Órdenes de compra.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPanel(false)}
                  className="rounded-2xl border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                >
                  {genResult?.ok?.length > 0 ? 'Cerrar' : 'Cancelar'}
                </button>
                {(!genResult || genResult.err?.length > 0) && (
                  <button
                    onClick={handleGenerate}
                    disabled={generating || supplierCount === 0}
                    className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#264c42] disabled:opacity-50"
                  >
                    {generating
                      ? 'Generando...'
                      : `Generar ${uniqueSuppliers > 0 ? `${uniqueSuppliers} OC${uniqueSuppliers !== 1 ? 's' : ''}` : 'órdenes'}`
                    }
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
