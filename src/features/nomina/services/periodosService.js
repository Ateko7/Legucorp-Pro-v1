import { supabase } from '../../../lib/supabase'
import { getProfile, getParametrosVigentes, calcularNominaEmpleado, calcularNominaEmpleadoHoras, initConceptosNomina, initParametrosNomina, n, round2 } from './nominaCore'
import { calcularHorasTeoricas, getJornada } from './marcacionesService'

// ─── Periodos ─────────────────────────────────────────────────────────────────

export async function getPeriodos() {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('nomina_periodos')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('fecha_inicio', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function getPeriodo(id) {
  const { data, error } = await supabase
    .from('nomina_periodos')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function createPeriodo({ nombre, fecha_inicio, fecha_fin, tipo_periodo, fecha_pago, observaciones }) {
  const profile = await getProfile()

  // Calcular horas teóricas automáticamente para períodos quincenales
  let horasTeoricas = null, diasNormales = null, sabados = null
  if (tipo_periodo === 'quincenal') {
    const jornada = await getJornada()
    const calc = calcularHorasTeoricas(fecha_inicio, fecha_fin, jornada)
    horasTeoricas = calc.horasTeoricas
    diasNormales  = calc.diasNormales
    sabados       = calc.sabados
  }

  const { data, error } = await supabase
    .from('nomina_periodos')
    .insert({
      organization_id: profile.organization_id,
      nombre,
      fecha_inicio,
      fecha_fin,
      tipo_periodo,
      fecha_pago:      fecha_pago || null,
      observaciones:   observaciones || null,
      estado:          'borrador',
      created_by:      profile.id,
      horas_teoricas:  horasTeoricas,
      dias_normales:   diasNormales,
      sabados,
    })
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updatePeriodoEstado(id, estado) {
  const ALLOWED = ['borrador', 'calculado', 'revisado', 'aprobado', 'pagado', 'contabilizado', 'cerrado']
  if (!ALLOWED.includes(estado)) throw new Error('Estado inválido')

  const { data: current } = await supabase.from('nomina_periodos').select('estado').eq('id', id).single()
  if (['cerrado'].includes(current?.estado)) throw new Error('El período ya está cerrado y no puede modificarse')

  const { error } = await supabase.from('nomina_periodos').update({ estado, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Cálculo de nómina ────────────────────────────────────────────────────────

export async function calcularPeriodo(periodoId) {
  const profile = await getProfile()
  const orgId   = profile.organization_id

  // Inicializar parámetros y conceptos si no existen
  await initParametrosNomina(orgId, profile.id)
  await initConceptosNomina(orgId)

  const periodo = await getPeriodo(periodoId)
  if (!periodo) throw new Error('Período no encontrado')
  if (['aprobado', 'pagado', 'cerrado'].includes(periodo.estado))
    throw new Error('No se puede recalcular un período aprobado o cerrado')

  const params = await getParametrosVigentes(orgId, periodo.fecha_inicio)

  // Obtener empleados activos + suspendidos
  const { data: empleados } = await supabase
    .from('empleados')
    .select('*')
    .eq('organization_id', orgId)
    .in('estado_laboral', ['activo', 'suspendido'])

  if (!empleados?.length) throw new Error('No hay empleados activos para calcular')

  // Obtener conceptos
  const { data: conceptos } = await supabase
    .from('conceptos_nomina')
    .select('*')
    .eq('organization_id', orgId)
    .eq('activo', true)

  const conceptoMap = {}
  ;(conceptos || []).forEach(c => { conceptoMap[c.codigo] = c })

  // Días del período
  const fechaInicio = new Date(periodo.fecha_inicio)
  const fechaFin    = new Date(periodo.fecha_fin)
  const diasPeriodo = Math.round((fechaFin - fechaInicio) / 86400000) + 1
  const diasMes     = periodo.tipo_periodo === 'mensual' ? 30 : periodo.tipo_periodo === 'quincenal' ? 15 : 7

  // Determinar si el período usa cálculo por horas
  const esQuincenal = periodo.tipo_periodo === 'quincenal'

  // Para cada empleado calcular
  for (const emp of empleados) {
    // Préstamos activos
    const { data: prestamos } = await supabase
      .from('prestamos_empleado')
      .select('id, cuota_periodica, saldo_actual')
      .eq('empleado_id', emp.id)
      .eq('estado', 'activo')
      .gt('saldo_actual', 0)

    const descuentoPrestamo = (prestamos || []).reduce((a, p) => {
      return a + Math.min(n(p.cuota_periodica), n(p.saldo_actual))
    }, 0)

    // Anticipos pendientes
    const { data: anticipos } = await supabase
      .from('anticipos_empleado')
      .select('monto')
      .eq('empleado_id', emp.id)
      .eq('estado', 'pendiente')

    const descuentoAnticipos = (anticipos || []).reduce((a, ant) => a + n(ant.monto), 0)

    let calc

    if (esQuincenal) {
      // ── Cálculo por horas ────────────────────────────────────────────────
      const horasTeoricasPeriodo = n(periodo.horas_teoricas) || diasMes * 9

      // Sumar horas trabajadas desde marcaciones
      const { data: marcaciones } = await supabase
        .from('marcaciones')
        .select('horas_trabajadas')
        .eq('empleado_id', emp.id)
        .gte('fecha', periodo.fecha_inicio)
        .lte('fecha', periodo.fecha_fin)
        .in('estado', ['completa', 'aprobada'])

      const horasTrabajadas = (marcaciones || []).reduce((a, m) => a + n(m.horas_trabajadas), 0)

      calc = calcularNominaEmpleadoHoras({
        empleado:          emp,
        params,
        horasTeoricas:     horasTeoricasPeriodo,
        horasTrabajadas,
        prestamosDescuento: descuentoPrestamo,
        anticiposDescuento: descuentoAnticipos,
      })
    } else {
      // ── Cálculo tradicional por días ─────────────────────────────────────
      const { data: incapacidades } = await supabase
        .from('incapacidades_empleado')
        .select('dias, porcentaje_pagado_empresa')
        .eq('empleado_id', emp.id)
        .eq('estado', 'activa')
        .lte('fecha_inicio', periodo.fecha_fin)
        .gte('fecha_fin', periodo.fecha_inicio)

      const diasIncapacidad = (incapacidades || []).reduce((a, i) => a + n(i.dias), 0)
      const pctSubsidio     = incapacidades?.[0]
        ? n(incapacidades[0].porcentaje_pagado_empresa) / 100
        : n(params.porcentaje_subsidio_incapacidad)

      const { data: vacacionesPag } = await supabase
        .from('vacaciones_empleado')
        .select('dias_tomados')
        .eq('empleado_id', emp.id)
        .eq('estado', 'pagada')
        .eq('periodo_id', periodoId)

      const diasVacaciones = (vacacionesPag || []).reduce((a, v) => a + n(v.dias_tomados), 0)

      calc = calcularNominaEmpleado({
        empleado: emp,
        params,
        diasTrabajados:     diasPeriodo - diasIncapacidad,
        diasMes,
        vacacionesDias:     diasVacaciones,
        incapacidadesDias:  diasIncapacidad,
        porcentajeSubsidio: pctSubsidio,
        prestamosDescuento: descuentoPrestamo,
        anticiposDescuento: descuentoAnticipos,
      })
    }

    // Upsert nomina_detalle
    const { data: detalle, error: detErr } = await supabase
      .from('nomina_detalle')
      .upsert({
        organization_id:                orgId,
        periodo_id:                     periodoId,
        empleado_id:                    emp.id,
        salario_base_periodo:           calc.salario_base_periodo,
        bonificacion_incentivo_periodo: calc.bonificacion_incentivo_periodo,
        dias_trabajados:                calc.dias_trabajados,
        // Campos de horas (solo quincena)
        valor_hora:                     calc.valor_hora           ?? null,
        horas_teoricas:                 calc.horas_teoricas        ?? null,
        horas_trabajadas:               calc.horas_trabajadas      ?? null,
        horas_normales_pagadas:         calc.horas_normales_pagadas ?? null,
        horas_extra:                    calc.horas_extra            ?? null,
        pago_horas_normales:            calc.pago_horas_normales    ?? null,
        pago_horas_extra:               calc.pago_horas_extra       ?? null,
        total_ingresos:                 calc.total_ingresos,
        total_descuentos:               calc.total_descuentos,
        neto_pagar:                     calc.neto_pagar,
        total_aportes_patronales:       calc.total_aportes_patronales,
        total_provisiones:              calc.total_provisiones,
        costo_total_empresa:            calc.costo_total_empresa,
        estado:                         'calculado',
        updated_at:                     new Date().toISOString(),
      }, { onConflict: 'periodo_id,empleado_id' })
      .select().single()

    if (detErr) { console.error('Error upsert detalle:', detErr.message); continue }

    // Borrar conceptos anteriores de este detalle
    await supabase.from('nomina_detalle_conceptos').delete().eq('nomina_detalle_id', detalle.id)

    // Insertar líneas de conceptos
    const lineas = [
      { codigo: 'SAL',      monto: calc.salario_base_periodo,           tipo: 'ingreso' },
      { codigo: 'BONO',     monto: calc.bonificacion_incentivo_periodo, tipo: 'ingreso' },
      ...(calc.vacaciones_monto      > 0 ? [{ codigo: 'VAC_PAG',  monto: calc.vacaciones_monto,     tipo: 'ingreso' }] : []),
      ...(calc.subsidio_incapacidad  > 0 ? [{ codigo: 'SUBS_INCAP', monto: calc.subsidio_incapacidad, tipo: 'ingreso' }] : []),
      ...(calc.igss_laboral          > 0 ? [{ codigo: 'IGSS_LAB', monto: calc.igss_laboral,          tipo: 'descuento' }] : []),
      ...(calc.prestamos_descuento   > 0 ? [{ codigo: 'PREST',    monto: calc.prestamos_descuento,   tipo: 'descuento' }] : []),
      ...(calc.anticipos_descuento   > 0 ? [{ codigo: 'ANTICIPO', monto: calc.anticipos_descuento,   tipo: 'descuento' }] : []),
      ...(calc.igss_patronal         > 0 ? [{ codigo: 'IGSS_PAT', monto: calc.igss_patronal,         tipo: 'aporte_patronal' }] : []),
      { codigo: 'PROV_AGU', monto: calc.prov_aguinaldo,  tipo: 'provision' },
      { codigo: 'PROV_B14', monto: calc.prov_bono14,     tipo: 'provision' },
      { codigo: 'PROV_PAS', monto: calc.prov_pasivo,     tipo: 'provision' },
      { codigo: 'PROV_VAC', monto: calc.prov_vacaciones, tipo: 'provision' },
    ]

    const lineasInsert = lineas.map(l => ({
      organization_id:          orgId,
      nomina_detalle_id:        detalle.id,
      concepto_id:              conceptoMap[l.codigo]?.id,
      nombre_concepto:          conceptoMap[l.codigo]?.nombre || l.codigo,
      tipo_concepto:            l.tipo,
      monto:                    l.monto,
      calculado_automaticamente: true,
    }))

    await supabase.from('nomina_detalle_conceptos').insert(lineasInsert)

    // Upsert provisiones laborales
    await supabase.from('provisiones_laborales').upsert({
      organization_id:          orgId,
      empleado_id:              emp.id,
      periodo_id:               periodoId,
      provision_aguinaldo:      calc.prov_aguinaldo,
      provision_bono14:         calc.prov_bono14,
      provision_pasivo_laboral: calc.prov_pasivo,
      provision_vacaciones:     calc.prov_vacaciones,
      total_provisionado_periodo: calc.total_provisiones,
    }, { onConflict: 'periodo_id,empleado_id' })

    // Aplicar descuentos de préstamos (actualizar saldos)
    if (descuentoPrestamo > 0) {
      for (const p of (prestamos || [])) {
        const cuota = Math.min(n(p.cuota_periodica), n(p.saldo_actual))
        const nuevoSaldo = round2(n(p.saldo_actual) - cuota)
        await supabase.from('prestamos_empleado').update({
          saldo_actual: nuevoSaldo,
          estado: nuevoSaldo <= 0 ? 'saldado' : 'activo',
        }).eq('id', p.id)

        await supabase.from('prestamos_empleado_movimientos').insert({
          organization_id:  orgId,
          prestamo_id:      p.id,
          periodo_id:       periodoId,
          fecha:            periodo.fecha_fin,
          tipo_movimiento:  'descuento_nomina',
          monto:            cuota,
          saldo_resultante: nuevoSaldo,
        })
      }
    }

    // Marcar anticipos como aplicados
    if (descuentoAnticipos > 0) {
      await supabase.from('anticipos_empleado')
        .update({ estado: 'aplicado', periodo_id: periodoId })
        .eq('empleado_id', emp.id)
        .eq('estado', 'pendiente')
    }

    // Marcar incapacidades como aplicadas (solo para períodos por días)
    if (!esQuincenal) {
      const { data: incapActivas } = await supabase
        .from('incapacidades_empleado')
        .select('id')
        .eq('empleado_id', emp.id)
        .eq('estado', 'activa')
        .lte('fecha_inicio', periodo.fecha_fin)
        .gte('fecha_fin', periodo.fecha_inicio)
      if (incapActivas?.length > 0) {
        await supabase.from('incapacidades_empleado')
          .update({ estado: 'aplicada', periodo_id: periodoId })
          .eq('empleado_id', emp.id)
          .eq('estado', 'activa')
          .lte('fecha_inicio', periodo.fecha_fin)
          .gte('fecha_fin', periodo.fecha_inicio)
      }
    }
  }

  // Actualizar estado del período
  await supabase.from('nomina_periodos').update({
    estado: 'calculado',
    updated_at: new Date().toISOString(),
  }).eq('id', periodoId)
}

// ─── Obtener detalle de nómina calculada ─────────────────────────────────────

export async function getNominaDetalle(periodoId) {
  const { data, error } = await supabase
    .from('nomina_detalle')
    .select(`
      *,
      empleados ( id, nombres, apellidos, nombre_completo, puesto, departamento, codigo_empleado, cuenta_bancaria, banco, afiliado_igss )
    `)
    .eq('periodo_id', periodoId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

export async function getNominaDetalleConceptos(nominaDetalleId) {
  const { data, error } = await supabase
    .from('nomina_detalle_conceptos')
    .select('*')
    .eq('nomina_detalle_id', nominaDetalleId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Resumen de un período ────────────────────────────────────────────────────

export function calcularResumenPeriodo(detalles) {
  return detalles.reduce((acc, d) => ({
    total_salarios:          acc.total_salarios + n(d.salario_base_periodo),
    total_bonos:             acc.total_bonos + n(d.bonificacion_incentivo_periodo),
    total_ingresos:          acc.total_ingresos + n(d.total_ingresos),
    total_descuentos:        acc.total_descuentos + n(d.total_descuentos),
    total_neto:              acc.total_neto + n(d.neto_pagar),
    total_igss_patronal:     acc.total_igss_patronal + n(d.total_aportes_patronales),
    total_provisiones:       acc.total_provisiones + n(d.total_provisiones),
    total_costo_empresa:     acc.total_costo_empresa + n(d.costo_total_empresa),
    num_empleados:           acc.num_empleados + 1,
  }), {
    total_salarios: 0, total_bonos: 0, total_ingresos: 0,
    total_descuentos: 0, total_neto: 0, total_igss_patronal: 0,
    total_provisiones: 0, total_costo_empresa: 0, num_empleados: 0,
  })
}
