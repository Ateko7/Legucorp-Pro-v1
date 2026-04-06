import { useEffect, useState, useMemo, useCallback } from 'react'
import Modal from '../../../components/ui/Modal'
import {
  getEmpleados, getEmpleado, createEmpleado, updateEmpleado, darBajaEmpleado,
  getHistorialSalarial, registrarCambioSalarial,
  getParametros, saveParametros,
  getCostCentersForNomina,
} from '../services/empleadosService'
import {
  getPeriodos, createPeriodo, calcularPeriodo, updatePeriodoEstado,
  getNominaDetalle, getNominaDetalleConceptos, calcularResumenPeriodo,
} from '../services/periodosService'
import {
  getMarcaciones, getMarcacionHoy, registrarEntrada, registrarSalida,
  upsertMarcacion, aprobarMarcacion, deleteMarcacion,
  getResumenAsistencia, getJornada, saveJornada,
  calcularHorasDia, calcularHorasTeoricas,
} from '../services/marcacionesService'
import { getSedes, createSede, updateSede, deleteSede } from '../services/sedesService'
import { getKpiTendencia, getKpiResumen, getAlertas, calcularYPersistirKpi } from '../services/costoLaboralService'
import {
  getVacaciones, createVacaciones, updateVacacionesEstado, getSaldoVacaciones,
  getIncapacidades, createIncapacidad, updateIncapacidadEstado,
  getPrestamos, createPrestamo, getMovimientosPrestamo,
  getAnticipos, createAnticipo,
  getLiquidaciones, calcularLiquidacion, aprobarLiquidacion, pagarLiquidacion,
  getPagosNomina, generarLotePago, getDetallePago, marcarPagado, generarArchivoBancario,
  getProvisionesAcumuladas,
} from '../services/modulosService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
function fmt(v, dec = 2) { return n(v).toLocaleString('es-GT', { minimumFractionDigits: dec, maximumFractionDigits: dec }) }
function fmtQ(v) { return `Q ${fmt(v)}` }

const ESTADO_PERIODO_COLOR = {
  borrador:       'bg-stone-100 text-stone-600',
  calculado:      'bg-blue-100 text-blue-700',
  revisado:       'bg-yellow-100 text-yellow-700',
  aprobado:       'bg-emerald-100 text-emerald-700',
  pagado:         'bg-green-100 text-green-800',
  contabilizado:  'bg-purple-100 text-purple-700',
  cerrado:        'bg-stone-200 text-stone-500',
}

const ESTADO_EMP_COLOR = {
  activo:      'bg-emerald-100 text-emerald-800',
  suspendido:  'bg-amber-100 text-amber-700',
  baja:        'bg-red-100 text-red-700',
}

const TABS = [
  { key: 'empleados',    label: 'Empleados' },
  { key: 'marcacion',    label: 'Marcación' },
  { key: 'asistencia',   label: 'Asistencia' },
  { key: 'costo_laboral', label: 'Costo M.O.' },
  { key: 'periodos',     label: 'Períodos' },
  { key: 'calculo',      label: 'Cálculo' },
  { key: 'vacaciones',   label: 'Vacaciones' },
  { key: 'incapacidades',label: 'Incapacidades' },
  { key: 'prestamos',    label: 'Préstamos' },
  { key: 'liquidaciones',label: 'Liquidaciones' },
  { key: 'pagos',        label: 'Pagos' },
  { key: 'reportes',     label: 'Reportes' },
  { key: 'sedes',        label: 'Sedes' },
  { key: 'parametros',   label: 'Parámetros' },
]

// ─── Componentes reutilizables ────────────────────────────────────────────────

function Card({ children, className = '' }) {
  return (
    <div className={`rounded-3xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function KPI({ label, value, sub, color = 'text-stone-800' }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
    </div>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-stone-700">{label}</span>
      {children}
    </label>
  )
}

const INP = 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-700 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-4 focus:ring-emerald-100'

function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-[#2f5d50]" />
}

function Badge({ text, color = 'bg-stone-100 text-stone-600' }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>{text}</span>
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function NominaPage() {
  const [tab, setTab] = useState('empleados')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">ERP · Recursos Humanos</p>
        <h1 className="text-3xl font-semibold text-stone-800">Nómina</h1>
        <p className="mt-1 text-sm text-stone-500">Gestión laboral: empleados, cálculo, provisiones, pagos y más.</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? 'bg-[#2f5d50] text-white'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'empleados'     && <TabEmpleados />}
      {tab === 'marcacion'     && <TabMarcacion />}
      {tab === 'asistencia'    && <TabAsistencia />}
      {tab === 'costo_laboral' && <TabCostoLaboral />}
      {tab === 'periodos'      && <TabPeriodos onCalcular={() => setTab('calculo')} />}
      {tab === 'calculo'       && <TabCalculo />}
      {tab === 'vacaciones'    && <TabVacaciones />}
      {tab === 'incapacidades' && <TabIncapacidades />}
      {tab === 'prestamos'     && <TabPrestamos />}
      {tab === 'liquidaciones' && <TabLiquidaciones />}
      {tab === 'pagos'         && <TabPagos />}
      {tab === 'reportes'      && <TabReportes />}
      {tab === 'sedes'         && <TabSedes />}
      {tab === 'parametros'    && <TabParametros />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: EMPLEADOS
// ══════════════════════════════════════════════════════════════════════════════

const emptyEmpForm = {
  nombres: '', apellidos: '', dpi: '', nit: '', igss_numero: '',
  fecha_nacimiento: '', fecha_ingreso: '', puesto: '', departamento: '',
  centro_costo_id: '', tipo_contrato: 'indefinido', tipo_pago: 'mensual',
  tipo_empleado: 'administrativo', sede_id: '',
  salario_base_actual: '', bonificacion_incentivo_actual: '250',
  afiliado_igss: true, banco: '', tipo_cuenta_bancaria: '', cuenta_bancaria: '',
  correo: '', telefono: '', direccion: '', contacto_emergencia: '', observaciones: '',
  estado_laboral: 'activo',
}

function TabEmpleados() {
  const [empleados, setEmpleados] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const [sedes, setSedes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyEmpForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [historial, setHistorial] = useState([])
  const [showHistorial, setShowHistorial] = useState(false)
  const [showCambioSalarial, setShowCambioSalarial] = useState(false)
  const [cambioForm, setCambioForm] = useState({ salario_base: '', bonificacion_incentivo: '250', tipo_pago: 'mensual', afiliado_igss: true, fecha_inicio: '', observaciones: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, ccs, sds] = await Promise.all([getEmpleados(), getCostCentersForNomina(), getSedes()])
      setEmpleados(emps)
      setCostCenters(ccs)
      setSedes(sds)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() { setForm(emptyEmpForm); setEditingId(null); setError(''); setSuccess(''); setShowModal(true) }
  function openEdit(emp) {
    setForm({
      nombres: emp.nombres || '', apellidos: emp.apellidos || '', dpi: emp.dpi || '',
      nit: emp.nit || '', igss_numero: emp.igss_numero || '',
      fecha_nacimiento: emp.fecha_nacimiento || '', fecha_ingreso: emp.fecha_ingreso || '',
      puesto: emp.puesto || '', departamento: emp.departamento || '',
      centro_costo_id: emp.centro_costo_id || '', tipo_contrato: emp.tipo_contrato || 'indefinido',
      tipo_pago: emp.tipo_pago || 'mensual',
      tipo_empleado: emp.tipo_empleado || 'administrativo',
      sede_id: emp.sede_id || '',
      salario_base_actual: String(emp.salario_base_actual || ''),
      bonificacion_incentivo_actual: String(emp.bonificacion_incentivo_actual || '250'),
      afiliado_igss: emp.afiliado_igss !== false,
      banco: emp.banco || '', tipo_cuenta_bancaria: emp.tipo_cuenta_bancaria || '',
      cuenta_bancaria: emp.cuenta_bancaria || '', correo: emp.correo || '',
      telefono: emp.telefono || '', direccion: emp.direccion || '',
      contacto_emergencia: emp.contacto_emergencia || '', observaciones: emp.observaciones || '',
      estado_laboral: emp.estado_laboral || 'activo',
    })
    setEditingId(emp.id); setError(''); setSuccess(''); setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      if (editingId) { await updateEmpleado(editingId, form); setSuccess('Empleado actualizado.') }
      else { await createEmpleado(form); setSuccess('Empleado registrado.') }
      await load(); setTimeout(() => setShowModal(false), 700)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function openHistorial(emp) {
    setSelectedEmp(emp)
    try { const h = await getHistorialSalarial(emp.id); setHistorial(h) } catch {}
    setCambioForm({ salario_base: String(emp.salario_base_actual), bonificacion_incentivo: String(emp.bonificacion_incentivo_actual), tipo_pago: emp.tipo_pago, afiliado_igss: emp.afiliado_igss, fecha_inicio: new Date().toISOString().slice(0, 10), observaciones: '' })
    setShowHistorial(true)
  }

  async function handleCambioSalarial(e) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      await registrarCambioSalarial(selectedEmp.id, cambioForm)
      const h = await getHistorialSalarial(selectedEmp.id)
      setHistorial(h); await load()
      setShowCambioSalarial(false); setSuccess('Cambio salarial registrado.')
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const filtered = useMemo(() => {
    const t = search.toLowerCase()
    return empleados.filter(e =>
      (!filtroEstado || e.estado_laboral === filtroEstado) &&
      (!t || [e.nombre_completo, e.codigo_empleado, e.puesto, e.departamento].some(s => s?.toLowerCase().includes(t)))
    )
  }, [empleados, search, filtroEstado])

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <KPI label="Activos" value={empleados.filter(e => e.estado_laboral === 'activo').length} color="text-emerald-700" />
        <KPI label="Suspendidos" value={empleados.filter(e => e.estado_laboral === 'suspendido').length} color="text-amber-600" />
        <KPI label="En baja" value={empleados.filter(e => e.estado_laboral === 'baja').length} color="text-red-600" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 gap-3">
            <input placeholder="Buscar empleado..." value={search} onChange={e => setSearch(e.target.value)} className={`${INP} max-w-xs`} />
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className={`${INP} max-w-[140px]`}>
              <option value="">Todos</option>
              <option value="activo">Activos</option>
              <option value="suspendido">Suspendidos</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <button onClick={openNew} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#264c42]">+ Nuevo empleado</button>
        </div>

        {error && <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {loading ? <div className="py-12 text-center"><Spinner /></div> : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-400">No hay empleados.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {filtered.map(emp => (
              <div key={emp.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-stone-800">{emp.nombre_completo || `${emp.apellidos}, ${emp.nombres}`}</span>
                    <Badge text={emp.estado_laboral} color={ESTADO_EMP_COLOR[emp.estado_laboral]} />
                    {emp.tipo_empleado === 'operario' && <Badge text="Operario" color="bg-blue-100 text-blue-700" />}
                    {emp.tipo_empleado === 'supervisor' && <Badge text="Supervisor" color="bg-purple-100 text-purple-700" />}
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {emp.codigo_empleado} · {emp.puesto || '—'} · {emp.departamento || '—'}
                    {emp.sedes_trabajo ? ` · Sede: ${emp.sedes_trabajo.nombre}` : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    Salario: {fmtQ(emp.salario_base_actual)} + Bono: {fmtQ(emp.bonificacion_incentivo_actual)} · Ingreso: {emp.fecha_ingreso}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => openHistorial(emp)} className="rounded-xl border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">Salario</button>
                  <button onClick={() => openEdit(emp)} className="rounded-xl border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">Editar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Modal empleado */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Editar empleado' : 'Nuevo empleado'} maxWidth="max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Nombres *"><input name="nombres" value={form.nombres} onChange={e => setForm(p => ({...p, nombres: e.target.value}))} required className={INP} /></Field>
            <Field label="Apellidos *"><input name="apellidos" value={form.apellidos} onChange={e => setForm(p => ({...p, apellidos: e.target.value}))} required className={INP} /></Field>
            <Field label="DPI"><input value={form.dpi} onChange={e => setForm(p => ({...p, dpi: e.target.value}))} className={INP} /></Field>
            <Field label="NIT"><input value={form.nit} onChange={e => setForm(p => ({...p, nit: e.target.value}))} className={INP} /></Field>
            <Field label="No. IGSS"><input value={form.igss_numero} onChange={e => setForm(p => ({...p, igss_numero: e.target.value}))} className={INP} /></Field>
            <Field label="Fecha nacimiento"><input type="date" value={form.fecha_nacimiento} onChange={e => setForm(p => ({...p, fecha_nacimiento: e.target.value}))} className={INP} /></Field>
            <Field label="Fecha ingreso *"><input type="date" value={form.fecha_ingreso} onChange={e => setForm(p => ({...p, fecha_ingreso: e.target.value}))} required className={INP} /></Field>
            <Field label="Puesto"><input value={form.puesto} onChange={e => setForm(p => ({...p, puesto: e.target.value}))} className={INP} /></Field>
            <Field label="Departamento"><input value={form.departamento} onChange={e => setForm(p => ({...p, departamento: e.target.value}))} className={INP} /></Field>
            <Field label="Centro de costo">
              <select value={form.centro_costo_id} onChange={e => setForm(p => ({...p, centro_costo_id: e.target.value}))} className={INP}>
                <option value="">Sin centro de costo</option>
                {costCenters.map(cc => <option key={cc.id} value={cc.id}>{cc.code} – {cc.name}</option>)}
              </select>
            </Field>
            <Field label="Tipo contrato">
              <select value={form.tipo_contrato} onChange={e => setForm(p => ({...p, tipo_contrato: e.target.value}))} className={INP}>
                <option value="indefinido">Indefinido</option>
                <option value="temporal">Temporal</option>
                <option value="prueba">Período de prueba</option>
                <option value="honorarios">Honorarios</option>
              </select>
            </Field>
            <Field label="Tipo pago">
              <select value={form.tipo_pago} onChange={e => setForm(p => ({...p, tipo_pago: e.target.value}))} className={INP}>
                <option value="mensual">Mensual</option>
                <option value="quincenal">Quincenal</option>
                <option value="semanal">Semanal</option>
              </select>
            </Field>
            <Field label="Tipo empleado">
              <select value={form.tipo_empleado} onChange={e => setForm(p => ({...p, tipo_empleado: e.target.value}))} className={INP}>
                <option value="administrativo">Administrativo</option>
                <option value="operario">Operario de planta</option>
                <option value="supervisor">Supervisor</option>
              </select>
            </Field>
            {form.tipo_empleado === 'operario' && (
              <Field label="Sede de trabajo">
                <select value={form.sede_id} onChange={e => setForm(p => ({...p, sede_id: e.target.value}))} className={INP}>
                  <option value="">Sin sede asignada</option>
                  {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Field>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Salario base (Q) *"><input type="number" step="0.01" value={form.salario_base_actual} onChange={e => setForm(p => ({...p, salario_base_actual: e.target.value}))} required className={INP} /></Field>
            <Field label="Bonificación incentivo (Q)"><input type="number" step="0.01" value={form.bonificacion_incentivo_actual} onChange={e => setForm(p => ({...p, bonificacion_incentivo_actual: e.target.value}))} className={INP} /></Field>
            <Field label="Afiliado IGSS">
              <div className="flex h-[42px] items-center gap-3 rounded-2xl border border-stone-300 bg-stone-50 px-4">
                <input type="checkbox" checked={form.afiliado_igss} onChange={e => setForm(p => ({...p, afiliado_igss: e.target.checked}))} className="h-4 w-4 accent-[#2f5d50]" />
                <span className="text-sm text-stone-700">Sí, cotiza IGSS</span>
              </div>
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Banco"><input value={form.banco} onChange={e => setForm(p => ({...p, banco: e.target.value}))} className={INP} /></Field>
            <Field label="Tipo cuenta">
              <select value={form.tipo_cuenta_bancaria} onChange={e => setForm(p => ({...p, tipo_cuenta_bancaria: e.target.value}))} className={INP}>
                <option value="">—</option>
                <option value="monetaria">Monetaria</option>
                <option value="ahorro">Ahorro</option>
                <option value="planilla">Planilla</option>
              </select>
            </Field>
            <Field label="No. cuenta"><input value={form.cuenta_bancaria} onChange={e => setForm(p => ({...p, cuenta_bancaria: e.target.value}))} className={INP} /></Field>
            <Field label="Correo"><input type="email" value={form.correo} onChange={e => setForm(p => ({...p, correo: e.target.value}))} className={INP} /></Field>
            <Field label="Teléfono"><input value={form.telefono} onChange={e => setForm(p => ({...p, telefono: e.target.value}))} className={INP} /></Field>
            <Field label="Estado">
              <select value={form.estado_laboral} onChange={e => setForm(p => ({...p, estado_laboral: e.target.value}))} className={INP}>
                <option value="activo">Activo</option>
                <option value="suspendido">Suspendido</option>
                <option value="baja">Baja</option>
              </select>
            </Field>
          </div>

          <Field label="Dirección"><textarea rows={2} value={form.direccion} onChange={e => setForm(p => ({...p, direccion: e.target.value}))} className={INP} /></Field>
          <Field label="Observaciones"><textarea rows={2} value={form.observaciones} onChange={e => setForm(p => ({...p, observaciones: e.target.value}))} className={INP} /></Field>

          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}
          <div className="flex justify-end gap-3 border-t border-stone-200 pt-4">
            <button type="button" onClick={() => setShowModal(false)} className="rounded-2xl border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">{saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>

      {/* Modal historial salarial */}
      <Modal isOpen={showHistorial} onClose={() => setShowHistorial(false)} title={`Historial salarial — ${selectedEmp?.nombre_completo}`} maxWidth="max-w-2xl">
        <div className="space-y-4">
          <button onClick={() => setShowCambioSalarial(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">+ Registrar cambio salarial</button>
          {historial.length === 0 ? <div className="text-center text-sm text-stone-400 py-6">Sin historial</div> : (
            <div className="divide-y divide-stone-100">
              {historial.map(h => (
                <div key={h.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-800">{fmtQ(h.salario_base)} + {fmtQ(h.bonificacion_incentivo)} bono</span>
                    <span className="text-xs text-stone-400">{h.fecha_inicio} → {h.fecha_fin || 'vigente'}</span>
                  </div>
                  {h.observaciones && <div className="text-xs text-stone-500 mt-0.5">{h.observaciones}</div>}
                </div>
              ))}
            </div>
          )}
          {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}
        </div>
      </Modal>

      {/* Modal cambio salarial */}
      <Modal isOpen={showCambioSalarial} onClose={() => setShowCambioSalarial(false)} title="Registrar cambio salarial" maxWidth="max-w-md">
        <form onSubmit={handleCambioSalarial} className="space-y-4">
          <Field label="Nuevo salario base (Q) *"><input type="number" step="0.01" value={cambioForm.salario_base} onChange={e => setCambioForm(p => ({...p, salario_base: e.target.value}))} required className={INP} /></Field>
          <Field label="Bonificación incentivo (Q)"><input type="number" step="0.01" value={cambioForm.bonificacion_incentivo} onChange={e => setCambioForm(p => ({...p, bonificacion_incentivo: e.target.value}))} className={INP} /></Field>
          <Field label="Vigente desde *"><input type="date" value={cambioForm.fecha_inicio} onChange={e => setCambioForm(p => ({...p, fecha_inicio: e.target.value}))} required className={INP} /></Field>
          <Field label="Observaciones"><textarea rows={2} value={cambioForm.observaciones} onChange={e => setCambioForm(p => ({...p, observaciones: e.target.value}))} className={INP} /></Field>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCambioSalarial(false)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: MARCACIÓN DIARIA
// ══════════════════════════════════════════════════════════════════════════════

const MARC_ESTADO_COLOR = {
  completa:            'bg-emerald-100 text-emerald-800',
  aprobada:            'bg-green-100 text-green-800',
  incompleta:          'bg-amber-100 text-amber-700',
  pendiente_revision:  'bg-red-100 text-red-700',
}

function TabMarcacion() {
  const [empleados, setEmpleados]   = useState([])
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [marcHoy, setMarcHoy]       = useState(null)
  const [marcaciones, setMarcaciones] = useState([])
  const [loading, setLoading]       = useState(false)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualForm, setManualForm] = useState({ empleado_id: '', fecha: new Date().toISOString().slice(0,10), hora_entrada: '', hora_salida: '', observaciones: '' })
  const [now, setNow]               = useState(new Date())

  // Reloj en tiempo real
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    getEmpleados({ estado: 'activo' }).then(setEmpleados).catch(() => {})
  }, [])

  async function cargarMarcacion(empId) {
    if (!empId) return
    setLoading(true)
    try {
      const [hoy, lista] = await Promise.all([
        getMarcacionHoy(empId),
        getMarcaciones({ empleadoId: empId, fechaInicio: new Date(Date.now() - 14*86400000).toISOString().slice(0,10) }),
      ])
      setMarcHoy(hoy)
      setMarcaciones(lista)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  function selectEmp(emp) {
    setSelectedEmp(emp)
    setError('')
    setSuccess('')
    cargarMarcacion(emp.id)
  }

  async function handleEntrada() {
    if (!selectedEmp) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const m = await registrarEntrada(selectedEmp.id)
      setMarcHoy(m)
      setSuccess(`Entrada registrada a las ${m.hora_entrada?.slice(0,5)}`)
      cargarMarcacion(selectedEmp.id)
    } catch(e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function handleSalida() {
    if (!selectedEmp) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const m = await registrarSalida(selectedEmp.id)
      setMarcHoy(m)
      setSuccess(`Salida registrada a las ${m.hora_salida?.slice(0,5)} — ${m.horas_trabajadas}h trabajadas`)
      cargarMarcacion(selectedEmp.id)
    } catch(e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function handleManual(e) {
    e.preventDefault(); setBusy(true); setError(''); setSuccess('')
    try {
      await upsertMarcacion(manualForm)
      setSuccess('Marcación guardada correctamente')
      setShowManual(false)
      if (selectedEmp?.id === manualForm.empleado_id) cargarMarcacion(selectedEmp.id)
    } catch(e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar esta marcación?')) return
    try {
      await deleteMarcacion(id)
      setMarcaciones(m => m.filter(x => x.id !== id))
      if (marcHoy?.id === id) setMarcHoy(null)
    } catch(e) { setError(e.message) }
  }

  const horasHoy = marcHoy?.hora_entrada && marcHoy?.hora_salida
    ? Number(marcHoy.horas_trabajadas || 0).toFixed(2)
    : marcHoy?.hora_entrada
    ? ((now - new Date(`${marcHoy.fecha}T${marcHoy.hora_entrada}`)) / 3600000).toFixed(2)
    : null

  return (
    <div className="space-y-6">
      {/* Reloj y selector de empleado */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="flex flex-col items-center justify-center py-8">
          <p className="text-5xl font-bold tabular-nums text-stone-800">{now.toTimeString().slice(0,8)}</p>
          <p className="mt-1 text-sm text-stone-400">{now.toLocaleDateString('es-GT', { weekday:'long', day:'numeric', month:'long' })}</p>
        </Card>

        <Card className="md:col-span-2 space-y-4">
          <p className="text-sm font-semibold text-stone-600">Seleccionar colaborador</p>
          <select className={INP} value={selectedEmp?.id || ''} onChange={e => {
            const emp = empleados.find(x => x.id === e.target.value)
            if (emp) selectEmp(emp); else { setSelectedEmp(null); setMarcHoy(null); setMarcaciones([]) }
          }}>
            <option value="">-- Seleccionar --</option>
            {empleados.map(e => (
              <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres} ({e.codigo_empleado})</option>
            ))}
          </select>

          {selectedEmp && (
            <div className="rounded-2xl bg-stone-50 p-4 text-sm space-y-1">
              <p className="font-semibold text-stone-800">{selectedEmp.nombres} {selectedEmp.apellidos}</p>
              <p className="text-stone-500">{selectedEmp.puesto || '—'}</p>
              {marcHoy && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <span>Entrada: <strong>{marcHoy.hora_entrada?.slice(0,5) || '—'}</strong></span>
                  <span>Salida: <strong>{marcHoy.hora_salida?.slice(0,5) || '—'}</strong></span>
                  {horasHoy && <span>Horas: <strong>{horasHoy}h</strong></span>}
                  <Badge text={marcHoy.estado?.replace('_',' ')} color={MARC_ESTADO_COLOR[marcHoy.estado] || ''} />
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {error   && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}

      {/* Botones de marcación */}
      {selectedEmp && (
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleEntrada}
            disabled={busy || !!marcHoy?.hora_entrada}
            className="rounded-3xl bg-emerald-600 py-5 text-xl font-bold text-white shadow transition hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? '...' : 'ENTRADA'}
          </button>
          <button
            onClick={handleSalida}
            disabled={busy || !marcHoy?.hora_entrada || !!marcHoy?.hora_salida}
            className="rounded-3xl bg-[#2f5d50] py-5 text-xl font-bold text-white shadow transition hover:bg-[#264d42] disabled:opacity-40"
          >
            {busy ? '...' : 'SALIDA'}
          </button>
        </div>
      )}

      {/* Controles */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-600">
          {selectedEmp ? `Últimas marcaciones — ${selectedEmp.nombres}` : 'Marcaciones recientes'}
        </p>
        <button onClick={() => setShowManual(true)} className="rounded-2xl border border-stone-300 px-3 py-1.5 text-xs font-semibold hover:bg-stone-50">
          + Ingresar manual
        </button>
      </div>

      {/* Tabla de marcaciones */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs font-semibold uppercase text-stone-500">
              <tr>
                {['Empleado','Fecha','Día','Entrada','Salida','H. Trabajadas','H. Teóricas','Exceso','Estado',''].map(h => (
                  <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {marcaciones.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-stone-400">Sin marcaciones</td></tr>
              )}
              {marcaciones.map(m => {
                const dow = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][new Date(m.fecha+'T12:00:00').getDay()]
                return (
                  <tr key={m.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {m.empleados ? `${m.empleados.apellidos}, ${m.empleados.nombres}` : '—'}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">{m.fecha}</td>
                    <td className="px-4 py-2 text-center text-stone-500 text-xs">{dow}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.hora_entrada?.slice(0,5) || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.hora_salida?.slice(0,5) || '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {m.horas_trabajadas != null ? Number(m.horas_trabajadas).toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">
                      {Number(m.horas_normales_teoricas_dia).toFixed(0)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600 font-semibold">
                      {n(m.exceso_dia) > 0 ? `+${Number(m.exceso_dia).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge text={m.estado?.replace('_',' ')} color={MARC_ESTADO_COLOR[m.estado] || ''} />
                    </td>
                    <td className="px-4 py-2">
                      <button onClick={() => handleDelete(m.id)} className="text-xs text-red-500 hover:underline">Eliminar</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modal marcación manual */}
      {showManual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-stone-800">Marcación manual</h3>
            <form onSubmit={handleManual} className="space-y-3">
              <Field label="Empleado">
                <select className={INP} value={manualForm.empleado_id}
                  onChange={e => setManualForm(f => ({...f, empleado_id: e.target.value}))} required>
                  <option value="">-- Seleccionar --</option>
                  {empleados.map(e => <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres}</option>)}
                </select>
              </Field>
              <Field label="Fecha">
                <input type="date" className={INP} value={manualForm.fecha}
                  onChange={e => setManualForm(f => ({...f, fecha: e.target.value}))} required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hora entrada">
                  <input type="time" className={INP} value={manualForm.hora_entrada}
                    onChange={e => setManualForm(f => ({...f, hora_entrada: e.target.value}))} />
                </Field>
                <Field label="Hora salida">
                  <input type="time" className={INP} value={manualForm.hora_salida}
                    onChange={e => setManualForm(f => ({...f, hora_salida: e.target.value}))} />
                </Field>
              </div>
              <Field label="Observaciones">
                <input type="text" className={INP} value={manualForm.observaciones}
                  onChange={e => setManualForm(f => ({...f, observaciones: e.target.value}))} />
              </Field>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={busy} className="flex-1 rounded-2xl bg-[#2f5d50] py-2 text-sm font-semibold text-white hover:bg-[#264d42] disabled:opacity-40">
                  {busy ? '...' : 'Guardar'}
                </button>
                <button type="button" onClick={() => setShowManual(false)} className="flex-1 rounded-2xl border py-2 text-sm font-semibold">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: CONTROL DE ASISTENCIA
// ══════════════════════════════════════════════════════════════════════════════

function TabAsistencia() {
  const hoy   = new Date().toISOString().slice(0,10)
  const q1ini = hoy.slice(0,8) + '01'
  const q1fin = hoy.slice(0,8) + '15'
  const q2fin = new Date(new Date(hoy).getFullYear(), new Date(hoy).getMonth()+1, 0).toISOString().slice(0,10)

  const [fechaIni, setFechaIni] = useState(hoy <= q1fin ? q1ini : hoy.slice(0,8)+'16')
  const [fechaFin, setFechaFin] = useState(hoy <= q1fin ? q1fin : q2fin)
  const [empFiltro, setEmpFiltro] = useState('')
  const [resumen, setResumen]   = useState([])
  const [marcaciones, setMarcaciones] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [jornada, setJornada]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [viewMode, setViewMode] = useState('resumen') // 'resumen' | 'detalle'
  const [error, setError]       = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [r, emps, j] = await Promise.all([
        getResumenAsistencia(fechaIni, fechaFin),
        getEmpleados({ estado: 'activo' }),
        getJornada(),
      ])
      setResumen(r)
      setEmpleados(emps)
      setJornada(j)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }, [fechaIni, fechaFin])

  useEffect(() => { load() }, [load])

  async function loadDetalle() {
    setLoading(true)
    try {
      const data = await getMarcaciones({ fechaInicio: fechaIni, fechaFin, empleadoId: empFiltro || undefined })
      setMarcaciones(data)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleAprobar(id) {
    try {
      await aprobarMarcacion(id)
      setMarcaciones(ms => ms.map(m => m.id === id ? {...m, estado:'aprobada'} : m))
    } catch(e) { setError(e.message) }
  }

  // Calcular horas teóricas del período para el resumen
  const calcInfo = jornada ? calcularHorasTeoricas(fechaIni, fechaFin, jornada) : null

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1 text-xs font-medium text-stone-500">Desde</p>
            <input type="date" className={INP + ' w-36'} value={fechaIni} onChange={e => setFechaIni(e.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-stone-500">Hasta</p>
            <input type="date" className={INP + ' w-36'} value={fechaFin} onChange={e => setFechaFin(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setViewMode('resumen'); load() }} className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${viewMode==='resumen' ? 'bg-[#2f5d50] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
              Resumen
            </button>
            <button onClick={() => { setViewMode('detalle'); loadDetalle() }} className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${viewMode==='detalle' ? 'bg-[#2f5d50] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
              Detalle
            </button>
          </div>
          {viewMode === 'detalle' && (
            <select className={INP + ' w-56'} value={empFiltro} onChange={e => setEmpFiltro(e.target.value)}>
              <option value="">Todos los empleados</option>
              {empleados.map(e => <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres}</option>)}
            </select>
          )}
        </div>
      </Card>

      {/* Info de período */}
      {calcInfo && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPI label="Días L-V" value={calcInfo.diasNormales} sub="×9 hrs" />
          <KPI label="Sábados" value={calcInfo.sabados} sub="×4 hrs" />
          <KPI label="Horas teóricas" value={`${calcInfo.horasTeoricas}h`} color="text-[#2f5d50]" />
          <KPI label="Período" value={`${fechaIni} → ${fechaFin}`} sub="" />
        </div>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : viewMode === 'resumen' ? (
        /* ── Vista resumen por empleado ─────────────────────────────── */
        <Card className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs font-semibold uppercase text-stone-500">
              <tr>
                {['Empleado','Código','Días reg.','H. Trabajadas','H. Extra','Días incompletos','Días en revisión'].map(h => (
                  <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {resumen.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-stone-400">Sin datos en el período</td></tr>
              )}
              {resumen.map((r, i) => (
                <tr key={i} className="hover:bg-stone-50">
                  <td className="px-4 py-2 font-medium text-stone-800">
                    {r.empleado?.apellidos}, {r.empleado?.nombres}
                  </td>
                  <td className="px-4 py-2 text-stone-500 text-xs">{r.empleado?.codigo_empleado}</td>
                  <td className="px-4 py-2 text-center">{r.diasRegistrados}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {r.horasTrabajadas.toFixed(2)}h
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-amber-600 font-semibold">
                    {r.horasExtra > 0 ? `+${r.horasExtra.toFixed(2)}h` : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {r.diasIncompletos > 0
                      ? <Badge text={String(r.diasIncompletos)} color="bg-amber-100 text-amber-700" />
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {r.diasPendientes > 0
                      ? <Badge text={String(r.diasPendientes)} color="bg-red-100 text-red-700" />
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        /* ── Vista detalle de marcaciones ───────────────────────────── */
        <Card className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs font-semibold uppercase text-stone-500">
              <tr>
                {['Empleado','Fecha','Día','Entrada','Salida','H.Trab','H.Teór','Exceso','Estado',''].map(h => (
                  <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {marcaciones.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-stone-400">Sin marcaciones</td></tr>
              )}
              {marcaciones.map(m => {
                const dow = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][new Date(m.fecha+'T12:00:00').getDay()]
                return (
                  <tr key={m.id} className={`hover:bg-stone-50 ${m.estado==='pendiente_revision'?'bg-red-50':''}`}>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                      {m.empleados?.apellidos}, {m.empleados?.nombres}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{m.fecha}</td>
                    <td className="px-4 py-2 text-center text-stone-500 text-xs">{dow}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.hora_entrada?.slice(0,5)||'—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.hora_salida?.slice(0,5)||'—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">
                      {m.horas_trabajadas!=null ? Number(m.horas_trabajadas).toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">
                      {Number(m.horas_normales_teoricas_dia).toFixed(0)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600 font-semibold">
                      {n(m.exceso_dia)>0 ? `+${Number(m.exceso_dia).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge text={m.estado?.replace('_',' ')} color={MARC_ESTADO_COLOR[m.estado]||''} />
                    </td>
                    <td className="px-4 py-2">
                      {m.estado==='pendiente_revision' && (
                        <button onClick={() => handleAprobar(m.id)} className="text-xs text-emerald-600 font-semibold hover:underline">
                          Aprobar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: COSTO DE MANO DE OBRA DIARIO
// ══════════════════════════════════════════════════════════════════════════════

const NIVEL_COLOR = {
  error:   'bg-red-50 border-red-200 text-red-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  info:    'bg-blue-50 border-blue-200 text-blue-700',
}

const TENDENCIA_CONFIG = {
  bajo:      { label: '↓ Por debajo del promedio', color: 'text-emerald-600' },
  alto:      { label: '↑ Por encima del promedio', color: 'text-red-600' },
  normal:    { label: '→ Dentro del promedio', color: 'text-stone-600' },
  sin_datos: { label: '— Sin datos suficientes', color: 'text-stone-400' },
}

function MiniBar({ value, max, color = 'bg-[#2f5d50]' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-stone-100">
      <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function TabCostoLaboral() {
  const hoy = new Date().toISOString().slice(0, 10)
  const [dias, setDias]         = useState(14)
  const [resumen, setResumen]   = useState(null)
  const [alertas, setAlertas]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [recalcFecha, setRecalcFecha] = useState(hoy)
  const [recalcBusy, setRecalcBusy]   = useState(false)
  const [recalcMsg, setRecalcMsg]     = useState('')
  const [error, setError]       = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [r, a] = await Promise.all([getKpiResumen(dias), getAlertas()])
      setResumen(r)
      setAlertas(a)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [dias])

  useEffect(() => { load() }, [load])

  async function handleRecalc() {
    setRecalcBusy(true); setRecalcMsg('')
    try {
      const { getProfile } = await import('../services/nominaCore')
      const p = await getProfile()
      await calcularYPersistirKpi(recalcFecha, p.organization_id)
      setRecalcMsg('KPI recalculado correctamente')
      await load()
    } catch (e) { setRecalcMsg('Error: ' + e.message) }
    finally { setRecalcBusy(false) }
  }

  const tendencia = resumen?.tendencia || []
  const maxKpi  = Math.max(...tendencia.map(d => n(d.costo_mano_obra_por_libra || 0)), 0.001)
  const maxLib  = Math.max(...tendencia.map(d => n(d.libras_producidas_dia || 0)), 0.001)
  const maxCost = Math.max(...tendencia.map(d => n(d.costo_laboral_total_dia || 0)), 0.001)

  const hoyData = tendencia.find(d => d.fecha === hoy)

  return (
    <div className="space-y-6">

      {/* Alertas */}
      {alertas.map((a, i) => (
        <div key={i} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${NIVEL_COLOR[a.nivel]}`}>
          <span className="text-base">{a.nivel==='error'?'🔴':a.nivel==='warning'?'⚠️':'ℹ️'}</span>
          <div>
            <p className="font-semibold">{a.mensaje}</p>
            {a.detalle && <p className="text-xs opacity-80 mt-0.5">{a.detalle}</p>}
          </div>
        </div>
      ))}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {/* KPI de hoy */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPI
              label="Costo MO/lb hoy"
              value={hoyData?.costo_mano_obra_por_libra != null ? `Q ${fmt(hoyData.costo_mano_obra_por_libra)}` : '—'}
              color={hoyData?.costo_mano_obra_por_libra != null ? 'text-[#2f5d50]' : 'text-stone-400'}
              sub={resumen?.promedio7d ? `Prom 7d: Q ${fmt(resumen.promedio7d)}` : 'Sin promedio'}
            />
            <KPI
              label="Costo laboral hoy"
              value={hoyData ? fmtQ(hoyData.costo_laboral_total_dia) : '—'}
              sub={hoyData ? `${hoyData.total_colaboradores_marcados} colaboradores` : ''}
            />
            <KPI
              label="Libras producidas hoy"
              value={hoyData ? `${fmt(hoyData.libras_producidas_dia)} lb` : '—'}
              color="text-stone-700"
              sub={hoyData?.runs_produccion ? `${hoyData.runs_produccion} runs` : ''}
            />
            <KPI
              label="Tendencia 7 días"
              value={TENDENCIA_CONFIG[resumen?.tendencia7d ?? 'sin_datos']?.label || '—'}
              color={TENDENCIA_CONFIG[resumen?.tendencia7d ?? 'sin_datos']?.color}
              sub={resumen?.promedio30d ? `Prom 30d: Q ${fmt(resumen.promedio30d)}` : ''}
            />
          </div>

          {/* Stats extra */}
          <div className="grid gap-3 sm:grid-cols-3">
            <KPI label="Promedio 7 días" value={resumen?.promedio7d != null ? `Q ${fmt(resumen.promedio7d)}/lb` : '—'} />
            <KPI label="Promedio 30 días" value={resumen?.promedio30d != null ? `Q ${fmt(resumen.promedio30d)}/lb` : '—'} />
            <KPI
              label="Inconsistencias"
              value={resumen?.diasConInconsistencia || 0}
              color={resumen?.diasConInconsistencia > 0 ? 'text-amber-600' : 'text-emerald-600'}
              sub={`Días sin prod: ${resumen?.diasSinProduccion || 0} · Sin marc: ${resumen?.diasSinMarcacion || 0}`}
            />
          </div>

          {/* Selector de rango + Recalcular manual */}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-1 text-xs font-medium text-stone-500">Mostrar últimos</p>
              <div className="flex gap-2">
                {[7,14,30].map(d => (
                  <button key={d} onClick={() => setDias(d)}
                    className={`rounded-2xl px-4 py-1.5 text-sm font-semibold transition ${dias===d ? 'bg-[#2f5d50] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-stone-500">Recalcular KPI manualmente</p>
              <div className="flex gap-2">
                <input type="date" value={recalcFecha} onChange={e => setRecalcFecha(e.target.value)}
                  className={INP + ' w-36'} />
                <button onClick={handleRecalc} disabled={recalcBusy}
                  className="rounded-2xl bg-stone-700 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50">
                  {recalcBusy ? '...' : 'Recalcular'}
                </button>
              </div>
              {recalcMsg && <p className="mt-1 text-xs text-stone-500">{recalcMsg}</p>}
            </div>
          </div>

          {/* Tabla de tendencia */}
          <Card className="overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase text-stone-500">
                <tr>
                  {['Fecha','Día','MO/lb','vs avg','Lb producidas','Costo laboral','H. Trabajadas','H. Extra','Colaboradores','Inconsistencia'].map(h => (
                    <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {tendencia.length === 0 && (
                  <tr><td colSpan={10} className="py-8 text-center text-stone-400">Sin datos. Registra marcaciones y producción para generar el KPI.</td></tr>
                )}
                {tendencia.slice().reverse().map(d => {
                  const dow = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][new Date(d.fecha+'T12:00:00').getDay()]
                  const kpi = n(d.costo_mano_obra_por_libra)
                  const vs  = resumen?.promedio7d ? kpi / resumen.promedio7d : null
                  const kpiColor = !kpi ? 'text-stone-300'
                    : vs != null && vs > 1.1 ? 'text-red-600 font-bold'
                    : vs != null && vs < 0.9 ? 'text-emerald-600 font-bold'
                    : 'text-stone-800'
                  const esHoy = d.fecha === hoy
                  return (
                    <tr key={d.fecha} className={`hover:bg-stone-50 transition ${esHoy ? 'bg-emerald-50/40' : ''}`}>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {d.fecha}{esHoy && <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">HOY</span>}
                      </td>
                      <td className="px-4 py-2 text-stone-500 text-xs">{dow}</td>
                      <td className={`px-4 py-2 tabular-nums ${kpiColor}`}>
                        {kpi > 0 ? `Q ${fmt(kpi)}` : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {kpi > 0 && resumen?.promedio7d ? (
                          <div className="w-16">
                            <MiniBar value={kpi} max={maxKpi}
                              color={vs > 1.05 ? 'bg-red-400' : vs < 0.95 ? 'bg-emerald-500' : 'bg-stone-400'} />
                            <p className="text-[10px] text-stone-400">{vs > 0 ? `${Math.round(vs*100)}%` : ''}</p>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {n(d.libras_producidas_dia) > 0 ? (
                          <div>
                            <p>{fmt(d.libras_producidas_dia)} lb</p>
                            <MiniBar value={n(d.libras_producidas_dia)} max={maxLib} color="bg-blue-400" />
                          </div>
                        ) : <span className="text-stone-300">0</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {n(d.costo_laboral_total_dia) > 0 ? (
                          <div>
                            <p>{fmtQ(d.costo_laboral_total_dia)}</p>
                            <MiniBar value={n(d.costo_laboral_total_dia)} max={maxCost} color="bg-amber-400" />
                          </div>
                        ) : <span className="text-stone-300">Q 0</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-stone-600">
                        {n(d.total_horas_trabajadas) > 0 ? `${fmt(d.total_horas_trabajadas)}h` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-amber-600">
                        {n(d.total_horas_extra_preliminares) > 0 ? `+${fmt(d.total_horas_extra_preliminares)}h` : '—'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {n(d.total_colaboradores_marcados) > 0 ? d.total_colaboradores_marcados : '—'}
                      </td>
                      <td className="px-4 py-2 max-w-[200px]">
                        {d.observacion_inconsistencia
                          ? <span className="text-xs text-amber-600">⚠ {d.observacion_inconsistencia}</span>
                          : <span className="text-stone-300 text-xs">—</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: PERÍODOS
// ══════════════════════════════════════════════════════════════════════════════

function TabPeriodos({ onCalcular }) {
  const [periodos, setPeriodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ nombre: '', fecha_inicio: '', fecha_fin: '', tipo_periodo: 'quincenal', fecha_pago: '', observaciones: '' })
  const [preview, setPreview] = useState(null) // preview de horas teóricas
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [calculando, setCalculando] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setPeriodos(await getPeriodos()) } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(e) {
    e.preventDefault(); setSaving(true); setError('')
    try { await createPeriodo(form); await load(); setShowModal(false); setPreview(null) }
    catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function previewHoras() {
    if (!form.fecha_inicio || !form.fecha_fin || form.tipo_periodo !== 'quincenal') { setPreview(null); return }
    try {
      const j = await getJornada()
      setPreview(calcularHorasTeoricas(form.fecha_inicio, form.fecha_fin, j))
    } catch(e) { setPreview(null) }
  }

  async function handleCalcular(p) {
    setCalculando(p.id)
    try { await calcularPeriodo(p.id); await load() }
    catch (e) { setError(e.message) }
    finally { setCalculando(null) }
  }

  async function handleEstado(p, estado) {
    try { await updatePeriodoEstado(p.id, estado); await load() }
    catch (e) { setError(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-stone-800">Períodos de nómina</h2>
        <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Nuevo período</button>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? <div className="py-12 text-center"><Spinner /></div> : (
        <Card>
          <div className="divide-y divide-stone-100">
            {periodos.length === 0 && <div className="py-8 text-center text-sm text-stone-400">No hay períodos creados.</div>}
            {periodos.map(p => (
              <div key={p.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-stone-800">{p.nombre}</span>
                    <Badge text={p.estado} color={ESTADO_PERIODO_COLOR[p.estado]} />
                    <Badge text={p.tipo_periodo} color="bg-stone-100 text-stone-500" />
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {p.fecha_inicio} → {p.fecha_fin}
                    {p.horas_teoricas != null && ` · ${p.horas_teoricas}h teóricas (${p.dias_normales}d + ${p.sabados}sáb)`}
                    {p.fecha_pago ? ` · Pago: ${p.fecha_pago}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  {['borrador', 'calculado'].includes(p.estado) && (
                    <button onClick={() => handleCalcular(p)} disabled={calculando === p.id} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60">
                      {calculando === p.id ? 'Calculando...' : 'Calcular'}
                    </button>
                  )}
                  {p.estado === 'calculado' && (
                    <button onClick={() => handleEstado(p, 'aprobado')} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">Aprobar</button>
                  )}
                  {p.estado === 'pagado' && (
                    <button onClick={() => handleEstado(p, 'cerrado')} className="rounded-xl border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50">Cerrar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nuevo período de nómina" maxWidth="max-w-lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Nombre *"><input value={form.nombre} onChange={e => setForm(p => ({...p, nombre: e.target.value}))} required placeholder="Ej. Enero 2025" className={INP} /></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha inicio *">
              <input type="date" value={form.fecha_inicio}
                onChange={e => { setForm(p => ({...p, fecha_inicio: e.target.value})); setPreview(null) }}
                onBlur={previewHoras} required className={INP} />
            </Field>
            <Field label="Fecha fin *">
              <input type="date" value={form.fecha_fin}
                onChange={e => { setForm(p => ({...p, fecha_fin: e.target.value})); setPreview(null) }}
                onBlur={previewHoras} required className={INP} />
            </Field>
            <Field label="Tipo período">
              <select value={form.tipo_periodo}
                onChange={e => { setForm(p => ({...p, tipo_periodo: e.target.value})); setPreview(null) }}
                className={INP}>
                <option value="quincenal">Quincenal (por horas)</option>
                <option value="mensual">Mensual (por días)</option>
                <option value="semanal">Semanal</option>
              </select>
            </Field>
            <Field label="Fecha de pago"><input type="date" value={form.fecha_pago} onChange={e => setForm(p => ({...p, fecha_pago: e.target.value}))} className={INP} /></Field>
          </div>
          <Field label="Observaciones"><textarea rows={2} value={form.observaciones} onChange={e => setForm(p => ({...p, observaciones: e.target.value}))} className={INP} /></Field>

          {/* Preview de horas teóricas para quincena */}
          {preview && form.tipo_periodo === 'quincenal' && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm space-y-1">
              <p className="font-semibold text-emerald-800">Horas teóricas del período</p>
              <div className="flex gap-6 text-emerald-700 text-xs">
                <span>Días L-V: <strong>{preview.diasNormales}</strong> × 9 = {preview.diasNormales * 9}h</span>
                <span>Sábados: <strong>{preview.sabados}</strong> × 4 = {preview.sabados * 4}h</span>
                <span className="font-bold">Total: {preview.horasTeoricas}h</span>
              </div>
            </div>
          )}

          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setPreview(null) }} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Creando...' : 'Crear período'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: CÁLCULO DE NÓMINA
// ══════════════════════════════════════════════════════════════════════════════

function TabCalculo() {
  const [periodos, setPeriodos] = useState([])
  const [selectedPeriodo, setSelectedPeriodo] = useState('')
  const [detalles, setDetalles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedDet, setSelectedDet] = useState(null)
  const [conceptos, setConceptos] = useState([])

  useEffect(() => { getPeriodos().then(setPeriodos).catch(e => setError(e.message)) }, [])

  async function handleLoadDetalle(pid) {
    setSelectedPeriodo(pid); setLoading(true); setError('')
    try { setDetalles(await getNominaDetalle(pid)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleVerConceptos(det) {
    setSelectedDet(det)
    try { setConceptos(await getNominaDetalleConceptos(det.id)) } catch {}
  }

  const resumen = useMemo(() => calcularResumenPeriodo(detalles), [detalles])

  // ¿El período seleccionado es por horas?
  const periodoSeleccionado = periodos.find(p => p.id === selectedPeriodo)
  const esPorHoras = periodoSeleccionado?.tipo_periodo === 'quincenal' && detalles.some(d => d.valor_hora != null)

  const cols = esPorHoras ? [
    { key: 'empleado',   label: 'Empleado' },
    { key: 'valor_hora', label: 'Q/hora' },
    { key: 'h_teoricas', label: 'H. Teóricas' },
    { key: 'h_trabajadas',label: 'H. Trabajadas' },
    { key: 'h_normales', label: 'H. Normales' },
    { key: 'h_extra',    label: 'H. Extra' },
    { key: 'pago_normal',label: 'Pago normal' },
    { key: 'pago_extra', label: 'Pago extra' },
    { key: 'bono',       label: 'Bono' },
    { key: 'neto',       label: 'Neto' },
    { key: 'igss_pat',   label: 'IGSS pat.' },
    { key: 'costo',      label: 'Costo empresa' },
  ] : [
    { key: 'empleado', label: 'Empleado' },
    { key: 'salario', label: 'Salario base' },
    { key: 'bono', label: 'Bono incentivo' },
    { key: 'ingresos', label: 'Total ingresos' },
    { key: 'descuentos', label: 'Descuentos' },
    { key: 'neto', label: 'Neto a pagar' },
    { key: 'igss_pat', label: 'IGSS patronal' },
    { key: 'provisiones', label: 'Provisiones' },
    { key: 'costo', label: 'Costo empresa' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <select value={selectedPeriodo} onChange={e => handleLoadDetalle(e.target.value)} className={`${INP} max-w-xs`}>
          <option value="">Seleccionar período</option>
          {periodos.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.estado}</option>)}
        </select>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {detalles.length > 0 && (
        <>
          {/* Resumen */}
          <div className="grid gap-3 md:grid-cols-4">
            <KPI label="Empleados" value={resumen.num_empleados} />
            <KPI label="Neto total" value={fmtQ(resumen.total_neto)} color="text-emerald-700" />
            <KPI label="IGSS patronal" value={fmtQ(resumen.total_igss_patronal)} color="text-blue-700" />
            <KPI label="Costo empresa total" value={fmtQ(resumen.total_costo_empresa)} color="text-stone-800" />
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <KPI label="Total salarios" value={fmtQ(resumen.total_salarios)} />
            <KPI label="Total bonos" value={fmtQ(resumen.total_bonos)} />
            <KPI label="Total descuentos" value={fmtQ(resumen.total_descuentos)} />
            <KPI label="Total provisiones" value={fmtQ(resumen.total_provisiones)} />
          </div>

          {/* Tabla */}
          <Card className="overflow-x-auto p-0">
            {loading ? <div className="py-12 text-center"><Spinner /></div> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50">
                    {cols.map(c => <th key={c.key} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">{c.label}</th>)}
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Desglose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {detalles.map(d => (
                    <tr key={d.id} className="hover:bg-stone-50 transition">
                      <td className="px-4 py-3 font-medium text-stone-800 whitespace-nowrap">
                        {d.empleados?.nombre_completo || `${d.empleados?.apellidos}, ${d.empleados?.nombres}`}
                        <div className="text-xs text-stone-400">{d.empleados?.puesto}</div>
                      </td>
                      {esPorHoras ? (<>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600">{d.valor_hora != null ? `Q ${Number(d.valor_hora).toFixed(4)}` : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-500">{d.horas_teoricas != null ? Number(d.horas_teoricas).toFixed(2) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{d.horas_trabajadas != null ? Number(d.horas_trabajadas).toFixed(2) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600">{d.horas_normales_pagadas != null ? Number(d.horas_normales_pagadas).toFixed(2) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-600 font-semibold">
                          {n(d.horas_extra) > 0 ? `+${Number(d.horas_extra).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600">{fmtQ(d.pago_horas_normales)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-700 font-semibold">
                          {n(d.pago_horas_extra) > 0 ? fmtQ(d.pago_horas_extra) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtQ(d.bonificacion_incentivo_periodo)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-bold">{fmtQ(d.neto_pagar)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-600">{fmtQ(d.total_aportes_patronales)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtQ(d.costo_total_empresa)}</td>
                      </>) : (<>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600">{fmtQ(d.salario_base_periodo)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600">{fmtQ(d.bonificacion_incentivo_periodo)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-700 font-medium">{fmtQ(d.total_ingresos)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-600">{fmtQ(d.total_descuentos)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-bold">{fmtQ(d.neto_pagar)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-600">{fmtQ(d.total_aportes_patronales)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600">{fmtQ(d.total_provisiones)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtQ(d.costo_total_empresa)}</td>
                      </>)}
                      <td className="px-4 py-3">
                        <button onClick={() => handleVerConceptos(d)} className="rounded-xl border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">Ver</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* Modal desglose conceptos */}
      <Modal isOpen={!!selectedDet} onClose={() => setSelectedDet(null)} title={`Desglose — ${selectedDet?.empleados?.nombre_completo}`} maxWidth="max-w-lg">
        {conceptos.length === 0 ? <div className="text-center text-stone-400 py-6">Sin conceptos</div> : (
          <div className="space-y-1">
            {['ingreso','aporte_patronal','provision','descuento','ajuste'].map(tipo => {
              const items = conceptos.filter(c => c.tipo_concepto === tipo)
              if (!items.length) return null
              return (
                <div key={tipo}>
                  <div className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">{tipo.replace('_', ' ')}</div>
                  {items.map(c => (
                    <div key={c.id} className="flex justify-between rounded-xl px-3 py-2 text-sm hover:bg-stone-50">
                      <span className="text-stone-700">{c.nombre_concepto}</span>
                      <span className={`font-semibold ${c.tipo_concepto === 'descuento' ? 'text-red-600' : 'text-stone-800'}`}>{fmtQ(c.monto)}</span>
                    </div>
                  ))}
                </div>
              )
            })}
            <div className="mt-4 border-t border-stone-200 pt-3 flex justify-between text-sm font-bold">
              <span className="text-stone-700">Neto a pagar</span>
              <span className="text-emerald-700">{fmtQ(selectedDet?.neto_pagar)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-stone-600">
              <span>Costo total empresa</span>
              <span>{fmtQ(selectedDet?.costo_total_empresa)}</span>
            </div>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={() => generarBoletaPDF(selectedDet, conceptos)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">Generar boleta PDF</button>
          <button onClick={() => setSelectedDet(null)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cerrar</button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Generador de boleta PDF ──────────────────────────────────────────────────

function generarBoletaPDF(detalle, conceptos) {
  if (!detalle) return
  const emp = detalle.empleados || {}
  const ingresos   = conceptos.filter(c => c.tipo_concepto === 'ingreso')
  const descuentos = conceptos.filter(c => c.tipo_concepto === 'descuento')
  const aportes    = conceptos.filter(c => c.tipo_concepto === 'aporte_patronal')
  const provisiones = conceptos.filter(c => c.tipo_concepto === 'provision')

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#333;padding:30px;max-width:700px;margin:auto}
    h1{font-size:18px;color:#2f5d50;border-bottom:2px solid #2f5d50;padding-bottom:6px;margin-bottom:4px}
    h2{font-size:13px;text-transform:uppercase;color:#888;margin:16px 0 4px}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    td,th{padding:5px 8px;text-align:left;border-bottom:1px solid #eee;font-size:12px}
    th{background:#f5f5f5;font-weight:600;color:#555}
    .right{text-align:right}
    .total{font-weight:bold;font-size:14px;color:#2f5d50}
    .badge{background:#e8f5e9;color:#2f5d50;padding:2px 8px;border-radius:99px;font-size:11px}
    .header-info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:12px;background:#fafafa;border:1px solid #eee;border-radius:8px;padding:12px}
    .section-title{background:#f5f5f5;padding:4px 8px;font-weight:600;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
    .neto{background:#e8f5e9;padding:10px;border-radius:8px;text-align:right;font-size:16px;font-weight:bold;color:#2f5d50}
  </style>
  </head><body>
  <h1>Boleta de Pago</h1>
  <div class="header-info">
    <div><b>Empleado:</b> ${emp.nombre_completo || `${emp.apellidos}, ${emp.nombres}` || ''}</div>
    <div><b>Código:</b> ${emp.codigo_empleado || ''}</div>
    <div><b>Puesto:</b> ${emp.puesto || ''}</div>
    ${detalle.valor_hora != null
      ? `<div><b>Horas trabajadas:</b> ${Number(detalle.horas_trabajadas||0).toFixed(2)} / ${Number(detalle.horas_teoricas||0).toFixed(2)} teóricas</div>
         <div><b>Horas extra:</b> ${Number(detalle.horas_extra||0).toFixed(2)}</div>
         <div><b>Valor/hora:</b> Q ${fmt(detalle.valor_hora)}</div>`
      : `<div><b>Días trabajados:</b> ${detalle.dias_trabajados}</div>`
    }
  </div>

  <h2>Ingresos</h2>
  <table><tr class="section-title"><td>Concepto</td><td class="right">Monto</td></tr>
  ${ingresos.map(c => `<tr><td>${c.nombre_concepto}</td><td class="right">Q ${fmt(c.monto)}</td></tr>`).join('')}
  <tr><td><b>Total ingresos</b></td><td class="right"><b>Q ${fmt(detalle.total_ingresos)}</b></td></tr>
  </table>

  <h2>Descuentos</h2>
  <table><tr class="section-title"><td>Concepto</td><td class="right">Monto</td></tr>
  ${descuentos.map(c => `<tr><td>${c.nombre_concepto}</td><td class="right">Q ${fmt(c.monto)}</td></tr>`).join('')}
  <tr><td><b>Total descuentos</b></td><td class="right"><b>Q ${fmt(detalle.total_descuentos)}</b></td></tr>
  </table>

  <div class="neto">Neto a pagar: Q ${fmt(detalle.neto_pagar)}</div>

  <h2 style="margin-top:16px;color:#999;font-size:11px">Costo empresa (información interna)</h2>
  <table style="font-size:11px;color:#888">
  ${aportes.map(c => `<tr><td>${c.nombre_concepto}</td><td class="right">Q ${fmt(c.monto)}</td></tr>`).join('')}
  ${provisiones.map(c => `<tr><td>${c.nombre_concepto}</td><td class="right">Q ${fmt(c.monto)}</td></tr>`).join('')}
  <tr><td><b>Costo total empresa</b></td><td class="right"><b>Q ${fmt(detalle.costo_total_empresa)}</b></td></tr>
  </table>

  <p style="margin-top:30px;font-size:10px;color:#aaa">Generado por LegucorpPro · ${new Date().toLocaleDateString('es-GT')}</p>
  </body></html>`

  const win = window.open('', '_blank')
  if (win) { win.document.write(html); win.document.close(); win.print() }
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: VACACIONES
// ══════════════════════════════════════════════════════════════════════════════

function TabVacaciones() {
  const [vacaciones, setVacaciones] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ empleado_id: '', fecha_inicio: '', fecha_fin: '', observaciones: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saldo, setSaldo] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [v, e] = await Promise.all([getVacaciones(), getEmpleados()])
      setVacaciones(v); setEmpleados(e)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(e) {
    e.preventDefault(); setSaving(true); setError('')
    try { await createVacaciones(form); await load(); setShowModal(false) }
    catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function loadSaldo(empId) {
    if (!empId) return
    try { setSaldo(await getSaldoVacaciones(empId)) } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-stone-800">Vacaciones</h2>
        <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Registrar solicitud</button>
      </div>
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <Card>
        {loading ? <div className="py-10 text-center"><Spinner /></div> : vacaciones.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">No hay solicitudes de vacaciones.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {vacaciones.map(v => (
              <div key={v.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="font-semibold text-stone-800">{v.empleados?.nombre_completo}</div>
                  <div className="text-xs text-stone-500">{v.fecha_inicio} → {v.fecha_fin} · {v.dias_tomados} días</div>
                  {v.observaciones && <div className="text-xs text-stone-400">{v.observaciones}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge text={v.estado} color={v.estado === 'aprobada' ? 'bg-emerald-100 text-emerald-700' : v.estado === 'rechazada' ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-600'} />
                  {v.estado === 'solicitada' && (
                    <>
                      <button onClick={() => updateVacacionesEstado(v.id, 'aprobada').then(load)} className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">Aprobar</button>
                      <button onClick={() => updateVacacionesEstado(v.id, 'rechazada').then(load)} className="rounded-xl border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-100">Rechazar</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Registrar vacaciones" maxWidth="max-w-md">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Empleado *">
            <select value={form.empleado_id} onChange={e => { setForm(p => ({...p, empleado_id: e.target.value})); loadSaldo(e.target.value) }} required className={INP}>
              <option value="">Seleccionar</option>
              {empleados.filter(e => e.estado_laboral === 'activo').map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}
            </select>
          </Field>
          {saldo && (
            <div className="rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3 text-sm text-stone-600">
              Días disponibles: <strong>{saldo.dias_disponibles}</strong> (ganados: {saldo.dias_ganados}, tomados: {saldo.dias_tomados})
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha inicio *"><input type="date" value={form.fecha_inicio} onChange={e => setForm(p => ({...p, fecha_inicio: e.target.value}))} required className={INP} /></Field>
            <Field label="Fecha fin *"><input type="date" value={form.fecha_fin} onChange={e => setForm(p => ({...p, fecha_fin: e.target.value}))} required className={INP} /></Field>
          </div>
          <Field label="Observaciones"><textarea rows={2} value={form.observaciones} onChange={e => setForm(p => ({...p, observaciones: e.target.value}))} className={INP} /></Field>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: INCAPACIDADES
// ══════════════════════════════════════════════════════════════════════════════

function TabIncapacidades() {
  const [incapacidades, setIncapacidades] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ empleado_id: '', fecha_inicio: '', fecha_fin: '', tipo_incapacidad: 'enfermedad_comun', cubierto_por: 'empresa', porcentaje_pagado_empresa: '100', entidad_respaldo: '', numero_documento: '', observaciones: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [inc, emps] = await Promise.all([getIncapacidades(), getEmpleados()])
      setIncapacidades(inc); setEmpleados(emps)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(e) {
    e.preventDefault(); setSaving(true); setError('')
    try { await createIncapacidad(form); await load(); setShowModal(false) }
    catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-stone-800">Incapacidades</h2>
        <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Registrar incapacidad</button>
      </div>
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <Card>
        {loading ? <div className="py-10 text-center"><Spinner /></div> : incapacidades.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">No hay incapacidades registradas.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {incapacidades.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="font-semibold text-stone-800">{i.empleados?.nombre_completo}</div>
                  <div className="text-xs text-stone-500">{i.fecha_inicio} → {i.fecha_fin} · {i.dias} días · {i.tipo_incapacidad.replace('_', ' ')}</div>
                  <div className="text-xs text-stone-400">Cubierto por: {i.cubierto_por} · Empresa paga: {i.porcentaje_pagado_empresa}%</div>
                </div>
                <Badge text={i.estado} color={i.estado === 'activa' ? 'bg-amber-100 text-amber-700' : i.estado === 'aplicada' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-600'} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Registrar incapacidad" maxWidth="max-w-lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Empleado *">
            <select value={form.empleado_id} onChange={e => setForm(p => ({...p, empleado_id: e.target.value}))} required className={INP}>
              <option value="">Seleccionar</option>
              {empleados.filter(e => e.estado_laboral === 'activo').map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha inicio *"><input type="date" value={form.fecha_inicio} onChange={e => setForm(p => ({...p, fecha_inicio: e.target.value}))} required className={INP} /></Field>
            <Field label="Fecha fin *"><input type="date" value={form.fecha_fin} onChange={e => setForm(p => ({...p, fecha_fin: e.target.value}))} required className={INP} /></Field>
            <Field label="Tipo">
              <select value={form.tipo_incapacidad} onChange={e => setForm(p => ({...p, tipo_incapacidad: e.target.value}))} className={INP}>
                <option value="enfermedad_comun">Enfermedad común</option>
                <option value="accidente_trabajo">Accidente de trabajo</option>
                <option value="maternidad">Maternidad</option>
                <option value="otro">Otro</option>
              </select>
            </Field>
            <Field label="Cubierto por">
              <select value={form.cubierto_por} onChange={e => setForm(p => ({...p, cubierto_por: e.target.value}))} className={INP}>
                <option value="empresa">Empresa</option>
                <option value="igss">IGSS</option>
                <option value="mixto">Mixto</option>
              </select>
            </Field>
            <Field label="% empresa paga"><input type="number" min="0" max="100" step="1" value={form.porcentaje_pagado_empresa} onChange={e => setForm(p => ({...p, porcentaje_pagado_empresa: e.target.value}))} className={INP} /></Field>
            <Field label="Entidad respaldo"><input value={form.entidad_respaldo} onChange={e => setForm(p => ({...p, entidad_respaldo: e.target.value}))} className={INP} /></Field>
          </div>
          <Field label="Observaciones"><textarea rows={2} value={form.observaciones} onChange={e => setForm(p => ({...p, observaciones: e.target.value}))} className={INP} /></Field>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: PRÉSTAMOS Y ANTICIPOS
// ══════════════════════════════════════════════════════════════════════════════

function TabPrestamos() {
  const [prestamos, setPrestamos] = useState([])
  const [anticipos, setAnticipos] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPrestamo, setShowPrestamo] = useState(false)
  const [showAnticipo, setShowAnticipo] = useState(false)
  const [selectedPrestamo, setSelectedPrestamo] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [formP, setFormP] = useState({ empleado_id: '', fecha_otorgado: '', monto_total: '', cuota_periodica: '', tipo_descuento: 'fijo', observaciones: '' })
  const [formA, setFormA] = useState({ empleado_id: '', fecha: '', monto: '', observaciones: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [subTab, setSubTab] = useState('prestamos')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, a, e] = await Promise.all([getPrestamos(), getAnticipos(), getEmpleados()])
      setPrestamos(p); setAnticipos(a); setEmpleados(e)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handlePrestamo(e) {
    e.preventDefault(); setSaving(true); setError('')
    try { await createPrestamo(formP); await load(); setShowPrestamo(false) }
    catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleAnticipo(e) {
    e.preventDefault(); setSaving(true); setError('')
    try { await createAnticipo(formA); await load(); setShowAnticipo(false) }
    catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function verMovimientos(p) {
    setSelectedPrestamo(p)
    try { setMovimientos(await getMovimientosPrestamo(p.id)) } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setSubTab('prestamos')} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${subTab === 'prestamos' ? 'bg-[#2f5d50] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>Préstamos</button>
          <button onClick={() => setSubTab('anticipos')} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${subTab === 'anticipos' ? 'bg-[#2f5d50] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>Anticipos</button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPrestamo(true)} className="rounded-2xl border border-[#2f5d50] px-4 py-2 text-sm font-semibold text-[#2f5d50] hover:bg-emerald-50">+ Préstamo</button>
          <button onClick={() => setShowAnticipo(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">+ Anticipo</button>
        </div>
      </div>
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {subTab === 'prestamos' && (
        <Card>
          {loading ? <div className="py-10 text-center"><Spinner /></div> : prestamos.length === 0 ? (
            <div className="py-8 text-center text-sm text-stone-400">No hay préstamos registrados.</div>
          ) : (
            <div className="divide-y divide-stone-100">
              {prestamos.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <div className="font-semibold text-stone-800">{p.empleados?.nombre_completo}</div>
                    <div className="text-xs text-stone-500">Monto: {fmtQ(p.monto_total)} · Saldo: {fmtQ(p.saldo_actual)} · Cuota: {fmtQ(p.cuota_periodica)}</div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge text={p.estado} color={p.estado === 'activo' ? 'bg-blue-100 text-blue-700' : p.estado === 'saldado' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'} />
                    <button onClick={() => verMovimientos(p)} className="rounded-xl border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">Movimientos</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {subTab === 'anticipos' && (
        <Card>
          {loading ? <div className="py-10 text-center"><Spinner /></div> : anticipos.length === 0 ? (
            <div className="py-8 text-center text-sm text-stone-400">No hay anticipos registrados.</div>
          ) : (
            <div className="divide-y divide-stone-100">
              {anticipos.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <div className="font-semibold text-stone-800">{a.empleados?.nombre_completo}</div>
                    <div className="text-xs text-stone-500">{a.fecha} · {fmtQ(a.monto)}</div>
                    {a.observaciones && <div className="text-xs text-stone-400">{a.observaciones}</div>}
                  </div>
                  <Badge text={a.estado} color={a.estado === 'pendiente' ? 'bg-amber-100 text-amber-700' : a.estado === 'aplicado' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Modal préstamo */}
      <Modal isOpen={showPrestamo} onClose={() => setShowPrestamo(false)} title="Registrar préstamo" maxWidth="max-w-md">
        <form onSubmit={handlePrestamo} className="space-y-4">
          <Field label="Empleado *"><select value={formP.empleado_id} onChange={e => setFormP(p => ({...p, empleado_id: e.target.value}))} required className={INP}><option value="">Seleccionar</option>{empleados.filter(e => e.estado_laboral === 'activo').map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}</select></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha otorgado *"><input type="date" value={formP.fecha_otorgado} onChange={e => setFormP(p => ({...p, fecha_otorgado: e.target.value}))} required className={INP} /></Field>
            <Field label="Monto total (Q) *"><input type="number" step="0.01" value={formP.monto_total} onChange={e => setFormP(p => ({...p, monto_total: e.target.value}))} required className={INP} /></Field>
            <Field label="Cuota periódica (Q)"><input type="number" step="0.01" value={formP.cuota_periodica} onChange={e => setFormP(p => ({...p, cuota_periodica: e.target.value}))} className={INP} /></Field>
            <Field label="Tipo descuento"><select value={formP.tipo_descuento} onChange={e => setFormP(p => ({...p, tipo_descuento: e.target.value}))} className={INP}><option value="fijo">Fijo</option><option value="porcentaje">Porcentaje</option><option value="manual">Manual</option></select></Field>
          </div>
          <Field label="Observaciones"><textarea rows={2} value={formP.observaciones} onChange={e => setFormP(p => ({...p, observaciones: e.target.value}))} className={INP} /></Field>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowPrestamo(false)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button><button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar'}</button></div>
        </form>
      </Modal>

      {/* Modal anticipo */}
      <Modal isOpen={showAnticipo} onClose={() => setShowAnticipo(false)} title="Registrar anticipo" maxWidth="max-w-md">
        <form onSubmit={handleAnticipo} className="space-y-4">
          <Field label="Empleado *"><select value={formA.empleado_id} onChange={e => setFormA(p => ({...p, empleado_id: e.target.value}))} required className={INP}><option value="">Seleccionar</option>{empleados.filter(e => e.estado_laboral === 'activo').map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}</select></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha *"><input type="date" value={formA.fecha} onChange={e => setFormA(p => ({...p, fecha: e.target.value}))} required className={INP} /></Field>
            <Field label="Monto (Q) *"><input type="number" step="0.01" value={formA.monto} onChange={e => setFormA(p => ({...p, monto: e.target.value}))} required className={INP} /></Field>
          </div>
          <Field label="Observaciones"><textarea rows={2} value={formA.observaciones} onChange={e => setFormA(p => ({...p, observaciones: e.target.value}))} className={INP} /></Field>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowAnticipo(false)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button><button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar'}</button></div>
        </form>
      </Modal>

      {/* Modal movimientos préstamo */}
      <Modal isOpen={!!selectedPrestamo} onClose={() => setSelectedPrestamo(null)} title={`Movimientos — ${selectedPrestamo?.empleados?.nombre_completo}`} maxWidth="max-w-lg">
        {movimientos.length === 0 ? <div className="py-6 text-center text-stone-400">Sin movimientos</div> : (
          <div className="divide-y divide-stone-100">
            {movimientos.map(m => (
              <div key={m.id} className="flex justify-between py-3 text-sm">
                <div><span className="font-medium text-stone-800">{m.tipo_movimiento.replace('_', ' ')}</span><div className="text-xs text-stone-400">{m.fecha}</div></div>
                <div className="text-right"><div className={m.tipo_movimiento === 'desembolso' ? 'font-bold text-blue-600' : 'font-semibold text-red-600'}>{m.tipo_movimiento === 'desembolso' ? '+' : '-'}{fmtQ(m.monto)}</div><div className="text-xs text-stone-400">Saldo: {fmtQ(m.saldo_resultante)}</div></div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end"><button onClick={() => setSelectedPrestamo(null)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cerrar</button></div>
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: LIQUIDACIONES
// ══════════════════════════════════════════════════════════════════════════════

function TabLiquidaciones() {
  const [liquidaciones, setLiquidaciones] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ empleado_id: '', fecha_salida: '', motivo_salida: 'renuncia' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedLiq, setSelectedLiq] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [l, e] = await Promise.all([getLiquidaciones(), getEmpleados()])
      setLiquidaciones(l); setEmpleados(e)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCalcLiquidacion(e) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const liq = await calcularLiquidacion(form.empleado_id, form)
      setSelectedLiq(liq); await load(); setShowModal(false)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const MOTIVO_LABEL = { renuncia: 'Renuncia', despido_justificado: 'Despido justificado', despido_injustificado: 'Despido injustificado', mutuo_acuerdo: 'Mutuo acuerdo', otro: 'Otro' }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-stone-800">Liquidaciones / Finiquitos</h2>
        <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Nueva liquidación</button>
      </div>
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <Card>
        {loading ? <div className="py-10 text-center"><Spinner /></div> : liquidaciones.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">No hay liquidaciones registradas.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {liquidaciones.map(l => (
              <div key={l.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="font-semibold text-stone-800">{l.empleados?.nombre_completo}</div>
                  <div className="text-xs text-stone-500">{l.fecha_salida} · {MOTIVO_LABEL[l.motivo_salida]}</div>
                  <div className="text-xs text-stone-500">Aguinaldo: {fmtQ(l.aguinaldo_proporcional)} · Bono14: {fmtQ(l.bono14_proporcional)} · Vacaciones: {fmtQ(l.vacaciones_pendientes_monto)} · Indem: {fmtQ(l.indemnizacion)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-emerald-700">{fmtQ(l.total_liquidacion)}</span>
                  <Badge text={l.estado} color={l.estado === 'aprobada' ? 'bg-emerald-100 text-emerald-700' : l.estado === 'pagada' ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-500'} />
                  <button onClick={() => setSelectedLiq(l)} className="rounded-xl border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">Ver</button>
                  {l.estado === 'calculada' && <button onClick={() => aprobarLiquidacion(l.id).then(load)} className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Aprobar</button>}
                  {l.estado === 'aprobada' && <button onClick={() => pagarLiquidacion(l.id).then(load)} className="rounded-xl bg-[#2f5d50] px-2 py-1 text-xs font-semibold text-white">Marcar pagada</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Calcular liquidación" maxWidth="max-w-md">
        <form onSubmit={handleCalcLiquidacion} className="space-y-4">
          <Field label="Empleado *"><select value={form.empleado_id} onChange={e => setForm(p => ({...p, empleado_id: e.target.value}))} required className={INP}><option value="">Seleccionar</option>{empleados.filter(e => ['activo','suspendido'].includes(e.estado_laboral)).map(e => <option key={e.id} value={e.id}>{e.nombre_completo}</option>)}</select></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha de salida *"><input type="date" value={form.fecha_salida} onChange={e => setForm(p => ({...p, fecha_salida: e.target.value}))} required className={INP} /></Field>
            <Field label="Motivo">
              <select value={form.motivo_salida} onChange={e => setForm(p => ({...p, motivo_salida: e.target.value}))} className={INP}>
                <option value="renuncia">Renuncia</option>
                <option value="despido_justificado">Despido justificado</option>
                <option value="despido_injustificado">Despido injustificado</option>
                <option value="mutuo_acuerdo">Mutuo acuerdo</option>
                <option value="otro">Otro</option>
              </select>
            </Field>
          </div>
          <div className="rounded-2xl bg-stone-50 border border-stone-200 px-4 py-3 text-xs text-stone-500">Se calcularán: días pendientes, aguinaldo proporcional, bono 14, vacaciones pendientes e indemnización si aplica.</div>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowModal(false)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button><button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Calculando...' : 'Calcular'}</button></div>
        </form>
      </Modal>

      {/* Modal detalle liquidación */}
      <Modal isOpen={!!selectedLiq} onClose={() => setSelectedLiq(null)} title={`Liquidación — ${selectedLiq?.empleados?.nombre_completo}`} maxWidth="max-w-lg">
        {selectedLiq && (
          <div className="space-y-3">
            <div className="grid gap-2 text-sm">
              {[
                ['Salario base referencia', selectedLiq.salario_base_referencia],
                ['Días pendientes del mes', selectedLiq.dias_pendientes_mes + ' días'],
                ['Salario días pendientes', selectedLiq.salario_dias_pendientes],
                ['Aguinaldo proporcional', selectedLiq.aguinaldo_proporcional],
                ['Bono 14 proporcional', selectedLiq.bono14_proporcional],
                [`Vacaciones (${selectedLiq.vacaciones_pendientes_dias} días)`, selectedLiq.vacaciones_pendientes_monto],
                ['Indemnización', selectedLiq.indemnizacion],
                ['Otros ingresos', selectedLiq.otros_ingresos],
                ['Otros descuentos', -selectedLiq.otros_descuentos],
                ['Préstamos pendientes', -selectedLiq.prestamos_pendientes],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between border-b border-stone-100 py-1.5">
                  <span className="text-stone-600">{label}</span>
                  <span className={`font-semibold ${n(val) < 0 ? 'text-red-600' : 'text-stone-800'}`}>{typeof val === 'string' ? val : fmtQ(val)}</span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex justify-between">
              <span className="font-bold text-stone-800">Total liquidación</span>
              <span className="text-xl font-bold text-emerald-700">{fmtQ(selectedLiq.total_liquidacion)}</span>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => generarLiquidacionPDF(selectedLiq)} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]">Generar PDF</button>
              <button onClick={() => setSelectedLiq(null)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cerrar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function generarLiquidacionPDF(liq) {
  if (!liq) return
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#333;padding:30px;max-width:650px;margin:auto}h1{font-size:18px;color:#2f5d50;border-bottom:2px solid #2f5d50;padding-bottom:6px}table{width:100%;border-collapse:collapse}td{padding:6px 8px;border-bottom:1px solid #eee}.right{text-align:right}.total{font-weight:bold;font-size:15px;color:#2f5d50;text-align:right;padding:10px 8px;background:#e8f5e9;border-radius:8px}</style>
  </head><body>
  <h1>Liquidación / Finiquito</h1>
  <p><b>Empleado:</b> ${liq.empleados?.nombre_completo || ''}</p>
  <p><b>Fecha de salida:</b> ${liq.fecha_salida} · <b>Motivo:</b> ${liq.motivo_salida}</p>
  <p><b>Salario base:</b> Q ${fmt(liq.salario_base_referencia)}</p>
  <table>
  <tr><td>Días pendientes del mes</td><td class="right">Q ${fmt(liq.salario_dias_pendientes)}</td></tr>
  <tr><td>Aguinaldo proporcional</td><td class="right">Q ${fmt(liq.aguinaldo_proporcional)}</td></tr>
  <tr><td>Bono 14 proporcional</td><td class="right">Q ${fmt(liq.bono14_proporcional)}</td></tr>
  <tr><td>Vacaciones pendientes (${liq.vacaciones_pendientes_dias} días)</td><td class="right">Q ${fmt(liq.vacaciones_pendientes_monto)}</td></tr>
  <tr><td>Indemnización</td><td class="right">Q ${fmt(liq.indemnizacion)}</td></tr>
  ${n(liq.otros_ingresos) > 0 ? `<tr><td>Otros ingresos</td><td class="right">Q ${fmt(liq.otros_ingresos)}</td></tr>` : ''}
  ${n(liq.prestamos_pendientes) > 0 ? `<tr><td>Descuento préstamos</td><td class="right" style="color:red">-Q ${fmt(liq.prestamos_pendientes)}</td></tr>` : ''}
  ${n(liq.otros_descuentos) > 0 ? `<tr><td>Otros descuentos</td><td class="right" style="color:red">-Q ${fmt(liq.otros_descuentos)}</td></tr>` : ''}
  </table>
  <div class="total">Total a pagar: Q ${fmt(liq.total_liquidacion)}</div>
  <p style="margin-top:40px;font-size:11px;color:#aaa">Generado por LegucorpPro · ${new Date().toLocaleDateString('es-GT')}</p>
  </body></html>`
  const win = window.open('', '_blank')
  if (win) { win.document.write(html); win.document.close(); win.print() }
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: PAGOS
// ══════════════════════════════════════════════════════════════════════════════

function TabPagos() {
  const [pagos, setPagos] = useState([])
  const [periodos, setPeriodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ periodo_id: '', fecha_pago: '', banco_origen: '', cuenta_origen: '', observaciones: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedPago, setSelectedPago] = useState(null)
  const [detallesPago, setDetallesPago] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, per] = await Promise.all([getPagosNomina(), getPeriodos()])
      setPagos(p); setPeriodos(per)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleGenerar(e) {
    e.preventDefault(); setSaving(true); setError('')
    try { await generarLotePago(form.periodo_id, form); await load(); setShowModal(false) }
    catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function verDetalle(pago) {
    setSelectedPago(pago)
    try { setDetallesPago(await getDetallePago(pago.id)) } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-stone-800">Pagos de nómina</h2>
        <button onClick={() => setShowModal(true)} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">+ Generar lote de pago</button>
      </div>
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <Card>
        {loading ? <div className="py-10 text-center"><Spinner /></div> : pagos.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400">No hay lotes de pago.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {pagos.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="font-semibold text-stone-800">Pago {p.fecha_pago}</div>
                  <div className="text-xs text-stone-500">{fmtQ(p.monto_total)} · {p.banco_origen || '—'} {p.cuenta_origen || ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge text={p.estado} color={p.estado === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'} />
                  <button onClick={() => verDetalle(p)} className="rounded-xl border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">Ver</button>
                  {p.estado !== 'pagado' && <button onClick={() => marcarPagado(p.id).then(load)} className="rounded-xl bg-[#2f5d50] px-2 py-1 text-xs font-semibold text-white">Marcar pagado</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Generar lote de pago" maxWidth="max-w-md">
        <form onSubmit={handleGenerar} className="space-y-4">
          <Field label="Período *">
            <select value={form.periodo_id} onChange={e => setForm(p => ({...p, periodo_id: e.target.value}))} required className={INP}>
              <option value="">Seleccionar</option>
              {periodos.filter(p => ['calculado', 'aprobado'].includes(p.estado)).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Fecha de pago *"><input type="date" value={form.fecha_pago} onChange={e => setForm(p => ({...p, fecha_pago: e.target.value}))} required className={INP} /></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Banco origen"><input value={form.banco_origen} onChange={e => setForm(p => ({...p, banco_origen: e.target.value}))} className={INP} /></Field>
            <Field label="Cuenta origen"><input value={form.cuenta_origen} onChange={e => setForm(p => ({...p, cuenta_origen: e.target.value}))} className={INP} /></Field>
          </div>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowModal(false)} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700">Cancelar</button><button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Generando...' : 'Generar lote'}</button></div>
        </form>
      </Modal>

      {/* Detalle lote */}
      <Modal isOpen={!!selectedPago} onClose={() => setSelectedPago(null)} title={`Detalle lote — ${selectedPago?.fecha_pago}`} maxWidth="max-w-2xl">
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => generarArchivoBancario(detallesPago, `nomina_${selectedPago?.fecha_pago}`)} className="rounded-2xl border border-[#2f5d50] px-4 py-2 text-sm font-semibold text-[#2f5d50] hover:bg-emerald-50">Exportar CSV bancario</button>
          </div>
          <div className="divide-y divide-stone-100">
            {detallesPago.map(d => (
              <div key={d.id} className="flex justify-between py-3 text-sm">
                <div>
                  <div className="font-medium text-stone-800">{d.empleados?.nombre_completo}</div>
                  <div className="text-xs text-stone-400">{d.banco_destino || '—'} · {d.cuenta_destino || '—'}</div>
                </div>
                <div className="font-bold text-emerald-700">{fmtQ(d.monto)}</div>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-200 pt-3 flex justify-between font-bold text-stone-800">
            <span>Total</span>
            <span className="text-emerald-700">{fmtQ(detallesPago.reduce((a, d) => a + n(d.monto), 0))}</span>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: REPORTES
// ══════════════════════════════════════════════════════════════════════════════

function TabReportes() {
  const [periodos, setPeriodos] = useState([])
  const [selectedPeriodo, setSelectedPeriodo] = useState('')
  const [detalles, setDetalles] = useState([])
  const [provisiones, setProvisiones] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { getPeriodos().then(setPeriodos).catch(() => {}) }, [])

  async function handleLoad(pid) {
    setSelectedPeriodo(pid); setLoading(true); setError('')
    try {
      const [d, p] = await Promise.all([getNominaDetalle(pid), getProvisionesAcumuladas()])
      setDetalles(d); setProvisiones(p.filter(pr => pr.periodo_id === pid))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const resumen = useMemo(() => calcularResumenPeriodo(detalles), [detalles])

  const provResumen = useMemo(() => provisiones.reduce((acc, p) => ({
    aguinaldo: acc.aguinaldo + n(p.provision_aguinaldo),
    bono14:    acc.bono14    + n(p.provision_bono14),
    pasivo:    acc.pasivo    + n(p.provision_pasivo_laboral),
    vacaciones: acc.vacaciones + n(p.provision_vacaciones),
  }), { aguinaldo: 0, bono14: 0, pasivo: 0, vacaciones: 0 }), [provisiones])

  function exportCSV() {
    if (!detalles.length) return
    const header = 'EMPLEADO,SALARIO BASE,BONO,INGRESOS,DESCUENTOS,NETO,IGSS PATRONAL,PROVISIONES,COSTO EMPRESA\n'
    const rows = detalles.map(d => [
      `"${d.empleados?.nombre_completo}"`,
      fmt(d.salario_base_periodo), fmt(d.bonificacion_incentivo_periodo),
      fmt(d.total_ingresos), fmt(d.total_descuentos), fmt(d.neto_pagar),
      fmt(d.total_aportes_patronales), fmt(d.total_provisiones), fmt(d.costo_total_empresa),
    ].join(',')).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `nomina_${selectedPeriodo}.csv`; a.click()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <select value={selectedPeriodo} onChange={e => handleLoad(e.target.value)} className={`${INP} max-w-xs`}>
          <option value="">Seleccionar período</option>
          {periodos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {detalles.length > 0 && (
          <button onClick={exportCSV} className="rounded-2xl border border-[#2f5d50] px-4 py-2 text-sm font-semibold text-[#2f5d50] hover:bg-emerald-50">Exportar CSV</button>
        )}
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {detalles.length > 0 && (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <KPI label="Empleados" value={resumen.num_empleados} />
            <KPI label="Total salarios" value={fmtQ(resumen.total_salarios)} />
            <KPI label="Total bonos incentivo" value={fmtQ(resumen.total_bonos)} />
            <KPI label="Total ingresos brutos" value={fmtQ(resumen.total_ingresos)} />
            <KPI label="IGSS laboral (descuento)" value={fmtQ(resumen.total_descuentos)} color="text-red-600" />
            <KPI label="Neto total a pagar" value={fmtQ(resumen.total_neto)} color="text-emerald-700" />
            <KPI label="IGSS patronal" value={fmtQ(resumen.total_igss_patronal)} color="text-blue-700" />
            <KPI label="Costo empresa total" value={fmtQ(resumen.total_costo_empresa)} color="text-stone-800" />
          </div>

          <Card>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-400">Provisiones del período</h3>
            <div className="grid gap-3 md:grid-cols-4">
              <KPI label="Aguinaldo" value={fmtQ(provResumen.aguinaldo)} />
              <KPI label="Bono 14" value={fmtQ(provResumen.bono14)} />
              <KPI label="Pasivo laboral" value={fmtQ(provResumen.pasivo)} />
              <KPI label="Vacaciones" value={fmtQ(provResumen.vacaciones)} />
            </div>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-stone-200 bg-stone-50">
                {['Empleado','Salario','Bono','Ingresos','Descuentos','Neto','IGSS Pat.','Provisiones','Costo Empresa'].map(h =>
                  <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-stone-400">{h}</th>
                )}
              </tr></thead>
              <tbody className="divide-y divide-stone-100">
                {detalles.map(d => (
                  <tr key={d.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2 font-medium text-stone-800">{d.empleados?.nombre_completo}</td>
                    <td className="px-3 py-2">{fmtQ(d.salario_base_periodo)}</td>
                    <td className="px-3 py-2">{fmtQ(d.bonificacion_incentivo_periodo)}</td>
                    <td className="px-3 py-2 font-semibold">{fmtQ(d.total_ingresos)}</td>
                    <td className="px-3 py-2 text-red-600">{fmtQ(d.total_descuentos)}</td>
                    <td className="px-3 py-2 font-bold text-emerald-700">{fmtQ(d.neto_pagar)}</td>
                    <td className="px-3 py-2 text-blue-600">{fmtQ(d.total_aportes_patronales)}</td>
                    <td className="px-3 py-2">{fmtQ(d.total_provisiones)}</td>
                    <td className="px-3 py-2 font-semibold">{fmtQ(d.costo_total_empresa)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t-2 border-stone-300 bg-stone-50 font-bold text-xs">
                <td className="px-3 py-2 text-stone-600">TOTALES</td>
                <td className="px-3 py-2">{fmtQ(resumen.total_salarios)}</td>
                <td className="px-3 py-2">{fmtQ(resumen.total_bonos)}</td>
                <td className="px-3 py-2">{fmtQ(resumen.total_ingresos)}</td>
                <td className="px-3 py-2 text-red-600">{fmtQ(resumen.total_descuentos)}</td>
                <td className="px-3 py-2 text-emerald-700">{fmtQ(resumen.total_neto)}</td>
                <td className="px-3 py-2 text-blue-600">{fmtQ(resumen.total_igss_patronal)}</td>
                <td className="px-3 py-2">{fmtQ(resumen.total_provisiones)}</td>
                <td className="px-3 py-2">{fmtQ(resumen.total_costo_empresa)}</td>
              </tr></tfoot>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: PARÁMETROS
// ══════════════════════════════════════════════════════════════════════════════

function TabParametros() {
  const [params, setParams] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingJornada, setSavingJornada] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [jornadaForm, setJornadaForm] = useState({
    nombre: 'Jornada Estándar',
    lunes_viernes_horas: '9', sabado_horas: '4',
    domingo_laboral: false, domingo_horas: '0',
    hora_inicio_lv: '08:00', hora_fin_lv: '17:00',
    hora_inicio_sab: '08:00', hora_fin_sab: '12:00',
  })
  const [form, setForm] = useState({
    vigencia_desde: '', porcentaje_igss_laboral: '4.83', porcentaje_igss_patronal: '12.67',
    monto_bonificacion_incentivo: '250', provision_aguinaldo_pct: '8.33', provision_bono14_pct: '8.33',
    provision_pasivo_laboral_pct: '8.33', provision_vacaciones_pct: '4.17',
    porcentaje_subsidio_incapacidad: '67', dias_vacaciones_anuales: '15',
    salario_minimo: '0',
  })

  useEffect(() => {
    getJornada().then(j => {
      if (j?.id) setJornadaForm({
        nombre:               j.nombre,
        lunes_viernes_horas:  String(j.lunes_viernes_horas),
        sabado_horas:         String(j.sabado_horas),
        domingo_laboral:      j.domingo_laboral || false,
        domingo_horas:        String(j.domingo_horas || 0),
        hora_inicio_lv:       j.hora_inicio_lv || '08:00',
        hora_fin_lv:          j.hora_fin_lv    || '17:00',
        hora_inicio_sab:      j.hora_inicio_sab || '08:00',
        hora_fin_sab:         j.hora_fin_sab    || '12:00',
      })
    }).catch(() => {})

    getParametros().then(p => {
      setParams(p)
      if (p) setForm({
        vigencia_desde: p.vigencia_desde,
        porcentaje_igss_laboral:       String(n(p.porcentaje_igss_laboral) * 100),
        porcentaje_igss_patronal:      String(n(p.porcentaje_igss_patronal) * 100),
        monto_bonificacion_incentivo:  String(p.monto_bonificacion_incentivo),
        provision_aguinaldo_pct:       String(n(p.provision_aguinaldo_pct) * 100),
        provision_bono14_pct:          String(n(p.provision_bono14_pct) * 100),
        provision_pasivo_laboral_pct:  String(n(p.provision_pasivo_laboral_pct) * 100),
        provision_vacaciones_pct:      String(n(p.provision_vacaciones_pct) * 100),
        porcentaje_subsidio_incapacidad: String(n(p.porcentaje_subsidio_incapacidad) * 100),
        dias_vacaciones_anuales:       String(p.dias_vacaciones_anuales),
        salario_minimo:                String(p.salario_minimo || 0),
      })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function handleSaveJornada(e) {
    e.preventDefault(); setSavingJornada(true); setError(''); setSuccess('')
    try {
      await saveJornada(jornadaForm)
      setSuccess('Jornada laboral guardada correctamente.')
    } catch(e) { setError(e.message) }
    finally { setSavingJornada(false) }
  }

  async function handleSave(e) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      await saveParametros({
        ...form,
        porcentaje_igss_laboral:      n(form.porcentaje_igss_laboral) / 100,
        porcentaje_igss_patronal:     n(form.porcentaje_igss_patronal) / 100,
        provision_aguinaldo_pct:      n(form.provision_aguinaldo_pct) / 100,
        provision_bono14_pct:         n(form.provision_bono14_pct) / 100,
        provision_pasivo_laboral_pct: n(form.provision_pasivo_laboral_pct) / 100,
        provision_vacaciones_pct:     n(form.provision_vacaciones_pct) / 100,
        porcentaje_subsidio_incapacidad: n(form.porcentaje_subsidio_incapacidad) / 100,
        salario_minimo: n(form.salario_minimo),
      })
      setSuccess('Parámetros guardados correctamente.')
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="py-12 text-center"><Spinner /></div>

  const P = [
    { key: 'vigencia_desde', label: 'Vigente desde *', type: 'date' },
    { key: 'porcentaje_igss_laboral', label: 'IGSS laboral (%)', type: 'number', help: 'Guatemala 2024: 4.83%' },
    { key: 'porcentaje_igss_patronal', label: 'IGSS patronal (%)', type: 'number', help: 'Guatemala 2024: 12.67%' },
    { key: 'monto_bonificacion_incentivo', label: 'Bonificación incentivo (Q)', type: 'number', help: 'Mínimo legal: Q250' },
    { key: 'provision_aguinaldo_pct', label: 'Provisión aguinaldo (%)', type: 'number', help: '1/12 = 8.33%' },
    { key: 'provision_bono14_pct', label: 'Provisión bono 14 (%)', type: 'number', help: '1/12 = 8.33%' },
    { key: 'provision_pasivo_laboral_pct', label: 'Provisión pasivo laboral (%)', type: 'number', help: '1/12 = 8.33%' },
    { key: 'provision_vacaciones_pct', label: 'Provisión vacaciones (%)', type: 'number', help: '15 días/año ≈ 4.17%' },
    { key: 'porcentaje_subsidio_incapacidad', label: 'Subsidio incapacidad empresa (%)', type: 'number' },
    { key: 'dias_vacaciones_anuales', label: 'Días vacaciones anuales', type: 'number' },
    { key: 'salario_minimo', label: 'Salario mínimo mensual (Q)', type: 'number', help: 'Guatemala 2025: Q3,230.92. Se usa como piso para operarios en nómina quincenal. 0 = desactivado.' },
  ]

  return (
    <div className="space-y-6">
      {/* ── Sección: Jornada laboral ─────────────────────────────────── */}
      <h2 className="text-lg font-semibold text-stone-800">Jornada laboral</h2>
      <Card>
        <form onSubmit={handleSaveJornada} className="space-y-4">
          <Field label="Nombre de jornada">
            <input type="text" className={INP} value={jornadaForm.nombre}
              onChange={e => setJornadaForm(f => ({...f, nombre: e.target.value}))} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-stone-600">Lunes a Viernes</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Entrada"><input type="time" className={INP} value={jornadaForm.hora_inicio_lv}
                  onChange={e => setJornadaForm(f => ({...f, hora_inicio_lv: e.target.value}))} /></Field>
                <Field label="Salida"><input type="time" className={INP} value={jornadaForm.hora_fin_lv}
                  onChange={e => setJornadaForm(f => ({...f, hora_fin_lv: e.target.value}))} /></Field>
              </div>
              <Field label="Horas laborales">
                <input type="number" step="0.5" className={INP} value={jornadaForm.lunes_viernes_horas}
                  onChange={e => setJornadaForm(f => ({...f, lunes_viernes_horas: e.target.value}))} />
              </Field>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-stone-600">Sábado</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Entrada"><input type="time" className={INP} value={jornadaForm.hora_inicio_sab}
                  onChange={e => setJornadaForm(f => ({...f, hora_inicio_sab: e.target.value}))} /></Field>
                <Field label="Salida"><input type="time" className={INP} value={jornadaForm.hora_fin_sab}
                  onChange={e => setJornadaForm(f => ({...f, hora_fin_sab: e.target.value}))} /></Field>
              </div>
              <Field label="Horas laborales">
                <input type="number" step="0.5" className={INP} value={jornadaForm.sabado_horas}
                  onChange={e => setJornadaForm(f => ({...f, sabado_horas: e.target.value}))} />
              </Field>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={jornadaForm.domingo_laboral}
              onChange={e => setJornadaForm(f => ({...f, domingo_laboral: e.target.checked}))} />
            Domingo es día laboral
          </label>
          {jornadaForm.domingo_laboral && (
            <Field label="Horas dominicales">
              <input type="number" step="0.5" className={INP} value={jornadaForm.domingo_horas}
                onChange={e => setJornadaForm(f => ({...f, domingo_horas: e.target.value}))} />
            </Field>
          )}
          <div className="flex justify-end">
            <button type="submit" disabled={savingJornada} className="rounded-2xl bg-[#2f5d50] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">
              {savingJornada ? 'Guardando...' : 'Guardar jornada'}
            </button>
          </div>
        </form>
      </Card>

      {/* ── Sección: Parámetros de nómina ────────────────────────────── */}
      <h2 className="text-lg font-semibold text-stone-800">Parámetros de nómina</h2>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Guardar nuevos parámetros desactivará los anteriores. Los valores se expresan en <strong>porcentaje</strong> (ej: 4.83, no 0.0483).
      </div>
      <Card>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {P.map(p => (
              <div key={p.key}>
                <Field label={p.label}>
                  <input type={p.type} step={p.type === 'number' ? '0.01' : undefined} value={form[p.key]}
                    onChange={e => setForm(prev => ({...prev, [p.key]: e.target.value}))}
                    required className={INP} />
                </Field>
                {p.help && <p className="mt-1 text-xs text-stone-400">{p.help}</p>}
              </div>
            ))}
          </div>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}
          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="rounded-2xl bg-[#2f5d50] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">{saving ? 'Guardando...' : 'Guardar parámetros'}</button>
          </div>
        </form>
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB: SEDES DE TRABAJO
// ══════════════════════════════════════════════════════════════════════════════

const emptySede = { nombre: '', descripcion: '', direccion: '', latitud: '', longitud: '', radio_metros: '100' }

function TabSedes() {
  const [sedes, setSedes]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]         = useState(emptySede)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')
  const [geoLoading, setGeoLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setSedes(await getSedes(false)) } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() { setForm(emptySede); setEditingId(null); setError(''); setShowModal(true) }
  function openEdit(s) {
    setForm({ nombre: s.nombre, descripcion: s.descripcion || '', direccion: s.direccion || '',
              latitud: String(s.latitud), longitud: String(s.longitud), radio_metros: String(s.radio_metros) })
    setEditingId(s.id); setError(''); setShowModal(true)
  }

  // Capturar mi ubicación actual para la sede
  async function usarMiUbicacion() {
    setGeoLoading(true)
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
          e => rej(new Error('Error GPS: ' + e.message)),
          { enableHighAccuracy: true, timeout: 10000 }
        )
      )
      setForm(f => ({ ...f, latitud: String(pos.lat.toFixed(7)), longitud: String(pos.lon.toFixed(7)) }))
    } catch (e) { setError(e.message) }
    finally { setGeoLoading(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      if (editingId) await updateSede(editingId, form)
      else           await createSede(form)
      setSuccess(editingId ? 'Sede actualizada.' : 'Sede creada.')
      setShowModal(false)
      await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Desactivar esta sede?')) return
    try { await deleteSede(id); await load() }
    catch (e) { setError(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">Sedes de trabajo</h2>
          <p className="text-sm text-stone-500">Define las ubicaciones físicas donde operan los colaboradores. Se usan para validar la geolocalización en la marcación.</p>
        </div>
        <button onClick={openNew} className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#264c42]">
          + Nueva sede
        </button>
      </div>

      {error   && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</p>}

      {loading ? <div className="py-12 text-center"><Spinner /></div> : (
        <div className="grid gap-4 md:grid-cols-2">
          {sedes.length === 0 && (
            <p className="col-span-2 py-8 text-center text-sm text-stone-400">
              No hay sedes registradas. Crea una para poder validar la geolocalización de los operarios.
            </p>
          )}
          {sedes.map(s => (
            <Card key={s.id} className={!s.activo ? 'opacity-50' : ''}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-stone-800">{s.nombre}</p>
                  {s.descripcion && <p className="text-xs text-stone-500">{s.descripcion}</p>}
                  {s.direccion   && <p className="text-xs text-stone-500">{s.direccion}</p>}
                </div>
                {!s.activo && <Badge text="Inactiva" color="bg-stone-100 text-stone-500" />}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-500">
                <div>
                  <p className="font-medium text-stone-600">Coordenadas</p>
                  <p className="font-mono">{Number(s.latitud).toFixed(6)}, {Number(s.longitud).toFixed(6)}</p>
                </div>
                <div>
                  <p className="font-medium text-stone-600">Radio de validación</p>
                  <p className="text-base font-bold text-[#2f5d50]">{s.radio_metros} m</p>
                </div>
              </div>
              {/* Link a Google Maps */}
              <a
                href={`https://www.google.com/maps?q=${s.latitud},${s.longitud}`}
                target="_blank" rel="noreferrer"
                className="mt-2 block text-xs text-blue-600 hover:underline"
              >
                Ver en Google Maps ↗
              </a>
              <div className="mt-3 flex gap-2">
                <button onClick={() => openEdit(s)} className="rounded-xl border border-stone-300 px-3 py-1.5 text-xs font-semibold hover:bg-stone-50">Editar</button>
                {s.activo && <button onClick={() => handleDelete(s.id)} className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">Desactivar</button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal nueva/editar sede */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-4 overflow-y-auto max-h-[90vh]">
            <h3 className="text-lg font-bold text-stone-800">{editingId ? 'Editar sede' : 'Nueva sede'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Nombre *">
                <input type="text" className={INP} value={form.nombre}
                  onChange={e => setForm(f => ({...f, nombre: e.target.value}))} required />
              </Field>
              <Field label="Descripción">
                <input type="text" className={INP} value={form.descripcion}
                  onChange={e => setForm(f => ({...f, descripcion: e.target.value}))}
                  placeholder="Ej. Planta principal de producción" />
              </Field>
              <Field label="Dirección">
                <input type="text" className={INP} value={form.direccion}
                  onChange={e => setForm(f => ({...f, direccion: e.target.value}))} />
              </Field>

              <div className="rounded-2xl bg-stone-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-stone-700">Coordenadas GPS</p>
                  <button type="button" onClick={usarMiUbicacion} disabled={geoLoading}
                    className="rounded-xl border border-stone-300 px-3 py-1.5 text-xs font-semibold hover:bg-stone-100 disabled:opacity-50">
                    {geoLoading ? 'Obteniendo...' : '📍 Usar mi ubicación'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Latitud *">
                    <input type="number" step="0.0000001" className={INP} value={form.latitud}
                      onChange={e => setForm(f => ({...f, latitud: e.target.value}))}
                      placeholder="15.7835070" required />
                  </Field>
                  <Field label="Longitud *">
                    <input type="number" step="0.0000001" className={INP} value={form.longitud}
                      onChange={e => setForm(f => ({...f, longitud: e.target.value}))}
                      placeholder="-90.2307920" required />
                  </Field>
                </div>
                <p className="text-xs text-stone-400">
                  Puedes obtener las coordenadas desde Google Maps haciendo clic derecho en la ubicación y seleccionando "¿Qué hay aquí?".
                </p>
              </div>

              <Field label="Radio de validación (metros)">
                <input type="number" step="1" min="10" max="2000" className={INP} value={form.radio_metros}
                  onChange={e => setForm(f => ({...f, radio_metros: e.target.value}))} />
                <p className="mt-1 text-xs text-stone-400">
                  El operario debe estar dentro de este radio para que su marcación sea válida. Recomendado: 50–200m.
                </p>
              </Field>

              {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-[#2f5d50] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {saving ? 'Guardando...' : (editingId ? 'Guardar cambios' : 'Crear sede')}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 rounded-2xl border py-2.5 text-sm font-semibold text-stone-700">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
