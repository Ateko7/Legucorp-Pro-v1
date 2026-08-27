import { useCallback, useEffect, useState } from 'react'
import { getCxCData } from '../services/cxcService'
import { getCxPData } from '../services/cxpService'

function n(v) {
  const x = Number(v)
  return Number.isNaN(x) ? 0 : x
}

function fmt(v) {
  return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function diffDays(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${dateStr}T12:00:00`)
  return Math.ceil((d - today) / 86400000)
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
    </div>
  )
}

function KpiCard({ label, value, sub, color = 'stone' }) {
  const colors = {
    stone:  'bg-white border-stone-200 text-stone-800',
    green:  'bg-emerald-50 border-emerald-200 text-emerald-800',
    red:    'bg-red-50 border-red-200 text-red-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-800',
  }
  return (
    <div className={`rounded-2xl border p-5 ${colors[color]}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 text-2xl font-bold">Q {fmt(value)}</p>
      {sub && <p className="mt-1 text-xs opacity-50">{sub}</p>}
    </div>
  )
}

function AgingBar({ buckets, total }) {
  const colors = {
    'Al dia':    'bg-emerald-400',
    '1-30 dias': 'bg-amber-400',
    '31-60 dias':'bg-orange-400',
    '61-90 dias':'bg-red-500',
    '+90 dias':  'bg-rose-600',
  }
  return (
    <div className="space-y-2">
      {buckets.map(({ label, amount }) => {
        const pct = total > 0 ? (amount / total) * 100 : 0
        return (
          <div key={label} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 text-stone-500">{label}</span>
            <div className="flex-1 rounded-full bg-stone-100 h-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${colors[label] || 'bg-stone-400'}`}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <span className="w-28 text-right font-medium text-stone-700">Q {fmt(amount)}</span>
          </div>
        )
      })}
    </div>
  )
}

function ClientTable({ rows, type }) {
  const grouped = {}
  rows.forEach((r) => {
    const key = type === 'cxc'
      ? (r.clients?.commercial_name || r.clients?.id || 'Sin cliente')
      : (r.suppliers?.name || r.suppliers?.id || 'Sin proveedor')
    const amount = type === 'cxc' ? n(r.total) : n(r.displayAmount)
    const isVigente = r.aging.label === 'Al dia'
    if (!grouped[key]) grouped[key] = { name: key, vigente: 0, vencido: 0, maxDays: 0 }
    if (isVigente) grouped[key].vigente += amount
    else {
      grouped[key].vencido += amount
      grouped[key].maxDays = Math.max(grouped[key].maxDays, r.daysOverdue)
    }
  })

  const list = Object.values(grouped)
    .sort((a, b) => b.vencido - a.vencido || b.vigente - a.vigente)

  if (!list.length) {
    return <p className="py-6 text-center text-sm text-stone-400">Sin registros pendientes</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 text-left text-xs text-stone-400 uppercase tracking-wide">
            <th className="pb-2 pr-4 font-medium">{type === 'cxc' ? 'Cliente' : 'Proveedor'}</th>
            <th className="pb-2 px-3 text-right font-medium">Vigente</th>
            <th className="pb-2 px-3 text-right font-medium">Vencido</th>
            <th className="pb-2 px-3 text-right font-medium">Total</th>
            <th className="pb-2 pl-3 text-right font-medium">Días venc.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-50">
          {list.map((item) => (
            <tr key={item.name} className="hover:bg-stone-50 transition-colors">
              <td className="py-2 pr-4 font-medium text-stone-700">{item.name}</td>
              <td className="py-2 px-3 text-right text-emerald-700">
                {item.vigente > 0 ? `Q ${fmt(item.vigente)}` : '—'}
              </td>
              <td className="py-2 px-3 text-right">
                {item.vencido > 0
                  ? <span className="text-red-600 font-semibold">Q {fmt(item.vencido)}</span>
                  : <span className="text-stone-400">—</span>}
              </td>
              <td className="py-2 px-3 text-right text-stone-700 font-medium">
                Q {fmt(item.vigente + item.vencido)}
              </td>
              <td className="py-2 pl-3 text-right">
                {item.maxDays > 0
                  ? <span className={`font-semibold ${item.maxDays > 60 ? 'text-red-600' : item.maxDays > 30 ? 'text-orange-500' : 'text-amber-600'}`}>{item.maxDays}d</span>
                  : <span className="text-stone-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProximosVencimientos({ cxcRows, cxpRows }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const cobros = cxcRows
    .filter((r) => r.dueDate && r.aging.label === 'Al dia')
    .map((r) => ({
      tipo: 'cobro',
      nombre: r.clients?.commercial_name || '—',
      monto: n(r.total),
      dueDate: r.dueDate,
      diasRestantes: diffDays(r.dueDate),
      ref: r.order_number,
    }))
    .filter((r) => r.diasRestantes >= 0 && r.diasRestantes <= 14)
    .sort((a, b) => a.diasRestantes - b.diasRestantes)

  const pagos = cxpRows
    .filter((r) => r.dueDate && r.aging.label === 'Al dia')
    .map((r) => ({
      tipo: 'pago',
      nombre: r.suppliers?.name || '—',
      monto: n(r.displayAmount),
      dueDate: r.dueDate,
      diasRestantes: diffDays(r.dueDate),
      ref: r.invoice_number || r.internalLot,
    }))
    .filter((r) => r.diasRestantes >= 0 && r.diasRestantes <= 14)
    .sort((a, b) => a.diasRestantes - b.diasRestantes)

  const items = [...cobros, ...pagos].sort((a, b) => a.diasRestantes - b.diasRestantes).slice(0, 10)

  if (!items.length) {
    return <p className="py-6 text-center text-sm text-stone-400">Sin vencimientos en los próximos 14 días</p>
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-stone-50 px-4 py-3">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${item.tipo === 'cobro' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
            {item.tipo === 'cobro' ? '↓ Cobro' : '↑ Pago'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-stone-700">{item.nombre}</p>
            {item.ref && <p className="text-xs text-stone-400">{item.ref}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-stone-800">Q {fmt(item.monto)}</p>
            <p className={`text-xs ${item.diasRestantes <= 3 ? 'text-red-500 font-semibold' : 'text-stone-400'}`}>
              {item.diasRestantes === 0 ? 'Hoy' : `En ${item.diasRestantes}d`}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

const AGING_ORDER = ['Al dia', '1-30 dias', '31-60 dias', '61-90 dias', '+90 dias']

function buildAgingBuckets(rows, getAmount) {
  const acc = {}
  AGING_ORDER.forEach((l) => { acc[l] = 0 })
  rows.forEach((r) => {
    const label = r.aging.label
    if (acc[label] !== undefined) acc[label] += getAmount(r)
  })
  return AGING_ORDER.map((label) => ({ label, amount: acc[label] }))
}

export default function FinancieroDashboard() {
  const [cxcRows, setCxcRows] = useState([])
  const [cxpRows, setCxpRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cxc, cxp] = await Promise.all([getCxCData(false), getCxPData(false)])
      setCxcRows(cxc)
      setCxpRows(cxp)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const cxcVigente = cxcRows.filter((r) => r.aging.label === 'Al dia').reduce((s, r) => s + n(r.total), 0)
  const cxcVencido = cxcRows.filter((r) => r.aging.label !== 'Al dia').reduce((s, r) => s + n(r.total), 0)
  const cxpVigente = cxpRows.filter((r) => r.aging.label === 'Al dia').reduce((s, r) => s + n(r.displayAmount), 0)
  const cxpVencido = cxpRows.filter((r) => r.aging.label !== 'Al dia' && r.aging.label !== 'Pendiente factura').reduce((s, r) => s + n(r.displayAmount), 0)

  const posicionNeta = cxcVigente + cxcVencido - cxpVigente - cxpVencido

  const cxcBuckets = buildAgingBuckets(cxcRows, (r) => n(r.total))
  const cxpBuckets = buildAgingBuckets(
    cxpRows.filter((r) => r.aging.label !== 'Pendiente factura'),
    (r) => n(r.displayAmount),
  )

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-stone-800">Dashboard Financiero</h1>
        <p className="text-sm text-stone-400">Posición de cobros y pagos en tiempo real</p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? <Spinner /> : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="CXC Vigente" value={cxcVigente} color="green" />
            <KpiCard label="CXC Vencido" value={cxcVencido} color="red" />
            <KpiCard label="CXP Vigente" value={cxpVigente} color="amber" />
            <KpiCard label="CXP Vencido" value={cxpVencido} color="red" />
            <div className={`col-span-2 md:col-span-1 rounded-2xl border p-5 ${posicionNeta >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-xs font-medium uppercase tracking-wide opacity-60 text-stone-600">Posición neta</p>
              <p className={`mt-1 text-2xl font-bold ${posicionNeta >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                {posicionNeta >= 0 ? '+' : ''}Q {fmt(posicionNeta)}
              </p>
              <p className="mt-1 text-xs text-stone-400">CXC total − CXP total</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* CXC por cliente */}
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-stone-700">Cuentas por cobrar — por cliente</h2>
              <ClientTable rows={cxcRows} type="cxc" />
            </div>

            {/* CXP por proveedor */}
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-stone-700">Cuentas por pagar — por proveedor</h2>
              <ClientTable rows={cxpRows} type="cxp" />
            </div>

            {/* Aging CXC */}
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-stone-700">Antigüedad CXC</h2>
              <AgingBar buckets={cxcBuckets} total={cxcVigente + cxcVencido} />
            </div>

            {/* Aging CXP */}
            <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-stone-700">Antigüedad CXP</h2>
              <AgingBar buckets={cxpBuckets} total={cxpVigente + cxpVencido} />
            </div>
          </div>

          {/* Próximos vencimientos */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-stone-700">Próximos vencimientos (14 días)</h2>
            <ProximosVencimientos cxcRows={cxcRows} cxpRows={cxpRows} />
          </div>
        </>
      )}
    </div>
  )
}
