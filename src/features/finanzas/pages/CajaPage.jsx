import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  createCashBoxDisbursement,
  createCashBoxFunding,
  getCajaModuleData,
  liquidateCashBoxMovements,
  saveCashBox,
  toggleCashBoxActive,
} from '../services/cajaService'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function fmt(value) {
  return n(value).toLocaleString('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const today = new Date().toISOString().slice(0, 10)

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ children }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div>
}

function boxTypeLabel(type) {
  if (type === 'mercado') return 'Caja de mercado'
  if (type === 'caja_chica') return 'Caja chica'
  return type || 'Caja'
}

function movementLabel(type) {
  if (type === 'fondeo') return 'Fondeo'
  if (type === 'compra_mp') return 'Compra MP'
  if (type === 'gasto') return 'Gasto'
  return type
}

function statusLabel(status) {
  if (status === 'registrado') return 'Registrado'
  if (status === 'pendiente_liquidacion') return 'Pendiente liquidación'
  if (status === 'liquidado') return 'Liquidado'
  return status
}

function statusStyle(status) {
  if (status === 'liquidado') return 'bg-emerald-100 text-emerald-700'
  if (status === 'pendiente_liquidacion') return 'bg-amber-100 text-amber-800'
  return 'bg-stone-100 text-stone-700'
}

function BoxModal({ initialValue, onClose, onSubmit, saving }) {
  const [form, setForm] = useState(initialValue || {
    name: '',
    box_type: 'mercado',
    description: '',
  })
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la caja')
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initialValue?.id ? 'Editar caja' : 'Nueva caja'}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Nombre</span>
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            placeholder="Ej. Caja de mercado central"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Tipo de caja</span>
          <select
            value={form.box_type}
            onChange={(e) => setForm((prev) => ({ ...prev, box_type: e.target.value }))}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
          >
            <option value="mercado">Caja de mercado</option>
            <option value="caja_chica">Caja chica</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Descripción</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            placeholder="Uso operativo de la caja"
          />
        </label>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar caja'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FundingModal({ box, bankAccounts, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({
    movement_date: today,
    amount: '',
    bank_account_id: bankAccounts[0]?.id || '',
    reference_number: '',
    description: '',
  })
  const [supportFile, setSupportFile] = useState(null)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit({
        ...form,
        cash_box_id: box.id,
        support_file: supportFile,
      })
    } catch (err) {
      setError(err.message || 'No se pudo registrar el fondeo')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Fondear ${box.name}`} maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Este movimiento aumenta el saldo de la caja y genera un débito en la cuenta bancaria elegida.
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Fecha</span>
            <input
              type="date"
              value={form.movement_date}
              onChange={(e) => setForm((prev) => ({ ...prev, movement_date: e.target.value }))}
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
              placeholder="Ej. 2500.00"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Cuenta bancaria de débito</span>
          <select
            value={form.bank_account_id}
            onChange={(e) => setForm((prev) => ({ ...prev, bank_account_id: e.target.value }))}
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
          <span className="mb-2 block text-sm font-medium text-stone-700">Referencia / boleta débito</span>
          <input
            value={form.reference_number}
            onChange={(e) => setForm((prev) => ({ ...prev, reference_number: e.target.value }))}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            placeholder="Ej. TARJ-00125"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Comprobante PDF o imagen</span>
          <input
            type="file"
            accept=".pdf,image/*"
            onChange={(e) => setSupportFile(e.target.files?.[0] || null)}
            className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Nota</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            placeholder="Detalle opcional del fondeo"
          />
        </label>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando...' : 'Registrar fondeo'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DisbursementModal({ box, suppliers, materials, costCenters, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({
    movement_date: today,
    movement_type: 'compra_mp',
    supplier_id: '',
    material_id: '',
    quantity: '',
    unit_cost: '',
    amount: '',
    cost_center_id: '',
    expense_type: 'produccion',
    reference_number: '',
    description: '',
  })
  const [supportFile, setSupportFile] = useState(null)
  const [error, setError] = useState('')

  const isMp = form.movement_type === 'compra_mp'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit({
        ...form,
        cash_box_id: box.id,
        support_file: supportFile,
      })
    } catch (err) {
      setError(err.message || 'No se pudo registrar la salida')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Registrar salida · ${box.name}`} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Fecha</span>
            <input
              type="date"
              value={form.movement_date}
              onChange={(e) => setForm((prev) => ({ ...prev, movement_date: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Tipo de salida</span>
            <select
              value={form.movement_type}
              onChange={(e) => setForm((prev) => ({ ...prev, movement_type: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            >
              <option value="compra_mp">Compra de materia prima</option>
              <option value="gasto">Gasto sin factura</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Proveedor</span>
            <select
              value={form.supplier_id}
              onChange={(e) => setForm((prev) => ({ ...prev, supplier_id: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            >
              <option value="">Sin proveedor específico</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Referencia / soporte</span>
            <input
              value={form.reference_number}
              onChange={(e) => setForm((prev) => ({ ...prev, reference_number: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              placeholder="Ej. Vale, ticket, nota"
            />
          </label>
        </div>

        {isMp ? (
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block md:col-span-3">
              <span className="mb-2 block text-sm font-medium text-stone-700">Materia prima</span>
              <select
                value={form.material_id}
                onChange={(e) => setForm((prev) => ({ ...prev, material_id: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              >
                <option value="">Seleccionar...</option>
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.code} · {material.common_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Cantidad</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.quantity}
                onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Costo unitario</span>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={form.unit_cost}
                onChange={(e) => setForm((prev) => ({ ...prev, unit_cost: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Monto total</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
                placeholder="Se calcula si llenas cantidad y costo"
              />
            </label>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Centro de costo</span>
              <select
                value={form.cost_center_id}
                onChange={(e) => setForm((prev) => ({ ...prev, cost_center_id: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              >
                <option value="">Seleccionar...</option>
                {costCenters.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.code} · {center.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Tipo de gasto</span>
              <select
                value={form.expense_type}
                onChange={(e) => setForm((prev) => ({ ...prev, expense_type: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              >
                <option value="produccion">Producción</option>
                <option value="logistica">Logística</option>
                <option value="comercial">Comercial</option>
                <option value="administrativo">Administrativo</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-stone-700">Monto total</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              />
            </label>
          </div>
        )}

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Descripción</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            placeholder={isMp ? 'Detalle de la compra o del lote' : 'Detalle del gasto menor'}
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Soporte PDF o imagen</span>
          <input
            type="file"
            accept=".pdf,image/*"
            onChange={(e) => setSupportFile(e.target.files?.[0] || null)}
            className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"
          />
        </label>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando...' : 'Registrar salida'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function LiquidationModal({ box, movements, onClose, onSubmit, saving }) {
  const [selectedIds, setSelectedIds] = useState(movements.map((movement) => movement.id))
  const [form, setForm] = useState({
    invoice_number: '',
    invoice_date: today,
    notes: '',
  })
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [error, setError] = useState('')

  const selectedMovements = movements.filter((movement) => selectedIds.includes(movement.id))
  const total = selectedMovements.reduce((acc, movement) => acc + n(movement.amount), 0)

  function toggle(id) {
    setSelectedIds((prev) => (
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    ))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSubmit({
        cash_box_id: box.id,
        movement_ids: selectedIds,
        ...form,
        invoice_file: invoiceFile,
      })
    } catch (err) {
      setError(err.message || 'No se pudo liquidar la caja')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Liquidar ${box.name}`} maxWidth="max-w-4xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}

        <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Selecciona los movimientos pendientes que quedarán soportados por una misma factura grupal.
        </div>

        <div className="overflow-x-auto rounded-2xl border border-stone-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Sel.</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Detalle</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(movement.id)}
                      onChange={() => toggle(movement.id)}
                      className="h-4 w-4 rounded border-stone-300 text-[#2f5d50]"
                    />
                  </td>
                  <td className="px-4 py-3 text-stone-500">{movement.movement_date}</td>
                  <td className="px-4 py-3 text-stone-700">{movementLabel(movement.movement_type)}</td>
                  <td className="px-4 py-3 text-stone-700">{movement.summary}</td>
                  <td className="px-4 py-3 text-right font-semibold text-stone-900">Q {fmt(movement.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-stone-50">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Total seleccionado</td>
                <td className="px-4 py-3 text-right font-bold text-[#2f5d50]">Q {fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Número de factura grupal</span>
            <input
              value={form.invoice_number}
              onChange={(e) => setForm((prev) => ({ ...prev, invoice_number: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
              placeholder="Ej. FAC-GRP-0012"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Fecha factura</span>
            <input
              type="date"
              value={form.invoice_date}
              onChange={(e) => setForm((prev) => ({ ...prev, invoice_date: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Factura grupal PDF</span>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
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
            placeholder="Observaciones del cuadrado o de la factura grupal"
          />
        </label>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Liquidando...' : 'Liquidar movimientos'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function CajaPage() {
  const [moduleData, setModuleData] = useState({
    boxes: [],
    movements: [],
    liquidations: [],
    bankAccounts: [],
    suppliers: [],
    materials: [],
    costCenters: [],
  })
  const [selectedBoxId, setSelectedBoxId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editingBox, setEditingBox] = useState(null)
  const [fundingBox, setFundingBox] = useState(null)
  const [disbursementBox, setDisbursementBox] = useState(null)
  const [liquidationBox, setLiquidationBox] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getCajaModuleData(showInactive)
      setModuleData(data)
      setSelectedBoxId((prev) => {
        if (prev && data.boxes.some((box) => box.id === prev)) return prev
        return data.boxes[0]?.id || ''
      })
    } catch (err) {
      setError(err.message || 'No se pudo cargar el módulo de caja')
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeRefresh(['cash_boxes', 'cash_box_movements', 'cash_box_liquidations', 'bank_accounts'], load)

  const selectedBox = moduleData.boxes.find((box) => box.id === selectedBoxId) || null
  const pendingMovements = useMemo(
    () => moduleData.movements.filter((movement) => movement.cash_box_id === selectedBoxId && movement.status === 'pendiente_liquidacion'),
    [moduleData.movements, selectedBoxId]
  )
  const recentLiquidations = useMemo(
    () => moduleData.liquidations.filter((liquidation) => liquidation.cash_box_id === selectedBoxId).slice(0, 8),
    [moduleData.liquidations, selectedBoxId]
  )

  const overallBalance = moduleData.boxes.reduce((acc, box) => acc + n(box.current_balance), 0)
  const overallPending = moduleData.boxes.reduce((acc, box) => acc + n(box.pending_liquidation_amount), 0)

  async function handleSaveBox(payload) {
    setSaving(true)
    try {
      await saveCashBox(payload)
      setEditingBox(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleBox(box) {
    setSaving(true)
    try {
      await toggleCashBoxActive(box.id, !box.is_active)
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la caja')
    } finally {
      setSaving(false)
    }
  }

  async function handleFunding(payload) {
    setSaving(true)
    try {
      await createCashBoxFunding(payload)
      setFundingBox(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleDisbursement(payload) {
    setSaving(true)
    try {
      await createCashBoxDisbursement(payload)
      setDisbursementBox(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleLiquidation(payload) {
    setSaving(true)
    try {
      await liquidateCashBoxMovements(payload)
      setLiquidationBox(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Finanzas</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Caja</h1>
            <p className="mt-1 text-sm text-stone-500">
              Controla caja de mercado y caja chica, registra salidas sin factura y liquídalas luego con factura grupal.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowInactive((prev) => !prev)}
              className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                showInactive
                  ? 'border-[#2f5d50] bg-emerald-50 text-[#2f5d50]'
                  : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              {showInactive ? 'Incluye inactivas' : 'Ver inactivas'}
            </button>
            <button
              onClick={() => setEditingBox({ name: '', box_type: 'mercado', description: '' })}
              className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]"
            >
              + Nueva caja
            </button>
          </div>
        </div>

        {error ? <Alert>{error}</Alert> : null}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Saldo total en cajas</p>
            <p className="mt-2 text-3xl font-bold text-white">Q {fmt(overallBalance)}</p>
            <p className="mt-1 text-xs text-emerald-200">{moduleData.boxes.length} caja(s) registradas</p>
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pendiente de liquidar</p>
            <p className="mt-2 text-3xl font-bold text-amber-700">Q {fmt(overallPending)}</p>
            <p className="mt-1 text-xs text-stone-400">Salidas aún sin factura grupal</p>
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Fondeo bancario listo</p>
            <p className="mt-2 text-3xl font-bold text-stone-900">{moduleData.bankAccounts.length}</p>
            <p className="mt-1 text-xs text-stone-400">Cuenta(s) bancarias activas para fondear cajas</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
          <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-stone-900">Cajas registradas</h2>
              <p className="mt-1 text-sm text-stone-500">Cada caja genera su propia cuenta contable y se maneja con saldo independiente.</p>
            </div>

            {loading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : moduleData.boxes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-400">
                Aún no tienes cajas creadas.
              </div>
            ) : (
              <div className="space-y-3">
                {moduleData.boxes.map((box) => (
                  <button
                    key={box.id}
                    onClick={() => setSelectedBoxId(box.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      selectedBoxId === box.id
                        ? 'border-[#2f5d50] bg-emerald-50'
                        : 'border-stone-200 bg-stone-50 hover:bg-white'
                    } ${!box.is_active ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-stone-900">{box.name}</p>
                        <p className="text-sm text-stone-500">{boxTypeLabel(box.box_type)}</p>
                        <p className="mt-1 text-xs text-stone-400">
                          Cuenta contable {box.accounting_accounts?.code} · Saldo Q {fmt(box.current_balance)}
                        </p>
                        <p className="mt-1 text-xs text-stone-400">
                          Pendiente liquidar Q {fmt(box.pending_liquidation_amount)} ({box.pending_liquidation_count})
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingBox(box)
                          }}
                          className="rounded-xl border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:bg-white"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleBox(box)
                          }}
                          className="rounded-xl border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:bg-white"
                        >
                          {box.is_active ? 'Inactivar' : 'Activar'}
                        </button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            {!selectedBox ? (
              <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-16 text-center text-stone-400 shadow-sm">
                Selecciona una caja para ver sus movimientos.
              </div>
            ) : (
              <>
                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Caja seleccionada</p>
                      <h2 className="mt-1 text-2xl font-bold text-stone-900">{selectedBox.name}</h2>
                      <p className="mt-1 text-sm text-stone-500">
                        {boxTypeLabel(selectedBox.box_type)} · Cuenta {selectedBox.accounting_accounts?.code}
                      </p>
                      {selectedBox.description ? (
                        <p className="mt-2 text-sm text-stone-600">{selectedBox.description}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => setFundingBox(selectedBox)}
                        className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        Fondear desde banco
                      </button>
                      <button
                        onClick={() => setDisbursementBox(selectedBox)}
                        className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        Registrar salida
                      </button>
                      <button
                        onClick={() => setLiquidationBox(selectedBox)}
                        disabled={!pendingMovements.length}
                        className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50"
                      >
                        Liquidar pendientes
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200">Saldo actual</p>
                    <p className="mt-2 text-3xl font-bold text-white">Q {fmt(selectedBox.current_balance)}</p>
                  </div>
                  <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Fondeado</p>
                    <p className="mt-2 text-3xl font-bold text-stone-900">Q {fmt(selectedBox.total_funding)}</p>
                  </div>
                  <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Pendiente liquidar</p>
                    <p className="mt-2 text-3xl font-bold text-amber-700">Q {fmt(selectedBox.pending_liquidation_amount)}</p>
                  </div>
                </div>

                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-stone-900">Movimientos recientes</h3>
                      <p className="mt-1 text-sm text-stone-500">Fondeos, salidas y estado de liquidación.</p>
                    </div>
                  </div>

                  {selectedBox.recent_movements.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-400">
                      No hay movimientos en esta caja todavía.
                    </div>
                  ) : (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[920px] text-sm">
                        <thead>
                          <tr className="border-b border-stone-100 bg-stone-50">
                            {['Fecha', 'Tipo', 'Detalle', 'Documento', 'Monto', 'Estado', 'Soporte'].map((label) => (
                              <th key={label} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-50">
                          {selectedBox.recent_movements.map((movement) => (
                            <tr key={movement.id} className="hover:bg-stone-50">
                              <td className="px-4 py-3 text-stone-500">{movement.movement_date}</td>
                              <td className="px-4 py-3 text-stone-700">{movementLabel(movement.movement_type)}</td>
                              <td className="px-4 py-3 text-stone-700">
                                <div>{movement.summary}</div>
                                {movement.suppliers?.name ? (
                                  <div className="text-xs text-stone-400">Proveedor: {movement.suppliers.name}</div>
                                ) : null}
                                {movement.cost_centers?.code ? (
                                  <div className="text-xs text-stone-400">CC: {movement.cost_centers.code} · {movement.cost_centers.name}</div>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 text-stone-600">
                                {movement.reference_number || movement.cash_box_liquidations?.invoice_number || '—'}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-stone-900">Q {fmt(movement.amount)}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle(movement.status)}`}>
                                  {statusLabel(movement.status)}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {movement.support_file_url ? (
                                  <a
                                    href={movement.support_file_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm font-medium text-[#2f5d50] underline-offset-2 hover:underline"
                                  >
                                    Ver
                                  </a>
                                ) : (
                                  <span className="text-xs text-stone-400">Sin archivo</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                  <div>
                    <h3 className="text-lg font-semibold text-stone-900">Liquidaciones recientes</h3>
                    <p className="mt-1 text-sm text-stone-500">Factura grupal usada para cuadrar movimientos de la caja.</p>
                  </div>

                  {recentLiquidations.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-400">
                      Esta caja aún no tiene liquidaciones registradas.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {recentLiquidations.map((liquidation) => (
                        <div key={liquidation.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="font-semibold text-stone-900">Factura {liquidation.invoice_number}</div>
                              <div className="text-sm text-stone-500">{liquidation.invoice_date || liquidation.liquidation_date}</div>
                              {liquidation.notes ? (
                                <div className="mt-1 text-sm text-stone-600">{liquidation.notes}</div>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="font-semibold text-[#2f5d50]">Q {fmt(liquidation.total_amount)}</div>
                              {liquidation.invoice_file_url ? (
                                <a
                                  href={liquidation.invoice_file_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100"
                                >
                                  Ver PDF
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {editingBox ? (
        <BoxModal
          initialValue={editingBox?.id ? editingBox : null}
          onClose={() => setEditingBox(null)}
          onSubmit={handleSaveBox}
          saving={saving}
        />
      ) : null}

      {fundingBox ? (
        <FundingModal
          box={fundingBox}
          bankAccounts={moduleData.bankAccounts}
          onClose={() => setFundingBox(null)}
          onSubmit={handleFunding}
          saving={saving}
        />
      ) : null}

      {disbursementBox ? (
        <DisbursementModal
          box={disbursementBox}
          suppliers={moduleData.suppliers}
          materials={moduleData.materials}
          costCenters={moduleData.costCenters}
          onClose={() => setDisbursementBox(null)}
          onSubmit={handleDisbursement}
          saving={saving}
        />
      ) : null}

      {liquidationBox ? (
        <LiquidationModal
          box={liquidationBox}
          movements={pendingMovements}
          onClose={() => setLiquidationBox(null)}
          onSubmit={handleLiquidation}
          saving={saving}
        />
      ) : null}
    </div>
  )
}
