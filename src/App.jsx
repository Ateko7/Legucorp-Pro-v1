import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import RequireAuth from './features/auth/components/RequireAuth'
import LoginPage from './features/auth/pages/LoginPage'
import RegisterPage from './features/auth/pages/RegisterPage'
import DashboardPage from './features/dashboard/pages/DashboardPage'
import ProductBasesPage from './features/productBases/pages/productBasesPage'
import CuartoFrioPage from './features/produccion/pages/CuartoFrioPage'
import RecepcionPage from './features/recepcion/pages/RecepcionPage'
import OrdenesCompraPage from './features/compras/pages/OrdenesCompraPage'
import ClientsPage from './features/clients/pages/ClientsPage'
import SuppliersPage from './features/suppliers/pages/SuppliersPage'
import MaterialsPage from './features/materials/pages/MaterialsPage'
import InventarioMpPage from './features/inventarioMp/pages/InventarioMpPage'
import InventarioEmpaquePage from './features/inventarioEmpaque/pages/InventarioEmpaquePage'
import ProductBaseRecipesPage from './features/productBases/pages/ProductBaseRecipesPage'
import InventarioProcesadoPage from './features/produccion/pages/InventarioProcesadoPage'
import EmpaquePage from './features/produccion/pages/EmpaquePage'
import ProcesosMpPage from './features/produccion/pages/ProcesosMpPage'
import PedidosPage from './features/pedidos/pages/PedidosPage'
import DemandaMpPage from './features/demanda/pages/DemandaMpPage'
import ProyeccionComprasPage from './features/proyeccion/pages/ProyeccionComprasPage'
import LogisticaPage from './features/logistica/pages/LogisticaPage'
import ReclamosPage from './features/reclamos/pages/ReclamosPage'
import ContabilidadPage from './features/contabilidad/pages/ContabilidadPage'
import CxCPage from './features/finanzas/pages/CxCPage'
import CxPPage from './features/finanzas/pages/CxPPage'
import GastosPage from './features/finanzas/pages/GastosPage'
import CotizacionesPage from './features/cotizaciones/pages/CotizacionesPage'
import VendedoresPage from './features/vendedores/pages/VendedoresPage'
import NominaPage from './features/nomina/pages/NominaPage'
import MarcacionPage from './features/marcacion/pages/MarcacionPage'
import CalidadPage from './features/calidad/pages/CalidadPage'
import ExportacionPage from './features/exportacion/pages/ExportacionPage'

function wrap(element) {
  return (
    <RequireAuth>
      <Layout>{element}</Layout>
    </RequireAuth>
  )
}

// Kiosk: requiere auth pero sin Layout (sin barra lateral ni header)
function wrapKiosk(element) {
  return <RequireAuth>{element}</RequireAuth>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />

        <Route path="/" element={wrap(<DashboardPage />)} />
        <Route path="/clientes" element={wrap(<ClientsPage />)} />
        <Route path="/proveedores" element={wrap(<SuppliersPage />)} />
        <Route path="/materias-primas" element={wrap(<MaterialsPage />)} />
        <Route path="/productos-base" element={wrap(<ProductBasesPage />)} />
        <Route path="/recetas-producto-base" element={wrap(<ProductBaseRecipesPage />)} />
        <Route path="/ordenes-compra" element={wrap(<OrdenesCompraPage />)} />
        <Route path="/recepcion" element={wrap(<RecepcionPage />)} />
        <Route path="/inventario-mp" element={wrap(<InventarioMpPage />)} />
        <Route path="/inventario-empaque" element={wrap(<InventarioEmpaquePage />)} />
        <Route path="/procesos-mp" element={wrap(<ProcesosMpPage />)} />
        <Route path="/inventario-procesado" element={wrap(<InventarioProcesadoPage />)} />
        <Route path="/empaque" element={wrap(<EmpaquePage />)} />
        <Route path="/cuarto frio" element={wrap(<CuartoFrioPage />)} />
        <Route path="/pedidos" element={wrap(<PedidosPage />)} />
        <Route path="/demanda-mp" element={wrap(<DemandaMpPage />)} />
        <Route path="/proyeccion-compras" element={wrap(<ProyeccionComprasPage />)} />
        <Route path="/logistica" element={wrap(<LogisticaPage />)} />
        <Route path="/reclamos" element={wrap(<ReclamosPage />)} />
        <Route path="/contabilidad" element={wrap(<ContabilidadPage />)} />
        <Route path="/cxc" element={wrap(<CxCPage />)} />
        <Route path="/cxp" element={wrap(<CxPPage />)} />
        <Route path="/gastos" element={wrap(<GastosPage />)} />
        <Route path="/cotizaciones" element={wrap(<CotizacionesPage />)} />
        <Route path="/vendedores" element={wrap(<VendedoresPage />)} />
        <Route path="/nomina" element={wrap(<NominaPage />)} />
        <Route path="/marcacion" element={wrapKiosk(<MarcacionPage />)} />
        <Route path="/calidad" element={wrap(<CalidadPage />)} />
        <Route path="/exportacion" element={wrap(<ExportacionPage />)} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
