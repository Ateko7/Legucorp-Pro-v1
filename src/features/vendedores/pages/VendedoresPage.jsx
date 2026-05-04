import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import { getBankAccounts } from '../../contabilidad/services/contabilidadService'
import {
  createSalesperson,
  deleteSalesperson,
  getCommissionPaymentBatches,
  getCommissionSummary,
  getSalespeople,
  paySalesCommissionBatch,
  summarizeCommissionsBySalesperson,
  updateSalesperson,
} from '../services/vendedoresService'

const today = new Date().toISOString().slice(0, 10)
const firstOfMonth = `${today.slice(0, 7)}-01`

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  commission_pct: '4',
  status: 'activo',
}

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}

function BatchPaymentModal({
  salesperson,
  dateFrom,
  dateTo,
  bankAccounts,
  rows,
  onClose,
  onSubmit,
  saving,
}) {
  const [paymentDate, setPaymentDate] = useState(today)
  const [paymentReference, setPaymentReference] = useState('')
  const [selectedBankAccountId, setSelectedBankAccountId] = useState(bankAccounts?.[0]?.id || '')
  const [paymentReceiptFile, setPaymentReceiptFile] = useState(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  if (!salesperson) return null

  const total = rows.reduce((acc, row) => acc + n(row.amount), 0)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit({
        salespersonId: salesperson.salesperson_id,
        dateFrom,
        dateTo,
        paymentDate,
        paymentReference,
        bankAccountId: selectedBankAccountId,
        paymentReceiptFile,
        notes,
      })
    } catch (err) {
      setError(err.message || 'No se pudo pagar el lote de comisiones')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="border-b border-stone-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-stone-900">Pagar comisiones por lote</h3>
          <p className="mt-1 text-sm text-stone-500">
            {salesperson.salesperson_name} · Período {dateFrom} a {dateTo}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs text-stone-500">Comisiones incluidas</div>
              <div className="mt-1 text-xl font-semibold text-stone-900">{rows.length}</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs text-stone-500">Total a pagar</div>
              <div className="mt-1 text-xl font-semibold text-[#2f5d50]">Q {fmt(total)}</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs text-stone-500">Pedidos cobrados</div>
              <div className="mt-1 text-xl font-semibold text-stone-900">{rows.length}</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha de pago">
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
              />
            </Field>

            <Field label="No. de boleta">
              <input
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="Ej. TR-002341"
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
              />
            </Field>

            <Field label="Banco debito">
              <select
                value={selectedBankAccountId}
                onChange={(e) => setSelectedBankAccountId(e.target.value)}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
              >
                <option value="">Seleccionar...</option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank_name} · {account.account_number} · {account.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Cuenta debito">
              <input
                readOnly
                value={bankAccounts.find((account) => account.id === selectedBankAccountId)?.account_number || ''}
                className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-sm text-stone-600 outline-none"
              />
            </Field>
          </div>

          <Field label="Boleta PDF">
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setPaymentReceiptFile(e.target.files?.[0] || null)}
              className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-700"
            />
          </Field>

          <Field label="Notas internas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
            />
          </Field>

          <div className="max-h-52 overflow-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Pedido</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium text-right">Comisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-stone-600">{row.expense_date}</td>
                    <td className="px-4 py-3 text-stone-900">#{row.order_number}</td>
                    <td className="px-4 py-3 text-stone-600">{row.client_name}</td>
                    <td className="px-4 py-3 text-right font-medium text-stone-900">Q {fmt(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-stone-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#2f5d50] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Procesando...' : 'Pagar lote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function VendedoresPage() {
  const [salespeople, setSalespeople] = useState([])
  const [commissions, setCommissions] = useState([])
  const [paymentBatches, setPaymentBatches] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [selectedSalespersonId, setSelectedSalespersonId] = useState('')
  const [batchTarget, setBatchTarget] = useState(null)

  useEffect(() => {
    loadAll()
  }, [dateFrom, dateTo, selectedSalespersonId])

  useRealtimeRefresh(
    ['salespeople', 'expenses', 'sales_commission_payment_batches', 'orders', 'bank_accounts'],
    loadAll
  )

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const filters = {
        dateFrom,
        dateTo,
        salespersonId: selectedSalespersonId || undefined,
      }

      const [spData, commData, batchData, bankData] = await Promise.all([
        getSalespeople(),
        getCommissionSummary(filters),
        getCommissionPaymentBatches(filters),
        getBankAccounts(),
      ])

      setSalespeople(spData)
      setCommissions(commData)
      setPaymentBatches(batchData)
      setBankAccounts(bankData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los vendedores')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  function openEditModal(sp) {
    setForm({
      name: sp.name || '',
      phone: sp.phone || '',
      email: sp.email || '',
      commission_pct: String(Number(sp.commission_pct) * 100),
      status: sp.status || 'activo',
    })
    setEditingId(sp.id)
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setSaving(false)
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        ...form,
        commission_pct: Number(form.commission_pct) / 100,
      }
      if (editingId) {
        await updateSalesperson(editingId, payload)
        setSuccess('Vendedor actualizado correctamente.')
      } else {
        await createSalesperson(payload)
        setSuccess('Vendedor creado correctamente.')
      }
      await loadAll()
      setTimeout(closeModal, 500)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el vendedor')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSalesperson(deleteTarget.id)
      setDeleteTarget(null)
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo desactivar el vendedor')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleBatchPayment(payload) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await paySalesCommissionBatch(payload)
      setBatchTarget(null)
      setSuccess('Lote de comisiones pagado correctamente.')
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo pagar el lote de comisiones')
      throw err
    } finally {
      setSaving(false)
    }
  }

  const commissionsBySalesperson = useMemo(
    () => summarizeCommissionsBySalesperson(commissions),
    [commissions]
  )

  const filteredSalespeople = useMemo(() => {
    if (!selectedSalespersonId) return salespeople
    return salespeople.filter((sp) => sp.id === selectedSalespersonId)
  }, [salespeople, selectedSalespersonId])

  const totals = useMemo(() => {
    return commissions.reduce((acc, row) => {
      acc.generated += n(row.amount)
      if (row.commission_status === 'pagada') {
        acc.paid += n(row.amount)
      } else {
        acc.pending += n(row.amount)
      }
      return acc
    }, { generated: 0, paid: 0, pending: 0 })
  }, [commissions])

  const pendingRowsForTarget = batchTarget?.rows?.filter((row) => row.commission_status !== 'pagada') || []

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">Vendedores</h1>
          <p className="mt-2 text-sm text-stone-500">
            La comisión se genera cuando la CxC del pedido queda cobrada. El pago ahora se puede hacer por lote de período.
          </p>
        </div>
        <button
          onClick={openModal}
          className="rounded-lg bg-[#2f5d50] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#264c42]"
        >
          Nuevo vendedor
        </button>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Desde">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
            />
          </Field>
          <Field label="Vendedor">
            <select
              value={selectedSalespersonId}
              onChange={(e) => setSelectedSalespersonId(e.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
            >
              <option value="">Todos</option>
              {salespeople.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              onClick={loadAll}
              className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Actualizar
            </button>
          </div>
        </div>
      </section>

      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-sm text-stone-500">Vendedores activos</div>
          <div className="mt-2 text-2xl font-semibold text-stone-900">
            {salespeople.filter((sp) => sp.status === 'activo').length}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-sm text-stone-500">Comisión generada</div>
          <div className="mt-2 text-2xl font-semibold text-stone-900">Q {fmt(totals.generated)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-sm text-stone-500">Pendiente por pagar</div>
          <div className="mt-2 text-2xl font-semibold text-amber-700">Q {fmt(totals.pending)}</div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-sm text-stone-500">Pagado en lote</div>
          <div className="mt-2 text-2xl font-semibold text-[#2f5d50]">Q {fmt(totals.paid)}</div>
        </div>
      </div>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="text-base font-semibold text-stone-900">Pendiente por vendedor</h2>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-sm text-stone-500">Cargando comisiones...</div>
        ) : commissionsBySalesperson.length === 0 ? (
          <div className="px-5 py-10 text-sm text-stone-500">No hay comisiones para el período seleccionado.</div>
        ) : (
          <div className="divide-y divide-stone-200">
            {commissionsBySalesperson.map((row) => (
              <div key={row.salesperson_id} className="px-5 py-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="text-base font-medium text-stone-900">{row.salesperson_name}</div>
                    <div className="text-sm text-stone-500">
                      {row.pending_count} pendiente(s) · {row.paid_count} pagada(s) · {row.commission_pct.toFixed(1)}%
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg bg-stone-50 px-4 py-3 text-sm">
                      <div className="text-stone-500">Generado</div>
                      <div className="mt-1 font-semibold text-stone-900">Q {fmt(row.total_generated)}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm">
                      <div className="text-amber-700">Pendiente</div>
                      <div className="mt-1 font-semibold text-amber-800">Q {fmt(row.total_pending)}</div>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        disabled={row.total_pending <= 0}
                        onClick={() => setBatchTarget(row)}
                        className="rounded-lg bg-[#2f5d50] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#264c42] disabled:cursor-not-allowed disabled:bg-stone-300"
                      >
                        Pagar lote
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="text-base font-semibold text-stone-900">Boletas de pago por lote</h2>
        </div>
        {paymentBatches.length === 0 ? (
          <div className="px-5 py-10 text-sm text-stone-500">Todavía no hay pagos de comisión registrados por lote.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-stone-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Fecha</th>
                  <th className="px-5 py-3 font-medium">Vendedor</th>
                  <th className="px-5 py-3 font-medium">Período</th>
                  <th className="px-5 py-3 font-medium">Boleta</th>
                  <th className="px-5 py-3 font-medium">Banco</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                  <th className="px-5 py-3 font-medium">Archivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paymentBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-5 py-3 text-stone-600">{batch.payment_date}</td>
                    <td className="px-5 py-3 text-stone-900">{batch.salespeople?.name || 'Vendedor'}</td>
                    <td className="px-5 py-3 text-stone-600">{batch.period_from} a {batch.period_to}</td>
                    <td className="px-5 py-3 text-stone-900">{batch.payment_reference}</td>
                    <td className="px-5 py-3 text-stone-600">
                      {batch.debit_bank_name || 'Sin banco'} · {batch.debit_account_number || 'Sin cuenta'}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-stone-900">Q {fmt(batch.total_amount)}</td>
                    <td className="px-5 py-3">
                      {batch.receipt_file_url ? (
                        <a
                          href={batch.receipt_file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#2f5d50] hover:underline"
                        >
                          Ver PDF
                        </a>
                      ) : (
                        <span className="text-stone-400">Sin archivo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="text-base font-semibold text-stone-900">Equipo de ventas</h2>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-sm text-stone-500">Cargando vendedores...</div>
        ) : filteredSalespeople.length === 0 ? (
          <div className="px-5 py-10 text-sm text-stone-500">No hay vendedores registrados.</div>
        ) : (
          <div className="divide-y divide-stone-200">
            {filteredSalespeople.map((sp) => {
              const summary = commissionsBySalesperson.find((row) => row.salesperson_id === sp.id)
              return (
                <div key={sp.id} className="px-5 py-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-base font-medium text-stone-900">{sp.name}</div>
                      <div className="mt-1 text-sm text-stone-500">
                        {sp.phone || 'Sin teléfono'} · {sp.email || 'Sin correo'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="rounded-md bg-stone-100 px-2.5 py-1 text-stone-700">
                        {(Number(sp.commission_pct) * 100).toFixed(1)}%
                      </span>
                      <span className={`rounded-md px-2.5 py-1 ${
                        sp.status === 'activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-600'
                      }`}>
                        {sp.status}
                      </span>
                      {summary ? (
                        <span className="text-stone-500">
                          Pendiente Q {fmt(summary.total_pending)} · Pagado Q {fmt(summary.total_paid)}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(sp)}
                        className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setDeleteTarget(sp)}
                        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Desactivar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-900">Desactivar vendedor</h3>
            <p className="mt-2 text-sm text-stone-600">
              {deleteTarget.name} pasara a estado inactivo y no se asignara a nuevos clientes.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Desactivando...' : 'Desactivar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Editar vendedor' : 'Nuevo vendedor'}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre *">
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
              />
            </Field>

            <Field label="Comisión (%)">
              <input
                name="commission_pct"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={form.commission_pct}
                onChange={handleChange}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
              />
            </Field>

            <Field label="Teléfono">
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
              />
            </Field>

            <Field label="Correo">
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
              />
            </Field>
          </div>

          <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            La comisión se calcula sobre el total sin IVA del pedido y se provisiona solo cuando la CxC queda cobrada.
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}
          {success ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-stone-200 pt-5">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#2f5d50] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar vendedor'}
            </button>
          </div>
        </form>
      </Modal>

      {batchTarget ? (
        <BatchPaymentModal
          salesperson={batchTarget}
          dateFrom={dateFrom}
          dateTo={dateTo}
          bankAccounts={bankAccounts}
          rows={pendingRowsForTarget}
          onClose={() => setBatchTarget(null)}
          onSubmit={handleBatchPayment}
          saving={saving}
        />
      ) : null}
    </div>
  )
}
