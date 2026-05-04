import { useCallback, useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { useNavigate } from 'react-router-dom'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import { getFelInvoices } from '../services/felService'
import { buildFelPdfBlob, downloadFelPdf, felPdfFileName } from '../services/felPdfService'

function n(value) {
  const num = Number(value)
  return Number.isNaN(num) ? 0 : num
}

function fmt(value) {
  return n(value).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function shortCode(value) {
  if (!value) return '-'
  const text = String(value)
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text
}

const STATUS_LABEL = {
  all: 'Todas',
  certified: 'Certificadas',
  pending: 'Pendientes',
  certifying: 'Certificando',
  rejected: 'Rechazadas',
  annulled: 'Anuladas',
  cancelled: 'Canceladas',
}

const STATUS_STYLE = {
  certified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  certifying: 'border-sky-200 bg-sky-50 text-sky-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
  annulled: 'border-stone-200 bg-stone-50 text-stone-600',
  cancelled: 'border-stone-200 bg-stone-50 text-stone-600',
}

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Alert({ children }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{children}</div>
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status] || 'border-stone-200 bg-stone-50 text-stone-600'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function openUrl(url) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function InvoiceDetail({ invoice, onClose, onOpenOrder, onDownloadPdf }) {
  if (!invoice) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Factura FEL</p>
            <h2 className="mt-1 text-xl font-bold text-stone-900">
              {invoice.serie || 'Serie'} {invoice.numero || invoice.dte_uuid || invoice.id}
            </h2>
            <p className="mt-1 text-sm text-stone-500">{invoice.receptor_nombre || 'Consumidor final'} · NIT {invoice.receptor_nit || 'CF'}</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-500 hover:bg-stone-100">
            Cerrar
          </button>
        </div>

        <div className="max-h-[calc(90vh-86px)] overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs text-stone-500">Estado</p>
              <div className="mt-2"><StatusBadge status={invoice.estado_fel} /></div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs text-stone-500">Emision</p>
              <p className="mt-2 font-semibold text-stone-900">{fmtDate(invoice.fecha_emision)}</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs text-stone-500">Certificacion</p>
              <p className="mt-2 font-semibold text-stone-900">{fmtDate(invoice.fecha_certificacion)}</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs text-stone-500">Total</p>
              <p className="mt-2 font-semibold text-stone-900">{invoice.moneda || 'GTQ'} {fmt(invoice.total)}</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Autorizacion</p>
                <p className="mt-1 break-all font-medium text-stone-800">{invoice.numero_autorizacion || invoice.dte_uuid || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Origen</p>
                <p className="mt-1 font-medium text-stone-800">
                  {invoice.order ? `Pedido #${invoice.order.order_number}` : invoice.source_type || '-'}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {invoice.order && (
                <button onClick={() => onOpenOrder(invoice.order.id)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                  Abrir pedido
                </button>
              )}
              <button onClick={() => onDownloadPdf(invoice)} className="rounded-lg bg-[#2f5d50] px-3 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">
                Descargar PDF
              </button>
              {invoice.xml_firmado_url && (
                <button onClick={() => openUrl(invoice.xml_firmado_url)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
                  Ver XML
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-widest text-stone-400">
                <tr>
                  <th className="px-4 py-3">Linea</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Cantidad</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3 text-right">IVA</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {invoice.fel_document_lines.map((line) => (
                  <tr key={line.id} className="text-stone-700">
                    <td className="px-4 py-3">{line.line_no}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-900">{line.descripcion}</div>
                      <div className="text-xs text-stone-400">{line.codigo_producto || line.unidad_medida}</div>
                    </td>
                    <td className="px-4 py-3 text-right">{fmt(line.cantidad)}</td>
                    <td className="px-4 py-3 text-right">Q {fmt(line.precio_unitario)}</td>
                    <td className="px-4 py-3 text-right">Q {fmt(line.iva)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-stone-900">Q {fmt(line.total_linea)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FacturasFelPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('certified')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getFelInvoices({ status, search, date: dateFilter })
      setRows(data)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las facturas FEL')
    } finally {
      setLoading(false)
    }
  }, [status, search, dateFilter])

  useEffect(() => {
    const timer = setTimeout(load, 200)
    return () => clearTimeout(timer)
  }, [load])

  useRealtimeRefresh(['fel_documents', 'fel_document_lines', 'orders'], load)

  const totals = useMemo(() => {
    return rows.reduce((acc, row) => {
      acc.total += row.total
      acc.iva += row.iva
      if (row.estado_fel === 'certified') acc.certified += 1
      return acc
    }, { total: 0, iva: 0, certified: 0 })
  }, [rows])

  const selectedRows = useMemo(() => {
    const selectedSet = new Set(selectedIds)
    return rows.filter((row) => selectedSet.has(row.id))
  }, [rows, selectedIds])

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => rows.some((row) => row.id === id)))
  }, [rows])

  function openOrder(orderId) {
    navigate(`/pedidos?order=${orderId}`)
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    ))
  }

  function toggleAllVisible() {
    if (rows.length > 0 && selectedIds.length === rows.length) {
      setSelectedIds([])
      return
    }
    setSelectedIds(rows.map((row) => row.id))
  }

  async function handleDownloadPdf(invoice) {
    setDownloading(true)
    setError('')
    try {
      await downloadFelPdf(invoice)
    } catch (err) {
      setError(err.message || 'No se pudo descargar el PDF')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadSelected() {
    if (!selectedRows.length) return
    setDownloading(true)
    setError('')
    try {
      const zip = new JSZip()
      for (const invoice of selectedRows) {
        const blob = await buildFelPdfBlob(invoice)
        zip.file(felPdfFileName(invoice), blob)
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(zipBlob, `facturas-fel-${date}.zip`)
    } catch (err) {
      setError(err.message || 'No se pudo preparar el ZIP de facturas')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Finanzas</p>
            <h1 className="mt-1 text-3xl font-bold text-stone-900">Facturas FEL</h1>
            <p className="mt-1 text-sm text-stone-500">Documentos certificados y rechazados por Megaprint.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownloadSelected}
              disabled={!selectedRows.length || downloading}
              className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? 'Preparando...' : `Descargar ZIP (${selectedRows.length})`}
            </button>
            <button onClick={load} className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Actualizar
            </button>
          </div>
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Facturas</p>
            <p className="mt-2 text-2xl font-bold text-stone-900">{rows.length}</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Total</p>
            <p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(totals.total)}</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">IVA</p>
            <p className="mt-2 text-2xl font-bold text-stone-900">Q {fmt(totals.iva)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por cliente, NIT, pedido o autorizacion"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-sm outline-none focus:border-[#2f5d50] focus:bg-white"
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm outline-none focus:border-[#2f5d50]"
            >
              {Object.entries(STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 outline-none focus:border-[#2f5d50]"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50"
              >
                Limpiar fecha
              </button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-sm text-stone-500">
              <Spinner /> Cargando facturas...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-stone-500">No hay facturas para este filtro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-widest text-stone-400">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selectedIds.length === rows.length}
                        onChange={toggleAllVisible}
                        className="h-4 w-4 rounded border-stone-300 text-[#2f5d50]"
                      />
                    </th>
                    <th className="px-4 py-3">Factura</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Pedido</th>
                    <th className="px-4 py-3">Autorizacion</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="text-stone-700 hover:bg-stone-50/70">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          className="h-4 w-4 rounded border-stone-300 text-[#2f5d50]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelected(row)} className="text-left font-semibold text-stone-900 hover:text-[#2f5d50]">
                          {row.serie || row.tipo_documento} {row.numero || shortCode(row.dte_uuid)}
                        </button>
                        <div className="text-xs text-stone-400">{row.tipo_documento}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-stone-900">{row.receptor_nombre || row.order?.clients?.commercial_name || '-'}</div>
                        <div className="text-xs text-stone-400">NIT {row.receptor_nit || row.order?.clients?.nit || 'CF'}</div>
                      </td>
                      <td className="px-4 py-3">
                        {row.order ? (
                          <button onClick={() => openOrder(row.order.id)} className="font-semibold text-[#2f5d50] hover:underline">
                            #{row.order.order_number}
                          </button>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-stone-500">{shortCode(row.numero_autorizacion || row.dte_uuid)}</td>
                      <td className="px-4 py-3">{fmtDate(row.fecha_certificacion || row.fecha_emision)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-stone-900">{row.moneda || 'GTQ'} {fmt(row.total)}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.estado_fel} /></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setSelected(row)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-white">
                            Ver
                          </button>
                          <button onClick={() => handleDownloadPdf(row)} disabled={downloading} className="rounded-lg bg-[#2f5d50] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
                            PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <InvoiceDetail invoice={selected} onClose={() => setSelected(null)} onOpenOrder={openOrder} onDownloadPdf={handleDownloadPdf} />
    </div>
  )
}
