import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  approvePlantingProject,
  calculateLineMetrics,
  getNextPlantingProjectCode,
  getPlantingProjectCatalogs,
  getPlantingProjectDetail,
  getPlantingProjects,
  getPlantingProjectsDashboard,
  savePlantingProject,
} from '../services/programasSiembraService'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function fmt(value, digits = 2) {
  return n(value).toLocaleString('es-GT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatDate(value) {
  if (!value) return '—'
  const [year, month, day] = String(value).slice(0, 10).split('-')
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('es-GT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const today = new Date().toISOString().slice(0, 10)

const emptyLine = {
  source_type: 'existing',
  material_id: '',
  proposed_material_name: '',
  variety: '',
  expected_volume: '',
  unit: 'lb',
  delivery_frequency: 'semanal',
  average_weight_per_plant: '',
  germination_rate: '0.90',
  survival_rate: '0.92',
  waste_rate: '0.04',
  rejection_rate: '0.03',
  days_to_harvest: '30',
  cells_per_tray: '128',
  first_harvest_target_date: today,
  notes: '',
}

const emptyProject = {
  id: null,
  project_code: '',
  project_name: '',
  client_id: '',
  commercial_channel: '',
  production_unit: '',
  location: '',
  start_date: today,
  end_date: today,
  status: 'borrador',
  notes: '',
  lines: [{ ...emptyLine }],
}

function KpiCard({ label, value, hint = '', tone = 'stone' }) {
  const styles = {
    stone: 'text-stone-900',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
  }

  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${styles[tone] || styles.stone}`}>{value}</div>
      {hint ? <div className="mt-2 text-xs text-stone-500">{hint}</div> : null}
    </div>
  )
}

function statusPill(status) {
  const styles = {
    borrador: 'bg-stone-100 text-stone-600',
    pendiente_aprobacion: 'bg-amber-100 text-amber-700',
    aprobado: 'bg-emerald-100 text-emerald-700',
    en_ejecucion: 'bg-emerald-100 text-emerald-700',
    cerrado: 'bg-slate-100 text-slate-700',
    cancelado: 'bg-rose-100 text-rose-700',
    rechazado: 'bg-rose-100 text-rose-700',
    fusionada: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status] || styles.borrador}`}>
      {String(status || 'borrador').replaceAll('_', ' ')}
    </span>
  )
}

function consolidateWeekly(rows) {
  const map = new Map()
  ;(rows || []).forEach((row) => {
    const key = row.week_start
    const current = map.get(key) || {
      week_start: row.week_start,
      week_end: row.week_end,
      expected_volume: 0,
      harvestable_plants_required: 0,
      plants_to_sow: 0,
      seeds_required: 0,
      trays_required: 0,
    }
    current.expected_volume += n(row.expected_volume)
    current.harvestable_plants_required += n(row.harvestable_plants_required)
    current.plants_to_sow += n(row.plants_to_sow)
    current.seeds_required += n(row.seeds_required)
    current.trays_required += n(row.trays_required)
    map.set(key, current)
  })
  return [...map.values()].sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)))
}

function buildLineFromMaterial(material) {
  const profile = material?.agronomic_profile || {}
  return {
    ...emptyLine,
    source_type: 'existing',
    material_id: material?.id || '',
    variety: profile.default_variety || '',
    unit: profile.commercial_unit || material?.base_unit || 'lb',
    average_weight_per_plant: profile.standard_weight_per_plant ? String(profile.standard_weight_per_plant) : '',
    germination_rate: String(profile.standard_germination_rate ?? 0.9),
    survival_rate: String(profile.standard_survival_rate ?? 0.92),
    waste_rate: String(profile.standard_waste_rate ?? 0.04),
    rejection_rate: String(profile.standard_rejection_rate ?? 0.03),
    days_to_harvest: String(profile.standard_days_to_harvest ?? 30),
    cells_per_tray: String(profile.cells_per_tray ?? 128),
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderPdfTable(headers, rows) {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join('')}</tr>`,
    )
    .join('')

  return `
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `
}

function openPlantingProjectPdf(detail, detailWeekly) {
  if (!detail) return
  const linesRows = (detail.lines || []).map((line) => [
    line.materials?.common_name || line.proposed_material?.proposed_name || 'Materia prima',
    line.variety || '—',
    fmt(line.expected_volume),
    fmt(line.average_weight_per_plant, 3),
    fmt(line.metrics?.plants_harvestable_required, 0),
    fmt(line.metrics?.plants_to_sow_total, 0),
    fmt(line.metrics?.seeds_required_total, 0),
    fmt(line.metrics?.trays_required_total, 0),
    formatDate(line.metrics?.suggested_seed_date),
    formatDate(line.first_harvest_target_date),
  ])

  const weeklyRows = (detailWeekly || []).map((row) => [
    `${formatDate(row.week_start)} al ${formatDate(row.week_end)}`,
    fmt(row.expected_volume),
    fmt(row.plants_to_sow, 0),
    fmt(row.seeds_required, 0),
    fmt(row.trays_required, 0),
  ])

  const reportHtml = `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Plan de siembra ${escapeHtml(detail.project_code)}</title>
        <style>
          @page { size: A4 portrait; margin: 16mm; }
          body { font-family: Arial, sans-serif; color: #1c1917; margin: 0; }
          h1, h2, h3, p { margin: 0; }
          .header { border-bottom: 2px solid #2f5d50; padding-bottom: 14px; margin-bottom: 18px; }
          .eyebrow { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #78716c; font-weight: 700; }
          .title { font-size: 28px; font-weight: 700; margin-top: 6px; }
          .subtitle { margin-top: 6px; font-size: 13px; color: #57534e; }
          .section { margin-top: 18px; }
          .section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .12em; color: #78716c; margin-bottom: 10px; }
          .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
          .card { border: 1px solid #e7e5e4; border-radius: 14px; padding: 12px; background: #fafaf9; }
          .card .label { font-size: 10px; text-transform: uppercase; letter-spacing: .14em; color: #a8a29e; font-weight: 700; }
          .card .value { margin-top: 6px; font-size: 20px; font-weight: 700; color: #1c1917; }
          .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 16px; font-size: 12px; color: #44403c; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th { text-align: left; padding: 8px; background: #f5f5f4; color: #78716c; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; }
          td { padding: 8px; border-bottom: 1px solid #f0efed; vertical-align: top; }
          .note { margin-top: 8px; font-size: 12px; color: #57534e; line-height: 1.5; }
          .badge { display: inline-block; padding: 5px 10px; border-radius: 999px; background: #d1fae5; color: #065f46; font-size: 11px; font-weight: 700; text-transform: uppercase; }
          .muted { color: #78716c; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="eyebrow">ERP · Abastecimiento</div>
          <h1 class="title">Plan de siembra</h1>
          <p class="subtitle">${escapeHtml(detail.project_code)} · ${escapeHtml(detail.project_name)}</p>
        </div>

        <div class="section">
          <div class="meta">
            <div><strong>Cliente / canal:</strong> ${escapeHtml(detail.clients?.commercial_name || detail.commercial_channel || 'Sin cliente')}</div>
            <div><strong>Estado:</strong> ${escapeHtml(String(detail.status || '').replaceAll('_', ' '))}</div>
            <div><strong>Finca / unidad:</strong> ${escapeHtml(detail.production_unit || 'Sin unidad')}</div>
            <div><strong>Ubicación:</strong> ${escapeHtml(detail.location || 'Sin ubicación')}</div>
            <div><strong>Inicio:</strong> ${escapeHtml(formatDate(detail.start_date))}</div>
            <div><strong>Fin:</strong> ${escapeHtml(formatDate(detail.end_date))}</div>
          </div>
          ${detail.notes ? `<p class="note"><strong>Observaciones:</strong> ${escapeHtml(detail.notes)}</p>` : ''}
        </div>

        <div class="section">
          <h2>Resumen ejecutivo</h2>
          <div class="grid">
            <div class="card"><div class="label">Volumen planificado</div><div class="value">${escapeHtml(fmt(detail.summary?.total_expected_volume))}</div></div>
            <div class="card"><div class="label">Plantas a sembrar</div><div class="value">${escapeHtml(fmt(detail.summary?.total_plants_to_sow, 0))}</div></div>
            <div class="card"><div class="label">Semillas</div><div class="value">${escapeHtml(fmt(detail.summary?.total_seeds_required, 0))}</div></div>
            <div class="card"><div class="label">Bandejas</div><div class="value">${escapeHtml(fmt(detail.summary?.total_trays_required, 0))}</div></div>
          </div>
        </div>

          <div class="section">
          <h2>Detalle por materia prima</h2>
            ${renderPdfTable(
            ['Materia prima', 'Variedad', 'Volumen', 'Peso/planta (oz)', 'Plantas cosechables', 'Plantas a sembrar', 'Semillas', 'Bandejas', 'Fecha siembra', 'Primera cosecha'],
            linesRows,
          )}
        </div>

        <div class="section">
          <h2>Calendario semanal consolidado</h2>
          ${renderPdfTable(
            ['Semana', 'Volumen', 'Plantas a sembrar', 'Semillas', 'Bandejas'],
            weeklyRows,
          )}
        </div>

        ${(detail.proposedMaterials?.length || 0) > 0 ? `
          <div class="section">
            <h2>Materias primas propuestas</h2>
            ${renderPdfTable(
              ['Propuesta', 'Estado', 'Creador'],
              detail.proposedMaterials.map((row) => [
                row.proposed_name,
                String(row.status || '').replaceAll('_', ' '),
                row.creator?.full_name || 'Sistema',
              ]),
            )}
          </div>
        ` : ''}
      </body>
    </html>
  `

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const frameWindow = iframe.contentWindow
  const frameDocument = frameWindow?.document
  if (!frameWindow || !frameDocument) {
    document.body.removeChild(iframe)
    return
  }

  frameDocument.open()
  frameDocument.write(reportHtml)
  frameDocument.close()

  const cleanup = () => {
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe)
      }
    }, 1200)
  }

  frameWindow.onafterprint = cleanup
  setTimeout(() => {
    frameWindow.focus()
    frameWindow.print()
  }, 400)
}

export default function ProgramasSiembraPage() {
  const [dashboard, setDashboard] = useState(null)
  const [projects, setProjects] = useState([])
  const [catalogs, setCatalogs] = useState({ clients: [], materials: [] })
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [filters, setFilters] = useState({ search: '', status: '', clientId: '' })
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyProject)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [dashboardData, projectsData, catalogData] = await Promise.all([
        getPlantingProjectsDashboard(),
        getPlantingProjects(filters),
        getPlantingProjectCatalogs(),
      ])
      setDashboard(dashboardData)
      setProjects(projectsData)
      setCatalogs(catalogData)
      if (!selectedId && projectsData[0]?.id) setSelectedId(projectsData[0].id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters, selectedId])

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    setError('')
    try {
      setDetail(await getPlantingProjectDetail(selectedId))
    } catch (e) {
      setError(e.message)
    } finally {
      setDetailLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  useRealtimeRefresh(
    [
      'planting_projects',
      'planting_project_lines',
      'planting_project_proposed_materials',
      'planting_project_weekly_plans',
      'planting_project_supply_requirements',
      'planting_project_audit_logs',
      'materials',
      'material_agronomic_profiles',
      'material_inventory_lots',
    ],
    () => {
      load()
      loadDetail()
    },
  )

  const previewLines = useMemo(
    () =>
      (form.lines || []).map((line) => ({
        ...line,
        metrics: calculateLineMetrics(
          {
            ...line,
            expected_volume: n(line.expected_volume),
            average_weight_per_plant: n(line.average_weight_per_plant),
            germination_rate: n(line.germination_rate),
            survival_rate: n(line.survival_rate),
            waste_rate: n(line.waste_rate),
            rejection_rate: n(line.rejection_rate),
            days_to_harvest: n(line.days_to_harvest),
            cells_per_tray: n(line.cells_per_tray),
          },
          { start_date: form.start_date, end_date: form.end_date },
        ),
      })),
    [form],
  )

  const previewWeekly = useMemo(
    () => consolidateWeekly(previewLines.flatMap((line) => line.metrics.weekly_plans || [])),
    [previewLines],
  )

  const previewTotals = useMemo(
    () => ({
      volume: previewLines.reduce((acc, row) => acc + n(row.expected_volume), 0),
      plants: previewLines.reduce((acc, row) => acc + n(row.metrics.plants_to_sow_total), 0),
      seeds: previewLines.reduce((acc, row) => acc + n(row.metrics.seeds_required_total), 0),
      trays: previewLines.reduce((acc, row) => acc + n(row.metrics.trays_required_total), 0),
    }),
    [previewLines],
  )

  async function openCreate() {
    setError('')
    try {
      const nextCode = await getNextPlantingProjectCode()
      setForm({ ...emptyProject, project_code: nextCode, lines: [{ ...emptyLine }] })
      setShowModal(true)
    } catch (e) {
      setError(e.message)
    }
  }

  function openEdit() {
    if (!detail) return
    setForm({
      id: detail.id,
      project_code: detail.project_code,
      project_name: detail.project_name || '',
      client_id: detail.client_id || '',
      commercial_channel: detail.commercial_channel || '',
      production_unit: detail.production_unit || '',
      location: detail.location || '',
      start_date: detail.start_date,
      end_date: detail.end_date,
      status: detail.status,
      notes: detail.notes || '',
      lines: (detail.lines || []).map((line) => ({
        source_type: line.material_id ? 'existing' : 'proposed',
        material_id: line.material_id || '',
        proposed_material_name: line.proposed_material?.proposed_name || '',
        variety: line.variety || '',
        expected_volume: String(line.expected_volume || ''),
        unit: line.unit || 'lb',
        delivery_frequency: line.delivery_frequency || 'semanal',
        average_weight_per_plant: String(line.average_weight_per_plant || ''),
        germination_rate: String(line.germination_rate ?? 0.9),
        survival_rate: String(line.survival_rate ?? 0.92),
        waste_rate: String(line.waste_rate ?? 0.04),
        rejection_rate: String(line.rejection_rate ?? 0.03),
        days_to_harvest: String(line.days_to_harvest ?? 30),
        cells_per_tray: String(line.cells_per_tray ?? 128),
        first_harvest_target_date: line.first_harvest_target_date,
        notes: line.notes || '',
      })),
    })
    setShowModal(true)
  }

  function updateLine(index, patch) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    }))
  }

  function setLineMaterial(index, materialId) {
    const material = catalogs.materials.find((row) => row.id === materialId)
    updateLine(index, buildLineFromMaterial(material))
  }

  function addLine(sourceType = 'existing') {
    setForm((prev) => ({
      ...prev,
      lines: [...prev.lines, { ...emptyLine, source_type: sourceType }],
    }))
  }

  function removeLine(index) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.length <= 1 ? prev.lines : prev.lines.filter((_, lineIndex) => lineIndex !== index),
    }))
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const projectId = await savePlantingProject({
        ...form,
        lines: (form.lines || []).map((line) => ({
          ...line,
          material_id: line.source_type === 'existing' ? line.material_id || null : null,
          proposed_material_name: line.source_type === 'proposed' ? line.proposed_material_name : '',
        })),
      })
      setShowModal(false)
      setSelectedId(projectId)
      setSuccess('Proyecto de siembra guardado correctamente.')
      await load()
      setDetail(await getPlantingProjectDetail(projectId))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove() {
    if (!detail) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const result = await approvePlantingProject(detail.id)
      setSuccess(
        result.createdMaterials.length
          ? `Proyecto aprobado. Se crearon ${result.createdMaterials.length} materias primas nuevas en el maestro.`
          : 'Proyecto aprobado correctamente.',
      )
      await load()
      await loadDetail()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const filteredProjects = useMemo(() => {
    return (projects || []).filter((row) => {
      const matchesSearch = !filters.search || `${row.project_code} ${row.project_name}`.toLowerCase().includes(filters.search.toLowerCase())
      const matchesStatus = !filters.status || row.status === filters.status
      const matchesClient = !filters.clientId || row.client_id === filters.clientId
      return matchesSearch && matchesStatus && matchesClient
    })
  }, [filters, projects])

  const detailWeekly = useMemo(() => consolidateWeekly(detail?.weeklyPlans || []), [detail])

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">ERP · Abastecimiento</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Programas de siembra</h1>
            <p className="mt-1 text-sm text-stone-500">
              Planea siembras mult cultivo, propone nuevas materias primas desde el proyecto y calcula plantas, semillas y bandejas por semana.
            </p>
          </div>
          <button onClick={openCreate} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
            + Proyecto
          </button>
        </div>

        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

        {loading ? (
          <div className="flex justify-center py-12"><div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" /></div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <KpiCard label="Proyectos" value={dashboard?.total_projects || 0} hint={`${dashboard?.approved_projects || 0} aprobados`} />
              <KpiCard label="Plantas planificadas" value={fmt(dashboard?.plants_planned, 0)} hint="Total semanal consolidado" tone="green" />
              <KpiCard label="Semillas" value={fmt(dashboard?.seeds_required, 0)} hint="Requeridas" />
              <KpiCard label="Bandejas" value={fmt(dashboard?.trays_required, 0)} hint="Estimadas" />
              <KpiCard label="Nuevas MP propuestas" value={dashboard?.proposed_materials || 0} hint={`${dashboard?.created_from_projects || 0} ya creadas`} tone="amber" />
            </div>

            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-stone-700">Buscar</span>
                  <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Código o nombre" className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-stone-700">Estado</span>
                  <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]">
                    <option value="">Todos</option>
                    <option value="borrador">Borrador</option>
                    <option value="pendiente_aprobacion">Pendiente aprobación</option>
                    <option value="aprobado">Aprobado</option>
                    <option value="en_ejecucion">En ejecución</option>
                    <option value="cerrado">Cerrado</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-stone-700">Cliente / canal</span>
                  <select value={filters.clientId} onChange={(e) => setFilters((prev) => ({ ...prev, clientId: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]">
                    <option value="">Todos</option>
                    {(catalogs.clients || []).map((client) => <option key={client.id} value={client.id}>{client.commercial_name}</option>)}
                  </select>
                </label>
                <div className="flex items-end">
                  <button onClick={() => setFilters({ search: '', status: '', clientId: '' })} className="w-full rounded-2xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                    Limpiar filtros
                  </button>
                </div>
              </div>
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-[0.95fr_1.45fr]">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
                  <div className="border-b border-stone-100 px-5 py-4"><h2 className="text-sm font-semibold text-stone-800">Proyectos</h2></div>
                  <div className="divide-y divide-stone-100">
                    {filteredProjects.map((project) => (
                      <button key={project.id} onClick={() => setSelectedId(project.id)} className={`block w-full px-5 py-4 text-left transition hover:bg-stone-50 ${selectedId === project.id ? 'bg-stone-50' : 'bg-white'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-stone-800">{project.project_code}</div>
                            <div className="text-sm text-stone-500">{project.project_name}</div>
                            <div className="mt-1 text-xs text-stone-400">{project.clients?.commercial_name || project.commercial_channel || 'Sin cliente'} · {project.production_unit || 'Sin finca'}</div>
                          </div>
                          {statusPill(project.status)}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-stone-500">
                          <div><div>Líneas</div><div className="font-semibold text-stone-800">{project.total_lines || 0}</div></div>
                          <div><div>Volumen</div><div className="font-semibold text-stone-800">{fmt(project.total_expected_volume)}</div></div>
                          <div><div>Nuevas MP</div><div className="font-semibold text-stone-800">{project.proposed_pending_count || 0}</div></div>
                        </div>
                      </button>
                    ))}
                    {!filteredProjects.length ? <div className="px-5 py-8 text-sm text-stone-500">No hay proyectos de siembra con esos filtros.</div> : null}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {detailLoading ? (
                  <div className="flex justify-center py-20"><div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" /></div>
                ) : detail ? (
                  <>
                    <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Detalle</div>
                          <h2 className="mt-1 text-2xl font-bold text-stone-900">{detail.project_code}</h2>
                          <p className="mt-1 text-sm text-stone-500">{detail.project_name}</p>
                          <p className="mt-1 text-xs text-stone-400">{detail.clients?.commercial_name || detail.commercial_channel || 'Sin cliente'} · {detail.production_unit || 'Sin unidad'} · {detail.location || 'Sin ubicación'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => openPlantingProjectPdf(detail, detailWeekly)} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">PDF</button>
                          <button onClick={openEdit} className="rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Editar</button>
                          {!['aprobado', 'en_ejecucion', 'cerrado'].includes(detail.status) ? <button onClick={handleApprove} disabled={saving} className="rounded-2xl border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Aprobar proyecto</button> : null}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {statusPill(detail.status)}
                        {detail.approver?.full_name ? <span className="text-xs text-stone-500">Aprobó: {detail.approver.full_name}</span> : null}
                      </div>

                      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <KpiCard label="Volumen planificado" value={fmt(detail.summary?.total_expected_volume)} />
                        <KpiCard label="Plantas a sembrar" value={fmt(detail.summary?.total_plants_to_sow, 0)} tone="green" />
                        <KpiCard label="Semillas" value={fmt(detail.summary?.total_seeds_required, 0)} />
                        <KpiCard label="Bandejas" value={fmt(detail.summary?.total_trays_required, 0)} hint={`${detail.summary?.proposed_materials_count || 0} nuevas MP pendientes`} tone="amber" />
                      </div>
                    </div>

                    {(detail.proposedMaterials?.length || 0) > 0 ? (
                      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                        <h3 className="text-sm font-semibold text-stone-800">Materias primas propuestas</h3>
                        <div className="mt-4 space-y-3">
                          {detail.proposedMaterials.map((proposal) => (
                            <div key={proposal.id} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-stone-800">{proposal.proposed_name}</div>
                                  <div className="mt-1 text-xs text-stone-500">Propuso: {proposal.creator?.full_name || 'Sistema'}</div>
                                </div>
                                {statusPill(proposal.status)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
                      <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Líneas del proyecto</h3></div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-stone-100 bg-stone-50">
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Materia prima</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Volumen</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Plantas</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Semillas</th>
                              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Bandejas</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Siembra sugerida</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-50">
                            {(detail.lines || []).map((line) => (
                              <tr key={line.id}>
                                <td className="px-4 py-3 text-stone-700">
                                  <div className="font-medium text-stone-800">{line.materials?.common_name || line.proposed_material?.proposed_name}</div>
                                  <div className="text-xs text-stone-500">{line.variety || 'Sin variedad'} · {line.delivery_frequency}</div>
                                </td>
                                <td className="px-4 py-3 text-right text-stone-700">{fmt(line.expected_volume)}</td>
                                <td className="px-4 py-3 text-right text-stone-700">{fmt(line.metrics?.plants_to_sow_total, 0)}</td>
                                <td className="px-4 py-3 text-right text-stone-700">{fmt(line.metrics?.seeds_required_total, 0)}</td>
                                <td className="px-4 py-3 text-right text-stone-700">{fmt(line.metrics?.trays_required_total, 0)}</td>
                                <td className="px-4 py-3 text-stone-700">{formatDate(line.metrics?.suggested_seed_date)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                      <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
                        <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Calendario semanal consolidado</h3></div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-stone-100 bg-stone-50">
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Semana</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Volumen</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Plantas</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Semillas</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Bandejas</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-50">
                              {detailWeekly.map((row) => (
                                <tr key={row.week_start}>
                                  <td className="px-4 py-3 text-stone-700">{formatDate(row.week_start)} · {formatDate(row.week_end)}</td>
                                  <td className="px-4 py-3 text-right text-stone-700">{fmt(row.expected_volume)}</td>
                                  <td className="px-4 py-3 text-right text-stone-700">{fmt(row.plants_to_sow, 0)}</td>
                                  <td className="px-4 py-3 text-right text-stone-700">{fmt(row.seeds_required, 0)}</td>
                                  <td className="px-4 py-3 text-right text-stone-700">{fmt(row.trays_required, 0)}</td>
                                </tr>
                              ))}
                              {!detailWeekly.length ? <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-stone-500">Sin calendario generado.</td></tr> : null}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
                        <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Insumos y faltantes del plan</h3><p className="mt-1 text-xs text-stone-500">Esta sección se consulta dentro del ERP y ya no se imprime en el PDF.</p></div>
                        <div className="divide-y divide-stone-100">
                          {(detail.supplyRequirements || []).map((row) => (
                            <div key={row.id} className="px-5 py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-stone-800">{row.requirement_name}</div>
                                  <div className="mt-1 text-xs text-stone-500">{row.requirement_type} · Disponible {fmt(row.quantity_available)}</div>
                                </div>
                                <div className={`text-sm font-semibold ${n(row.shortage_quantity) > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{n(row.shortage_quantity) > 0 ? `Falta ${fmt(row.shortage_quantity)}` : 'Cubierto'}</div>
                              </div>
                            </div>
                          ))}
                          {!detail.supplyRequirements?.length ? <div className="px-5 py-8 text-sm text-stone-500">Sin consumos proyectados todavía.</div> : null}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                      <h3 className="text-sm font-semibold text-stone-800">Auditoría</h3>
                      <div className="mt-4 space-y-3">
                        {(detail.auditLogs || []).slice(0, 8).map((log) => (
                          <div key={log.id} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-stone-800">{log.event_type.replaceAll('_', ' ')}</div>
                                <div className="mt-1 text-xs text-stone-500">{log.event_notes || 'Sin comentario adicional'}</div>
                              </div>
                              <div className="text-xs text-stone-400">{log.profiles?.full_name || 'Sistema'} · {formatDateTime(log.created_at)}</div>
                            </div>
                          </div>
                        ))}
                        {!detail.auditLogs?.length ? <p className="text-sm text-stone-500">Sin auditoría registrada todavía.</p> : null}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-3xl border border-stone-200 bg-white px-6 py-16 text-center text-stone-500 shadow-sm">Selecciona un proyecto para ver su detalle.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={form.id ? 'Editar proyecto de siembra' : 'Nuevo proyecto de siembra'} maxWidth="max-w-6xl">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Código</span>
              <input value={form.project_code} readOnly className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-stone-600" />
            </label>
            <label className="space-y-2 text-sm xl:col-span-2">
              <span className="font-medium text-stone-700">Nombre del proyecto</span>
              <input value={form.project_name} onChange={(e) => setForm((prev) => ({ ...prev, project_name: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" required />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Estado</span>
              <select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]">
                <option value="borrador">Borrador</option>
                <option value="pendiente_aprobacion">Pendiente aprobación</option>
                <option value="aprobado">Aprobado</option>
                <option value="en_ejecucion">En ejecución</option>
                <option value="cerrado">Cerrado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Cliente</span>
              <select value={form.client_id} onChange={(e) => { const client = catalogs.clients.find((row) => row.id === e.target.value); setForm((prev) => ({ ...prev, client_id: e.target.value, commercial_channel: client?.channel || prev.commercial_channel })) }} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]">
                <option value="">Sin cliente</option>
                {(catalogs.clients || []).map((client) => <option key={client.id} value={client.id}>{client.commercial_name}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Canal comercial</span>
              <input value={form.commercial_channel} onChange={(e) => setForm((prev) => ({ ...prev, commercial_channel: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Finca / unidad productiva</span>
              <input value={form.production_unit} onChange={(e) => setForm((prev) => ({ ...prev, production_unit: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Ubicación</span>
              <input value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Inicio</span>
              <input type="date" value={form.start_date} onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Fin</span>
              <input type="date" value={form.end_date} onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" />
            </label>
          </div>

          <label className="space-y-2 text-sm">
            <span className="font-medium text-stone-700">Observaciones</span>
            <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} rows={2} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-[#2f5d50]" />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-800">Materias primas del proyecto</h3>
              <p className="mt-1 text-xs text-stone-500">Selecciona del catálogo o propone una nueva materia prima en texto libre.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => addLine('existing')} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Agregar materia prima</button>
              <button type="button" onClick={() => addLine('proposed')} className="rounded-2xl border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50">Proponer nueva materia prima</button>
            </div>
          </div>

          <div className="space-y-4">
            {form.lines.map((line, index) => {
              const preview = previewLines[index]?.metrics
              return (
                <div key={`line-${index}`} className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-stone-800">Línea {index + 1}</div>
                    <button type="button" onClick={() => removeLine(index)} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">Eliminar</button>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Origen</span><select value={line.source_type} onChange={(e) => updateLine(index, { ...emptyLine, source_type: e.target.value, first_harvest_target_date: line.first_harvest_target_date || today })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]"><option value="existing">Existente</option><option value="proposed">Nueva propuesta</option></select></label>
                    {line.source_type === 'existing' ? (
                      <label className="space-y-2 text-sm xl:col-span-2"><span className="font-medium text-stone-700">Materia prima existente</span><select value={line.material_id} onChange={(e) => setLineMaterial(index, e.target.value)} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]"><option value="">Selecciona una materia prima</option>{(catalogs.materials || []).map((row) => <option key={row.id} value={row.id}>{row.common_name} ({row.code})</option>)}</select></label>
                    ) : (
                      <label className="space-y-2 text-sm xl:col-span-2"><span className="font-medium text-stone-700">Nueva materia prima propuesta</span><input value={line.proposed_material_name} onChange={(e) => updateLine(index, { proposed_material_name: e.target.value })} placeholder="Ej. Romana baby" className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    )}
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Variedad</span><input value={line.variety} onChange={(e) => updateLine(index, { variety: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Volumen esperado</span><input type="number" min="0" step="0.0001" value={line.expected_volume} onChange={(e) => updateLine(index, { expected_volume: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Unidad</span><input value={line.unit} onChange={(e) => updateLine(index, { unit: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Frecuencia entrega</span><select value={line.delivery_frequency} onChange={(e) => updateLine(index, { delivery_frequency: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]"><option value="unica">Única</option><option value="diaria">Diaria</option><option value="semanal">Semanal</option><option value="quincenal">Quincenal</option><option value="mensual">Mensual</option></select></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Peso por planta (oz)</span><input type="number" min="0" step="0.000001" value={line.average_weight_per_plant} onChange={(e) => updateLine(index, { average_weight_per_plant: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">% germinación</span><input type="number" min="0" max="1" step="0.0001" value={line.germination_rate} onChange={(e) => updateLine(index, { germination_rate: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">% supervivencia</span><input type="number" min="0" max="1" step="0.0001" value={line.survival_rate} onChange={(e) => updateLine(index, { survival_rate: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">% merma</span><input type="number" min="0" max="1" step="0.0001" value={line.waste_rate} onChange={(e) => updateLine(index, { waste_rate: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">% rechazo comercial</span><input type="number" min="0" max="1" step="0.0001" value={line.rejection_rate} onChange={(e) => updateLine(index, { rejection_rate: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Días a cosecha</span><input type="number" min="1" step="1" value={line.days_to_harvest} onChange={(e) => updateLine(index, { days_to_harvest: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Celdas por bandeja</span><input type="number" min="1" step="1" value={line.cells_per_tray} onChange={(e) => updateLine(index, { cells_per_tray: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                    <label className="space-y-2 text-sm"><span className="font-medium text-stone-700">Primera cosecha objetivo</span><input type="date" value={line.first_harvest_target_date} onChange={(e) => updateLine(index, { first_harvest_target_date: e.target.value })} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 outline-none focus:border-[#2f5d50]" /></label>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-wide text-stone-400">Plantas cosechables</div><div className="mt-1 text-lg font-semibold text-stone-900">{fmt(preview?.plants_harvestable_required, 0)}</div></div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-wide text-stone-400">Plantas a sembrar</div><div className="mt-1 text-lg font-semibold text-stone-900">{fmt(preview?.plants_to_sow_total, 0)}</div></div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-wide text-stone-400">Semillas</div><div className="mt-1 text-lg font-semibold text-stone-900">{fmt(preview?.seeds_required_total, 0)}</div></div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-wide text-stone-400">Bandejas</div><div className="mt-1 text-lg font-semibold text-stone-900">{fmt(preview?.trays_required_total, 0)}</div></div>
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3"><div className="text-xs uppercase tracking-wide text-stone-400">Siembra sugerida</div><div className="mt-1 text-sm font-semibold text-stone-900">{formatDate(preview?.suggested_seed_date)}</div></div>
                  </div>

                  <label className="mt-4 block space-y-2 text-sm">
                    <span className="font-medium text-stone-700">Observaciones de línea</span>
                    <textarea value={line.notes} onChange={(e) => updateLine(index, { notes: e.target.value })} rows={2} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-[#2f5d50]" />
                  </label>
                </div>
              )
            })}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-stone-800">Totales del proyecto</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Volumen" value={fmt(previewTotals.volume)} />
                <KpiCard label="Plantas" value={fmt(previewTotals.plants, 0)} />
                <KpiCard label="Semillas" value={fmt(previewTotals.seeds, 0)} />
                <KpiCard label="Bandejas" value={fmt(previewTotals.trays, 0)} />
              </div>
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-stone-800">Calendario semanal previo</h3>
              <div className="mt-4 max-h-64 overflow-y-auto"><div className="space-y-2">{previewWeekly.map((row) => <div key={row.week_start} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3"><div className="text-sm font-semibold text-stone-800">{formatDate(row.week_start)} · {formatDate(row.week_end)}</div><div className="mt-1 text-xs text-stone-500">{fmt(row.plants_to_sow, 0)} plantas · {fmt(row.seeds_required, 0)} semillas · {fmt(row.trays_required, 0)} bandejas</div></div>)}{!previewWeekly.length ? <div className="text-sm text-stone-500">Completa los parámetros para generar el calendario.</div> : null}</div></div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => setShowModal(false)} className="rounded-2xl border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">Guardar proyecto</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
