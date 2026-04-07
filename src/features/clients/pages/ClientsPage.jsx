import { useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import Modal from '../../../components/ui/Modal'
import { createClient, deleteClient, getClients, getSalespeopleForClients, updateClient } from '../services/clientsService'

const emptyForm = {
  commercial_name: '',
  legal_name: '',
  nit: '',
  main_address: '',
  credit_days: '',
  main_contact: '',
  phone: '',
  email: '',
  channel: '',
  delivery_conditions: '',
  salesperson_id: '',
  status: 'activo',
  es_exportacion: false,
  pais: '',
  moneda_default: 'GTQ',
  facturar_por_sombrilla: false,
  addresses: [
    {
      address_label: 'Principal',
      address_line: '',
      is_default: true,
    },
  ],
}

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [salespeople, setSalespeople] = useState([])
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
    loadClients()
  }, [])
  useRealtimeRefresh(['clients'], loadClients)

  async function loadClients() {
    setLoading(true)
    setError('')
    try {
      const [clientsData, spData] = await Promise.all([getClients(), getSalespeopleForClients()])
      setClients(clientsData)
      setSalespeople(spData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los clientes')
    } finally {
      setLoading(false)
    }
  }

  function openModal() {
    setForm(emptyForm)
    setEditingId(null)
    setSuccess('')
    setError('')
    setShowModal(true)
  }

  function openEditModal(client) {
    setForm({
      commercial_name: client.commercial_name || '',
      legal_name: client.legal_name || '',
      nit: client.nit || '',
      main_address: client.main_address || '',
      credit_days: String(client.credit_days ?? ''),
      main_contact: client.main_contact || '',
      phone: client.phone || '',
      email: client.email || '',
      channel: client.channel || '',
      delivery_conditions: client.delivery_conditions || '',
      salesperson_id: client.salesperson_id || '',
      status: client.status || 'activo',
      es_exportacion: !!client.es_exportacion,
      pais: client.pais || '',
      moneda_default: client.moneda_default || 'GTQ',
      facturar_por_sombrilla: !!client.facturar_por_sombrilla,
      addresses: client.client_addresses?.length
        ? client.client_addresses.map((a) => ({
            address_label: a.address_label || '',
            address_line: a.address_line || '',
            is_default: a.is_default,
          }))
        : [{ address_label: 'Principal', address_line: '', is_default: true }],
    })
    setEditingId(client.id)
    setSuccess('')
    setError('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setSaving(false)
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  function handleAddressChange(index, field, value) {
    setForm((prev) => {
      const next = [...prev.addresses]
      next[index] = {
        ...next[index],
        [field]: value,
      }
      return {
        ...prev,
        addresses: next,
      }
    })
  }

  function addAddress() {
    setForm((prev) => ({
      ...prev,
      addresses: [
        ...prev.addresses,
        {
          address_label: '',
          address_line: '',
          is_default: false,
        },
      ],
    }))
  }

  function removeAddress(index) {
    setForm((prev) => {
      const filtered = prev.addresses.filter((_, i) => i !== index)

      if (filtered.length === 0) {
        return {
          ...prev,
          addresses: [
            {
              address_label: 'Principal',
              address_line: '',
              is_default: true,
            },
          ],
        }
      }

      return {
        ...prev,
        addresses: filtered,
      }
    })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteClient(deleteTarget.id)
      setDeleteTarget(null)
      await loadClients()
    } catch (err) {
      setError(err.message || 'No se pudo eliminar el cliente')
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
        await updateClient(editingId, form)
        setSuccess('Cliente actualizado correctamente.')
      } else {
        await createClient(form)
        setSuccess('Cliente creado correctamente.')
      }
      await loadClients()
      setTimeout(closeModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el cliente')
    } finally {
      setSaving(false)
    }
  }

  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase()

    if (!term) return clients

    return clients.filter((client) =>
      [
        client.commercial_name,
        client.legal_name,
        client.nit,
        client.main_contact,
        client.email,
        client.phone,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term))
    )
  }, [clients, search])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium uppercase tracking-[0.18em] text-stone-500">
            Comercial
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Clientes</h1>
          <p className="mt-2 text-sm text-stone-500">
            Administra clientes, contactos y direcciones de entrega.
          </p>
        </div>

        <button
          onClick={openModal}
          className="inline-flex items-center justify-center rounded-2xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-900"
        >
          + Nuevo cliente
        </button>
      </div>

      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            placeholder="Buscar por nombre, NIT, contacto, correo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100 md:max-w-md"
          />

          <button
            onClick={loadClients}
            className="rounded-2xl border border-emerald-800 px-4 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
          >
            Recargar
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">
            Cargando clientes...
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            No hay clientes registrados todavía.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredClients.map((client) => (
              <div
                key={client.id}
                className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-base font-semibold text-stone-800">
                      {client.commercial_name}
                    </div>
                    <div className="mt-1 text-sm text-stone-500">
                      {client.legal_name || 'Sin razón social'}
                    </div>
                  </div>

                  <div className="text-sm text-stone-500">
                    NIT: {client.nit || '—'}
                  </div>

                  <div className="text-sm text-stone-500">
                    {client.main_contact || 'Sin contacto'}
                  </div>

                  <div className="text-sm text-stone-500">
                    {client.credit_days || 0} días
                  </div>

                  <div className="text-sm text-stone-500">
                    {client.salespeople?.name
                      ? <span className="font-medium text-emerald-700">{client.salespeople.name}</span>
                      : <span className="text-stone-400">Venta directa</span>
                    }
                  </div>

                  <div className="flex gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        client.status === 'activo'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-200 text-stone-600'
                      }`}
                    >
                      {client.status}
                    </span>
                    {client.es_exportacion && (
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        Exportación
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(client)}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setDeleteTarget(client)}
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
      </div>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Desactivar cliente?</h3>
            <p className="mt-2 text-sm text-stone-600">
              <strong>{deleteTarget.commercial_name}</strong> pasará a estado inactivo.
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
        title={editingId ? 'Editar cliente' : 'Nuevo cliente'}
        maxWidth="max-w-5xl"
      >
        <form onSubmit={handleSubmit} className="space-y-8">
          <section>
            <h3 className="mb-4 text-lg font-semibold text-stone-800">
              Información general
            </h3>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nombre comercial *">
                <input
                  name="commercial_name"
                  value={form.commercial_name}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </Field>

              <Field label="Razón social">
                <input
                  name="legal_name"
                  value={form.legal_name}
                  onChange={handleChange}
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

              <Field label="Días de crédito">
                <input
                  name="credit_days"
                  type="number"
                  value={form.credit_days}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </Field>

              <Field label="Contacto principal">
                <input
                  name="main_contact"
                  value={form.main_contact}
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

              <Field label="Canal">
                <input
                  name="channel"
                  value={form.channel}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </Field>

              <Field label="Vendedor asignado">
                <select
                  name="salesperson_id"
                  value={form.salesperson_id}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                >
                  <option value="">Venta directa (sin comisión)</option>
                  {salespeople.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({(Number(sp.commission_pct) * 100).toFixed(0)}%)
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Dirección principal">
                <textarea
                  name="main_address"
                  rows={4}
                  value={form.main_address}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </Field>

              <Field label="Condiciones especiales de entrega">
                <textarea
                  name="delivery_conditions"
                  rows={4}
                  value={form.delivery_conditions}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </Field>
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-lg font-semibold text-stone-800">Configuración exportación</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                <input
                  type="checkbox"
                  id="es_exportacion"
                  name="es_exportacion"
                  checked={!!form.es_exportacion}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-stone-300 accent-emerald-700"
                />
                <label htmlFor="es_exportacion" className="text-sm font-medium text-stone-700">
                  Cliente de exportación
                </label>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                <input
                  type="checkbox"
                  id="facturar_por_sombrilla"
                  name="facturar_por_sombrilla"
                  checked={!!form.facturar_por_sombrilla}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-stone-300 accent-emerald-700"
                />
                <label htmlFor="facturar_por_sombrilla" className="text-sm font-medium text-stone-700">
                  Facturar por producto sombrilla
                </label>
              </div>

              <Field label="País de destino">
                <input
                  name="pais"
                  value={form.pais}
                  onChange={handleChange}
                  placeholder="ej. El Salvador"
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                />
              </Field>

              <Field label="Moneda predeterminada">
                <select
                  name="moneda_default"
                  value={form.moneda_default}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                >
                  <option value="GTQ">GTQ — Quetzal</option>
                  <option value="USD">USD — Dólar</option>
                </select>
              </Field>
            </div>
          </section>

          <section>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-stone-800">
                Direcciones de entrega
              </h3>

              <button
                type="button"
                onClick={addAddress}
                className="rounded-2xl border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
              >
                + Agregar dirección
              </button>
            </div>

            <div className="space-y-4">
              {form.addresses.map((address, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-stone-200 bg-stone-50 p-4"
                >
                  <div className="grid gap-4 md:grid-cols-[1fr_2fr_auto]">
                    <Field label="Etiqueta">
                      <input
                        value={address.address_label}
                        onChange={(e) =>
                          handleAddressChange(index, 'address_label', e.target.value)
                        }
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                      />
                    </Field>

                    <Field label="Dirección">
                      <textarea
                        rows={3}
                        value={address.address_line}
                        onChange={(e) =>
                          handleAddressChange(index, 'address_line', e.target.value)
                        }
                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-stone-700 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
                      />
                    </Field>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeAddress(index)}
                        disabled={form.addresses.length === 1}
                        className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

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
              className="rounded-2xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-900 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : editingId ? 'Actualizar cliente' : 'Guardar cliente'}
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