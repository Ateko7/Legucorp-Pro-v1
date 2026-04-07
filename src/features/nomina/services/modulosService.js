import { supabase } from '../../../lib/supabase'
import { getProfile, n, round2 } from './nominaCore'

// ────────────────────────────────────────────────────────────────────────────
// VACACIONES
// ────────────────────────────────────────────────────────────────────────────

export async function getVacaciones(empleadoId = null) {
  const profile = await getProfile()
  let q = supabase
    .from('vacaciones_empleado')
    .select(`*, empleados ( nombre_completo, codigo_empleado, puesto )`)
    .eq('organization_id', profile.organization_id)
    .order('fecha_inicio', { ascending: false })
  if (empleadoId) q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function createVacaciones({ empleado_id, fecha_inicio, fecha_fin, observaciones }) {
  const profile   = await getProfile()
  const fInicio   = new Date(fecha_inicio)
  const fFin      = new Date(fecha_fin)
  const diasTomados = Math.round((fFin - fInicio) / 86400000) + 1

  const { data, error } = await supabase.from('vacaciones_empleado').insert({
    organization_id: profile.organization_id,
    empleado_id,
    fecha_inicio,
    fecha_fin,
    dias_tomados: diasTomados,
    estado:       'solicitada',
    observaciones: observaciones || null,
    created_by:   profile.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateVacacionesEstado(id, estado) {
  const { error } = await supabase.from('vacaciones_empleado').update({ estado }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getSaldoVacaciones(empleadoId) {
  const { data: emp } = await supabase
    .from('empleados')
    .select('fecha_ingreso')
    .eq('id', empleadoId)
    .single()

  if (!emp) return { dias_ganados: 0, dias_tomados: 0, dias_disponibles: 0 }

  const hoy = new Date()
  const ingreso = new Date(emp.fecha_ingreso)
  const añosServicio = Math.floor((hoy - ingreso) / (365.25 * 86400000))
  const diasGanados = añosServicio * 15

  const { data: tomados } = await supabase
    .from('vacaciones_empleado')
    .select('dias_tomados')
    .eq('empleado_id', empleadoId)
    .in('estado', ['aprobada', 'pagada', 'aplicada'])

  const diasTomados = (tomados || []).reduce((a, v) => a + n(v.dias_tomados), 0)

  return {
    dias_ganados:    diasGanados,
    dias_tomados:    diasTomados,
    dias_disponibles: Math.max(0, diasGanados - diasTomados),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// INCAPACIDADES
// ────────────────────────────────────────────────────────────────────────────

export async function getIncapacidades(empleadoId = null) {
  const profile = await getProfile()
  let q = supabase
    .from('incapacidades_empleado')
    .select(`*, empleados ( nombre_completo, codigo_empleado )`)
    .eq('organization_id', profile.organization_id)
    .order('fecha_inicio', { ascending: false })
  if (empleadoId) q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function createIncapacidad({ empleado_id, fecha_inicio, fecha_fin, tipo_incapacidad, cubierto_por, porcentaje_pagado_empresa, entidad_respaldo, numero_documento, observaciones }) {
  const profile = await getProfile()
  const fInicio = new Date(fecha_inicio)
  const fFin    = new Date(fecha_fin)
  const dias    = Math.round((fFin - fInicio) / 86400000) + 1

  const { data, error } = await supabase.from('incapacidades_empleado').insert({
    organization_id:          profile.organization_id,
    empleado_id,
    fecha_inicio,
    fecha_fin,
    dias,
    tipo_incapacidad:         tipo_incapacidad || 'enfermedad_comun',
    cubierto_por:             cubierto_por || 'empresa',
    porcentaje_pagado_empresa: Number(porcentaje_pagado_empresa ?? 100),
    entidad_respaldo:         entidad_respaldo || null,
    numero_documento:         numero_documento || null,
    observaciones:            observaciones || null,
    estado:                   'activa',
    created_by:               profile.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateIncapacidadEstado(id, estado) {
  const { error } = await supabase.from('incapacidades_empleado').update({ estado }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ────────────────────────────────────────────────────────────────────────────
// PRÉSTAMOS Y ANTICIPOS
// ────────────────────────────────────────────────────────────────────────────

export async function getPrestamos(empleadoId = null) {
  const profile = await getProfile()
  let q = supabase
    .from('prestamos_empleado')
    .select(`*, empleados ( nombre_completo, codigo_empleado )`)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
  if (empleadoId) q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function createPrestamo({ empleado_id, fecha_otorgado, monto_total, cuota_periodica, tipo_descuento, observaciones }) {
  const profile = await getProfile()
  const monto   = Number(monto_total)

  const { data, error } = await supabase.from('prestamos_empleado').insert({
    organization_id: profile.organization_id,
    empleado_id,
    fecha_otorgado,
    monto_total:    monto,
    saldo_actual:   monto,
    cuota_periodica: Number(cuota_periodica || 0),
    tipo_descuento: tipo_descuento || 'fijo',
    estado:         'activo',
    observaciones:  observaciones || null,
    created_by:     profile.id,
  }).select().single()
  if (error) throw new Error(error.message)

  // Registrar movimiento de desembolso
  await supabase.from('prestamos_empleado_movimientos').insert({
    organization_id:  profile.organization_id,
    prestamo_id:      data.id,
    fecha:            fecha_otorgado,
    tipo_movimiento:  'desembolso',
    monto:            monto,
    saldo_resultante: monto,
  })

  return data
}

export async function getMovimientosPrestamo(prestamoId) {
  const { data, error } = await supabase
    .from('prestamos_empleado_movimientos')
    .select('*')
    .eq('prestamo_id', prestamoId)
    .order('fecha', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function getAnticipos(empleadoId = null) {
  const profile = await getProfile()
  let q = supabase
    .from('anticipos_empleado')
    .select(`*, empleados ( nombre_completo, codigo_empleado )`)
    .eq('organization_id', profile.organization_id)
    .order('fecha', { ascending: false })
  if (empleadoId) q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function createAnticipo({ empleado_id, fecha, monto, observaciones }) {
  const profile = await getProfile()
  const { data, error } = await supabase.from('anticipos_empleado').insert({
    organization_id: profile.organization_id,
    empleado_id,
    fecha,
    monto:          Number(monto),
    estado:         'pendiente',
    observaciones:  observaciones || null,
    created_by:     profile.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

// ────────────────────────────────────────────────────────────────────────────
// LIQUIDACIONES
// ────────────────────────────────────────────────────────────────────────────

export async function getLiquidaciones() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('liquidaciones_empleado')
    .select(`*, empleados ( nombre_completo, codigo_empleado, puesto )`)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function calcularLiquidacion(empleadoId, { fecha_salida, motivo_salida }) {
  const profile = await getProfile()

  const { data: emp } = await supabase
    .from('empleados').select('*').eq('id', empleadoId).single()
  if (!emp) throw new Error('Empleado no encontrado')

  const ingreso  = new Date(emp.fecha_ingreso)
  const salida   = new Date(fecha_salida)
  const diasServicio = Math.floor((salida - ingreso) / 86400000)
  const añosServicio = diasServicio / 365.25
  const mesServicio  = diasServicio / 30.4375

  const salBase  = n(emp.salario_base_actual)
  const bono     = n(emp.bonificacion_incentivo_actual)
  const salDiario = round2(salBase / 30)

  // Días pendientes del mes en curso
  const diasMes = salida.getDate()
  const salDiasPendientes = round2(salDiario * diasMes)

  // Aguinaldo proporcional (meses trabajados en el año en curso)
  const inicioAño = new Date(salida.getFullYear(), 0, 1)
  const mesesAño  = (salida - inicioAño) / (30.4375 * 86400000)
  const aguinaldoProp = round2(salBase * (mesesAño / 12))

  // Bono 14 proporcional (año julio-junio)
  const inicioB14 = salida.getMonth() >= 6
    ? new Date(salida.getFullYear(), 6, 1)
    : new Date(salida.getFullYear() - 1, 6, 1)
  const mesesB14 = (salida - inicioB14) / (30.4375 * 86400000)
  const bono14Prop = round2(salBase * (mesesB14 / 12))

  // Vacaciones pendientes
  const { data: vacTomadas } = await supabase
    .from('vacaciones_empleado')
    .select('dias_tomados')
    .eq('empleado_id', empleadoId)
    .in('estado', ['aprobada', 'pagada', 'aplicada'])
  const diasVacTomados = (vacTomadas || []).reduce((a, v) => a + n(v.dias_tomados), 0)
  const diasVacGanados = Math.floor(añosServicio) * 15
  const diasVacPend    = Math.max(0, diasVacGanados - diasVacTomados)
  const vacMonto       = round2(salDiario * diasVacPend)

  // Indemnización (solo despido injustificado o fuerza mayor)
  const tieneIndem = ['despido_injustificado', 'mutuo_acuerdo'].includes(motivo_salida)
  const indemnizacion = tieneIndem ? round2(salBase * añosServicio) : 0

  // Préstamos pendientes
  const { data: prest } = await supabase
    .from('prestamos_empleado')
    .select('saldo_actual')
    .eq('empleado_id', empleadoId)
    .eq('estado', 'activo')
  const prestamosPend = (prest || []).reduce((a, p) => a + n(p.saldo_actual), 0)

  const totalLiquidacion = round2(
    salDiasPendientes + aguinaldoProp + bono14Prop + vacMonto + indemnizacion - prestamosPend
  )

  const { data, error } = await supabase.from('liquidaciones_empleado').insert({
    organization_id:                  profile.organization_id,
    empleado_id:                      empleadoId,
    fecha_salida,
    motivo_salida,
    salario_base_referencia:          salBase,
    bonificacion_incentivo_referencia: bono,
    dias_pendientes_mes:              diasMes,
    salario_dias_pendientes:          salDiasPendientes,
    aguinaldo_proporcional:           aguinaldoProp,
    bono14_proporcional:              bono14Prop,
    vacaciones_pendientes_dias:       diasVacPend,
    vacaciones_pendientes_monto:      vacMonto,
    indemnizacion,
    prestamos_pendientes:             prestamosPend,
    total_liquidacion:                totalLiquidacion,
    estado:                           'calculada',
    created_by:                       profile.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function aprobarLiquidacion(id) {
  const { error } = await supabase.from('liquidaciones_empleado').update({ estado: 'aprobada' }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function pagarLiquidacion(id) {
  const { data: liq } = await supabase.from('liquidaciones_empleado').select('empleado_id').eq('id', id).single()
  await supabase.from('liquidaciones_empleado').update({ estado: 'pagada' }).eq('id', id)
  if (liq?.empleado_id) {
    await supabase.from('empleados').update({
      estado_laboral: 'baja',
      fecha_baja:     new Date().toISOString().slice(0, 10),
    }).eq('id', liq.empleado_id)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PAGOS DE NÓMINA
// ────────────────────────────────────────────────────────────────────────────

export async function getPagosNomina(periodoId = null) {
  const profile = await getProfile()
  let q = supabase
    .from('nomina_pagos')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
  if (periodoId) q = q.eq('periodo_id', periodoId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function generarLotePago(periodoId, { fecha_pago, banco_origen, cuenta_origen, observaciones }) {
  const profile = await getProfile()

  const { data: detalles } = await supabase
    .from('nomina_detalle')
    .select(`*, empleados ( nombre_completo, banco, cuenta_bancaria, codigo_empleado )`)
    .eq('periodo_id', periodoId)
    .eq('estado', 'calculado')

  if (!detalles?.length) throw new Error('No hay detalles calculados para generar el pago')

  const monto_total = round2(detalles.reduce((a, d) => a + n(d.neto_pagar), 0))

  const { data: pago, error: pagoErr } = await supabase.from('nomina_pagos').insert({
    organization_id: profile.organization_id,
    periodo_id:      periodoId,
    fecha_pago,
    banco_origen:    banco_origen || null,
    cuenta_origen:   cuenta_origen || null,
    monto_total,
    estado:          'preparado',
    observaciones:   observaciones || null,
    created_by:      profile.id,
  }).select().single()
  if (pagoErr) throw new Error(pagoErr.message)

  const detallesPago = detalles.map(d => ({
    organization_id:   profile.organization_id,
    nomina_pago_id:    pago.id,
    empleado_id:       d.empleado_id,
    nomina_detalle_id: d.id,
    banco_destino:     d.empleados?.banco || null,
    cuenta_destino:    d.empleados?.cuenta_bancaria || null,
    monto:             d.neto_pagar,
    estado:            'pendiente',
  }))

  await supabase.from('nomina_pago_detalle').insert(detallesPago)

  return { pago, detalles: detallesPago }
}

export async function getDetallePago(pagoId) {
  const { data, error } = await supabase
    .from('nomina_pago_detalle')
    .select(`*, empleados ( nombre_completo, codigo_empleado, banco, cuenta_bancaria )`)
    .eq('nomina_pago_id', pagoId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function marcarPagado(pagoId) {
  const profile = await getProfile()
  await supabase.from('nomina_pagos').update({ estado: 'pagado' }).eq('id', pagoId)
  await supabase.from('nomina_pago_detalle').update({ estado: 'procesado' }).eq('nomina_pago_id', pagoId)

  // Marcar detalles de nómina como pagados
  const { data: pago } = await supabase.from('nomina_pagos').select('periodo_id').eq('id', pagoId).single()
  if (pago?.periodo_id) {
    await supabase.from('nomina_detalle').update({ estado: 'pagado' }).eq('periodo_id', pago.periodo_id)
    await supabase.from('nomina_periodos').update({ estado: 'pagado', updated_at: new Date().toISOString() }).eq('id', pago.periodo_id)
  }
}

export function generarArchivoBancario(detalles, nombreArchivo = 'nomina_pago') {
  // Formato CSV adaptable por banco
  const header = 'CODIGO_EMPLEADO,NOMBRE,BANCO,CUENTA,MONTO\n'
  const filas  = detalles.map(d =>
    [
      d.empleados?.codigo_empleado || '',
      `"${d.empleados?.nombre_completo || ''}"`,
      d.banco_destino || '',
      d.cuenta_destino || '',
      Number(d.monto).toFixed(2),
    ].join(',')
  ).join('\n')

  const csv  = header + filas
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${nombreArchivo}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ────────────────────────────────────────────────────────────────────────────
// PROVISIONES ACUMULADAS
// ────────────────────────────────────────────────────────────────────────────

export async function getProvisionesAcumuladas(empleadoId = null) {
  const profile = await getProfile()
  let q = supabase
    .from('provisiones_laborales')
    .select(`*, empleados ( nombre_completo, codigo_empleado ), nomina_periodos ( nombre, fecha_inicio, fecha_fin )`)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
  if (empleadoId) q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function getResumenProvisionesEmpleado(empleadoId) {
  const { data, error } = await supabase
    .from('provisiones_laborales')
    .select('provision_aguinaldo, provision_bono14, provision_pasivo_laboral, provision_vacaciones')
    .eq('empleado_id', empleadoId)
  if (error) throw new Error(error.message)

  return (data || []).reduce((acc, p) => ({
    aguinaldo:    round2(acc.aguinaldo + n(p.provision_aguinaldo)),
    bono14:       round2(acc.bono14 + n(p.provision_bono14)),
    pasivo:       round2(acc.pasivo + n(p.provision_pasivo_laboral)),
    vacaciones:   round2(acc.vacaciones + n(p.provision_vacaciones)),
    total:        round2(acc.total + n(p.provision_aguinaldo) + n(p.provision_bono14) + n(p.provision_pasivo_laboral) + n(p.provision_vacaciones)),
  }), { aguinaldo: 0, bono14: 0, pasivo: 0, vacaciones: 0, total: 0 })
}
