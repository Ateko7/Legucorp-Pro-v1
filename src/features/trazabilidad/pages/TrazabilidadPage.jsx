import { useState } from 'react'
import {
  buscarLoteMP,
  buscarLoteTerminado,
  trazarDesdeMp,
  trazarDesdeLoteTerminado,
  getRecalls,
  iniciarRecall,
  resolverRecall,
  cerrarRecall,
  fetchRecallReport,
} from '../services/trazabilidadService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('es-GT')
}

function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('es-GT')
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

function fmt(v) {
  const n = Number(v)
  return Number.isNaN(n) ? '—' : n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function printRecallPdf({ recall, mpLots, suppliers, finishedLots, orders, clients }) {
  const now = new Date().toLocaleString('es-GT')

  const rows = (arr, fn) => arr.length > 0 ? arr.map(fn).join('') : '<tr><td colspan="99" style="color:#aaa;padding:8px;">Sin registros</td></tr>'

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Recall ${recall.numero}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #222; background: #fff; padding: 32px; }
  h1 { font-size: 20px; font-weight: 700; color: #b91c1c; }
  h2 { font-size: 13px; font-weight: 700; color: #292524; margin: 24px 0 8px; border-bottom: 1px solid #e7e5e4; padding-bottom: 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 16px 0; }
  .meta-box { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 8px; padding: 10px 14px; }
  .meta-label { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #a8a29e; margin-bottom: 2px; }
  .meta-value { font-size: 12px; font-weight: 600; color: #292524; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 600; }
  .badge-red { background: #fee2e2; color: #b91c1c; }
  .badge-yellow { background: #fef9c3; color: #92400e; }
  .badge-stone { background: #f5f5f4; color: #57534e; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #78716c; padding: 6px 8px; background: #fafaf9; border-bottom: 1px solid #e7e5e4; }
  td { padding: 7px 8px; border-bottom: 1px solid #f5f5f4; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .motivo { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 14px; margin: 8px 0 4px; font-size: 12px; }
  .footer { margin-top: 32px; font-size: 9px; color: #a8a29e; border-top: 1px solid #e7e5e4; padding-top: 8px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
<h1>⚠ Recall ${recall.numero}</h1>
<p style="color:#78716c;margin-top:4px;">Generado el ${now}</p>

<div class="motivo">
  <strong>Motivo:</strong> ${recall.motivo || '—'}<br/>
  ${recall.descripcion ? `<span style="color:#78716c">${recall.descripcion}</span>` : ''}
</div>

<div class="meta">
  <div class="meta-box">
    <div class="meta-label">Estado</div>
    <div class="meta-value">
      <span class="badge ${recall.status === 'activo' ? 'badge-red' : recall.status === 'resuelto' ? 'badge-yellow' : 'badge-stone'}">${recall.status?.toUpperCase()}</span>
    </div>
  </div>
  <div class="meta-box">
    <div class="meta-label">Tipo</div>
    <div class="meta-value">${recall.tipo === 'materia_prima' ? 'Materia Prima' : 'Lote Terminado'}</div>
  </div>
  <div class="meta-box">
    <div class="meta-label">Lote origen</div>
    <div class="meta-value">${recall.lote_origen_codigo || '—'}</div>
  </div>
</div>

<h2>1. Clientes a contactar (${clients.length})</h2>
<table>
  <thead><tr>
    <th>Cliente</th><th>País</th><th>Pedidos afectados</th><th>Fechas de entrega</th>
  </tr></thead>
  <tbody>
    ${rows(clients, (c) => `<tr>
      <td><strong>${c.commercial_name || c.name || '—'}</strong></td>
      <td>${c.pais || '—'}</td>
      <td>${c.orders.map((o) => o.order_number).join(', ')}</td>
      <td>${c.orders.map((o) => o.delivery_date ? new Date(o.delivery_date).toLocaleDateString('es-GT') : '—').join(', ')}</td>
    </tr>`)}
  </tbody>
</table>

<h2>2. Proveedores a contactar (${suppliers.length})</h2>
<table>
  <thead><tr>
    <th>Proveedor</th><th>Email</th><th>Teléfono</th><th>Fecha recepción</th>
  </tr></thead>
  <tbody>
    ${rows(suppliers, (s) => `<tr>
      <td><strong>${s.name || '—'}</strong></td>
      <td>${s.email || '—'}</td>
      <td>${s.phone || '—'}</td>
      <td>${s.received_date ? new Date(s.received_date).toLocaleDateString('es-GT') : '—'}</td>
    </tr>`)}
  </tbody>
</table>

<h2>3. Materias primas afectadas (${mpLots.length})</h2>
<table>
  <thead><tr>
    <th>Lote interno</th><th>Lote proveedor</th><th>Material</th><th>Cantidad</th><th>Unidad</th><th>Estado</th><th>Fecha ingreso</th>
  </tr></thead>
  <tbody>
    ${rows(mpLots, (l) => `<tr>
      <td><strong>${l.internal_lot || '—'}</strong></td>
      <td>${l.supplier_lot || '—'}</td>
      <td>${l.materials?.common_name || '—'} ${l.materials?.code ? `(${l.materials.code})` : ''}</td>
      <td>${fmt(l.available_quantity)}</td>
      <td>${l.unit || '—'}</td>
      <td>${l.status || '—'}</td>
      <td>${l.created_at ? new Date(l.created_at).toLocaleDateString('es-GT') : '—'}</td>
    </tr>`)}
  </tbody>
</table>

<h2>4. Productos terminados en recall (${finishedLots.length})</h2>
<table>
  <thead><tr>
    <th>Lote terminado</th><th>Producto</th><th>Base</th><th>Disponible</th><th>Producción</th><th>Vencimiento</th><th>Estado</th>
  </tr></thead>
  <tbody>
    ${rows(finishedLots, (l) => `<tr>
      <td><strong>${l.finished_lot_code || '—'}</strong></td>
      <td>${l.product_presentations?.display_name || '—'}</td>
      <td>${l.product_presentations?.product_bases?.common_name || '—'}</td>
      <td>${fmt(l.available_quantity)} ${l.unit || ''}</td>
      <td>${l.production_date ? new Date(l.production_date).toLocaleDateString('es-GT') : '—'}</td>
      <td>${l.expiration_date ? new Date(l.expiration_date).toLocaleDateString('es-GT') : '—'}</td>
      <td>${l.status || '—'}</td>
    </tr>`)}
  </tbody>
</table>

<h2>5. Pedidos afectados (${orders.length})</h2>
<table>
  <thead><tr>
    <th>Pedido</th><th>Cliente</th><th>Fecha entrega</th><th>Total</th><th>Moneda</th><th>Estado</th>
  </tr></thead>
  <tbody>
    ${rows(orders, (o) => `<tr>
      <td><strong>${o.order_number || o.id?.slice(0, 8) || '—'}</strong></td>
      <td>${o.clients?.commercial_name || '—'}</td>
      <td>${o.delivery_date ? new Date(o.delivery_date).toLocaleDateString('es-GT') : '—'}</td>
      <td>${fmt(o.total)}</td>
      <td>${o.moneda || 'GTQ'}</td>
      <td>${o.status || '—'}</td>
    </tr>`)}
  </tbody>
</table>

<div class="footer">Recall ${recall.numero} · Generado automáticamente por Legucorp Pro · ${now}</div>
<script>window.onload = () => { window.print() }</script>
</body></html>`

  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) { alert('Permite ventanas emergentes para generar el PDF'); return }
  win.document.write(html)
  win.document.close()
}

// ─── Small UI ─────────────────────────────────────────────────────────────────

function Pill({ color = 'stone', children }) {
  const colors = {
    stone: 'bg-stone-100 text-stone-700',
    green: 'bg-emerald-100 text-emerald-800',
    yellow: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
  }
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors[color] || colors.stone}`}>
      {children}
    </span>
  )
}

function RecallBadge() {
  return <Pill color="red">En recall</Pill>
}

function SectionTitle({ children }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="h-px flex-1 bg-stone-200" />
      <span className="text-xs font-semibold uppercase tracking-widest text-stone-400">{children}</span>
      <div className="h-px flex-1 bg-stone-200" />
    </div>
  )
}

function ChainNode({ icon, title, subtitle, pills, children, highlight }) {
  return (
    <div className={`rounded-2xl border px-5 py-4 ${highlight ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <span className="text-base">{icon}</span>
            {title}
          </div>
          {subtitle && <div className="mt-0.5 text-xs text-stone-500">{subtitle}</div>}
        </div>
        {pills && <div className="flex flex-wrap gap-1">{pills}</div>}
      </div>
      {children && <div className="mt-3 border-t border-stone-100 pt-3">{children}</div>}
    </div>
  )
}

function Connector() {
  return (
    <div className="flex justify-center py-1">
      <div className="flex flex-col items-center gap-0.5">
        <div className="h-2 w-0.5 bg-stone-300" />
        <div className="text-stone-300">▼</div>
      </div>
    </div>
  )
}

function MiniTable({ rows }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i} className="border-b border-stone-50 last:border-0">
              <td className="py-1 pr-3 font-medium text-stone-500">{label}</td>
              <td className="py-1 text-stone-800">{value ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Chain: MP → Cliente ──────────────────────────────────────────────────────

function ChainMP({ chain, onRecall }) {
  const { mpLot, processRuns, processOutputs, processedLots, packagingRuns, finishedLots, orderPackings, orders } = chain

  return (
    <div className="space-y-0">
      {/* MP Lot */}
      {mpLot && (
        <ChainNode
          icon="🌿"
          title={`MP: ${mpLot.internal_lot || mpLot.supplier_lot || mpLot.id.slice(0, 8)}`}
          subtitle={mpLot.materials?.common_name}
          highlight={mpLot.en_recall}
          pills={[
            mpLot.en_recall ? <RecallBadge key="r" /> : null,
            <Pill key="s" color="stone">{mpLot.status}</Pill>,
          ].filter(Boolean)}
        >
          <MiniTable rows={[
            ['Material', mpLot.materials?.common_name],
            ['Código', mpLot.materials?.code],
            ['Lote proveedor', mpLot.supplier_lot],
            ['Cantidad ingresada', `${mpLot.available_quantity} ${mpLot.unit}`],
            ['Fecha ingreso', formatDate(mpLot.created_at)],
          ]} />
          {!mpLot.en_recall && onRecall && (
            <button
              onClick={() => onRecall({ tipo: 'materia_prima', loteOrigenId: mpLot.id, loteOrigenTipo: 'materia_prima', loteOrigenCodigo: mpLot.internal_lot || mpLot.supplier_lot })}
              className="mt-2 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
            >
              Iniciar recall
            </button>
          )}
        </ChainNode>
      )}

      {/* Process runs */}
      {processRuns?.length > 0 && (
        <>
          <Connector />
          <SectionTitle>Procesos MP ({processRuns.length})</SectionTitle>
          <div className="space-y-2">
            {processRuns.map((run) => {
              const outputs = (processOutputs || []).filter((o) => o.process_run_id === run.id)
              return (
                <ChainNode key={run.id} icon="⚙️"
                  title={`Proceso: ${run.start_stage || run.current_stage || '—'}`}
                  subtitle={`Lote: ${run.source_internal_lot || '—'}`}
                >
                  <MiniTable rows={[
                    ['Etapa', run.start_stage],
                    ['Estado', run.status],
                    ['Fecha', formatDate(run.process_date)],
                    ['Entrada', `${run.input_quantity} ${run.input_unit}`],
                    ['Salidas', outputs.length > 0
                      ? outputs.map((o) => `${o.output_lot_code} · ${o.output_quantity} ${o.unit} (${o.output_type})`).join(' | ')
                      : 'Sin salidas registradas'],
                  ]} />
                </ChainNode>
              )
            })}
          </div>
        </>
      )}

      {/* Processed lots */}
      {processedLots?.length > 0 && (
        <>
          <Connector />
          <SectionTitle>Lotes procesados ({processedLots.length})</SectionTitle>
          <div className="space-y-2">
            {processedLots.map((lot) => (
              <ChainNode key={lot.id} icon="🧪"
                title={lot.internal_lot || lot.id.slice(0, 8)}
                subtitle={`${lot.processed_stage} · ${lot.processed_type}`}
              >
                <MiniTable rows={[
                  ['Cantidad original', `${lot.original_quantity} ${lot.unit}`],
                  ['Disponible', `${lot.available_quantity} ${lot.unit}`],
                  ['Estado', lot.status],
                  ['Fecha', formatDate(lot.created_at)],
                ]} />
              </ChainNode>
            ))}
          </div>
        </>
      )}

      {/* Packaging runs */}
      {packagingRuns?.length > 0 && (
        <>
          <Connector />
          <SectionTitle>Corridas de empaque ({packagingRuns.length})</SectionTitle>
          <div className="space-y-2">
            {packagingRuns.map((run) => (
              <ChainNode key={run.id} icon="📦"
                title={run.finished_lot_code || run.id.slice(0, 8)}
                subtitle={run.product_presentations?.display_name || run.product_presentations?.product_bases?.common_name}
              >
                <MiniTable rows={[
                  ['Producto', run.product_presentations?.display_name],
                  ['Base', run.product_presentations?.product_bases?.common_name],
                  ['Cantidad producida', `${run.quantity_produced} ${run.unit}`],
                  ['Fecha', formatDate(run.run_date)],
                  ['Estado', run.status],
                ]} />
              </ChainNode>
            ))}
          </div>
        </>
      )}

      {/* Finished lots */}
      {finishedLots?.length > 0 && (
        <>
          <Connector />
          <SectionTitle>Lotes terminados ({finishedLots.length})</SectionTitle>
          <div className="space-y-2">
            {finishedLots.map((lot) => {
              const packings = (orderPackings || []).filter((p) => p.finished_inventory_lot_id === lot.id)
              const ordersForLot = orders.filter((o) => packings.some((p) => p.order_items?.order_id === o.id))
              return (
                <ChainNode
                  key={lot.id}
                  icon="🏷️"
                  title={lot.finished_lot_code}
                  subtitle={lot.product_presentations?.display_name}
                  highlight={lot.en_recall}
                  pills={[
                    lot.en_recall ? <RecallBadge key="r" /> : null,
                    <Pill key="s" color="stone">{lot.status}</Pill>,
                  ].filter(Boolean)}
                >
                  <MiniTable rows={[
                    ['Producto', lot.product_presentations?.display_name],
                    ['Código', lot.product_presentations?.code],
                    ['Disponible', `${lot.available_quantity} ${lot.unit}`],
                    ['Producción', formatDate(lot.production_date)],
                    ['Vencimiento', formatDate(lot.expiration_date)],
                    ['Despachos', packings.length > 0 ? `${packings.length} despacho(s)` : 'Sin despachar'],
                  ]} />
                  {ordersForLot.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {ordersForLot.map((o) => {
                        const p = packings.find((pk) => pk.order_items?.order_id === o.id)
                        return (
                          <div key={o.id} className="rounded-lg bg-stone-50 px-3 py-2 text-xs">
                            <span className="font-medium">{o.order_number}</span>
                            {' · '}{o.clients?.commercial_name}
                            {o.clients?.pais ? ` (${o.clients.pais})` : ''}
                            {' · '}{formatDate(o.delivery_date)}
                            {p ? ` · ${p.quantity_packed} uds` : ''}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {!lot.en_recall && onRecall && (
                    <button
                      onClick={() => onRecall({ tipo: 'lote_terminado', loteOrigenId: lot.id, loteOrigenTipo: 'lote_terminado', loteOrigenCodigo: lot.finished_lot_code })}
                      className="mt-2 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                    >
                      Iniciar recall
                    </button>
                  )}
                </ChainNode>
              )
            })}
          </div>
        </>
      )}

      {/* Orders summary */}
      {orders?.length > 0 && (
        <>
          <Connector />
          <SectionTitle>Clientes que recibieron este lote ({orders.length})</SectionTitle>
          <div className="space-y-2">
            {orders.map((order) => {
              const packings = (orderPackings || []).filter((p) => p.order_items?.order_id === order.id)
              const totalQty = packings.reduce((acc, p) => acc + Number(p.quantity_packed || 0), 0)
              return (
                <ChainNode
                  key={order.id}
                  icon="🚚"
                  title={order.order_number || order.id.slice(0, 8)}
                  subtitle={order.clients?.commercial_name}
                  pills={[<Pill key="s" color="green">{order.status}</Pill>]}
                >
                  <MiniTable rows={[
                    ['Cliente', order.clients?.commercial_name],
                    ['País', order.clients?.pais],
                    ['Fecha entrega', formatDate(order.delivery_date)],
                    ['Unidades despachadas', totalQty],
                    ['Total pedido', `${order.total} ${order.moneda || 'GTQ'}`],
                  ]} />
                </ChainNode>
              )
            })}
          </div>
        </>
      )}

      {processRuns?.length === 0 && mpLot && (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 px-5 py-6 text-center text-sm text-stone-500">
          Este lote no tiene procesos registrados. Puede que aún esté en inventario de MP.
        </div>
      )}
    </div>
  )
}

// ─── Chain: Lote terminado (bidireccional) ────────────────────────────────────

function ChainLoteTerminado({ chain, onRecall }) {
  const { finishedLot, packagingRun, packagingInputs, processedLots, processOutputs, processRuns, mpLots, orderPackings, orders } = chain

  return (
    <div className="space-y-0">
      {/* MP Lots (upstream) */}
      {mpLots?.length > 0 && (
        <>
          <SectionTitle>Materia prima de origen ({mpLots.length})</SectionTitle>
          <div className="space-y-2">
            {mpLots.map((lot) => (
              <ChainNode
                key={lot.id}
                icon="🌿"
                title={lot.internal_lot || lot.supplier_lot || lot.id.slice(0, 8)}
                subtitle={lot.materials?.common_name}
                highlight={lot.en_recall}
                pills={[lot.en_recall ? <RecallBadge key="r" /> : null, <Pill key="s" color="stone">{lot.status}</Pill>].filter(Boolean)}
              >
                <MiniTable rows={[
                  ['Material', lot.materials?.common_name],
                  ['Código', lot.materials?.code],
                  ['Lote proveedor', lot.supplier_lot],
                  ['Cantidad ingresada', `${lot.available_quantity} ${lot.unit}`],
                  ['Fecha ingreso', formatDate(lot.created_at)],
                ]} />
              </ChainNode>
            ))}
          </div>
          <Connector />
        </>
      )}

      {/* Process runs */}
      {processRuns?.length > 0 && (
        <>
          <SectionTitle>Procesos ({processRuns.length})</SectionTitle>
          <div className="space-y-2">
            {processRuns.map((run) => {
              const outputs = (processOutputs || []).filter((o) => o.process_run_id === run.id)
              return (
                <ChainNode key={run.id} icon="⚙️"
                  title={`Proceso: ${run.start_stage || run.current_stage || '—'}`}
                  subtitle={`Lote origen: ${run.source_internal_lot || '—'}`}
                >
                  <MiniTable rows={[
                    ['Etapa', run.start_stage],
                    ['Estado', run.status],
                    ['Fecha', formatDate(run.process_date)],
                    ['Entrada', `${run.input_quantity} ${run.input_unit}`],
                    ['Salidas', outputs.map((o) => `${o.output_lot_code} · ${o.output_quantity} ${o.unit}`).join(' | ') || '—'],
                  ]} />
                </ChainNode>
              )
            })}
          </div>
          <Connector />
        </>
      )}

      {/* Processed lots */}
      {processedLots?.length > 0 && (
        <>
          <SectionTitle>Lotes procesados ({processedLots.length})</SectionTitle>
          <div className="space-y-2">
            {processedLots.map((lot) => {
              const input = (packagingInputs || []).find((i) => i.source_lot_id === lot.id)
              return (
                <ChainNode key={lot.id} icon="🧪"
                  title={lot.internal_lot || lot.id.slice(0, 8)}
                  subtitle={`${lot.processed_stage} · ${lot.processed_type}`}
                >
                  <MiniTable rows={[
                    ['Cantidad original', `${lot.original_quantity} ${lot.unit}`],
                    ['Usado en empaque', input ? `${input.quantity_used} ${input.unit}` : '—'],
                    ['Estado', lot.status],
                  ]} />
                </ChainNode>
              )
            })}
          </div>
          <Connector />
        </>
      )}

      {/* Packaging run */}
      {packagingRun && (
        <>
          <SectionTitle>Corrida de empaque</SectionTitle>
          <ChainNode icon="📦"
            title={packagingRun.finished_lot_code || packagingRun.id.slice(0, 8)}
            subtitle={packagingRun.product_presentations?.display_name}
          >
            <MiniTable rows={[
              ['Producto', packagingRun.product_presentations?.display_name],
              ['Base', packagingRun.product_presentations?.product_bases?.common_name],
              ['Cantidad producida', `${packagingRun.quantity_produced} ${packagingRun.unit}`],
              ['Fecha', formatDate(packagingRun.run_date)],
              ['Estado', packagingRun.status],
            ]} />
          </ChainNode>
          <Connector />
        </>
      )}

      {/* Finished lot (center) */}
      {finishedLot && (
        <>
          <SectionTitle>Lote terminado</SectionTitle>
          <ChainNode
            icon="🏷️"
            title={finishedLot.finished_lot_code}
            subtitle={finishedLot.product_presentations?.display_name}
            highlight={finishedLot.en_recall}
            pills={[
              finishedLot.en_recall ? <RecallBadge key="r" /> : null,
              <Pill key="s" color="stone">{finishedLot.status}</Pill>,
            ].filter(Boolean)}
          >
            <MiniTable rows={[
              ['Producto', finishedLot.product_presentations?.display_name],
              ['Código', finishedLot.product_presentations?.code],
              ['Base', finishedLot.product_presentations?.product_bases?.common_name],
              ['Disponible', `${finishedLot.available_quantity} ${finishedLot.unit}`],
              ['Producción', formatDate(finishedLot.production_date)],
              ['Vencimiento', formatDate(finishedLot.expiration_date)],
            ]} />
            {!finishedLot.en_recall && onRecall && (
              <button
                onClick={() => onRecall({ tipo: 'lote_terminado', loteOrigenId: finishedLot.id, loteOrigenTipo: 'lote_terminado', loteOrigenCodigo: finishedLot.finished_lot_code })}
                className="mt-2 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
              >
                Iniciar recall
              </button>
            )}
          </ChainNode>
        </>
      )}

      {/* Orders (downstream) */}
      {orders?.length > 0 ? (
        <>
          <Connector />
          <SectionTitle>Clientes que recibieron este lote ({orders.length})</SectionTitle>
          <div className="space-y-2">
            {orders.map((order) => {
              const packings = (orderPackings || []).filter((p) => p.order_items?.order_id === order.id)
              const totalQty = packings.reduce((acc, p) => acc + Number(p.quantity_packed || 0), 0)
              return (
                <ChainNode
                  key={order.id}
                  icon="🚚"
                  title={order.order_number || order.id.slice(0, 8)}
                  subtitle={order.clients?.commercial_name}
                  pills={[<Pill key="s" color="green">{order.status}</Pill>]}
                >
                  <MiniTable rows={[
                    ['Cliente', order.clients?.commercial_name],
                    ['País', order.clients?.pais],
                    ['Fecha entrega', formatDate(order.delivery_date)],
                    ['Unidades despachadas', totalQty],
                    ['Total pedido', `${order.total} ${order.moneda || 'GTQ'}`],
                    ['Despachado', formatDateTime(packings[0]?.packed_at)],
                  ]} />
                </ChainNode>
              )
            })}
          </div>
        </>
      ) : finishedLot && (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 px-5 py-6 text-center text-sm text-stone-500">
          Este lote no ha sido despachado a ningún pedido todavía.
        </div>
      )}
    </div>
  )
}

// ─── Recall modal ─────────────────────────────────────────────────────────────

function RecallModal({ seed, onClose, onSaved }) {
  const [motivo, setMotivo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!motivo.trim()) { setErr('El motivo es obligatorio'); return }
    setSaving(true)
    setErr('')
    try {
      await iniciarRecall({ ...seed, motivo: motivo.trim(), descripcion: descripcion.trim() })
      onSaved()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold text-stone-800">Iniciar recall</h2>
        <p className="mb-4 text-sm text-stone-500">
          Lote: <span className="font-medium text-stone-700">{seed?.loteOrigenCodigo}</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Motivo *</span>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. Contaminación detectada en análisis"
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">Descripción adicional</span>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              placeholder="Detalles adicionales del evento..."
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-2xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60">
              {saving ? 'Guardando...' : 'Confirmar recall'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Tab: Buscar trazabilidad ─────────────────────────────────────────────────

function TabTrazabilidad() {
  const [mode, setMode] = useState('mp')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedLot, setSelectedLot] = useState(null)
  const [chain, setChain] = useState(null)
  const [tracing, setTracing] = useState(false)
  const [recallSeed, setRecallSeed] = useState(null)
  const [err, setErr] = useState('')

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setErr('')
    setResults([])
    setSelectedLot(null)
    setChain(null)
    try {
      const data = mode === 'mp' ? await buscarLoteMP(query.trim()) : await buscarLoteTerminado(query.trim())
      setResults(data)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSearching(false)
    }
  }

  async function handleSelect(lot) {
    setSelectedLot(lot)
    setChain(null)
    setErr('')
    setTracing(true)
    try {
      const data = mode === 'mp' ? await trazarDesdeMp(lot.id) : await trazarDesdeLoteTerminado(lot.id)
      setChain(data)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setTracing(false)
    }
  }

  function handleRecallDone() {
    setRecallSeed(null)
    if (selectedLot) handleSelect(selectedLot)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => { setMode('mp'); setResults([]); setChain(null); setSelectedLot(null) }}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${mode === 'mp' ? 'bg-stone-800 text-white' : 'border border-stone-300 text-stone-700 hover:bg-stone-50'}`}
          >
            🌿 Materia prima → Cliente
          </button>
          <button
            onClick={() => { setMode('terminado'); setResults([]); setChain(null); setSelectedLot(null) }}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${mode === 'terminado' ? 'bg-stone-800 text-white' : 'border border-stone-300 text-stone-700 hover:bg-stone-50'}`}
          >
            🏷️ Lote terminado (bidireccional)
          </button>
        </div>

        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'mp' ? 'Código de lote MP (ej. PP-037-20260405)...' : 'Código de lote terminado...'}
            className="flex-1 rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-2xl bg-stone-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60"
          >
            {searching ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

        {results.length > 0 && !selectedLot && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Selecciona un lote</p>
            {results.map((lot) => (
              <button
                key={lot.id}
                onClick={() => handleSelect(lot)}
                className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-stone-800">
                      {lot.internal_lot || lot.finished_lot_code}
                    </div>
                    <div className="text-xs text-stone-500">
                      {lot.materials?.common_name || lot.product_presentations?.product_bases?.common_name || ''}
                      {lot.supplier_lot ? ` · Proveedor: ${lot.supplier_lot}` : ''}
                      {lot.product_presentations?.display_name ? ` · ${lot.product_presentations.display_name}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {lot.en_recall && <RecallBadge />}
                    <Pill color="stone">{lot.status}</Pill>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {results.length === 0 && !searching && query && !chain && (
          <p className="mt-4 text-sm text-stone-500">Sin resultados para "{query}"</p>
        )}
      </div>

      {selectedLot && (
        <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-stone-800">Cadena de trazabilidad</h2>
              <p className="text-xs text-stone-500">
                {mode === 'mp'
                  ? `MP: ${selectedLot.internal_lot || selectedLot.supplier_lot}`
                  : `Lote terminado: ${selectedLot.finished_lot_code}`}
              </p>
            </div>
            <button
              onClick={() => { setSelectedLot(null); setChain(null); setResults([]) }}
              className="rounded-2xl border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Nueva búsqueda
            </button>
          </div>

          {tracing ? (
            <div className="py-10 text-center text-sm text-stone-500">Trazando cadena...</div>
          ) : chain ? (
            mode === 'mp'
              ? <ChainMP chain={chain} onRecall={setRecallSeed} />
              : <ChainLoteTerminado chain={chain} onRecall={setRecallSeed} />
          ) : null}
        </div>
      )}

      {recallSeed && (
        <RecallModal seed={recallSeed} onClose={() => setRecallSeed(null)} onSaved={handleRecallDone} />
      )}
    </div>
  )
}

// ─── Tab: Recalls ─────────────────────────────────────────────────────────────

const STATUS_COLOR = { activo: 'red', resuelto: 'yellow', cerrado: 'stone' }
const STATUS_LABEL = { activo: 'Activo', resuelto: 'Resuelto', cerrado: 'Cerrado' }

function TabRecalls() {
  const [recalls, setRecalls] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(null)
  const [printingId, setPrintingId] = useState(null)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    setErr('')
    try {
      setRecalls(await getRecalls())
      setLoaded(true)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setLoading(false)
    }
  }

  if (!loaded) {
    return (
      <div className="rounded-[28px] border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="mb-4 text-sm text-stone-500">Visualiza y gestiona los eventos de recall registrados.</p>
        <button onClick={load} disabled={loading} className="rounded-2xl bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:opacity-60">
          {loading ? 'Cargando...' : 'Cargar recalls'}
        </button>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </div>
    )
  }

  async function handleAction(id, action) {
    setSaving(id)
    setErr('')
    try {
      if (action === 'resolver') await resolverRecall(id)
      else if (action === 'cerrar') await cerrarRecall(id)
      await load()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(null)
    }
  }

  async function handlePdf(recall) {
    if (!recall.lote_origen_id) { setErr('Este recall no tiene lote de origen registrado para trazar.'); return }
    setPrintingId(recall.id)
    setErr('')
    try {
      const report = await fetchRecallReport(recall)
      printRecallPdf(report)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setPrintingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">{recalls.length} evento{recalls.length !== 1 ? 's' : ''} registrado{recalls.length !== 1 ? 's' : ''}</p>
        <button onClick={load} disabled={loading} className="rounded-2xl border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-60">
          {loading ? 'Actualizando...' : 'Recargar'}
        </button>
      </div>

      {err && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

      {recalls.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center text-sm text-stone-500">
          No hay recalls registrados.
        </div>
      ) : (
        <div className="space-y-3">
          {recalls.map((recall) => (
            <div key={recall.id} className="rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-stone-800">{recall.numero}</span>
                    <Pill color={STATUS_COLOR[recall.status] || 'stone'}>{STATUS_LABEL[recall.status] || recall.status}</Pill>
                    <Pill color="purple">{recall.tipo === 'materia_prima' ? 'MP' : 'Lote terminado'}</Pill>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">Lote origen: {recall.lote_origen_codigo || '—'}</p>
                  <p className="mt-1 text-sm text-stone-700">{recall.motivo}</p>
                  {recall.descripcion && <p className="mt-1 text-xs text-stone-500">{recall.descripcion}</p>}
                </div>
                <div className="text-right text-xs text-stone-400">
                  <div>{formatDateTime(recall.created_at)}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
                <button
                  onClick={() => handlePdf(recall)}
                  disabled={printingId === recall.id}
                  className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                >
                  {printingId === recall.id ? 'Generando...' : '🖨 Generar PDF'}
                </button>
                {recall.status !== 'cerrado' && (
                  <>
                    {recall.status === 'activo' && (
                      <button
                        onClick={() => handleAction(recall.id, 'resolver')}
                        disabled={saving === recall.id}
                        className="rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                      >
                        Marcar resuelto
                      </button>
                    )}
                    <button
                      onClick={() => handleAction(recall.id, 'cerrar')}
                      disabled={saving === recall.id}
                      className="rounded-xl bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-200 disabled:opacity-60"
                    >
                      Cerrar recall
                    </button>
                    {saving === recall.id && <span className="self-center text-xs text-stone-400">Guardando...</span>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TrazabilidadPage() {
  const [tab, setTab] = useState('trazar')

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Calidad</p>
          <h1 className="text-3xl font-semibold text-stone-800">Trazabilidad y Recall</h1>
          <p className="mt-2 text-sm text-stone-500">
            Rastrea el ciclo completo de un lote desde materia prima hasta el cliente, o a la inversa. Inicia y gestiona eventos de recall.
          </p>
        </div>
      </section>

      <div className="flex gap-2 border-b border-stone-200">
        {[
          { key: 'trazar', label: '🔍 Buscar trazabilidad' },
          { key: 'recalls', label: '⚠️ Recalls' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-xl px-4 py-2.5 text-sm font-semibold transition ${tab === t.key ? 'border-b-2 border-stone-800 text-stone-800' : 'text-stone-500 hover:text-stone-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'trazar' && <TabTrazabilidad />}
        {tab === 'recalls' && <TabRecalls />}
      </div>
    </div>
  )
}
