import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  deleteCashFlowManualItem,
  deleteCashFlowSimulation,
  deleteCashFlowOverride,
  exportCashFlowProjectionToExcel,
  getFlujoCajaWorkbench,
  getPriorityLabel,
  getScenarioLabel,
  saveCashFlowCategory,
  saveCashFlowManualItem,
  saveCashFlowOverride,
  saveCashFlowScenario,
  saveCashFlowSettings,
  saveCashFlowSimulation,
  toggleCashFlowCategoryActive,
  toggleCashFlowManualItemActive,
  toggleCashFlowSimulationActive,
} from '../services/flujoCajaService'

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

function fmtQ(value) {
  return `Q ${fmt(value)}`
}

function compactPeriodLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  return raw.length > 18 ? `${raw.slice(0, 18)}...` : raw
}

function pct(value) {
  return `${n(value).toLocaleString('es-GT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`
}

function buildSimulationForm(simulation) {
  if (!simulation) return { ...emptySimulationForm }
  return {
    id: simulation.id,
    name: simulation.name || '',
    simulation_type: simulation.simulation_type || 'inversion',
    cash_effect_direction: simulation.cash_effect_direction || 'egreso',
    amount: String(simulation.amount ?? ''),
    start_date: simulation.start_date || '',
    payment_mode: simulation.payment_mode || 'contado',
    installment_count: simulation.installment_count == null ? '' : String(simulation.installment_count),
    installment_frequency: simulation.installment_frequency || 'mensual',
    down_payment_amount: simulation.down_payment_amount == null ? '' : String(simulation.down_payment_amount),
    balance_payment_date: simulation.balance_payment_date || '',
    recurring_benefit_amount: simulation.recurring_benefit_amount == null ? '' : String(simulation.recurring_benefit_amount),
    recurring_benefit_type: simulation.recurring_benefit_type || 'ahorro',
    benefit_start_date: simulation.benefit_start_date || '',
    benefit_frequency: simulation.benefit_frequency || 'mensual',
    applies_to_scenario: simulation.applies_to_scenario || 'todos',
    notes: simulation.notes || '',
  }
}

const TABS = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'proyeccion', label: 'Proyeccion' },
  { key: 'escenarios', label: 'Escenarios' },
  { key: 'simulador', label: 'Simulador' },
  { key: 'alertas', label: 'Alertas' },
  { key: 'configuracion', label: 'Configuracion' },
]

const INPUT =
  'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-700 outline-none transition focus:border-[#2f5d50] focus:bg-white focus:ring-4 focus:ring-emerald-100'

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ type = 'error', children }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-sky-200 bg-sky-50 text-sky-700',
  }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[type] || styles.info}`}>{children}</div>
}

function Card({ children, className = '' }) {
  return <div className={`rounded-3xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>
}

function Badge({ children, tone = 'stone' }) {
  const tones = {
    stone: 'bg-stone-100 text-stone-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-sky-100 text-sky-700',
    purple: 'bg-purple-100 text-purple-700',
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.stone}`}>
      {children}
    </span>
  )
}

function KpiCard({ label, value, sub, accent = false, tone = 'stone' }) {
  const toneMap = {
    stone: 'text-stone-800',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    blue: 'text-sky-700',
  }

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${accent ? 'border-[#2f5d50] bg-[#2f5d50]' : 'border-stone-200 bg-white'}`}>
      <p className={`text-xs font-semibold uppercase tracking-widest ${accent ? 'text-emerald-200' : 'text-stone-400'}`}>
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${accent ? 'text-white' : toneMap[tone] || toneMap.stone}`}>
        {value}
      </p>
      {sub ? <p className={`mt-1 text-xs ${accent ? 'text-emerald-100' : 'text-stone-400'}`}>{sub}</p> : null}
    </div>
  )
}

function ProjectionChart({ periods }) {
  if (!periods?.length) {
    return (
      <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50 py-12 text-center text-sm text-stone-400">
        No hay suficientes datos para dibujar la proyeccion.
      </div>
    )
  }

  const width = 760
  const height = 240
  const padding = { left: 58, right: 20, top: 16, bottom: 56 }
  const chartWidth = width - padding.left - padding.right
  const maxBar = Math.max(
    1,
    ...periods.map((row) => Math.max(n(row.inflows), n(row.outflows)))
  )
  const balances = periods.flatMap((row) => [n(row.opening_balance), n(row.closing_balance)])
  const minBalance = Math.min(...balances)
  const maxBalance = Math.max(...balances)
  const balanceRange = Math.max(1, maxBalance - minBalance)
  const step = chartWidth / Math.max(1, periods.length)
  const barWidth = Math.max(10, Math.min(16, step * 0.16))
  const barGap = Math.max(8, Math.min(18, step * 0.16))
  const plotTop = 24
  const plotBottom = 176
  const plotHeight = plotBottom - plotTop
  const tickValues = [
    maxBar,
    maxBar * 0.66,
    maxBar * 0.33,
    0,
  ]
  const yForBar = (value) => plotBottom - ((n(value) / maxBar) * plotHeight)

  const balancePoints = periods.map((row, index) => {
    const x = padding.left + step * index + step / 2
    const y = plotTop + ((maxBalance - n(row.closing_balance)) / balanceRange) * (plotHeight - 12)
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[240px] w-full" role="img" aria-label="Grafica de flujo de caja proyectado">
        <line x1={padding.left} y1={plotBottom} x2={width - padding.right} y2={plotBottom} stroke="#d6d3d1" strokeWidth="1" />
        <line x1={padding.left} y1={plotTop} x2={padding.left} y2={plotBottom} stroke="#d6d3d1" strokeWidth="1" />
        {tickValues.map((tick, index) => {
          const y = yForBar(tick)
          return (
            <g key={`tick-${index}`}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e7e5e4" strokeDasharray="4 4" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#78716c">
                {fmt(tick)}
              </text>
            </g>
          )
        })}
        {periods.map((row, index) => {
          const x = padding.left + step * index + Math.max(8, (step - (barWidth * 2 + barGap)) / 2)
          const inflowHeight = (n(row.inflows) / maxBar) * plotHeight
          const outflowHeight = (n(row.outflows) / maxBar) * plotHeight
          return (
            <g key={row.key}>
              <rect x={x} y={plotBottom - inflowHeight} width={barWidth} height={inflowHeight} rx={6} fill="#2f5d50" opacity="0.92" />
              <rect x={x + barWidth + barGap} y={plotBottom - outflowHeight} width={barWidth} height={outflowHeight} rx={6} fill="#dc2626" opacity="0.82" />
              <text
                x={padding.left + step * index + step / 2}
                y={plotBottom + 22}
                textAnchor="end"
                fontSize="9"
                fill="#78716c"
                transform={`rotate(-45 ${padding.left + step * index + step / 2} ${plotBottom + 22})`}
              >
                {compactPeriodLabel(row.label)}
              </text>
            </g>
          )
        })}
        <polyline points={balancePoints} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {periods.map((row, index) => {
          const x = padding.left + step * index + step / 2
          const y = plotTop + ((maxBalance - n(row.closing_balance)) / balanceRange) * (plotHeight - 12)
          return <circle key={`${row.key}-point`} cx={x} cy={y} r={4} fill="#0f766e" />
        })}
        <text x={padding.left} y={12} fontSize="11" fill="#57534e">Saldo acumulado</text>
        <text x={14} y={height / 2} textAnchor="middle" fontSize="11" fill="#57534e" transform={`rotate(-90 14 ${height / 2})`}>
          Monto (Q)
        </text>
      </svg>
    </div>
  )
}

function buildOverrideState(item, scenarioCode) {
  return {
    scope: item?.override?.scope === 'todos' ? 'todos' : scenarioCode,
    projectedDate: item?.override?.projected_date || item?.projected_date || '',
    includeInProjection: item?.override?.include_in_projection ?? true,
    collectionProbability:
      item?.override?.collection_probability == null ? '' : String(item.override.collection_probability),
    paymentClassification: item?.override?.payment_classification || item?.classification || '',
    notes: item?.override?.notes || '',
  }
}

function OverrideModal({ open, item, sourceType, scenarioCode, saving, onClose, onSave, onReset }) {
  const [state, setState] = useState(() => buildOverrideState(item, scenarioCode))

  if (!item) return null

  function handleSubmit(event) {
    event.preventDefault()
    onSave({
      source_type: sourceType,
      source_id: item.id,
      scenario_code: state.scope,
      projected_date: state.projectedDate,
      include_in_projection: state.includeInProjection,
      collection_probability: sourceType === 'cxc' ? state.collectionProbability : null,
      payment_classification: sourceType === 'cxp' ? state.paymentClassification : null,
      notes: state.notes,
    })
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={`Ajustar ${sourceType === 'cxc' ? 'cobro' : 'pago'} proyectado`} maxWidth="max-w-xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
          <div className="font-semibold text-stone-800">{item.label}</div>
          <div>{sourceType === 'cxc' ? item.client_name : item.supplier_name}</div>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Aplicar ajuste</span>
          <select value={state.scope} onChange={(e) => setState((prev) => ({ ...prev, scope: e.target.value }))} className={INPUT}>
            <option value={scenarioCode}>Solo {getScenarioLabel(scenarioCode)}</option>
            <option value="todos">A todos los escenarios</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Fecha proyectada</span>
          <input type="date" value={state.projectedDate} onChange={(e) => setState((prev) => ({ ...prev, projectedDate: e.target.value }))} className={INPUT} />
        </label>

        {sourceType === 'cxc' ? (
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Probabilidad de cobro</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={state.collectionProbability}
              onChange={(e) => setState((prev) => ({ ...prev, collectionProbability: e.target.value }))}
              className={INPUT}
              placeholder="1 = 100%"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-stone-700">Clasificacion del pago</span>
            <select value={state.paymentClassification} onChange={(e) => setState((prev) => ({ ...prev, paymentClassification: e.target.value }))} className={INPUT}>
              <option value="obligatorio">Obligatorio</option>
              <option value="flexible">Flexible</option>
              <option value="reprogramable">Reprogramable</option>
            </select>
          </label>
        )}

        <label className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          <input type="checkbox" checked={state.includeInProjection} onChange={(e) => setState((prev) => ({ ...prev, includeInProjection: e.target.checked }))} />
          Incluir temporalmente en la proyeccion
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Notas</span>
          <textarea rows={3} value={state.notes} onChange={(e) => setState((prev) => ({ ...prev, notes: e.target.value }))} className={INPUT} />
        </label>

        <div className="flex flex-wrap gap-3">
          {(item.override?.hasSpecific || item.override?.hasGlobal) ? (
            <button
              type="button"
              onClick={() => onReset({ source_type: sourceType, source_id: item.id, scenario_code: state.scope })}
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100"
            >
              Quitar ajuste
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-2xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">
            {saving ? 'Guardando...' : 'Guardar ajuste'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function buildManualItemForm(item) {
  if (!item) {
    return {
      item_type: 'compra_proyectada',
      category_id: '',
      supplier_id: '',
      concept: '',
      amount: '',
      estimated_date: '',
      priority: 'media',
      applies_to_scenario: 'todos',
      comment: '',
    }
  }

  return {
    item_type: item.item_type || 'compra_proyectada',
    category_id: item.category_id || '',
    supplier_id: item.supplier_id || '',
    concept: item.concept || '',
    amount: String(item.amount || ''),
    estimated_date: item.estimated_date || '',
    priority: item.priority || 'media',
    applies_to_scenario: item.applies_to_scenario || 'todos',
    comment: item.comment || '',
  }
}

function ManualItemModal({ open, item, categories, suppliers, saving, onClose, onSave }) {
  const [form, setForm] = useState(() => buildManualItemForm(item))

  function handleSubmit(event) {
    event.preventDefault()
    onSave({ id: item?.id, ...form })
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={item?.id ? 'Editar egreso proyectado' : 'Nuevo egreso proyectado'} maxWidth="max-w-2xl">
      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Tipo</span>
          <select value={form.item_type} onChange={(e) => setForm((prev) => ({ ...prev, item_type: e.target.value }))} className={INPUT}>
            <option value="compra_proyectada">Compra proyectada</option>
            <option value="otro_egreso">Otro egreso</option>
            <option value="otro_ingreso">Otro ingreso</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Categoria</span>
          <select value={form.category_id} onChange={(e) => setForm((prev) => ({ ...prev, category_id: e.target.value }))} className={INPUT}>
            <option value="">Seleccionar...</option>
            {categories.filter((category) => category.is_active !== false).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.kind})
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-medium text-stone-700">Concepto</span>
          <input value={form.concept} onChange={(e) => setForm((prev) => ({ ...prev, concept: e.target.value }))} className={INPUT} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Proveedor</span>
          <select value={form.supplier_id} onChange={(e) => setForm((prev) => ({ ...prev, supplier_id: e.target.value }))} className={INPUT}>
            <option value="">Sin proveedor</option>
            {suppliers.filter((supplier) => supplier.status === 'activo').map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Monto estimado</span>
          <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className={INPUT} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Fecha estimada</span>
          <input type="date" value={form.estimated_date} onChange={(e) => setForm((prev) => ({ ...prev, estimated_date: e.target.value }))} className={INPUT} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-stone-700">Prioridad</span>
          <select value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))} className={INPUT}>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-medium text-stone-700">Escenario</span>
          <select value={form.applies_to_scenario} onChange={(e) => setForm((prev) => ({ ...prev, applies_to_scenario: e.target.value }))} className={INPUT}>
            <option value="todos">Todos</option>
            <option value="optimista">Optimista</option>
            <option value="realista">Realista</option>
            <option value="pesimista">Pesimista</option>
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-medium text-stone-700">Comentario</span>
          <textarea rows={3} value={form.comment} onChange={(e) => setForm((prev) => ({ ...prev, comment: e.target.value }))} className={INPUT} />
        </label>

        <div className="md:col-span-2 flex flex-wrap gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">
            {saving ? 'Guardando...' : 'Guardar registro'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const emptySimulationForm = {
  name: '',
  simulation_type: 'inversion',
  cash_effect_direction: 'egreso',
  amount: '',
  start_date: '',
  payment_mode: 'contado',
  installment_count: '',
  installment_frequency: 'mensual',
  down_payment_amount: '',
  balance_payment_date: '',
  recurring_benefit_amount: '',
  recurring_benefit_type: 'ahorro',
  benefit_start_date: '',
  benefit_frequency: 'mensual',
  applies_to_scenario: 'todos',
  notes: '',
}

function buildSimulationAnalysis(current, previewSimulation) {
  const simulationItems = (current?.simulationItems || []).filter((item) => item.is_preview)
  const outflows = simulationItems
    .filter((item) => item.direction === 'egreso')
    .reduce((acc, item) => acc + n(item.projected_amount), 0)
  const inflows = simulationItems
    .filter((item) => item.direction === 'ingreso')
    .reduce((acc, item) => acc + n(item.projected_amount), 0)
  const netBenefit = inflows - outflows
  const roi = outflows > 0 ? ((netBenefit) / outflows) * 100 : 0
  const minimumBalance = n(current?.summary?.minimum_balance)
  const finalBalance = n(current?.summary?.final_balance)
  const criticalDate = current?.summary?.tension_date || current?.summary?.minimum_balance_date || previewSimulation?.start_date || ''

  let verdict = {
    label: 'Revisar',
    tone: 'amber',
    message: 'La simulación necesita validación adicional de caja o retorno antes de tomar la decisión.',
  }

  if (outflows > 0 && roi >= 15 && minimumBalance >= 0 && finalBalance >= 0) {
    verdict = {
      label: 'Buena inversión',
      tone: 'emerald',
      message: 'El retorno proyectado compensa la salida de caja y el flujo se mantiene saludable en el horizonte analizado.',
    }
  } else if (minimumBalance < 0 || finalBalance < 0 || (outflows > 0 && roi < 0)) {
    verdict = {
      label: 'No recomendable',
      tone: 'red',
      message: 'La simulación presiona demasiado la caja o no recupera la inversión dentro del horizonte actual.',
    }
  }

  return {
    outflows,
    inflows,
    netBenefit,
    roi,
    minimumBalance,
    finalBalance,
    criticalDate,
    verdict,
  }
}

function SimulationModal({
  open,
  form,
  setForm,
  saving,
  previewSimulation,
  current,
  onClose,
  onPreview,
  onClearPreview,
  onSave,
}) {
  const analysis = useMemo(() => buildSimulationAnalysis(current, previewSimulation), [current, previewSimulation])

  return (
    <Modal isOpen={open} onClose={onClose} title="Simular inversión o proyecto" maxWidth="max-w-6xl">
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div>
          <div className="mb-4 text-sm text-stone-500">
            Modela inversiones, compras, ingresos extraordinarios o financiamiento y evalúa su efecto en caja antes de guardarlo.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Nombre</span><input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className={INPUT} /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Tipo de simulación</span><input value={form.simulation_type} onChange={(e) => setForm((prev) => ({ ...prev, simulation_type: e.target.value }))} className={INPUT} placeholder="maquinaria, expansión, deuda..." /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Impacto de caja</span><select value={form.cash_effect_direction} onChange={(e) => setForm((prev) => ({ ...prev, cash_effect_direction: e.target.value }))} className={INPUT}><option value="egreso">Egreso</option><option value="ingreso">Ingreso</option></select></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Monto</span><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className={INPUT} /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Fecha</span><input type="date" value={form.start_date} onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))} className={INPUT} /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Forma de pago</span><select value={form.payment_mode} onChange={(e) => setForm((prev) => ({ ...prev, payment_mode: e.target.value }))} className={INPUT}><option value="contado">Contado</option><option value="cuotas">Cuotas</option><option value="anticipo_saldo">Anticipo + saldo</option></select></label>
            {form.payment_mode === 'cuotas' ? (
              <>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Número de cuotas</span><input type="number" min="1" value={form.installment_count} onChange={(e) => setForm((prev) => ({ ...prev, installment_count: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Frecuencia</span><select value={form.installment_frequency} onChange={(e) => setForm((prev) => ({ ...prev, installment_frequency: e.target.value }))} className={INPUT}><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></label>
              </>
            ) : null}
            {form.payment_mode === 'anticipo_saldo' ? (
              <>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Anticipo</span><input type="number" step="0.01" value={form.down_payment_amount} onChange={(e) => setForm((prev) => ({ ...prev, down_payment_amount: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Fecha saldo</span><input type="date" value={form.balance_payment_date} onChange={(e) => setForm((prev) => ({ ...prev, balance_payment_date: e.target.value }))} className={INPUT} /></label>
              </>
            ) : null}
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Beneficio mensual/opcional</span><input type="number" step="0.01" value={form.recurring_benefit_amount} onChange={(e) => setForm((prev) => ({ ...prev, recurring_benefit_amount: e.target.value }))} className={INPUT} /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Tipo beneficio</span><select value={form.recurring_benefit_type} onChange={(e) => setForm((prev) => ({ ...prev, recurring_benefit_type: e.target.value }))} className={INPUT}><option value="ahorro">Ahorro</option><option value="ingreso">Ingreso</option></select></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Inicio beneficio</span><input type="date" value={form.benefit_start_date} onChange={(e) => setForm((prev) => ({ ...prev, benefit_start_date: e.target.value }))} className={INPUT} /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Frecuencia beneficio</span><select value={form.benefit_frequency} onChange={(e) => setForm((prev) => ({ ...prev, benefit_frequency: e.target.value }))} className={INPUT}><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></label>
            <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Escenario aplicable</span><select value={form.applies_to_scenario} onChange={(e) => setForm((prev) => ({ ...prev, applies_to_scenario: e.target.value }))} className={INPUT}><option value="todos">Todos</option><option value="optimista">Optimista</option><option value="realista">Realista</option><option value="pesimista">Pesimista</option></select></label>
            <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Notas</span><textarea rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className={INPUT} /></label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={onPreview} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Evaluar simulación</button>
            <button onClick={onSave} disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">Guardar simulación</button>
            {previewSimulation ? <button onClick={onClearPreview} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100">Quitar simulación temporal</button> : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className={`rounded-3xl border px-5 py-4 ${analysis.verdict.tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : analysis.verdict.tone === 'red' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Veredicto</div>
                <div className={`mt-1 text-2xl font-bold ${analysis.verdict.tone === 'emerald' ? 'text-emerald-700' : analysis.verdict.tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{analysis.verdict.label}</div>
              </div>
              <Badge tone={analysis.verdict.tone === 'emerald' ? 'emerald' : analysis.verdict.tone === 'red' ? 'red' : 'amber'}>
                ROI {pct(analysis.roi)}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-stone-600">{analysis.verdict.message}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Saldo final</div><div className={`mt-2 text-2xl font-bold ${analysis.finalBalance < 0 ? 'text-red-700' : 'text-stone-900'}`}>{fmtQ(analysis.finalBalance)}</div></div>
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Punto mínimo</div><div className={`mt-2 text-2xl font-bold ${analysis.minimumBalance < 0 ? 'text-red-700' : 'text-stone-900'}`}>{fmtQ(analysis.minimumBalance)}</div></div>
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Fecha crítica</div><div className="mt-2 text-lg font-semibold text-stone-900">{analysis.criticalDate || '-'}</div></div>
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Retorno neto</div><div className={`mt-2 text-2xl font-bold ${analysis.netBenefit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtQ(analysis.netBenefit)}</div></div>
          </div>

          <ProjectionChart periods={current?.periods || []} />

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-stone-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Inversión / salida</div><div className="mt-2 text-lg font-bold text-red-700">{fmtQ(analysis.outflows)}</div></div>
            <div className="rounded-2xl bg-stone-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Beneficios / ingresos</div><div className="mt-2 text-lg font-bold text-emerald-700">{fmtQ(analysis.inflows)}</div></div>
            <div className="rounded-2xl bg-stone-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">ROI proyectado</div><div className={`mt-2 text-lg font-bold ${analysis.roi >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct(analysis.roi)}</div></div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function FlujoCajaPage() {
  const [tab, setTab] = useState('resumen')
  const [scenarioCode, setScenarioCode] = useState('realista')
  const [grouping, setGrouping] = useState('')
  const [horizonDays, setHorizonDays] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [workbench, setWorkbench] = useState(null)
  const [settingsForm, setSettingsForm] = useState(null)
  const [scenarioDrafts, setScenarioDrafts] = useState({})
  const [categoryForm, setCategoryForm] = useState({ name: '', kind: 'egreso' })
  const [simulationForm, setSimulationForm] = useState(emptySimulationForm)
  const [previewSimulation, setPreviewSimulation] = useState(null)
  const [simulationModalOpen, setSimulationModalOpen] = useState(false)
  const [overrideTarget, setOverrideTarget] = useState(null)
  const [overrideType, setOverrideType] = useState('cxc')
  const [manualItemTarget, setManualItemTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getFlujoCajaWorkbench({
        scenarioCode,
        grouping,
        horizonDays,
        previewSimulation,
      })
      setWorkbench(data)
      setScenarioCode(data.selectedScenarioCode)
      if (!grouping) setGrouping(data.grouping)
      if (!horizonDays) setHorizonDays(data.horizonDays)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el flujo de caja proyectado')
    } finally {
      setLoading(false)
    }
  }, [scenarioCode, grouping, horizonDays, previewSimulation])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!workbench?.settings) return
    setSettingsForm({
      initial_cash_balance: String(workbench.settings.initial_cash_balance || 0),
      included_bank_account_ids: workbench.settings.included_bank_account_ids || [],
      included_cash_box_ids: workbench.settings.included_cash_box_ids || [],
      default_horizon_days: String(workbench.settings.default_horizon_days || 90),
      default_grouping: workbench.settings.default_grouping || 'semana',
      liquidity_alert_threshold: String(workbench.settings.liquidity_alert_threshold || 0),
      payment_flexible_after_days: String(workbench.settings.payment_flexible_after_days || 15),
      payment_reprogrammable_after_days: String(workbench.settings.payment_reprogrammable_after_days || 30),
      payroll_extra_percentage: String(workbench.settings.payroll_extra_percentage || 0),
      concentration_alert_threshold: String(workbench.settings.concentration_alert_threshold || 0.4),
    })
  }, [workbench?.settings])

  useEffect(() => {
    if (!workbench?.scenarios?.length) return
    const nextDrafts = {}
    workbench.scenarios.forEach((scenario) => {
      nextDrafts[scenario.scenario_code] = {
        name: scenario.name,
        collection_delay_days: String(scenario.collection_delay_days ?? 0),
        collection_probability_factor: String(scenario.collection_probability_factor ?? 1),
        payment_shift_days: String(scenario.payment_shift_days ?? 0),
        projected_purchase_multiplier: String(scenario.projected_purchase_multiplier ?? 1),
        payroll_multiplier: String(scenario.payroll_multiplier ?? 1),
        manual_income_multiplier: String(scenario.manual_income_multiplier ?? 1),
        manual_expense_multiplier: String(scenario.manual_expense_multiplier ?? 1),
        notes: scenario.notes || '',
      }
    })
    setScenarioDrafts(nextDrafts)
  }, [workbench?.scenarios])

  useRealtimeRefresh([
    'orders',
    'supplier_accounts_payable',
    'empleados',
    'bank_movements',
    'cash_box_movements',
    'cash_flow_settings',
    'cash_flow_scenarios',
    'cash_flow_projection_overrides',
    'cash_flow_manual_items',
    'cash_flow_simulations',
  ], load)

  const current = workbench?.current
  const summary = current?.summary || {}
  const categories = workbench?.categories || []
  const suppliers = workbench?.suppliers || []
  const scenarios = workbench?.scenarios || []
  const comparison = workbench?.comparison || []

  function openSimulationModal(simulation = null) {
    setSimulationForm(buildSimulationForm(simulation))
    setPreviewSimulation(null)
    setSimulationModalOpen(true)
  }

  function closeSimulationModal() {
    setSimulationModalOpen(false)
    setPreviewSimulation(null)
    setSimulationForm(emptySimulationForm)
  }

  async function saveAndReload(task) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await task()
      setSuccess('Cambios guardados correctamente.')
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo guardar la informacion')
    } finally {
      setSaving(false)
    }
  }

  function handleExport() {
    if (!current) return
    exportCashFlowProjectionToExcel({
      workbookName: `flujo-caja-${scenarioCode}-${horizonDays || workbench?.horizonDays || 90}d`,
      scenarioName: getScenarioLabel(scenarioCode),
      periods: current.periods,
      alerts: current.alerts,
      summary: current.summary,
    })
  }

  function toggleSelection(list, value) {
    const currentValues = new Set(list || [])
    if (currentValues.has(value)) currentValues.delete(value)
    else currentValues.add(value)
    return Array.from(currentValues)
  }

  const scenarioComparisonCards = comparison.map((row) => (
    <Card key={row.scenario_code} className={row.scenario_code === scenarioCode ? 'border-[#2f5d50] ring-2 ring-emerald-100' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">{row.name}</p>
          <p className={`mt-2 text-2xl font-bold ${n(row.summary.final_balance) < 0 ? 'text-red-700' : 'text-stone-800'}`}>
            {fmtQ(row.summary.final_balance)}
          </p>
          <p className="mt-1 text-xs text-stone-500">Saldo final proyectado</p>
        </div>
        <Badge tone={row.high_alert_count ? 'red' : row.alert_count ? 'amber' : 'emerald'}>
          {row.alert_count} alerta{row.alert_count === 1 ? '' : 's'}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-stone-600">
        <div className="flex justify-between"><span>Ingresos</span><span className="font-semibold text-emerald-700">{fmtQ(row.summary.projected_inflows)}</span></div>
        <div className="flex justify-between"><span>Egresos</span><span className="font-semibold text-red-700">{fmtQ(row.summary.projected_outflows)}</span></div>
        <div className="flex justify-between"><span>Punto minimo</span><span className="font-semibold">{fmtQ(row.summary.minimum_balance)}</span></div>
      </div>
    </Card>
  ))

  const upcomingCxc = useMemo(
    () => [...(current?.cxcItems || [])]
      .sort((a, b) => a.projected_date.localeCompare(b.projected_date))
      .slice(0, 8),
    [current?.cxcItems]
  )

  const upcomingCxp = useMemo(
    () => [...(current?.cxpItems || [])]
      .sort((a, b) => a.projected_date.localeCompare(b.projected_date))
      .slice(0, 8),
    [current?.cxpItems]
  )

  const upcomingManual = useMemo(
    () => [...(current?.manualItems || []), ...(current?.simulationItems || [])]
      .sort((a, b) => a.projected_date.localeCompare(b.projected_date))
      .slice(0, 10),
    [current?.manualItems, current?.simulationItems]
  )

  if (loading && !workbench) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">Finanzas · Planeacion</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Flujo de Caja Proyectado</h1>
            <p className="mt-2 max-w-3xl text-sm text-stone-500">
              Anticipa liquidez, compara escenarios y prueba decisiones antes de comprometer caja real.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <select value={scenarioCode} onChange={(e) => setScenarioCode(e.target.value)} className={INPUT}>
              <option value="optimista">Optimista</option>
              <option value="realista">Realista</option>
              <option value="pesimista">Pesimista</option>
            </select>
            <select value={grouping || workbench?.grouping || 'semana'} onChange={(e) => setGrouping(e.target.value)} className={INPUT}>
              <option value="semana">Semana</option>
              <option value="quincena">Quincena</option>
              <option value="mes">Mes</option>
            </select>
            <select value={String(horizonDays || workbench?.horizonDays || 90)} onChange={(e) => setHorizonDays(Number(e.target.value))} className={INPUT}>
              <option value="30">30 dias</option>
              <option value="60">60 dias</option>
              <option value="90">90 dias</option>
              <option value="180">6 meses</option>
            </select>
            <div className="flex gap-2">
              <button onClick={load} className="flex-1 rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                Recalcular
              </button>
              <button onClick={handleExport} className="flex-1 rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
                Exportar
              </button>
            </div>
          </div>
        </div>

        {error ? <Alert type="error">{error}</Alert> : null}
        {success ? <Alert type="success">{success}</Alert> : null}

        <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
          {TABS.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                tab === tabItem.key
                  ? 'bg-[#2f5d50] text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        {tab === 'resumen' ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <KpiCard label="Saldo inicial" value={fmtQ(summary.initial_balance)} sub="Bancos + cajas + ajuste manual" />
              <KpiCard label="Ingresos proyectados" value={fmtQ(summary.projected_inflows)} tone="emerald" />
              <KpiCard label="Egresos proyectados" value={fmtQ(summary.projected_outflows)} tone="red" />
              <KpiCard label="Saldo final proyectado" value={fmtQ(summary.final_balance)} accent />
              <KpiCard label="Punto minimo de caja" value={fmtQ(summary.minimum_balance)} tone={n(summary.minimum_balance) < 0 ? 'red' : 'amber'} sub={summary.minimum_balance_date ? `Fecha critica: ${summary.minimum_balance_date}` : ''} />
              <KpiCard label="Mayor tension de liquidez" value={summary.tension_date || '-'} sub={current?.alerts?.length ? `${current.alerts.length} alertas activas` : 'Sin alertas criticas'} tone="blue" />
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-stone-900">Evolucion proyectada</h2>
                    <p className="mt-1 text-sm text-stone-500">Ingresos, egresos y saldo acumulado por periodo.</p>
                  </div>
                  {loading ? <Spinner /> : null}
                </div>
                <ProjectionChart periods={current?.periods || []} />
              </Card>

              <div className="space-y-4">
                <Card>
                  <h2 className="text-lg font-semibold text-stone-900">Alertas activas</h2>
                  <div className="mt-4 space-y-3">
                    {current?.alerts?.length ? current.alerts.slice(0, 4).map((alert) => (
                      <div key={alert.id} className={`rounded-2xl border px-4 py-3 ${alert.severity === 'high' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className={`text-sm font-semibold ${alert.severity === 'high' ? 'text-red-700' : 'text-amber-700'}`}>{alert.title}</span>
                          {alert.date ? <span className="text-xs text-stone-500">{alert.date}</span> : null}
                        </div>
                        <p className="mt-2 text-sm text-stone-600">{alert.description}</p>
                        <p className="mt-2 text-xs font-medium text-stone-500">{alert.recommendation}</p>
                      </div>
                    )) : (
                      <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        No se detectaron riesgos relevantes en este escenario.
                      </div>
                    )}
                  </div>
                </Card>

                <Card>
                  <h2 className="text-lg font-semibold text-stone-900">Desglose del flujo</h2>
                  <div className="mt-4 space-y-3">
                    {(current?.sourceBreakdown || []).slice(0, 4).map((row) => (
                      <div key={row.key} className="flex items-center justify-between rounded-2xl bg-stone-50 px-4 py-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-800">{row.label}</div>
                          <div className="text-xs text-stone-500">{row.count} registro(s)</div>
                        </div>
                        <div className={`text-sm font-bold ${row.direction === 'ingreso' ? 'text-emerald-700' : 'text-red-700'}`}>
                          {fmtQ(row.total)}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <div className="grid gap-4">
                  {scenarioComparisonCards}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Card>
                <h2 className="text-lg font-semibold text-stone-900">Cobros proyectados</h2>
                <div className="mt-4 space-y-3">
                  {upcomingCxc.length ? upcomingCxc.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-800">{item.client_name}</div>
                          <div className="text-xs text-stone-500">{item.document_reference} · {item.projected_date}</div>
                        </div>
                        <div className="text-sm font-bold text-emerald-700">{fmtQ(item.projected_amount)}</div>
                      </div>
                    </div>
                  )) : <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">Sin cobros dentro del horizonte.</div>}
                </div>
              </Card>

              <Card>
                <h2 className="text-lg font-semibold text-stone-900">Pagos comprometidos</h2>
                <div className="mt-4 space-y-3">
                  {upcomingCxp.length ? upcomingCxp.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-800">{item.supplier_name}</div>
                          <div className="text-xs text-stone-500">{item.document_reference} · {item.projected_date}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-red-700">{fmtQ(item.projected_amount)}</div>
                          <div className="text-xs text-stone-500">{item.classification}</div>
                        </div>
                      </div>
                    </div>
                  )) : <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">Sin pagos dentro del horizonte.</div>}
                </div>
              </Card>

              <Card>
                <h2 className="text-lg font-semibold text-stone-900">Compras y simulaciones</h2>
                <div className="mt-4 space-y-3">
                  {upcomingManual.length ? upcomingManual.map((item) => (
                    <div key={`${item.source_type}-${item.id}`} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-800">{item.label}</div>
                          <div className="text-xs text-stone-500">{item.projected_date}</div>
                        </div>
                        <div className={`text-sm font-bold ${item.direction === 'ingreso' ? 'text-emerald-700' : 'text-red-700'}`}>
                          {fmtQ(item.projected_amount)}
                        </div>
                      </div>
                    </div>
                  )) : <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">Sin compras ni simulaciones guardadas.</div>}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'proyeccion' ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <KpiCard label="Bancos incluidos" value={current?.includedBanks?.length || 0} sub={fmtQ(summary.bank_initial_balance)} />
              <KpiCard label="Cajas incluidas" value={current?.includedCashBoxes?.length || 0} sub={fmtQ(summary.cash_box_initial_balance)} />
              <KpiCard label="Ajuste manual" value={fmtQ(summary.manual_initial_balance)} />
              <KpiCard label="Horizonte" value={`${workbench?.horizonDays || horizonDays} dias`} sub={`Agrupacion ${workbench?.grouping || grouping}`} />
            </div>

            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">Tabla detallada del flujo</h2>
                  <p className="mt-1 text-sm text-stone-500">Cada saldo final alimenta el siguiente periodo.</p>
                </div>
              </div>

              <div className="mt-4">
                <table className="w-full table-fixed text-left text-xs md:text-sm">
                  <thead className="border-b border-stone-200 text-stone-500">
                    <tr>
                      <th className="w-[22%] px-3 py-3">Periodo</th>
                      <th className="w-[14%] px-3 py-3 text-right">Inicial</th>
                      <th className="w-[14%] px-3 py-3 text-right">Ingresos</th>
                      <th className="w-[14%] px-3 py-3 text-right">Egresos</th>
                      <th className="w-[14%] px-3 py-3 text-right">Final</th>
                      <th className="w-[22%] px-3 py-3">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(current?.periods || []).map((row) => (
                      <tr key={row.key} className="border-b border-stone-100">
                        <td className="px-3 py-3 align-top">
                          <div className="font-semibold text-stone-800">{row.label}</div>
                          <div className="mt-1 text-[11px] text-stone-400">{getScenarioLabel(row.scenario_code)}</div>
                        </td>
                        <td className="px-3 py-3 text-right text-stone-600">{fmtQ(row.opening_balance)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-emerald-700">{fmtQ(row.inflows)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-red-700">{fmtQ(row.outflows)}</td>
                        <td className={`px-3 py-3 text-right font-bold ${n(row.closing_balance) < 0 ? 'text-red-700' : 'text-stone-900'}`}>{fmtQ(row.closing_balance)}</td>
                        <td className="px-3 py-3 text-stone-500">
                          <div className="line-clamp-2 break-words">{row.observations || '-'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === 'escenarios' ? (
          <div className="space-y-6">
            <div className="grid gap-4 xl:grid-cols-3">
              {scenarios.map((scenario) => {
                const draft = scenarioDrafts[scenario.scenario_code] || {}
                return (
                  <Card key={scenario.id}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-stone-900">{scenario.name}</h2>
                        <p className="text-sm text-stone-500">{scenario.notes}</p>
                      </div>
                      <Badge tone={scenario.scenario_code === scenarioCode ? 'emerald' : 'stone'}>
                        {getScenarioLabel(scenario.scenario_code)}
                      </Badge>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {[
                        ['collection_delay_days', 'Dias atraso cobro'],
                        ['collection_probability_factor', 'Factor prob. cobro'],
                        ['payment_shift_days', 'Desfase pagos'],
                        ['projected_purchase_multiplier', 'Factor compras'],
                        ['payroll_multiplier', 'Factor nomina'],
                        ['manual_income_multiplier', 'Factor ingresos'],
                        ['manual_expense_multiplier', 'Factor egresos'],
                      ].map(([key, label]) => (
                        <label key={key} className="block">
                          <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-stone-400">{label}</span>
                          <input
                            value={draft[key] || ''}
                            onChange={(e) => setScenarioDrafts((prev) => ({
                              ...prev,
                              [scenario.scenario_code]: { ...prev[scenario.scenario_code], [key]: e.target.value },
                            }))}
                            className={INPUT}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-stone-400">Notas</span>
                      <textarea
                        rows={3}
                        value={draft.notes || ''}
                        onChange={(e) => setScenarioDrafts((prev) => ({
                          ...prev,
                          [scenario.scenario_code]: { ...prev[scenario.scenario_code], notes: e.target.value },
                        }))}
                        className={INPUT}
                      />
                    </label>
                    <button
                      onClick={() => saveAndReload(() => saveCashFlowScenario({ scenario_code: scenario.scenario_code, ...draft }))}
                      className="mt-4 rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60"
                    >
                      Guardar escenario
                    </button>
                  </Card>
                )
              })}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">CxC proyectadas</h2>
                  <p className="text-sm text-stone-500">Ajusta fecha, probabilidad o exclusion para simulacion.</p>
                </div>
                <div className="mt-4 space-y-3">
                  {(current?.cxcItems || []).slice(0, 12).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-800">{item.client_name}</div>
                          <div className="text-xs text-stone-500">{item.document_reference} · {item.projected_date}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm font-bold text-emerald-700">{fmtQ(item.projected_amount)}</div>
                            <div className="text-xs text-stone-500">Prob. {(n(item.probability) * 100).toFixed(0)}%</div>
                          </div>
                          <button onClick={() => { setOverrideType('cxc'); setOverrideTarget(item) }} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
                            Ajustar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">CxP proyectadas</h2>
                  <p className="text-sm text-stone-500">Clasifica pagos como obligatorios, flexibles o reprogramables.</p>
                </div>
                <div className="mt-4 space-y-3">
                  {(current?.cxpItems || []).slice(0, 12).map((item) => (
                    <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-800">{item.supplier_name}</div>
                          <div className="text-xs text-stone-500">{item.document_reference} · {item.projected_date}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm font-bold text-red-700">{fmtQ(item.projected_amount)}</div>
                            <div className="text-xs text-stone-500">{item.classification}</div>
                          </div>
                          <button onClick={() => { setOverrideType('cxp'); setOverrideTarget(item) }} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
                            Ajustar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'simulador' ? (
          <div className="space-y-6">
            <Card>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">Simulador financiero</h2>
                  <p className="mt-1 text-sm text-stone-500">Evalúa inversiones y proyectos en un popup con gráfica del flujo, ROI y veredicto ejecutivo.</p>
                </div>
                <button onClick={openSimulationModal} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
                  Nueva simulación
                </button>
              </div>
            </Card>

            <Card>
              <h2 className="text-lg font-semibold text-stone-900">Simulaciones guardadas</h2>
              <div className="mt-4 space-y-3">
                {(workbench?.simulations || []).length ? workbench.simulations.map((simulation) => (
                  <div key={simulation.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div><div className="text-sm font-semibold text-stone-800">{simulation.name}</div><div className="text-xs text-stone-500">{simulation.simulation_type} · {simulation.start_date}</div></div>
                      <div className="flex items-center gap-3">
                        <div className={`text-sm font-bold ${simulation.cash_effect_direction === 'ingreso' ? 'text-emerald-700' : 'text-red-700'}`}>{fmtQ(simulation.amount)}</div>
                        <button onClick={() => openSimulationModal(simulation)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100">Ver / editar</button>
                        <button onClick={() => saveAndReload(() => deleteCashFlowSimulation(simulation.id))} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">Eliminar</button>
                        <button onClick={() => saveAndReload(() => toggleCashFlowSimulationActive(simulation.id, simulation.is_active === false))} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100">{simulation.is_active === false ? 'Activar' : 'Inactivar'}</button>
                      </div>
                    </div>
                  </div>
                )) : <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">Todavía no hay simulaciones guardadas.</div>}
              </div>
            </Card>
          </div>
        ) : null}

        {tab === '__legacy_simulador_hidden__' ? (
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <h2 className="text-lg font-semibold text-stone-900">Simulador financiero</h2>
              <p className="mt-1 text-sm text-stone-500">Modela inversiones, compras, ingresos extraordinarios o financiamiento.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Nombre</span><input value={simulationForm.name} onChange={(e) => setSimulationForm((prev) => ({ ...prev, name: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Tipo de simulacion</span><input value={simulationForm.simulation_type} onChange={(e) => setSimulationForm((prev) => ({ ...prev, simulation_type: e.target.value }))} className={INPUT} placeholder="maquinaria, contratacion, deuda..." /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Impacto de caja</span><select value={simulationForm.cash_effect_direction} onChange={(e) => setSimulationForm((prev) => ({ ...prev, cash_effect_direction: e.target.value }))} className={INPUT}><option value="egreso">Egreso</option><option value="ingreso">Ingreso</option></select></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Monto</span><input type="number" step="0.01" value={simulationForm.amount} onChange={(e) => setSimulationForm((prev) => ({ ...prev, amount: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Fecha</span><input type="date" value={simulationForm.start_date} onChange={(e) => setSimulationForm((prev) => ({ ...prev, start_date: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Forma de pago</span><select value={simulationForm.payment_mode} onChange={(e) => setSimulationForm((prev) => ({ ...prev, payment_mode: e.target.value }))} className={INPUT}><option value="contado">Contado</option><option value="cuotas">Cuotas</option><option value="anticipo_saldo">Anticipo + saldo</option></select></label>
                {simulationForm.payment_mode === 'cuotas' ? (
                  <>
                    <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Numero de cuotas</span><input type="number" min="1" value={simulationForm.installment_count} onChange={(e) => setSimulationForm((prev) => ({ ...prev, installment_count: e.target.value }))} className={INPUT} /></label>
                    <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Frecuencia</span><select value={simulationForm.installment_frequency} onChange={(e) => setSimulationForm((prev) => ({ ...prev, installment_frequency: e.target.value }))} className={INPUT}><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></label>
                  </>
                ) : null}
                {simulationForm.payment_mode === 'anticipo_saldo' ? (
                  <>
                    <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Anticipo</span><input type="number" step="0.01" value={simulationForm.down_payment_amount} onChange={(e) => setSimulationForm((prev) => ({ ...prev, down_payment_amount: e.target.value }))} className={INPUT} /></label>
                    <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Fecha saldo</span><input type="date" value={simulationForm.balance_payment_date} onChange={(e) => setSimulationForm((prev) => ({ ...prev, balance_payment_date: e.target.value }))} className={INPUT} /></label>
                  </>
                ) : null}
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Beneficio mensual/opcional</span><input type="number" step="0.01" value={simulationForm.recurring_benefit_amount} onChange={(e) => setSimulationForm((prev) => ({ ...prev, recurring_benefit_amount: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Tipo beneficio</span><select value={simulationForm.recurring_benefit_type} onChange={(e) => setSimulationForm((prev) => ({ ...prev, recurring_benefit_type: e.target.value }))} className={INPUT}><option value="ahorro">Ahorro</option><option value="ingreso">Ingreso</option></select></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Inicio beneficio</span><input type="date" value={simulationForm.benefit_start_date} onChange={(e) => setSimulationForm((prev) => ({ ...prev, benefit_start_date: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Frecuencia beneficio</span><select value={simulationForm.benefit_frequency} onChange={(e) => setSimulationForm((prev) => ({ ...prev, benefit_frequency: e.target.value }))} className={INPUT}><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></label>
                <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Escenario aplicable</span><select value={simulationForm.applies_to_scenario} onChange={(e) => setSimulationForm((prev) => ({ ...prev, applies_to_scenario: e.target.value }))} className={INPUT}><option value="todos">Todos</option><option value="optimista">Optimista</option><option value="realista">Realista</option><option value="pesimista">Pesimista</option></select></label>
                <label className="block md:col-span-2"><span className="mb-2 block text-sm font-medium text-stone-700">Notas</span><textarea rows={3} value={simulationForm.notes} onChange={(e) => setSimulationForm((prev) => ({ ...prev, notes: e.target.value }))} className={INPUT} /></label>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={() => setPreviewSimulation({ ...simulationForm })} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Simular</button>
                <button onClick={() => saveAndReload(() => saveCashFlowSimulation(simulationForm).then(() => setPreviewSimulation(null)))} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Guardar simulacion</button>
                {previewSimulation ? <button onClick={() => setPreviewSimulation(null)} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100">Quitar simulacion temporal</button> : null}
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <h2 className="text-lg font-semibold text-stone-900">Impacto del escenario actual</h2>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl bg-stone-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Saldo final</div><div className={`mt-2 text-2xl font-bold ${n(summary.final_balance) < 0 ? 'text-red-700' : 'text-stone-900'}`}>{fmtQ(summary.final_balance)}</div></div>
                  <div className="rounded-2xl bg-stone-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Fecha critica</div><div className="mt-2 text-lg font-semibold text-stone-900">{summary.tension_date || '-'}</div></div>
                  <div className="rounded-2xl bg-stone-50 px-4 py-3"><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Punto minimo</div><div className="mt-2 text-lg font-semibold text-stone-900">{fmtQ(summary.minimum_balance)}</div></div>
                </div>
              </Card>

              <Card>
                <h2 className="text-lg font-semibold text-stone-900">Simulaciones guardadas</h2>
                <div className="mt-4 space-y-3">
                  {(workbench?.simulations || []).length ? workbench.simulations.map((simulation) => (
                    <div key={simulation.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div><div className="text-sm font-semibold text-stone-800">{simulation.name}</div><div className="text-xs text-stone-500">{simulation.simulation_type} · {simulation.start_date}</div></div>
                        <div className="flex items-center gap-3">
                          <div className={`text-sm font-bold ${simulation.cash_effect_direction === 'ingreso' ? 'text-emerald-700' : 'text-red-700'}`}>{fmtQ(simulation.amount)}</div>
                          <button onClick={() => saveAndReload(() => toggleCashFlowSimulationActive(simulation.id, simulation.is_active === false))} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100">{simulation.is_active === false ? 'Activar' : 'Inactivar'}</button>
                        </div>
                      </div>
                    </div>
                  )) : <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">Todavia no hay simulaciones guardadas.</div>}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'alertas' ? (
          <div className="space-y-4">
            {(current?.alerts || []).length ? current.alerts.map((alert) => (
              <Card key={alert.id} className={alert.severity === 'high' ? 'border-red-200' : 'border-amber-200'}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <Badge tone={alert.severity === 'high' ? 'red' : 'amber'}>{alert.severity === 'high' ? 'Alta' : 'Media'}</Badge>
                      <h2 className="text-lg font-semibold text-stone-900">{alert.title}</h2>
                    </div>
                    <p className="mt-3 text-sm text-stone-600">{alert.description}</p>
                    <p className="mt-3 text-sm font-medium text-stone-700">Recomendacion: {alert.recommendation}</p>
                  </div>
                  <div className="rounded-2xl bg-stone-50 px-4 py-3 text-right">
                    {alert.date ? <div className="text-xs uppercase tracking-wide text-stone-400">Fecha</div> : null}
                    {alert.date ? <div className="text-sm font-semibold text-stone-800">{alert.date}</div> : null}
                    {alert.amount ? <div className="mt-2 text-lg font-bold text-stone-900">{fmtQ(alert.amount)}</div> : null}
                  </div>
                </div>
              </Card>
            )) : <Alert type="success">Sin alertas activas para el escenario seleccionado.</Alert>}
          </div>
        ) : null}

        {tab === 'configuracion' ? (
          <div className="space-y-6">
            <Card>
              <h2 className="text-lg font-semibold text-stone-900">Configuracion del modulo</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Saldo inicial manual</span><input type="number" step="0.01" value={settingsForm?.initial_cash_balance || ''} onChange={(e) => setSettingsForm((prev) => ({ ...prev, initial_cash_balance: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Horizonte por defecto</span><select value={settingsForm?.default_horizon_days || '90'} onChange={(e) => setSettingsForm((prev) => ({ ...prev, default_horizon_days: e.target.value }))} className={INPUT}><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="180">6 meses</option></select></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Agrupacion</span><select value={settingsForm?.default_grouping || 'semana'} onChange={(e) => setSettingsForm((prev) => ({ ...prev, default_grouping: e.target.value }))} className={INPUT}><option value="semana">Semana</option><option value="quincena">Quincena</option><option value="mes">Mes</option></select></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Umbral alerta liquidez</span><input type="number" step="0.01" value={settingsForm?.liquidity_alert_threshold || ''} onChange={(e) => setSettingsForm((prev) => ({ ...prev, liquidity_alert_threshold: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Pago flexible despues de (dias)</span><input type="number" value={settingsForm?.payment_flexible_after_days || ''} onChange={(e) => setSettingsForm((prev) => ({ ...prev, payment_flexible_after_days: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Pago reprogramable despues de (dias)</span><input type="number" value={settingsForm?.payment_reprogrammable_after_days || ''} onChange={(e) => setSettingsForm((prev) => ({ ...prev, payment_reprogrammable_after_days: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Prestaciones extra sobre nomina (%)</span><input type="number" step="0.01" value={settingsForm?.payroll_extra_percentage || ''} onChange={(e) => setSettingsForm((prev) => ({ ...prev, payroll_extra_percentage: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className="mb-2 block text-sm font-medium text-stone-700">Concentracion maxima cliente</span><input type="number" step="0.01" value={settingsForm?.concentration_alert_threshold || ''} onChange={(e) => setSettingsForm((prev) => ({ ...prev, concentration_alert_threshold: e.target.value }))} className={INPUT} /></label>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-400">Cuentas bancarias incluidas</h3>
                  <div className="mt-3 space-y-2">
                    {(workbench?.bankAccounts || []).map((account) => (
                      <label key={account.id} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                        <input type="checkbox" checked={(settingsForm?.included_bank_account_ids || []).includes(account.id)} onChange={() => setSettingsForm((prev) => ({ ...prev, included_bank_account_ids: toggleSelection(prev?.included_bank_account_ids || [], account.id) }))} />
                        <span>{account.bank_name} · {account.account_number} · {account.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-400">Cajas incluidas</h3>
                  <div className="mt-3 space-y-2">
                    {(workbench?.cashBoxes || []).map((box) => (
                      <label key={box.id} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                        <input type="checkbox" checked={(settingsForm?.included_cash_box_ids || []).includes(box.id)} onChange={() => setSettingsForm((prev) => ({ ...prev, included_cash_box_ids: toggleSelection(prev?.included_cash_box_ids || [], box.id) }))} />
                        <span>{box.name} · {box.box_type} · {fmtQ(box.current_balance)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <button onClick={() => saveAndReload(() => saveCashFlowSettings(settingsForm))} className="mt-5 rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
                Guardar configuracion
              </button>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-stone-900">Compras y egresos proyectados</h2>
                    <p className="text-sm text-stone-500">Registra compromisos futuros aun cuando no exista una orden formal.</p>
                  </div>
                  <button onClick={() => setManualItemTarget({})} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Nuevo registro</button>
                </div>
                <div className="mt-4 space-y-3">
                  {(workbench?.manualItems || []).length ? workbench.manualItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-stone-800">{item.concept}</span>
                            <Badge tone={item.item_type === 'otro_ingreso' ? 'emerald' : 'amber'}>{item.item_type}</Badge>
                            <Badge tone="stone">{getPriorityLabel(item.priority)}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-stone-500">{item.estimated_date} · {item.cash_flow_categories?.name || 'Sin categoria'} · {item.suppliers?.name || 'Sin proveedor'}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className={`text-sm font-bold ${item.item_type === 'otro_ingreso' ? 'text-emerald-700' : 'text-red-700'}`}>{fmtQ(item.amount)}</div>
                          <button onClick={() => setManualItemTarget(item)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100">Editar</button>
                          <button onClick={() => saveAndReload(() => deleteCashFlowManualItem(item.id))} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">Eliminar</button>
                          <button onClick={() => saveAndReload(() => toggleCashFlowManualItemActive(item.id, item.is_active === false))} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100">{item.is_active === false ? 'Activar' : 'Inactivar'}</button>
                        </div>
                      </div>
                    </div>
                  )) : <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-500">Todavia no hay compras o egresos proyectados.</div>}
                </div>
              </Card>

              <Card>
                <h2 className="text-lg font-semibold text-stone-900">Categorias editables</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_150px_auto]">
                  <input value={categoryForm.name} onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value }))} className={INPUT} placeholder="Nueva categoria" />
                  <select value={categoryForm.kind} onChange={(e) => setCategoryForm((prev) => ({ ...prev, kind: e.target.value }))} className={INPUT}><option value="egreso">Egreso</option><option value="ingreso">Ingreso</option></select>
                  <button onClick={() => saveAndReload(() => saveCashFlowCategory(categoryForm).then(() => setCategoryForm({ name: '', kind: 'egreso' })))} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Agregar</button>
                </div>
                <div className="mt-4 space-y-3">
                  {categories.map((category) => (
                    <div key={category.id} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div><div className="text-sm font-semibold text-stone-800">{category.name}</div><div className="text-xs text-stone-500">{category.kind}</div></div>
                      <button onClick={() => saveAndReload(() => toggleCashFlowCategoryActive(category.id, category.is_active === false))} className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100">{category.is_active === false ? 'Activar' : 'Inactivar'}</button>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        ) : null}
      </div>

      <OverrideModal
        key={`${overrideType}-${overrideTarget?.id || 'empty'}-${scenarioCode}`}
        open={Boolean(overrideTarget)}
        item={overrideTarget}
        sourceType={overrideType}
        scenarioCode={scenarioCode}
        saving={saving}
        onClose={() => setOverrideTarget(null)}
        onSave={(payload) => saveAndReload(() => saveCashFlowOverride(payload).then(() => setOverrideTarget(null)))}
        onReset={(payload) => saveAndReload(() => deleteCashFlowOverride(payload).then(() => setOverrideTarget(null)))}
      />

      <ManualItemModal
        key={manualItemTarget?.id || 'new'}
        open={manualItemTarget !== null}
        item={manualItemTarget?.id ? manualItemTarget : null}
        categories={categories}
        suppliers={suppliers}
        saving={saving}
        onClose={() => setManualItemTarget(null)}
        onSave={(payload) => saveAndReload(() => saveCashFlowManualItem(payload).then(() => setManualItemTarget(null)))}
      />

      <SimulationModal
        open={simulationModalOpen}
        form={simulationForm}
        setForm={setSimulationForm}
        saving={saving}
        previewSimulation={previewSimulation}
        current={current}
        onClose={closeSimulationModal}
        onPreview={() => setPreviewSimulation({ ...simulationForm, preview_mode: 'isolated' })}
        onClearPreview={() => setPreviewSimulation(null)}
        onSave={() => saveAndReload(() => saveCashFlowSimulation(simulationForm).then(() => {
          setPreviewSimulation(null)
          setSimulationModalOpen(false)
          setSimulationForm(emptySimulationForm)
        }))}
      />
    </div>
  )
}
