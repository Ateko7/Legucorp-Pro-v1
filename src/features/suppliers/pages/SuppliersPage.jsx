import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import ProveedorDetalle from './ProveedorDetalle'
import ProgramasPage from './ProgramasPage'
import PreciosPage from './PreciosPage'
import { createSupplier, deleteSupplier, updateSupplier } from '../services/suppliersService'
import {
  createSupplierClaim,
  getSupplierControlDashboard,
  saveSupplierFiscalClassification,
  updateSupplierClaimStatus,
} from '../services/supplierControlService'

const INPUT = 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100'

const TAX_REGIME_OPTIONS = [
  { value: 'pequeno_contribuyente', label: 'Pequeño contribuyente' },
  { value: 'pagos_trimestrales', label: 'Pagos trimestrales' },
  { value: 'sujeto_a_retencion', label: 'Sujeto a retención' },
]

const emptyForm = {
  name: '',
  nit: '',
  contact_name: '',
  phone: '',
  email: '',
  payment_days: '',
  tax_regime: 'pagos_trimestrales',
  status: 'activo',
}

function fmt(value, digits = 2) {
  return Number(value || 0).toLocaleString('es-GT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function scorePill(score) {
  if (score >= 85) return 'bg-emerald-100 text-emerald-700'
  if (score >= 70) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? 'bg-[#2f5d50] text-white shadow-sm'
          : 'border border-stone-300 bg-white text-stone-600 hover:bg-stone-50'
      }`}
    >
      {children}
    </button>
  )
}

function FiscalOverviewTable({ suppliers = [], onEdit }) {
  return (
    <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Clasificación fiscal</div>
        <h2 className="mt-2 text-xl font-semibold text-stone-900">Riesgo tributario por proveedor</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              <th className="px-4 py-3">Proveedor</th>
              <th className="px-4 py-3">Tipo facturación</th>
              <th className="px-4 py-3">Régimen SAT</th>
              <th className="px-4 py-3 text-right">% facturado</th>
              <th className="px-4 py-3 text-right">Compras</th>
              <th className="px-4 py-3">Riesgo</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => {
              const billingType = supplier.fiscal_profile?.billing_type || 'con_factura'
              const satRegime = supplier.fiscal_profile?.sat_regime || 'general'
              const risk = Number(supplier.fiscalInvoicedPct || 0) < Number(supplier.fiscal_profile?.tax_alert_threshold_pct || 80)

              return (
                <tr key={supplier.id} className="border-b border-stone-100">
                  <td className="px-4 py-3 font-medium text-stone-800">{supplier.name}</td>
                  <td className="px-4 py-3 text-stone-600">{billingType.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 text-stone-600">{satRegime.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 text-right font-medium text-stone-900">{fmt(supplier.fiscalInvoicedPct)}%</td>
                  <td className="px-4 py-3 text-right text-stone-600">Q {fmt(supplier.totalFiscalPurchases)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${risk ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {risk ? 'Riesgo' : 'Controlado'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onEdit(supplier.id)} className="text-sm font-semibold text-[#2f5d50] hover:text-[#264c42]">
                      Ver detalle
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function SuppliersPage() {
  const [dashboard, setDashboard] = useState({ overview: {}, suppliers: [], programs: [], priceRows: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('scorecard')
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savingFiscal, setSavingFiscal] = useState(false)
  const [savingClaim, setSavingClaim] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  useRealtimeRefresh(
    [
      'suppliers',
      'purchase_orders',
      'purchase_order_items',
      'material_receptions',
      'programas_agricolas',
      'programa_entregas',
      'supplier_accounts_payable',
      'supplier_claims',
      'supplier_fiscal_classifications',
    ],
    loadDashboard,
  )

  async function loadDashboard() {
    setLoading(true)
    setError('')
    try {
      const data = await getSupplierControlDashboard()
      setDashboard(data)
      setSelectedSupplierId((prev) => prev || data.suppliers?.[0]?.id || '')
    } catch (err) {
      setError(err.message || 'No se pudo cargar el control de proveedores')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setForm(emptyForm)
    setEditingId(null)
    setShowModal(true)
  }

  function openEditModal(supplier) {
    setForm({
      name: supplier.name || '',
      nit: supplier.nit || '',
      contact_name: supplier.contact_name || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      payment_days: String(supplier.payment_days ?? ''),
      tax_regime: supplier.tax_regime || 'pagos_trimestrales',
      status: supplier.status || 'activo',
    })
    setEditingId(supplier.id)
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (editingId) {
        await updateSupplier(editingId, form)
        setSuccess('Proveedor actualizado correctamente.')
      } else {
        await createSupplier(form)
        setSuccess('Proveedor creado correctamente.')
      }
      setShowModal(false)
      await loadDashboard()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el proveedor')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSupplier(deleteTarget.id)
      setDeleteTarget(null)
      await loadDashboard()
    } catch (err) {
      setError(err.message || 'No se pudo desactivar el proveedor')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleSaveFiscal(supplierId, payload) {
    setSavingFiscal(true)
    setError('')
    setSuccess('')
    try {
      await saveSupplierFiscalClassification(supplierId, payload)
      setSuccess('Clasificación fiscal actualizada.')
      await loadDashboard()
    } catch (err) {
      setError(err.message || 'No se pudo guardar la clasificación fiscal')
    } finally {
      setSavingFiscal(false)
    }
  }

  async function handleCreateClaim(payload) {
    setSavingClaim(true)
    setError('')
    setSuccess('')
    try {
      await createSupplierClaim(payload)
      setSuccess('Reclamo de proveedor registrado.')
      await loadDashboard()
    } catch (err) {
      setError(err.message || 'No se pudo crear el reclamo')
      throw err
    } finally {
      setSavingClaim(false)
    }
  }

  async function handleUpdateClaimStatus(claimId, status, notes) {
    setError('')
    setSuccess('')
    try {
      await updateSupplierClaimStatus(claimId, status, notes)
      setSuccess('Estado del reclamo actualizado.')
      await loadDashboard()
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el reclamo')
    }
  }

  const filteredSuppliers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return dashboard.suppliers || []

    return (dashboard.suppliers || []).filter((supplier) =>
      [
        supplier.name,
        supplier.nit,
        supplier.contact_name,
        supplier.phone,
        supplier.email,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term)),
    )
  }, [dashboard.suppliers, search])

  const selectedSupplier = useMemo(
    () => filteredSuppliers.find((supplier) => supplier.id === selectedSupplierId)
      || dashboard.suppliers.find((supplier) => supplier.id === selectedSupplierId)
      || filteredSuppliers[0]
      || null,
    [dashboard.suppliers, filteredSuppliers, selectedSupplierId],
  )

  useEffect(() => {
    if (!selectedSupplierId && filteredSuppliers[0]?.id) {
      setSelectedSupplierId(filteredSuppliers[0].id)
    }
  }, [filteredSuppliers, selectedSupplierId])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Abastecimiento</p>
          <h1 className="text-3xl font-semibold text-stone-800">Control proveedores</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-500">
            Scorecard operativo, seguimiento de programas agrícolas, historial de precios y riesgo fiscal del proveedor en una sola vista.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button onClick={loadDashboard} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
            Recargar
          </button>
          <button onClick={openModal} className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]">
            + Nuevo proveedor
          </button>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Proveedores activos</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">{dashboard.overview.activeSuppliers || 0}</div>
          <div className="mt-1 text-sm text-stone-500">Red activa para compras, recepción y programas.</div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Score promedio</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">{fmt(dashboard.overview.averageScore)}</div>
          <div className="mt-1 text-sm text-stone-500">Mezcla de tiempo, calidad, precio y reclamos.</div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Alertas abiertas</div>
          <div className="mt-2 text-3xl font-semibold text-red-700">{dashboard.overview.openAlerts || 0}</div>
          <div className="mt-1 text-sm text-stone-500">Incidencias operativas o fiscales detectadas.</div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">% compras facturadas</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">{fmt(dashboard.overview.invoicedPct)}%</div>
          <div className="mt-1 text-sm text-stone-500">Respaldo tributario acumulado desde CxP.</div>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === 'scorecard'} onClick={() => setTab('scorecard')}>Scorecard</TabButton>
          <TabButton active={tab === 'programas'} onClick={() => setTab('programas')}>Programas agrícolas</TabButton>
          <TabButton active={tab === 'precios'} onClick={() => setTab('precios')}>Historial de precios</TabButton>
          <TabButton active={tab === 'fiscal'} onClick={() => setTab('fiscal')}>Clasificación fiscal</TabButton>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar proveedor por nombre, NIT o contacto..."
            className={`${INPUT} min-w-[260px]`}
          />
        </div>
      </section>

      {loading ? (
        <div className="rounded-[28px] border border-stone-200 bg-white px-6 py-16 text-center text-sm text-stone-500 shadow-sm">
          Cargando control de proveedores...
        </div>
      ) : tab === 'scorecard' ? (
        <section className="grid items-start gap-5 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-4">
            {filteredSuppliers.length ? (
              filteredSuppliers.map((supplier) => (
                <article
                  key={supplier.id}
                  className={`cursor-pointer rounded-[28px] border p-5 shadow-sm transition ${
                    selectedSupplier?.id === supplier.id
                      ? 'border-[#2f5d50] bg-[#f8f4ed]'
                      : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                  }`}
                  onClick={() => setSelectedSupplierId(supplier.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-stone-900">{supplier.name}</h3>
                      <div className="mt-1 text-sm text-stone-500">
                        {supplier.contact_name || 'Sin contacto'} · NIT {supplier.nit || '—'}
                      </div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${scorePill(supplier.globalScore)}`}>
                      Score {fmt(supplier.globalScore)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-stone-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Tiempo</div>
                      <div className="mt-2 text-lg font-semibold text-stone-900">{fmt(supplier.onTimePct)}%</div>
                    </div>
                    <div className="rounded-2xl bg-stone-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Calidad</div>
                      <div className="mt-2 text-lg font-semibold text-stone-900">{fmt(supplier.qualityPct)}%</div>
                    </div>
                    <div className="rounded-2xl bg-stone-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Precio</div>
                      <div className="mt-2 text-lg font-semibold text-stone-900">{fmt(supplier.priceVariationPct)}%</div>
                    </div>
                    <div className="rounded-2xl bg-stone-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Reclamos</div>
                      <div className="mt-2 text-lg font-semibold text-stone-900">{supplier.claimsTotal}</div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
                        Programas riesgo: {supplier.programsAtRisk}
                      </span>
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
                        Alertas: {supplier.generatedAlerts?.length || 0}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={(e) => { e.stopPropagation(); openEditModal(supplier) }} className="rounded-2xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50">
                        Editar
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(supplier) }} className="rounded-2xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50">
                        Desactivar
                      </button>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-[28px] border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-500 shadow-sm">
                No hay proveedores para el filtro actual.
              </div>
            )}
          </div>

          <ProveedorDetalle
            key={selectedSupplier?.id || 'empty-supplier'}
            supplier={selectedSupplier}
            savingFiscal={savingFiscal}
            savingClaim={savingClaim}
            onSaveFiscal={handleSaveFiscal}
            onCreateClaim={handleCreateClaim}
            onUpdateClaimStatus={handleUpdateClaimStatus}
          />
        </section>
      ) : tab === 'programas' ? (
        <ProgramasPage programs={dashboard.programs} selectedSupplierId={selectedSupplierId} suppliers={dashboard.suppliers} />
      ) : tab === 'precios' ? (
        <PreciosPage priceRows={dashboard.priceRows} selectedSupplierId={selectedSupplierId} />
      ) : (
        <FiscalOverviewTable suppliers={filteredSuppliers} onEdit={setSelectedSupplierId} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Editar proveedor' : 'Nuevo proveedor'} maxWidth="max-w-2xl">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Nombre *</span>
              <input type="text" name="name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} className={INPUT} required />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">NIT</span>
              <input type="text" name="nit" value={form.nit} onChange={(e) => setForm((prev) => ({ ...prev, nit: e.target.value }))} className={INPUT} />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Contacto</span>
              <input type="text" name="contact_name" value={form.contact_name} onChange={(e) => setForm((prev) => ({ ...prev, contact_name: e.target.value }))} className={INPUT} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Teléfono</span>
              <input type="text" name="phone" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} className={INPUT} />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Email</span>
              <input type="email" name="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} className={INPUT} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Días de pago</span>
              <input type="number" min="0" name="payment_days" value={form.payment_days} onChange={(e) => setForm((prev) => ({ ...prev, payment_days: e.target.value }))} className={INPUT} />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Régimen tributario</span>
              <select name="tax_regime" value={form.tax_regime} onChange={(e) => setForm((prev) => ({ ...prev, tax_regime: e.target.value }))} className={INPUT}>
                {TAX_REGIME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium text-stone-700">Estado</span>
              <select name="status" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className={INPUT}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42] disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear proveedor'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Desactivar proveedor" maxWidth="max-w-lg">
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            El proveedor <strong>{deleteTarget?.name}</strong> quedará inactivo, pero conservará su historial, scorecard y alertas.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteTarget(null)} className="rounded-2xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={deleting} className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60">
              {deleting ? 'Desactivando...' : 'Desactivar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
