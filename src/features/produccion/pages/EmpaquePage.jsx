import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  calculateRecipeRequirements,
  getPackagingFormData,
  getActivePackagingOrders,
  createPackagingOrder,
  completarPackagingOrder,
  cancelarPackagingOrder,
} from '../services/packagingService'
import { getOrganization } from '../../organization/services/organizationService'
import { getProyeccionDia } from '../services/demandaEmpaqueService'

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

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value + 'T12:00:00')
  return d.toLocaleDateString('es-GT')
}

function buildDefaultFinishedLotCode(presentation, runDate) {
  if (!presentation) return ''
  const datePart = (runDate || todayString).replaceAll('-', '')
  return `${presentation.code || 'PT'}-${datePart}`
}

// ─── Label printing ───────────────────────────────────────────────────────────

function printLabels({ order, org }) {
  const pp = order.product_presentations
  const qty = numberOrZero(order.quantity_to_pack)
  const productionDate = formatDate(order.run_date)
  const shelfDays = numberOrZero(pp?.shelf_life_days)
  const expDate = shelfDays
    ? formatDate(new Date(new Date(order.run_date + 'T12:00:00').getTime() + shelfDays * 86400000).toISOString().slice(0, 10))
    : '—'
  const barcode = pp?.barcode || ''
  const productName = pp?.display_name || '—'
  const lotCode = order.finished_lot_code || '—'
  const orgName = org?.name || 'Legucorp'
  const orgAddress = [org?.address, org?.city, org?.country].filter(Boolean).join(', ') || ''
  const orgPhone = org?.phone || ''

  // QR content: JSON with traceability data
  const qrData = JSON.stringify({
    lote: lotCode,
    producto: productName,
    prod: order.run_date,
    vence: shelfDays
      ? new Date(new Date(order.run_date + 'T12:00:00').getTime() + shelfDays * 86400000).toISOString().slice(0, 10)
      : null,
    org: orgName,
  })

  // Each label has a unique QR container id
  const labelHtml = Array.from({ length: qty }, (_, i) => `
    <div class="label">
      <div class="org-name">${orgName}</div>
      ${orgAddress ? `<div class="org-sub">${orgAddress}</div>` : ''}
      ${orgPhone ? `<div class="org-sub">Tel: ${orgPhone}</div>` : ''}
      <div class="divider"></div>
      <div class="product-name">${productName}</div>
      <div class="lot-row"><b>Lote:</b> ${lotCode}</div>
      <div class="dates-row">
        <span><b>Prod:</b> ${productionDate}</span>
        <span><b>Vence:</b> ${expDate}</span>
      </div>
      ${barcode ? `<div class="barcode-wrap"><svg class="barcode" jsbarcode-value="${barcode}" jsbarcode-format="CODE128" jsbarcode-width="1.4" jsbarcode-height="26" jsbarcode-fontsize="7" jsbarcode-margin="1"></svg></div>` : ''}
      <div class="bottom-row">
        <div class="refrigerado">❄ Mantener refrigerado a 4°C</div>
        <div class="qr-corner">
          <div id="qr-${i}"></div>
          <div class="qr-label">Trazabilidad</div>
        </div>
      </div>
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Etiquetas — ${lotCode}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #fff; }
  @page { size: 101.6mm 50.8mm; margin: 0; }
  .label {
    width: 101.6mm;
    height: 50.8mm;
    padding: 2mm 2.5mm 1.5mm;
    display: flex;
    flex-direction: column;
    gap: 0.6mm;
    page-break-after: always;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }
  .org-name { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .org-sub { font-size: 6pt; color: #555; }
  .divider { border-top: 0.3mm solid #ccc; margin: 0.5mm 0; }
  .product-name { font-size: 10pt; font-weight: 700; line-height: 1.2; }
  .lot-row { font-size: 7pt; }
  .dates-row { font-size: 7pt; display: flex; gap: 5mm; }
  .barcode-wrap { display: flex; }
  .barcode { max-width: 95mm; }
  .bottom-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-top: auto;
    gap: 2mm;
  }
  .refrigerado {
    font-size: 6.5pt; font-weight: 600; color: #1d4ed8;
    border: 0.3mm solid #bfdbfe; border-radius: 1.5mm;
    padding: 0.8mm 2mm; background: #eff6ff;
    flex: 1;
    text-align: center;
  }
  .qr-corner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3mm;
    flex-shrink: 0;
  }
  .qr-corner canvas, .qr-corner img {
    width: 14mm !important;
    height: 14mm !important;
  }
  .qr-label { font-size: 5pt; color: #999; text-align: center; }
</style>
</head>
<body>
${labelHtml}
<script>
  var QR_DATA = ${JSON.stringify(qrData)};
  window.onload = function() {
    for (var i = 0; i < ${qty}; i++) {
      var el = document.getElementById('qr-' + i);
      if (el && typeof QRCode !== 'undefined') {
        new QRCode(el, {
          text: QR_DATA,
          width: 53,
          height: 53,
          correctLevel: QRCode.CorrectLevel.M,
        });
      }
    }
    if (typeof JsBarcode !== 'undefined') {
      JsBarcode('.barcode');
    }
    setTimeout(function() { window.print(); }, 600);
  };
<\/script>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank', 'width=900,height=700')
  if (!win) { URL.revokeObjectURL(url); alert('Permite ventanas emergentes para imprimir etiquetas') }
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function StatusPill({ covered }) {
  return (
    <div className={`rounded-full px-3 py-1 text-xs font-semibold ${covered ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
      {covered ? 'Cubierto' : 'Pendiente'}
    </div>
  )
}

function KpiCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-stone-800">{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-400">{hint}</div> : null}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}

function InfoMini({ label, value }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-stone-800">{value}</div>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="py-12 text-center text-sm text-stone-500">{text}</div>
}

function MaterialSelectionCard({ requirement, lots, selectedIds, onToggle, selectedAvailable }) {
  if (!lots.length) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500">
        No hay inventario procesado disponible para {requirement.material_name}.
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-base font-semibold text-stone-800">{requirement.material_name}</div>
          <div className="mt-1 text-sm text-stone-500">
            {formatNumber(requirement.percentage)}% · requerido {formatNumber(requirement.required_lb)} lb
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-stone-200 px-3 py-1 text-xs font-semibold text-stone-700">
            Seleccionado: {formatNumber(selectedAvailable)} lb
          </div>
          <StatusPill covered={numberOrZero(selectedAvailable) >= numberOrZero(requirement.required_lb)} />
        </div>
      </div>
      <div className="space-y-2 border-t border-stone-200 pt-4">
        {lots.map((lot) => {
          const checked = selectedIds.includes(lot.id)
          return (
            <label key={lot.id} className={`grid cursor-pointer gap-3 rounded-xl border px-4 py-3 text-sm transition md:grid-cols-[auto_1.1fr_0.8fr_0.8fr_1fr] ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-stone-200 bg-white hover:bg-stone-50'}`}>
              <div className="flex items-center">
                <input type="checkbox" checked={checked} onChange={() => onToggle(requirement.material_id, lot.id)} className="h-4 w-4 rounded border-stone-300 text-emerald-700 focus:ring-emerald-600" />
              </div>
              <div>
                <div className="font-semibold text-stone-800">{lot.internal_lot}</div>
                <div className="mt-1 text-xs text-stone-500">Lote procesado</div>
              </div>
              <div>
                <div className="text-stone-800">{lot.processed_type || 'unico'}</div>
                <div className="mt-1 text-xs text-stone-500">Tipo</div>
              </div>
              <div>
                <div className="font-semibold text-stone-800">{formatNumber(lot.available_quantity)} {lot.unit}</div>
                <div className="mt-1 text-xs text-stone-500">Disponible</div>
              </div>
              <div>
                <div className="text-stone-800">{lot.location || '—'}</div>
                <div className="mt-1 text-xs text-stone-500">Ubicación</div>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ─── Sparkline (tiny bar chart) ──────────────────────────────────────────────

function Sparkline({ values }) {
  if (!values || values.length === 0) return null
  const max = Math.max(...values, 1)
  const w = 6
  const gap = 2
  const totalW = values.length * (w + gap) - gap
  return (
    <svg width={totalW} height={24} className="shrink-0">
      {values.map((v, i) => {
        const h = max > 0 ? Math.round((v / max) * 22) : 0
        const x = i * (w + gap)
        return (
          <rect
            key={i}
            x={x}
            y={24 - h}
            width={w}
            height={h}
            rx={1}
            fill={v === 0 ? '#e7e5e4' : '#2f5d50'}
            opacity={v === 0 ? 0.4 : 0.7 + (i === 0 ? 0.3 : 0)}
          />
        )
      })}
    </svg>
  )
}

// ─── Confidence badge ────────────────────────────────────────────────────────

function ConfidenceBadge({ level }) {
  const styles = {
    alto:  'bg-emerald-100 text-emerald-800',
    medio: 'bg-amber-100 text-amber-800',
    bajo:  'bg-stone-100 text-stone-600',
  }
  const labels = { alto: 'Confianza alta', medio: 'Confianza media', bajo: 'Confianza baja' }
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${styles[level] || styles.bajo}`}>
      {labels[level] || level}
    </span>
  )
}

// ─── Trend badge ─────────────────────────────────────────────────────────────

function TrendBadge({ trend }) {
  const map = {
    creciendo: { icon: '↑', cls: 'text-emerald-700' },
    bajando:   { icon: '↓', cls: 'text-red-600' },
    estable:   { icon: '→', cls: 'text-stone-500' },
  }
  const t = map[trend] || map.estable
  return <span className={`text-xs font-semibold ${t.cls}`}>{t.icon} {trend}</span>
}

// ─── Projection row card ─────────────────────────────────────────────────────

function ProyeccionRowCard({ item, onEmpacar }) {
  const urgente = item.pending_to_pack > 0 && item.cold_stock < item.pending_to_pack
  const necesita = item.net_to_produce > 0
  const suficiente = !urgente && !necesita

  const borderColor = urgente
    ? 'border-red-300 bg-red-50/60'
    : necesita
    ? 'border-amber-200 bg-amber-50/40'
    : 'border-stone-200 bg-white'

  return (
    <div className={`rounded-2xl border px-5 py-4 transition ${borderColor}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {/* Left: product info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {urgente && (
              <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
                ⚠ Déficit inmediato
              </span>
            )}
            {necesita && !urgente && (
              <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                Producir hoy
              </span>
            )}
            {suficiente && (
              <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Stock suficiente
              </span>
            )}
            <ConfidenceBadge level={item.confidence} />
            <TrendBadge trend={item.trend} />
          </div>

          <div className="mt-1.5 text-base font-semibold text-stone-800">{item.sku_nombre}</div>
          <div className="text-xs text-stone-500">
            {item.sku_code} · {item.product_base} · {formatNumber(item.net_weight)} {item.unit}
          </div>
        </div>

        {/* Center: key numbers */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs text-stone-400 uppercase tracking-wide">Pedidos hoy</div>
            <div className={`font-semibold ${item.confirmed_today > 0 ? 'text-stone-800' : 'text-stone-400'}`}>
              {item.confirmed_today > 0 ? formatNumber(item.confirmed_today) : '—'} und
            </div>
          </div>
          <div>
            <div className="text-xs text-stone-400 uppercase tracking-wide">Proyectado</div>
            <div className="font-semibold text-stone-800">{formatNumber(item.projected)} und</div>
          </div>
          <div>
            <div className="text-xs text-stone-400 uppercase tracking-wide">Stock frío</div>
            <div className={`font-semibold ${item.cold_stock > 0 ? 'text-stone-700' : 'text-stone-400'}`}>
              {item.cold_stock > 0 ? formatNumber(item.cold_stock) : '0'} und
            </div>
            {item.days_of_coverage < 2 && item.projected > 0 && (
              <div className="text-xs text-red-600 font-medium">
                {item.days_of_coverage < 1 ? 'Sin cobertura' : `~${formatNumber(item.days_of_coverage)} días`}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-stone-400 uppercase tracking-wide">A producir</div>
            <div className={`text-lg font-bold ${item.net_to_produce > 0 ? 'text-[#2f5d50]' : 'text-stone-400'}`}>
              {item.net_to_produce > 0 ? formatNumber(item.net_to_produce) : '0'}
            </div>
          </div>
        </div>

        {/* Right: sparkline + action */}
        <div className="flex flex-col items-end gap-3 lg:shrink-0">
          <div className="flex flex-col items-end gap-1">
            <div className="text-xs text-stone-400">Últimas {item.historical_values.length} semanas</div>
            <Sparkline values={[...item.historical_values].reverse()} />
          </div>
          {item.net_to_produce > 0 && (
            <button
              onClick={() => onEmpacar(item)}
              className="rounded-xl bg-[#2f5d50] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#264c42]"
            >
              + Crear orden ({formatNumber(item.net_to_produce)} und)
            </button>
          )}
        </div>
      </div>

      {/* Stats footer */}
      {item.data_points > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-stone-200 pt-2.5 text-xs text-stone-500">
          <span>Prom. ponderado: <strong className="text-stone-700">{formatNumber(item.weighted_avg)} und</strong></span>
          {item.cv !== null && (
            <span>Variabilidad (CV): <strong className={item.cv > 0.5 ? 'text-amber-700' : 'text-stone-700'}>{formatNumber(item.cv * 100, 0)}%</strong></span>
          )}
          <span>Semanas con datos: <strong className="text-stone-700">{item.data_points}/{item.historical_values.length}</strong></span>
          {item.pending_to_pack > 0 && (
            <span className="text-red-600 font-medium">Sin empacar del pedido: {formatNumber(item.pending_to_pack)} und</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Projection panel ─────────────────────────────────────────────────────────

function ProyeccionPanel({ onEmpacar }) {
  const [fecha, setFecha] = useState(todayString)
  const [safety, setSafety] = useState(1.15)
  const [loading, setLoading] = useState(false)
  const [proyeccion, setProyeccion] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('todos') // 'todos' | 'producir' | 'urgente'
  const [search, setSearch] = useState('')

  const fetchProyeccion = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getProyeccionDia(fecha, safety)
      setProyeccion(data)
    } catch (e) {
      setError(e.message || 'No se pudo generar la proyección')
    } finally {
      setLoading(false)
    }
  }, [fecha, safety])

  // Auto-load on mount with today's date
  useEffect(() => { fetchProyeccion() }, [fetchProyeccion])

  const filteredItems = useMemo(() => {
    if (!proyeccion) return []
    let items = proyeccion.items
    if (filter === 'producir') items = items.filter(i => i.net_to_produce > 0)
    if (filter === 'urgente')  items = items.filter(i => i.pending_to_pack > 0 && i.cold_stock < i.pending_to_pack)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      items = items.filter(i =>
        i.sku_nombre.toLowerCase().includes(q) ||
        i.sku_code.toLowerCase().includes(q) ||
        i.product_base.toLowerCase().includes(q)
      )
    }
    return items
  }, [proyeccion, filter, search])

  const s = proyeccion?.summary

  return (
    <section className="rounded-[28px] border border-stone-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-stone-200 px-6 py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-stone-800">Proyección de demanda</h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Basado en historial de {proyeccion?.summary?.semanas_historico ?? 8} semanas del mismo día · media ponderada con factor de seguridad
            </p>
          </div>
          <button
            onClick={fetchProyeccion}
            disabled={loading}
            className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60"
          >
            {loading ? 'Calculando...' : 'Recalcular'}
          </button>
        </div>

        {/* Controls */}
        <div className="mt-4 flex flex-wrap gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-600">Fecha a proyectar</label>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-600">
              Factor de seguridad ({Math.round((safety - 1) * 100)}% buffer)
            </label>
            <select
              value={safety}
              onChange={e => setSafety(Number(e.target.value))}
              className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
            >
              <option value={1.0}>0% — Exacto</option>
              <option value={1.05}>5%</option>
              <option value={1.10}>10%</option>
              <option value={1.15}>15% (recomendado)</option>
              <option value={1.20}>20%</option>
              <option value={1.30}>30%</option>
            </select>
          </div>
          {proyeccion && (
            <div className="self-end text-xs text-stone-500">
              {proyeccion.dia_semana} · {proyeccion.fecha}
            </div>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      {s && (
        <div className="grid grid-cols-2 gap-px border-b border-stone-200 bg-stone-200 md:grid-cols-5">
          {[
            { label: 'SKUs totales', value: s.total_skus },
            { label: 'Con pedido hoy', value: s.skus_con_pedidos_hoy, color: s.skus_con_pedidos_hoy > 0 ? 'text-blue-700' : '' },
            { label: 'Déficit inmediato', value: s.skus_deficit_inmediato, color: s.skus_deficit_inmediato > 0 ? 'text-red-700 font-bold' : '' },
            { label: 'A producir hoy', value: s.skus_a_producir, color: s.skus_a_producir > 0 ? 'text-amber-700' : '' },
            { label: 'Stock suficiente', value: s.skus_stock_suficiente, color: 'text-emerald-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white px-5 py-4">
              <div className="text-xs text-stone-400 uppercase tracking-wide">{label}</div>
              <div className={`mt-1 text-2xl font-bold text-stone-800 ${color || ''}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {proyeccion && (
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div className="flex rounded-2xl border border-stone-200 bg-stone-100 p-1 text-sm">
            {[
              { key: 'todos', label: 'Todos' },
              { key: 'producir', label: 'A producir' },
              { key: 'urgente', label: 'Urgente' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
                  filter === tab.key
                    ? 'bg-white text-stone-800 shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Buscar SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
          />
          <div className="text-xs text-stone-400">{filteredItems.length} SKU{filteredItems.length !== 1 ? 's' : ''}</div>
        </div>
      )}

      {/* Content */}
      <div className="px-6 pb-6 space-y-3">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading && (
          <div className="py-10 text-center text-sm text-stone-500">Calculando proyección...</div>
        )}

        {!loading && proyeccion && filteredItems.length === 0 && (
          <div className="py-10 text-center text-sm text-stone-500">
            {filter === 'todos' ? 'No hay presentaciones activas.' : 'No hay SKUs en esta categoría.'}
          </div>
        )}

        {!loading && filteredItems.map(item => (
          <ProyeccionRowCard
            key={item.product_presentation_id}
            item={item}
            onEmpacar={onEmpacar}
          />
        ))}

        {!loading && proyeccion && (
          <div className="mt-4 rounded-2xl border border-stone-100 bg-stone-50 px-5 py-3 text-xs text-stone-400">
            Metodología: media ponderada de las últimas {proyeccion.summary.semanas_historico} semanas del mismo día de la semana
            (pesos 4-3-2-1-1-1-1-1). Factor de seguridad: ×{proyeccion.summary.safety_factor}.
            Solo cuenta stock en cuarto frío con ≥2 días de vida útil y no bloqueado por calidad.
          </div>
        )}
      </div>
    </section>
  )
}

// ─── New packaging order modal ────────────────────────────────────────────────

function NuevaOrdenModal({ presentations, processedLots, recipes, org, onClose, onCreated, prefill }) {
  const [productPresentationId, setProductPresentationId] = useState(prefill?.product_presentation_id || '')
  const [runDate, setRunDate] = useState(todayString)
  const [quantityPacked, setQuantityPacked] = useState(prefill?.net_to_produce > 0 ? String(Math.ceil(prefill.net_to_produce)) : '')
  const [notes, setNotes] = useState('')
  const [selectedLots, setSelectedLots] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const selectedPresentation = useMemo(() => presentations.find((p) => p.id === productPresentationId) || null, [presentations, productPresentationId])

  const recipeItems = useMemo(() => {
    if (!selectedPresentation) return []
    return recipes.filter((r) => r.product_base_id === selectedPresentation.product_base_id)
  }, [recipes, selectedPresentation])

  const requirements = useMemo(() => calculateRecipeRequirements(selectedPresentation, numberOrZero(quantityPacked), recipeItems), [selectedPresentation, quantityPacked, recipeItems])

  // Auto-generated lot code (read-only display)
  const finishedLotCode = useMemo(
    () => buildDefaultFinishedLotCode(selectedPresentation, runDate),
    [selectedPresentation, runDate]
  )

  useEffect(() => {
    if (selectedPresentation) setSelectedLots({})
  }, [selectedPresentation, runDate])

  function getLotsForMaterial(materialId) {
    return processedLots.filter((l) => l.material_id === materialId)
  }

  function getSelectedQty(materialId) {
    const ids = selectedLots[materialId] || []
    return getLotsForMaterial(materialId).filter((l) => ids.includes(l.id)).reduce((acc, l) => acc + numberOrZero(l.available_quantity), 0)
  }

  function toggleLot(materialId, lotId) {
    setSelectedLots((prev) => {
      const cur = prev[materialId] || []
      return { ...prev, [materialId]: cur.includes(lotId) ? cur.filter((x) => x !== lotId) : [...cur, lotId] }
    })
  }

  const recipeCovered = useMemo(() => (requirements.perMaterial || []).every((req) => numberOrZero(getSelectedQty(req.material_id)) >= numberOrZero(req.required_lb)), [requirements, selectedLots, processedLots])

  const expirationDate = useMemo(() => {
    if (!selectedPresentation?.shelf_life_days || !runDate) return runDate || '—'
    return new Date(new Date(runDate + 'T12:00:00').getTime() + selectedPresentation.shelf_life_days * 86400000).toISOString().slice(0, 10)
  }, [runDate, selectedPresentation])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!recipeCovered) { setErr('Debes cubrir todos los materiales de la receta'); return }
    setSaving(true)
    setErr('')
    try {
      const order = await createPackagingOrder({
        productPresentationId,
        runDate,
        quantityToPack: numberOrZero(quantityPacked),
        finishedLotCode,
        notes,
        selectedProcessedLotIdsByMaterial: selectedLots,
      })
      // Auto-print labels
      printLabels({ order, org })
      onCreated(order)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="w-full max-w-3xl rounded-[28px] bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-stone-800">Nueva orden de empaque</h2>
            <p className="mt-1 text-sm text-stone-500">Al crear la orden se imprimirán las etiquetas automáticamente.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Basic fields */}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Producto *">
              <select value={productPresentationId} onChange={(e) => setProductPresentationId(e.target.value)} required className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100">
                <option value="">Selecciona un producto</option>
                {presentations.map((p) => <option key={p.id} value={p.id}>{p.display_name} ({formatNumber(p.net_weight)} {p.unit})</option>)}
              </select>
            </Field>
            <Field label="Fecha de producción *">
              <input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} required className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </Field>
            <Field label="Cantidad a empacar *">
              <input type="number" step="1" min="1" value={quantityPacked} onChange={(e) => setQuantityPacked(e.target.value)} required className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
            </Field>
            <div>
              <span className="mb-2 block text-sm font-medium text-stone-700">Código de lote (auto)</span>
              <div className="flex items-center rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3 text-sm font-mono text-stone-600">
                {finishedLotCode || <span className="text-stone-400 italic">Selecciona producto y fecha</span>}
              </div>
            </div>
          </div>

          {selectedPresentation && (
            <div className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-3">
              <InfoMini label="Producto base" value={selectedPresentation.product_base_name || '—'} />
              <InfoMini label="Código de barras" value={selectedPresentation.barcode || 'Sin barcode'} />
              <InfoMini label="Vencimiento estimado" value={formatDate(expirationDate)} />
            </div>
          )}

          {/* Recipe coverage */}
          {requirements.perMaterial?.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-700">Materiales de receta</h3>
                <StatusPill covered={recipeCovered} />
              </div>
              {requirements.perMaterial.map((req) => (
                <MaterialSelectionCard
                  key={req.material_id}
                  requirement={req}
                  lots={getLotsForMaterial(req.material_id)}
                  selectedIds={selectedLots[req.material_id] || []}
                  onToggle={toggleLot}
                  selectedAvailable={getSelectedQty(req.material_id)}
                />
              ))}
            </div>
          )}

          <Field label="Notas">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
          </Field>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex justify-end gap-3 border-t border-stone-200 pt-4">
            <button type="button" onClick={onClose} className="rounded-2xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving || !recipeCovered || !productPresentationId} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:opacity-60">
              {saving ? 'Creando orden...' : '📦 Crear orden + imprimir etiquetas'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Active order card ────────────────────────────────────────────────────────

function ActiveOrderCard({ order, onCompleted, onCancelled, onReprint }) {
  const [completing, setCompleting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [err, setErr] = useState('')

  const pp = order.product_presentations

  async function handleComplete() {
    setCompleting(true)
    setErr('')
    try {
      await completarPackagingOrder(order.id)
      onCompleted(order.id)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setCompleting(false)
    }
  }

  async function handleCancel() {
    if (!confirm('¿Cancelar esta orden de empaque?')) return
    setCancelling(true)
    try {
      await cancelarPackagingOrder(order.id)
      onCancelled(order.id)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">En proceso</span>
            <span className="text-sm font-semibold text-stone-800">{order.finished_lot_code}</span>
          </div>
          <div className="mt-1 text-sm text-stone-700">{pp?.display_name || '—'}</div>
          <div className="mt-0.5 text-xs text-stone-500">
            {formatNumber(order.quantity_to_pack)} unidades · Producción: {formatDate(order.run_date)}
          </div>
          {pp?.barcode && <div className="mt-0.5 text-xs text-stone-400">Barcode: {pp.barcode}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onReprint(order)}
            className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
          >
            🖨 Reimprimir etiquetas
          </button>
          <button
            onClick={handleComplete}
            disabled={completing || cancelling}
            className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {completing ? 'Procesando...' : '✓ Marcar empacado'}
          </button>
          <button
            onClick={handleCancel}
            disabled={completing || cancelling}
            className="rounded-xl bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-200 disabled:opacity-60"
          >
            {cancelling ? '...' : 'Cancelar'}
          </button>
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmpaquePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [presentations, setPresentations] = useState([])
  const [processedLots, setProcessedLots] = useState([])
  const [recipes, setRecipes] = useState([])
  const [activeOrders, setActiveOrders] = useState([])
  const [org, setOrg] = useState(null)

  const [showNuevaOrden, setShowNuevaOrden] = useState(false)
  const [prefillData, setPrefillData] = useState(null)
  const [newOrderBanner, setNewOrderBanner] = useState(null) // { name, qty }

  const activeOrdersRef = useRef(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [formData, orders, organization] = await Promise.all([
        getPackagingFormData(),
        getActivePackagingOrders(),
        getOrganization().catch(() => null),
      ])
      setPresentations(formData.presentations || [])
      setProcessedLots(formData.processedLots || [])
      setRecipes(formData.recipes || [])
      setActiveOrders(orders)
      setOrg(organization)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el módulo de empaque')
    } finally {
      setLoading(false)
    }
  }

  function handleEmpacarFromProyeccion(item) {
    setPrefillData(item)
    setShowNuevaOrden(true)
  }

  function handleOrderCreated(order) {
    setActiveOrders((prev) => [order, ...prev])
    setShowNuevaOrden(false)
    setPrefillData(null)
    const name = order.product_presentations?.display_name || 'Orden'
    const qty  = order.quantity_to_pack
    setNewOrderBanner({ name, qty })
    setTimeout(() => setNewOrderBanner(null), 5000)
    setTimeout(() => {
      activeOrdersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  function handleOrderCompleted(orderId) {
    setActiveOrders((prev) => prev.filter((o) => o.id !== orderId))
    loadAll() // refresh processed lots
  }

  function handleOrderCancelled(orderId) {
    setActiveOrders((prev) => prev.filter((o) => o.id !== orderId))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-stone-500">
        Cargando empaque...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Producción</p>
          <h1 className="text-3xl font-semibold text-stone-800">Empaque</h1>
          <p className="mt-2 text-sm text-stone-500">
            Crea órdenes de empaque, imprime etiquetas y marca lotes como completados.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNuevaOrden(true)}
            className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
          >
            + Nueva orden de empaque
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Banner: orden creada */}
      {newOrderBanner && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800 shadow-sm flex items-center justify-between">
          <span>✓ Orden creada — <strong>{newOrderBanner.name}</strong> · {newOrderBanner.qty} unidades. Revisa "Órdenes en proceso" para marcarla como empacada.</span>
          <button onClick={() => setNewOrderBanner(null)} className="ml-4 text-emerald-600 hover:text-emerald-800 font-bold text-base leading-none">×</button>
        </div>
      )}

      {/* Active orders */}
      <section ref={activeOrdersRef} className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm scroll-mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-800">
            Órdenes en proceso
            {activeOrders.length > 0 && (
              <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{activeOrders.length}</span>
            )}
          </h2>
          <button onClick={loadAll} className="rounded-2xl border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50">
            Recargar
          </button>
        </div>

        {activeOrders.length === 0 ? (
          <EmptyState text="No hay órdenes en proceso. Crea una nueva orden de empaque." />
        ) : (
          <div className="space-y-3">
            {activeOrders.map((order) => (
              <ActiveOrderCard
                key={order.id}
                order={order}
                onCompleted={handleOrderCompleted}
                onCancelled={handleOrderCancelled}
                onReprint={(o) => printLabels({ order: o, org })}
              />
            ))}
          </div>
        )}
      </section>

      {/* KPIs */}
      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Presentaciones activas" value={presentations.length} hint="Disponibles para empacar" />
        <KpiCard label="Lotes procesados disponibles" value={processedLots.length} hint="Con stock > 0" />
        <KpiCard label="Órdenes en proceso" value={activeOrders.length} hint="Pendientes de completar" />
      </section>

      {/* Demand projection panel */}
      <ProyeccionPanel onEmpacar={handleEmpacarFromProyeccion} />

      {/* Modals */}
      {showNuevaOrden && (
        <NuevaOrdenModal
          presentations={presentations}
          processedLots={processedLots}
          recipes={recipes}
          org={org}
          onClose={() => { setShowNuevaOrden(false); setPrefillData(null) }}
          onCreated={handleOrderCreated}
          prefill={prefillData}
        />
      )}

    </div>
  )
}
