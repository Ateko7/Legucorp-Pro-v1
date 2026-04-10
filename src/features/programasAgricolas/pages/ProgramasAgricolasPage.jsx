import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  createPurchaseOrderForProgramDelivery,
  generateScheduledDeliveries,
  getNextProgramaAgricolaCode,
  getProgramaAgricolaDetail,
  getProgramasAgricolas,
  getProgramasAgricolasDashboard,
  getProgramCatalogs,
  reajustarPrograma,
  registerReceptionForProgramDelivery,
  saveProgramaAgricola,
} from '../services/programasAgricolasService'

function n(v) { const x = Number(v); return Number.isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pct(v) { return `${n(v).toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }

const today = new Date().toISOString().slice(0, 10)
const emptyForm = { id: null, supplier_id: '', material_id: '', program_code: '', quantity_committed_total: '', unit: 'lb', start_date: today, end_date: today, delivery_frequency: 'semanal', status: 'borrador', notes: '', deliveries: [] }
const emptyReception = { received_date: today, supplier_lot: '', quantity_received: '', quantity_accepted: '', unit_cost: '', quality_notes: '' }

function KpiCard({ label, value, hint = '', tone = 'stone' }) {
  const toneClass = { stone: 'text-stone-900', green: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700' }
  return <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">{label}</p><p className={`mt-2 text-2xl font-bold ${toneClass[tone] || toneClass.stone}`}>{value}</p>{hint ? <p className="mt-2 text-xs text-stone-500">{hint}</p> : null}</div>
}

function AlertBox({ alert }) {
  return <div className={`rounded-2xl border px-4 py-3 ${alert.level === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}><div className="text-sm font-medium">{alert.message}</div></div>
}

export default function ProgramasAgricolasPage() {
  const [dashboard, setDashboard] = useState(null)
  const [programs, setPrograms] = useState([])
  const [catalogs, setCatalogs] = useState({ suppliers: [], materials: [] })
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [showProgramModal, setShowProgramModal] = useState(false)
  const [showReceptionModal, setShowReceptionModal] = useState(false)
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [programForm, setProgramForm] = useState(emptyForm)
  const [receptionForm, setReceptionForm] = useState(emptyReception)
  const [selectedDelivery, setSelectedDelivery] = useState(null)
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustDeliveries, setAdjustDeliveries] = useState([])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [dashboardData, programData, catalogData] = await Promise.all([getProgramasAgricolasDashboard(), getProgramasAgricolas(), getProgramCatalogs()])
      setDashboard(dashboardData); setPrograms(programData); setCatalogs(catalogData)
      if (!selectedId && programData[0]?.id) setSelectedId(programData[0].id)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [selectedId])

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); return }
    setDetailLoading(true); setError('')
    try { setDetail(await getProgramaAgricolaDetail(selectedId)) } catch (e) { setError(e.message) } finally { setDetailLoading(false) }
  }, [selectedId])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadDetail() }, [loadDetail])
  useRealtimeRefresh(['programas_agricolas', 'programa_entregas', 'programa_reajustes', 'purchase_orders', 'material_receptions', 'material_inventory_lots'], () => { load(); loadDetail() })

  const filteredPrograms = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return programs
    return programs.filter((row) => row.program_code?.toLowerCase().includes(term) || row.suppliers?.name?.toLowerCase().includes(term) || row.materials?.common_name?.toLowerCase().includes(term))
  }, [programs, search])

  async function openCreate() {
    setError('')
    try {
      const nextCode = await getNextProgramaAgricolaCode()
      setProgramForm({ ...emptyForm, program_code: nextCode, deliveries: [] })
      setShowProgramModal(true)
    } catch (e) {
      setError(e.message)
    }
  }

  function openEdit() {
    if (!detail) return
    setProgramForm({
      id: detail.id, supplier_id: detail.supplier_id, material_id: detail.material_id, program_code: detail.program_code,
      quantity_committed_total: String(detail.quantity_committed_total), unit: detail.unit, start_date: detail.start_date, end_date: detail.end_date,
      delivery_frequency: detail.delivery_frequency, status: detail.status, notes: detail.notes || '',
      deliveries: (detail.programa_entregas || []).map((row) => ({ id: row.id, scheduled_date: row.scheduled_date, planned_quantity: String(row.planned_quantity), received_quantity: row.received_quantity, ordered_quantity: row.ordered_quantity, status: row.computed_status || row.status, purchase_order_id: row.purchase_order_id || null, notes: row.notes || '' })),
    })
    setShowProgramModal(true)
  }

  function regenerateDeliveries() {
    setProgramForm((prev) => ({ ...prev, deliveries: generateScheduledDeliveries({ start_date: prev.start_date, end_date: prev.end_date, delivery_frequency: prev.delivery_frequency, quantity_committed_total: prev.quantity_committed_total }).map((row) => ({ ...row, planned_quantity: String(row.planned_quantity) })) }))
  }

  async function handleSaveProgram(e) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      const id = await saveProgramaAgricola({ ...programForm, quantity_committed_total: n(programForm.quantity_committed_total), deliveries: (programForm.deliveries || []).map((row) => ({ ...row, planned_quantity: n(row.planned_quantity) })) })
      setShowProgramModal(false); setSelectedId(id); setSuccess('Programa agrícola guardado correctamente.'); await load(); setDetail(await getProgramaAgricolaDetail(id))
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  async function handleCreateOrder(deliveryId) {
    setSaving(true); setError(''); setSuccess('')
    try { await createPurchaseOrderForProgramDelivery(deliveryId); setSuccess('Orden de compra generada desde la entrega programada.'); await load(); await loadDetail() } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  function openReception(delivery) {
    setSelectedDelivery(delivery)
    setReceptionForm({ ...emptyReception, received_date: today, quantity_received: String(Math.max(0, n(delivery.planned_quantity) - n(delivery.received_quantity))), quantity_accepted: String(Math.max(0, n(delivery.planned_quantity) - n(delivery.received_quantity))) })
    setShowReceptionModal(true)
  }

  async function handleRegisterReception(e) {
    e.preventDefault()
    if (!selectedDelivery) return
    setSaving(true); setError(''); setSuccess('')
    try { await registerReceptionForProgramDelivery(selectedDelivery.id, receptionForm); setShowReceptionModal(false); setSelectedDelivery(null); setSuccess('Recepción ligada al programa correctamente.'); await load(); await loadDetail() } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  function openAdjust() {
    if (!detail) return
    setAdjustDeliveries((detail.programa_entregas || []).filter((row) => row.scheduled_date >= today && n(row.received_quantity) <= 0).map((row) => ({ id: row.id, scheduled_date: row.scheduled_date, planned_quantity: String(row.planned_quantity), received_quantity: row.received_quantity, ordered_quantity: row.ordered_quantity, purchase_order_id: row.purchase_order_id || null, status: row.computed_status || row.status, notes: row.notes || '' })))
    setAdjustReason('')
    setShowAdjustModal(true)
  }

  async function handleAdjust(e) {
    e.preventDefault()
    if (!detail) return
    setSaving(true); setError(''); setSuccess('')
    try { await reajustarPrograma(detail.id, { reason: adjustReason, futureDeliveries: adjustDeliveries.map((row) => ({ ...row, planned_quantity: n(row.planned_quantity) })) }); setShowAdjustModal(false); setSuccess('Programa reajustado correctamente.'); await load(); await loadDetail() } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ERP · Abastecimiento</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Programas agrícolas</h1>
            <p className="mt-1 text-sm text-stone-500">Compromisos de abastecimiento por proveedor, producto y entregas planificadas.</p>
          </div>
          <div className="flex gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proveedor, producto o código" className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
            <button onClick={openCreate} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Programa</button>
          </div>
        </div>

        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

        {loading ? <div className="flex justify-center py-12"><div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" /></div> : <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="Programas activos" value={dashboard?.active_programs || 0} hint={`${dashboard?.total_programs || 0} total`} />
            <KpiCard label="Comprometido" value={fmt(dashboard?.committed_volume)} hint="Volumen programado" />
            <KpiCard label="Recibido" value={fmt(dashboard?.received_volume)} hint="Volumen real" tone="green" />
            <KpiCard label="Cumplimiento" value={pct(dashboard?.avg_compliance_pct)} hint="Promedio" tone="amber" />
            <KpiCard label="En riesgo" value={dashboard?.risk_programs || 0} hint="Con alertas" tone="rose" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-stone-100 px-5 py-4"><h2 className="text-sm font-semibold text-stone-800">Programas</h2></div>
                <div className="divide-y divide-stone-100">
                  {filteredPrograms.map((program) => (
                    <button key={program.id} onClick={() => setSelectedId(program.id)} className={`block w-full px-5 py-4 text-left transition hover:bg-stone-50 ${selectedId === program.id ? 'bg-stone-50' : 'bg-white'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div><div className="font-semibold text-stone-800">{program.program_code}</div><div className="text-sm text-stone-500">{program.suppliers?.name} · {program.materials?.common_name}</div></div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${program.status === 'activo' ? 'bg-emerald-100 text-emerald-700' : program.status === 'pausado' ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'}`}>{program.status}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-stone-500">
                        <div><div>Comprometido</div><div className="font-semibold text-stone-800">{fmt(program.quantity_committed_total)}</div></div>
                        <div><div>Entregado</div><div className="font-semibold text-stone-800">{fmt(program.delivered_total)}</div></div>
                        <div><div>Cumplimiento</div><div className="font-semibold text-stone-800">{pct(program.compliance_pct)}</div></div>
                      </div>
                    </button>
                  ))}
                  {!filteredPrograms.length && <div className="px-5 py-8 text-sm text-stone-500">No hay programas agrícolas registrados.</div>}
                </div>
              </div>
              <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-stone-800">Próximas entregas</h2>
                <div className="mt-4 space-y-3">
                  {(dashboard?.nextDeliveries || []).map((row) => <div key={`${row.program_id}-${row.id}`} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3"><div className="text-sm font-semibold text-stone-800">{row.program_code} · {row.supplier_name}</div><div className="text-xs text-stone-500">{row.material_name} · {row.scheduled_date} · {fmt(row.planned_quantity)} {row.unit}</div></div>)}
                  {!(dashboard?.nextDeliveries || []).length && <p className="text-sm text-stone-500">Sin entregas próximas.</p>}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {detailLoading ? <div className="flex justify-center py-20"><div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" /></div> : detail ? <>
                <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div><div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Detalle</div><h2 className="mt-1 text-2xl font-bold text-stone-900">{detail.program_code}</h2><p className="mt-1 text-sm text-stone-500">{detail.suppliers?.name} · {detail.materials?.common_name} ({detail.materials?.code || 'Sin código'})</p></div>
                    <div className="flex flex-wrap gap-2"><button onClick={openEdit} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Editar</button><button onClick={openAdjust} className="rounded-2xl border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50">Reajustar</button></div>
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <KpiCard label="Comprometido" value={`${fmt(detail.quantity_committed_total)} ${detail.unit}`} />
                    <KpiCard label="Entregado" value={`${fmt(detail.delivered_total)} ${detail.unit}`} tone="green" />
                    <KpiCard label="Saldo" value={`${fmt(detail.pending_total)} ${detail.unit}`} tone="amber" />
                    <KpiCard label="% Cumplimiento" value={pct(detail.compliance_pct)} hint={`Tiempo ${pct(detail.time_progress_pct)} · Volumen ${pct(detail.volume_progress_pct)}`} />
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-stone-400">Programado vs ordenado</div>
                      <div className="mt-2 text-sm font-semibold text-stone-800">{fmt(detail.quantity_committed_total)} / {fmt(detail.ordered_total)} {detail.unit}</div>
                      <div className="mt-1 text-xs text-stone-500">Saldo por ordenar: {fmt(Math.max(0, n(detail.quantity_committed_total) - n(detail.ordered_total)))} {detail.unit}</div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-stone-400">Entregas</div>
                      <div className="mt-2 text-sm font-semibold text-stone-800">{detail.delivery_stats?.cumplidas || 0} cumplidas · {detail.delivery_stats?.parciales || 0} parciales</div>
                      <div className="mt-1 text-xs text-stone-500">{detail.delivery_stats?.incumplidas || 0} incumplidas · {detail.delivery_stats?.sobreentregas || 0} sobreentregas</div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wider text-stone-400">Trazabilidad</div>
                      <div className="mt-2 text-sm font-semibold text-stone-800">{detail.receptions?.length || 0} recepciones · {detail.inventoryLots?.length || 0} lotes</div>
                      <div className="mt-1 text-xs text-stone-500">{detail.adjustments?.length || 0} reajustes registrados</div>
                    </div>
                  </div>
                </div>

                {!!detail.alerts.length && <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Alertas</h3><div className="mt-4 space-y-3">{detail.alerts.map((alert, index) => <AlertBox key={`${alert.type}-${index}`} alert={alert} />)}</div></div>}

                <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Entregas planificadas</h3></div>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Fecha</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Plan</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Ordenado</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Recibido</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Estado</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Acciones</th></tr></thead>
                    <tbody className="divide-y divide-stone-50">
                      {(detail.programa_entregas || []).map((row) => <tr key={row.id}><td className="px-4 py-3 text-stone-700">{row.scheduled_date}</td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.planned_quantity)}</td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.ordered_quantity)}</td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.received_quantity)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${row.computed_status === 'cumplida' ? 'bg-emerald-100 text-emerald-700' : row.computed_status === 'parcial' ? 'bg-amber-100 text-amber-700' : row.computed_status === 'incumplida' || row.computed_status === 'sobreentrega' ? 'bg-rose-100 text-rose-700' : 'bg-stone-100 text-stone-600'}`}>{row.computed_status || row.status}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{!row.purchase_order_id && row.computed_status !== 'cancelada' && <button disabled={saving} onClick={() => handleCreateOrder(row.id)} className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">Generar OC</button>}{row.computed_status !== 'cancelada' && <button disabled={saving} onClick={() => openReception(row)} className="rounded-xl border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Recepción</button>}</div></td></tr>)}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Historial de recepciones</h3></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Fecha</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Lote</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Aceptado</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">OC</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Usuario</th></tr></thead>
                        <tbody className="divide-y divide-stone-50">
                          {(detail.receptions || []).map((row) => <tr key={row.id}><td className="px-4 py-3 text-stone-700">{row.received_date}</td><td className="px-4 py-3 text-stone-700">{row.supplier_lot || 'Sin lote'}</td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.quantity_accepted || row.quantity_received)}</td><td className="px-4 py-3 text-stone-700">{row.purchase_orders?.order_number || 'Sin OC'}</td><td className="px-4 py-3 text-stone-700">{row.profiles?.full_name || 'Sistema'}</td></tr>)}
                          {!(detail.receptions || []).length && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-stone-500">Sin recepciones asociadas todavía.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Reajustes y cambios futuros</h3></div>
                    <div className="divide-y divide-stone-100">
                      {(detail.adjustments || []).map((row) => <div key={row.id} className="px-5 py-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-stone-800">{row.reason}</div><div className="mt-1 text-xs text-stone-500">{row.adjustment_date || row.created_at?.slice(0, 10)} · {row.profiles?.full_name || 'Sistema'}</div></div><div className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">{Array.isArray(row.new_values) ? row.new_values.length : 0} entrega(s)</div></div></div>)}
                      {!(detail.adjustments || []).length && <div className="px-5 py-6 text-sm text-stone-500">No hay reajustes registrados.</div>}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Órdenes de compra asociadas</h3></div>
                    <div className="divide-y divide-stone-100">
                      {(detail.programa_entregas || []).filter((row) => row.purchase_orders?.id).map((row) => <div key={`po-${row.id}`} className="flex items-center justify-between gap-3 px-5 py-4"><div><div className="text-sm font-semibold text-stone-800">{row.purchase_orders?.order_number || 'OC'}</div><div className="mt-1 text-xs text-stone-500">Entrega {row.scheduled_date} · Programado {fmt(row.planned_quantity)} · Ordenado {fmt(row.ordered_quantity)}</div></div><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">{row.purchase_orders?.status || 'creada'}</span></div>)}
                      {!(detail.programa_entregas || []).some((row) => row.purchase_orders?.id) && <div className="px-5 py-6 text-sm text-stone-500">Aún no hay órdenes de compra ligadas.</div>}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Inventario trazado por programa</h3></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Lote</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Original</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Disponible</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Estado</th></tr></thead>
                        <tbody className="divide-y divide-stone-50">
                          {(detail.inventoryLots || []).map((row) => <tr key={row.id}><td className="px-4 py-3 text-stone-700">{row.internal_lot}</td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.original_quantity)}</td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.available_quantity)}</td><td className="px-4 py-3 text-stone-700">{row.status}</td></tr>)}
                          {!(detail.inventoryLots || []).length && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-stone-500">Todavía no hay lotes de inventario vinculados.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </> : <div className="rounded-3xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-500 shadow-sm">Selecciona un programa para ver su detalle.</div>}
            </div>
          </div>
        </>}
      </div>

      <Modal isOpen={showProgramModal} onClose={() => setShowProgramModal(false)} title={programForm.id ? 'Editar programa agrícola' : 'Nuevo programa agrícola'} maxWidth="max-w-5xl">
        <form onSubmit={handleSaveProgram} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Proveedor</span><select value={programForm.supplier_id} onChange={(e) => setProgramForm((prev) => ({ ...prev, supplier_id: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"><option value="">Selecciona</option>{catalogs.suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Producto / MP</span><select value={programForm.material_id} onChange={(e) => { const material = catalogs.materials.find((row) => row.id === e.target.value); setProgramForm((prev) => ({ ...prev, material_id: e.target.value, unit: material?.base_unit || prev.unit })) }} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"><option value="">Selecciona</option>{catalogs.materials.map((row) => <option key={row.id} value={row.id}>{row.common_name} ({row.code})</option>)}</select></label>
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Código</span><input value={programForm.program_code} readOnly className="w-full rounded-2xl border border-stone-300 bg-stone-100 px-4 py-3 text-stone-600 outline-none" /></label>
          </div>
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Cantidad total</span><input type="number" step="0.0001" value={programForm.quantity_committed_total} onChange={(e) => setProgramForm((prev) => ({ ...prev, quantity_committed_total: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" /></label>
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Unidad</span><input value={programForm.unit} onChange={(e) => setProgramForm((prev) => ({ ...prev, unit: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" /></label>
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Inicio</span><input type="date" value={programForm.start_date} onChange={(e) => setProgramForm((prev) => ({ ...prev, start_date: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" /></label>
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Fin</span><input type="date" value={programForm.end_date} onChange={(e) => setProgramForm((prev) => ({ ...prev, end_date: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" /></label>
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Frecuencia</span><select value={programForm.delivery_frequency} onChange={(e) => setProgramForm((prev) => ({ ...prev, delivery_frequency: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"><option value="diaria">Diaria</option><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option><option value="personalizada">Personalizada</option></select></label>
            <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Estado</span><select value={programForm.status} onChange={(e) => setProgramForm((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"><option value="borrador">Borrador</option><option value="activo">Activo</option><option value="pausado">Pausado</option><option value="finalizado">Finalizado</option><option value="cancelado">Cancelado</option></select></label>
          </div>
          <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Observaciones</span><textarea rows={3} value={programForm.notes} onChange={(e) => setProgramForm((prev) => ({ ...prev, notes: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" /></label>
          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold text-stone-800">Entregas planificadas</div><div className="text-xs text-stone-500">Genera automáticamente o ajusta manualmente.</div></div><div className="flex gap-2"><button type="button" onClick={regenerateDeliveries} className="rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Regenerar</button><button type="button" onClick={() => setProgramForm((prev) => ({ ...prev, deliveries: [...prev.deliveries, { scheduled_date: prev.end_date || today, planned_quantity: '', status: 'pendiente', notes: '' }] }))} className="rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Agregar entrega</button></div></div>
            <div className="mt-4 space-y-3">{(programForm.deliveries || []).map((row, index) => <div key={row.id || index} className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-3 md:grid-cols-[1fr_1fr_auto]"><input type="date" value={row.scheduled_date} onChange={(e) => setProgramForm((prev) => ({ ...prev, deliveries: prev.deliveries.map((delivery, deliveryIndex) => deliveryIndex === index ? { ...delivery, scheduled_date: e.target.value } : delivery) }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" /><input type="number" step="0.0001" value={row.planned_quantity} onChange={(e) => setProgramForm((prev) => ({ ...prev, deliveries: prev.deliveries.map((delivery, deliveryIndex) => deliveryIndex === index ? { ...delivery, planned_quantity: e.target.value } : delivery) }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" /><button type="button" onClick={() => setProgramForm((prev) => ({ ...prev, deliveries: prev.deliveries.filter((_, deliveryIndex) => deliveryIndex !== index) }))} className="rounded-2xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50">Quitar</button></div>)}</div>
          </div>
          <div className="flex gap-3"><button type="button" onClick={() => setShowProgramModal(false)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button><button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar programa'}</button></div>
        </form>
      </Modal>

      <Modal isOpen={showReceptionModal} onClose={() => setShowReceptionModal(false)} title="Registrar recepción" maxWidth="max-w-2xl">
        <form onSubmit={handleRegisterReception} className="space-y-4">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">{selectedDelivery ? `Entrega ${selectedDelivery.scheduled_date} · plan ${fmt(selectedDelivery.planned_quantity)} · recibido ${fmt(selectedDelivery.received_quantity)}` : 'Sin entrega seleccionada'}</div>
          <div className="grid gap-4 md:grid-cols-2">
            <input type="date" value={receptionForm.received_date} onChange={(e) => setReceptionForm((prev) => ({ ...prev, received_date: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
            <input placeholder="Lote proveedor" value={receptionForm.supplier_lot} onChange={(e) => setReceptionForm((prev) => ({ ...prev, supplier_lot: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
            <input type="number" step="0.0001" placeholder="Cantidad recibida" value={receptionForm.quantity_received} onChange={(e) => setReceptionForm((prev) => ({ ...prev, quantity_received: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
            <input type="number" step="0.0001" placeholder="Cantidad aceptada" value={receptionForm.quantity_accepted} onChange={(e) => setReceptionForm((prev) => ({ ...prev, quantity_accepted: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
            <input type="number" step="0.0001" placeholder="Costo unitario" value={receptionForm.unit_cost} onChange={(e) => setReceptionForm((prev) => ({ ...prev, unit_cost: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
          </div>
          <textarea rows={3} placeholder="Comentarios / calidad" value={receptionForm.quality_notes} onChange={(e) => setReceptionForm((prev) => ({ ...prev, quality_notes: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
          <div className="flex gap-3"><button type="button" onClick={() => setShowReceptionModal(false)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button><button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Registrar recepción'}</button></div>
        </form>
      </Modal>

      <Modal isOpen={showAdjustModal} onClose={() => setShowAdjustModal(false)} title="Reajustar programa" maxWidth="max-w-4xl">
        <form onSubmit={handleAdjust} className="space-y-5">
          <textarea rows={3} placeholder="Motivo del reajuste" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
          <div className="space-y-3">{adjustDeliveries.map((row, index) => <div key={row.id || index} className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 md:grid-cols-[1fr_1fr_auto]"><input type="date" value={row.scheduled_date} onChange={(e) => setAdjustDeliveries((prev) => prev.map((delivery, deliveryIndex) => deliveryIndex === index ? { ...delivery, scheduled_date: e.target.value } : delivery))} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-[#2f5d50]" /><input type="number" step="0.0001" value={row.planned_quantity} onChange={(e) => setAdjustDeliveries((prev) => prev.map((delivery, deliveryIndex) => deliveryIndex === index ? { ...delivery, planned_quantity: e.target.value } : delivery))} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-[#2f5d50]" /><button type="button" onClick={() => setAdjustDeliveries((prev) => prev.filter((_, deliveryIndex) => deliveryIndex !== index))} className="rounded-2xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50">Cancelar</button></div>)}</div>
          <div className="flex gap-3"><button type="button" onClick={() => setAdjustDeliveries((prev) => [...prev, { scheduled_date: detail?.end_date || today, planned_quantity: '', received_quantity: 0, ordered_quantity: 0, status: 'pendiente', notes: '' }])} className="rounded-2xl border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Agregar entrega futura</button><div className="ml-auto flex gap-3"><button type="button" onClick={() => setShowAdjustModal(false)} className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button><button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Aplicar reajuste'}</button></div></div>
        </form>
      </Modal>
    </div>
  )
}
