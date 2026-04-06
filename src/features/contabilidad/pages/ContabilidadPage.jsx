import { useEffect, useState, useCallback } from 'react'
import {
  initAccounting, IVA_RATE,
  getSalesLedger, getJournalEntries, getAccounts,
  getAllCostCenters, saveCostCenter, toggleCostCenterActive, getCostCenterSummary,
} from '../services/contabilidadService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

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
        <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
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
                  <div className="border-t border-stone-100">
                    <table className="w-full text-sm">
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
                    <span className="text-sm text-stone-800">{a.name}</span>
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
          </>
        )}
      </div>
    </div>
  )
}
