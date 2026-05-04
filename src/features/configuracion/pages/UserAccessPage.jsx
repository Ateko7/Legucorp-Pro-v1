import { useEffect, useMemo, useState } from 'react'
import { getMyProfile } from '../../auth/services/authService'
import { MODULE_DEFINITIONS } from '../../auth/services/moduleAccess'
import { getUsersWithAccess, updateUserAccess } from '../services/userAccessService'

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

function moduleGroups() {
  return [
    { title: 'General', keys: ['dashboard', 'alert_center'] },
    { title: 'Comercial', keys: ['comercial_dashboard', 'prospectos', 'seguimientos', 'rentabilidad_clientes', 'inteligencia_comercial', 'pedidos', 'cotizaciones', 'clientes', 'vendedores', 'exportacion'] },
    { title: 'Abastecimiento', keys: ['ordenes_compra', 'recepcion', 'programas_siembra', 'programas_agricolas', 'proveedores', 'materias_primas'] },
    { title: 'Produccion e inventarios', keys: ['procesos_mp', 'empaque', 'recetas', 'productos_base', 'inventario_mp', 'inventario_procesado', 'inventario_empaque', 'cuarto_frio'] },
    { title: 'Logistica y calidad', keys: ['logistica', 'reclamos', 'calidad', 'trazabilidad', 'mantenimiento'] },
    { title: 'Finanzas', keys: ['cierres', 'contabilidad', 'facturas_fel', 'fel_intercompany', 'cxc', 'cxp', 'flujo_caja', 'caja', 'gastos'] },
    { title: 'Planeacion y sistema', keys: ['nomina', 'marcacion', 'presupuesto_ventas', 'demanda_mp', 'proyeccion_compras', 'configuracion_sistema', 'usuarios_permisos', 'importar_excel'] },
  ]
}

const MODULE_MAP = new Map(MODULE_DEFINITIONS.map((item) => [item.key, item]))

function AccessEditor({ user, onClose, onSaved }) {
  const [accessMode, setAccessMode] = useState(user.erp_access_mode || 'full')
  const [allowedModules, setAllowedModules] = useState(user.erp_allowed_modules || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleModule(moduleKey) {
    setAllowedModules((prev) =>
      prev.includes(moduleKey) ? prev.filter((item) => item !== moduleKey) : [...prev, moduleKey]
    )
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const uniqueModules = Array.from(new Set(allowedModules)).sort()
      const updated = await updateUserAccess(user.id, {
        erp_access_mode: accessMode,
        erp_allowed_modules: uniqueModules,
      })
      onSaved(updated)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el acceso del usuario')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        <div className="shrink-0 border-b border-stone-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-stone-900">Acceso por usuario</h2>
          <p className="mt-1 text-sm text-stone-500">
            {user.full_name || 'Sin nombre'} · {user.email || 'Sin correo'}
          </p>
        </div>

        <div className="overflow-y-auto px-6 py-6">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setAccessMode('full')}
              className={classNames(
                'rounded-xl border px-4 py-4 text-left',
                accessMode === 'full' ? 'border-[#2f5d50] bg-emerald-50' : 'border-stone-200 bg-white'
              )}
            >
              <div className="text-sm font-semibold text-stone-900">Acceso total</div>
              <div className="mt-1 text-sm text-stone-500">Puede entrar a todos los modulos visibles del ERP.</div>
            </button>
            <button
              type="button"
              onClick={() => setAccessMode('limited')}
              className={classNames(
                'rounded-xl border px-4 py-4 text-left',
                accessMode === 'limited' ? 'border-[#2f5d50] bg-emerald-50' : 'border-stone-200 bg-white'
              )}
            >
              <div className="text-sm font-semibold text-stone-900">Acceso limitado</div>
              <div className="mt-1 text-sm text-stone-500">Solo puede ver los modulos que selecciones abajo.</div>
            </button>
          </div>

          {accessMode === 'limited' ? (
            <div className="space-y-5">
              {moduleGroups().map((group) => {
                const modules = group.keys.map((key) => MODULE_MAP.get(key)).filter(Boolean)
                return (
                  <section key={group.title} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <h3 className="text-sm font-semibold text-stone-900">{group.title}</h3>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {modules.map((module) => (
                        <label key={module.key} className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm">
                          <input
                            type="checkbox"
                            checked={allowedModules.includes(module.key)}
                            onChange={() => toggleModule(module.key)}
                            className="mt-0.5 h-4 w-4 rounded border-stone-300 text-[#2f5d50] focus:ring-[#2f5d50]"
                          />
                          <span className="text-stone-700">{module.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

        </div>
        </div>

        <div className="shrink-0 flex justify-end gap-3 border-t border-stone-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="rounded-lg bg-[#2f5d50] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar acceso'}
            </button>
          </div>
      </div>
    </div>
  )
}

export default function UserAccessPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editingUser, setEditingUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    load()
    getMyProfile().then((p) => setIsAdmin(!!p?.is_admin)).catch(() => setIsAdmin(false))
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await getUsersWithAccess()
      setUsers(data)
    } catch (err) {
      setError(err.message || 'No se pudieron cargar los usuarios')
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter((user) =>
      [user.full_name, user.email, user.role].some((value) => String(value || '').toLowerCase().includes(term))
    )
  }, [users, search])

  function handleSaved(updatedUser) {
    setUsers((prev) => prev.map((user) => (user.id === updatedUser.id ? updatedUser : user)))
    setEditingUser(null)
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">Usuarios y permisos</h1>
          <p className="mt-2 text-sm text-stone-500">
            Revisa los usuarios del ERP y define si tienen acceso total o solo a modulos puntuales.
          </p>
        </div>
        <div className="w-full md:w-80">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar usuario..."
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#2f5d50]"
          />
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="text-base font-semibold text-stone-900">Usuarios de la organizacion</h2>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-sm text-stone-500">Cargando usuarios...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="px-5 py-10 text-sm text-stone-500">No se encontraron usuarios.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-stone-200 text-sm">
              <thead className="bg-stone-50 text-left text-stone-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Usuario</th>
                  <th className="px-5 py-3 font-medium">Rol</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 font-medium">Acceso</th>
                  <th className="px-5 py-3 font-medium">Modulos</th>
                  <th className="px-5 py-3 font-medium text-right">Accion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredUsers.map((user) => {
                  const allowedCount = Array.isArray(user.erp_allowed_modules) ? user.erp_allowed_modules.length : 0
                  return (
                    <tr key={user.id}>
                      <td className="px-5 py-4">
                        <div className="font-medium text-stone-900">{user.full_name || 'Sin nombre'}</div>
                        <div className="mt-1 text-xs text-stone-500">{user.email || 'Sin correo'}</div>
                      </td>
                      <td className="px-5 py-4 text-stone-700">{user.role || 'Sin rol'}</td>
                      <td className="px-5 py-4">
                        <span className={classNames(
                          'rounded-md px-2.5 py-1 text-xs font-medium',
                          user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-600'
                        )}>
                          {user.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-stone-700">
                        {user.is_admin || (user.erp_access_mode || 'full') === 'full' ? 'Total' : 'Limitado'}
                      </td>
                      <td className="px-5 py-4 text-stone-500">
                        {user.is_admin || (user.erp_access_mode || 'full') === 'full' ? 'Todos los modulos' : `${allowedCount} modulo(s)`}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => setEditingUser(user)}
                            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
                          >
                            Editar acceso
                          </button>
                        ) : (
                          <span className="text-xs text-stone-400">Sin permiso</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingUser ? (
        <AccessEditor
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  )
}
