import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  closeSalesBudgetMonth,
  ensureSalesBudgetMonth,
  generateNextMonthSalesBudget,
  getSalesBudgetCatalogs,
  getSalesBudgetDashboard,
  saveSalesBudgetRows,
} from '../services/presupuestoVentasService'

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function money(value) {
  return `Q ${n(value).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(value) {
  return `${n(value).toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

function monthName(month) {
  return new Intl.DateTimeFormat('es-GT', { month: 'long' }).format(new Date(2026, month - 1, 1))
}

function KpiCard({ label, value, hint, tone = 'stone' }) {
  const toneClass = {
    stone: 'text-stone-900',
    green: 'text-emerald-700',
    red: 'text-rose-700',
    amber: 'text-amber-700',
  }

  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${toneClass[tone] || toneClass.stone}`}>{value}</div>
      {hint ? <div className="mt-2 text-xs text-stone-500">{hint}</div> : null}
    </div>
  )
}

function StatusPill({ status }) {
  const styles = {
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-rose-100 text-rose-700',
    neutral: 'bg-stone-100 text-stone-600',
  }
  const labels = {
    green: 'Adelante',
    red: 'Desviado',
    neutral: 'En línea',
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status] || styles.neutral}`}>
      {labels[status] || labels.neutral}
    </span>
  )
}

const currentDate = new Date()
const defaultFilters = {
  year: currentDate.getFullYear(),
  month: currentDate.getMonth() + 1,
  salespersonId: '',
  clientId: '',
}

export default function PresupuestoVentasPage() {
  const [filters, setFilters] = useState(defaultFilters)
  const [catalogs, setCatalogs] = useState({ clients: [], salespeople: [] })
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [nextPeriod, setNextPeriod] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await ensureSalesBudgetMonth(filters)
      const [catalogData, dashboardData] = await Promise.all([
        getSalesBudgetCatalogs(),
        getSalesBudgetDashboard(filters),
      ])
      setCatalogs(catalogData)
      setRows(dashboardData.rows)
      setSummary(dashboardData.summary)
      setNextPeriod(dashboardData.nextPeriod)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeRefresh(['sales_budgets', 'sales_projection_configs', 'sales_budget_closures', 'orders', 'clients'], load)

  const yearOptions = useMemo(() => {
    const year = currentDate.getFullYear()
    return [year - 1, year, year + 1]
  }, [])

  async function handleEnsureMonth() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await ensureSalesBudgetMonth(filters)
      await load()
      setSuccess('Metas mensuales generadas automáticamente para los clientes faltantes.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await saveSalesBudgetRows(rows)
      await load()
      setSuccess('Presupuesto y configuración de proyección guardados.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateNextMonth() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const result = await generateNextMonthSalesBudget(filters)
      setSuccess(`Se generó/actualizó presupuesto para ${monthName(result.nextPeriod.month)} ${result.nextPeriod.year}. Filas procesadas: ${result.generated.length}.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCloseMonth() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const result = await closeSalesBudgetMonth(filters)
      setSuccess(`Mes cerrado. Presupuestos del siguiente mes generados: ${result?.generated_count || 0}.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function updateRow(clientId, patch) {
    setRows((prev) => prev.map((row) => (row.client_id === clientId ? { ...row, ...patch } : row)))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Inteligencia comercial</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">Presupuesto de ventas</h1>
          <p className="mt-1 text-sm text-stone-500">
            La meta mensual se genera automáticamente por cliente y sigue siendo editable para ajuste comercial.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleEnsureMonth}
            disabled={saving}
            className="rounded-2xl border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Regenerar metas auto
          </button>
          <button
            onClick={handleGenerateNextMonth}
            disabled={saving || !rows.length}
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            Generar siguiente mes
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !rows.length}
            className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50"
          >
            Guardar cambios
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-2 text-sm">
            <span className="font-medium text-stone-700">Año</span>
            <select
              value={filters.year}
              onChange={(e) => setFilters((prev) => ({ ...prev, year: Number(e.target.value) }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"
            >
              {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium text-stone-700">Mes</span>
            <select
              value={filters.month}
              onChange={(e) => setFilters((prev) => ({ ...prev, month: Number(e.target.value) }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>{monthName(month)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm xl:col-span-2">
            <span className="font-medium text-stone-700">Vendedor</span>
            <select
              value={filters.salespersonId}
              onChange={(e) => setFilters((prev) => ({ ...prev, salespersonId: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"
            >
              <option value="">Todos</option>
              {catalogs.salespeople.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm xl:col-span-2">
            <span className="font-medium text-stone-700">Cliente</span>
            <select
              value={filters.clientId}
              onChange={(e) => setFilters((prev) => ({ ...prev, clientId: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-[#2f5d50]"
            >
              <option value="">Todos</option>
              {catalogs.clients.map((row) => <option key={row.id} value={row.id}>{row.commercial_name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Venta real" value={money(summary?.actual_total)} hint="Total del mes" />
        <KpiCard label="Presupuesto" value={money(summary?.budget_total)} hint="Meta mensual" />
        <KpiCard label="Esperado a la fecha" value={money(summary?.expected_total)} hint="Según avance del mes" />
        <KpiCard label="% cumplimiento" value={pct(summary?.compliance_pct)} hint={`${summary?.green_count || 0} clientes adelantados`} tone="green" />
        <KpiCard label="Desviación" value={pct(summary?.deviation_pct)} hint={`${summary?.red_count || 0} clientes en rojo`} tone={n(summary?.deviation_pct) >= 0 ? 'amber' : 'red'} />
      </div>

      <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-stone-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">Tabla editable por cliente</h2>
            <p className="text-xs text-stone-500">
              Meta automática y editable, con semáforo por desviación y proyección futura basada en historial.
            </p>
          </div>
          {nextPeriod ? (
            <div className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
              Próxima proyección: {monthName(nextPeriod.month)} {nextPeriod.year}
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-200 border-t-[#2f5d50]" />
          </div>
        ) : !rows.length ? (
          <div className="px-5 py-16 text-center text-sm text-stone-500">
            No hay clientes cargados para este presupuesto. Usa “Cargar clientes” para iniciar el mes.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '1500px' }}>
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50 text-xs uppercase tracking-wider text-stone-400">
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Vendedor</th>
                  <th className="px-4 py-3 text-right">Meta mensual</th>
                  <th className="px-4 py-3 text-right">Meta unidades</th>
                  <th className="px-4 py-3 text-right">Venta real</th>
                  <th className="px-4 py-3 text-right">Venta esperada</th>
                  <th className="px-4 py-3 text-right">Desviación</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Progreso</th>
                  <th className="px-4 py-3 text-center">Historial</th>
                  <th className="px-4 py-3 text-right">Proy. sig. mes</th>
                  <th className="px-4 py-3 text-center">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((row) => {
                  const progressPct = row.budget_amount > 0 ? Math.min(100, (row.actual_amount / row.budget_amount) * 100) : 0
                  const barClass = row.status_color === 'green'
                    ? 'bg-emerald-600'
                    : row.status_color === 'red'
                      ? 'bg-rose-600'
                      : 'bg-stone-400'

                  return (
                    <tr key={row.client_id} className="hover:bg-stone-50/60">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-stone-800">{row.client_name}</div>
                      </td>
                      <td className="px-4 py-3 text-stone-600">{row.salesperson_name || 'Sin vendedor'}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          value={row.budget_amount}
                          onChange={(e) => updateRow(row.client_id, { budget_amount: e.target.value, is_auto_generated: false })}
                          className="w-32 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-right outline-none focus:border-[#2f5d50]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.0001"
                          value={row.budget_units}
                          onChange={(e) => updateRow(row.client_id, { budget_units: e.target.value, is_auto_generated: false })}
                          className="w-28 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-right outline-none focus:border-[#2f5d50]"
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-stone-800">{money(row.actual_amount)}</td>
                      <td className="px-4 py-3 text-right text-stone-600">{money(row.expected_amount)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${row.deviation_pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{pct(row.deviation_pct)}</td>
                      <td className="px-4 py-3"><StatusPill status={row.status_color} /></td>
                      <td className="px-4 py-3">
                        <div className="w-40">
                          <div className="h-2.5 overflow-hidden rounded-full bg-stone-200">
                            <div className={`h-full rounded-full ${barClass}`} style={{ width: `${progressPct}%` }} />
                          </div>
                          <div className="mt-1 text-xs text-stone-500">{pct(row.compliance_pct)}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={row.history_months}
                          onChange={(e) => updateRow(row.client_id, { history_months: Number(e.target.value) })}
                          className="w-20 rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                        >
                          {[1, 2, 3, 4, 6, 12].map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-stone-700">{money(row.projected_next_amount)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.is_auto_generated ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'}`}>
                          {row.is_auto_generated ? 'Auto' : 'Manual'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleCloseMonth}
          disabled={saving || !rows.length}
          className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          Cerrar mes y proyectar siguiente
        </button>
      </div>
    </div>
  )
}
