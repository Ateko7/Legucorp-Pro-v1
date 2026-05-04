import { supabase } from '../../../lib/supabase'

// ─── Auth helper ─────────────────────────────────────────────────────────────

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('profiles').select('id, organization_id, role, empleado_id, full_name').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return data
}

export function n(v) { const x = Number(v); return isNaN(x) ? 0 : x }
export function round2(v) { return Math.round(n(v) * 100) / 100 }

// ─── Parámetros vigentes ──────────────────────────────────────────────────────

export async function getParametrosVigentes(orgId, fecha = null) {
  const hoy = fecha || new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('parametros_nomina')
    .select('*')
    .eq('organization_id', orgId)
    .eq('activo', true)
    .lte('vigencia_desde', hoy)
    .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`)
    .order('vigencia_desde', { ascending: false })
    .limit(1)
    .single()
  if (error || !data) {
    // Retornar parámetros por defecto Guatemala 2024
    return {
      porcentaje_igss_laboral:       0.0483,
      porcentaje_igss_patronal:      0.1267,
      monto_bonificacion_incentivo:  250,
      provision_aguinaldo_pct:       0.0833,
      provision_bono14_pct:          0.0833,
      provision_pasivo_laboral_pct:  0.0833,
      provision_vacaciones_pct:      0.0417,
      porcentaje_subsidio_incapacidad: 0.67,
      dias_vacaciones_anuales:       15,
    }
  }
  return data
}

// ─── Inicializar parámetros para una org nueva ───────────────────────────────

export async function initParametrosNomina(orgId) {
  const { data: existing } = await supabase
    .from('parametros_nomina')
    .select('id')
    .eq('organization_id', orgId)
    .eq('activo', true)
    .limit(1)
  if (existing?.length > 0) return existing[0]

  const { data, error } = await supabase
    .from('parametros_nomina')
    .insert({
      organization_id:              orgId,
      vigencia_desde:               '2024-01-01',
      porcentaje_igss_laboral:      0.0483,
      porcentaje_igss_patronal:     0.1267,
      monto_bonificacion_incentivo: 250,
      provision_aguinaldo_pct:      0.0833,
      provision_bono14_pct:         0.0833,
      provision_pasivo_laboral_pct: 0.0833,
      provision_vacaciones_pct:     0.0417,
      porcentaje_subsidio_incapacidad: 0.67,
      dias_vacaciones_anuales:      15,
      activo:                       true,
    })
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

// ─── Conceptos base Guatemala ─────────────────────────────────────────────────

const CONCEPTOS_BASE = [
  // INGRESOS
  { codigo: 'SAL', nombre: 'Salario Base', tipo: 'ingreso', naturaleza: 'calculado', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: true, orden_visual: 1 },
  { codigo: 'BONO', nombre: 'Bonificación Incentivo', tipo: 'ingreso', naturaleza: 'fijo', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 2 },
  { codigo: 'VAC_PAG', nombre: 'Vacaciones Pagadas', tipo: 'ingreso', naturaleza: 'variable', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: true, orden_visual: 3 },
  { codigo: 'SUBS_INCAP', nombre: 'Subsidio Incapacidad Empresa', tipo: 'ingreso', naturaleza: 'variable', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 4 },
  { codigo: 'BONO_VAR', nombre: 'Bono Variable', tipo: 'ingreso', naturaleza: 'manual', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 5 },
  { codigo: 'AJU_ING', nombre: 'Ajuste Ingreso', tipo: 'ajuste', naturaleza: 'manual', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 6 },
  // DESCUENTOS
  { codigo: 'IGSS_LAB', nombre: 'IGSS Laboral', tipo: 'descuento', naturaleza: 'calculado', afecta_neto: true, afecta_costo_empresa: false, afecta_base_igss: false, orden_visual: 10 },
  { codigo: 'PREST', nombre: 'Descuento Préstamo', tipo: 'descuento', naturaleza: 'variable', afecta_neto: true, afecta_costo_empresa: false, afecta_base_igss: false, orden_visual: 11 },
  { codigo: 'ANTICIPO', nombre: 'Descuento Anticipo', tipo: 'descuento', naturaleza: 'variable', afecta_neto: true, afecta_costo_empresa: false, afecta_base_igss: false, orden_visual: 12 },
  { codigo: 'DESC_MAN', nombre: 'Descuento Manual', tipo: 'descuento', naturaleza: 'manual', afecta_neto: true, afecta_costo_empresa: false, afecta_base_igss: false, orden_visual: 13 },
  // APORTES PATRONALES
  { codigo: 'IGSS_PAT', nombre: 'IGSS Patronal', tipo: 'aporte_patronal', naturaleza: 'calculado', afecta_neto: false, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 20 },
  // PROVISIONES
  { codigo: 'PROV_AGU', nombre: 'Provisión Aguinaldo', tipo: 'provision', naturaleza: 'calculado', afecta_neto: false, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 30 },
  { codigo: 'PROV_B14', nombre: 'Provisión Bono 14', tipo: 'provision', naturaleza: 'calculado', afecta_neto: false, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 31 },
  { codigo: 'PROV_PAS', nombre: 'Provisión Pasivo Laboral', tipo: 'provision', naturaleza: 'calculado', afecta_neto: false, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 32 },
  { codigo: 'PROV_VAC', nombre: 'Provisión Vacaciones', tipo: 'provision', naturaleza: 'calculado', afecta_neto: false, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 33 },
  // PAGOS ESPECIALES
  { codigo: 'LIQUID', nombre: 'Liquidación', tipo: 'pago', naturaleza: 'manual', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 40 },
  { codigo: 'INDEM', nombre: 'Indemnización', tipo: 'pago', naturaleza: 'manual', afecta_neto: true, afecta_costo_empresa: true, afecta_base_igss: false, orden_visual: 41 },
]

export async function initConceptosNomina(orgId) {
  const { data: existing } = await supabase
    .from('conceptos_nomina')
    .select('codigo')
    .eq('organization_id', orgId)
  const existingCodes = new Set((existing || []).map(c => c.codigo))

  const toInsert = CONCEPTOS_BASE
    .filter(c => !existingCodes.has(c.codigo))
    .map(c => ({ ...c, organization_id: orgId, activo: true }))

  if (toInsert.length > 0) {
    const { error } = await supabase.from('conceptos_nomina').insert(toInsert)
    if (error) throw new Error(error.message)
  }
}

export async function getConceptosNomina(orgId) {
  const { data, error } = await supabase
    .from('conceptos_nomina')
    .select('*')
    .eq('organization_id', orgId)
    .eq('activo', true)
    .order('orden_visual', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

// ─── Motor de cálculo por horas (quincenal/variable) ─────────────────────────

/**
 * Calcula la nómina de un empleado basada en marcaciones de horas.
 *
 * Lógica:
 *   salario_quincenal = salario_mensual / 2
 *   valor_hora        = salario_quincenal / horas_teoricas_quincena
 *   pago_normal       = min(horas_trabajadas, horas_teoricas) × valor_hora
 *   pago_extra        = max(0, horas_trabajadas − horas_teoricas) × valor_hora × 1.5
 */
export function calcularNominaEmpleadoHoras({
  empleado,
  params,
  horasTeoricas,          // horas laborables teóricas de la quincena
  horasTrabajadas,        // horas reales según marcaciones
  prestamosDescuento = 0,
  anticiposDescuento = 0,
  ajusteManual = 0,
  descuentoManual = 0,
}) {
  const salarioMensual  = n(empleado.salario_base_actual)
  const bonoIncentivo   = n(empleado.bonificacion_incentivo_actual)
  const afiliado        = empleado.afiliado_igss !== false

  const salarioQuincenal  = round2(salarioMensual / 2)
  const ht                = n(horasTeoricas)
  const valorHora         = ht > 0 ? round2(salarioQuincenal / ht) : 0

  const horasNormalesPagadas = round2(Math.min(n(horasTrabajadas), ht))
  const horasExtra           = round2(Math.max(0, n(horasTrabajadas) - ht))

  const pagoNormal = round2(horasNormalesPagadas * valorHora)
  const pagoExtra  = round2(horasExtra * valorHora * 1.5)
  const salarioCalculado = round2(pagoNormal + pagoExtra)

  // ── Garantía de salario mínimo para operarios ─────────────────────────────
  // Si el operario no alcanzó horas mínimas y su pago es menor al mínimo legal,
  // se le garantiza el salario mínimo quincenal (salario_minimo / 2).
  const esOperario            = empleado.tipo_empleado === 'operario'
  const salarioMinimoQuin     = esOperario && n(params.salario_minimo) > 0
    ? round2(n(params.salario_minimo) / 2)
    : 0
  const aplicoMinimoLegal     = salarioMinimoQuin > 0 && salarioCalculado < salarioMinimoQuin
  const salarioPeriodo        = aplicoMinimoLegal ? salarioMinimoQuin : salarioCalculado

  // IGSS sobre salario devengado (excluye bono incentivo)
  const baseIGSS    = salarioPeriodo
  const igssLaboral = afiliado ? round2(baseIGSS * n(params.porcentaje_igss_laboral))  : 0
  const igssPatronal= afiliado ? round2(baseIGSS * n(params.porcentaje_igss_patronal)) : 0

  // Provisiones sobre salario mensual / 2 (base quincenal)
  const base12 = salarioQuincenal
  const provAguinaldo  = round2(base12 * n(params.provision_aguinaldo_pct))
  const provBono14     = round2(base12 * n(params.provision_bono14_pct))
  const provPasivo     = round2(base12 * n(params.provision_pasivo_laboral_pct))
  const provVacaciones = round2(base12 * n(params.provision_vacaciones_pct))

  const totalIngresos   = round2(salarioPeriodo + bonoIncentivo + n(ajusteManual))
  const totalDescuentos = round2(igssLaboral + n(prestamosDescuento) + n(anticiposDescuento) + n(descuentoManual))
  const netoPagar       = round2(totalIngresos - totalDescuentos)
  const totalAportes    = igssPatronal
  const totalProv       = round2(provAguinaldo + provBono14 + provPasivo + provVacaciones)
  const costoEmpresa    = round2(totalIngresos + totalAportes + totalProv)

  return {
    // Campos de horas
    valor_hora:                       valorHora,
    horas_teoricas:                   ht,
    horas_trabajadas:                 n(horasTrabajadas),
    horas_normales_pagadas:           horasNormalesPagadas,
    horas_extra:                      horasExtra,
    pago_horas_normales:              pagoNormal,
    pago_horas_extra:                 pagoExtra,
    // Méta
    aplico_minimo_legal:              aplicoMinimoLegal,
    salario_minimo_quincenal:         salarioMinimoQuin,
    // Campos compatibles con estructura existente
    salario_base_periodo:             salarioPeriodo,
    bonificacion_incentivo_periodo:   bonoIncentivo,
    dias_trabajados:                  null,
    igss_laboral:                     igssLaboral,
    igss_patronal:                    igssPatronal,
    vacaciones_monto:                 0,
    subsidio_incapacidad:             0,
    prestamos_descuento:              n(prestamosDescuento),
    anticipos_descuento:              n(anticiposDescuento),
    ajuste_manual:                    n(ajusteManual),
    descuento_manual:                 n(descuentoManual),
    prov_aguinaldo:                   provAguinaldo,
    prov_bono14:                      provBono14,
    prov_pasivo:                      provPasivo,
    prov_vacaciones:                  provVacaciones,
    total_ingresos:                   totalIngresos,
    total_descuentos:                 totalDescuentos,
    neto_pagar:                       netoPagar,
    total_aportes_patronales:         totalAportes,
    total_provisiones:                totalProv,
    costo_total_empresa:              costoEmpresa,
  }
}

// ─── Motor de cálculo por días (mensual/fijo) ─────────────────────────────────

export function calcularNominaEmpleado({ empleado, params, diasTrabajados = 30, diasMes = 30, vacacionesDias = 0, incapacidadesDias = 0, porcentajeSubsidio = null, prestamosDescuento = 0, anticiposDescuento = 0, ajusteManual = 0, descuentoManual = 0 }) {
  const salarioBase     = n(empleado.salario_base_actual)
  const bonoIncentivo   = n(empleado.bonificacion_incentivo_actual)
  const afiliado        = empleado.afiliado_igss !== false

  // Proporcional si no trabajó mes completo
  const factorDias      = diasMes > 0 ? n(diasTrabajados) / diasMes : 1
  const salarioProp     = round2(salarioBase * factorDias)

  // IGSS laboral (sobre salario base proporcional, NO incluye bono incentivo)
  const baseIGSS        = salarioProp
  const igssLaboral     = afiliado ? round2(baseIGSS * n(params.porcentaje_igss_laboral)) : 0
  const igssPatronal    = afiliado ? round2(baseIGSS * n(params.porcentaje_igss_patronal)) : 0

  // Vacaciones pagadas (si aplica en este periodo)
  const salarioDiario   = round2(salarioBase / diasMes)
  const vacacionesMonto = round2(salarioDiario * n(vacacionesDias))

  // Subsidio incapacidad
  const pctSubsidio     = porcentajeSubsidio !== null ? n(porcentajeSubsidio) : n(params.porcentaje_subsidio_incapacidad)
  const subsidioMonto   = incapacidadesDias > 0
    ? round2(salarioDiario * n(incapacidadesDias) * pctSubsidio)
    : 0

  // Provisiones (sobre salario base, no proporcional — es acumulación mensual)
  const provAguinaldo   = round2(salarioBase * n(params.provision_aguinaldo_pct))
  const provBono14      = round2(salarioBase * n(params.provision_bono14_pct))
  const provPasivo      = round2(salarioBase * n(params.provision_pasivo_laboral_pct))
  const provVacaciones  = round2(salarioBase * n(params.provision_vacaciones_pct))

  // Totales
  const totalIngresos   = round2(salarioProp + bonoIncentivo + vacacionesMonto + subsidioMonto + n(ajusteManual))
  const totalDescuentos = round2(igssLaboral + n(prestamosDescuento) + n(anticiposDescuento) + n(descuentoManual))
  const netoPagar       = round2(totalIngresos - totalDescuentos)
  const totalAportes    = igssPatronal
  const totalProv       = round2(provAguinaldo + provBono14 + provPasivo + provVacaciones)
  const costoEmpresa    = round2(totalIngresos + totalAportes + totalProv)

  return {
    salario_base_periodo:             salarioProp,
    bonificacion_incentivo_periodo:   bonoIncentivo,
    dias_trabajados:                  diasTrabajados,
    igss_laboral:                     igssLaboral,
    igss_patronal:                    igssPatronal,
    vacaciones_monto:                 vacacionesMonto,
    subsidio_incapacidad:             subsidioMonto,
    prestamos_descuento:              n(prestamosDescuento),
    anticipos_descuento:              n(anticiposDescuento),
    ajuste_manual:                    n(ajusteManual),
    descuento_manual:                 n(descuentoManual),
    prov_aguinaldo:                   provAguinaldo,
    prov_bono14:                      provBono14,
    prov_pasivo:                      provPasivo,
    prov_vacaciones:                  provVacaciones,
    total_ingresos:                   totalIngresos,
    total_descuentos:                 totalDescuentos,
    neto_pagar:                       netoPagar,
    total_aportes_patronales:         totalAportes,
    total_provisiones:                totalProv,
    costo_total_empresa:              costoEmpresa,
  }
}
