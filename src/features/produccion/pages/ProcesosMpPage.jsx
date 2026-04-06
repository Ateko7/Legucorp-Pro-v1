import { useEffect, useMemo, useState } from 'react'
import {
  advanceOutputToNextStage,
  createInitialProcessRun,
  getOutputSettlementPreview,
  getProcesosMpDashboardData,
  sendDriedOutputToProcessedInventory,
  STAGES,
} from '../services/materialProcessingService'

const todayString = new Date().toISOString().slice(0, 10)

function numberOrZero(value) {
  const n = Number(value)
  return Number.isNaN(n) ? 0 : n
}

function formatNumber(value) {
  return numberOrZero(value).toLocaleString('es-GT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        {subtitle ? <p className="text-sm text-slate-500 mt-1">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="border border-dashed border-slate-300 rounded-xl p-6 text-center text-slate-500 text-sm">
      {text}
    </div>
  )
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-700',
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  )
}

function DataRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value}</span>
    </div>
  )
}

function getWorkflowTone(status) {
  if (status === 'pendiente_lavado') return 'blue'
  if (status === 'pendiente_secado') return 'yellow'
  if (status === 'pendiente_inventario') return 'green'
  if (status === 'completado') return 'gray'
  return 'slate'
}

function InventoryLotCard({ lot, onSelect }) {
  return (
    <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">{lot.material_name}</h3>
          <p className="text-sm text-slate-500">{lot.material_code || 'Sin código'}</p>
        </div>
        <Badge tone="green">Disponible</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <DataRow label="Lote interno" value={lot.internal_lot} />
        <DataRow label="Cantidad" value={`${formatNumber(lot.available_quantity)} ${lot.unit}`} />
        <DataRow label="Ubicación" value={lot.location || '—'} />
        <DataRow label="Costo lote" value={formatNumber(lot.total_cost)} />
      </div>

      <button
        type="button"
        onClick={() => onSelect(lot)}
        className="mt-1 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800"
      >
        Iniciar proceso
      </button>
    </div>
  )
}

function RecentRunsTable({ runs }) {
  if (!runs.length) {
    return <EmptyState text="No hay corridas recientes." />
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b border-slate-200">
            <th className="py-2 pr-4">Fecha</th>
            <th className="py-2 pr-4">Lote origen</th>
            <th className="py-2 pr-4">Material</th>
            <th className="py-2 pr-4">Etapa</th>
            <th className="py-2 pr-4">Cantidad entrada</th>
            <th className="py-2 pr-4">Estado</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-slate-100">
              <td className="py-2 pr-4">{run.process_date}</td>
              <td className="py-2 pr-4">{run.source_internal_lot}</td>
              <td className="py-2 pr-4">{run.materials?.common_name || '—'}</td>
              <td className="py-2 pr-4">{run.current_stage}</td>
              <td className="py-2 pr-4">
                {formatNumber(run.input_quantity)} {run.input_unit}
              </td>
              <td className="py-2 pr-4">{run.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InitialProcessModal({ lot, onClose, onSubmit, loading }) {
  const [processDate, setProcessDate] = useState(todayString)
  const [startStage, setStartStage] = useState(STAGES.DESHOJE)
  const [notes, setNotes] = useState('')
  const [normalQty, setNormalQty] = useState('')
  const [miniQty, setMiniQty] = useState('')
  const [singleOutputQty, setSingleOutputQty] = useState(lot?.available_quantity || '')

  const inputQty = numberOrZero(lot?.available_quantity)

  const totalOutputDeshoje = numberOrZero(normalQty) + numberOrZero(miniQty)
  const wasteDeshoje = Math.max(0, inputQty - totalOutputDeshoje)
  const canSubmitDeshoje = totalOutputDeshoje > 0 && totalOutputDeshoje <= inputQty

  const singleOutput = numberOrZero(singleOutputQty)
  const wasteSingle = Math.max(0, inputQty - singleOutput)
  const canSubmitSingle = singleOutput > 0 && singleOutput <= inputQty

  const canSubmit = startStage === STAGES.DESHOJE ? canSubmitDeshoje : canSubmitSingle

  const handleSubmit = (e) => {
    e.preventDefault()

    if (startStage === STAGES.DESHOJE) {
      const outputs = []
      if (numberOrZero(normalQty) > 0) {
        outputs.push({
          output_type: 'normal',
          output_quantity: numberOrZero(normalQty),
        })
      }
      if (numberOrZero(miniQty) > 0) {
        outputs.push({
          output_type: 'mini',
          output_quantity: numberOrZero(miniQty),
        })
      }

      onSubmit({
        sourceInventoryLotId: lot.id,
        processDate,
        startStage,
        notes,
        outputs,
      })
      return
    }

    onSubmit({
      sourceInventoryLotId: lot.id,
      processDate,
      startStage,
      notes,
      outputQuantity: numberOrZero(singleOutputQty),
    })
  }

  if (!lot) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Iniciar proceso</h3>
            <p className="text-sm text-slate-500">
              {lot.material_name} · lote {lot.internal_lot}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Fecha de proceso</label>
              <input
                type="date"
                value={processDate}
                onChange={(e) => setProcessDate(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Etapa inicial</label>
              <select
                value={startStage}
                onChange={(e) => setStartStage(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2"
              >
                <option value={STAGES.DESHOJE}>deshoje</option>
                <option value={STAGES.LAVADO}>lavado</option>
                <option value={STAGES.SECADO}>secado</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Cantidad disponible</label>
              <input
                type="text"
                disabled
                value={`${formatNumber(lot.available_quantity)} ${lot.unit}`}
                className="w-full border border-slate-200 bg-slate-50 rounded-xl px-3 py-2"
              />
            </div>
          </div>

          {startStage === STAGES.DESHOJE ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4">
                  <h4 className="font-medium text-slate-800 mb-3">Sublote normal</h4>
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Cantidad salida</label>
                    <input
                      type="number"
                      step="0.01"
                      value={normalQty}
                      onChange={(e) => setNormalQty(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2"
                    />
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-4">
                  <h4 className="font-medium text-slate-800 mb-3">Sublote mini</h4>
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Cantidad salida</label>
                    <input
                      type="number"
                      step="0.01"
                      value={miniQty}
                      onChange={(e) => setMiniQty(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <DataRow label="Entrada" value={`${formatNumber(inputQty)} ${lot.unit}`} />
                  <DataRow label="Total salidas" value={`${formatNumber(totalOutputDeshoje)} ${lot.unit}`} />
                  <DataRow label="Merma calculada" value={`${formatNumber(wasteDeshoje)} ${lot.unit}`} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Cantidad salida</label>
                  <input
                    type="number"
                    step="0.01"
                    value={singleOutputQty}
                    onChange={(e) => setSingleOutputQty(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 mb-1">Merma calculada</label>
                  <input
                    type="text"
                    disabled
                    value={`${formatNumber(wasteSingle)} ${lot.unit}`}
                    className="w-full border border-slate-200 bg-slate-50 rounded-xl px-3 py-2"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-slate-600 mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-xl px-3 py-2"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit || loading}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar proceso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AdvanceStageModal({ output, nextStage, onClose, onSubmit, loading }) {
  const [processDate, setProcessDate] = useState(todayString)
  const [outputQuantity, setOutputQuantity] = useState(output?.output_quantity || '')
  const [notes, setNotes] = useState('')

  const inputQty = numberOrZero(output?.output_quantity)
  const outQty = numberOrZero(outputQuantity)
  const wasteQty = Math.max(0, inputQty - outQty)
  const valid = outQty > 0 && outQty <= inputQty

  const title =
    nextStage === STAGES.LAVADO
      ? 'Registrar lavado'
      : nextStage === STAGES.SECADO
        ? 'Registrar secado'
        : 'Registrar etapa'

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({
      sourceOutputId: output.id,
      nextStage,
      processDate,
      outputQuantity: outQty,
      notes,
    })
  }

  if (!output) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
            <p className="text-sm text-slate-500">
              {output.material_name} · {output.output_lot_code}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
            <DataRow label="Cantidad disponible de entrada" value={`${formatNumber(inputQty)} ${output.unit}`} />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Fecha de proceso</label>
            <input
              type="date"
              value={processDate}
              onChange={(e) => setProcessDate(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Cantidad salida</label>
              <input
                type="number"
                step="0.01"
                value={outputQuantity}
                onChange={(e) => setOutputQuantity(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Merma calculada</label>
              <input
                type="text"
                disabled
                value={`${formatNumber(wasteQty)} ${output.unit}`}
                className="w-full border border-slate-200 bg-slate-50 rounded-xl px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-xl px-3 py-2"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!valid || loading}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SendProcessedModal({ output, onClose, onSubmit, loading, submitError }) {
  const [location, setLocation] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [settlementMode, setSettlementMode] = useState('manual')
  const [manualAcceptedPct, setManualAcceptedPct] = useState('')

  useEffect(() => {
    let active = true

    async function loadPreview() {
      if (!output?.id) return

      try {
        setPreviewLoading(true)
        setPreviewError('')
        const data = await getOutputSettlementPreview(output.id)
        if (!active) return
        setPreview(data)
      } catch (err) {
        if (!active) return
        setPreviewError(err.message || 'No se pudo cargar la liquidación del lote.')
      } finally {
        if (active) setPreviewLoading(false)
      }
    }

    loadPreview()

    return () => {
      active = false
    }
  }, [output?.id])

  if (!output) return null

  const processWastePct = numberOrZero(preview?.processWastePercentage)
  const acceptedPct =
    settlementMode === 'auto'
      ? processWastePct
      : numberOrZero(manualAcceptedPct)

  const originalAmount = numberOrZero(preview?.originalAmount)
  const finalQty = numberOrZero(preview?.finalQty)
  const discountAmount = originalAmount * (acceptedPct / 100)
  const payableAmount = originalAmount - discountAmount
  const processedUnitCost = finalQty > 0 ? payableAmount / finalQty : 0

  function handleSubmit(e) {
    e.preventDefault()

    onSubmit({
      outputId: output.id,
      location,
      settlementMode,
      acceptedSupplierWastePercentage: acceptedPct,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Enviar a inventario procesado</h3>
            <p className="text-sm text-slate-500">
              {output.material_name} · {output.output_lot_code}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700">
            ✕
          </button>
        </div>

        {previewLoading ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Cargando liquidación del lote...
          </div>
        ) : previewError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {previewError}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="text-sm"><span className="text-slate-500">Proveedor:</span> <span className="font-medium text-slate-800">{preview?.supplierName || '—'}</span></div>
              <div className="text-sm"><span className="text-slate-500">Lote origen:</span> <span className="font-medium text-slate-800">{preview?.sourceInternalLot || '—'}</span></div>
              <div className="text-sm"><span className="text-slate-500">Costo original lote:</span> <span className="font-medium text-slate-800">{formatNumber(preview?.originalAmount)}</span></div>
              <div className="text-sm"><span className="text-slate-500">Cantidad final:</span> <span className="font-medium text-slate-800">{formatNumber(preview?.finalQty)} {preview?.unit}</span></div>
              <div className="text-sm"><span className="text-slate-500">Merma total del proceso:</span> <span className="font-medium text-slate-800">{formatNumber(preview?.processWastePercentage)}%</span></div>
              <div className="text-sm"><span className="text-slate-500">Costo final por libra:</span> <span className="font-medium text-slate-800">{formatNumber(processedUnitCost)}</span></div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 space-y-4">
              <div className="text-sm font-semibold text-slate-800">
                Ajuste de merma aceptada por proveedor
              </div>

              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="settlementMode"
                  value="auto"
                  checked={settlementMode === 'auto'}
                  onChange={(e) => setSettlementMode(e.target.value)}
                />
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    Aplicar automáticamente la merma total del proceso
                  </div>
                  <div className="text-xs text-slate-500">
                    Se aplicará {formatNumber(processWastePct)}% como descuento al proveedor.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="settlementMode"
                  value="manual"
                  checked={settlementMode === 'manual'}
                  onChange={(e) => setSettlementMode(e.target.value)}
                />
                <div className="w-full">
                  <div className="text-sm font-medium text-slate-800">
                    Ingresar porcentaje manual aceptado por proveedor
                  </div>
                  <div className="mt-2">
                    <input
                      type="number"
                      step="0.01"
                      value={manualAcceptedPct}
                      onChange={(e) => setManualAcceptedPct(e.target.value)}
                      disabled={settlementMode !== 'manual'}
                      className="w-40 border border-slate-300 rounded-xl px-3 py-2 text-sm"
                      placeholder="Ej. 30"
                    />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    No puede ser mayor que {formatNumber(processWastePct)}%.
                  </div>
                </div>
              </label>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="text-sm"><span className="text-slate-600">Merma aceptada proveedor:</span> <span className="font-semibold text-slate-800">{formatNumber(acceptedPct)}%</span></div>
              <div className="text-sm"><span className="text-slate-600">Descuento al costo:</span> <span className="font-semibold text-slate-800">{formatNumber(discountAmount)}</span></div>
              <div className="text-sm"><span className="text-slate-600">Monto a pagar proveedor (CXP):</span> <span className="font-semibold text-slate-800">{formatNumber(payableAmount)}</span></div>
              <div className="text-sm"><span className="text-slate-600">Costo final por libra procesada:</span> <span className="font-semibold text-slate-800">{formatNumber(processedUnitCost)}</span></div>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">Ubicación</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2"
                placeholder="Ej. Cuarto frío procesado"
              />
            </div>

            {submitError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {submitError}
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-green-600 text-white disabled:opacity-50"
              >
                {loading ? 'Guardando...' : 'Enviar a inventario procesado'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function SublotesTable({ rows, onAction }) {
  if (!rows.length) {
    return <EmptyState text="No hay sublotes activos en proceso." />
  }

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b border-slate-200">
            <th className="py-2 pr-4">Lote / sublote</th>
            <th className="py-2 pr-4">Material</th>
            <th className="py-2 pr-4">Tipo</th>
            <th className="py-2 pr-4">Etapa actual</th>
            <th className="py-2 pr-4">Cantidad</th>
            <th className="py-2 pr-4">Merma</th>
            <th className="py-2 pr-4">Estado</th>
            <th className="py-2 pr-4">Acción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="py-2 pr-4 font-medium text-slate-800">{row.output_lot_code}</td>
              <td className="py-2 pr-4">{row.material_name}</td>
              <td className="py-2 pr-4">{row.output_type || 'unico'}</td>
              <td className="py-2 pr-4">{row.stage}</td>
              <td className="py-2 pr-4">
                {formatNumber(row.output_quantity)} {row.unit}
              </td>
              <td className="py-2 pr-4">
                {formatNumber(row.waste_quantity)} {row.unit}
              </td>
              <td className="py-2 pr-4">
                <Badge tone={getWorkflowTone(row.workflow_status)}>
                  {row.workflow_label}
                </Badge>
              </td>
              <td className="py-2 pr-4">
                {row.next_action ? (
                  <button
                    type="button"
                    onClick={() => onAction(row)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs hover:bg-slate-800"
                  >
                    {row.next_action}
                  </button>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ProcesosMpPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [inventoryLots, setInventoryLots] = useState([])
  const [processOutputs, setProcessOutputs] = useState([])
  const [recentRuns, setRecentRuns] = useState([])

  const [selectedInitialLot, setSelectedInitialLot] = useState(null)
  const [selectedAdvanceOutput, setSelectedAdvanceOutput] = useState(null)
  const [selectedProcessedOutput, setSelectedProcessedOutput] = useState(null)

  const summary = useMemo(() => {
    const pendientesLavado = processOutputs.filter((r) => r.workflow_status === 'pendiente_lavado').length
    const pendientesSecado = processOutputs.filter((r) => r.workflow_status === 'pendiente_secado').length
    const pendientesInventario = processOutputs.filter((r) => r.workflow_status === 'pendiente_inventario').length

    return {
      inventoryLots: inventoryLots.length,
      pendientesLavado,
      pendientesSecado,
      pendientesInventario,
    }
  }, [inventoryLots, processOutputs])

  async function loadData() {
    try {
      setLoading(true)
      setError('')
      const data = await getProcesosMpDashboardData()
      setInventoryLots(data.inventoryLots || [])
      setProcessOutputs(data.processOutputs || [])
      setRecentRuns(data.recentRuns || [])
    } catch (err) {
      setError(err.message || 'No se pudo cargar la información.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function handleCreateInitialProcess(payload) {
    try {
      setSaving(true)
      setError('')
      setSuccess('')
      await createInitialProcessRun(payload)
      setSelectedInitialLot(null)
      setSuccess('Proceso inicial guardado correctamente.')
      await loadData()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el proceso inicial.')
    } finally {
      setSaving(false)
    }
  }

  async function handleAdvanceStage(payload) {
    try {
      setSaving(true)
      setError('')
      setSuccess('')
      await advanceOutputToNextStage(payload)
      setSelectedAdvanceOutput(null)
      setSuccess('La etapa se registró correctamente.')
      await loadData()
    } catch (err) {
      setError(err.message || 'No se pudo registrar la etapa.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSendProcessed(payload) {
    try {
      setSaving(true)
      setError('')
      setSuccess('')

      const result = await sendDriedOutputToProcessedInventory(payload)

      setSelectedProcessedOutput(null)
      setSuccess(
        `Lote enviado a inventario procesado. CXP generada por ${formatNumber(
          result?.settlement?.payableAmount
        )}.`
      )

      await loadData()
    } catch (err) {
      setError(err.message || 'No se pudo enviar a inventario procesado.')
    } finally {
      setSaving(false)
    }
  }

  function handleRowAction(row) {
    if (row.workflow_status === 'pendiente_lavado' || row.workflow_status === 'pendiente_secado') {
      setSelectedAdvanceOutput(row)
      return
    }

    if (row.workflow_status === 'pendiente_inventario') {
      setSelectedProcessedOutput(row)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Procesos MP</h1>
        <p className="text-slate-600">
          Seguimiento de lotes activos en proceso. La liquidación final del costo se realiza al enviar el secado a inventario procesado.
        </p>
      </div>

      {error ? (
        <div className="border border-red-200 bg-red-50 text-red-700 rounded-xl px-4 py-3">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="border border-green-200 bg-green-50 text-green-700 rounded-xl px-4 py-3">
          {success}
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-sm text-slate-500">MP disponible</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{summary.inventoryLots}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-sm text-slate-500">Pend. lavado</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{summary.pendientesLavado}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-sm text-slate-500">Pend. secado</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{summary.pendientesSecado}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="text-sm text-slate-500">Pend. inventario</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{summary.pendientesInventario}</div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <SectionCard
          title="Materia prima disponible"
          subtitle="Lotes vegetales disponibles para iniciar proceso."
        >
          {loading ? (
            <EmptyState text="Cargando lotes..." />
          ) : inventoryLots.length ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {inventoryLots.map((lot) => (
                <InventoryLotCard
                  key={lot.id}
                  lot={lot}
                  onSelect={setSelectedInitialLot}
                />
              ))}
            </div>
          ) : (
            <EmptyState text="No hay lotes disponibles para proceso." />
          )}
        </SectionCard>

        <SectionCard
          title="Sublotes activos en proceso"
          subtitle="Aquí solo se muestran lotes activos. Los ya enviados a inventario procesado desaparecen de esta tabla."
        >
          {loading ? (
            <EmptyState text="Cargando sublotes..." />
          ) : (
            <SublotesTable rows={processOutputs} onAction={handleRowAction} />
          )}
        </SectionCard>

        <SectionCard
          title="Corridas recientes"
          subtitle="Últimos registros del módulo."
        >
          {loading ? <EmptyState text="Cargando corridas..." /> : <RecentRunsTable runs={recentRuns} />}
        </SectionCard>
      </div>

      <InitialProcessModal
        lot={selectedInitialLot}
        onClose={() => setSelectedInitialLot(null)}
        onSubmit={handleCreateInitialProcess}
        loading={saving}
      />

      <AdvanceStageModal
        output={selectedAdvanceOutput}
        nextStage={selectedAdvanceOutput?.next_stage || STAGES.LAVADO}
        onClose={() => setSelectedAdvanceOutput(null)}
        onSubmit={handleAdvanceStage}
        loading={saving}
      />

      <SendProcessedModal
        output={selectedProcessedOutput}
        onClose={() => { setSelectedProcessedOutput(null); setError('') }}
        onSubmit={handleSendProcessed}
        loading={saving}
        submitError={selectedProcessedOutput ? error : ''}
      />
    </div>
  )
}