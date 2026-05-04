import { useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import ProspectDetailDrawer from '../components/ProspectDetailDrawer'
import ProspectForm, { getEmptyProspect } from '../components/ProspectForm'
import ProspectKanban from '../components/ProspectKanban'
import CommercialStatCard from '../components/CommercialStatCard'
import { useCommercialModule } from '../hooks/useCommercialModule'
import { convertCommercialProspect, getProspectsPageData, markProspectLost, saveProspect } from '../services/commercialService'

export default function ProspectsPage() {
  const { data, loading, error, reload, setError } = useCommercialModule(getProspectsPageData, {
    prospects: [],
    followups: [],
    catalogs: {},
  })
  const [mode, setMode] = useState('table')
  const [isModalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(getEmptyProspect())
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)

  const stats = useMemo(() => ({
    total: data.prospects.length,
    hot: data.prospects.filter((item) => Number(item.closing_probability || 0) >= 70).length,
    inNegotiation: data.prospects.filter((item) => item.status === 'negociacion').length,
    converted: data.prospects.filter((item) => item.status === 'convertido').length,
  }), [data.prospects])

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await saveProspect(form, editingId)
      setModalOpen(false)
      setEditingId(null)
      setForm(getEmptyProspect())
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function openCreate() {
    setEditingId(null)
    setForm(getEmptyProspect())
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditingId(item.id)
    setForm(item)
    setModalOpen(true)
  }

  async function handleConvert(item) {
    await convertCommercialProspect(item.id)
    await reload()
  }

  async function handleLose(item) {
    await markProspectLost(item.id, item.loss_reason || 'Marcado manualmente')
    await reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">Prospectos</h1>
          <p className="mt-1 text-sm text-stone-500">Administra prospectos, estados comerciales, historial y conversiones sin duplicar clientes.</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => setMode(mode === 'table' ? 'kanban' : 'table')} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-white">
            Ver {mode === 'table' ? 'Kanban' : 'Tabla'}
          </button>
          <button type="button" onClick={openCreate} className="rounded-xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
            Nuevo prospecto
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CommercialStatCard label="Prospectos totales" value={stats.total} />
        <CommercialStatCard label="Prospectos calientes" value={stats.hot} tone="amber" />
        <CommercialStatCard label="En negociacion" value={stats.inNegotiation} />
        <CommercialStatCard label="Convertidos" value={stats.converted} tone="green" />
      </div>

      {loading ? <div className="rounded-2xl border border-stone-200 bg-white px-5 py-10 text-sm text-stone-500">Cargando prospectos...</div> : null}

      {mode === 'kanban' ? (
        <ProspectKanban prospects={data.prospects} onOpen={(item) => setSelected(item)} />
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
                <tr>
                  <th className="px-4 py-3 text-left">Prospecto</th>
                  <th className="px-4 py-3 text-left">Contacto</th>
                  <th className="px-4 py-3 text-left">Canal</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Probabilidad</th>
                  <th className="px-4 py-3 text-left">Proximo seguimiento</th>
                  <th className="px-4 py-3 text-left">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.prospects.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-800">{item.commercial_name}</div>
                      <div className="text-stone-500">{item.business_type || 'Sin tipo'}</div>
                    </td>
                    <td className="px-4 py-3 text-stone-600">{item.contact_name || 'Sin contacto'}</td>
                    <td className="px-4 py-3 text-stone-600">{item.channel || 'Sin canal'}</td>
                    <td className="px-4 py-3 text-stone-600">{item.status?.replaceAll('_', ' ')}</td>
                    <td className="px-4 py-3 text-stone-600">{Number(item.closing_probability || 0)}%</td>
                    <td className="px-4 py-3 text-stone-600">{item.next_followup_at ? new Date(item.next_followup_at).toLocaleDateString('es-GT') : 'Sin fecha'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setSelected(item)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50">Detalle</button>
                        <button type="button" onClick={() => openEdit(item)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50">Editar</button>
                        <button type="button" onClick={() => handleConvert(item)} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Convertir</button>
                        <button type="button" onClick={() => handleLose(item)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Perdido</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Editar prospecto' : 'Nuevo prospecto'} maxWidth="max-w-5xl">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <ProspectForm value={form} onChange={setForm} catalogs={data.catalogs} mode={editingId ? 'edit' : 'create'} />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">{saving ? 'Guardando...' : 'Guardar prospecto'}</button>
          </div>
        </form>
      </Modal>

      <ProspectDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        prospect={selected}
        followups={data.followups.filter((item) => item.prospect_id === selected?.id)}
      />
    </div>
  )
}
