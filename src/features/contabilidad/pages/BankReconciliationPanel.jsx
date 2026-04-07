import { useCallback, useEffect, useState } from 'react'
import {
  createBankTransfer,
  getBankAccounts,
  getBankReconciliationData,
  saveBankAccount,
  toggleBankAccountActive,
  toggleBankMovementReconciled,
} from '../services/contabilidadService'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const today = new Date().toISOString().slice(0, 10)
const firstOfMonth = `${today.slice(0, 7)}-01`

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ children }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div>
}

function BankAccountModal({ initialValue, onClose, onSaved, saving }) {
  const [form, setForm] = useState(initialValue || {
    name: '',
    bank_name: '',
    account_number: '',
    currency: 'GTQ',
    opening_balance: 0,
    opening_balance_date: today,
  })
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSaved(form)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la cuenta bancaria')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-stone-900">
          {initialValue?.id ? 'Editar cuenta bancaria' : 'Nueva cuenta bancaria'}
        </h3>
        <p className="mt-1 text-sm text-stone-500">
          Al crearla se generará también una cuenta contable bancaria independiente.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error ? <Alert>{error}</Alert> : null}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Nombre interno</span>
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              placeholder="Ej. Cuenta operativa BAC"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Banco</span>
              <input
                value={form.bank_name}
                onChange={(e) => setForm((prev) => ({ ...prev, bank_name: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
                placeholder="Ej. Banrural"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Número de cuenta</span>
              <input
                value={form.account_number}
                onChange={(e) => setForm((prev) => ({ ...prev, account_number: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
                placeholder="Ej. 1234567890"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Moneda</span>
            <select
              value={form.currency}
              onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            >
              <option value="GTQ">GTQ</option>
              <option value="USD">USD</option>
            </select>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Saldo inicial</span>
              <input
                type="number"
                step="0.01"
                value={form.opening_balance}
                onChange={(e) => setForm((prev) => ({ ...prev, opening_balance: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
                placeholder="Ej. 25000.00"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Fecha saldo inicial</span>
              <input
                type="date"
                value={form.opening_balance_date}
                onChange={(e) => setForm((prev) => ({ ...prev, opening_balance_date: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              />
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar cuenta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BankTransferModal({ accounts, initialFromBankAccountId, onClose, onSaved, saving }) {
  const [form, setForm] = useState({
    transfer_date: today,
    from_bank_account_id: initialFromBankAccountId || accounts[0]?.id || '',
    to_bank_account_id: accounts.find((account) => account.id !== initialFromBankAccountId)?.id || '',
    amount: '',
    reference_number: '',
    notes: '',
  })
  const [receiptFile, setReceiptFile] = useState(null)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSaved({ ...form, receipt_file: receiptFile })
    } catch (err) {
      setError(err.message || 'No se pudo registrar la transferencia')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-stone-900">Registrar transferencia interna</h3>
        <p className="mt-1 text-sm text-stone-500">
          La operación generará un débito en la cuenta origen, un crédito en la cuenta destino y pedirá boleta de depósito PDF.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error ? <Alert>{error}</Alert> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Fecha</span>
              <input
                type="date"
                value={form.transfer_date}
                onChange={(e) => setForm((prev) => ({ ...prev, transfer_date: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Monto</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
                placeholder="Ej. 5000.00"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Cuenta origen</span>
              <select
                value={form.from_bank_account_id}
                onChange={(e) => setForm((prev) => ({ ...prev, from_bank_account_id: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              >
                <option value="">Seleccionar...</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank_name} · {account.account_number} · {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Cuenta destino</span>
              <select
                value={form.to_bank_account_id}
                onChange={(e) => setForm((prev) => ({ ...prev, to_bank_account_id: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              >
                <option value="">Seleccionar...</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank_name} · {account.account_number} · {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Número de boleta / referencia</span>
            <input
              value={form.reference_number}
              onChange={(e) => setForm((prev) => ({ ...prev, reference_number: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              placeholder="Ej. DEP-00921"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Boleta de depósito PDF</span>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
              className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Notas</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              placeholder="Detalle opcional de la transferencia"
            />
          </label>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
              {saving ? 'Guardando...' : 'Registrar transferencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function BankReconciliationPanel() {
  const [accounts, setAccounts] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [showTransfer, setShowTransfer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getBankAccounts(true)
      setAccounts(data)
      setSelectedId((prev) => prev || data[0]?.id || '')
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las cuentas bancarias')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadReport = useCallback(async () => {
    if (!selectedId) {
      setReport(null)
      return
    }

    setLoadingReport(true)
    setError('')
    try {
      setReport(await getBankReconciliationData(selectedId, dateFrom, dateTo))
    } catch (err) {
      setError(err.message || 'No se pudo generar la conciliación')
    } finally {
      setLoadingReport(false)
    }
  }, [selectedId, dateFrom, dateTo])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  async function handleSaveBankAccount(payload) {
    setSaving(true)
    try {
      await saveBankAccount(payload)
      setEditing(null)
      await loadAccounts()
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(account) {
    setError('')
    try {
      await toggleBankAccountActive(account.id, !account.is_active)
      await loadAccounts()
      await loadReport()
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la cuenta bancaria')
    }
  }

  async function handleToggleMovement(movement) {
    setError('')
    try {
      await toggleBankMovementReconciled(movement.id, !movement.reconciled)
      await loadReport()
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la conciliación')
    }
  }

  async function handleSaveTransfer(payload) {
    setSaving(true)
    try {
      await createBankTransfer(payload)
      setShowTransfer(false)
      await loadReport()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {error ? <Alert>{error}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Cuentas bancarias</p>
                <h3 className="mt-1 text-lg font-semibold text-stone-900">Bancos y cuentas</h3>
              </div>
              <button
                onClick={() => setEditing({ name: '', bank_name: '', account_number: '', currency: 'GTQ', opening_balance: 0, opening_balance_date: today })}
                className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]"
              >
                + Nueva
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : accounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-400">
                  Aún no hay cuentas bancarias registradas.
                </div>
              ) : (
                accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => setSelectedId(account.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedId === account.id
                        ? 'border-[#2f5d50] bg-emerald-50'
                        : 'border-stone-200 bg-stone-50 hover:bg-white'
                    } ${!account.is_active ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-stone-800">{account.name}</p>
                        <p className="text-sm text-stone-500">{account.bank_name} · {account.account_number}</p>
                        <p className="mt-1 text-xs text-stone-400">
                          Cuenta contable {account.accounting_accounts?.code} · {account.currency}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">
                          Saldo inicial Q {fmt(account.opening_balance)} desde {account.opening_balance_date}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditing(account)
                          }}
                          className="rounded-xl border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:bg-white"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggle(account)
                          }}
                          className="rounded-xl border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:bg-white"
                        >
                          {account.is_active ? 'Inactivar' : 'Activar'}
                        </button>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-400">Desde</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-400">Hasta</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
                />
              </label>

              <button
                onClick={loadReport}
                className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]"
              >
                Actualizar conciliación
              </button>
              <button
                onClick={() => setShowTransfer(true)}
                className="rounded-2xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
              >
                Registrar transferencia
              </button>
            </div>
          </div>

          {loadingReport ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : !report?.bankAccount ? (
            <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center text-stone-400">
              Selecciona o crea una cuenta bancaria para ver su conciliación.
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Saldo inicial</p>
                  <p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(report.totals.openingBalance)}</p>
                </div>
                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Débitos</p>
                  <p className="mt-2 text-2xl font-bold text-red-600">Q {fmt(report.totals.debit)}</p>
                </div>
                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Créditos</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-600">Q {fmt(report.totals.credit)}</p>
                </div>
                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Débitos pendientes</p>
                  <p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(report.totals.pendingDebit)}</p>
                </div>
                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Créditos pendientes</p>
                  <p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(report.totals.pendingCredit)}</p>
                </div>
                <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Saldo final</p>
                  <p className="mt-2 text-2xl font-bold text-white">Q {fmt(report.totals.closingBalance)}</p>
                </div>
              </div>

              <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Cuenta seleccionada</p>
                  <h3 className="mt-1 text-lg font-semibold text-stone-900">
                    {report.bankAccount.name} · {report.bankAccount.bank_name} · {report.bankAccount.account_number}
                  </h3>
                  <p className="text-sm text-stone-500">
                    Cuenta contable {report.bankAccount.accounting_accounts?.code} · {report.bankAccount.accounting_accounts?.name}
                  </p>
                  <p className="text-sm text-stone-500">
                    Saldo inicial Q {fmt(report.bankAccount.opening_balance)} desde {report.bankAccount.opening_balance_date}
                  </p>
                </div>

                {report.movements.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-stone-300 py-10 text-center text-sm text-stone-400">
                    No hay movimientos para esta cuenta en el período.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[960px] text-sm">
                      <thead>
                        <tr className="border-b border-stone-100 bg-stone-50">
                          {['Fecha', 'Origen', 'Documento', 'Descripción', 'Débito', 'Crédito', 'Boleta', 'Conciliado'].map((label) => (
                            <th key={label} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {report.movements.map((movement) => (
                          <tr key={movement.id} className="hover:bg-stone-50">
                            <td className="px-4 py-3 text-stone-500">{movement.movement_date}</td>
                            <td className="px-4 py-3 font-medium text-stone-700">{movement.source_label}</td>
                            <td className="px-4 py-3 text-stone-700">{movement.document_number || 'Sin documento'}</td>
                            <td className="px-4 py-3 text-stone-600">{movement.description || 'Sin descripción'}</td>
                            <td className="px-4 py-3 text-right font-semibold text-red-600">
                              {movement.debit_amount ? `Q ${fmt(movement.debit_amount)}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                              {movement.credit_amount ? `Q ${fmt(movement.credit_amount)}` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {movement.receipt_file_url ? (
                                <a
                                  href={movement.receipt_file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm font-medium text-[#2f5d50] underline-offset-2 hover:underline"
                                >
                                  Ver PDF
                                </a>
                              ) : (
                                <span className="text-xs text-stone-400">Sin PDF</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => handleToggleMovement(movement)}
                                className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${
                                  movement.reconciled
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {movement.reconciled ? 'Conciliado' : 'Pendiente'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <BankAccountModal
          initialValue={editing?.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={handleSaveBankAccount}
          saving={saving}
        />
      ) : null}

      {showTransfer ? (
        <BankTransferModal
          accounts={accounts.filter((account) => account.is_active)}
          initialFromBankAccountId={selectedId}
          onClose={() => setShowTransfer(false)}
          onSaved={handleSaveTransfer}
          saving={saving}
        />
      ) : null}
    </div>
  )
}
