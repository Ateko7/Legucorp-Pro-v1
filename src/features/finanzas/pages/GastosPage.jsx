import { useCallback, useEffect, useState } from 'react'
import { getBankAccounts, getCostCenters } from '../../contabilidad/services/contabilidadService'
import {
  createGasto,
  deleteGasto,
  getGastos,
  getGastosSummary,
  markExpenseAsPagado,
  registerExpenseInvoice,
} from '../services/gastosService'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const today = new Date().toISOString().slice(0, 10)
const firstOfMonth = `${today.slice(0, 7)}-01`

const EXPENSE_TYPE_LABEL = {
  administrativo: 'Administrativo',
  produccion: 'Producción',
  logistica: 'Logística',
  comercial: 'Comercial',
}

const STATUS_LABEL = {
  pendiente_factura: 'Pendiente factura',
  pendiente_pago: 'Pendiente pago',
  pagado: 'Pagado',
}

const STATUS_STYLE = {
  pendiente_factura: 'bg-stone-100 text-stone-700',
  pendiente_pago: 'bg-amber-100 text-amber-800',
  pagado: 'bg-emerald-100 text-emerald-700',
}

const EXPENSE_TYPE_COLOR = {
  administrativo: 'bg-blue-100 text-blue-700',
  produccion: 'bg-emerald-100 text-emerald-700',
  logistica: 'bg-orange-100 text-orange-700',
  comercial: 'bg-purple-100 text-purple-700',
}

const CC_DEFAULT_TYPE = {
  'CC-01': 'produccion',
  'CC-02': 'comercial',
  'CC-03': 'logistica',
  'CC-04': 'administrativo',
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ type = 'error', children }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[type]}`}>{children}</div>
}

function NuevoGastoModal({ centers, onClose, onSaved }) {
  const [form, setForm] = useState({
    fecha: today,
    descripcion: '',
    monto: '',
    cost_center_id: '',
    expense_type: 'administrativo',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleCC(id) {
    const cc = centers.find((center) => center.id === id)
    const tipo = cc ? (CC_DEFAULT_TYPE[cc.code] || 'administrativo') : 'administrativo'
    setForm((prev) => ({ ...prev, cost_center_id: id, expense_type: tipo }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await createGasto(form)
      onSaved()
    } catch (err) {
      setError(err.message || 'No se pudo crear el gasto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <h3 className="font-semibold text-stone-800">Registrar gasto</h3>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && <Alert>{error}</Alert>}

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
            El gasto inicia en estado pendiente de factura. No se puede pagar sin adjuntar factura y luego boleta de pago.
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">Fecha *</span>
              <input
                type="date"
                required
                value={form.fecha}
                onChange={(e) => setForm((prev) => ({ ...prev, fecha: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">Monto (Q) *</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={form.monto}
                onChange={(e) => setForm((prev) => ({ ...prev, monto: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Descripción *</span>
            <input
              required
              value={form.descripcion}
              onChange={(e) => setForm((prev) => ({ ...prev, descripcion: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Centro de costo *</span>
            <select
              required
              value={form.cost_center_id}
              onChange={(e) => handleCC(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            >
              <option value="">Seleccionar…</option>
              {centers.map((center) => (
                <option key={center.id} value={center.id}>
                  {center.code} — {center.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Tipo de gasto</span>
            <select
              value={form.expense_type}
              onChange={(e) => setForm((prev) => ({ ...prev, expense_type: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            >
              {Object.entries(EXPENSE_TYPE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando…' : 'Registrar gasto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExpenseInvoiceModal({ expense, onClose, onSubmit, saving }) {
  const [invoiceNumber, setInvoiceNumber] = useState(expense?.invoice_number || '')
  const [invoiceDate, setInvoiceDate] = useState(expense?.invoice_date || today)
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [error, setError] = useState('')

  if (!expense) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit({ invoiceNumber, invoiceDate, invoiceFile })
    } catch (err) {
      setError(err.message || 'No se pudo registrar la factura')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-stone-800">Registrar factura del gasto</h3>
        <p className="mt-1 text-sm text-stone-500">{expense.description}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && <Alert>{error}</Alert>}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Número de factura</span>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none focus:border-[#2f5d50]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Fecha factura</span>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none focus:border-[#2f5d50]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Factura PDF</span>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
              className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
            />
          </label>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar factura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ExpensePayModal({ expense, bankAccounts, onClose, onSubmit, saving }) {
  const [paymentReference, setPaymentReference] = useState('')
  const [selectedBankAccountId, setSelectedBankAccountId] = useState(bankAccounts?.[0]?.id || '')
  const [paymentReceiptFile, setPaymentReceiptFile] = useState(null)
  const [error, setError] = useState('')

  if (!expense) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit({
        paymentReference,
        bankAccountId: selectedBankAccountId,
        paymentReceiptFile,
      })
    } catch (err) {
      setError(err.message || 'No se pudo registrar el pago')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-stone-800">Registrar pago del gasto</h3>
        <p className="mt-1 text-sm text-stone-500">{expense.description}</p>

        <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">Factura</span>
            <span className="font-medium">{expense.invoice_number}</span>
          </div>
          <div className="mt-2 flex justify-between font-bold">
            <span>Total</span>
            <span className="text-[#2f5d50]">Q {fmt(expense.amount)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && <Alert>{error}</Alert>}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Número de boleta</span>
            <input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none focus:border-[#2f5d50]"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Banco débito</span>
              <select
                value={selectedBankAccountId}
                onChange={(e) => setSelectedBankAccountId(e.target.value)}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none focus:border-[#2f5d50]"
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
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none focus:border-[#2f5d50]"
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

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Procesando…' : 'Confirmar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ gasto, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteGasto(gasto.id)
      onDeleted()
    } catch (err) {
      setError(err.message || 'No se pudo eliminar el gasto')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="font-semibold text-stone-800">Eliminar gasto</h3>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-500">Descripción</span>
            <span className="font-medium text-stone-800">{gasto.description}</span>
          </div>
          <div className="mt-2 flex justify-between">
            <span className="text-stone-500">Monto</span>
            <span className="font-bold text-stone-900">Q {fmt(gasto.amount)}</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-400">El asiento contable asociado se conserva por integridad.</p>
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button onClick={handleDelete} disabled={deleting} className="flex-1 rounded-2xl bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GastosPage() {
  const [gastos, setGastos] = useState([])
  const [summary, setSummary] = useState([])
  const [centers, setCenters] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [showModal, setShowModal] = useState(false)
  const [invoiceExpense, setInvoiceExpense] = useState(null)
  const [payExpense, setPayExpense] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [gastosData, summaryData, costCenters, banks] = await Promise.all([
        getGastos(dateFrom, dateTo),
        getGastosSummary(dateFrom, dateTo),
        getCostCenters(),
        getBankAccounts(),
      ])
      setGastos(gastosData)
      setSummary(summaryData)
      setCenters(costCenters)
      setBankAccounts(banks)
    } catch (e) {
      setError(e.message || 'No se pudieron cargar los gastos')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeRefresh(['expenses', 'cost_centers', 'supplier_accounts_payable'], load)

  async function handleSaveInvoice(payload) {
    setSaving(true)
    try {
      await registerExpenseInvoice(invoiceExpense.id, payload)
      setInvoiceExpense(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handlePayExpense(payload) {
    setSaving(true)
    try {
      await markExpenseAsPagado(payExpense.id, payload)
      setPayExpense(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const totalGastos = gastos.reduce((acc, gasto) => acc + n(gasto.amount), 0)
  const totalPendienteFactura = gastos
    .filter((gasto) => gasto.status === 'pendiente_factura')
    .reduce((acc, gasto) => acc + n(gasto.amount), 0)
  const totalPendientePago = gastos
    .filter((gasto) => gasto.status === 'pendiente_pago')
    .reduce((acc, gasto) => acc + n(gasto.amount), 0)
  const maxCC = summary.length > 0 ? Math.max(...summary.map((center) => center.total)) : 1

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Finanzas</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Gastos</h1>
            <p className="mt-1 text-sm text-stone-500">
              Los gastos siguen la misma lógica documental que CxP: factura primero, pago después con boleta PDF.
            </p>
          </div>
          <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
            + Registrar gasto
          </button>
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500">Desde</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500">Hasta</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
            Consultar
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Total de gastos</p>
            <p className="mt-2 text-3xl font-bold text-white">Q {fmt(totalGastos)}</p>
            <p className="mt-1 text-xs text-emerald-200">{gastos.length} registro{gastos.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pendiente factura</p>
            <p className="mt-2 text-3xl font-bold text-stone-700">Q {fmt(totalPendienteFactura)}</p>
            <p className="mt-1 text-xs text-stone-400">Sin factura adjunta</p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pendiente pago</p>
            <p className="mt-2 text-3xl font-bold text-amber-600">Q {fmt(totalPendientePago)}</p>
            <p className="mt-1 text-xs text-stone-400">Con factura, sin boleta</p>
          </div>
        </div>

        {summary.length > 0 && (
          <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Distribución por centro de costo</h3>
            {summary.map((center) => (
              <div key={center.code} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-stone-700">{center.code} — {center.name}</span>
                  <span className="font-bold text-stone-900">Q {fmt(center.total)}</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-stone-100">
                  <div className="h-2.5 rounded-full bg-[#2f5d50]" style={{ width: `${maxCC > 0 ? (center.total / maxCC) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : gastos.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center">
            <p className="text-stone-400">No hay gastos registrados en el período.</p>
            <button onClick={() => setShowModal(true)} className="mt-3 rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
              + Registrar primer gasto
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {gastos.map((gasto) => (
              <div key={gasto.id} className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-stone-900">{gasto.description}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${EXPENSE_TYPE_COLOR[gasto.expense_type]}`}>
                        {EXPENSE_TYPE_LABEL[gasto.expense_type]}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[gasto.status] || STATUS_STYLE.pendiente_factura}`}>
                        {STATUS_LABEL[gasto.status] || 'Pendiente'}
                      </span>
                      {gasto.supplier_accounts_payable_id ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          Desde CxP proveedor
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-4 text-xs text-stone-400">
                      <span>{gasto.expense_date}</span>
                      {gasto.cost_centers ? <span>{gasto.cost_centers.code} · {gasto.cost_centers.name}</span> : null}
                      {gasto.suppliers?.name ? <span>Proveedor: {gasto.suppliers.name}</span> : null}
                      {gasto.invoice_number ? <span>Factura: {gasto.invoice_number}</span> : <span>Factura pendiente</span>}
                      {gasto.payment_reference ? <span>Boleta: {gasto.payment_reference}</span> : null}
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm">
                      {gasto.invoice_file_url ? (
                        <a href={gasto.invoice_file_url} target="_blank" rel="noreferrer" className="text-[#2f5d50] underline-offset-2 hover:underline">
                          Ver factura
                        </a>
                      ) : null}
                      {gasto.payment_receipt_file_url ? (
                        <a href={gasto.payment_receipt_file_url} target="_blank" rel="noreferrer" className="text-[#2f5d50] underline-offset-2 hover:underline">
                          Ver boleta
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <p className="text-xl font-bold text-stone-900">Q {fmt(gasto.amount)}</p>
                    {!gasto.supplier_accounts_payable_id && gasto.status === 'pendiente_factura' ? (
                      <button onClick={() => setInvoiceExpense(gasto)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                        Subir factura
                      </button>
                    ) : null}
                    {!gasto.supplier_accounts_payable_id && gasto.status === 'pendiente_pago' ? (
                      <button onClick={() => setPayExpense(gasto)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">
                        Registrar pago
                      </button>
                    ) : null}
                    {!gasto.supplier_accounts_payable_id ? (
                      <button onClick={() => setDeleting(gasto)} className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                        Eliminar
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal ? (
        <NuevoGastoModal
          centers={centers}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            load()
          }}
        />
      ) : null}

      <ExpenseInvoiceModal
        expense={invoiceExpense}
        onClose={() => setInvoiceExpense(null)}
        onSubmit={handleSaveInvoice}
        saving={saving}
      />

      <ExpensePayModal
        expense={payExpense}
        bankAccounts={bankAccounts}
        onClose={() => setPayExpense(null)}
        onSubmit={handlePayExpense}
        saving={saving}
      />

      {deleting ? (
        <DeleteConfirmModal
          gasto={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            load()
          }}
        />
      ) : null}
    </div>
  )
}
