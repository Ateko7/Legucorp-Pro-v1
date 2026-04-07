import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import { createSupplier, deleteSupplier, getSuppliers, updateSupplier } from '../services/suppliersService'

const TAX_REGIME_OPTIONS = [
  {
    value: 'pequeno_contribuyente',
    label: 'Pequeño contribuyente',
    hint: 'Factura con 5% IVA.',
  },
  {
    value: 'pagos_trimestrales',
    label: 'Pagos trimestrales',
    hint: 'Factura con 12% IVA.',
  },
  {
    value: 'sujeto_a_retencion',
    label: 'Sujeto a retención',
    hint: 'Factura con 12% IVA y retención ISR de 5% o 7% si supera Q30,000.',
  },
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

function taxRegimeLabel(value) {
  return TAX_REGIME_OPTIONS.find((option) => option.value === value)?.label || 'Sin régimen'
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadSuppliers()
  }, [])
  useRealtimeRefresh(['suppliers'], loadSuppliers)

  async function loadSuppliers() {
    setLoading(true)
    setError('')
    try {
      const data = await getSuppliers()
      setSuppliers(data)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los proveedores')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setSuccess('')
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
    setError('')
    setSuccess('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setSaving(false)
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSupplier(deleteTarget.id)
      setDeleteTarget(null)
      await loadSuppliers()
    } catch (err) {
      setError(err.message || 'No se pudo eliminar el proveedor')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
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
      await loadSuppliers()
      setTimeout(closeModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el proveedor')
    } finally {
      setSaving(false)
    }
  }

  const filteredSuppliers = useMemo(() => {
    const term = search.trim().toLowerCase()

    if (!term) return suppliers

    return suppliers.filter((supplier) =>
      [
        supplier.name,
        supplier.nit,
        supplier.contact_name,
        supplier.phone,
        supplier.email,
        taxRegimeLabel(supplier.tax_regime),
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term))
    )
  }, [suppliers, search])

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Abastecimiento
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Proveedores</h1>
          <p className="mt-2 text-sm text-stone-500">
            Administra tu red de proveedores, régimen tributario y condiciones de pago.
          </p>
        </div>

        <button
          onClick={openModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nuevo proveedor
        </button>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por nombre, NIT, contacto, teléfono, correo o régimen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 md:max-w-md"
          />

          <button
            onClick={loadSuppliers}
            className="rounded-2xl border border-stone-300 bg-[#faf7f2] px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
          >
            Recargar
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">
            Cargando proveedores...
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay proveedores registrados todavía.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSuppliers.map((supplier) => (
              <div
                key={supplier.id}
                className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-base font-semibold text-stone-800">
                      {supplier.name}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      NIT: {supplier.nit || '—'}
                    </div>
                  </div>

                  <div className="text-sm text-stone-500">
                    {supplier.contact_name || 'Sin contacto'}
                  </div>

                  <div className="text-sm text-stone-500">
                    {supplier.payment_days || 0} días
                  </div>

                  <div className="text-sm text-stone-500">
                    {taxRegimeLabel(supplier.tax_regime)}
                  </div>

                  <div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        supplier.status === 'activo'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {supplier.status}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(supplier)}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setDeleteTarget(supplier)}
                      className="rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      Desactivar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </section>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Desactivar proveedor?</h3>
            <p className="mt-2 text-sm text-stone-600">
              <strong>{deleteTarget.name}</strong> pasará a estado inactivo.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Desactivando...' : 'Desactivar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Editar proveedor' : 'Nuevo proveedor'}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre *">
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="NIT">
              <input
                name="nit"
                value={form.nit}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Contacto principal">
              <input
                name="contact_name"
                value={form.contact_name}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Teléfono">
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Correo">
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Días de pago">
              <input
                name="payment_days"
                type="number"
                value={form.payment_days}
                onChange={handleChange}
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Régimen tributario *">
              <select
                name="tax_regime"
                value={form.tax_regime}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              >
                {TAX_REGIME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-stone-500">
                {TAX_REGIME_OPTIONS.find((option) => option.value === form.tax_regime)?.hint}
              </p>
            </Field>
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
            El régimen tributario define cómo se calculará IVA y retención cuando la factura del proveedor genere el asiento contable en CxP.
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-stone-200 pt-5 md:flex-row md:justify-end">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-2xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : editingId ? 'Actualizar proveedor' : 'Guardar proveedor'}
            </button>
          </div>
        </form>
      </Modal>
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
