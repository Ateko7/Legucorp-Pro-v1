import { useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import CommercialStatCard from '../components/CommercialStatCard'
import FollowupCalendar from '../components/FollowupCalendar'
import FollowupForm, { getEmptyFollowup } from '../components/FollowupForm'
import { useCommercialModule } from '../hooks/useCommercialModule'
import { completeFollowup, getFollowupsPageData, saveFollowup } from '../services/commercialService'

export default function FollowupsPage() {
  const { data, loading, error, reload, setError } = useCommercialModule(getFollowupsPageData, {
    followups: [],
    prospects: [],
    clients: [],
    catalogs: {},
  })
  const [form, setForm] = useState(getEmptyFollowup())
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const buckets = useMemo(() => {
    const now = new Date()
    return {
      today: data.followups.filter((item) => String(item.scheduled_at || '').slice(0, 10) === now.toISOString().slice(0, 10)),
      overdue: data.followups.filter((item) => new Date(item.scheduled_at) < now && item.status !== 'realizado'),
      next: data.followups.filter((item) => new Date(item.scheduled_at) >= now),
      done: data.followups.filter((item) => item.status === 'realizado'),
    }
  }, [data.followups])

  async function handleCreate(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await saveFollowup(form)
      setModalOpen(false)
      setForm(getEmptyFollowup())
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDone(item) {
    await completeFollowup(item.id, item.next_action)
    await reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">Seguimientos</h1>
          <p className="mt-1 text-sm text-stone-500">Agenda comercial para clientes y prospectos con alertas de vencimiento y próximos pasos.</p>
        </div>
        <button type="button" onClick={() => setModalOpen(true)} className="rounded-xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
          Nuevo seguimiento
        </button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-stone-200 bg-white px-5 py-10 text-sm text-stone-500">Cargando seguimientos...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CommercialStatCard label="Seguimientos de hoy" value={buckets.today.length} />
        <CommercialStatCard label="Vencidos" value={buckets.overdue.length} tone="red" />
        <CommercialStatCard label="Proximos" value={buckets.next.length} tone="amber" />
        <CommercialStatCard label="Realizados" value={buckets.done.length} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-900">Tabla general</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
                <tr>
                  <th className="px-4 py-3 text-left">Relacionado</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Responsable</th>
                  <th className="px-4 py-3 text-left">Programado</th>
                  <th className="px-4 py-3 text-left">Prioridad</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.followups.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-medium text-stone-800">{item.related_name}</td>
                    <td className="px-4 py-3 text-stone-600">{item.followup_type}</td>
                    <td className="px-4 py-3 text-stone-600">{item.responsible_name || '-'}</td>
                    <td className="px-4 py-3 text-stone-600">{new Date(item.scheduled_at).toLocaleString('es-GT')}</td>
                    <td className="px-4 py-3 text-stone-600">{item.priority}</td>
                    <td className="px-4 py-3 text-stone-600">{item.status}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => handleDone(item)} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                        Marcar realizado
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <FollowupCalendar followups={data.followups} />
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo seguimiento" maxWidth="max-w-4xl">
        <form className="space-y-6" onSubmit={handleCreate}>
          <FollowupForm value={form} onChange={setForm} prospects={data.prospects} clients={data.clients} catalogs={data.catalogs} />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">{saving ? 'Guardando...' : 'Guardar seguimiento'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
