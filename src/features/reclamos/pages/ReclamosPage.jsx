import { useEffect, useState, useCallback } from 'react'
import {
  getClaimsData,
  createClaim,
  deleteClaim,
  resolveClaim,
  getClaimsSummary,
} from '../services/reclamosService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const CLAIM_TYPE_LABEL = { calidad: 'Calidad', problema_entrega: 'Problema de entrega', cantidad: 'Cantidad' }
const CLAIM_TYPE_COLOR = {
  calidad:          'bg-red-100 text-red-700',
  problema_entrega: 'bg-amber-100 text-amber-700',
  cantidad:         'bg-purple-100 text-purple-700',
}
const RESOLUTION_LABEL = { refacturacion: 'Refacturación', nota_credito: 'Nota de crédito', reposicion: 'Reposición' }
const RESOLUTION_COLOR = {
  refacturacion: 'bg-rose-100 text-rose-700',
  nota_credito:  'bg-sky-100 text-sky-700',
  reposicion:    'bg-emerald-100 text-emerald-700',
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ type = 'error', children }) {
  const styles = { error: 'border-red-200 bg-red-50 text-red-700', success: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[type]}`}>{children}</div>
}

// ─── Modal: Nuevo reclamo ─────────────────────────────────────────────────────

function NewClaimModal({ orders, onClose, onSaved }) {
  const [orderId, setOrderId] = useState('')
  const [claimType, setClaimType] = useState('calidad')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!orderId) { setError('Selecciona un pedido'); return }
    setSaving(true)
    setError('')
    try {
      await createClaim(orderId, { claimType, description, amount, costAmount })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <h3 className="font-semibold text-stone-800">Nuevo reclamo</h3>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <Alert type="error">{error}</Alert>}

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Pedido *</span>
            <select value={orderId} onChange={e => setOrderId(e.target.value)} required
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100">
              <option value="">Selecciona un pedido</option>
              {orders.map(o => (
                <option key={o.id} value={o.id}>#{o.order_number} — {o.clients?.commercial_name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Tipo de reclamo *</span>
            <select value={claimType} onChange={e => setClaimType(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100">
              <option value="calidad">Calidad</option>
              <option value="problema_entrega">Problema de entrega</option>
              <option value="cantidad">Cantidad</option>
            </select>
          </label>

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Descripción</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="Describe el problema..."
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Monto del reclamo (Q)</span>
              <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
            </label>
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Costo MP perdida (Q)</span>
              <input type="number" step="0.01" min="0" value={costAmount} onChange={e => setCostAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
            </label>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando...' : 'Crear reclamo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal: Resolver reclamo ──────────────────────────────────────────────────

function ResolveModal({ claim, orders, onClose, onSaved }) {
  const [resolutionType, setResolutionType] = useState('refacturacion')
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [saleLoss, setSaleLoss] = useState(String(n(claim.amount)))
  const [creditNoteValue, setCreditNoteValue] = useState(String(n(claim.amount)))
  const [replacementDeliveryDate, setReplacementDeliveryDate] = useState(new Date().toISOString().slice(0, 10))
  const [replacementItems, setReplacementItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // For reposicion: load original order's items
  const originalOrder = orders.find(o => o.id === claim.order_id)
  useEffect(() => {
    if (resolutionType === 'reposicion' && originalOrder) {
      setReplacementItems(
        (originalOrder.order_items || []).map(i => ({
          product_presentation_id: i.product_presentations?.id,
          display_name: i.product_presentations?.display_name,
          code: i.product_presentations?.code,
          unit: i.product_presentations?.unit,
          quantity: String(n(i.quantity_delivered) || n(i.quantity)),
        }))
      )
    }
  }, [resolutionType, claim.order_id])

  function updateReplacementItem(ppId, val) {
    setReplacementItems(prev => prev.map(i =>
      i.product_presentation_id === ppId ? { ...i, quantity: val } : i
    ))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await resolveClaim(claim.id, {
        resolutionType,
        resolutionNotes,
        saleLoss: resolutionType === 'refacturacion' ? saleLoss : 0,
        creditNoteValue: resolutionType === 'nota_credito' ? creditNoteValue : 0,
        replacementDeliveryDate,
        replacementItems: resolutionType === 'reposicion' ? replacementItems.map(i => ({
          product_presentation_id: i.product_presentation_id,
          quantity: n(i.quantity),
        })) : [],
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl my-4">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <h3 className="font-semibold text-stone-800">Resolver reclamo</h3>
            <p className="text-sm text-stone-500 mt-0.5">
              {CLAIM_TYPE_LABEL[claim.claim_type]} · Pedido #{claim.orders?.order_number}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <Alert type="error">{error}</Alert>}

          {claim.description && (
            <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <span className="font-medium">Descripción: </span>{claim.description}
            </div>
          )}

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Tipo de resolución *</span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'refacturacion', label: 'Refacturación', icon: '🧾' },
                { key: 'nota_credito', label: 'Nota de crédito', icon: '📝' },
                { key: 'reposicion', label: 'Reposición', icon: '🔄' },
              ].map(({ key, label, icon }) => (
                <button key={key} type="button" onClick={() => setResolutionType(key)}
                  className={`rounded-2xl border p-3 text-sm font-medium text-center transition ${
                    resolutionType === key
                      ? 'border-[#2f5d50] bg-emerald-50 text-[#2f5d50]'
                      : 'border-stone-200 text-stone-600 hover:border-stone-300'
                  }`}>
                  <div className="text-lg mb-1">{icon}</div>
                  {label}
                </button>
              ))}
            </div>
          </label>

          {/* Refacturación: captura pérdida de venta */}
          {resolutionType === 'refacturacion' && (
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Pérdida de venta (Q)</span>
              <input type="number" step="0.01" min="0" value={saleLoss} onChange={e => setSaleLoss(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
              <p className="mt-1 text-xs text-stone-400">Se registrará como pérdida de venta. La materia prima ya fue utilizada.</p>
            </label>
          )}

          {/* Nota de crédito: valor a abonar al cliente */}
          {resolutionType === 'nota_credito' && (
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Valor de nota de crédito (Q)</span>
              <input type="number" step="0.01" min="0" value={creditNoteValue} onChange={e => setCreditNoteValue(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
              <p className="mt-1 text-xs text-stone-400">Se registrará como nota de crédito para {originalOrder?.clients?.commercial_name}.</p>
            </label>
          )}

          {/* Reposición: nuevo pedido con los mismos productos */}
          {resolutionType === 'reposicion' && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Se creará un nuevo pedido con valor Q 0.00, sin posibilidad de facturación.
              </div>
              <label className="block">
                <span className="block mb-1 text-sm font-medium text-stone-700">Fecha de reposición</span>
                <input type="date" value={replacementDeliveryDate} onChange={e => setReplacementDeliveryDate(e.target.value)}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-700">Productos a reponer:</p>
                {replacementItems.map(item => (
                  <div key={item.product_presentation_id} className="grid grid-cols-[1fr_auto] gap-3 items-center rounded-2xl border border-stone-200 bg-stone-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-stone-800">{item.display_name}</p>
                      <p className="text-xs text-stone-400">{item.code}</p>
                    </div>
                    <input type="number" step="1" min="0" value={item.quantity}
                      onChange={e => updateReplacementItem(item.product_presentation_id, e.target.value)}
                      className="w-20 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-center outline-none focus:border-[#2f5d50]" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Notas de resolución</span>
            <textarea value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)} rows={2}
              placeholder="Detalle adicional..."
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100" />
          </label>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving}
              className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Resolviendo...' : 'Confirmar resolución'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ReclamosPage() {
  const [data, setData] = useState({ orders: [], claims: [] })
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNewModal, setShowNewModal] = useState(false)
  const [resolvingClaim, setResolvingClaim] = useState(null)
  const [tab, setTab] = useState('abierto')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    const [dataRes, summaryRes] = await Promise.allSettled([getClaimsData(), getClaimsSummary()])
    if (dataRes.status === 'fulfilled') setData(dataRes.value)
    else setError(dataRes.reason?.message)
    if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function handleDeleteClaim() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteClaim(deleteTarget.id)
      setDeleteTarget(null)
      await loadData()
    } catch (err) {
      setError(err.message || 'No se pudo anular el reclamo')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const openClaims = data.claims.filter(c => c.status === 'abierto')
  const closedClaims = data.claims.filter(c => c.status === 'cerrado')
  const totalSaleLoss = closedClaims.reduce((acc, c) => acc + n(c.sale_loss), 0)
  const totalCreditNotes = closedClaims.reduce((acc, c) => acc + n(c.credit_note_value), 0)
  const totalCost = closedClaims.reduce((acc, c) => acc + n(c.cost_amount), 0)

  const visibleClaims = tab === 'abierto' ? openClaims : closedClaims

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ERP · Postventa</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Reclamos</h1>
            <p className="mt-1 text-sm text-stone-500">Los reclamos son reportados por el piloto desde Logística.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={loadData} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
              Actualizar
            </button>
            </div>
        </div>

        {error && <Alert type="error">{error}</Alert>}

        {/* KPIs financieros */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: 'Costo producción perdido', value: `Q ${fmt(totalCost)}`, color: 'text-red-700' },
            { label: 'Pérdidas por refacturación', value: `Q ${fmt(totalSaleLoss)}`, color: 'text-rose-700' },
            { label: 'Notas de crédito emitidas', value: `Q ${fmt(totalCreditNotes)}`, color: 'text-sky-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-3xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
              <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {[
            { key: 'abierto', label: `Abiertos (${openClaims.length})` },
            { key: 'cerrado', label: `Cerrados (${closedClaims.length})` },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition ${
                tab === key ? 'bg-[#2f5d50] text-white' : 'bg-white border border-stone-200 text-stone-600 hover:border-stone-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Lista de reclamos */}
        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-3xl border border-stone-200 bg-white py-16">
            <Spinner />
          </div>
        ) : visibleClaims.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-16 text-center">
            <p className="text-stone-400">No hay reclamos {tab === 'abierto' ? 'abiertos' : 'cerrados'}.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleClaims.map(claim => (
              <div key={claim.id} className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-stone-900">
                        Pedido #{claim.orders?.order_number}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLAIM_TYPE_COLOR[claim.claim_type]}`}>
                        {CLAIM_TYPE_LABEL[claim.claim_type]}
                      </span>
                      {claim.status === 'cerrado' && claim.resolution_type && (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RESOLUTION_COLOR[claim.resolution_type]}`}>
                          {RESOLUTION_LABEL[claim.resolution_type]}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-stone-600">{claim.orders?.clients?.commercial_name}</p>
                    {claim.description && (
                      <p className="text-sm text-stone-500">{claim.description}</p>
                    )}
                    <div className="flex gap-4 text-xs text-stone-400 flex-wrap">
                      {n(claim.cost_amount) > 0 && <span className="text-red-500 font-medium">Costo prod.: Q {fmt(claim.cost_amount)}</span>}
                      {n(claim.amount) > 0 && <span>Costo oportunidad: Q {fmt(claim.amount)}</span>}
                      {claim.status === 'cerrado' && n(claim.sale_loss) > 0 && (
                        <span className="text-red-500">Pérdida venta: Q {fmt(claim.sale_loss)}</span>
                      )}
                      {claim.status === 'cerrado' && n(claim.credit_note_value) > 0 && (
                        <span className="text-sky-600">NC: Q {fmt(claim.credit_note_value)}</span>
                      )}
                      <span>{claim.created_at?.slice(0, 10)}</span>
                    </div>
                    {claim.resolution_notes && (
                      <p className="text-xs text-stone-400 italic">{claim.resolution_notes}</p>
                    )}
                  </div>
                  {claim.status === 'abierto' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setResolvingClaim(claim)}
                        className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] transition whitespace-nowrap"
                      >
                        Resolver →
                      </button>
                      <button
                        onClick={() => setDeleteTarget(claim)}
                        className="rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition whitespace-nowrap"
                      >
                        Anular
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Resumen por cliente */}
        {summary.length > 0 && (
          <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-400">Historial por cliente</h2>
            <div className="divide-y divide-stone-100">
              {summary.map((row, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-stone-800">{row.clientName}</span>
                  <div className="flex gap-4 text-xs text-stone-500">
                    {row.saleLoss > 0 && <span className="text-red-500">Pérd.: Q {fmt(row.saleLoss)}</span>}
                    {row.creditNotes > 0 && <span className="text-sky-600">NC: Q {fmt(row.creditNotes)}</span>}
                    {row.costLoss > 0 && <span className="text-amber-600">Costo MP: Q {fmt(row.costLoss)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showNewModal && (
        <NewClaimModal
          orders={data.orders}
          onClose={() => setShowNewModal(false)}
          onSaved={() => { setShowNewModal(false); loadData() }}
        />
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Anular reclamo?</h3>
            <p className="mt-2 text-sm text-stone-600">
              El reclamo del pedido <strong>#{deleteTarget.orders?.order_number}</strong> pasará a estado anulado.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">Cancelar</button>
              <button onClick={handleDeleteClaim} disabled={deleting} className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">{deleting ? 'Anulando...' : 'Anular'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {resolvingClaim && (
        <ResolveModal
          claim={resolvingClaim}
          orders={data.orders}
          onClose={() => setResolvingClaim(null)}
          onSaved={() => { setResolvingClaim(null); loadData() }}
        />
      )}
    </div>
  )
}
