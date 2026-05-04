import { useMemo, useState } from 'react'

const INPUT = 'w-full rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#2f5d50] focus:ring-4 focus:ring-emerald-100'

function fmt(value, digits = 2) {
  return Number(value || 0).toLocaleString('es-GT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function severityClass(severity) {
  if (severity === 'danger') return 'bg-red-100 text-red-700'
  if (severity === 'warning') return 'bg-amber-100 text-amber-700'
  return 'bg-stone-100 text-stone-700'
}

function scoreClass(semaphore) {
  if (semaphore === 'green') return 'bg-emerald-100 text-emerald-700'
  if (semaphore === 'yellow') return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

function MiniKpi({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">{label}</div>
      <div className="mt-2 text-xl font-semibold text-stone-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-stone-500">{sub}</div> : null}
    </div>
  )
}

function ClaimModal({ supplier, open, saving, onClose, onSave }) {
  const [form, setForm] = useState({
    claim_date: new Date().toISOString().slice(0, 10),
    claim_type: 'calidad',
    title: '',
    description: '',
    amount: '',
  })
  const [error, setError] = useState('')

  if (!open) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSave({
        ...form,
        supplier_id: supplier.id,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el reclamo')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-[28px] bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Proveedor</div>
            <h3 className="mt-2 text-xl font-semibold text-stone-900">Nuevo reclamo para {supplier.name}</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700">×</button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Fecha</span>
              <input type="date" value={form.claim_date} onChange={(e) => setForm((prev) => ({ ...prev, claim_date: e.target.value }))} className={INPUT} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Tipo</span>
              <select value={form.claim_type} onChange={(e) => setForm((prev) => ({ ...prev, claim_type: e.target.value }))} className={INPUT}>
                <option value="calidad">Calidad</option>
                <option value="entrega">Entrega</option>
                <option value="precio">Precio</option>
                <option value="documentacion">Documentación</option>
                <option value="otro">Otro</option>
              </select>
            </label>
          </div>

          <label className="space-y-2 text-sm">
            <span className="font-medium text-stone-700">Título</span>
            <input type="text" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} className={INPUT} placeholder="Ej. Lote con aceptación menor al esperado" />
          </label>

          <label className="space-y-2 text-sm">
            <span className="font-medium text-stone-700">Descripción</span>
            <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} className={`${INPUT} min-h-28 resize-none`} placeholder="Describe el hallazgo, impacto y seguimiento." />
          </label>

          <label className="space-y-2 text-sm">
            <span className="font-medium text-stone-700">Monto estimado (Q)</span>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} className={INPUT} />
          </label>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? 'Guardando...' : 'Guardar reclamo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ProveedorDetalle({
  supplier,
  savingFiscal,
  savingClaim,
  onSaveFiscal,
  onCreateClaim,
  onUpdateClaimStatus,
}) {
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [fiscalForm, setFiscalForm] = useState({
    billing_type: supplier?.fiscal_profile?.billing_type || 'con_factura',
    sat_regime: supplier?.fiscal_profile?.sat_regime || 'general',
    tax_alert_threshold_pct: supplier?.fiscal_profile?.tax_alert_threshold_pct || 80,
    notes: supplier?.fiscal_profile?.notes || '',
  })

  const recentPrices = useMemo(
    () => (supplier?.priceHistory || []).slice(0, 6),
    [supplier],
  )

  if (!supplier) {
    return (
      <div className="rounded-[28px] border border-dashed border-stone-300 bg-white/70 p-8 text-sm text-stone-500">
        Selecciona un proveedor para ver su scorecard, alertas y control fiscal.
      </div>
    )
  }

  return (
    <>
      <div className="space-y-5">
        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Perfil</div>
              <h2 className="mt-2 text-2xl font-semibold text-stone-900">{supplier.name}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-stone-500">
                <span>NIT: {supplier.nit || '—'}</span>
                <span>Contacto: {supplier.contact_name || '—'}</span>
                <span>Pago: {supplier.payment_days || 0} días</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreClass(supplier.semaphore)}`}>
                {supplier.semaphore === 'green' ? 'Verde' : supplier.semaphore === 'yellow' ? 'Amarillo' : 'Rojo'}
              </span>
              <div className="rounded-2xl bg-stone-900 px-4 py-3 text-center text-white">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Score global</div>
                <div className="mt-1 text-2xl font-semibold">{fmt(supplier.globalScore)}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MiniKpi label="Entregas a tiempo" value={`${fmt(supplier.onTimePct)}%`} sub={`${supplier.deliveriesOnTime} de ${supplier.deliveriesTotal}`} />
            <MiniKpi label="Calidad" value={`${fmt(supplier.qualityPct)}%`} sub={`Aceptado ${fmt(supplier.qualityAcceptedQty, 4)} / ${fmt(supplier.qualityReceivedQty, 4)}`} />
            <MiniKpi label="Variación precio" value={`${fmt(supplier.priceVariationPct)}%`} sub={`Promedio Q ${fmt(supplier.averageUnitPrice, 4)}`} />
            <MiniKpi label="Fiscal facturado" value={`${fmt(supplier.fiscalInvoicedPct)}%`} sub={`Compras Q ${fmt(supplier.totalFiscalPurchases)}`} />
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Alertas</div>
                  <h3 className="mt-2 text-lg font-semibold text-stone-900">Radar del proveedor</h3>
                </div>
              </div>

              <div className="space-y-3">
                {(supplier.generatedAlerts || []).length ? (
                  supplier.generatedAlerts.map((alert, index) => (
                    <div key={`${alert.alert_type}-${index}`} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-stone-800">{alert.title}</div>
                          <div className="mt-1 text-sm text-stone-500">{alert.message}</div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${severityClass(alert.severity)}`}>
                          {alert.severity}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-500">
                    Sin alertas abiertas para este proveedor.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Reclamos</div>
                  <h3 className="mt-2 text-lg font-semibold text-stone-900">Seguimiento de incidentes</h3>
                </div>
                <button onClick={() => setShowClaimModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#264c42]">
                  + Reclamo
                </button>
              </div>

              <div className="space-y-3">
                {(supplier.claims || []).length ? (
                  supplier.claims.slice(0, 8).map((claim) => (
                    <div key={claim.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-stone-800">{claim.title}</div>
                          <div className="mt-1 text-sm text-stone-500">
                            {claim.claim_date} · {claim.claim_type} · Q {fmt(claim.amount)}
                          </div>
                          {claim.description ? <div className="mt-2 text-sm text-stone-600">{claim.description}</div> : null}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${claim.status === 'cerrado' ? 'bg-emerald-100 text-emerald-700' : claim.status === 'investigacion' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                            {claim.status}
                          </span>
                          {claim.status !== 'cerrado' ? (
                            <button onClick={() => onUpdateClaimStatus(claim.id, 'cerrado', 'Cerrado desde control proveedores')} className="text-xs font-semibold text-[#2f5d50] hover:text-[#264c42]">
                              Cerrar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-500">
                    No hay reclamos registrados para este proveedor.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Clasificación fiscal</div>
              <h3 className="mt-2 text-lg font-semibold text-stone-900">Control SAT y facturación</h3>

              <div className="mt-4 space-y-4">
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-stone-700">Tipo de facturación</span>
                  <select value={fiscalForm.billing_type} onChange={(e) => setFiscalForm((prev) => ({ ...prev, billing_type: e.target.value }))} className={INPUT}>
                    <option value="con_factura">Con factura</option>
                    <option value="sin_factura">Sin factura</option>
                  </select>
                </label>

                <label className="space-y-2 text-sm">
                  <span className="font-medium text-stone-700">Régimen SAT</span>
                  <select value={fiscalForm.sat_regime} onChange={(e) => setFiscalForm((prev) => ({ ...prev, sat_regime: e.target.value }))} className={INPUT}>
                    <option value="general">General</option>
                    <option value="pequeno_contribuyente">Pequeño contribuyente</option>
                  </select>
                </label>

                <label className="space-y-2 text-sm">
                  <span className="font-medium text-stone-700">Umbral mínimo facturado (%)</span>
                  <input type="number" min="0" max="100" step="0.01" value={fiscalForm.tax_alert_threshold_pct} onChange={(e) => setFiscalForm((prev) => ({ ...prev, tax_alert_threshold_pct: e.target.value }))} className={INPUT} />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="font-medium text-stone-700">Notas</span>
                  <textarea value={fiscalForm.notes} onChange={(e) => setFiscalForm((prev) => ({ ...prev, notes: e.target.value }))} className={`${INPUT} min-h-24 resize-none`} />
                </label>

                <button onClick={() => onSaveFiscal(supplier.id, fiscalForm)} disabled={savingFiscal} className="w-full rounded-2xl bg-[#2f5d50] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:cursor-not-allowed disabled:opacity-60">
                  {savingFiscal ? 'Guardando...' : 'Guardar clasificación fiscal'}
                </button>
              </div>
            </div>

            <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Precios recientes</div>
              <h3 className="mt-2 text-lg font-semibold text-stone-900">Últimos movimientos</h3>
              <div className="mt-4 space-y-3">
                {recentPrices.length ? (
                  recentPrices.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-stone-800">{row.materials?.common_name || 'Materia prima'}</div>
                          <div className="mt-1 text-xs text-stone-500">{row.effective_date} · Volumen {fmt(row.volume, 4)} {row.unit}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-stone-900">Q {fmt(row.unit_price, 4)}</div>
                          <div className={`mt-1 text-xs font-medium ${n(row.price_variation_pct) > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                            {n(row.price_variation_pct) >= 0 ? '+' : ''}{fmt(row.price_variation_pct)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-500">
                    Todavía no hay historial de precios consolidado.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <ClaimModal
        supplier={supplier}
        open={showClaimModal}
        saving={savingClaim}
        onClose={() => setShowClaimModal(false)}
        onSave={onCreateClaim}
      />
    </>
  )
}
