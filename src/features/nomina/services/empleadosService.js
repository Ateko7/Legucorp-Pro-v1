import { supabase } from '../../../lib/supabase'
import { getProfile } from './nominaCore'

// ─── Empleados ────────────────────────────────────────────────────────────────

export async function getEmpleados(filtro = {}) {
  const profile = await getProfile()
  let q = supabase
    .from('empleados')
    .select(`
      *,
      cost_centers ( id, code, name ),
      sedes_trabajo ( id, nombre, latitud, longitud, radio_metros )
    `)
    .eq('organization_id', profile.organization_id)
    .order('apellidos', { ascending: true })

  if (filtro.estado) q = q.eq('estado_laboral', filtro.estado)
  if (filtro.tipo)   q = q.eq('tipo_empleado', filtro.tipo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function getEmpleado(id) {
  const { data, error } = await supabase
    .from('empleados')
    .select(`*, cost_centers ( id, code, name ), sedes_trabajo ( id, nombre, latitud, longitud, radio_metros )`)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function nextCodigo(orgId) {
  const { data } = await supabase
    .from('empleados')
    .select('codigo_empleado')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
  const last = data?.[0]?.codigo_empleado
  if (!last) return 'EMP-001'
  const num = parseInt(last.replace(/\D/g, ''), 10) || 0
  return `EMP-${String(num + 1).padStart(3, '0')}`
}

export async function createEmpleado(payload) {
  const profile = await getProfile()
  const orgId   = profile.organization_id
  const codigo  = await nextCodigo(orgId)

  const { data, error } = await supabase
    .from('empleados')
    .insert({
      organization_id:              orgId,
      codigo_empleado:              codigo,
      nombres:                      payload.nombres?.trim(),
      apellidos:                    payload.apellidos?.trim(),
      dpi:                          payload.dpi || null,
      nit:                          payload.nit || null,
      igss_numero:                  payload.igss_numero || null,
      fecha_nacimiento:             payload.fecha_nacimiento || null,
      fecha_ingreso:                payload.fecha_ingreso,
      puesto:                       payload.puesto || null,
      departamento:                 payload.departamento || null,
      centro_costo_id:              payload.centro_costo_id || null,
      tipo_contrato:                payload.tipo_contrato || 'indefinido',
      tipo_pago:                    payload.tipo_pago || 'mensual',
      tipo_empleado:                payload.tipo_empleado || 'administrativo',
      sede_id:                      payload.sede_id || null,
      salario_base_actual:          Number(payload.salario_base_actual || 0),
      bonificacion_incentivo_actual: Number(payload.bonificacion_incentivo_actual || 250),
      afiliado_igss:                payload.afiliado_igss !== false,
      banco:                        payload.banco || null,
      tipo_cuenta_bancaria:         payload.tipo_cuenta_bancaria || null,
      cuenta_bancaria:              payload.cuenta_bancaria || null,
      correo:                       payload.correo || null,
      telefono:                     payload.telefono || null,
      direccion:                    payload.direccion || null,
      contacto_emergencia:          payload.contacto_emergencia || null,
      observaciones:                payload.observaciones || null,
      estado_laboral:               'activo',
      created_by:                   profile.id,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)

  // Registrar historial salarial inicial
  await supabase.from('empleado_salario_historial').insert({
    organization_id:        orgId,
    empleado_id:            data.id,
    fecha_inicio:           payload.fecha_ingreso,
    salario_base:           Number(payload.salario_base_actual || 0),
    bonificacion_incentivo: Number(payload.bonificacion_incentivo_actual || 250),
    afiliado_igss:          payload.afiliado_igss !== false,
    tipo_pago:              payload.tipo_pago || 'mensual',
    observaciones:          'Registro inicial',
    created_by:             profile.id,
  })

  return data
}

export async function updateEmpleado(id, payload) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('empleados')
    .update({
      nombres:                      payload.nombres?.trim(),
      apellidos:                    payload.apellidos?.trim(),
      dpi:                          payload.dpi || null,
      nit:                          payload.nit || null,
      igss_numero:                  payload.igss_numero || null,
      fecha_nacimiento:             payload.fecha_nacimiento || null,
      fecha_ingreso:                payload.fecha_ingreso,
      puesto:                       payload.puesto || null,
      departamento:                 payload.departamento || null,
      centro_costo_id:              payload.centro_costo_id || null,
      tipo_contrato:                payload.tipo_contrato || 'indefinido',
      tipo_pago:                    payload.tipo_pago || 'mensual',
      tipo_empleado:                payload.tipo_empleado || 'administrativo',
      sede_id:                      payload.sede_id || null,
      salario_base_actual:          Number(payload.salario_base_actual || 0),
      bonificacion_incentivo_actual: Number(payload.bonificacion_incentivo_actual || 250),
      afiliado_igss:                payload.afiliado_igss !== false,
      banco:                        payload.banco || null,
      tipo_cuenta_bancaria:         payload.tipo_cuenta_bancaria || null,
      cuenta_bancaria:              payload.cuenta_bancaria || null,
      correo:                       payload.correo || null,
      telefono:                     payload.telefono || null,
      direccion:                    payload.direccion || null,
      contacto_emergencia:          payload.contacto_emergencia || null,
      observaciones:                payload.observaciones || null,
      estado_laboral:               payload.estado_laboral || 'activo',
      updated_at:                   new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
  if (error) throw new Error(error.message)
}

export async function darBajaEmpleado(id, fechaBaja) {
  const profile = await getProfile()
  const { error } = await supabase
    .from('empleados')
    .update({ estado_laboral: 'baja', fecha_baja: fechaBaja, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
  if (error) throw new Error(error.message)
}

// ─── Historial salarial ───────────────────────────────────────────────────────

export async function getHistorialSalarial(empleadoId) {
  const { data, error } = await supabase
    .from('empleado_salario_historial')
    .select('*')
    .eq('empleado_id', empleadoId)
    .order('fecha_inicio', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function registrarCambioSalarial(empleadoId, { salario_base, bonificacion_incentivo, tipo_pago, afiliado_igss, fecha_inicio, observaciones }) {
  const profile = await getProfile()

  // Cerrar el historial anterior
  await supabase
    .from('empleado_salario_historial')
    .update({ fecha_fin: new Date(new Date(fecha_inicio) - 1).toISOString().slice(0, 10) })
    .eq('empleado_id', empleadoId)
    .is('fecha_fin', null)

  // Insertar nuevo registro
  const { error } = await supabase.from('empleado_salario_historial').insert({
    organization_id:        profile.organization_id,
    empleado_id:            empleadoId,
    fecha_inicio,
    salario_base:           Number(salario_base),
    bonificacion_incentivo: Number(bonificacion_incentivo || 250),
    afiliado_igss:          afiliado_igss !== false,
    tipo_pago:              tipo_pago || 'mensual',
    observaciones:          observaciones || null,
    created_by:             profile.id,
  })
  if (error) throw new Error(error.message)

  // Actualizar empleado con nuevo salario actual
  await supabase.from('empleados').update({
    salario_base_actual:          Number(salario_base),
    bonificacion_incentivo_actual: Number(bonificacion_incentivo || 250),
    tipo_pago:                    tipo_pago || 'mensual',
    afiliado_igss:                afiliado_igss !== false,
    updated_at:                   new Date().toISOString(),
  }).eq('id', empleadoId)
}

// ─── Parámetros ───────────────────────────────────────────────────────────────

export async function getParametros() {
  const profile = await getProfile()
  const hoy = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('parametros_nomina')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('activo', true)
    .lte('vigencia_desde', hoy)
    .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`)
    .order('vigencia_desde', { ascending: false })
    .limit(1)
  return data?.[0] || null
}

export async function saveParametros(payload) {
  const profile = await getProfile()

  // Desactivar los anteriores
  await supabase.from('parametros_nomina')
    .update({ activo: false })
    .eq('organization_id', profile.organization_id)
    .eq('activo', true)

  const { data, error } = await supabase.from('parametros_nomina').insert({
    organization_id:              profile.organization_id,
    vigencia_desde:               payload.vigencia_desde,
    vigencia_hasta:               payload.vigencia_hasta || null,
    porcentaje_igss_laboral:      Number(payload.porcentaje_igss_laboral),
    porcentaje_igss_patronal:     Number(payload.porcentaje_igss_patronal),
    monto_bonificacion_incentivo: Number(payload.monto_bonificacion_incentivo),
    provision_aguinaldo_pct:      Number(payload.provision_aguinaldo_pct),
    provision_bono14_pct:         Number(payload.provision_bono14_pct),
    provision_pasivo_laboral_pct: Number(payload.provision_pasivo_laboral_pct),
    provision_vacaciones_pct:     Number(payload.provision_vacaciones_pct),
    porcentaje_subsidio_incapacidad: Number(payload.porcentaje_subsidio_incapacidad),
    dias_vacaciones_anuales:      Number(payload.dias_vacaciones_anuales),
    salario_minimo:               Number(payload.salario_minimo || 0),
    activo:                       true,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Centros de costo para nómina ─────────────────────────────────────────────

export async function getCostCentersForNomina() {
  const profile = await getProfile()
  const { data } = await supabase
    .from('cost_centers')
    .select('id, code, name')
    .eq('organization_id', profile.organization_id)
    .eq('is_active', true)
    .order('code')
  return data || []
}
