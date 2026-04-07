import { useCallback, useEffect, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import { getBankAccounts } from '../../contabilidad/services/contabilidadService'
import { getCxCData, markAsCobrado } from '../services/cxcService'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const AGING_STYLE = {
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  orange: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
  rose: 'bg-rose-100 text-rose-700',
}

const STATUS_LABEL = {
  facturado: 'Facturado',
  en_logistica: 'En logística',
  entregado: 'Entregado',
  cobrado: 'Cobrado',
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ children }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div>
}

export default function CxCPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCollected, setShowCollected] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const [saving, setSaving] = useState(false)
  const [collectionReference, setCollectionReference] = useState('')
  const [collectionReceiptFile, setCollectionReceiptFile] = useState(null)
  const [bankAccounts, setBankAccounts] = useState([])
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cxcRows, banks] = await Promise.all([
        getCxCData(showCollected),
        getBankAccounts(),
      ])
      setRows(cxcRows)
      setBankAccounts(banks)
      setSelectedBankAccountId((prev) => prev || banks[0]?.id || '')
    } catch (e) {
      setError(e.message || 'No se pudieron cargar las cuentas por cobrar')
    } finally {
      setLoading(false)
    }
  }, [showCollected])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeRefresh(['orders', 'bank_accounts'], load)

  async function handleCobrar(row) {
    if (row.status !== 'entregado') {
      setError('Solo se pueden cobrar pedidos entregados.')
      return
    }

    const selectedAccount = bankAccounts.find((account) => account.id === selectedBankAccountId)

    setSaving(true)
    try {
      await markAsCobrado(row.id, {
        bankAccountId: selectedAccount?.id || '',
        collectionReference,
        collectionReceiptFile,
      })
      setConfirming(null)
      setCollectionReference('')
      setCollectionReceiptFile(null)
      setSelectedBankAccountId(bankAccounts[0]?.id || '')
      load()
    } catch (e) {
      setError(e.message || 'No se pudo registrar el cobro')
    } finally {
      setSaving(false)
    }
  }

  const pending = rows.filter((row) => row.status !== 'cobrado')
  const totalPendiente = pending.reduce((acc, row) => acc + row.total, 0)
  const totalVencido = pending.filter((row) => row.daysOverdue > 0).reduce((acc, row) => acc + row.total, 0)

  const buckets = {}
  pending.forEach((row) => {
    const key = row.aging.label
    if (!buckets[key]) buckets[key] = { label: key, color: row.aging.color, total: 0, count: 0 }
    buckets[key].total += row.total
    buckets[key].count += 1
  })

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Finanzas</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Cuentas por cobrar</h1>
            <p className="mt-1 text-sm text-stone-500">
              Los cobros usan una cuenta bancaria seleccionable para guardar crédito y boleta.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCollected((prev) => !prev)}
              className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                showCollected
                  ? 'border-[#2f5d50] bg-emerald-50 text-[#2f5d50]'
                  : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {showCollected ? 'Incluye cobrados' : 'Ver cobrados'}
            </button>
            <button onClick={load} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
              Actualizar
            </button>
          </div>
        </div>

        {error ? <Alert>{error}</Alert> : null}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Total por cobrar</p>
            <p className="mt-2 text-3xl font-bold text-white">Q {fmt(totalPendiente)}</p>
            <p className="mt-1 text-xs text-emerald-200">{pending.length} documento{pending.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Vencido</p>
            <p className={`mt-2 text-3xl font-bold ${totalVencido > 0 ? 'text-red-600' : 'text-stone-400'}`}>Q {fmt(totalVencido)}</p>
            <p className="mt-1 text-xs text-stone-400">{pending.filter((row) => row.daysOverdue > 0).length} doc. vencidos</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Al día</p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">Q {fmt(totalPendiente - totalVencido)}</p>
            <p className="mt-1 text-xs text-stone-400">{pending.filter((row) => row.daysOverdue === 0).length} doc. corrientes</p>
          </div>
        </div>

        {Object.keys(buckets).length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {Object.values(buckets).map((bucket) => (
              <div key={bucket.label} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${AGING_STYLE[bucket.color]}`}>
                {bucket.label} · Q {fmt(bucket.total)} ({bucket.count})
              </div>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center">
            <p className="text-stone-400">No hay documentos por cobrar.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${row.status === 'cobrado' ? 'opacity-60' : ''}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-bold text-stone-900">#{row.order_number}</span>
                      <span className="text-sm font-medium text-stone-600">{row.clients?.commercial_name}</span>
                      {row.clients?.nit ? <span className="text-xs text-stone-400">NIT {row.clients.nit}</span> : null}
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${AGING_STYLE[row.aging.color]}`}>
                        {row.aging.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-stone-400">
                      <span>Facturado: {row.created_at?.slice(0, 10)}</span>
                      <span>Vence: <span className={row.daysOverdue > 0 ? 'font-semibold text-red-600' : ''}>{row.dueDate}</span></span>
                      {row.daysOverdue > 0 ? <span className="font-medium text-red-500">{row.daysOverdue} días vencido</span> : null}
                      {row.collection_bank_name ? <span>Banco crédito: {row.collection_bank_name}</span> : null}
                      {row.collection_account_number ? <span>Cuenta crédito: {row.collection_account_number}</span> : null}
                      {row.collection_reference ? <span>Boleta: {row.collection_reference}</span> : null}
                      {row.collection_receipt_file_url ? <a href={row.collection_receipt_file_url} target="_blank" rel="noreferrer" className="text-[#2f5d50] underline-offset-2 hover:underline">Ver boleta</a> : null}
                      <span className="capitalize">{STATUS_LABEL[row.status] || row.status}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-stone-400">Base / IVA / Total</p>
                      <p className="text-sm font-medium text-stone-600">Q {fmt(row.base)} + Q {fmt(row.iva)}</p>
                      <p className="text-lg font-bold text-stone-900">Q {fmt(row.total)}</p>
                    </div>
                    {row.status === 'entregado' ? (
                      <button onClick={() => setConfirming(row)} className="whitespace-nowrap rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42]">
                        Registrar cobro
                      </button>
                    ) : null}
                    {row.status === 'cobrado' ? (
                      <span className="rounded-2xl bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-700">Cobrado</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="font-semibold text-stone-800">Confirmar cobro</h3>
            <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm">
              <div className="flex justify-between"><span className="text-stone-500">Pedido</span><span className="font-medium">#{confirming.order_number}</span></div>
              <div className="mt-2 flex justify-between"><span className="text-stone-500">Cliente</span><span className="font-medium">{confirming.clients?.commercial_name}</span></div>
              <div className="mt-2 flex justify-between font-bold"><span>Total</span><span className="text-[#2f5d50]">Q {fmt(confirming.total)}</span></div>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-stone-700">Número de boleta / documento del cobro</span>
                <input
                  value={collectionReference}
                  onChange={(e) => setCollectionReference(e.target.value)}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-stone-700">Cuenta bancaria de crédito</span>
                <select
                  value={selectedBankAccountId}
                  onChange={(e) => setSelectedBankAccountId(e.target.value)}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
                >
                  <option value="">Seleccionar...</option>
                  {bankAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bank_name} · {account.account_number} · {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-stone-700">Boleta de cobro PDF</span>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setCollectionReceiptFile(e.target.files?.[0] || null)}
                  className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
                />
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setConfirming(null)
                  setCollectionReference('')
                  setCollectionReceiptFile(null)
                }}
                className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleCobrar(confirming)}
                disabled={saving}
                className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50"
              >
                {saving ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
