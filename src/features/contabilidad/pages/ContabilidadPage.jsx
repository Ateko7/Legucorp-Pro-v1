import { useEffect, useState, useCallback } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  initAccounting, IVA_RATE,
  getSalesLedger, getJournalEntries, getAccounts,
  getAllCostCenters, saveCostCenter, toggleCostCenterActive, getCostCenterSummary,
  getAccountingPeriods, updateAccountingPeriodStatus,
  getFiscalProfiles, saveFiscalProfile,
  getAccountingEventTypes, saveAccountingEventType, getAccountingSourceLinks,
  getTaxConfiguration, saveTaxConfiguration, getVatReport,
  getIsrProjection, saveIsrAdjustment, getIsoDashboard,
  getIndustrialCostReport, saveIndustrialCostSnapshots,
} from '../services/contabilidadService'
import BankReconciliationPanel from './BankReconciliationPanel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pct(v) { return `${n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` }

const today = new Date().toISOString().slice(0, 10)
const firstOfMonth = today.slice(0, 7) + '-01'

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}
function Alert({ type = 'error', children }) {
  const s = { error: 'border-red-200 bg-red-50 text-red-700', success: 'border-emerald-200 bg-emerald-50 text-emerald-700', info: 'border-sky-200 bg-sky-50 text-sky-700' }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${s[type]}`}>{children}</div>
}

const ACCOUNT_TYPE_LABEL = { activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio', ingreso: 'Ingreso', egreso: 'Egreso', costo: 'Costo' }
const ACCOUNT_TYPE_COLOR = {
  activo:     'bg-blue-100 text-blue-700',
  pasivo:     'bg-red-100 text-red-700',
  patrimonio: 'bg-purple-100 text-purple-700',
  ingreso:    'bg-emerald-100 text-emerald-700',
  egreso:     'bg-amber-100 text-amber-700',
  costo:      'bg-orange-100 text-orange-700',
}
const PERIOD_STATUS_COLOR = {
  abierto: 'bg-emerald-100 text-emerald-700',
  cerrado: 'bg-amber-100 text-amber-700',
  bloqueado: 'bg-rose-100 text-rose-700',
}
const PROFILE_TYPE_LABEL = {
  cuenta: 'Cuenta',
  documento: 'Documento',
  proveedor: 'Proveedor',
  gasto: 'Gasto',
}

// ─── Libro de ventas ──────────────────────────────────────────────────────────

function LibroVentas() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setRows(await getSalesLedger(dateFrom, dateTo)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['journal_entries', 'accounts'], load)

  const totalBase  = rows.reduce((a, r) => a + r.base, 0)
  const totalIva   = rows.reduce((a, r) => a + r.iva, 0)
  const totalTotal = rows.reduce((a, r) => a + r.total, 0)

  function downloadExcel() {
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const s = (v) => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`
    const num = (v) => `<Cell><Data ss:Type="Number">${n(v).toFixed(2)}</Data></Cell>`
    const hdr = (v) => `<Cell ss:StyleID="h"><Data ss:Type="String">${esc(v)}</Data></Cell>`
    const tot = (v, isNum) => isNum
      ? `<Cell ss:StyleID="t"><Data ss:Type="Number">${n(v).toFixed(2)}</Data></Cell>`
      : `<Cell ss:StyleID="t"><Data ss:Type="String">${esc(v)}</Data></Cell>`

    const dataRows = rows.map(r =>
      `<Row>${s(r.created_at?.slice(0,10))}${s('#'+r.order_number)}${s(r.clients?.commercial_name)}${s(r.clients?.nit||'CF')}${num(r.base)}${num(r.iva)}${num(r.total)}</Row>`
    ).join('\n')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2F5D50" ss:Pattern="Solid"/></Style>
    <Style ss:ID="t"><Font ss:Bold="1"/><Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/></Style>
    <Style ss:ID="title"><Font ss:Bold="1" ss:Size="14"/></Style>
  </Styles>
  <Worksheet ss:Name="Libro de Ventas">
    <Table>
      <Column ss:Width="90"/><Column ss:Width="70"/><Column ss:Width="180"/><Column ss:Width="80"/>
      <Column ss:Width="100"/><Column ss:Width="100"/><Column ss:Width="100"/>
      <Row><Cell ss:StyleID="title"><Data ss:Type="String">LIBRO DE VENTAS — ${dateFrom} al ${dateTo}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">IVA ${(IVA_RATE*100).toFixed(0)}%</Data></Cell></Row>
      <Row/>
      <Row>${hdr('Fecha')}${hdr('Pedido')}${hdr('Cliente')}${hdr('NIT')}${hdr('Base (sin IVA)')}${hdr('IVA 12%')}${hdr('Total')}</Row>
      ${dataRows}
      <Row/>
      <Row>${tot('TOTALES',false)}${tot('',false)}${tot('',false)}${tot('',false)}${tot(totalBase,true)}${tot(totalIva,true)}${tot(totalTotal,true)}</Row>
    </Table>
  </Worksheet>
</Workbook>`

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `libro-ventas-${dateFrom}-${dateTo}.xls`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <label className="block">
          <span className="block text-xs font-medium text-stone-500 mb-1">Desde</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-stone-500 mb-1">Hasta</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
        </label>
        <button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
          Consultar
        </button>
        {rows.length > 0 && (
          <button onClick={downloadExcel} className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
            📥 Exportar .xls
          </button>
        )}
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {/* KPIs */}
      {rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: 'Base (sin IVA)', value: `Q ${fmt(totalBase)}`, color: 'text-stone-900' },
            { label: `IVA ${(IVA_RATE*100).toFixed(0)}%`, value: `Q ${fmt(totalIva)}`, color: 'text-amber-700' },
            { label: 'Total con IVA', value: `Q ${fmt(totalTotal)}`, color: 'text-[#2f5d50]', accent: true },
          ].map(({ label, value, color, accent }) => (
            <div key={label} className={`rounded-3xl border p-5 shadow-sm ${accent ? 'bg-[#2f5d50] border-[#2f5d50]' : 'bg-white border-stone-200'}`}>
              <p className={`text-xs font-semibold uppercase tracking-widest ${accent ? 'text-emerald-200' : 'text-stone-400'}`}>{label}</p>
              <p className={`mt-2 text-2xl font-bold ${accent ? 'text-white' : color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center">
          <p className="text-stone-400">No hay ventas facturadas en el período seleccionado.</p>
        </div>
      ) : (
        <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50">
                {['Fecha', 'Pedido', 'Cliente', 'NIT', 'Base (sin IVA)', `IVA ${(IVA_RATE*100).toFixed(0)}%`, 'Total'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-stone-50 transition">
                  <td className="px-4 py-3 text-stone-500">{r.created_at?.slice(0,10)}</td>
                  <td className="px-4 py-3 font-medium text-stone-800">#{r.order_number}</td>
                  <td className="px-4 py-3 text-stone-700">{r.clients?.commercial_name}</td>
                  <td className="px-4 py-3 text-stone-400">{r.clients?.nit || 'CF'}</td>
                  <td className="px-4 py-3 text-right font-medium text-stone-800">Q {fmt(r.base)}</td>
                  <td className="px-4 py-3 text-right text-amber-700">Q {fmt(r.iva)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-900">Q {fmt(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-stone-200 bg-stone-50 font-bold">
                <td colSpan={4} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Totales ({rows.length} registros)</td>
                <td className="px-4 py-3 text-right text-stone-900">Q {fmt(totalBase)}</td>
                <td className="px-4 py-3 text-right text-amber-700">Q {fmt(totalIva)}</td>
                <td className="px-4 py-3 text-right text-[#2f5d50]">Q {fmt(totalTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Asientos contables ───────────────────────────────────────────────────────

function Asientos() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [expanded, setExpanded] = useState({})
  const [ccSummary, setCcSummary] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [e, cc] = await Promise.all([
        getJournalEntries(dateFrom, dateTo),
        getCostCenterSummary(dateFrom, dateTo),
      ])
      setEntries(e)
      setCcSummary(cc)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['journal_entries', 'accounts'], load)

  const toggle = id => setExpanded(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <label className="block">
          <span className="block text-xs font-medium text-stone-500 mb-1">Desde</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-stone-500 mb-1">Hasta</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
        </label>
        <button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
          Consultar
        </button>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {/* Resumen por centro de costo */}
      {ccSummary.length > 0 && (
        <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">Movimiento por centro de costo</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {ccSummary.map(cc => (
              <div key={cc.code} className="rounded-2xl bg-stone-50 p-3">
                <p className="text-xs font-bold text-stone-500">{cc.code} · {cc.name}</p>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-400">Débito</span>
                    <span className="font-semibold text-stone-700">Q {fmt(cc.debit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">Crédito</span>
                    <span className="font-semibold text-stone-700">Q {fmt(cc.credit)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de asientos */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : entries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-12 text-center">
          <p className="text-stone-400">No hay asientos en el período seleccionado.</p>
          <p className="mt-1 text-xs text-stone-400">Los asientos se generan automáticamente al facturar un pedido.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => {
            const lines = entry.journal_entry_lines || []
            const totalDebit  = lines.reduce((a, l) => a + n(l.debit), 0)
            const totalCredit = lines.reduce((a, l) => a + n(l.credit), 0)
            return (
              <div key={entry.id} className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
                <button onClick={() => toggle(entry.id)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-stone-50 transition text-left">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2f5d50] text-xs font-bold text-white">
                      #{entry.entry_number}
                    </div>
                    <div>
                      <p className="font-semibold text-stone-800">{entry.description}</p>
                      <p className="text-xs text-stone-400">{entry.entry_date} · {entry.reference_type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-stone-800">Q {fmt(totalDebit)}</span>
                    <span className="text-stone-300 text-lg">{expanded[entry.id] ? '▲' : '▼'}</span>
                  </div>
                </button>

                {expanded[entry.id] && (
                  <div className="border-t border-stone-100 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="bg-stone-50 border-b border-stone-100">
                          <th className="px-6 py-2 text-left text-xs text-stone-400 font-semibold uppercase">Cuenta</th>
                          <th className="px-4 py-2 text-left text-xs text-stone-400 font-semibold uppercase">Centro de costo</th>
                          <th className="px-4 py-2 text-left text-xs text-stone-400 font-semibold uppercase">Descripción</th>
                          <th className="px-4 py-2 text-right text-xs text-stone-400 font-semibold uppercase">Débito</th>
                          <th className="px-4 py-2 text-right text-xs text-stone-400 font-semibold uppercase">Crédito</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {lines.map(l => (
                          <tr key={l.id}>
                            <td className="px-6 py-2.5 text-stone-700">
                              <span className="font-medium">{l.accounting_accounts?.code}</span>
                              <span className="text-stone-400 ml-2">{l.accounting_accounts?.name}</span>
                            </td>
                            <td className="px-4 py-2.5 text-stone-500 text-xs">{l.cost_centers?.name || '—'}</td>
                            <td className="px-4 py-2.5 text-stone-500">{l.description}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-stone-800">
                              {n(l.debit) > 0 ? `Q ${fmt(l.debit)}` : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium text-stone-800">
                              {n(l.credit) > 0 ? `Q ${fmt(l.credit)}` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-stone-200 bg-stone-50 font-bold">
                          <td colSpan={3} className="px-6 py-2 text-xs text-stone-400 uppercase">Totales</td>
                          <td className="px-4 py-2 text-right text-stone-900">Q {fmt(totalDebit)}</td>
                          <td className="px-4 py-2 text-right text-stone-900">Q {fmt(totalCredit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Plan de cuentas ──────────────────────────────────────────────────────────

function PlanCuentas() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getAccounts()
      .then(setAccounts)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const grouped = accounts.reduce((acc, a) => {
    if (!acc[a.account_type]) acc[a.account_type] = []
    acc[a.account_type].push(a)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {error && <Alert type="error">{error}</Alert>}
      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : (
        Object.entries(grouped).map(([type, accts]) => (
          <div key={type} className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 border-b border-stone-100 bg-stone-50 px-6 py-3">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACCOUNT_TYPE_COLOR[type]}`}>
                {ACCOUNT_TYPE_LABEL[type]}
              </span>
              <span className="text-xs text-stone-400">{accts.length} cuenta{accts.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-stone-50">
              {accts.map(a => (
                <div key={a.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-12 text-sm font-bold text-stone-500">{a.code}</span>
                    <div>
                      <span className="text-sm text-stone-800">{a.name}</span>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-stone-400">
                        {a.account_group ? <span>{a.account_group}</span> : null}
                        {a.account_subgroup ? <span>{a.account_subgroup}</span> : null}
                        {a.fiscal_profiles?.code ? <span>Fiscal: {a.fiscal_profiles.code}</span> : null}
                        {a.allow_cost_center ? <span>Usa CC</span> : null}
                        {a.allow_auxiliary ? <span>Usa auxiliar</span> : null}
                        {a.is_postable === false ? <span>No posteable</span> : null}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-stone-400 capitalize">{a.normal_balance}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Centros de costo ─────────────────────────────────────────────────────────

function CentrosCosto() {
  const [centers, setCenters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [editing, setEditing] = useState(null)
  const [saving,  setSaving]  = useState(false)

  const load = () => {
    setLoading(true)
    getAllCostCenters()
      .then(setCenters)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await saveCostCenter(editing)
      setEditing(null)
      load()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function handleToggle(cc) {
    try {
      await toggleCostCenterActive(cc.id, !cc.is_active)
      load()
    } catch (err) { setError(err.message) }
  }

  // Centros raíz (sin parent) y sus hijos
  const roots    = centers.filter(c => !c.parent_id)
  const children = centers.filter(c =>  c.parent_id)

  const parentOptions = centers.filter(c => !c.parent_id)

  return (
    <div className="space-y-4">
      {error && <Alert type="error">{error}</Alert>}
      <div className="flex justify-end">
        <button onClick={() => setEditing({ code: '', name: '', description: '', parent_id: '' })}
          className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
          + Nuevo centro
        </button>
      </div>

      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : (
        <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
          <div className="divide-y divide-stone-100">
            {roots.map(cc => {
              const kids = children.filter(c => c.parent_id === cc.id)
              return (
                <div key={cc.id}>
                  {/* CC raíz */}
                  <div className={`flex items-center justify-between px-6 py-4 ${!cc.is_active ? 'opacity-50' : ''}`}>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-stone-400">{cc.code}</span>
                        <span className="font-medium text-stone-800">{cc.name}</span>
                        {!cc.is_active && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-400">Inactivo</span>}
                      </div>
                      {cc.description && <p className="text-xs text-stone-400 mt-0.5">{cc.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing({ ...cc, parent_id: cc.parent_id || '' })}
                        className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                        Editar
                      </button>
                      <button onClick={() => handleToggle(cc)}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                          cc.is_active
                            ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                            : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                        }`}>
                        {cc.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>
                  {/* Hijos con sangría */}
                  {kids.map(child => (
                    <div key={child.id} className={`flex items-center justify-between pl-12 pr-6 py-3 bg-stone-50 border-t border-stone-50 ${!child.is_active ? 'opacity-50' : ''}`}>
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-stone-300">└</span>
                          <span className="text-xs font-bold text-stone-400">{child.code}</span>
                          <span className="text-sm font-medium text-stone-700">{child.name}</span>
                          {!child.is_active && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-400">Inactivo</span>}
                        </div>
                        {child.description && <p className="text-xs text-stone-400 mt-0.5 pl-5">{child.description}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditing({ ...child, parent_id: child.parent_id || '' })}
                          className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                          Editar
                        </button>
                        <button onClick={() => handleToggle(child)}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                            child.is_active
                              ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                              : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                          }`}>
                          {child.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
              <h3 className="font-semibold text-stone-800">{editing.id ? 'Editar' : 'Nuevo'} centro de costo</h3>
              <button onClick={() => setEditing(null)} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">✕</button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="block mb-1 text-sm font-medium text-stone-700">Código *</span>
                  <input required value={editing.code} onChange={e => setEditing(p => ({ ...p, code: e.target.value }))}
                    placeholder="CC-05"
                    className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
                </label>
                <label className="block">
                  <span className="block mb-1 text-sm font-medium text-stone-700">Nombre *</span>
                  <input required value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
                    placeholder="Ej. Producción"
                    className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
                </label>
              </div>
              <label className="block">
                <span className="block mb-1 text-sm font-medium text-stone-700">Descripción</span>
                <input value={editing.description || ''} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))}
                  placeholder="Opcional"
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
              </label>
              <label className="block">
                <span className="block mb-1 text-sm font-medium text-stone-700">Centro padre (jerarquía)</span>
                <select value={editing.parent_id || ''} onChange={e => setEditing(p => ({ ...p, parent_id: e.target.value || null }))}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
                  <option value="">Sin padre (raíz)</option>
                  {parentOptions.filter(p => p.id !== editing.id).map(p => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-3">
                <button type="button" onClick={() => setEditing(null)}
                  className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

function PeriodosContables() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setRows(await getAccountingPeriods()) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  async function changeStatus(row, status) {
    setSavingId(row.id)
    try { await updateAccountingPeriodStatus(row.id, status, status === 'abierto' ? '' : `Cambio desde Contabilidad: ${status}`); await load() } catch (e) { setError(e.message) } finally { setSavingId('') }
  }
  return <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}{loading ? <div className="flex justify-center py-12"><Spinner /></div> : <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden"><div className="divide-y divide-stone-100">{rows.map(row => <div key={row.id} className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-3"><span className="font-semibold text-stone-800">{row.period_code}</span><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PERIOD_STATUS_COLOR[row.status] || 'bg-stone-100 text-stone-700'}`}>{row.status}</span></div><div className="mt-1 text-sm text-stone-500">{row.start_date} al {row.end_date}</div></div><div className="flex gap-2"><button disabled={savingId === row.id || row.status === 'abierto'} onClick={() => changeStatus(row, 'abierto')} className="rounded-xl border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Abrir</button><button disabled={savingId === row.id || row.status === 'cerrado'} onClick={() => changeStatus(row, 'cerrado')} className="rounded-xl border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">Cerrar</button><button disabled={savingId === row.id || row.status === 'bloqueado'} onClick={() => changeStatus(row, 'bloqueado')} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Bloquear</button></div></div>)}</div></div>}</div>
}

function PerfilesFiscales() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setRows(await getFiscalProfiles()) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try { await saveFiscalProfile(editing); setEditing(null); await load() } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}<div className="flex justify-end"><button onClick={() => setEditing({ code: '', name: '', profile_type: 'cuenta', deductibility_mode: 'deducible', risk_level: 'medio' })} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Perfil fiscal</button></div>{loading ? <div className="flex justify-center py-12"><Spinner /></div> : <div className="grid gap-4 md:grid-cols-2">{rows.map(row => <div key={row.id} className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><div className="font-semibold text-stone-800">{row.code}</div><div className="text-sm text-stone-500">{row.name}</div></div><button onClick={() => setEditing(row)} className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">Editar</button></div><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-500"><span>{PROFILE_TYPE_LABEL[row.profile_type] || row.profile_type}</span><span>{row.deductibility_mode}</span>{row.affects_vat_credit ? <span>IVA credito</span> : null}{row.affects_vat_debit ? <span>IVA debito</span> : null}{row.operation_kind ? <span>{row.operation_kind}</span> : null}<span>Riesgo {row.risk_level}</span></div></div>)}</div>}{editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-stone-200 px-6 py-4"><h3 className="font-semibold text-stone-800">{editing.id ? 'Editar' : 'Nuevo'} perfil fiscal</h3><button onClick={() => setEditing(null)} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">×</button></div><form onSubmit={handleSave} className="space-y-4 p-6"><div className="grid gap-4 md:grid-cols-2"><input value={editing.code || ''} onChange={e => setEditing(p => ({ ...p, code: e.target.value }))} placeholder="Codigo" className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><input value={editing.name || ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="Nombre" className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /></div><div className="grid gap-4 md:grid-cols-3"><select value={editing.profile_type || 'cuenta'} onChange={e => setEditing(p => ({ ...p, profile_type: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">{Object.entries(PROFILE_TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={editing.deductibility_mode || 'deducible'} onChange={e => setEditing(p => ({ ...p, deductibility_mode: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"><option value="deducible">Deducible</option><option value="no_deducible">No deducible</option><option value="deducible_con_limite">Con limite</option><option value="requiere_revision">Requiere revision</option></select><select value={editing.risk_level || 'medio'} onChange={e => setEditing(p => ({ ...p, risk_level: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"><option value="bajo">Riesgo bajo</option><option value="medio">Riesgo medio</option><option value="alto">Riesgo alto</option></select></div><textarea value={editing.fiscal_notes || ''} onChange={e => setEditing(p => ({ ...p, fiscal_notes: e.target.value }))} rows={3} placeholder="Notas fiscales" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><div className="grid gap-3 md:grid-cols-4 text-sm text-stone-700"><label><input type="checkbox" checked={editing.affects_vat_credit === true} onChange={e => setEditing(p => ({ ...p, affects_vat_credit: e.target.checked }))} /> IVA credito</label><label><input type="checkbox" checked={editing.affects_vat_debit === true} onChange={e => setEditing(p => ({ ...p, affects_vat_debit: e.target.checked }))} /> IVA debito</label><label><input type="checkbox" checked={editing.affects_isr_base !== false} onChange={e => setEditing(p => ({ ...p, affects_isr_base: e.target.checked }))} /> ISR base</label><label><input type="checkbox" checked={editing.affects_iso === true} onChange={e => setEditing(p => ({ ...p, affects_iso: e.target.checked }))} /> ISO</label></div><div className="flex gap-3"><button type="button" onClick={() => setEditing(null)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button><button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar'}</button></div></form></div></div>}</div>
}

function EventosContables() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setRows(await getAccountingEventTypes()) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try { await saveAccountingEventType(editing); setEditing(null); await load() } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  return <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}<div className="flex justify-end"><button onClick={() => setEditing({ code: '', name: '', module: '', default_posting_mode: 'automatico' })} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Evento</button></div>{loading ? <div className="flex justify-center py-12"><Spinner /></div> : <div className="space-y-3">{rows.map(row => <div key={row.id} className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><div className="font-semibold text-stone-800">{row.code}</div><div className="text-sm text-stone-500">{row.name} · {row.module}</div></div><button onClick={() => setEditing(row)} className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">Editar</button></div><div className="mt-2 text-xs text-stone-500">{row.description}</div><div className="mt-3 flex gap-2 text-[11px] text-stone-500"><span>{row.default_posting_mode}</span>{row.requires_review ? <span>Requiere revision</span> : <span>Sin revision</span>}</div></div>)}</div>}{editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-stone-200 px-6 py-4"><h3 className="font-semibold text-stone-800">{editing.id ? 'Editar' : 'Nuevo'} evento contable</h3><button onClick={() => setEditing(null)} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">×</button></div><form onSubmit={handleSave} className="space-y-4 p-6"><div className="grid gap-4 md:grid-cols-3"><input value={editing.code || ''} onChange={e => setEditing(p => ({ ...p, code: e.target.value }))} placeholder="Codigo" className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><input value={editing.name || ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="Nombre" className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><input value={editing.module || ''} onChange={e => setEditing(p => ({ ...p, module: e.target.value }))} placeholder="Modulo" className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /></div><textarea value={editing.description || ''} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} rows={3} placeholder="Descripcion" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><div className="grid gap-4 md:grid-cols-2"><select value={editing.default_posting_mode || 'automatico'} onChange={e => setEditing(p => ({ ...p, default_posting_mode: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"><option value="automatico">Automatico</option><option value="borrador">Borrador</option><option value="manual">Manual</option></select><label className="flex items-center gap-2 rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700"><input type="checkbox" checked={editing.requires_review === true} onChange={e => setEditing(p => ({ ...p, requires_review: e.target.checked }))} /> Requiere revision</label></div><div className="flex gap-3"><button type="button" onClick={() => setEditing(null)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button><button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar'}</button></div></form></div></div>}</div>
}

function PanelIVA() {
  const [month, setMonth] = useState(today.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setReport(await getVatReport(month)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [month])
  useEffect(() => { load() }, [load])
  const totals = report?.totals || {}
  return <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}<div className="flex flex-wrap items-end gap-3"><label><span className="mb-1 block text-xs font-medium text-stone-500">Mes</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" /></label><button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Actualizar</button></div>{loading ? <div className="flex justify-center py-12"><Spinner /></div> : report && <><div className="grid gap-4 md:grid-cols-4"><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">IVA debito</p><p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(totals.debit_vat)}</p></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">IVA credito</p><p className="mt-2 text-2xl font-bold text-emerald-700">Q {fmt(totals.credit_vat)}</p></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Saldo</p><p className={`mt-2 text-2xl font-bold ${n(totals.payable_or_carry) >= 0 ? 'text-amber-700' : 'text-sky-700'}`}>Q {fmt(totals.payable_or_carry)}</p></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Riesgos</p><p className="mt-2 text-2xl font-bold text-rose-700">{totals.risk_purchases || 0}</p></div></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Conciliacion IVA</h3><div className="mt-4 grid gap-3 text-sm"><div className="flex items-center justify-between"><span className="text-stone-500">Debito operativo</span><span className="font-semibold text-stone-800">Q {fmt(totals.debit_vat)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Debito contable</span><span className="font-semibold text-stone-800">Q {fmt(totals.accounting_debit_vat)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Brecha debito</span><span className={`font-semibold ${Math.abs(n(totals.debit_gap)) > 0.01 ? 'text-rose-700' : 'text-emerald-700'}`}>Q {fmt(totals.debit_gap)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Credito operativo</span><span className="font-semibold text-stone-800">Q {fmt(totals.credit_vat)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Credito contable</span><span className="font-semibold text-stone-800">Q {fmt(totals.accounting_credit_vat)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Brecha credito</span><span className={`font-semibold ${Math.abs(n(totals.credit_gap)) > 0.01 ? 'text-rose-700' : 'text-emerald-700'}`}>Q {fmt(totals.credit_gap)}</span></div></div></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Compras observadas</h3><div className="mt-4 space-y-3">{report.purchaseRows.filter(row => row.risk).slice(0, 8).map(row => <div key={row.id} className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3"><div className="text-sm font-semibold text-stone-800">{row.suppliers?.name || 'Proveedor'} · {row.invoice_number}</div><div className="text-xs text-rose-700">{row.risk}</div></div>)}{!report.purchaseRows.filter(row => row.risk).length && <p className="text-sm text-stone-500">No hay compras observadas este mes.</p>}</div></div></div></>}</div>
}

/*
function PanelISR() {
  const [month, setMonth] = useState(today.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setReport(await getIsrProjection(month)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [month])
  useEffect(() => { load() }, [load])
  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try { await saveIsrAdjustment(editing); setEditing(null); await load() } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const t = report?.totals || {}
  return <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}<div className="flex flex-wrap items-end gap-3"><label><span className="mb-1 block text-xs font-medium text-stone-500">Mes</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" /></label><button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Actualizar</button><button onClick={() => setEditing({ adjustment_date: `${month}-01`, adjustment_type: 'mas_no_deducible', amount: 0, concept: '' })} className="rounded-2xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">+ Ajuste ISR</button></div>{loading ? <div className="flex justify-center py-12"><Spinner /></div> : report && <><div className="grid gap-4 md:grid-cols-4"><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Utilidad contable</p><p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(t.utilidad_contable)}</p></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Base imponible</p><p className="mt-2 text-2xl font-bold text-amber-700">Q {fmt(t.base_imponible)}</p></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ISR proyectado</p><p className="mt-2 text-2xl font-bold text-rose-700">Q {fmt(t.isr_proyectado)}</p></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Regimen</p><p className="mt-2 text-lg font-bold text-stone-800">{t.isr_regime || 'utilidades'} · {(n(t.isr_rate) * 100).toFixed(2)}%</p></div></div><div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Conciliacion contable fiscal</h3><div className="mt-4 grid gap-3 text-sm"><div className="flex items-center justify-between"><span className="text-stone-500">Ingresos gravados</span><span className="font-semibold text-stone-800">Q {fmt(t.ingresos_gravados)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Costo compras</span><span className="font-semibold text-stone-800">Q {fmt(t.costo_compras)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Gastos deducibles</span><span className="font-semibold text-emerald-700">Q {fmt(t.gastos_deducibles)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Gastos no deducibles</span><span className="font-semibold text-rose-700">Q {fmt(t.gastos_no_deducibles)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Ajustes +</span><span className="font-semibold text-amber-700">Q {fmt(t.ajustes_mas)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Ajustes -</span><span className="font-semibold text-sky-700">Q {fmt(t.ajustes_menos)}</span></div></div></div><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Ajustes manuales</h3><div className="mt-4 space-y-3">{report.adjustments.map(row => <div key={row.id} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold text-stone-800">{row.concept}</div><div className="text-xs text-stone-500">{row.adjustment_type} · {row.adjustment_date}</div></div><div className="font-semibold text-stone-800">Q {fmt(row.amount)}</div></div></div>)}{!report.adjustments.length && <p className="text-sm text-stone-500">Sin ajustes manuales este mes.</p>}</div></div></div></>}</div>{editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-stone-200 px-6 py-4"><h3 className="font-semibold text-stone-800">Nuevo ajuste ISR</h3><button onClick={() => setEditing(null)} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">×</button></div><form onSubmit={handleSave} className="space-y-4 p-6"><div className="grid gap-4 md:grid-cols-2"><input type="date" value={editing.adjustment_date || ''} onChange={e => setEditing(p => ({ ...p, adjustment_date: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><select value={editing.adjustment_type || 'mas_no_deducible'} onChange={e => setEditing(p => ({ ...p, adjustment_type: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"><option value="mas_no_deducible">Mas no deducible</option><option value="menos_deduccion">Menos deduccion</option><option value="informativo">Informativo</option></select></div><input value={editing.concept || ''} onChange={e => setEditing(p => ({ ...p, concept: e.target.value }))} placeholder="Concepto" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><input type="number" step="0.01" value={editing.amount || 0} onChange={e => setEditing(p => ({ ...p, amount: e.target.value }))} placeholder="Monto" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><textarea value={editing.notes || ''} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Notas" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><div className="flex gap-3"><button type="button" onClick={() => setEditing(null)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button><button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar'}</button></div></form></div></div>}</div>
}

*/
function PanelISR() {
  const [month, setMonth] = useState(today.slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReport(await getIsrProjection(month))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { load() }, [load])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await saveIsrAdjustment(editing)
      setEditing(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const t = report?.totals || {}

  return (
    <div className="space-y-4">
      {error && <Alert type="error">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-500">Mes</span>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
        </label>
        <button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Actualizar</button>
        <button onClick={() => setEditing({ adjustment_date: `${month}-01`, adjustment_type: 'mas_no_deducible', amount: 0, concept: '' })} className="rounded-2xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">+ Ajuste ISR</button>
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : report ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Utilidad contable</p><p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(t.utilidad_contable)}</p></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Base imponible</p><p className="mt-2 text-2xl font-bold text-amber-700">Q {fmt(t.base_imponible)}</p></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ISR proyectado</p><p className="mt-2 text-2xl font-bold text-rose-700">Q {fmt(t.isr_proyectado)}</p></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Regimen</p><p className="mt-2 text-lg font-bold text-stone-800">{t.isr_regime || 'utilidades'} · {(n(t.isr_rate) * 100).toFixed(2)}%</p></div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-stone-800">Conciliacion contable fiscal</h3>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex items-center justify-between"><span className="text-stone-500">Ingresos gravados</span><span className="font-semibold text-stone-800">Q {fmt(t.ingresos_gravados)}</span></div>
                <div className="flex items-center justify-between"><span className="text-stone-500">Costo compras</span><span className="font-semibold text-stone-800">Q {fmt(t.costo_compras)}</span></div>
                <div className="flex items-center justify-between"><span className="text-stone-500">Gastos deducibles</span><span className="font-semibold text-emerald-700">Q {fmt(t.gastos_deducibles)}</span></div>
                <div className="flex items-center justify-between"><span className="text-stone-500">Gastos no deducibles</span><span className="font-semibold text-rose-700">Q {fmt(t.gastos_no_deducibles)}</span></div>
                <div className="flex items-center justify-between"><span className="text-stone-500">Ajustes +</span><span className="font-semibold text-amber-700">Q {fmt(t.ajustes_mas)}</span></div>
                <div className="flex items-center justify-between"><span className="text-stone-500">Ajustes -</span><span className="font-semibold text-sky-700">Q {fmt(t.ajustes_menos)}</span></div>
              </div>
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-stone-800">Ajustes manuales</h3>
              <div className="mt-4 space-y-3">
                {report.adjustments.map(row => <div key={row.id} className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold text-stone-800">{row.concept}</div><div className="text-xs text-stone-500">{row.adjustment_type} · {row.adjustment_date}</div></div><div className="font-semibold text-stone-800">Q {fmt(row.amount)}</div></div></div>)}
                {!report.adjustments.length && <p className="text-sm text-stone-500">Sin ajustes manuales este mes.</p>}
              </div>
            </div>
          </div>
        </>
      ) : null}
      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-stone-200 px-6 py-4"><h3 className="font-semibold text-stone-800">Nuevo ajuste ISR</h3><button onClick={() => setEditing(null)} className="rounded-full p-2 text-stone-400 hover:bg-stone-100">×</button></div><form onSubmit={handleSave} className="space-y-4 p-6"><div className="grid gap-4 md:grid-cols-2"><input type="date" value={editing.adjustment_date || ''} onChange={e => setEditing(p => ({ ...p, adjustment_date: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><select value={editing.adjustment_type || 'mas_no_deducible'} onChange={e => setEditing(p => ({ ...p, adjustment_type: e.target.value }))} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]"><option value="mas_no_deducible">Mas no deducible</option><option value="menos_deduccion">Menos deduccion</option><option value="informativo">Informativo</option></select></div><input value={editing.concept || ''} onChange={e => setEditing(p => ({ ...p, concept: e.target.value }))} placeholder="Concepto" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><input type="number" step="0.01" value={editing.amount || 0} onChange={e => setEditing(p => ({ ...p, amount: e.target.value }))} placeholder="Monto" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><textarea value={editing.notes || ''} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Notas" className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" /><div className="flex gap-3"><button type="button" onClick={() => setEditing(null)} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button><button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar'}</button></div></form></div></div>}
    </div>
  )
}

function PanelISO() {
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setReport(await getIsoDashboard(year)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [year])
  useEffect(() => { load() }, [load])
  return <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}<div className="flex flex-wrap items-end gap-3"><label><span className="mb-1 block text-xs font-medium text-stone-500">Año</span><input type="number" value={year} onChange={e => setYear(e.target.value)} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" /></label><button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Actualizar</button></div>{loading ? <div className="flex justify-center py-12"><Spinner /></div> : report && <div className="space-y-4"><div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center gap-3 text-sm text-stone-600"><span>Tasa ISO: <strong className="text-stone-800">{(n(report.iso_rate) * 100).toFixed(2)}%</strong></span><span>Base configurada: <strong className="text-stone-800">{report.iso_base_mode}</strong></span></div></div><div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden"><table className="w-full text-sm"><thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Trimestre</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Ingresos</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Activos netos</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Base</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">ISO proyectado</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Pendiente</th></tr></thead><tbody className="divide-y divide-stone-50">{report.rows.map(row => <tr key={row.id}><td className="px-4 py-3 font-medium text-stone-800">T{row.fiscal_quarter} · {row.start_date} al {row.end_date}</td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.gross_income_base)}</td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.net_assets_base)}</td><td className="px-4 py-3 text-right font-semibold text-stone-800">Q {fmt(row.selected_base)}</td><td className="px-4 py-3 text-right text-amber-700">Q {fmt(row.projected_tax)}</td><td className="px-4 py-3 text-right font-semibold text-rose-700">Q {fmt(row.pending_tax)}</td></tr>)}</tbody></table></div></div>}</div>
}

function PanelTributario() {
  const [tab, setTab] = useState('iva')
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { getTaxConfiguration().then(setConfig).catch(e => setError(e.message)) }, [])
  async function handleSave() {
    setSaving(true)
    setError('')
    try { await saveTaxConfiguration(config); setConfig(await getTaxConfiguration()) } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  return <div className="space-y-5">{error && <Alert type="error">{error}</Alert>}{config && <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><div className="grid gap-4 md:grid-cols-5"><label><span className="mb-1 block text-xs font-medium text-stone-500">IVA</span><input type="number" step="0.0001" value={config.vat_rate ?? 0.12} onChange={e => setConfig(p => ({ ...p, vat_rate: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" /></label><label><span className="mb-1 block text-xs font-medium text-stone-500">Regimen ISR</span><select value={config.isr_regime || 'utilidades'} onChange={e => setConfig(p => ({ ...p, isr_regime: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]"><option value="utilidades">Utilidades</option><option value="opcional_simplificado">Opcional simplificado</option></select></label><label><span className="mb-1 block text-xs font-medium text-stone-500">Tasa ISR</span><input type="number" step="0.0001" value={config.isr_rate ?? 0.25} onChange={e => setConfig(p => ({ ...p, isr_rate: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" /></label><label><span className="mb-1 block text-xs font-medium text-stone-500">Tasa ISO</span><input type="number" step="0.0001" value={config.iso_rate ?? 0.01} onChange={e => setConfig(p => ({ ...p, iso_rate: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" /></label><label><span className="mb-1 block text-xs font-medium text-stone-500">Base ISO</span><select value={config.iso_base_mode || 'mayor'} onChange={e => setConfig(p => ({ ...p, iso_base_mode: e.target.value }))} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]"><option value="mayor">Mayor base</option><option value="ingresos_brutos">Ingresos brutos</option><option value="activos_netos">Activos netos</option></select></label></div><div className="mt-4 flex gap-2">{['iva', 'isr', 'iso'].map(key => <button key={key} onClick={() => setTab(key)} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${tab === key ? 'bg-[#2f5d50] text-white' : 'bg-stone-100 text-stone-600'}`}>{key.toUpperCase()}</button>)}<button onClick={handleSave} disabled={saving} className="ml-auto rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar config.'}</button></div></div>}{tab === 'iva' && <PanelIVA />}{tab === 'isr' && <PanelISR />}{tab === 'iso' && <PanelISO />}</div>
}

function PanelCosteoIndustrial() {
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [report, setReport] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReport(await getIndustrialCostReport(dateFrom, dateTo))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['packaging_runs', 'finished_inventory_lots', 'order_packings', 'orders', 'order_items', 'ruta_pedidos'], load)

  async function handleSnapshot() {
    setSaving(true)
    setError('')
    setInfo('')
    try {
      const result = await saveIndustrialCostSnapshots(dateFrom, dateTo)
      setInfo(`Snapshot industrial guardado: ${result.saved_rows} fila(s).`)
      setReport(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const t = report?.totals || {}

  return (
    <div className="space-y-5">
      {error && <Alert type="error">{error}</Alert>}
      {info && <Alert type="success">{info}</Alert>}
      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="mb-1 block text-xs font-medium text-stone-500">Desde</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-stone-500">Hasta</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <button onClick={load} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">Actualizar</button>
          <button onClick={handleSnapshot} disabled={saving || loading} className="rounded-2xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar snapshot'}</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : report ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Costo producido</p><p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(t.produced_cost)}</p><p className="mt-2 text-xs text-stone-500">{fmt(t.produced_units)} unid. · {fmt(t.produced_weight_lb)} lb</p></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Costo vendido</p><p className="mt-2 text-2xl font-bold text-amber-700">Q {fmt(t.sold_total_cost)}</p><p className="mt-2 text-xs text-stone-500">Prod. Q {fmt(t.sold_production_cost)} · Log. Q {fmt(t.sold_logistics_cost)}</p></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Margen real</p><p className={`mt-2 text-2xl font-bold ${n(t.gross_margin) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Q {fmt(t.gross_margin)}</p><p className="mt-2 text-xs text-stone-500">Sobre ventas Q {fmt(t.sold_revenue)} · {pct(t.gross_margin_pct)}</p></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Inventario valorizado</p><p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(n(t.finished_inventory_value) + n(t.processed_inventory_value))}</p><p className="mt-2 text-xs text-stone-500">PT Q {fmt(t.finished_inventory_value)} · Proc. Q {fmt(t.processed_inventory_value)}</p></div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Producción</h3><div className="mt-4 grid gap-3 text-sm"><div className="flex items-center justify-between"><span className="text-stone-500">Costo por libra</span><span className="font-semibold text-stone-800">Q {fmt(t.produced_cost_per_lb)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Merma lb</span><span className="font-semibold text-stone-800">{fmt(t.waste_lb)}</span></div><div className="flex items-center justify-between"><span className="text-stone-500">Merma %</span><span className={`font-semibold ${n(t.waste_pct) > 15 ? 'text-rose-700' : 'text-emerald-700'}`}>{pct(t.waste_pct)}</span></div></div></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Clientes más rentables</h3><div className="mt-4 space-y-3">{(report.clientRows || []).slice(0, 5).map(row => <div key={row.client_id || row.source_code} className="flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3"><div><div className="text-sm font-semibold text-stone-800">{row.source_name}</div><div className="text-xs text-stone-500">Venta Q {fmt(row.revenue_amount)}</div></div><div className={`text-sm font-semibold ${n(row.margin_amount) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Q {fmt(row.margin_amount)}</div></div>)}{!(report.clientRows || []).length && <p className="text-sm text-stone-500">Sin datos del rango.</p>}</div></div>
            <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-semibold text-stone-800">Rutas más costosas</h3><div className="mt-4 space-y-3">{(report.routeRows || []).slice(0, 5).map(row => <div key={row.route_id || row.source_code} className="flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3"><div><div className="text-sm font-semibold text-stone-800">{row.source_name}</div><div className="text-xs text-stone-500">Venta Q {fmt(row.revenue_amount)}</div></div><div className="text-sm font-semibold text-amber-700">Q {fmt(row.logistics_cost)}</div></div>)}{!(report.routeRows || []).length && <p className="text-sm text-stone-500">Sin rutas costeadas en el rango.</p>}</div></div>
          </div>

          <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Rentabilidad por SKU</h3></div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">SKU</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Prod.</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Vend.</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Ingreso</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Costo prod.</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Logística</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Margen</th></tr></thead>
              <tbody className="divide-y divide-stone-50">{(report.skuRows || []).slice(0, 12).map(row => <tr key={row.product_presentation_id || row.source_code}><td className="px-4 py-3"><div className="font-medium text-stone-800">{row.source_code || 'SKU'}</div><div className="text-xs text-stone-500">{row.source_name}</div></td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.produced_units)}</td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.quantity)}</td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.revenue_amount)}</td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.production_cost)}</td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.logistics_cost)}</td><td className={`px-4 py-3 text-right font-semibold ${n(row.margin_amount) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Q {fmt(row.margin_amount)}</td></tr>)}</tbody>
            </table>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Rentabilidad por pedido</h3></div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Pedido</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Ingreso</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Costo</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Margen</th></tr></thead>
                <tbody className="divide-y divide-stone-50">{(report.orderRows || []).slice(0, 10).map(row => <tr key={row.order_id}><td className="px-4 py-3"><div className="font-medium text-stone-800">{row.source_code}</div><div className="text-xs text-stone-500">{row.client_name}{row.route_code ? ` · ${row.route_code}` : ''}</div></td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.revenue_amount)}</td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.total_cost)}</td><td className={`px-4 py-3 text-right font-semibold ${n(row.margin_amount) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Q {fmt(row.margin_amount)}</td></tr>)}</tbody>
              </table>
            </div>

            <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-stone-100 px-5 py-4"><h3 className="text-sm font-semibold text-stone-800">Costeo por lote terminado</h3></div>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Lote</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Unid.</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Ingreso</th><th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-400">Margen</th></tr></thead>
                <tbody className="divide-y divide-stone-50">{(report.lotRows || []).slice(0, 10).map(row => <tr key={row.finished_inventory_lot_id || row.source_code}><td className="px-4 py-3"><div className="font-medium text-stone-800">{row.source_code}</div><div className="text-xs text-stone-500">{row.source_name}</div></td><td className="px-4 py-3 text-right text-stone-700">{fmt(row.quantity)}</td><td className="px-4 py-3 text-right text-stone-700">Q {fmt(row.revenue_amount)}</td><td className={`px-4 py-3 text-right font-semibold ${n(row.margin_amount) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Q {fmt(row.margin_amount)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function TrazabilidadContable() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setRows(await getAccountingSourceLinks(firstOfMonth, today)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  return <div className="space-y-4">{error && <Alert type="error">{error}</Alert>}{loading ? <div className="flex justify-center py-12"><Spinner /></div> : <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden"><table className="w-full text-sm"><thead><tr className="border-b border-stone-100 bg-stone-50"><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Evento</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Origen</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Asiento</th><th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">Fecha</th></tr></thead><tbody className="divide-y divide-stone-50">{rows.map(row => <tr key={row.id}><td className="px-4 py-3 text-stone-700">{row.event_code}</td><td className="px-4 py-3 text-stone-500">{row.source_type} · {String(row.source_id).slice(0, 8)}</td><td className="px-4 py-3 text-stone-700">#{row.journal_entries?.entry_number} · {row.journal_entries?.description}</td><td className="px-4 py-3 text-stone-500">{row.journal_entries?.entry_date || row.created_at?.slice(0, 10)}</td></tr>)}</tbody></table></div>}</div>
}

export default function ContabilidadPage() {
  const [tab, setTab] = useState('libro')
  const [initDone, setInitDone] = useState(false)
  const [initError, setInitError] = useState('')

  useEffect(() => {
    initAccounting()
      .then(() => setInitDone(true))
      .catch(e => setInitError(e.message))
  }, [])

  const tabs = [
    { key: 'libro',    label: 'Libro de ventas'   },
    { key: 'asientos', label: 'Asientos contables' },
    { key: 'cuentas',  label: 'Plan de cuentas'   },
    { key: 'centros',  label: 'Centros de costo'  },
    { key: 'costeo', label: 'Costeo industrial' },
    { key: 'periodos', label: 'Periodos' },
    { key: 'fiscal', label: 'Perfiles fiscales' },
    { key: 'tributario', label: 'Panel tributario' },
    { key: 'eventos', label: 'Eventos contables' },
    { key: 'trazabilidad', label: 'Trazabilidad' },
    { key: 'conciliacion', label: 'Conciliación bancaria' },
  ]

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">ERP · Finanzas</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-900">Contabilidad</h1>
          <p className="mt-1 text-sm text-stone-500">IVA {(IVA_RATE * 100).toFixed(0)}% · Asientos automáticos · Centros de costo</p>
        </div>

        {initError && <Alert type="error">Error al inicializar: {initError}</Alert>}

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {tabs.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition ${
                tab === key ? 'bg-[#2f5d50] text-white' : 'bg-white border border-stone-200 text-stone-600 hover:border-stone-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {initDone && (
          <>
            {tab === 'libro'    && <LibroVentas />}
            {tab === 'asientos' && <Asientos />}
            {tab === 'cuentas'  && <PlanCuentas />}
            {tab === 'centros'  && <CentrosCosto />}
            {tab === 'costeo' && <PanelCosteoIndustrial />}
            {tab === 'periodos' && <PeriodosContables />}
            {tab === 'fiscal' && <PerfilesFiscales />}
            {tab === 'tributario' && <PanelTributario />}
            {tab === 'eventos' && <EventosContables />}
            {tab === 'trazabilidad' && <TrazabilidadContable />}
            {tab === 'conciliacion' && <BankReconciliationPanel />}
          </>
        )}
      </div>
    </div>
  )
}
