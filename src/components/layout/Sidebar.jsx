import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { signOutUser } from '../../features/auth/services/authService'

const sections = [
  {
    title: 'General',
    key: 'general',
    items: [
      { label: 'Dashboard', path: '/' },
    ],
  },
  {
    title: 'Maestros',
    key: 'maestros',
    items: [
      { label: 'Clientes', path: '/clientes' },
      { label: 'Proveedores', path: '/proveedores' },
      { label: 'Materias primas', path: '/materias-primas' },
      { label: 'Inventario empaque', path: '/inventario-empaque' },
    ],
  },
  {
    title: 'Productos',
    key: 'productos',
    items: [
      { label: 'Productos base', path: '/productos-base' },
      { label: 'Recetas', path: '/recetas-producto-base' },
    ],
  },
  {
    title: 'Abastecimiento',
    key: 'abastecimiento',
    items: [
      { label: 'Órdenes de compra', path: '/ordenes-compra' },
      { label: 'Recepción', path: '/recepcion' },
          ],
  },
  {
    title: 'Producción',
    key: 'produccion',
    items: [
    { label: 'Inventario MP', path: '/inventario-mp' },
    { label: 'Procesos MP', path: '/procesos-mp' },
    { label: 'Inventario procesado', path: '/inventario-procesado' },
    { label: 'Empaque', path: '/empaque' },
    { label: 'Cuarto frío', path: '/cuarto frio' }, 
    ],
  },
  {
    title: 'Comercial',
    key: 'comercial',
    items: [
      { label: 'Pedidos', path: '/pedidos' },
      { label: 'Cotizaciones', path: '/cotizaciones' },
      { label: 'Vendedores', path: '/vendedores' },
    ],
  },
  {
    title: 'Logística',
    key: 'logistica',
    items: [
      { label: 'Despachos y entregas', path: '/logistica' },
      { label: 'Reclamos', path: '/reclamos' },
    ],
  },
  {
    title: 'Nómina',
    key: 'nomina',
    items: [
      { label: 'Nómina', path: '/nomina' },
      { label: 'Marcación operarios', path: '/marcacion' },
    ],
  },
  {
    title: 'Calidad',
    key: 'calidad',
    items: [
      { label: 'Control de calidad', path: '/calidad' },
    ],
  },
  {
    title: 'Exportación',
    key: 'exportacion',
    items: [
      { label: 'Facturas exportación', path: '/exportacion' },
    ],
  },
  {
    title: 'Finanzas',
    key: 'finanzas',
    items: [
      { label: 'Contabilidad', path: '/contabilidad' },
      { label: 'Cuentas por Cobrar', path: '/cxc' },
      { label: 'Cuentas por Pagar', path: '/cxp' },
      { label: 'Gastos', path: '/gastos' },
    ],
  },
  {
    title: 'Inteligencia',
    key: 'inteligencia',
    items: [
      { label: 'Demanda MP', path: '/demanda-mp' },
      { label: 'Proyección de compras', path: '/proyeccion-compras' },
    ],
  },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  const [openSections, setOpenSections] = useState({
    general: true,
    maestros: true,
    productos: true,
    abastecimiento: true,
    produccion: false,
    comercial: true,
    nomina: true,
    calidad: true,
    exportacion: true,
    logistica: true,
    finanzas: true,
    inteligencia: true,
  })

  function toggleSection(sectionKey) {
    setOpenSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }))
  }

  async function handleLogout() {
    try {
      await signOutUser()
      navigate('/login')
    } catch (error) {
      alert(error.message || 'No se pudo cerrar sesión')
    }
  }

  function isActive(path) {
    return location.pathname === path
  }

  return (
     <aside className="block w-[290px] shrink-0 border-stone-200 bg-[#f2eadf]">
      <div className="flex h-full flex-col px-6 py-7">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm overflow-hidden">
              <img src="/Logo Leume Impresiones CMYK (1).png" alt="Legucorp" className="h-full w-full object-contain" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-stone-800">
                Legucorp Pro
              </h2>
              <p className="text-sm text-stone-500">
                Operación y trazabilidad
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto">
          {sections.map((section) => (
            <div
              key={section.key}
              className="rounded-2xl border border-[#dccfbe] bg-[#fbf8f3] px-3 py-3"
            >
              <button
                type="button"
                onClick={() => toggleSection(section.key)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold text-stone-700 transition hover:bg-[#efe7db]"
              >
                <span>{section.title}</span>
                <span className="text-stone-500">
                  {openSections[section.key] ? '−' : '+'}
                </span>
              </button>

              {openSections[section.key] ? (
                <div className="mt-2 space-y-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`block rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                        isActive(item.path)
                          ? 'bg-[#2f5d50] text-white shadow-sm'
                          : 'text-stone-700 hover:bg-[#efe7db]'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>

        <div className="mt-6 rounded-3xl border border-[#d9cec0] bg-[#fbf8f3] p-4 shadow-sm">
          <p className="text-sm font-semibold text-stone-800">
            Sesión actual
          </p>
          <p className="mt-1 text-sm text-stone-500">
            Acceso al ERP operativo
          </p>

          <button
            onClick={handleLogout}
            className="mt-4 w-full rounded-2xl bg-[#2f5d50] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#264c42]"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </aside>
  )
}