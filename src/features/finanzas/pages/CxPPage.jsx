import { useEffect, useState, useCallback } from 'react'
import { getCxPData, markAsPagado } from '../services/cxpService'

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const AGING_STYLE = {
  emerald: 'bg-emerald-100 text-emerald-700',
  amber:   'bg-amber-100  text-amber-700',
  orange:  'bg-orange-100 text-orange-700',
  red:     'bg-red-100    text-red-700',
  rose:    'bg-rose-100   text-rose-700',
}

function Spinner() { return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" /> }
function Alert({ children }) { return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div> }

export default function CxPPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showPaid, setShowPaid] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await getCxPData(showPaid)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [showPaid])

  useEffect(() => { load() }, [load])

  async function handlePagar(row) {
    setSaving(true)
    try { await markAsPagado(row.id); setConfirming(null); load() }
    catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const pending = rows.filter(r => r.payment_status !== 'pagado')
  const totalPendiente = pending.reduce((a, r) => a + r.total, 0)
  const totalVencido   = pending.filter(r => r.daysOverdue > 0).reduce((a, r) => a + r.total, 0)

  const buckets = {}
  pending.forEach(r => {
    const k = r.aging.label
    if (!buckets[k]) buckets[k] = { label: k, color: r.aging.color, total: 0, count: 0 }
    buckets[k].total += r.total; buckets[k].count++
  })

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-6">

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Finanzas</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Cuentas por Pagar</h1>
            <p className="mt-1 text-sm text-stone-500">Seguimiento de pagos pendientes a proveedores.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowPaid(p => !p)}
              className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${showPaid ? 'border-[#2f5d50] bg-emerald-50 text-[#2f5d50]' : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'}`}>
              {showPaid ? '✓ Incluye pagados' : 'Ver pagados'}
            </button>
            <button onClick={load} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
              Actualizar
            </button>
          </div>
        </div>

        {error && <Alert>{error}</Alert>}

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Total por pagar</p>
            <p className="mt-2 text-3xl font-bold text-white">Q {fmt(totalPendiente)}</p>
            <p className="mt-1 text-xs text-emerald-200">{pending.length} orden{pending.length !== 1 ? 'es' : ''}</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Vencido</p>
            <p className={`mt-2 text-3xl font-bold ${totalVencido > 0 ? 'text-red-600' : 'text-stone-400'}`}>Q {fmt(totalVencido)}</p>
            <p className="mt-1 text-xs text-stone-400">{pending.filter(r => r.daysOverdue > 0).length} OC vencidas</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Al día</p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">Q {fmt(totalPendiente - totalVencido)}</p>
            <p className="mt-1 text-xs text-stone-400">{pending.filter(r => r.daysOverdue === 0).length} OC corrientes</p>
          </div>
        </div>

        {/* Aging buckets */}
        {Object.keys(buckets).length > 0 && (
          <div className="flex gap-3 flex-wrap">
            {Object.values(buckets).map(b => (
              <div key={b.label} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${AGING_STYLE[b.color]}`}>
                {b.label} · Q {fmt(b.total)} ({b.count})
              </div>
            ))}
          </div>
        )}

        {/* Tabla */}
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center">
            <p className="text-stone-400">No hay órdenes de compra pendientes de pago.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(row => (
              <div key={row.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${row.payment_status === 'pagado' ? 'opacity-60' : ''}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold text-stone-900">OC #{row.order_number}</span>
                      <span className="text-sm font-medium text-stone-600">{row.suppliers?.name}</span>
                      {row.suppliers?.nit && <span className="text-xs text-stone-400">NIT {row.suppliers.nit}</span>}
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${AGING_STYLE[row.aging.color]}`}>
                        {row.aging.label}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs text-stone-400 flex-wrap">
                      <span>Emitida: {row.created_at?.slice(0, 10)}</span>
                      <span>Vence: <span className={row.daysOverdue > 0 ? 'text-red-600 font-semibold' : ''}>{row.dueDate}</span></span>
                      {row.daysOverdue > 0 && <span className="text-red-500 font-medium">{row.daysOverdue} días vencido</span>}
                      <span>{row.suppliers?.payment_days || 30} días crédito</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-stone-400">Total OC</p>
                      <p className="text-lg font-bold text-stone-900">Q {fmt(row.total)}</p>
                    </div>
                    {row.payment_status !== 'pagado' && (
                      <button onClick={() => setConfirming(row)}
                        className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] transition whitespace-nowrap">
                        Registrar pago
                      </button>
                    )}
                    {row.payment_status === 'pagado' && (
                      <span className="rounded-2xl bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-700">✓ Pagado</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl p-6 space-y-4">
            <h3 className="font-semibold text-stone-800">Confirmar pago</h3>
            <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-stone-500">OC</span><span className="font-medium">#{confirming.order_number}</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Proveedor</span><span className="font-medium">{confirming.suppliers?.name}</span></div>
              <div className="flex justify-between font-bold"><span>Total</span><span className="text-[#2f5d50]">Q {fmt(confirming.total)}</span></div>
            </div>
            <p className="text-xs text-stone-400">Se generará el asiento contable: DR CxP / CR Banco</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(null)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
              <button onClick={() => handlePagar(confirming)} disabled={saving}
                className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
                {saving ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
