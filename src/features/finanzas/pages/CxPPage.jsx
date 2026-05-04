import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getCxPData,
  getSupplierPaymentReportData,
  markManyAsPagado,
  markAsPagado,
  registerSupplierInvoice,
} from '../services/cxpService'
import { getBankAccounts } from '../../contabilidad/services/contabilidadService'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const AGING_STYLE = {
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  orange: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
  rose: 'bg-rose-100 text-rose-700',
  stone: 'bg-stone-200 text-stone-700',
}

const STATUS_STYLE = {
  pendiente_factura: 'bg-stone-100 text-stone-700',
  pendiente_pago: 'bg-amber-100 text-amber-800',
  pagado: 'bg-emerald-100 text-emerald-700',
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ children }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div>
}

function fmtMonthLabel(month) {
  const [year, rawMonth] = String(month || '').split('-')
  const date = new Date(Number(year), Number(rawMonth) - 1, 1)
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString('es-GT', { month: 'long', year: 'numeric' })
}

function statusLabel(status) {
  if (status === 'pendiente_factura') return 'Pendiente factura'
  if (status === 'pendiente_pago') return 'Pendiente pago'
  if (status === 'pagado') return 'Pagado'
  return status || 'Pendiente'
}

function InvoiceModal({ row, onClose, onSubmit, saving }) {
  const [invoiceNumber, setInvoiceNumber] = useState(row?.invoice_number || '')
  const [invoiceDate, setInvoiceDate] = useState(row?.invoice_date || new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState(row?.description || '')
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [localError, setLocalError] = useState('')

  if (!row) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setLocalError('')
    try {
      await onSubmit({
        invoiceNumber,
        invoiceDate,
        invoiceFile,
        notes,
      })
    } catch (err) {
      setLocalError(err.message || 'No se pudo registrar la factura')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-stone-800">Registrar factura proveedor</h3>
          <p className="mt-1 text-sm text-stone-500">
            {row.suppliers?.name} · Lote {row.internalLot}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
            Antes de habilitar el pago debes subir la factura y registrar su numero.
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Numero de factura</span>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              placeholder="Ej. FCP-001245"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Fecha factura</span>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Archivo factura</span>
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
            />
            {row.invoice_file_url && !invoiceFile && (
              <a
                href={row.invoice_file_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-sm font-medium text-[#2f5d50] underline-offset-2 hover:underline"
              >
                Ver archivo actual
              </a>
            )}
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Nota interna</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          {localError && <Alert>{localError}</Alert>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar factura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PayModal({ row, bankAccounts, onClose, onSubmit, saving }) {
  const [paymentReference, setPaymentReference] = useState('')
  const [selectedBankAccountId, setSelectedBankAccountId] = useState(bankAccounts?.[0]?.id || '')
  const [paidAmount, setPaidAmount] = useState(String(row?.displayAmount || row?.payable_amount || ''))
  const [paymentReceiptFile, setPaymentReceiptFile] = useState(null)
  const [localError, setLocalError] = useState('')

  if (!row) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setLocalError('')
    try {
      await onSubmit({
        paymentReference,
        bankAccountId: selectedBankAccountId,
        paymentReceiptFile,
        paidAmount: Number(paidAmount || 0),
      })
    } catch (err) {
      setLocalError(err.message || 'No se pudo registrar el pago')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="font-semibold text-stone-800">Registrar pago</h3>

        <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-stone-500">Proveedor</span><span className="font-medium">{row.suppliers?.name}</span></div>
          <div className="mt-2 flex justify-between"><span className="text-stone-500">Factura</span><span className="font-medium">{row.invoice_number}</span></div>
          <div className="mt-2 flex justify-between font-bold"><span>Total a pagar</span><span className="text-[#2f5d50]">Q {fmt(row.displayAmount || row.payable_amount)}</span></div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Monto pagado</span>
            <input
              type="number"
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Numero de documento de pago</span>
            <input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              placeholder="Ej. TR-000145 / CH-9821"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Banco débito</span>
              <select
                value={selectedBankAccountId}
                onChange={(e) => setSelectedBankAccountId(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
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
              <span className="mb-2 block text-sm font-medium text-stone-700">Cuenta débito</span>
              <input
                value={bankAccounts.find((account) => account.id === selectedBankAccountId)?.account_number || ''}
                readOnly
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                placeholder="No. de cuenta"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Boleta de pago PDF</span>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setPaymentReceiptFile(e.target.files?.[0] || null)}
              className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
            />
          </label>

          {localError && <Alert>{localError}</Alert>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Procesando...' : 'Confirmar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BulkPayModal({ rows, bankAccounts, onClose, onSubmit, saving }) {
  const [paymentReference, setPaymentReference] = useState('')
  const [selectedBankAccountId, setSelectedBankAccountId] = useState(bankAccounts?.[0]?.id || '')
  const [paymentReceiptFile, setPaymentReceiptFile] = useState(null)
  const [localError, setLocalError] = useState('')

  if (!rows?.length) return null

  const supplierName = rows[0]?.suppliers?.name || 'Proveedor'
  const total = rows.reduce((acc, row) => acc + n(row.displayAmount || row.payable_amount), 0)

  async function handleSubmit(e) {
    e.preventDefault()
    setLocalError('')
    try {
      await onSubmit({ paymentReference, bankAccountId: selectedBankAccountId, paymentReceiptFile })
    } catch (err) {
      setLocalError(err.message || 'No se pudo registrar el pago multiple')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="font-semibold text-stone-800">Registrar pago multiple</h3>

        <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-stone-500">Proveedor</span><span className="font-medium">{supplierName}</span></div>
          <div className="mt-2 flex justify-between"><span className="text-stone-500">Facturas</span><span className="font-medium">{rows.length}</span></div>
          <div className="mt-2 flex justify-between font-bold"><span>Total</span><span className="text-[#2f5d50]">Q {fmt(total)}</span></div>
        </div>

        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
          <div className="space-y-2 text-sm">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3">
                <span className="text-stone-600">{row.invoice_number} · {row.internalLot}</span>
                <span className="font-medium text-stone-800">Q {fmt(row.displayAmount || row.payable_amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Numero de documento de pago</span>
            <input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              placeholder="Ej. TR-000145 / CH-9821"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Banco débito</span>
              <select
                value={selectedBankAccountId}
                onChange={(e) => setSelectedBankAccountId(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
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
              <span className="mb-2 block text-sm font-medium text-stone-700">Cuenta débito</span>
              <input
                value={bankAccounts.find((account) => account.id === selectedBankAccountId)?.account_number || ''}
                readOnly
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Boleta de pago PDF</span>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setPaymentReceiptFile(e.target.files?.[0] || null)}
              className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
            />
          </label>

          {localError && <Alert>{localError}</Alert>}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Procesando...' : 'Confirmar pago multiple'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CxPPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showPaid, setShowPaid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [invoiceRow, setInvoiceRow] = useState(null)
  const [payRow, setPayRow] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkPayRows, setBulkPayRows] = useState(null)
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7))
  const [paymentReportRows, setPaymentReportRows] = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [bankAccounts, setBankAccounts] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await getCxPData(showPaid))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [showPaid])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    getBankAccounts().then(setBankAccounts).catch((e) => setError(e.message))
  }, [])

  useRealtimeRefresh(['supplier_accounts_payable', 'processed_inventory_lots', 'material_process_stage_outputs'], load)

  const loadPaymentReport = useCallback(async () => {
    setReportLoading(true)
    try {
      setPaymentReportRows(await getSupplierPaymentReportData(reportMonth))
    } catch (e) {
      setError(e.message)
    } finally {
      setReportLoading(false)
    }
  }, [reportMonth])

  useEffect(() => {
    loadPaymentReport()
  }, [loadPaymentReport])

  async function handleSaveInvoice(payload) {
    setSaving(true)
    try {
      await registerSupplierInvoice(invoiceRow.id, payload)
      setInvoiceRow(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handlePagar(payload) {
    setSaving(true)
    try {
      await markAsPagado(payRow.id, payload)
      setPayRow(null)
      await load()
      await loadPaymentReport()
    } finally {
      setSaving(false)
    }
  }

  async function handleBulkPay(payload) {
    setSaving(true)
    try {
      await markManyAsPagado(selectedIds, payload)
      setBulkPayRows(null)
      setSelectedIds([])
      await load()
      await loadPaymentReport()
    } finally {
      setSaving(false)
    }
  }

  function handlePrintMonthlyReport() {
    const monthLabel = fmtMonthLabel(reportMonth)
    const rows = paymentReportRows

    const html = `
      <html>
        <head>
          <title>Reporte mensual CxP ${monthLabel}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
            h1 { margin: 0 0 8px 0; }
            h2 { margin: 28px 0 8px 0; font-size: 18px; }
            p { margin: 4px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; text-align: left; }
            th { background: #f4f4f4; }
            .totals { margin-top: 8px; font-weight: bold; }
            .section { margin-bottom: 28px; page-break-inside: avoid; }
          </style>
        </head>
        <body>
          <h1>Reporte mensual de pagos a proveedores</h1>
          <p>Mes: ${monthLabel}</p>
          <p>Boletas incluidas: ${rows.length}</p>
          ${rows.map((batch) => `
            <div class="section">
              <h2>Boleta ${batch.payment_reference}</h2>
              <p>Proveedor: ${batch.suppliers?.name || 'Proveedor'}</p>
              <p>Fecha: ${batch.payment_date || ''}</p>
              <p>Total boleta: Q ${fmt(batch.total_amount)}</p>
              <p>Banco débito: ${batch.debit_bank_name || ''}</p>
              <p>Cuenta débito: ${batch.debit_account_number || ''}</p>
              <p>PDF boleta: ${batch.receipt_file_url || 'Sin archivo'}</p>
              <table>
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Fecha</th>
                    <th>Lote</th>
                    <th>Total factura</th>
                    <th>Retención</th>
                    <th>Neto pagado</th>
                  </tr>
                </thead>
                <tbody>
                  ${(batch.supplier_accounts_payable || []).map((row) => `
                    <tr>
                      <td>${row.invoice_number || ''}</td>
                      <td>${row.invoice_date || ''}</td>
                      <td>${row.processed_inventory_lot?.internal_lot || '—'}</td>
                      <td>Q ${fmt(row.invoice_total_amount)}</td>
                      <td>Q ${fmt(row.withholding_amount)}</td>
                      <td>Q ${fmt(row.paid_amount || row.net_payable_amount)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
        </body>
      </html>
    `

    const printWindow = window.open('', '_blank', 'width=1000,height=800')
    if (!printWindow) return
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds]
  )

  const selectedSupplierId = selectedRows[0]?.supplier_id || null
  const bulkTotal = selectedRows.reduce((acc, row) => acc + n(row.displayAmount || row.payable_amount), 0)

  function toggleSelect(row) {
    setSelectedIds((prev) => {
      const exists = prev.includes(row.id)
      if (exists) return prev.filter((id) => id !== row.id)
      if (!prev.length) return [row.id]

      const first = rows.find((item) => item.id === prev[0])
      if (first?.supplier_id !== row.supplier_id) {
        setError('Solo puedes seleccionar facturas del mismo proveedor para pago multiple')
        return prev
      }

      return [...prev, row.id]
    })
  }

  const pending = rows.filter((r) => r.status !== 'pagado')
  const totalPendiente = pending.reduce((a, r) => a + n(r.displayAmount || r.payable_amount), 0)
  const totalPendienteFactura = pending
    .filter((r) => r.status === 'pendiente_factura')
    .reduce((a, r) => a + n(r.displayAmount || r.payable_amount), 0)
  const totalListoPago = pending
    .filter((r) => r.status === 'pendiente_pago')
    .reduce((a, r) => a + n(r.displayAmount || r.payable_amount), 0)

  const buckets = {}
  pending.forEach((r) => {
    const k = r.aging.label
    if (!buckets[k]) buckets[k] = { label: k, color: r.aging.color, total: 0, count: 0 }
    buckets[k].total += n(r.displayAmount || r.payable_amount)
    buckets[k].count += 1
  })

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Finanzas</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Cuentas por pagar</h1>
            <p className="mt-1 text-sm text-stone-500">
              Recepcion define el costo, produccion ajusta por merma y la factura habilita el pago al proveedor.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowPaid((p) => !p)}
              className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${showPaid ? 'border-[#2f5d50] bg-emerald-50 text-[#2f5d50]' : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'}`}
            >
              {showPaid ? 'Incluye pagados' : 'Ver pagados'}
            </button>
            <button onClick={load} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
              Actualizar
            </button>
          </div>
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Total por pagar</p>
            <p className="mt-2 text-3xl font-bold text-white">Q {fmt(totalPendiente)}</p>
            <p className="mt-1 text-xs text-emerald-200">{pending.length} registro{pending.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pendiente factura</p>
            <p className="mt-2 text-3xl font-bold text-stone-700">Q {fmt(totalPendienteFactura)}</p>
            <p className="mt-1 text-xs text-stone-400">Sin archivo ni numero de factura</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Listo para pago</p>
            <p className="mt-2 text-3xl font-bold text-emerald-600">Q {fmt(totalListoPago)}</p>
            <p className="mt-1 text-xs text-stone-400">Con factura registrada</p>
          </div>
        </div>

        <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">Reporte mensual de boletas</h2>
              <p className="mt-1 text-sm text-stone-500">
                Agrupa cada boleta de pago con las facturas pagadas por esa misma boleta.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <button
                onClick={handlePrintMonthlyReport}
                disabled={!paymentReportRows.length}
                className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50"
              >
                Generar PDF mensual
              </button>
            </div>
          </div>

          {reportLoading ? (
            <div className="mt-4 text-sm text-stone-500">Cargando boletas del mes...</div>
          ) : !paymentReportRows.length ? (
            <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">
              No hay boletas registradas en {fmtMonthLabel(reportMonth)}.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {paymentReportRows.map((batch) => (
                <div key={batch.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-semibold text-stone-900">
                        Boleta {batch.payment_reference}
                      </div>
                      <div className="text-sm text-stone-500">
                        {batch.suppliers?.name} · {batch.payment_date}
                      </div>
                      <div className="text-xs text-stone-400">
                        {batch.debit_bank_name || 'Sin banco'} · {batch.debit_account_number || 'Sin cuenta'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold text-[#2f5d50]">
                        Q {fmt(batch.total_amount)}
                      </div>
                      {batch.receipt_file_url ? (
                        <a
                          href={batch.receipt_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100"
                        >
                          Ver boleta PDF
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-stone-500">
                        <tr>
                          <th className="py-2 pr-4">Factura</th>
                          <th className="py-2 pr-4">Lote</th>
                          <th className="py-2 pr-4">Total factura</th>
                          <th className="py-2 pr-4">Retención</th>
                          <th className="py-2 pr-4">Neto pagado</th>
                        </tr>
                      </thead>
                      <tbody className="text-stone-700">
                        {(batch.supplier_accounts_payable || []).map((row) => (
                          <tr key={row.id} className="border-t border-stone-200">
                            <td className="py-2 pr-4">{row.invoice_number || '—'}</td>
                            <td className="py-2 pr-4">{row.processed_inventory_lot?.internal_lot || '—'}</td>
                            <td className="py-2 pr-4">Q {fmt(row.invoice_total_amount)}</td>
                            <td className="py-2 pr-4">Q {fmt(row.withholding_amount)}</td>
                            <td className="py-2 pr-4">Q {fmt(row.paid_amount || row.net_payable_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {Object.keys(buckets).length > 0 && (
          <div className="flex flex-wrap gap-3">
            {Object.values(buckets).map((b) => (
              <div key={b.label} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${AGING_STYLE[b.color]}`}>
                {b.label} · Q {fmt(b.total)} ({b.count})
              </div>
            ))}
          </div>
        )}

        {selectedRows.length > 0 && (
          <div className="flex flex-col gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-emerald-900">
              <span className="font-semibold">{selectedRows.length}</span> factura(s) seleccionada(s) del proveedor{' '}
              <span className="font-semibold">{selectedRows[0]?.suppliers?.name}</span> · Total{' '}
              <span className="font-semibold">Q {fmt(bulkTotal)}</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setSelectedIds([])}
                className="rounded-2xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                Limpiar
              </button>
              <button
                onClick={() => setBulkPayRows(selectedRows)}
                className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]"
              >
                Pagar seleccionadas
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center">
            <p className="text-stone-400">No hay CxP de proveedores registradas.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${row.status === 'pagado' ? 'opacity-60' : ''}`}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      {row.canPay ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={() => toggleSelect(row)}
                          disabled={selectedSupplierId && selectedSupplierId !== row.supplier_id}
                          className="h-4 w-4 rounded border-stone-300 text-[#2f5d50]"
                          title="Seleccionar para pago multiple"
                        />
                      ) : null}
                      <span className="font-bold text-stone-900">{row.suppliers?.name}</span>
                      <span className="text-sm text-stone-600">{row.materialName}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[row.status] || STATUS_STYLE.pendiente_factura}`}>
                        {statusLabel(row.status)}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${AGING_STYLE[row.aging.color]}`}>
                        {row.aging.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-4 text-xs text-stone-400">
                      <span>Lote: {row.internalLot}</span>
                      {row.materialCode && <span>Codigo: {row.materialCode}</span>}
                      {row.invoice_number ? <span>Factura: {row.invoice_number}</span> : <span>Factura pendiente</span>}
                      {row.suppliers?.tax_regime ? <span>Regimen: {row.suppliers.tax_regime.replaceAll('_', ' ')}</span> : null}
                      {row.dueDate ? <span>Vence: {row.dueDate}</span> : <span>Aun no genera vencimiento</span>}
                      {row.daysOverdue > 0 && <span className="font-medium text-red-500">{row.daysOverdue} dias vencido</span>}
                    </div>

                    <div className="grid gap-2 text-sm text-stone-600 md:grid-cols-2 xl:grid-cols-4">
                      <div>Costo recepcion: <span className="font-semibold text-stone-800">Q {fmt(row.original_amount)}</span></div>
                      <div>Merma aceptada: <span className="font-semibold text-stone-800">{fmt(row.accepted_supplier_waste_percentage)}%</span></div>
                      <div>Descuento merma: <span className="font-semibold text-stone-800">Q {fmt(row.supplier_discount_amount)}</span></div>
                      <div>Base CXP: <span className="font-semibold text-stone-800">Q {fmt(row.payable_amount)}</span></div>
                      <div>IVA: <span className="font-semibold text-stone-800">Q {fmt(row.invoice_iva_amount)}</span></div>
                      <div>Retencion: <span className="font-semibold text-stone-800">Q {fmt(row.withholding_amount)}</span></div>
                      <div>Total factura: <span className="font-semibold text-stone-800">Q {fmt(row.invoice_total_amount || row.payable_amount)}</span></div>
                      <div>Total a pagar: <span className="font-semibold text-stone-800">Q {fmt(row.displayAmount || row.payable_amount)}</span></div>
                    </div>

                    {row.invoice_file_url ? (
                      <div className="flex flex-wrap gap-3">
                        <a
                          href={row.invoice_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex text-sm font-medium text-[#2f5d50] underline-offset-2 hover:underline"
                        >
                          Ver factura subida
                        </a>
                        {row.payment_batch_id && row.status === 'pagado' ? (
                          <span className="text-sm text-stone-500">
                            Boleta: {row.payment_reference}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-stone-500">Sin factura subida. El pago permanece bloqueado.</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {row.status !== 'pagado' && (
                      <button
                        onClick={() => setInvoiceRow(row)}
                        className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        {row.invoice_number ? 'Actualizar factura' : 'Subir factura'}
                      </button>
                    )}

                    {row.status !== 'pagado' && row.canPay && (
                      <button
                        onClick={() => setPayRow(row)}
                        className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]"
                      >
                        Registrar pago
                      </button>
                    )}

                    {row.status !== 'pagado' && !row.canPay && (
                      <span className="rounded-2xl bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-500">
                        Pago bloqueado
                      </span>
                    )}

                    {row.status === 'pagado' && (
                      <span className="rounded-2xl bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-700">
                        Pagado
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <InvoiceModal
        row={invoiceRow}
        onClose={() => setInvoiceRow(null)}
        onSubmit={handleSaveInvoice}
        saving={saving}
      />

      <PayModal
        row={payRow}
        bankAccounts={bankAccounts}
        onClose={() => setPayRow(null)}
        onSubmit={handlePagar}
        saving={saving}
      />

      <BulkPayModal
        rows={bulkPayRows}
        bankAccounts={bankAccounts}
        onClose={() => setBulkPayRows(null)}
        onSubmit={handleBulkPay}
        saving={saving}
      />
    </div>
  )
}
