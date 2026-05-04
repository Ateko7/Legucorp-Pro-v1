import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { signOutUser } from '../../features/auth/services/authService'
import { hasModuleAccess } from '../../features/auth/services/moduleAccess'

const icons = {
  dashboard: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  comercial: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  ),
  abastecimiento: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
    </svg>
  ),
  produccion: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  inventarios: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M10 10V6a2 2 0 012-2h0a2 2 0 012 2v4M10 14v4a2 2 0 002 2h0a2 2 0 002-2v-4" />
    </svg>
  ),
  logistica: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1M13 16H9m4 0h1a1 1 0 001-1v-3.34a1 1 0 00-.293-.707l-3.373-3.373A1 1 0 0010.627 7H13v9z" />
    </svg>
  ),
  finanzas: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  nomina: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  calidad: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  mantenimiento: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4 4 0 01-5.4 5.4L5 16l3 3 4.3-4.3a4 4 0 015.4-5.4l-3 3-3-3 3-3z" />
    </svg>
  ),
  inteligencia: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  sistema: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    </svg>
  ),
}

const sections = [
  {
    title: 'Comercial',
    key: 'comercial',
    icon: icons.comercial,
    items: [
      { label: 'Dashboard comercial', path: '/comercial/dashboard', moduleKey: 'comercial_dashboard' },
      { label: 'Prospectos', path: '/comercial/prospectos', moduleKey: 'prospectos' },
      { label: 'Seguimientos', path: '/comercial/seguimientos', moduleKey: 'seguimientos' },
      { label: 'Rentabilidad clientes', path: '/comercial/rentabilidad-clientes', moduleKey: 'rentabilidad_clientes' },
      { label: 'Inteligencia comercial', path: '/comercial/inteligencia', moduleKey: 'inteligencia_comercial' },
      { label: 'Pedidos', path: '/pedidos', moduleKey: 'pedidos' },
      { label: 'Cotizaciones', path: '/cotizaciones', moduleKey: 'cotizaciones' },
      { label: 'Clientes', path: '/clientes', moduleKey: 'clientes' },
      { label: 'Vendedores', path: '/vendedores', moduleKey: 'vendedores' },
      { label: 'Exportación', path: '/exportacion', moduleKey: 'exportacion' },
    ],
  },
  {
    title: 'Abastecimiento',
    key: 'abastecimiento',
    icon: icons.abastecimiento,
    items: [
      { label: 'Órdenes de compra', path: '/ordenes-compra', moduleKey: 'ordenes_compra' },
      { label: 'Recepción', path: '/recepcion', moduleKey: 'recepcion' },
      { label: 'Programas de siembra', path: '/programas-siembra', moduleKey: 'programas_siembra' },
      { label: 'Programas agrícolas', path: '/programas-agricolas', moduleKey: 'programas_agricolas' },
      { label: 'Proveedores', path: '/proveedores', moduleKey: 'proveedores' },
      { label: 'Materias primas', path: '/materias-primas', moduleKey: 'materias_primas' },
    ],
  },
  {
    title: 'Producción',
    key: 'produccion',
    icon: icons.produccion,
    items: [
      { label: 'Procesos MP', path: '/procesos-mp', moduleKey: 'procesos_mp' },
      { label: 'Empaque', path: '/empaque', moduleKey: 'empaque' },
      { label: 'Recetas', path: '/recetas-producto-base', moduleKey: 'recetas' },
      { label: 'Productos base', path: '/productos-base', moduleKey: 'productos_base' },
    ],
  },
  {
    title: 'Inventarios',
    key: 'inventarios',
    icon: icons.inventarios,
    items: [
      { label: 'Inventario MP', path: '/inventario-mp', moduleKey: 'inventario_mp' },
      { label: 'Inventario procesado', path: '/inventario-procesado', moduleKey: 'inventario_procesado' },
      { label: 'Inventario empaque', path: '/inventario-empaque', moduleKey: 'inventario_empaque' },
      { label: 'Cuarto frío', path: '/cuarto-frio', moduleKey: 'cuarto_frio' },
    ],
  },
  {
    title: 'Logística',
    key: 'logistica',
    icon: icons.logistica,
    items: [
      { label: 'Rutas y costeo', path: '/logistica', moduleKey: 'logistica' },
      { label: 'Reclamos', path: '/reclamos', moduleKey: 'reclamos' },
    ],
  },
  {
    title: 'Finanzas',
    key: 'finanzas',
    icon: icons.finanzas,
    items: [
      { label: 'Cierres operativos', path: '/cierres', moduleKey: 'cierres' },
      { label: 'Contabilidad', path: '/contabilidad', moduleKey: 'contabilidad' },
      { label: 'Facturas FEL', path: '/facturas-fel', moduleKey: 'facturas_fel' },
      { label: 'FEL e intercompany', path: '/fel-intercompany', moduleKey: 'fel_intercompany' },
      { label: 'Cuentas por cobrar', path: '/cxc', moduleKey: 'cxc' },
      { label: 'Cuentas por pagar', path: '/cxp', moduleKey: 'cxp' },
      { label: 'Flujo de caja', path: '/flujo-caja', moduleKey: 'flujo_caja' },
      { label: 'Caja', path: '/caja', moduleKey: 'caja' },
      { label: 'Gastos', path: '/gastos', moduleKey: 'gastos' },
    ],
  },
  {
    title: 'Nómina',
    key: 'nomina',
    icon: icons.nomina,
    items: [
      { label: 'Nómina', path: '/nomina', moduleKey: 'nomina' },
      { label: 'Marcación operarios', path: '/marcacion', moduleKey: 'marcacion' },
    ],
  },
  {
    title: 'Calidad',
    key: 'calidad',
    icon: icons.calidad,
    items: [
      { label: 'Control de calidad', path: '/calidad', moduleKey: 'calidad' },
      { label: 'Trazabilidad y Recall', path: '/trazabilidad', moduleKey: 'trazabilidad' },
    ],
  },
  {
    title: 'Mantenimiento',
    key: 'mantenimiento',
    icon: icons.mantenimiento,
    items: [
      { label: 'Mantenimiento', path: '/mantenimiento', moduleKey: 'mantenimiento' },
    ],
  },
  {
    title: 'Inteligencia',
    key: 'inteligencia',
    icon: icons.inteligencia,
    items: [
      { label: 'Presupuesto ventas', path: '/presupuesto-ventas', moduleKey: 'presupuesto_ventas' },
      { label: 'Demanda MP', path: '/demanda-mp', moduleKey: 'demanda_mp' },
      { label: 'Proyección de compras', path: '/proyeccion-compras', moduleKey: 'proyeccion_compras' },
    ],
  },
  {
    title: 'Sistema',
    key: 'sistema',
    icon: icons.sistema,
    items: [
      { label: 'Configuración', path: '/configuracion', moduleKey: 'configuracion_sistema' },
      { label: 'Usuarios y permisos', path: '/usuarios-permisos', moduleKey: 'usuarios_permisos' },
      { label: 'Importar Excel', path: '/importar-excel', moduleKey: 'importar_excel' },
    ],
  },
]

export default function Sidebar({ onClose, profile = null }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [openKey, setOpenKey] = useState(null)

  function toggle(key) {
    setOpenKey((prev) => (prev === key ? null : key))
  }

  function isActive(path) {
    return location.pathname === path
  }

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasModuleAccess(profile, item.moduleKey)),
    }))
    .filter((section) => section.items.length > 0)

  const activeSection = visibleSections.find((section) => section.items.some((item) => isActive(item.path)))
  const previousPathRef = useRef(location.pathname)

  useEffect(() => {
    if (previousPathRef.current === location.pathname) return

    previousPathRef.current = location.pathname
    setOpenKey(activeSection?.key ?? null)
  }, [activeSection?.key, location.pathname])

  async function handleLogout() {
    try {
      await signOutUser()
      navigate('/login')
    } catch (err) {
      alert(err.message || 'No se pudo cerrar sesión')
    }
  }

  return (
    <aside className="flex h-full flex-col border-r border-[#dccfbe] bg-[#f2eadf]">
      <div className="flex items-center justify-between border-b border-[#dccfbe] px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
            <img src="/legucorp-logo.png" alt="Legucorp" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-stone-800">Legucorp Pro</p>
            <p className="text-[10px] text-stone-500">Operación y trazabilidad</p>
          </div>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-[#e8ddd0] lg:hidden"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="px-3 pt-3">
        {hasModuleAccess(profile, 'dashboard') ? (
          <Link
            to="/"
            onClick={onClose}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              isActive('/') ? 'bg-[#2f5d50] text-white shadow-sm' : 'text-stone-700 hover:bg-[#e8ddd0]'
            }`}
          >
            {icons.dashboard}
            Dashboard
          </Link>
        ) : null}
        {hasModuleAccess(profile, 'alert_center') ? (
          <Link
            to="/centro-alertas"
            onClick={onClose}
            className={`mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              isActive('/centro-alertas') ? 'bg-[#2f5d50] text-white shadow-sm' : 'text-stone-700 hover:bg-[#e8ddd0]'
            }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-7.5 13A2 2 0 004.53 20h14.94a2 2 0 001.74-3.14l-7.5-13a2 2 0 00-3.42 0z" />
            </svg>
            Centro de alertas
          </Link>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3 pt-2">
        {visibleSections.map((section) => {
          const isOpenSection = openKey === section.key
          const hasActive = section.items.some((item) => isActive(item.path))

          return (
            <div key={section.key}>
              <button
                type="button"
                onClick={() => toggle(section.key)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  hasActive ? 'text-[#2f5d50]' : 'text-stone-600 hover:bg-[#e8ddd0] hover:text-stone-800'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className={hasActive ? 'text-[#2f5d50]' : 'text-stone-400'}>
                    {section.icon}
                  </span>
                  {section.title}
                </span>
                <svg
                  className={`h-3.5 w-3.5 text-stone-400 transition-transform duration-200 ${isOpenSection ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpenSection ? (
                <div className="mt-0.5 ml-4 space-y-0.5 border-l border-[#d4cbbf] pb-1 pl-3">
                  {section.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      className={`block rounded-lg px-3 py-2 text-sm transition ${
                        isActive(item.path)
                          ? 'bg-[#2f5d50] font-semibold text-white shadow-sm'
                          : 'text-stone-600 hover:bg-[#e8ddd0] hover:text-stone-800'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>

      <div className="border-t border-[#dccfbe] px-3 py-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-red-50 hover:text-red-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
