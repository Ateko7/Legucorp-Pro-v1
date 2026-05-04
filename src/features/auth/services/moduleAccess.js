export const MODULE_DEFINITIONS = [
  { key: 'dashboard', label: 'Dashboard', paths: ['/'] },
  { key: 'alert_center', label: 'Centro de alertas', paths: ['/centro-alertas'] },
  { key: 'comercial_dashboard', label: 'Dashboard comercial', paths: ['/comercial/dashboard'] },
  { key: 'prospectos', label: 'Prospectos', paths: ['/comercial/prospectos'] },
  { key: 'seguimientos', label: 'Seguimientos', paths: ['/comercial/seguimientos'] },
  { key: 'rentabilidad_clientes', label: 'Rentabilidad clientes', paths: ['/comercial/rentabilidad-clientes'] },
  { key: 'inteligencia_comercial', label: 'Inteligencia comercial', paths: ['/comercial/inteligencia'] },
  { key: 'pedidos', label: 'Pedidos', paths: ['/pedidos'] },
  { key: 'cotizaciones', label: 'Cotizaciones', paths: ['/cotizaciones'] },
  { key: 'clientes', label: 'Clientes', paths: ['/clientes'] },
  { key: 'vendedores', label: 'Vendedores', paths: ['/vendedores'] },
  { key: 'exportacion', label: 'Exportacion', paths: ['/exportacion'] },
  { key: 'ordenes_compra', label: 'Ordenes de compra', paths: ['/ordenes-compra'] },
  { key: 'recepcion', label: 'Recepcion', paths: ['/recepcion'] },
  { key: 'programas_siembra', label: 'Programas de siembra', paths: ['/programas-siembra'] },
  { key: 'programas_agricolas', label: 'Programas agricolas', paths: ['/programas-agricolas'] },
  { key: 'proveedores', label: 'Proveedores', paths: ['/proveedores'] },
  { key: 'materias_primas', label: 'Materias primas', paths: ['/materias-primas'] },
  { key: 'procesos_mp', label: 'Procesos MP', paths: ['/procesos-mp'] },
  { key: 'empaque', label: 'Empaque', paths: ['/empaque'] },
  { key: 'recetas', label: 'Recetas', paths: ['/recetas-producto-base'] },
  { key: 'productos_base', label: 'Productos base', paths: ['/productos-base'] },
  { key: 'inventario_mp', label: 'Inventario MP', paths: ['/inventario-mp'] },
  { key: 'inventario_procesado', label: 'Inventario procesado', paths: ['/inventario-procesado'] },
  { key: 'inventario_empaque', label: 'Inventario empaque', paths: ['/inventario-empaque'] },
  { key: 'cuarto_frio', label: 'Cuarto frio', paths: ['/cuarto-frio'] },
  { key: 'logistica', label: 'Rutas y costeo', paths: ['/logistica'] },
  { key: 'reclamos', label: 'Reclamos', paths: ['/reclamos'] },
  { key: 'cierres', label: 'Cierres operativos', paths: ['/cierres'] },
  { key: 'contabilidad', label: 'Contabilidad', paths: ['/contabilidad'] },
  { key: 'facturas_fel', label: 'Facturas FEL', paths: ['/facturas-fel'] },
  { key: 'fel_intercompany', label: 'FEL e intercompany', paths: ['/fel-intercompany'] },
  { key: 'cxc', label: 'Cuentas por cobrar', paths: ['/cxc'] },
  { key: 'cxp', label: 'Cuentas por pagar', paths: ['/cxp'] },
  { key: 'flujo_caja', label: 'Flujo de caja', paths: ['/flujo-caja'] },
  { key: 'caja', label: 'Caja', paths: ['/caja'] },
  { key: 'gastos', label: 'Gastos', paths: ['/gastos'] },
  { key: 'nomina', label: 'Nomina', paths: ['/nomina'] },
  { key: 'marcacion', label: 'Marcacion operarios', paths: ['/marcacion', '/operario-onboarding'] },
  { key: 'calidad', label: 'Control de calidad', paths: ['/calidad'] },
  { key: 'trazabilidad', label: 'Trazabilidad y recall', paths: ['/trazabilidad'] },
  { key: 'mantenimiento', label: 'Mantenimiento', paths: ['/mantenimiento'] },
  { key: 'presupuesto_ventas', label: 'Presupuesto ventas', paths: ['/presupuesto-ventas'] },
  { key: 'demanda_mp', label: 'Demanda MP', paths: ['/demanda-mp'] },
  { key: 'proyeccion_compras', label: 'Proyeccion de compras', paths: ['/proyeccion-compras'] },
  { key: 'configuracion_sistema', label: 'Configuracion sistema', paths: ['/configuracion'] },
  { key: 'usuarios_permisos', label: 'Usuarios y permisos', paths: ['/usuarios-permisos'] },
  { key: 'importar_excel', label: 'Importar Excel', paths: ['/importar-excel'] },
]

const PATH_TO_MODULE = new Map()
MODULE_DEFINITIONS.forEach((module) => {
  module.paths.forEach((path) => {
    PATH_TO_MODULE.set(path, module.key)
  })
})

function normalizePath(pathname = '/') {
  return pathname.split('?')[0].split('#')[0]
}

export function getModuleKeyForPath(pathname = '/') {
  const normalized = normalizePath(pathname)
  return PATH_TO_MODULE.get(normalized) || null
}

export function hasModuleAccess(profile, moduleKey) {
  if (!moduleKey) return true
  if (!profile) return false
  if (profile.role === 'operario') return true

  const accessMode = profile.erp_access_mode || 'full'
  if (profile.is_admin || accessMode === 'full') return true

  const allowed = Array.isArray(profile.erp_allowed_modules) ? profile.erp_allowed_modules : []
  return allowed.includes(moduleKey)
}

export function canAccessPath(profile, pathname) {
  return hasModuleAccess(profile, getModuleKeyForPath(pathname))
}

export function getAllowedModules(profile) {
  if (!profile) return []
  if (profile.role === 'operario' || profile.is_admin || (profile.erp_access_mode || 'full') === 'full') {
    return MODULE_DEFINITIONS.map((item) => item.key)
  }
  return Array.isArray(profile.erp_allowed_modules) ? profile.erp_allowed_modules : []
}
