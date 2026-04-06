import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  createSalesperson,
  deleteSalesperson,
  getCommissionSummary,
  getSalespeople,
  updateSalesperson,
} from '../services/vendedoresService'

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  commission_pct: '4',
  status: 'activo',
}

export default function VendedoresPage() {
  const [salespeople, setSalespeople] = useState([])
  const [commissions, setCommissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [spData, commData] = await Promise.all([
        getSalespeople(),
        getCommissionSummary(),
      ])
      setSalespeople(spData)
      setCommissions(commData)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los vendedores')
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

  function openEditModal(sp) {
    setForm({
      name: sp.name || '',
      phone: sp.phone || '',
      email: sp.email || '',
      commission_pct: String(Number(sp.commission_pct) * 100),
      status: sp.status || 'activo',
    })
    setEditingId(sp.id)
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

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const payload = {
        ...form,
        commission_pct: Number(form.commission_pct) / 100,
      }
      if (editingId) {
        await updateSalesperson(editingId, payload)
        setSuccess('Vendedor actualizado correctamente.')
      } else {
        await createSalesperson(payload)
        setSuccess('Vendedor creado correctamente.')
      }
      await loadAll()
      setTimeout(closeModal, 700)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el vendedor')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSalesperson(deleteTarget.id)
      setDeleteTarget(null)
      await loadAll()
    } catch (err) {
      setError(err.message || 'No se pudo desactivar el vendedor')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  // Resumen de comisiones por vendedor (parsear nombre desde descripción)
  const commissionsByName = useMemo(() => {
    const map = {}
    commissions.forEach((c) => {
      // descripción: "Comisión vendedor NOMBRE – Pedido #N"
      const match = c.description?.match(/Comisión vendedor (.+?) –/)
      const name = match ? match[1] : 'Desconocido'
      if (!map[name]) map[name] = { name, total: 0, count: 0 }
      map[name].total += Number(c.amount || 0)
      map[name].count++
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [commissions])

  const totalCommissions = commissions.reduce((a, c) => a + Number(c.amount || 0), 0)

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Comercial
          </p>
          <h1 className="text-3xl font-semibold text-stone-800">Vendedores</h1>
          <p className="mt-2 text-sm text-stone-500">
            Gestiona tu fuerza de ventas. Las comisiones se generan automáticamente al facturar pedidos.
          </p>
        </div>
        <button
          onClick={openModal}
          className="rounded-2xl bg-[#2f5d50] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#264c42]"
        >
          + Nuevo vendedor
        </button>
      </section>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Vendedores activos</p>
          <p className="mt-1 text-2xl font-bold text-stone-800">
            {salespeople.filter(s => s.status === 'activo').length}
          </p>
        </div>
        <div className="rounded-3xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Comisiones generadas</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">
            Q {totalCommissions.toLocaleString('es-GT', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="rounded-3xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Pedidos con comisión</p>
          <p className="mt-1 text-2xl font-bold text-stone-800">{commissions.length}</p>
        </div>
      </div>

      {/* Lista vendedores */}
      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">Equipo de ventas</h2>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">Cargando vendedores...</div>
        ) : salespeople.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">No hay vendedores registrados todavía.</div>
        ) : (
          <div className="space-y-3">
            {salespeople.map((sp) => {
              const spCommissions = commissionsByName.find(c => c.name === sp.name)
              return (
                <div
                  key={sp.id}
                  className="rounded-2xl border border-stone-200 bg-stone-50/70 px-5 py-4 transition hover:bg-white hover:shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-base font-semibold text-stone-800">{sp.name}</div>
                      <div className="mt-1 text-sm text-stone-500">
                        {sp.phone || '—'} · {sp.email || '—'}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-sm text-stone-600">
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        {(Number(sp.commission_pct) * 100).toFixed(0)}% comisión
                      </span>
                      {spCommissions && (
                        <span className="text-xs text-stone-500">
                          Q {spCommissions.total.toLocaleString('es-GT', { minimumFractionDigits: 2 })} generado ({spCommissions.count} pedidos)
                        </span>
                      )}
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        sp.status === 'activo' ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'
                      }`}>
                        {sp.status}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(sp)}
                        className="rounded-2xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setDeleteTarget(sp)}
                        className="rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        Desactivar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </section>

      {/* Historial comisiones */}
      {commissionsByName.length > 0 && (
        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">Comisiones acumuladas por vendedor</h2>
          <div className="space-y-3">
            {commissionsByName.map((row) => {
              const maxVal = commissionsByName[0]?.total || 1
              const pct = (row.total / maxVal) * 100
              return (
                <div key={row.name} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-stone-700">{row.name}</span>
                    <span className="text-stone-500">
                      Q {row.total.toLocaleString('es-GT', { minimumFractionDigits: 2 })} · {row.count} pedidos
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-stone-100">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Modal confirmación desactivar */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-stone-800">¿Desactivar vendedor?</h3>
            <p className="mt-2 text-sm text-stone-600">
              <strong>{deleteTarget.name}</strong> pasará a estado inactivo y no se asignará a nuevos clientes.
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

      {/* Modal crear/editar */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingId ? 'Editar vendedor' : 'Nuevo vendedor'}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
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

            <Field label="Comisión (%)">
              <input
                name="commission_pct"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={form.commission_pct}
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
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            La comisión se calcula sobre el total <strong>sin IVA</strong> del pedido y se registra automáticamente como gasto comercial al facturar.
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {success && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
          )}

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
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar vendedor'}
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
