import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  getQuotes, getQuoteById, createQuote, updateQuote,
  updateQuoteStatus, deleteQuote, acceptQuote,
  getClientsForQuote, getProductsForQuote, generateQuotePDF, getQuoteStats,
} from '../services/cotizacionesService'
import {
  computePricing, calcSubtotal, calcTotal, isBelowMinimum,
  VOLUME_CLASS_LABEL, VOLUME_CLASS_COLOR,
} from '../services/pricingEngine'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

const today = new Date().toISOString().slice(0, 10)
const plus30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}
function Alert({ type = 'error', children }) {
  const s = {
    error:   'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info:    'border-sky-200 bg-sky-50 text-sky-700',
  }
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${s[type]}`}>{children}</div>
}

const STATUS_LABEL = {
  borrador:   'Borrador',
  emitida:    'Emitida',
  aceptada:   'Aceptada',
  rechazada:  'Rechazada',
  vencida:    'Vencida',
  convertida: 'Convertida',
}
const STATUS_COLOR = {
  borrador:   'bg-stone-100 text-stone-600',
  emitida:    'bg-sky-100 text-sky-700',
  aceptada:   'bg-emerald-100 text-emerald-700',
  rechazada:  'bg-red-100 text-red-700',
  vencida:    'bg-orange-100 text-orange-700',
  convertida: 'bg-purple-100 text-purple-700',
}
const GROWTH_LABEL = { baja: 'Baja', media: 'Media', alta: 'Alta' }
const FREQ_LABEL   = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual', trimestral: 'Trimestral', eventual: 'Eventual' }

const emptyProspect = {
  commercial_name: '', legal_name: '', contact_name: '', email: '', phone: '',
  nit: '', commercial_address: '', delivery_address: '', channel: 'directo',
  country: 'Guatemala', preferred_currency: 'GTQ', payment_terms: '',
  logistics_notes: '', commercial_notes: '', credit_days: 0,
}
const emptyHeader = {
  clientType: 'existing',
  client_id: '', prospect_id: '',
  quote_date: today, valid_until: plus30,
  currency: 'GTQ', growth_opportunity: 'media', estimated_frequency: 'mensual',
  commercial_notes: '',
}
const emptyItem = () => ({
  _key: Math.random(),
  product_presentation_id: '',
  estimated_volume: '',
  unit: 'unidad',
  // pricing data (loaded from DB)
  ref_price: 0, min_price: 0, volume_low_threshold: 50, volume_high_threshold: 200,
  // computed
  volume_class: '', rule_applied: '', adjustment_pct: 0, suggested_price: 0,
  auto_note: null, belowMinimum: false,
  // editable
  final_price: '', subtotal: 0,
})

// ─── Recompute pricing for one item ──────────────────────────────────────────

function recompute(item, growthOpportunity) {
  if (!item.product_presentation_id || !item.ref_price) return item
  const result = computePricing({
    refPrice:         item.ref_price,
    minPrice:         item.min_price,
    volume:           item.estimated_volume,
    lowThreshold:     item.volume_low_threshold,
    highThreshold:    item.volume_high_threshold,
    growthOpportunity,
  })
  const finalPrice = item.final_price !== '' ? item.final_price : result.suggestedPrice
  return {
    ...item,
    volume_class:   result.volumeClass,
    rule_applied:   result.ruleApplied,
    adjustment_pct: result.adjustmentPct,
    suggested_price: result.suggestedPrice,
    auto_note:      result.autoNote,
    belowMinimum:   isBelowMinimum(finalPrice, item.min_price),
    subtotal:       calcSubtotal(finalPrice, item.estimated_volume),
  }
}

// ─── AcceptModal ─────────────────────────────────────────────────────────────

function AcceptModal({ quote, onClose, onDone }) {
  const [opts, setOpts] = useState({ saveAgreedPrices: true, convertToOrder: true })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function handle() {
    setLoading(true); setError('')
    try {
      const result = await acceptQuote(quote.id, opts)
      onDone(result)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl p-6 space-y-5">
        <h3 className="text-lg font-bold text-stone-800">Aceptar cotización</h3>
        <div className="rounded-2xl bg-stone-50 p-4 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-stone-500">Cotización</span>
            <span className="font-medium">{quote.quote_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Cliente / Prospecto</span>
            <span className="font-medium">
              {quote.clients?.commercial_name || quote.prospects?.commercial_name}
            </span>
          </div>
          {quote.prospect_id && !quote.client_id && (
            <div className="mt-2 rounded-xl bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-700">
              El prospecto se convertirá automáticamente en cliente formal.
            </div>
          )}
        </div>

        {error && <Alert type="error">{error}</Alert>}

        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={opts.saveAgreedPrices}
              onChange={e => setOpts(p => ({ ...p, saveAgreedPrices: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded accent-[#2f5d50]" />
            <div>
              <p className="text-sm font-semibold text-stone-800">Guardar precios acordados</p>
              <p className="text-xs text-stone-400">Los precios finales quedan registrados como referencia comercial del cliente.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={opts.convertToOrder}
              onChange={e => setOpts(p => ({ ...p, convertToOrder: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded accent-[#2f5d50]" />
            <div>
              <p className="text-sm font-semibold text-stone-800">Crear pedido automáticamente</p>
              <p className="text-xs text-stone-400">Se genera un pedido confirmado con los productos y precios de la cotización.</p>
            </div>
          </label>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-stone-300 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            Cancelar
          </button>
          <button onClick={handle} disabled={loading}
            className="flex-1 rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
            {loading ? 'Procesando…' : 'Confirmar aceptación'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ListView ─────────────────────────────────────────────────────────────────

function ListView({ onNew, onEdit, onView, onRefresh }) {
  const [quotes,  setQuotes]  = useState([])
  const [stats,   setStats]   = useState({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState('')
  const [accepting, setAccepting] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [q, s] = await Promise.all([getQuotes({ status: filter || undefined, search }), getQuoteStats()])
      setQuotes(q); setStats(s)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [filter, search])

  useEffect(() => { load() }, [load])

  async function handleStatusChange(id, status) {
    try { await updateQuoteStatus(id, status); load() }
    catch (e) { setError(e.message) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar esta cotización?')) return
    try { await deleteQuote(id); load() }
    catch (e) { setError(e.message) }
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-3 md:grid-cols-5">
        {[
          { label: 'Total', value: stats.total || 0, color: 'text-stone-900' },
          { label: 'Emitidas', value: stats.emitidas || 0, color: 'text-sky-700' },
          { label: 'Aceptadas', value: stats.aceptadas || 0, color: 'text-emerald-700' },
          { label: 'Rechazadas', value: stats.rechazadas || 0, color: 'text-red-600' },
          { label: 'Alta oportunidad', value: stats.altaOportunidad || 0, color: 'text-purple-700' },
        ].map(k => (
          <div key={k.label} className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{k.label}</p>
            <p className={`mt-1 text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por número o cliente…"
          className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50] w-64" />
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2f5d50]">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50">
          Actualizar
        </button>
        <button onClick={onNew} className="ml-auto rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
          + Nueva cotización
        </button>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : quotes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white py-14 text-center">
          <p className="text-stone-400">No hay cotizaciones{filter ? ` con estado "${STATUS_LABEL[filter]}"` : ''}.</p>
          <button onClick={onNew} className="mt-3 rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
            + Nueva cotización
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map(q => {
            const name = q.clients?.commercial_name || q.prospects?.commercial_name || '—'
            const isProspect = !q.client_id
            return (
              <div key={q.id} className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold text-stone-900">{q.quote_number}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOR[q.status]}`}>
                        {STATUS_LABEL[q.status]}
                      </span>
                      {isProspect && (
                        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">Prospecto</span>
                      )}
                      {q.growth_opportunity === 'alta' && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Alta oportunidad</span>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-stone-400 flex-wrap">
                      <span className="font-medium text-stone-600">{name}</span>
                      <span>Fecha: {q.quote_date}</span>
                      <span>Vence: {q.valid_until}</span>
                      <span>{FREQ_LABEL[q.estimated_frequency] || q.estimated_frequency}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => onView(q.id)} className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                      Ver detalle
                    </button>
                    {['borrador','emitida'].includes(q.status) && (
                      <button onClick={() => onEdit(q.id)} className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50">
                        Editar
                      </button>
                    )}
                    {q.status === 'borrador' && (
                      <button onClick={() => handleStatusChange(q.id, 'emitida')}
                        className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">
                        Emitir
                      </button>
                    )}
                    {q.status === 'emitida' && (
                      <button onClick={() => setAccepting(q)}
                        className="rounded-xl bg-[#2f5d50] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#264c42]">
                        Aceptar
                      </button>
                    )}
                    {['borrador','emitida'].includes(q.status) && (
                      <button onClick={() => handleDelete(q.id)}
                        className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {accepting && (
        <AcceptModal
          quote={accepting}
          onClose={() => setAccepting(null)}
          onDone={() => { setAccepting(null); load() }}
        />
      )}
    </div>
  )
}

// ─── QuoteForm ────────────────────────────────────────────────────────────────

function QuoteForm({ editId, onSaved, onCancel }) {
  const [clients,  setClients]  = useState([])
  const [products, setProducts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const [header,   setHeader]   = useState(emptyHeader)
  const [prospect, setProspect] = useState(emptyProspect)
  const [items,    setItems]    = useState([emptyItem()])

  // productMap for quick lookup
  const productMap = useMemo(() => {
    const m = {}
    products.forEach(p => { m[p.id] = p })
    return m
  }, [products])

  // Derived: auto_note exists if any item has auto_note
  const autoNote = useMemo(() => {
    const note = items.find(i => i.auto_note)?.auto_note
    return note || null
  }, [items])

  // Load clients, products, and (if editing) existing quote
  useEffect(() => {
    async function init() {
      setLoading(true)
      try {
        const [c, p] = await Promise.all([getClientsForQuote(), getProductsForQuote()])
        setClients(c); setProducts(p)

        if (editId) {
          const q = await getQuoteById(editId)
          setHeader({
            clientType:          q.client_id ? 'existing' : 'prospect',
            client_id:           q.client_id || '',
            prospect_id:         q.prospect_id || '',
            quote_date:          q.quote_date,
            valid_until:         q.valid_until,
            currency:            q.currency,
            growth_opportunity:  q.growth_opportunity,
            estimated_frequency: q.estimated_frequency,
            commercial_notes:    q.commercial_notes || '',
          })
          if (q.prospects) setProspect(q.prospects)

          const loadedItems = (q.quote_items || []).map(i => ({
            _key:                    Math.random(),
            product_presentation_id: i.product_presentation_id,
            estimated_volume:        i.estimated_volume,
            unit:                    i.unit,
            ref_price:               i.ref_price,
            min_price:               i.min_price,
            volume_low_threshold:    p.find(x => x.id === i.product_presentation_id)?.volume_low_threshold || 50,
            volume_high_threshold:   p.find(x => x.id === i.product_presentation_id)?.volume_high_threshold || 200,
            volume_class:            i.volume_class,
            rule_applied:            i.rule_applied,
            adjustment_pct:          i.adjustment_pct,
            suggested_price:         i.suggested_price,
            auto_note:               null,
            belowMinimum:            isBelowMinimum(i.final_price, i.min_price),
            final_price:             i.final_price,
            subtotal:                i.subtotal,
          }))
          setItems(loadedItems.length ? loadedItems : [emptyItem()])
        }
      } catch (e) { setError(e.message) }
      finally { setLoading(false) }
    }
    init()
  }, [editId])

  // Recompute all items when growth_opportunity changes
  function setGrowthOpportunity(val) {
    setHeader(h => {
      const newH = { ...h, growth_opportunity: val }
      setItems(its => its.map(i => recompute(i, val)))
      return newH
    })
  }

  function updateItem(idx, patch) {
    setItems(prev => {
      const next = [...prev]
      let item = { ...next[idx], ...patch }

      // If product changed, load pricing data
      if (patch.product_presentation_id !== undefined) {
        const prod = productMap[patch.product_presentation_id]
        if (prod) {
          item.ref_price            = n(prod.suggested_price)
          item.min_price            = n(prod.min_profitable_price)
          item.volume_low_threshold = n(prod.volume_low_threshold) || 50
          item.volume_high_threshold= n(prod.volume_high_threshold) || 200
          item.unit                 = prod.unit || 'unidad'
          item.final_price          = ''   // reset so engine sets it
        }
      }

      // Recompute pricing
      item = recompute(item, header.growth_opportunity)

      // If final_price was manually set, use it (overrides engine suggestion)
      if (patch.final_price !== undefined && patch.final_price !== '') {
        item.final_price  = patch.final_price
        item.belowMinimum = isBelowMinimum(patch.final_price, item.min_price)
        item.subtotal     = calcSubtotal(patch.final_price, item.estimated_volume)
      } else if (item.final_price === '' && item.suggested_price > 0) {
        item.final_price = item.suggested_price
      }

      next[idx] = item
      return next
    })
  }

  function addItem() {
    setItems(p => [...p, emptyItem()])
  }

  function removeItem(idx) {
    setItems(p => p.filter((_, i) => i !== idx))
  }

  async function handleSave(asDraft) {
    setSaving(true); setError('')
    try {
      const validItems = items.filter(i => i.product_presentation_id && n(i.final_price) > 0)
      if (!validItems.length) throw new Error('Agrega al menos un producto con precio')

      const clientId = header.clientType === 'existing' ? header.client_id : null
      if (header.clientType === 'existing' && !clientId) throw new Error('Selecciona un cliente')
      if (header.clientType === 'prospect' && !prospect.commercial_name.trim())
        throw new Error('El nombre comercial del prospecto es requerido')

      const headerPayload = {
        client_id:           clientId || null,
        prospect_id:         header.clientType === 'prospect' ? (header.prospect_id || null) : null,
        quote_date:          header.quote_date,
        valid_until:         header.valid_until,
        currency:            header.currency,
        growth_opportunity:  header.growth_opportunity,
        estimated_frequency: header.estimated_frequency,
        commercial_notes:    header.commercial_notes,
        auto_note:           autoNote,
      }
      const itemsPayload = validItems.map(i => ({
        product_presentation_id: i.product_presentation_id,
        estimated_volume:        n(i.estimated_volume),
        unit:                    i.unit,
        ref_price:               n(i.ref_price),
        min_price:               n(i.min_price),
        volume_class:            i.volume_class,
        rule_applied:            i.rule_applied,
        adjustment_pct:          n(i.adjustment_pct),
        suggested_price:         n(i.suggested_price),
        final_price:             n(i.final_price),
      }))

      if (editId) {
        await updateQuote(editId, { header: headerPayload, items: itemsPayload })
        if (!asDraft) await updateQuoteStatus(editId, 'emitida')
      } else {
        const q = await createQuote({
          header: headerPayload,
          items: itemsPayload,
          prospectPayload: header.clientType === 'prospect' ? prospect : null,
        })
        if (!asDraft) await updateQuoteStatus(q.id, 'emitida')
      }
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const grandTotal = calcTotal(items.map(i => ({ subtotal: calcSubtotal(n(i.final_price), n(i.estimated_volume)) })))

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onCancel} className="rounded-xl border border-stone-200 p-2 text-stone-500 hover:bg-stone-50">←</button>
        <div>
          <h2 className="text-2xl font-bold text-stone-900">{editId ? 'Editar cotización' : 'Nueva cotización'}</h2>
          <p className="text-sm text-stone-500">Los campos de pricing son internos y no aparecen en el documento del cliente.</p>
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {autoNote && <Alert type="info">📌 Nota automática: {autoNote}</Alert>}

      {/* Sección 1: Cliente o prospecto */}
      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-stone-400">1. Cliente o prospecto</h3>

        <div className="flex gap-3">
          {['existing','prospect'].map(t => (
            <button key={t} onClick={() => setHeader(h => ({ ...h, clientType: t }))}
              className={`rounded-2xl border px-5 py-2.5 text-sm font-semibold transition ${
                header.clientType === t ? 'border-[#2f5d50] bg-emerald-50 text-[#2f5d50]' : 'border-stone-300 text-stone-600 hover:bg-stone-50'
              }`}>
              {t === 'existing' ? 'Cliente existente' : 'Nuevo prospecto'}
            </button>
          ))}
        </div>

        {header.clientType === 'existing' ? (
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Cliente *</span>
            <select value={header.client_id} onChange={e => setHeader(h => ({ ...h, client_id: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
              <option value="">Seleccionar cliente…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.commercial_name}{c.nit ? ` · NIT ${c.nit}` : ''}</option>)}
            </select>
          </label>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { key: 'commercial_name', label: 'Nombre comercial *', placeholder: 'Distribuidora XYZ', req: true },
              { key: 'legal_name',      label: 'Razón social',       placeholder: 'XYZ S.A.' },
              { key: 'contact_name',    label: 'Nombre de contacto', placeholder: 'Juan Pérez' },
              { key: 'email',           label: 'Correo',             placeholder: 'contacto@empresa.com' },
              { key: 'phone',           label: 'Teléfono',           placeholder: '+502 0000-0000' },
              { key: 'nit',             label: 'NIT / Identificador',placeholder: '1234567-8' },
              { key: 'commercial_address', label: 'Dirección comercial', placeholder: 'Ciudad, Guatemala' },
              { key: 'delivery_address',   label: 'Dirección de entrega', placeholder: 'Zona de entrega' },
            ].map(({ key, label, placeholder, req }) => (
              <label key={key} className="block">
                <span className="block mb-1 text-sm font-medium text-stone-700">{label}</span>
                <input value={prospect[key] || ''} required={req}
                  onChange={e => setProspect(p => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
              </label>
            ))}
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Canal</span>
              <select value={prospect.channel} onChange={e => setProspect(p => ({ ...p, channel: e.target.value }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
                {['directo','distribuidor','mayorista','retail','online','referido'].map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block mb-1 text-sm font-medium text-stone-700">Días de crédito</span>
              <input type="number" min="0" value={prospect.credit_days}
                onChange={e => setProspect(p => ({ ...p, credit_days: Number(e.target.value) }))}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
            </label>
            <label className="block md:col-span-2">
              <span className="block mb-1 text-sm font-medium text-stone-700">Notas comerciales / logísticas</span>
              <textarea rows={2} value={prospect.commercial_notes || ''}
                onChange={e => setProspect(p => ({ ...p, commercial_notes: e.target.value }))}
                placeholder="Condiciones especiales, notas de entrega…"
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50] resize-none" />
            </label>
          </div>
        )}
      </div>

      {/* Sección 2: Parámetros comerciales */}
      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-stone-400">2. Parámetros comerciales</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Fecha cotización</span>
            <input type="date" value={header.quote_date}
              onChange={e => setHeader(h => ({ ...h, quote_date: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Vigencia hasta</span>
            <input type="date" value={header.valid_until}
              onChange={e => setHeader(h => ({ ...h, valid_until: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Moneda</span>
            <select value={header.currency} onChange={e => setHeader(h => ({ ...h, currency: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
              {['GTQ','USD','EUR'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Oportunidad de crecimiento</span>
            <select value={header.growth_opportunity} onChange={e => setGrowthOpportunity(e.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
              {Object.entries(GROWTH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <p className="mt-1 text-xs text-stone-400">Afecta directamente el precio sugerido</p>
          </label>
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Frecuencia de compra estimada</span>
            <select value={header.estimated_frequency} onChange={e => setHeader(h => ({ ...h, estimated_frequency: e.target.value }))}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]">
              {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block mb-1 text-sm font-medium text-stone-700">Observaciones comerciales</span>
            <input value={header.commercial_notes}
              onChange={e => setHeader(h => ({ ...h, commercial_notes: e.target.value }))}
              placeholder="Condiciones especiales, descuentos adicionales…"
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm outline-none focus:border-[#2f5d50]" />
          </label>
        </div>
      </div>

      {/* Sección 3: Líneas de producto */}
      <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-stone-400">3. Productos y precios</h3>
        <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-700 font-medium">
          Los campos de pricing interno (precio medio, mínimo, regla) son visibles solo aquí. No aparecen en el documento del cliente.
        </div>

        <div className="space-y-4">
          {items.map((item, idx) => (
            <div key={item._key} className="rounded-2xl border border-stone-200 bg-stone-50 p-4 space-y-4">
              {/* Row 1: Product + volume + unit */}
              <div className="grid gap-3 md:grid-cols-4 items-end">
                <label className="md:col-span-2 block">
                  <span className="block mb-1 text-xs font-medium text-stone-600">Producto / Presentación *</span>
                  <select value={item.product_presentation_id}
                    onChange={e => updateItem(idx, { product_presentation_id: e.target.value })}
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]">
                    <option value="">Seleccionar…</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.display_name} · {p.code}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block mb-1 text-xs font-medium text-stone-600">Volumen estimado</span>
                  <input type="number" min="1" value={item.estimated_volume}
                    onChange={e => updateItem(idx, { estimated_volume: e.target.value })}
                    placeholder="100"
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
                </label>
                <label className="block">
                  <span className="block mb-1 text-xs font-medium text-stone-600">Unidad</span>
                  <input value={item.unit}
                    onChange={e => updateItem(idx, { unit: e.target.value })}
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]" />
                </label>
              </div>

              {/* Row 2: Pricing panel (INTERNAL) */}
              {item.product_presentation_id && item.ref_price > 0 && (
                <div className="rounded-xl bg-white border border-stone-200 p-3 grid gap-2 md:grid-cols-5 text-xs">
                  <div>
                    <p className="text-stone-400 font-semibold uppercase tracking-wide">Precio medio ref.</p>
                    <p className="font-bold text-stone-700 mt-0.5">Q {fmt(item.ref_price)}</p>
                  </div>
                  <div>
                    <p className="text-stone-400 font-semibold uppercase tracking-wide">Precio mín. rentable</p>
                    <p className="font-bold text-stone-700 mt-0.5">Q {fmt(item.min_price)}</p>
                  </div>
                  <div>
                    <p className="text-stone-400 font-semibold uppercase tracking-wide">Volumen</p>
                    {item.volume_class ? (
                      <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 font-semibold ${VOLUME_CLASS_COLOR[item.volume_class]}`}>
                        {VOLUME_CLASS_LABEL[item.volume_class]}
                      </span>
                    ) : <span className="text-stone-400">—</span>}
                  </div>
                  <div>
                    <p className="text-stone-400 font-semibold uppercase tracking-wide">Precio sugerido</p>
                    <p className="font-bold text-emerald-700 mt-0.5">Q {fmt(item.suggested_price)}</p>
                    {item.adjustment_pct !== 0 && (
                      <p className={item.adjustment_pct < 0 ? 'text-emerald-600' : 'text-amber-600'}>
                        {item.adjustment_pct > 0 ? '+' : ''}{item.adjustment_pct}%
                      </p>
                    )}
                  </div>
                  <div className="md:col-span-1">
                    <p className="text-stone-400 font-semibold uppercase tracking-wide">Regla aplicada</p>
                    <p className="text-stone-600 mt-0.5">{item.rule_applied || '—'}</p>
                  </div>
                </div>
              )}

              {/* Row 3: Final price + subtotal + remove */}
              <div className="grid gap-3 md:grid-cols-4 items-end">
                <label className="block md:col-span-2">
                  <span className="block mb-1 text-xs font-medium text-stone-600">
                    Precio final (editable)
                    {item.suggested_price > 0 && (
                      <button type="button" onClick={() => updateItem(idx, { final_price: item.suggested_price })}
                        className="ml-2 text-[#2f5d50] underline">
                        Usar sugerido
                      </button>
                    )}
                  </span>
                  <input type="number" min="0" step="0.01" value={item.final_price}
                    onChange={e => updateItem(idx, { final_price: e.target.value })}
                    placeholder="0.00"
                    className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none bg-white ${
                      item.belowMinimum ? 'border-red-400 focus:border-red-500' : 'border-stone-300 focus:border-[#2f5d50]'
                    }`} />
                  {item.belowMinimum && (
                    <p className="mt-1 text-xs text-red-600 font-medium">
                      ⚠ Por debajo del precio mínimo rentable (Q {fmt(item.min_price)})
                    </p>
                  )}
                </label>
                <div>
                  <p className="text-xs font-medium text-stone-600 mb-1">Subtotal</p>
                  <p className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-bold text-stone-900">
                    Q {fmt(calcSubtotal(n(item.final_price), n(item.estimated_volume)))}
                  </p>
                </div>
                <div className="flex justify-end">
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(idx)}
                      className="rounded-xl border border-red-200 px-3 py-2.5 text-xs font-medium text-red-600 hover:bg-red-50">
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={addItem}
          className="w-full rounded-2xl border-2 border-dashed border-stone-300 py-3 text-sm font-medium text-stone-500 hover:border-[#2f5d50] hover:text-[#2f5d50] transition">
          + Agregar producto
        </button>

        {/* Total */}
        <div className="flex justify-end">
          <div className="rounded-2xl bg-[#2f5d50] px-6 py-3 text-white">
            <span className="text-sm font-semibold opacity-80">Total cotización</span>
            <span className="ml-4 text-xl font-bold">Q {fmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onCancel}
          className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
          Cancelar
        </button>
        <button type="button" onClick={() => handleSave(true)} disabled={saving}
          className="rounded-2xl border border-[#2f5d50] bg-white px-5 py-3 text-sm font-semibold text-[#2f5d50] hover:bg-emerald-50 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar borrador'}
        </button>
        <button type="button" onClick={() => handleSave(false)} disabled={saving}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar y emitir'}
        </button>
      </div>
    </div>
  )
}

// ─── DetailView ───────────────────────────────────────────────────────────────

function DetailView({ quoteId, onBack, onEdit }) {
  const [quote,     setQuote]     = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [accepting, setAccepting] = useState(false)
  const [success,   setSuccess]   = useState('')

  useEffect(() => {
    getQuoteById(quoteId)
      .then(setQuote)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [quoteId])

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>
  if (error)   return <Alert type="error">{error}</Alert>
  if (!quote)  return null

  const items  = quote.quote_items || []
  const total  = items.reduce((a, i) => a + n(i.subtotal), 0)
  const clientName = quote.clients?.commercial_name || quote.prospects?.commercial_name || '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={onBack} className="rounded-xl border border-stone-200 p-2 text-stone-500 hover:bg-stone-50">←</button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-stone-900">{quote.quote_number}</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLOR[quote.status]}`}>
              {STATUS_LABEL[quote.status]}
            </span>
          </div>
          <p className="text-sm text-stone-500">{clientName} · {quote.quote_date} → {quote.valid_until}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {['borrador','emitida'].includes(quote.status) && (
            <button onClick={() => onEdit(quote.id)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              Editar
            </button>
          )}
          <button onClick={() => generateQuotePDF(quote)} className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
            📄 Ver PDF cliente
          </button>
          {quote.status === 'emitida' && (
            <button onClick={() => setAccepting(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">
              Aceptar cotización
            </button>
          )}
        </div>
      </div>

      {success && <Alert type="success">{success}</Alert>}

      {/* Header info */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Oportunidad</p>
          <p className="mt-1 text-lg font-bold text-stone-900">{GROWTH_LABEL[quote.growth_opportunity]}</p>
          <p className="text-xs text-stone-400">{FREQ_LABEL[quote.estimated_frequency]}</p>
        </div>
        <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Moneda</p>
          <p className="mt-1 text-lg font-bold text-stone-900">{quote.currency}</p>
          <p className="text-xs text-stone-400">Vigente hasta {quote.valid_until}</p>
        </div>
        <div className="rounded-3xl border border-[#2f5d50] bg-[#2f5d50] p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Total cotización</p>
          <p className="mt-1 text-2xl font-bold text-white">Q {fmt(total)}</p>
          <p className="text-xs text-emerald-200">{items.length} línea{items.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Items: VISTA INTERNA con pricing */}
      <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-stone-100 bg-amber-50 px-6 py-3">
          <p className="text-xs font-semibold text-amber-700">Vista interna — incluye lógica de pricing. No compartir con el cliente.</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              {['Producto','Volumen','Precio ref.','Precio mín.','Volumen cls.','Regla','Sugerido','Precio final','Subtotal'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {items.map(i => (
              <tr key={i.id} className="hover:bg-stone-50">
                <td className="px-4 py-3 font-medium text-stone-800">{i.product_presentations?.display_name}</td>
                <td className="px-4 py-3 text-stone-600">{i.estimated_volume} {i.unit}</td>
                <td className="px-4 py-3 text-stone-500">Q {fmt(i.ref_price)}</td>
                <td className="px-4 py-3 text-stone-500">Q {fmt(i.min_price)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${VOLUME_CLASS_COLOR[i.volume_class] || ''}`}>
                    {VOLUME_CLASS_LABEL[i.volume_class] || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-stone-500 max-w-[160px]">{i.rule_applied || '—'}</td>
                <td className="px-4 py-3 text-emerald-700 font-semibold">Q {fmt(i.suggested_price)}</td>
                <td className={`px-4 py-3 font-bold ${isBelowMinimum(i.final_price, i.min_price) ? 'text-red-600' : 'text-stone-900'}`}>
                  Q {fmt(i.final_price)}
                  {isBelowMinimum(i.final_price, i.min_price) && <span className="ml-1 text-xs">⚠</span>}
                </td>
                <td className="px-4 py-3 font-semibold text-stone-900">Q {fmt(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-200 bg-stone-50 font-bold">
              <td colSpan={8} className="px-4 py-3 text-xs text-stone-400 uppercase">Total</td>
              <td className="px-4 py-3 text-[#2f5d50] text-base">Q {fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Notes */}
      {(quote.auto_note || quote.commercial_notes) && (
        <div className="space-y-3">
          {quote.auto_note && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
              <span className="font-semibold">Nota automática para el cliente:</span> {quote.auto_note}
            </div>
          )}
          {quote.commercial_notes && (
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
              <span className="font-semibold text-stone-700">Observaciones:</span> {quote.commercial_notes}
            </div>
          )}
        </div>
      )}

      {accepting && (
        <AcceptModal
          quote={quote}
          onClose={() => setAccepting(false)}
          onDone={({ orderId }) => {
            setAccepting(false)
            setSuccess(`Cotización aceptada.${orderId ? ` Pedido creado exitosamente.` : ''} El cliente ha sido registrado.`)
            getQuoteById(quoteId).then(setQuote)
          }}
        />
      )}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function CotizacionesPage() {
  const [view,    setView]    = useState('list')   // 'list' | 'form' | 'detail'
  const [editId,  setEditId]  = useState(null)
  const [viewId,  setViewId]  = useState(null)

  function handleNew()      { setEditId(null); setView('form') }
  function handleEdit(id)   { setEditId(id);   setView('form') }
  function handleView(id)   { setViewId(id);   setView('detail') }
  function handleSaved()    { setView('list') }
  function handleBack()     { setView('list') }

  return (
    <div className="min-h-screen bg-[#faf9f7] px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {view === 'list' && (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Comercial</p>
              <h1 className="mt-1 text-3xl font-bold text-stone-900">Cotizaciones</h1>
              <p className="mt-1 text-sm text-stone-500">Motor de pricing inteligente · Conversión automática a pedido</p>
            </div>
            <ListView
              onNew={handleNew}
              onEdit={handleEdit}
              onView={handleView}
              onRefresh={() => {}}
            />
          </>
        )}

        {view === 'form' && (
          <QuoteForm
            editId={editId}
            onSaved={handleSaved}
            onCancel={handleBack}
          />
        )}

        {view === 'detail' && (
          <DetailView
            quoteId={viewId}
            onBack={handleBack}
            onEdit={handleEdit}
          />
        )}

      </div>
    </div>
  )
}
