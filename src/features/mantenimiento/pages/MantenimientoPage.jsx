import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  closeWorkOrder,
  createEquipment,
  createMaintenancePlan,
  createWorkOrder,
  getMaintenanceDashboard,
  logEquipmentUsage,
  maintenanceLabels,
  rescheduleWorkOrder,
  setEquipmentStatus,
  startWorkOrder,
  updateEquipment,
} from '../services/mantenimientoService'

const INPUT = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100'

const EQUIPMENT_CATEGORIES = [
  'centrifuga',
  'banda',
  'tanque',
  'selladora',
  'cuarto_frio',
  'bascula',
  'blower',
  'compresor',
  'bomba',
  'otro',
]

const TIME_FREQUENCY_OPTIONS = [
  { value: 'diario', label: 'Diario' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'mensual', label: 'Mensual' },
  { value: 'bimensual', label: 'Bimensual' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' },
  { value: 'personalizado', label: 'Personalizado' },
]

const emptyEquipment = {
  name: '',
  category: 'centrifuga',
  area_location: '',
  brand: '',
  model: '',
  serial_number: '',
  supplier_id: '',
  purchase_date: '',
  installation_date: '',
  status: 'activo',
  responsible_user_id: '',
  general_notes: '',
  attachment_url: '',
  initial_usage_counter: 0,
  current_usage_counter: 0,
  usage_unit: 'horas',
}

const emptyPlan = {
  equipment_id: '',
  maintenance_type: 'preventivo',
  name: '',
  description: '',
  frequency_type: 'time',
  time_frequency: 'mensual',
  custom_days: '',
  usage_frequency_type: 'horas',
  usage_interval: '',
  next_scheduled_date: '',
  next_usage_target: '',
  estimated_minutes: '',
  suggested_responsible_user_id: '',
  requires_shutdown: false,
  suggested_parts: '',
  checklist_required: true,
  yellow_days_threshold: 7,
  yellow_usage_pct: 80,
  red_usage_pct: 100,
  is_active: true,
}

const emptyOrder = {
  equipment_id: '',
  plan_id: '',
  maintenance_type: 'preventivo',
  scheduled_date: new Date().toISOString().slice(0, 10),
  executed_by: '',
  support_staff: '',
  corrective_reason: '',
  failure_description: '',
  observations: '',
  status: 'programado',
}

const emptyClose = {
  actual_execution_date: new Date().toISOString().slice(0, 10),
  start_time: '',
  end_time: '',
  executed_by: '',
  support_staff: '',
  corrective_reason: '',
  failure_description: '',
  action_performed: '',
  parts_used: '',
  parts_cost: 0,
  labor_cost: 0,
  downtime_minutes: 0,
  final_result: '',
  observations: '',
  attachment_url: '',
}

function n(value) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function fmt(value, digits = 0) {
  return n(value).toLocaleString('es-GT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtQ(value) {
  return `Q ${fmt(value, 2)}`
}

function fmtDate(value) {
  if (!value) return '-'
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('es-GT')
}

function getTimeFrequencyLabel(value, customDays = null) {
  if (value === 'personalizado') return customDays ? `Cada ${customDays} dias` : 'Personalizado'
  return TIME_FREQUENCY_OPTIONS.find((option) => option.value === value)?.label || value || '-'
}

function getFrequencySummary(plan) {
  if (!plan) return '-'

  if (plan.frequency_type === 'time') {
    return `Por tiempo · ${getTimeFrequencyLabel(plan.time_frequency, plan.custom_days)}`
  }

  if (plan.frequency_type === 'usage') {
    return `Por uso · cada ${plan.usage_interval || '-'} ${plan.usage_frequency_type || 'unidades'}`
  }

  return `Mixto · ${getTimeFrequencyLabel(plan.time_frequency, plan.custom_days)} + cada ${plan.usage_interval || '-'} ${plan.usage_frequency_type || 'unidades'}`
}

function toneClass(semaphore) {
  if (semaphore === 'red') return 'bg-red-100 text-red-700 border-red-200'
  if (semaphore === 'yellow') return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-emerald-100 text-emerald-700 border-emerald-200'
}

function Kpi({ label, value, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-stone-200 bg-white',
    green: 'border-emerald-200 bg-emerald-50',
    yellow: 'border-amber-200 bg-amber-50',
    red: 'border-red-200 bg-red-50',
  }
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <p className="text-sm text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm font-semibold ${
        active ? 'border-[#2f5d50] text-[#2f5d50]' : 'border-transparent text-stone-500 hover:text-stone-800'
      }`}
    >
      {children}
    </button>
  )
}

function ChecklistEditor({ items, setItems }) {
  function update(index, patch) {
    setItems((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-stone-200 p-3 md:grid-cols-[1fr_150px_90px_auto]">
          <input
            value={item.item_label}
            onChange={(event) => update(index, { item_label: event.target.value })}
            placeholder="Item de revision"
            className={INPUT}
          />
          <select value={item.response_type} onChange={(event) => update(index, { response_type: event.target.value })} className={INPUT}>
            <option value="check">Si / No</option>
            <option value="number">Numero</option>
            <option value="short_text">Texto corto</option>
            <option value="long_text">Observacion larga</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" checked={item.required} onChange={(event) => update(index, { required: event.target.checked })} />
            Req.
          </label>
          <button
            type="button"
            onClick={() => setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            Quitar
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setItems((prev) => [...prev, { item_label: '', response_type: 'check', required: true }])}
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
      >
        Agregar item
      </button>
    </div>
  )
}

function EquipmentForm({ form, setForm, suppliers, users, editing }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {editing ? (
        <Field label="Contador actual">
          <input type="number" value={form.current_usage_counter} onChange={(event) => setForm((prev) => ({ ...prev, current_usage_counter: event.target.value }))} className={INPUT} />
        </Field>
      ) : null}
      <Field label="Nombre del equipo *">
        <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className={INPUT} required />
      </Field>
      <Field label="Categoria">
        <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} className={INPUT}>
          {EQUIPMENT_CATEGORIES.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
        </select>
      </Field>
      <Field label="Area o ubicacion">
        <input value={form.area_location} onChange={(event) => setForm((prev) => ({ ...prev, area_location: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Estado">
        <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))} className={INPUT}>
          {Object.entries(maintenanceLabels.equipmentStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Marca">
        <input value={form.brand} onChange={(event) => setForm((prev) => ({ ...prev, brand: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Modelo">
        <input value={form.model} onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Serie">
        <input value={form.serial_number} onChange={(event) => setForm((prev) => ({ ...prev, serial_number: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Proveedor">
        <select value={form.supplier_id} onChange={(event) => setForm((prev) => ({ ...prev, supplier_id: event.target.value }))} className={INPUT}>
          <option value="">Sin proveedor</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
      </Field>
      <Field label="Fecha de compra">
        <input type="date" value={form.purchase_date} onChange={(event) => setForm((prev) => ({ ...prev, purchase_date: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Fecha de instalacion">
        <input type="date" value={form.installation_date} onChange={(event) => setForm((prev) => ({ ...prev, installation_date: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Responsable">
        <select value={form.responsible_user_id} onChange={(event) => setForm((prev) => ({ ...prev, responsible_user_id: event.target.value }))} className={INPUT}>
          <option value="">Sin responsable</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email}</option>)}
        </select>
      </Field>
      <Field label="Unidad de uso">
        <select value={form.usage_unit} onChange={(event) => setForm((prev) => ({ ...prev, usage_unit: event.target.value }))} className={INPUT}>
          <option value="horas">Horas</option>
          <option value="ciclos">Ciclos</option>
          <option value="producciones">Producciones</option>
          <option value="lotes">Lotes procesados</option>
          <option value="ninguno">No aplica</option>
        </select>
      </Field>
      {!editing ? (
        <Field label="Horometro / contador inicial">
          <input type="number" value={form.initial_usage_counter} onChange={(event) => setForm((prev) => ({ ...prev, initial_usage_counter: event.target.value }))} className={INPUT} />
        </Field>
      ) : null}
      <div className="md:col-span-2">
        <Field label="Archivo o foto URL">
          <input value={form.attachment_url} onChange={(event) => setForm((prev) => ({ ...prev, attachment_url: event.target.value }))} className={INPUT} />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="Observaciones">
          <textarea rows={3} value={form.general_notes} onChange={(event) => setForm((prev) => ({ ...prev, general_notes: event.target.value }))} className={INPUT} />
        </Field>
      </div>
    </div>
  )
}

function PlanForm({ form, setForm, users }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Tipo">
        <select value={form.maintenance_type} onChange={(event) => setForm((prev) => ({ ...prev, maintenance_type: event.target.value }))} className={INPUT}>
          {Object.entries(maintenanceLabels.maintenanceType).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Nombre del plan *">
        <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className={INPUT} required />
      </Field>
      <Field label="Criterio de activacion">
        <select value={form.frequency_type} onChange={(event) => setForm((prev) => ({ ...prev, frequency_type: event.target.value }))} className={INPUT}>
          <option value="time">Por tiempo</option>
          <option value="usage">Por uso</option>
          <option value="mixed">Mixto</option>
        </select>
      </Field>
      {['time', 'mixed'].includes(form.frequency_type) ? (
        <Field label="Frecuencia por tiempo">
          <select value={form.time_frequency} onChange={(event) => setForm((prev) => ({ ...prev, time_frequency: event.target.value }))} className={INPUT}>
            {TIME_FREQUENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
      ) : null}
      {form.time_frequency === 'personalizado' && ['time', 'mixed'].includes(form.frequency_type) ? (
        <Field label="Dias personalizados">
          <input type="number" value={form.custom_days} onChange={(event) => setForm((prev) => ({ ...prev, custom_days: event.target.value }))} className={INPUT} />
        </Field>
      ) : null}
      {['usage', 'mixed'].includes(form.frequency_type) ? (
        <>
          <Field label="Frecuencia por uso">
            <select value={form.usage_frequency_type} onChange={(event) => setForm((prev) => ({ ...prev, usage_frequency_type: event.target.value }))} className={INPUT}>
              <option value="horas">Cada X horas</option>
              <option value="ciclos">Cada X ciclos</option>
              <option value="producciones">Cada X producciones</option>
              <option value="lotes">Cada X lotes</option>
            </select>
          </Field>
          <Field label="Intervalo de uso">
            <input type="number" value={form.usage_interval} onChange={(event) => setForm((prev) => ({ ...prev, usage_interval: event.target.value }))} className={INPUT} />
          </Field>
        </>
      ) : null}
      <Field label="Proxima fecha programada">
        <input type="date" value={form.next_scheduled_date} onChange={(event) => setForm((prev) => ({ ...prev, next_scheduled_date: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Proximo uso objetivo">
        <input type="number" value={form.next_usage_target} onChange={(event) => setForm((prev) => ({ ...prev, next_usage_target: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Tiempo estimado (min)">
        <input type="number" value={form.estimated_minutes} onChange={(event) => setForm((prev) => ({ ...prev, estimated_minutes: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Responsable sugerido">
        <select value={form.suggested_responsible_user_id} onChange={(event) => setForm((prev) => ({ ...prev, suggested_responsible_user_id: event.target.value }))} className={INPUT}>
          <option value="">Sin responsable</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email}</option>)}
        </select>
      </Field>
      <Field label="Umbral amarillo dias">
        <input type="number" value={form.yellow_days_threshold} onChange={(event) => setForm((prev) => ({ ...prev, yellow_days_threshold: event.target.value }))} className={INPUT} />
      </Field>
      <Field label="Umbral uso amarillo %">
        <input type="number" value={form.yellow_usage_pct} onChange={(event) => setForm((prev) => ({ ...prev, yellow_usage_pct: event.target.value }))} className={INPUT} />
      </Field>
      <div className="md:col-span-2">
        <Field label="Descripcion del trabajo">
          <textarea rows={3} value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} className={INPUT} />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="Repuestos o insumos sugeridos">
          <textarea rows={2} value={form.suggested_parts} onChange={(event) => setForm((prev) => ({ ...prev, suggested_parts: event.target.value }))} className={INPUT} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={form.requires_shutdown} onChange={(event) => setForm((prev) => ({ ...prev, requires_shutdown: event.target.checked }))} />
        Requiere paro de equipo
      </label>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input type="checkbox" checked={form.checklist_required} onChange={(event) => setForm((prev) => ({ ...prev, checklist_required: event.target.checked }))} />
        Checklist obligatorio
      </label>
    </div>
  )
}

export default function MantenimientoPage() {
  const [data, setData] = useState({ equipment: [], users: [], suppliers: [], workOrders: [], dashboard: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filters, setFilters] = useState({ search: '', area: '', category: '', status: '', alert: '' })
  const [selectedId, setSelectedId] = useState('')
  const [detailTab, setDetailTab] = useState('general')
  const [equipmentModal, setEquipmentModal] = useState(false)
  const [planModal, setPlanModal] = useState(false)
  const [orderModal, setOrderModal] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [usageModal, setUsageModal] = useState(false)
  const [equipmentForm, setEquipmentForm] = useState(emptyEquipment)
  const [editingEquipmentId, setEditingEquipmentId] = useState('')
  const [planForm, setPlanForm] = useState(emptyPlan)
  const [checklistItems, setChecklistItems] = useState([{ item_label: 'Estado general del equipo', response_type: 'check', required: true }])
  const [orderForm, setOrderForm] = useState(emptyOrder)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [closeForm, setCloseForm] = useState(emptyClose)
  const [responses, setResponses] = useState([])
  const [usageIncrement, setUsageIncrement] = useState('')
  const [usageNotes, setUsageNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const nextData = await getMaintenanceDashboard()
      setData(nextData)
      setSelectedId((prev) => prev || nextData.equipment?.[0]?.id || '')
    } catch (err) {
      setError(err.message || 'No se pudo cargar mantenimiento')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useRealtimeRefresh([
    'maintenance_equipment',
    'maintenance_plans',
    'maintenance_work_orders',
    'maintenance_alerts',
    'maintenance_usage_logs',
  ], load)

  const areas = useMemo(() => [...new Set(data.equipment.map((item) => item.area_location).filter(Boolean))], [data.equipment])
  const categories = useMemo(() => [...new Set(data.equipment.map((item) => item.category).filter(Boolean))], [data.equipment])

  const filteredEquipment = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return data.equipment.filter((item) => {
      const matchesTerm = !term || [item.internal_code, item.name, item.category, item.area_location, item.brand, item.model]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
      const matchesArea = !filters.area || item.area_location === filters.area
      const matchesCategory = !filters.category || item.category === filters.category
      const matchesStatus = !filters.status || item.status === filters.status
      const matchesAlert = !filters.alert || item.semaphore === filters.alert
      return matchesTerm && matchesArea && matchesCategory && matchesStatus && matchesAlert
    })
  }, [data.equipment, filters])

  const selectedEquipment = useMemo(() => {
    return data.equipment.find((item) => item.id === selectedId) || filteredEquipment[0] || null
  }, [data.equipment, filteredEquipment, selectedId])

  function openNewEquipment() {
    setEditingEquipmentId('')
    setEquipmentForm(emptyEquipment)
    setEquipmentModal(true)
  }

  function openEditEquipment(equipment) {
    setEditingEquipmentId(equipment.id)
    setEquipmentForm({
      name: equipment.name || '',
      category: equipment.category || 'centrifuga',
      area_location: equipment.area_location || '',
      brand: equipment.brand || '',
      model: equipment.model || '',
      serial_number: equipment.serial_number || '',
      supplier_id: equipment.supplier_id || '',
      purchase_date: equipment.purchase_date || '',
      installation_date: equipment.installation_date || '',
      status: equipment.status || 'activo',
      responsible_user_id: equipment.responsible_user_id || '',
      general_notes: equipment.general_notes || '',
      attachment_url: equipment.attachment_url || '',
      initial_usage_counter: equipment.initial_usage_counter || 0,
      current_usage_counter: equipment.current_usage_counter || 0,
      usage_unit: equipment.usage_unit || 'horas',
    })
    setEquipmentModal(true)
  }

  function openPlan(equipment) {
    setPlanForm({
      ...emptyPlan,
      equipment_id: equipment.id,
      suggested_responsible_user_id: equipment.responsible_user_id || '',
      next_scheduled_date: new Date().toISOString().slice(0, 10),
    })
    setChecklistItems([{ item_label: 'Estado general del equipo', response_type: 'check', required: true }])
    setPlanModal(true)
  }

  function openOrder(equipment, plan = null) {
    setOrderForm({
      ...emptyOrder,
      equipment_id: equipment.id,
      plan_id: plan?.id || '',
      maintenance_type: plan?.maintenance_type || 'correctivo',
      scheduled_date: plan?.next_scheduled_date || new Date().toISOString().slice(0, 10),
      executed_by: plan?.suggested_responsible_user_id || equipment.responsible_user_id || '',
    })
    setOrderModal(true)
  }

  function openClose(order) {
    const plan = selectedEquipment?.plans?.find((item) => item.id === order.plan_id) || null
    setSelectedOrder(order)
    setCloseForm({
      ...emptyClose,
      executed_by: order.executed_by || plan?.suggested_responsible_user_id || selectedEquipment?.responsible_user_id || '',
      corrective_reason: order.corrective_reason || '',
      failure_description: order.failure_description || '',
    })
    setResponses((plan?.checklist_items || []).map((item) => ({
      checklist_item_id: item.id,
      item_label: item.item_label,
      response_type: item.response_type,
      required: item.required,
      response_bool: item.response_type === 'check' ? false : null,
      response_number: '',
      response_text: '',
      result: 'conforme',
      observation: '',
      evidence_url: '',
    })))
    setCloseModal(true)
  }

  async function saveEquipment(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (editingEquipmentId) {
        await updateEquipment(editingEquipmentId, equipmentForm)
        setSuccess('Equipo actualizado.')
      } else {
        const created = await createEquipment(equipmentForm)
        setSelectedId(created.id)
        setSuccess(`Equipo registrado con codigo automatico ${created.internal_code}.`)
      }
      setEquipmentModal(false)
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el equipo')
    } finally {
      setSaving(false)
    }
  }

  async function savePlan(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      if (['time', 'mixed'].includes(planForm.frequency_type) && !planForm.next_scheduled_date) {
        throw new Error('Debes indicar la primera fecha programada para un plan por tiempo.')
      }
      if (['usage', 'mixed'].includes(planForm.frequency_type) && n(planForm.usage_interval) <= 0) {
        throw new Error('Debes indicar un intervalo de uso mayor a 0.')
      }
      if (
        ['time', 'mixed'].includes(planForm.frequency_type)
        && planForm.time_frequency === 'personalizado'
        && n(planForm.custom_days) <= 0
      ) {
        throw new Error('Debes indicar los dias personalizados para la frecuencia por tiempo.')
      }
      await createMaintenancePlan(planForm, checklistItems)
      setPlanModal(false)
      setSuccess('Plan de mantenimiento creado.')
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo guardar el plan')
    } finally {
      setSaving(false)
    }
  }

  async function saveOrder(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const created = await createWorkOrder(orderForm)
      setOrderModal(false)
      setSuccess(`Mantenimiento creado: ${created.work_order_code}.`)
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo crear el mantenimiento')
    } finally {
      setSaving(false)
    }
  }

  async function completeOrder(event) {
    event.preventDefault()
    if (!selectedOrder) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const plan = selectedEquipment?.plans?.find((item) => item.id === selectedOrder.plan_id) || null
      await closeWorkOrder(selectedOrder, { ...closeForm, plan }, responses)
      setCloseModal(false)
      setSuccess('Mantenimiento cerrado y proxima fecha recalculada.')
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo cerrar el mantenimiento')
    } finally {
      setSaving(false)
    }
  }

  async function handleStart(order) {
    setError('')
    setSuccess('')
    try {
      await startWorkOrder(order.id)
      setSuccess('Mantenimiento iniciado.')
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo iniciar el mantenimiento')
    }
  }

  async function handleUsage(event) {
    event.preventDefault()
    if (!selectedEquipment) return
    setSaving(true)
    setError('')
    try {
      await logEquipmentUsage(selectedEquipment, usageIncrement, usageNotes)
      setUsageModal(false)
      setUsageIncrement('')
      setUsageNotes('')
      setSuccess('Uso del equipo actualizado.')
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo registrar uso')
    } finally {
      setSaving(false)
    }
  }

  async function handleOutOfService(equipment) {
    setError('')
    setSuccess('')
    try {
      await setEquipmentStatus(equipment.id, 'fuera_de_servicio')
      setSuccess('Equipo marcado fuera de servicio.')
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo cambiar estado')
    }
  }

  async function handleReschedule(order) {
    const date = window.prompt('Nueva fecha programada (YYYY-MM-DD)', order.scheduled_date || new Date().toISOString().slice(0, 10))
    if (!date) return
    try {
      await rescheduleWorkOrder(order.id, date, 'Reprogramado desde modulo de mantenimiento')
      setSuccess('Mantenimiento reprogramado.')
      await load()
    } catch (err) {
      setError(err.message || 'No se pudo reprogramar')
    }
  }

  function updateResponse(index, patch) {
    setResponses((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">Mantenimiento</h1>
          <p className="mt-2 text-sm text-stone-500">
            Equipos, planes, alertas, checklist e historial operativo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Recargar</button>
          <button onClick={openNewEquipment} className="rounded-lg bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#274d43]">Registrar equipo</button>
          {selectedEquipment ? (
            <button onClick={() => openOrder(selectedEquipment)} className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-700">Iniciar correctivo</button>
          ) : null}
        </div>
      </section>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Equipos activos" value={data.dashboard.activeEquipment || 0} />
        <Kpi label="Alerta amarilla" value={data.dashboard.yellowEquipment || 0} tone="yellow" />
        <Kpi label="Vencidos / criticos" value={data.dashboard.redEquipment || 0} tone="red" />
        <Kpi label="Programados hoy" value={data.dashboard.scheduledToday || 0} />
        <Kpi label="Costo mes" value={fmtQ(data.dashboard.monthlyCost || 0)} />
        <Kpi label="Fuera de servicio" value={data.dashboard.outOfService || 0} tone="red" />
        <Kpi label="Pendientes" value={data.dashboard.pending || 0} tone="yellow" />
        <Kpi label="Tiempo muerto mes" value={`${fmt(data.dashboard.monthlyDowntime || 0)} min`} />
        <Kpi label="Cumplimiento preventivo" value={`${fmt(data.dashboard.preventiveCompliance || 0, 1)}%`} tone="green" />
        <Kpi label="Correctivos mes" value={data.dashboard.correctiveThisMonth || 0} />
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <input placeholder="Buscar equipo..." value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} className={INPUT} />
          <select value={filters.area} onChange={(event) => setFilters((prev) => ({ ...prev, area: event.target.value }))} className={INPUT}>
            <option value="">Todas las areas</option>
            {areas.map((area) => <option key={area} value={area}>{area}</option>)}
          </select>
          <select value={filters.category} onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))} className={INPUT}>
            <option value="">Todas las categorias</option>
            {categories.map((category) => <option key={category} value={category}>{category.replaceAll('_', ' ')}</option>)}
          </select>
          <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} className={INPUT}>
            <option value="">Todos los estados</option>
            {Object.entries(maintenanceLabels.equipmentStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={filters.alert} onChange={(event) => setFilters((prev) => ({ ...prev, alert: event.target.value }))} className={INPUT}>
            <option value="">Todos los semaforos</option>
            <option value="green">Verde</option>
            <option value="yellow">Amarillo</option>
            <option value="red">Rojo</option>
          </select>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="font-semibold text-stone-900">Equipos</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500">
                <tr>
                  <th className="px-4 py-3">Codigo</th>
                  <th className="px-4 py-3">Equipo</th>
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Uso</th>
                  <th className="px-4 py-3">Semaforo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-500">Cargando...</td></tr>
                ) : filteredEquipment.length ? filteredEquipment.map((equipment) => (
                  <tr
                    key={equipment.id}
                    onClick={() => { setSelectedId(equipment.id); setDetailTab('general') }}
                    className={`cursor-pointer hover:bg-stone-50 ${selectedEquipment?.id === equipment.id ? 'bg-[#f8f4ed]' : ''}`}
                  >
                    <td className="px-4 py-3 font-semibold text-stone-900">{equipment.internal_code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-900">{equipment.name}</div>
                      <div className="text-xs text-stone-500">{equipment.category?.replaceAll('_', ' ')}</div>
                    </td>
                    <td className="px-4 py-3 text-stone-600">{equipment.area_location || '-'}</td>
                    <td className="px-4 py-3 text-stone-600">{maintenanceLabels.equipmentStatus[equipment.status] || equipment.status}</td>
                    <td className="px-4 py-3 text-stone-600">{fmt(equipment.current_usage_counter, 2)} {equipment.usage_unit}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-lg border px-2 py-1 text-xs font-semibold ${toneClass(equipment.semaphore)}`}>
                        {equipment.semaphore === 'green' ? 'Al dia' : equipment.semaphore === 'yellow' ? 'Proximo' : 'Critico'}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-500">No hay equipos con esos filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white">
          {selectedEquipment ? (
            <>
              <div className="border-b border-stone-200 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-500">{selectedEquipment.internal_code}</p>
                    <h2 className="text-xl font-semibold text-stone-900">{selectedEquipment.name}</h2>
                    <p className="mt-1 text-sm text-stone-500">{selectedEquipment.area_location || 'Sin area'} · {selectedEquipment.category?.replaceAll('_', ' ')}</p>
                  </div>
                  <span className={`rounded-lg border px-2 py-1 text-xs font-semibold ${toneClass(selectedEquipment.semaphore)}`}>
                    {selectedEquipment.semaphore === 'green' ? 'Verde' : selectedEquipment.semaphore === 'yellow' ? 'Amarillo' : 'Rojo'}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => openEditEquipment(selectedEquipment)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Editar equipo</button>
                  <button onClick={() => openPlan(selectedEquipment)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Programar mantenimiento</button>
                  <button onClick={() => setUsageModal(true)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Registrar uso</button>
                  <button onClick={() => handleOutOfService(selectedEquipment)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">Fuera de servicio</button>
                </div>
              </div>

              <div className="border-b border-stone-200 px-4">
                <div className="flex flex-wrap gap-2">
                  {['general', 'planes', 'mantenimientos', 'historial', 'costos', 'documentos'].map((tab) => (
                    <TabButton key={tab} active={detailTab === tab} onClick={() => setDetailTab(tab)}>
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </TabButton>
                  ))}
                </div>
              </div>

              <div className="p-4">
                {detailTab === 'general' ? (
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <div><span className="text-stone-500">Marca:</span> {selectedEquipment.brand || '-'}</div>
                    <div><span className="text-stone-500">Modelo:</span> {selectedEquipment.model || '-'}</div>
                    <div><span className="text-stone-500">Serie:</span> {selectedEquipment.serial_number || '-'}</div>
                    <div><span className="text-stone-500">Proveedor:</span> {selectedEquipment.supplier?.name || '-'}</div>
                    <div><span className="text-stone-500">Compra:</span> {fmtDate(selectedEquipment.purchase_date)}</div>
                    <div><span className="text-stone-500">Instalacion:</span> {fmtDate(selectedEquipment.installation_date)}</div>
                    <div><span className="text-stone-500">Responsable:</span> {selectedEquipment.responsible?.full_name || selectedEquipment.responsible?.email || '-'}</div>
                    <div><span className="text-stone-500">Uso actual:</span> {fmt(selectedEquipment.current_usage_counter, 2)} {selectedEquipment.usage_unit}</div>
                    <div className="md:col-span-2"><span className="text-stone-500">Observaciones:</span> {selectedEquipment.general_notes || '-'}</div>
                  </div>
                ) : null}

                {detailTab === 'planes' ? (
                  <div className="space-y-3">
                    {selectedEquipment.plans?.length ? selectedEquipment.plans.map((plan) => (
                      <div key={plan.id} className="rounded-lg border border-stone-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-stone-900">{plan.name}</p>
                            <p className="text-sm text-stone-500">{maintenanceLabels.maintenanceType[plan.maintenance_type]} · {getFrequencySummary(plan)}</p>
                            <p className="mt-1 text-sm text-stone-600">Fecha: {fmtDate(plan.next_scheduled_date)} · Uso objetivo: {plan.next_usage_target || '-'}</p>
                          </div>
                          <button onClick={() => openOrder(selectedEquipment, plan)} className="rounded-lg bg-[#2f5d50] px-3 py-2 text-sm font-semibold text-white hover:bg-[#274d43]">Crear orden</button>
                        </div>
                        {plan.checklist_items?.length ? (
                          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-600">
                            {plan.checklist_items.map((item) => <li key={item.id}>{item.item_label} · {item.response_type}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    )) : <p className="text-sm text-stone-500">Este equipo no tiene planes.</p>}
                  </div>
                ) : null}

                {detailTab === 'mantenimientos' || detailTab === 'historial' ? (
                  <div className="space-y-3">
                    {selectedEquipment.work_orders?.length ? selectedEquipment.work_orders.map((order) => (
                      <div key={order.id} className="rounded-lg border border-stone-200 p-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-semibold text-stone-900">{order.work_order_code} · {maintenanceLabels.maintenanceType[order.maintenance_type]}</p>
                            <p className="text-sm text-stone-500">Estado: {maintenanceLabels.workOrderStatus[order.status]} · Programado: {fmtDate(order.scheduled_date)}</p>
                            <p className="mt-1 text-sm text-stone-600">{order.failure_description || order.action_performed || order.observations || '-'}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {order.status === 'programado' ? <button onClick={() => handleStart(order)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Iniciar</button> : null}
                            {['programado', 'en_proceso', 'reprogramado'].includes(order.status) ? <button onClick={() => openClose(order)} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700">Cerrar</button> : null}
                            {order.status !== 'completado' ? <button onClick={() => handleReschedule(order)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">Reprogramar</button> : null}
                          </div>
                        </div>
                      </div>
                    )) : <p className="text-sm text-stone-500">Sin mantenimientos registrados.</p>}
                  </div>
                ) : null}

                {detailTab === 'costos' ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <Kpi label="Costo acumulado" value={fmtQ(selectedEquipment.total_cost || 0)} />
                    <Kpi label="Tiempo muerto" value={`${fmt(selectedEquipment.total_downtime || 0)} min`} />
                    <Kpi label="Correctivos" value={selectedEquipment.corrective_count || 0} />
                  </div>
                ) : null}

                {detailTab === 'documentos' ? (
                  <div className="space-y-3 text-sm">
                    <p><span className="text-stone-500">Documento del equipo:</span> {selectedEquipment.attachment_url ? <a className="font-semibold text-[#2f5d50]" href={selectedEquipment.attachment_url} target="_blank" rel="noreferrer">Abrir</a> : '-'}</p>
                    {selectedEquipment.work_orders?.filter((order) => order.attachment_url).map((order) => (
                      <p key={order.id}>{order.work_order_code}: <a className="font-semibold text-[#2f5d50]" href={order.attachment_url} target="_blank" rel="noreferrer">Abrir evidencia</a></p>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="p-10 text-center text-sm text-stone-500">Selecciona un equipo.</div>
          )}
        </div>
      </section>

      <Modal isOpen={equipmentModal} onClose={() => setEquipmentModal(false)} title={editingEquipmentId ? 'Editar equipo' : 'Registrar equipo'} maxWidth="max-w-4xl">
        <form onSubmit={saveEquipment} className="space-y-5">
          {!editingEquipmentId ? <p className="text-sm text-stone-500">El codigo interno se genera automaticamente al guardar.</p> : null}
          <EquipmentForm form={equipmentForm} setForm={setEquipmentForm} suppliers={data.suppliers || []} users={data.users || []} editing={!!editingEquipmentId} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEquipmentModal(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar equipo'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={planModal} onClose={() => setPlanModal(false)} title="Programar mantenimiento" maxWidth="max-w-4xl">
        <form onSubmit={savePlan} className="space-y-5">
          <PlanForm form={planForm} setForm={setPlanForm} users={data.users || []} />
          <div>
            <h3 className="mb-3 font-semibold text-stone-900">Checklist</h3>
            <ChecklistEditor items={checklistItems} setItems={setChecklistItems} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPlanModal(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar plan'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={orderModal} onClose={() => setOrderModal(false)} title="Crear mantenimiento" maxWidth="max-w-3xl">
        <form onSubmit={saveOrder} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tipo">
              <select value={orderForm.maintenance_type} onChange={(event) => setOrderForm((prev) => ({ ...prev, maintenance_type: event.target.value }))} className={INPUT}>
                {Object.entries(maintenanceLabels.maintenanceType).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Fecha programada">
              <input type="date" value={orderForm.scheduled_date} onChange={(event) => setOrderForm((prev) => ({ ...prev, scheduled_date: event.target.value }))} className={INPUT} />
            </Field>
            <Field label="Responsable">
              <select value={orderForm.executed_by} onChange={(event) => setOrderForm((prev) => ({ ...prev, executed_by: event.target.value }))} className={INPUT}>
                <option value="">Sin responsable</option>
                {data.users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email}</option>)}
              </select>
            </Field>
            <Field label="Personal de apoyo">
              <input value={orderForm.support_staff} onChange={(event) => setOrderForm((prev) => ({ ...prev, support_staff: event.target.value }))} className={INPUT} />
            </Field>
          </div>
          <Field label="Motivo / falla detectada">
            <textarea rows={3} value={orderForm.failure_description} onChange={(event) => setOrderForm((prev) => ({ ...prev, failure_description: event.target.value }))} className={INPUT} />
          </Field>
          <Field label="Observaciones">
            <textarea rows={2} value={orderForm.observations} onChange={(event) => setOrderForm((prev) => ({ ...prev, observations: event.target.value }))} className={INPUT} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOrderModal(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Crear mantenimiento'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={usageModal} onClose={() => setUsageModal(false)} title="Registrar uso" maxWidth="max-w-lg">
        <form onSubmit={handleUsage} className="space-y-4">
          <Field label={`Incremento (${selectedEquipment?.usage_unit || 'uso'})`}>
            <input type="number" value={usageIncrement} onChange={(event) => setUsageIncrement(event.target.value)} className={INPUT} required />
          </Field>
          <Field label="Notas">
            <textarea rows={3} value={usageNotes} onChange={(event) => setUsageNotes(event.target.value)} className={INPUT} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setUsageModal(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar uso'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={closeModal} onClose={() => setCloseModal(false)} title="Cerrar mantenimiento" maxWidth="max-w-5xl">
        <form onSubmit={completeOrder} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Fecha real">
              <input type="date" value={closeForm.actual_execution_date} onChange={(event) => setCloseForm((prev) => ({ ...prev, actual_execution_date: event.target.value }))} className={INPUT} />
            </Field>
            <Field label="Costo repuestos">
              <input type="number" value={closeForm.parts_cost} onChange={(event) => setCloseForm((prev) => ({ ...prev, parts_cost: event.target.value }))} className={INPUT} />
            </Field>
            <Field label="Costo mano de obra">
              <input type="number" value={closeForm.labor_cost} onChange={(event) => setCloseForm((prev) => ({ ...prev, labor_cost: event.target.value }))} className={INPUT} />
            </Field>
            <Field label="Tiempo muerto (min)">
              <input type="number" value={closeForm.downtime_minutes} onChange={(event) => setCloseForm((prev) => ({ ...prev, downtime_minutes: event.target.value }))} className={INPUT} />
            </Field>
            <Field label="Responsable ejecutor">
              <select value={closeForm.executed_by} onChange={(event) => setCloseForm((prev) => ({ ...prev, executed_by: event.target.value }))} className={INPUT}>
                <option value="">Usuario actual</option>
                {data.users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email}</option>)}
              </select>
            </Field>
            <Field label="Resultado final">
              <input value={closeForm.final_result} onChange={(event) => setCloseForm((prev) => ({ ...prev, final_result: event.target.value }))} className={INPUT} />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Accion realizada">
              <textarea rows={3} value={closeForm.action_performed} onChange={(event) => setCloseForm((prev) => ({ ...prev, action_performed: event.target.value }))} className={INPUT} />
            </Field>
            <Field label="Repuestos utilizados">
              <textarea rows={3} value={closeForm.parts_used} onChange={(event) => setCloseForm((prev) => ({ ...prev, parts_used: event.target.value }))} className={INPUT} />
            </Field>
          </div>

          {responses.length ? (
            <div>
              <h3 className="mb-3 font-semibold text-stone-900">Checklist obligatorio</h3>
              <div className="space-y-3">
                {responses.map((response, index) => (
                  <div key={`${response.checklist_item_id}-${index}`} className="rounded-lg border border-stone-200 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="font-medium text-stone-900">{response.item_label}</p>
                      <select value={response.result} onChange={(event) => updateResponse(index, { result: event.target.value })} className="rounded-lg border border-stone-300 px-2 py-1 text-sm">
                        <option value="conforme">Conforme</option>
                        <option value="no_conforme">No conforme</option>
                      </select>
                    </div>
                    {response.response_type === 'check' ? (
                      <label className="flex items-center gap-2 text-sm text-stone-700">
                        <input type="checkbox" checked={!!response.response_bool} onChange={(event) => updateResponse(index, { response_bool: event.target.checked })} />
                        Realizado / validado
                      </label>
                    ) : response.response_type === 'number' ? (
                      <input type="number" value={response.response_number} onChange={(event) => updateResponse(index, { response_number: event.target.value })} className={INPUT} />
                    ) : (
                      <textarea rows={response.response_type === 'long_text' ? 3 : 1} value={response.response_text} onChange={(event) => updateResponse(index, { response_text: event.target.value })} className={INPUT} />
                    )}
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <input placeholder="Observacion" value={response.observation} onChange={(event) => updateResponse(index, { observation: event.target.value })} className={INPUT} />
                      <input placeholder="URL evidencia fotografica" value={response.evidence_url} onChange={(event) => updateResponse(index, { evidence_url: event.target.value })} className={INPUT} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <Field label="Observaciones de cierre">
            <textarea rows={3} value={closeForm.observations} onChange={(event) => setCloseForm((prev) => ({ ...prev, observations: event.target.value }))} className={INPUT} />
          </Field>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCloseModal(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Cerrando...' : 'Cerrar mantenimiento'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
