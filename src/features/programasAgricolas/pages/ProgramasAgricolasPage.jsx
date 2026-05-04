import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  getNextProgramaAgricolaCode,
  getProgramaAgricolaDetail,
  getProgramasAgricolas,
  getProgramasAgricolasDashboard,
  getProgramCatalogs,
  saveProgramaAgricola,
} from '../services/programasAgricolasService'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pct(v) {
  return `${n(v).toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

const today = new Date().toISOString().slice(0, 10)

function makeClientKey(prefix = 'row') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function createEmptyProgramItem() {
  return {
    client_key: makeClientKey('item'),
    id: null,
    material_id: '',
    quantity_committed_total: '',
    unit: 'lb',
    notes: '',
  }
}

const emptyForm = {
  id: null,
  supplier_id: '',
  program_code: '',
  start_date: today,
  end_date: '',
  delivery_frequency: 'semanal',
  status: 'borrador',
  notes: '',
  items: [createEmptyProgramItem()],
}

function KpiCard({ label, value, hint = '', tone = 'stone' }) {
  const toneClass = { stone: 'text-stone-900', green: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700' }
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${toneClass[tone] || toneClass.stone}`}>{value}</p>
      {hint ? <p className="mt-2 text-xs text-stone-500">{hint}</p> : null}
    </div>
  )
}

function AlertBox({ alert }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${alert.level === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
      <div className="text-sm font-medium">{alert.message}</div>
    </div>
  )
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
  const [saving, setSaving] = useState(false)
  const [programForm, setProgramForm] = useState(emptyForm)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [dashboardData, programData, catalogData] = await Promise.all([
        getProgramasAgricolasDashboard(),
        getProgramasAgricolas(),
        getProgramCatalogs(),
      ])
      setDashboard(dashboardData)
      setPrograms(programData)
      setCatalogs(catalogData)
      if (!selectedId && programData[0]?.id) setSelectedId(programData[0].id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null)
      return
    }

    setDetailLoading(true)
    setError('')
    try {
      setDetail(await getProgramaAgricolaDetail(selectedId))
    } catch (e) {
      setError(e.message)
    } finally {
      setDetailLoading(false)
    }
  }, [selectedId])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadDetail() }, [loadDetail])
  useRealtimeRefresh(
    ['programas_agricolas', 'programa_agricola_items', 'material_receptions', 'material_inventory_lots'],
    () => { load(); loadDetail() },
  )

  const filteredPrograms = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return programs
    return programs.filter((row) => (
      row.program_code?.toLowerCase().includes(term)
      || row.suppliers?.name?.toLowerCase().includes(term)
      || row.material_labels?.toLowerCase().includes(term)
    ))
  }, [programs, search])

  const totalFormCommitted = useMemo(
    () => (programForm.items || []).reduce((acc, item) => acc + n(item.quantity_committed_total), 0),
    [programForm.items],
  )

  const programIsOpenEnded = !programForm.end_date

  function findMaterial(materialId) {
    return catalogs.materials.find((row) => row.id === materialId) || null
  }

  async function openCreate() {
    setError('')
    try {
      const nextCode = await getNextProgramaAgricolaCode()
      setProgramForm({
        ...emptyForm,
        program_code: nextCode,
        items: [createEmptyProgramItem()],
      })
      setShowProgramModal(true)
    } catch (e) {
      setError(e.message)
    }
  }

  function openEdit() {
    if (!detail) return
    setProgramForm({
      id: detail.id,
      supplier_id: detail.supplier_id,
      program_code: detail.program_code,
      start_date: detail.start_date,
      end_date: detail.end_date || '',
      delivery_frequency: detail.delivery_frequency,
      status: detail.status,
      notes: detail.notes || '',
      items: (detail.programa_agricola_items || []).map((item) => ({
        client_key: makeClientKey('item'),
        id: item.id,
        material_id: item.material_id,
        quantity_committed_total: String(item.quantity_committed_total),
        unit: item.unit,
        notes: item.notes || '',
      })),
    })
    setShowProgramModal(true)
  }

  function setProgramItem(itemIndex, updater) {
    setProgramForm((prev) => ({
      ...prev,
      items: prev.items.map((item, index) => (index === itemIndex ? (typeof updater === 'function' ? updater(item) : { ...item, ...updater }) : item)),
    }))
  }

  function addProgramItem() {
    setProgramForm((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyProgramItem()],
    }))
  }

  function removeProgramItem(itemIndex) {
    setProgramForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, index) => index !== itemIndex),
    }))
  }

  async function handleSaveProgram(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const id = await saveProgramaAgricola({
        ...programForm,
        items: (programForm.items || []).map((item) => ({
          ...item,
          quantity_committed_total: n(item.quantity_committed_total),
        })),
      })
      setShowProgramModal(false)
      setSelectedId(id)
      setSuccess('Programa agrícola guardado correctamente.')
      await load()
      setDetail(await getProgramaAgricolaDetail(id))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ERP · Abastecimiento</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Programas agrícolas</h1>
            <p className="mt-1 text-sm text-stone-500">Define compromisos por proveedor y variedad. El entregado se calcula automáticamente desde recepciones reales.</p>
          </div>
          <div className="flex gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proveedor, variedades o código" className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
            <button onClick={openCreate} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Programa</button>
          </div>
        </div>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <KpiCard label="Programas activos" value={dashboard?.active_programs || 0} hint={`${dashboard?.total_programs || 0} total`} />
              <KpiCard label="Comprometido" value={fmt(dashboard?.committed_volume)} hint="Volumen comprometido" />
              <KpiCard label="Entregado" value={fmt(dashboard?.received_volume)} hint="Recepciones reales" tone="green" />
              <KpiCard label="Cumplimiento" value={pct(dashboard?.avg_compliance_pct)} hint="Promedio" tone="amber" />
              <KpiCard label="En riesgo" value={dashboard?.risk_programs || 0} hint="Con alertas" tone="rose" />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
                  <div className="border-b border-stone-100 px-5 py-4">
                    <h2 className="text-sm font-semibold text-stone-800">Programas</h2>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {filteredPrograms.map((program) => (
                      <button key={program.id} onClick={() => setSelectedId(program.id)} className={`block w-full px-5 py-4 text-left transition hover:bg-stone-50 ${selectedId === program.id ? 'bg-stone-50' : 'bg-white'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-stone-800">{program.program_code}</div>
                            <div className="text-sm text-stone-500">{program.suppliers?.name} · {program.material_labels}</div>
                            <div className="mt-1 text-xs text-stone-400">{program.date_label}</div>
                          </div>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${program.status === 'activo' ? 'bg-emerald-100 text-emerald-700' : program.status === 'pausado' ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'}`}>{program.status}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-3 text-xs text-stone-500">
                          <div><div>Variedades</div><div className="font-semibold text-stone-800">{program.materials_count || 0}</div></div>
                          <div><div>Comprometido</div><div className="font-semibold text-stone-800">{fmt(program.quantity_committed_total)}</div></div>
                          <div><div>Entregado</div><div className="font-semibold text-stone-800">{fmt(program.delivered_total)}</div></div>
                          <div><div>Cumplimiento</div><div className="font-semibold text-stone-800">{pct(program.compliance_pct)}</div></div>
                        </div>
                      </button>
                    ))}
                    {!filteredPrograms.length ? <div className="px-5 py-8 text-sm text-stone-500">No hay programas agrícolas registrados.</div> : null}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {detailLoading ? (
                  <div className="flex justify-center py-20">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
                  </div>
                ) : detail ? (
                  <>
                    <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-widest text-stone-400">Detalle</div>
                          <h2 className="mt-1 text-2xl font-bold text-stone-900">{detail.program_code}</h2>
                          <p className="mt-1 text-sm text-stone-500">{detail.suppliers?.name} · {detail.material_labels}</p>
                          <p className="mt-1 text-xs text-stone-400">{detail.date_label}</p>
                        </div>
                        <button onClick={openEdit} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Editar</button>
                      </div>

                      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <KpiCard label="Variedades" value={detail.materials_count || 0} hint="Dentro del mismo programa" />
                        <KpiCard label="Comprometido" value={`${fmt(detail.quantity_committed_total)} ${detail.unit}`} />
                        <KpiCard label="Entregado" value={`${fmt(detail.delivered_total)} ${detail.unit}`} tone="green" />
                        <KpiCard label="% Cumplimiento" value={pct(detail.compliance_pct)} hint={detail.is_open_ended ? `Volumen ${pct(detail.volume_progress_pct)} · Programa indefinido` : `Tiempo ${pct(detail.time_progress_pct)} · Volumen ${pct(detail.volume_progress_pct)}`} />
                      </div>
                    </div>

                    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                      <h3 className="text-sm font-semibold text-stone-800">Variedades del programa</h3>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        {(detail.programa_agricola_items || []).map((item) => (
                          <div key={item.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                            <div className="text-sm font-semibold text-stone-800">{item.material_name}</div>
                            <div className="mt-1 text-xs text-stone-500">{item.material_code || 'Sin código'}</div>
                            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                              <div><div className="text-stone-400">Comprometido</div><div className="font-semibold text-stone-800">{fmt(item.quantity_committed_total)} {item.unit}</div></div>
                              <div><div className="text-stone-400">Entregado</div><div className="font-semibold text-stone-800">{fmt(item.delivered_total)} {item.unit}</div></div>
                              <div><div className="text-stone-400">Cumplimiento</div><div className="font-semibold text-stone-800">{pct(item.compliance_pct)}</div></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {detail.alerts?.length ? (
                      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                        <h3 className="text-sm font-semibold text-stone-800">Alertas</h3>
                        <div className="mt-4 space-y-3">
                          {detail.alerts.map((alert, index) => <AlertBox key={`${alert.type}-${index}`} alert={alert} />)}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
                        <div className="border-b border-stone-100 px-5 py-4">
                          <h3 className="text-sm font-semibold text-stone-800">Historial de recepciones asociadas</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-stone-100 bg-stone-50">
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Fecha</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Variedad</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Lote</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Aceptado</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Proveedor</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-50">
                              {(detail.receptions || []).map((row) => (
                                <tr key={row.id}>
                                  <td className="px-4 py-3 text-stone-700">{row.received_date}</td>
                                  <td className="px-4 py-3 text-stone-700">{row.materials?.common_name || 'Materia prima'}</td>
                                  <td className="px-4 py-3 text-stone-700">{row.supplier_lot || 'Sin lote'}</td>
                                  <td className="px-4 py-3 text-right text-stone-700">{fmt(row.quantity_accepted || row.quantity_received)}</td>
                                  <td className="px-4 py-3 text-stone-700">{row.suppliers?.name || detail.suppliers?.name}</td>
                                </tr>
                              ))}
                              {!(detail.receptions || []).length ? <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-stone-500">Sin recepciones asociadas todavía.</td></tr> : null}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
                        <div className="border-b border-stone-100 px-5 py-4">
                          <h3 className="text-sm font-semibold text-stone-800">Inventario trazado por programa</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-stone-100 bg-stone-50">
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Lote</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Variedad</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Original</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Disponible</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-50">
                              {(detail.inventoryLots || []).map((row) => (
                                <tr key={row.id}>
                                  <td className="px-4 py-3 text-stone-700">{row.internal_lot}</td>
                                  <td className="px-4 py-3 text-stone-700">{row.materials?.common_name || 'Materia prima'}</td>
                                  <td className="px-4 py-3 text-right text-stone-700">{fmt(row.original_quantity)}</td>
                                  <td className="px-4 py-3 text-right text-stone-700">{fmt(row.available_quantity)}</td>
                                </tr>
                              ))}
                              {!(detail.inventoryLots || []).length ? <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-stone-500">Todavía no hay lotes de inventario vinculados.</td></tr> : null}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-3xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-500 shadow-sm">Selecciona un programa para ver su detalle.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <Modal isOpen={showProgramModal} onClose={() => setShowProgramModal(false)} title={programForm.id ? 'Editar programa agrícola' : 'Nuevo programa agrícola'} maxWidth="max-w-6xl">
        <form onSubmit={handleSaveProgram} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <label className="space-y-2 text-sm xl:col-span-2">
              <span className="font-medium text-stone-700">Proveedor</span>
              <select value={programForm.supplier_id} onChange={(e) => setProgramForm((prev) => ({ ...prev, supplier_id: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]">
                <option value="">Selecciona</option>
                {catalogs.suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Código</span>
              <input value={programForm.program_code} readOnly className="w-full rounded-2xl border border-stone-300 bg-stone-100 px-4 py-3 text-stone-600 outline-none" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Inicio</span>
              <input type="date" value={programForm.start_date} onChange={(e) => setProgramForm((prev) => ({ ...prev, start_date: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Fin</span>
              <input type="date" value={programForm.end_date} disabled={programIsOpenEnded} onChange={(e) => setProgramForm((prev) => ({ ...prev, end_date: e.target.value }))} className={`w-full rounded-2xl border px-4 py-3 outline-none ${programIsOpenEnded ? 'border-stone-200 bg-stone-100 text-stone-400' : 'border-stone-300 bg-stone-50 focus:border-[#2f5d50]'}`} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Estado</span>
              <select value={programForm.status} onChange={(e) => setProgramForm((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]">
                <option value="borrador">Borrador</option>
                <option value="activo">Activo</option>
                <option value="pausado">Pausado</option>
                <option value="finalizado">Finalizado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
            <input type="checkbox" checked={programIsOpenEnded} onChange={(e) => setProgramForm((prev) => ({ ...prev, end_date: e.target.checked ? '' : (prev.start_date || today) }))} />
            Programa indefinido en el tiempo
          </label>

          <label className="space-y-2 text-sm">
            <span className="font-medium text-stone-700">Observaciones</span>
            <textarea rows={3} value={programForm.notes} onChange={(e) => setProgramForm((prev) => ({ ...prev, notes: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
          </label>

          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-stone-800">Variedades / materiales</div>
                <div className="text-xs text-stone-500">No se programan entregas aquí. El entregado se toma desde recepciones reales del proveedor y la variedad.</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-stone-700">Comprometido total: {fmt(totalFormCommitted)}</div>
                <button type="button" onClick={addProgramItem} className="rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Agregar variedad</button>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {(programForm.items || []).map((item, itemIndex) => (
                <div key={item.client_key || item.id || itemIndex} className="rounded-3xl border border-stone-200 bg-white p-4">
                  <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
                    <label className="space-y-2 text-sm md:col-span-2 xl:col-span-3">
                      <span className="font-medium text-stone-700">Variedad / material</span>
                      <select
                        value={item.material_id}
                        onChange={(e) => {
                          const material = findMaterial(e.target.value)
                          setProgramItem(itemIndex, {
                            material_id: e.target.value,
                            unit: material?.base_unit || item.unit,
                          })
                        }}
                        className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"
                      >
                        <option value="">Selecciona</option>
                        {catalogs.materials.map((row) => <option key={row.id} value={row.id}>{row.common_name} ({row.code})</option>)}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-stone-700">Cantidad</span>
                      <input type="number" step="0.0001" value={item.quantity_committed_total} onChange={(e) => setProgramItem(itemIndex, { quantity_committed_total: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-stone-700">Unidad</span>
                      <input value={item.unit} onChange={(e) => setProgramItem(itemIndex, { unit: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
                    </label>
                    <label className="space-y-2 text-sm md:col-span-2 xl:col-span-2">
                      <span className="font-medium text-stone-700">Nota de variedad</span>
                      <input value={item.notes || ''} onChange={(e) => setProgramItem(itemIndex, { notes: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]" />
                    </label>
                    <div className="flex items-end">
                      {(programForm.items || []).length > 1 ? <button type="button" onClick={() => removeProgramItem(itemIndex)} className="rounded-2xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50">Quitar</button> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setShowProgramModal(false)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar programa'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
