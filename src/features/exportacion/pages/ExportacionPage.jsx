import { useState, useEffect, useCallback } from 'react'
import {
  getSombrillas, createSombrilla, updateSombrilla, deleteSombrilla
} from '../services/productosSombrillaService'
import {
  getFacturasExportacion, getFacturaById, generarFactura,
  emitirFactura, anularFactura, previewConsolidacion,
  recalcularFactura, printFacturaPDF,
} from '../services/exportacionService'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v, dec = 2) {
  return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function StatusBadge({ status }) {
  const map = {
    borrador: 'bg-yellow-100 text-yellow-800',
    emitida:  'bg-green-100 text-green-800',
    anulada:  'bg-red-100 text-red-800',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] || 'bg-stone-100 text-stone-600'}`}>
      {status}
    </span>
  )
}

// ─── Sombrilla form modal ─────────────────────────────────────────────────────

const emptySombrilla = {
  nombre: '', codigo: '', codigo_arancelario: '', unidad_facturacion: 'kg',
  descripcion_factura: '', activo: true,
}

function SombrillaModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial || emptySombrilla)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!form.nombre.trim()) { setErr('El nombre es requerido'); return }
    setSaving(true)
    try {
      const saved = initial?.id
        ? await updateSombrilla(initial.id, form)
        : await createSombrilla(form)
      onSaved(saved)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-stone-800">
            {initial?.id ? 'Editar producto sombrilla' : 'Nuevo producto sombrilla'}
          </h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl font-bold">×</button>
        </div>
        <div className="space-y-4 p-6">
          {err && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-stone-500 mb-1">Nombre *</label>
              <input className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                value={form.nombre} onChange={e => set('nombre', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1">Código interno</label>
              <input className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                value={form.codigo} onChange={e => set('codigo', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1">Código arancelario</label>
              <input className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                value={form.codigo_arancelario} onChange={e => set('codigo_arancelario', e.target.value)}
                placeholder="ej. 1601.00.11" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-500 mb-1">Unidad de facturación</label>
              <select className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                value={form.unidad_facturacion} onChange={e => set('unidad_facturacion', e.target.value)}>
                <option value="kg">kg</option>
                <option value="lb">lb</option>
                <option value="unidad">unidad</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="activo" checked={form.activo}
                onChange={e => set('activo', e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 accent-[#2f5d50]" />
              <label htmlFor="activo" className="text-sm text-stone-700">Activo</label>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-stone-500 mb-1">Descripción para factura</label>
              <textarea className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                rows={2} value={form.descripcion_factura}
                onChange={e => set('descripcion_factura', e.target.value)}
                placeholder="Texto que aparecerá en la factura de exportación" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-stone-200 px-6 py-4">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="rounded-xl bg-[#2f5d50] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Productos Sombrilla ─────────────────────────────────────────────────

function TabSombrillas() {
  const [sombrillas, setSombrillas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setSombrillas(await getSombrillas()) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSaved(s) {
    setSombrillas(prev => {
      const idx = prev.findIndex(x => x.id === s.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = s; return n }
      return [s, ...prev]
    })
    setModalOpen(false)
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar este producto sombrilla? Solo es posible si ningún SKU lo referencia.')) return
    try { await deleteSombrilla(id); setSombrillas(p => p.filter(s => s.id !== id)) }
    catch (e) { alert(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">Productos sombrilla</h2>
          <p className="text-sm text-stone-500">Agrupaciones arancelarias para facturación de exportación</p>
        </div>
        <button onClick={() => { setEditing(null); setModalOpen(true) }}
          className="rounded-xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">
          + Nuevo
        </button>
      </div>
      {err && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
      {loading ? <p className="text-sm text-stone-400">Cargando…</p> : sombrillas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-400">
          No hay productos sombrilla. Crea el primero.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>{['Nombre', 'Código', 'Arancel', 'Unidad', 'Estado', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sombrillas.map(s => (
                <tr key={s.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">{s.nombre}</td>
                  <td className="px-4 py-3 text-stone-500">{s.codigo || '—'}</td>
                  <td className="px-4 py-3 text-stone-500">{s.codigo_arancelario || '—'}</td>
                  <td className="px-4 py-3 text-stone-500">{s.unidad_facturacion}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.activo ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                      {s.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setEditing(s); setModalOpen(true) }} className="mr-3 text-xs text-[#2f5d50] hover:underline">Editar</button>
                    <button onClick={() => handleDelete(s.id)} className="text-xs text-red-500 hover:underline">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modalOpen && <SombrillaModal initial={editing} onClose={() => setModalOpen(false)} onSaved={handleSaved} />}
    </div>
  )
}

// ─── Factura detail modal ─────────────────────────────────────────────────────

function FacturaDetailModal({ facturaId, onClose, onUpdated }) {
  const [factura, setFactura] = useState(null)
  const [loading, setLoading] = useState(true)
  const [numeroInput, setNumeroInput] = useState('')
  const [tcInput, setTcInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getFacturaById(facturaId)
      .then(f => {
        setFactura(f)
        setNumeroInput(f.numero || '')
        setTcInput(f.tipo_cambio ? String(f.tipo_cambio) : '')
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [facturaId])

  async function handleEmitir() {
    if (!numeroInput.trim()) { setErr('Ingrese el número de factura'); return }
    setSaving(true)
    try {
      const updated = await emitirFactura(facturaId, numeroInput.trim())
      onUpdated(updated)
      setFactura(f => ({ ...f, ...updated }))
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function handleAnular() {
    if (!window.confirm('¿Anular esta factura? Esta acción no se puede deshacer.')) return
    setSaving(true)
    try {
      const updated = await anularFactura(facturaId)
      onUpdated(updated)
      onClose()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  async function handleRecalcular() {
    const tc = Number(tcInput)
    if (!tc || tc <= 0) { setErr('Ingrese un tipo de cambio válido mayor a 0'); return }
    setRecalculating(true)
    setErr('')
    try {
      const updated = await recalcularFactura(facturaId, tc)
      setFactura(updated)
      onUpdated({ id: updated.id, total_usd: updated.total_usd, tipo_cambio: updated.tipo_cambio, status: updated.status })
    } catch (e) { setErr(e.message) }
    finally { setRecalculating(false) }
  }

  const lineas = factura?.facturas_exportacion_lineas?.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)) || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-800">
                Factura de exportación
                {factura?.numero && <span className="ml-2 text-stone-500">#{factura.numero}</span>}
              </h2>
              {factura && <StatusBadge status={factura.status} />}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {factura && (
              <button
                onClick={() => printFacturaPDF(factura)}
                className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
              >
                🖨 PDF
              </button>
            )}
            <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl font-bold ml-2">×</button>
          </div>
        </div>

        {loading && <p className="p-6 text-sm text-stone-400">Cargando…</p>}
        {err && <p className="mx-6 mt-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}

        {factura && (
          <div className="p-6 space-y-6">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-stone-500">Cliente</p>
                <p className="font-medium text-stone-800">{factura.clients?.commercial_name || factura.clients?.legal_name || '—'}</p>
                {factura.clients?.pais && <p className="text-stone-500">{factura.clients.pais}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-stone-500">Pedido origen</p>
                <p className="font-medium text-stone-800">{factura.orders?.order_number || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-stone-500">Fecha</p>
                <p className="text-stone-700">{factura.fecha}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-stone-500">Tipo de cambio actual</p>
                <p className="text-stone-700">{factura.tipo_cambio ? `Q${fmt(factura.tipo_cambio, 4)} / USD` : '—'}</p>
              </div>
            </div>

            {/* Tipo de cambio editor */}
            {factura.status !== 'anulada' && (
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-xs font-semibold text-stone-600 mb-2">Actualizar tipo de cambio y recalcular</p>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1 flex-1">
                    <span className="text-sm text-stone-500 font-medium">Q</span>
                    <input
                      type="number"
                      step="0.0001"
                      placeholder="ej. 7.7500"
                      value={tcInput}
                      onChange={e => setTcInput(e.target.value)}
                      className="flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                    />
                    <span className="text-sm text-stone-500">/ USD</span>
                  </div>
                  <button
                    onClick={handleRecalcular}
                    disabled={recalculating}
                    className="rounded-xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50"
                  >
                    {recalculating ? 'Recalculando…' : 'Recalcular'}
                  </button>
                </div>
                <p className="text-xs text-stone-400 mt-1">Recalcular reemplaza todas las líneas con el nuevo tipo de cambio.</p>
              </div>
            )}

            {/* Lines table */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-stone-700">Líneas consolidadas</h3>
              {lineas.length === 0 ? (
                <p className="text-sm text-stone-400 rounded-xl border border-dashed border-stone-300 py-6 text-center">
                  Sin líneas — ingrese el tipo de cambio y presione Recalcular.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-stone-200">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50">
                      <tr>
                        {['Descripción', 'Arancel', 'Total kg', 'USD/kg', 'Total USD'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-stone-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {lineas.map(l => (
                        <tr key={l.id}>
                          <td className="px-3 py-2 font-medium text-stone-800">{l.descripcion_factura}</td>
                          <td className="px-3 py-2 text-stone-500">{l.productos_sombrilla?.codigo_arancelario || '—'}</td>
                          <td className="px-3 py-2 text-stone-700">{fmt(l.total_kg, 4)}</td>
                          <td className="px-3 py-2 text-stone-700">{fmt(l.precio_usd_kg, 6)}</td>
                          <td className="px-3 py-2 font-semibold text-stone-800">${fmt(l.total_usd)}</td>
                        </tr>
                      ))}
                      <tr className="bg-stone-50 font-semibold">
                        <td colSpan={2} className="px-3 py-2 text-stone-700">TOTAL</td>
                        <td className="px-3 py-2 text-stone-800">{fmt(factura.total_kg, 4)} kg</td>
                        <td />
                        <td className="px-3 py-2 text-stone-900">${fmt(factura.total_usd)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* SKU breakdown */}
            {lineas.some(l => l.facturas_exportacion_desglose?.length > 0) && (
              <details className="rounded-xl border border-stone-200 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-stone-500 hover:text-stone-700">
                  Ver desglose por SKU (trazabilidad)
                </summary>
                <div className="mt-3 overflow-hidden rounded-lg border border-stone-100">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50">
                      <tr>{['Sombrilla', 'SKU', 'Cantidad', 'Peso kg', 'Valor USD'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-stone-500">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {lineas.flatMap(l =>
                        (l.facturas_exportacion_desglose || []).map(d => (
                          <tr key={d.id}>
                            <td className="px-3 py-1.5 text-stone-500">{l.productos_sombrilla?.nombre || '—'}</td>
                            <td className="px-3 py-1.5 font-medium text-stone-700">
                              {d.product_presentations?.display_name || d.product_presentations?.code || '—'}
                            </td>
                            <td className="px-3 py-1.5 text-stone-600">{fmt(d.cantidad, 2)} {d.unidad}</td>
                            <td className="px-3 py-1.5 text-stone-600">{fmt(d.peso_kg, 4)}</td>
                            <td className="px-3 py-1.5 text-stone-600">${fmt(d.valor_usd)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {/* Emitir */}
            {factura.status === 'borrador' && (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-yellow-800">Emitir factura</p>
                <div className="flex gap-3">
                  <input
                    className="flex-1 rounded-xl border border-yellow-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                    placeholder="Número de factura (ej. FE-001)"
                    value={numeroInput} onChange={e => setNumeroInput(e.target.value)}
                  />
                  <button onClick={handleEmitir} disabled={saving}
                    className="rounded-xl bg-[#2f5d50] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
                    {saving ? '…' : 'Emitir'}
                  </button>
                </div>
              </div>
            )}

            {['borrador', 'emitida'].includes(factura.status) && (
              <div className="text-right">
                <button onClick={handleAnular} disabled={saving} className="text-xs text-red-500 hover:underline">
                  Anular factura
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Preview modal ────────────────────────────────────────────────────────────

function PreviewModal({ orderId, onClose, onGenerated }) {
  const [tcInput, setTcInput] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [err, setErr] = useState('')

  async function handlePreview() {
    const tc = Number(tcInput)
    if (!tc || tc <= 0) { setErr('Ingrese el tipo de cambio (ej. 7.75)'); return }
    setLoading(true)
    setErr('')
    try {
      const p = await previewConsolidacion(orderId, tc)
      setPreview(p)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function handleGenerar() {
    setGenerating(true)
    try {
      const factura = await generarFactura(orderId, { tipoCambio: Number(tcInput) })
      onGenerated(factura)
    } catch (e) { setErr(e.message) }
    finally { setGenerating(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-stone-800">Vista previa — factura de exportación</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl font-bold">×</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Tipo de cambio input — always visible */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-semibold text-blue-700 mb-2">Tipo de cambio GTQ → USD</p>
            <div className="flex gap-2">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-sm text-stone-600 font-medium">Q</span>
                <input
                  type="number"
                  step="0.0001"
                  placeholder="ej. 7.7500"
                  value={tcInput}
                  onChange={e => { setTcInput(e.target.value); setPreview(null) }}
                  className="flex-1 rounded-xl border border-blue-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f5d50]"
                  autoFocus
                />
                <span className="text-sm text-stone-600">/ 1 USD</span>
              </div>
              <button
                onClick={handlePreview}
                disabled={loading}
                className="rounded-xl border border-blue-400 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {loading ? 'Calculando…' : 'Calcular'}
              </button>
            </div>
          </div>

          {err && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}

          {preview && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl bg-stone-50 p-3 text-center">
                  <p className="text-xs text-stone-500">Pedido</p>
                  <p className="font-semibold text-stone-800">{preview.order.order_number}</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3 text-center">
                  <p className="text-xs text-stone-500">Total kg</p>
                  <p className="font-semibold text-stone-800">{fmt(preview.total_kg, 4)}</p>
                </div>
                <div className="rounded-xl bg-[#2f5d50]/10 p-3 text-center">
                  <p className="text-xs text-[#2f5d50]">Total USD</p>
                  <p className="font-semibold text-[#2f5d50]">${fmt(preview.total_usd)}</p>
                </div>
              </div>

              {preview.advertencias.map((w, i) => (
                <p key={i} className="rounded-xl bg-yellow-50 px-4 py-2 text-sm text-yellow-700">{w}</p>
              ))}

              <div className="overflow-hidden rounded-xl border border-stone-200">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50">
                    <tr>{['Producto sombrilla', 'Arancel', 'Total kg', 'USD/kg', 'Total USD'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-stone-500">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {preview.lineas.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium text-stone-800">{l.sombrilla?.nombre || '—'}</td>
                        <td className="px-3 py-2 text-stone-500">{l.sombrilla?.codigo_arancelario || '—'}</td>
                        <td className="px-3 py-2 text-stone-700">{fmt(l.total_kg, 4)}</td>
                        <td className="px-3 py-2 text-stone-700">{fmt(l.precio_usd_kg, 6)}</td>
                        <td className="px-3 py-2 font-semibold text-stone-800">${fmt(l.total_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100">
                  Cancelar
                </button>
                <button
                  onClick={handleGenerar}
                  disabled={generating || preview.lineas.length === 0}
                  className="rounded-xl bg-[#2f5d50] px-6 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50"
                >
                  {generating ? 'Generando…' : 'Generar factura (borrador)'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Facturas ────────────────────────────────────────────────────────────

function TabFacturas() {
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [filtroStatus, setFiltroStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filtros = {}
      if (filtroStatus) filtros.status = filtroStatus
      setFacturas(await getFacturasExportacion(filtros))
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [filtroStatus])

  useEffect(() => { load() }, [load])

  function handleUpdated(updated) {
    setFacturas(prev => {
      const idx = prev.findIndex(f => f.id === updated.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...updated }; return n }
      return prev
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">Facturas de exportación</h2>
          <p className="text-sm text-stone-500">Documentos consolidados por producto sombrilla</p>
        </div>
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-[#2f5d50]">
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="emitida">Emitida</option>
          <option value="anulada">Anulada</option>
        </select>
      </div>

      {err && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}

      {loading ? <p className="text-sm text-stone-400">Cargando…</p> : facturas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-400">
          No hay facturas de exportación.<br />
          Genera una desde el detalle de un pedido de exportación (estado Despachado).
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>{['Número', 'Fecha', 'Pedido', 'Cliente', 'Total kg', 'Total USD', 'T/C', 'Estado', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-stone-500">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {facturas.map(f => (
                <tr key={f.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-medium text-stone-800">
                    {f.numero || <span className="text-stone-400 italic">borrador</span>}
                  </td>
                  <td className="px-4 py-3 text-stone-500">{f.fecha}</td>
                  <td className="px-4 py-3 text-stone-500">{f.orders?.order_number || '—'}</td>
                  <td className="px-4 py-3 text-stone-700">{f.clients?.commercial_name || f.clients?.legal_name || '—'}</td>
                  <td className="px-4 py-3 text-stone-600">{fmt(f.total_kg, 4)}</td>
                  <td className="px-4 py-3 font-semibold text-stone-800">${fmt(f.total_usd)}</td>
                  <td className="px-4 py-3 text-stone-500">{f.tipo_cambio ? `Q${fmt(f.tipo_cambio, 4)}` : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={f.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setDetailId(f.id)} className="text-xs text-[#2f5d50] hover:underline">Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailId && (
        <FacturaDetailModal
          facturaId={detailId}
          onClose={() => setDetailId(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'sombrillas', label: 'Productos sombrilla' },
  { key: 'facturas',   label: 'Facturas exportación' },
]

export default function ExportacionPage() {
  const [tab, setTab] = useState('sombrillas')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">Exportación</h1>
        <p className="text-sm text-stone-500">Facturación consolidada para mercados de exportación</p>
      </div>

      <div className="flex gap-1 rounded-2xl border border-stone-200 bg-stone-100 p-1 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sombrillas' && <TabSombrillas />}
      {tab === 'facturas'   && <TabFacturas />}
    </div>
  )
}
