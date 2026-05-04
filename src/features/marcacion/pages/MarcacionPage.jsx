import { useEffect, useRef, useState, useCallback } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import { useNavigate } from 'react-router-dom'
import { getMyProfile, getOperatorSetupStatus } from '../../auth/services/authService'
import { getEmpleado, getEmpleados } from '../../nomina/services/empleadosService'
import { getBiometriaFacialEmpleado } from '../../nomina/services/biometriaFacialService'
import { getMarcacionHoy, registrarMarcacionConFoto, subirFotoMarcacion } from '../../nomina/services/marcacionesService'
import { obtenerUbicacion, validarDistancia } from '../../nomina/services/sedesService'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dataURLtoBlob(dataurl) {
  const arr  = dataurl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  let n      = bstr.length
  const u8   = new Uint8Array(n)
  while (n--) u8[n] = bstr.charCodeAt(n)
  return new Blob([u8], { type: mime })
}

function isBirthdayToday(fechaNacimiento) {
  if (!fechaNacimiento) return false
  const today = new Date()
  const isoToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(5, 10)
  return String(fechaNacimiento).slice(5, 10) === isoToday
}

const PASO_COLOR = { valido: 'text-emerald-600', invalido: 'text-red-600', cargando: 'text-amber-500' }

function siguienteTipoMarcacion(marcacion) {
  if (!marcacion?.hora_entrada) return 'entrada'
  if (!marcacion?.hora_salida) return 'salida'
  return null
}

// ─── Componentes pequeños ─────────────────────────────────────────────────────

function Reloj() {
  const [hora, setHora] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="text-center">
      <p className="text-6xl font-bold tabular-nums text-white drop-shadow">
        {hora.toTimeString().slice(0, 8)}
      </p>
      <p className="mt-1 text-base font-medium text-white/80 capitalize">
        {hora.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </div>
  )
}

function Badge({ text, color }) {
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-bold ${color}`}>{text}</span>
  )
}

function BirthdayRain({ show }) {
  if (!show) return null

  const emojis = ['🎉', '🎊', '🥳', '🎂', '🎈', '✨', '🎉', '🎊', '🥳', '🎂', '🎈', '✨']

  return (
    <>
      <style>{`
        @keyframes birthday-fall {
          0% { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translate3d(0, 110vh, 0) rotate(360deg); opacity: 0; }
        }
      `}</style>
      <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
        {emojis.map((emoji, idx) => (
          <span
            key={`${emoji}-${idx}`}
            className="absolute top-[-10vh] text-3xl md:text-4xl"
            style={{
              left: `${6 + idx * 7.5}%`,
              animationName: 'birthday-fall',
              animationDuration: `${3.4 + (idx % 4) * 0.45}s`,
              animationDelay: `${(idx % 6) * 0.18}s`,
              animationIterationCount: 1,
              animationTimingFunction: 'linear',
            }}
          >
            {emoji}
          </span>
        ))}
      </div>
    </>
  )
}

// ─── PÁGINA PRINCIPAL ─────────────────────────────────────────────────────────

export default function MarcacionPage() {
  const navigate = useNavigate()

  // Operarios
  const [operarios, setOperarios]   = useState([])
  const [search, setSearch]         = useState('')
  const [loadingOps, setLoadingOps] = useState(true)

  // Selección y estado
  const [selected, setSelected]     = useState(null) // empleado seleccionado
  const [marcHoy, setMarcHoy]       = useState(null)  // marcación de hoy
  const [tipoMarc, setTipoMarc]     = useState('entrada')

  // Flujo de pasos: 'inicio' | 'geo' | 'camara' | 'preview' | 'subiendo' | 'ok' | 'error_geo'
  const [paso, setPaso]             = useState('inicio')

  // Geolocalización
  const [geoData, setGeoData]       = useState(null)   // { latitud, longitud, distancia, valido }
  const [geoError, setGeoError]     = useState('')
  const [geoLoading, setGeoLoading] = useState(false)

  // Cámara
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const [camaraLista, setCamaraLista] = useState(false)
  const [camaraError, setCamaraError] = useState('')
  const [fotoDataUrl, setFotoDataUrl] = useState(null)
  const [fotoBlob, setFotoBlob]       = useState(null)

  // Resultado
  const [msgOk, setMsgOk]   = useState('')
  const [error, setError]   = useState('')
  const [busy, setBusy]     = useState(false)
  const [showBirthdayRain, setShowBirthdayRain] = useState(false)
  const [biometria, setBiometria] = useState(null)
  const [biometriaLoading, setBiometriaLoading] = useState(false)
  const [authProfile, setAuthProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  // ─── Cargar operarios ────────────────────────────────────────────────────
  const cargarOperarios = useCallback(async () => {
    if (authProfile?.role === 'operario') {
      setOperarios([])
      setLoadingOps(false)
      return
    }

    setLoadingOps(true)
    try {
      const data = await getEmpleados({ tipo: 'operario', estado: 'activo' })
      setOperarios(data)
    } catch {
      // Mantener el flujo de marcacion aunque falle la carga auxiliar.
    }
    finally { setLoadingOps(false) }
  }, [authProfile?.role])

  useEffect(() => {
    if (!profileLoading) cargarOperarios()
  }, [cargarOperarios, profileLoading])
  useRealtimeRefresh(['employees', 'marcaciones'], cargarOperarios)

  // ─── Seleccionar empleado ─────────────────────────────────────────────────
  async function seleccionar(emp) {
    setSelected(emp)
    setSearch('')
    setGeoData(null); setGeoError(''); setFotoDataUrl(null); setFotoBlob(null)
    setError(''); setMsgOk(''); setPaso('inicio')
    setShowBirthdayRain(false)
    setBiometria(null)
    setBiometriaLoading(true)

    const [marc, bio] = await Promise.all([
      getMarcacionHoy(emp.id).catch(() => null),
      getBiometriaFacialEmpleado(emp.id).catch(() => null),
    ])
    setMarcHoy(marc)
    setBiometria(bio)
    setBiometriaLoading(false)
    setTipoMarc(siguienteTipoMarcacion(marc))
  }

  function resetear() {
    detenerCamara()
    if (authProfile?.role === 'operario') {
      setTipoMarc(siguienteTipoMarcacion(marcHoy))
    } else {
      setSelected(null); setMarcHoy(null); setTipoMarc('entrada')
    }
    setGeoData(null); setGeoError(''); setFotoDataUrl(null); setFotoBlob(null)
    setError(''); setMsgOk(''); setPaso('inicio')
    setShowBirthdayRain(false)
    setBiometria(null)
    setBiometriaLoading(false)
  }

  // ─── Geolocalización ─────────────────────────────────────────────────────
  async function detectarUbicacion() {
    setGeoLoading(true); setGeoError(''); setGeoData(null)
    try {
      const pos   = await obtenerUbicacion()
      const sede  = selected?.sedes_trabajo || null
      if (!sede) throw new Error('Este operario no tiene sede asignada. Contacta a RRHH.')
      const valid = validarDistancia(pos.latitud, pos.longitud, sede)
      setGeoData({ ...pos, ...valid, sede })
    } catch (e) {
      setGeoError(e.message)
    }
    finally { setGeoLoading(false) }
  }

  // ─── Cámara ──────────────────────────────────────────────────────────────
  async function iniciarCamara() {
    setCamaraError(''); setCamaraLista(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play()
          setCamaraLista(true)
        }
      }
    } catch (e) {
      setCamaraError('No se pudo acceder a la cámara: ' + (e.message || 'Error desconocido'))
    }
  }

  function detenerCamara() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCamaraLista(false)
  }

  function capturarFoto() {
    if (!videoRef.current || !canvasRef.current) return
    const video  = videoRef.current
    const canvas = canvasRef.current
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    // Espejo horizontal (selfie natural)
    ctx.save()
    ctx.scale(-1, 1)
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
    ctx.restore()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setFotoDataUrl(dataUrl)
    setFotoBlob(dataURLtoBlob(dataUrl))
    detenerCamara()
    setPaso('preview')
  }

  function retomar() {
    setFotoDataUrl(null); setFotoBlob(null)
    setPaso('camara')
    iniciarCamara()
  }

  // ─── Avanzar pasos ───────────────────────────────────────────────────────
  function irAGeo() { setPaso('geo'); detectarUbicacion() }
  function irACamara() { setPaso('camara'); iniciarCamara() }

  // ─── Confirmar y registrar ────────────────────────────────────────────────
  async function confirmarMarcacion() {
    if (!fotoBlob || !geoData) return
    setBusy(true); setError(''); setPaso('subiendo')
    try {
      const fotoUrl = await subirFotoMarcacion(fotoBlob, selected.id, tipoMarc)
      await registrarMarcacionConFoto(selected.id, tipoMarc, {
        sede_id:        selected.sede_id || null,
        foto_url:       fotoUrl,
        latitud:        geoData.latitud,
        longitud:       geoData.longitud,
        distancia:      geoData.distancia,
        validacion_geo: geoData.valido,
      })
      const marc = await getMarcacionHoy(selected.id).catch(() => null)
      setMarcHoy(marc)
      setTipoMarc(siguienteTipoMarcacion(marc))
      const birthdayEntry = tipoMarc === 'entrada' && isBirthdayToday(selected?.fecha_nacimiento)
      setMsgOk(tipoMarc === 'entrada'
        ? `✓ Entrada registrada a las ${new Date().toTimeString().slice(0,5)}`
        : `✓ Salida registrada a las ${new Date().toTimeString().slice(0,5)}`)
      setShowBirthdayRain(birthdayEntry)
      if (birthdayEntry) {
        setTimeout(() => setShowBirthdayRain(false), 5000)
      }
      setPaso('ok')
    } catch (e) {
      setError(e.message)
      setPaso('preview')
    }
    finally { setBusy(false) }
  }

  // ─── Cleanup al salir ─────────────────────────────────────────────────────
  useEffect(() => () => detenerCamara(), [])

  useEffect(() => {
    let active = true

    async function loadProfileContext() {
      try {
        const profile = await getMyProfile().catch(() => null)
        if (!active) return
        setAuthProfile(profile)

        if (profile?.role === 'operario') {
          const setup = await getOperatorSetupStatus(profile).catch(() => null)
          if (!active) return

          if (setup?.needsSetup) {
            navigate('/operario-onboarding', { replace: true })
            return
          }

          if (!profile.empleado_id) {
            setError('Tu usuario operario no está vinculado a un empleado. Contacta a RRHH.')
            setLoadingOps(false)
            return
          }

          const emp = await getEmpleado(profile.empleado_id).catch(() => null)
          if (!active) return

          if (!emp) {
            setError('No se encontró el empleado vinculado a tu usuario.')
            setLoadingOps(false)
            return
          }

          await seleccionar(emp)
        }
      } finally {
        if (active) setProfileLoading(false)
      }
    }

    loadProfileContext()
    return () => { active = false }
  }, [navigate])

  // ─── Filtro de búsqueda ───────────────────────────────────────────────────
  const filtrados = operarios.filter(e =>
    !search || `${e.nombres} ${e.apellidos} ${e.codigo_empleado}`.toLowerCase().includes(search.toLowerCase())
  )
  const operarioAutenticado = authProfile?.role === 'operario'

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#2f5d50]">
      <BirthdayRain show={showBirthdayRain} />

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-[#264d42] px-6 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-2xl border border-white/30 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/10"
          >
            ← Regresar
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">LegucorpPro</p>
            <p className="text-lg font-bold text-white">Marcación de Operarios</p>
          </div>
        </div>
        <Reloj />
        {selected && !operarioAutenticado && (
          <button onClick={resetear} className="rounded-2xl border border-white/30 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/10">
            ← Cambiar
          </button>
        )}
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">

        {/* ── Selección de operario ─────────────────────────────────── */}
        {!selected && !operarioAutenticado && (
          <div className="space-y-4">
            <div className="rounded-3xl bg-white/10 px-5 py-4">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/70">
                Selecciona tu nombre
              </p>
              <input
                type="text"
                placeholder="Buscar por nombre o código..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-2xl border-0 bg-white/20 px-4 py-3 text-base text-white placeholder-white/50 outline-none focus:bg-white/30"
                autoFocus
              />
            </div>

            {loadingOps ? (
              <div className="flex justify-center py-6">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {filtrados.length === 0 && (
                  <p className="py-6 text-center text-sm text-white/50">
                    {operarios.length === 0
                      ? 'No hay operarios registrados. Configura los empleados en Nómina → Empleados.'
                      : 'Sin resultados'}
                  </p>
                )}
                {filtrados.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => seleccionar(emp)}
                    className="w-full rounded-3xl bg-white/15 px-5 py-4 text-left hover:bg-white/25 active:scale-[0.98] transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-base font-bold text-white">
                          {emp.apellidos}, {emp.nombres}
                        </p>
                        <p className="text-xs text-white/60">
                          {emp.codigo_empleado} · {emp.puesto || 'Operario'}
                          {emp.sedes_trabajo ? ` · ${emp.sedes_trabajo.nombre}` : ' · Sin sede'}
                        </p>
                      </div>
                      <span className="text-2xl text-white/50">›</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Empleado seleccionado ─────────────────────────────────── */}
        {!selected && operarioAutenticado && (
          <div className="space-y-3 rounded-3xl bg-white/10 px-5 py-8 text-center text-white/80">
            {profileLoading ? 'Cargando tu perfil de marcación...' : 'Preparando tu sesión de marcación...'}
          </div>
        )}

        {selected && (
          <div className="space-y-5">

            {/* Card del empleado */}
            <div className="rounded-3xl bg-white px-6 py-5 shadow-xl">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xl font-bold text-stone-800">{selected.apellidos}, {selected.nombres}</p>
                  <p className="text-sm text-stone-500">{selected.codigo_empleado} · {selected.puesto || 'Operario'}</p>
                </div>
                <div className="text-right text-xs text-stone-400">
                  <p>Sede: <span className="font-semibold text-stone-600">
                    {selected.sedes_trabajo?.nombre || 'Sin sede asignada'}
                  </span></p>
                  {selected.sedes_trabajo && (
                    <p className="mt-0.5">Radio: {selected.sedes_trabajo.radio_metros}m</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {biometriaLoading ? (
                  <Badge text="Verificando biometría..." color="bg-stone-100 text-stone-600" />
                ) : biometria?.enrollment_status === 'active' ? (
                  <Badge text="Biometría facial activa" color="bg-emerald-100 text-emerald-700" />
                ) : (
                  <Badge text="Sin biometría facial enrolada" color="bg-amber-100 text-amber-700" />
                )}
              </div>

              {/* Estado de marcación hoy */}
              <div className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm">
                {!marcHoy?.hora_entrada && (
                  <p className="text-stone-500">Sin marcación hoy</p>
                )}
                {marcHoy?.hora_entrada && (
                  <div className="flex flex-wrap gap-4">
                    <span>Entrada: <strong className="text-emerald-700">{marcHoy.hora_entrada?.slice(0,5)}</strong></span>
                    {marcHoy.hora_salida
                      ? <span>Salida: <strong className="text-[#2f5d50]">{marcHoy.hora_salida?.slice(0,5)}</strong></span>
                      : <span className="text-amber-600 font-semibold">Pendiente de salida</span>
                    }
                    {marcHoy.horas_trabajadas && (
                      <span>Horas: <strong>{Number(marcHoy.horas_trabajadas).toFixed(2)}h</strong></span>
                    )}
                    {!marcHoy.validacion_geo_entrada && marcHoy.hora_entrada && (
                      <Badge text="Geo no validada" color="bg-amber-100 text-amber-700" />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Bloqueado: ya completó entrada y salida ──────────── */}
            {marcHoy?.hora_entrada && marcHoy?.hora_salida && paso !== 'ok' && (
              <div className="rounded-3xl bg-white px-6 py-6 text-center shadow-xl">
                <p className="text-5xl">✅</p>
                <p className="mt-3 text-lg font-bold text-stone-800">Jornada completa</p>
                <p className="text-sm text-stone-500">Ya registraste entrada y salida hoy.</p>
                <button onClick={resetear} className="mt-5 rounded-2xl bg-[#2f5d50] px-6 py-3 text-sm font-bold text-white hover:bg-[#264d42]">
                  Volver
                </button>
              </div>
            )}

            {/* ── Botones de inicio ─────────────────────────────────── */}
            {tipoMarc && paso === 'inicio' && (
              <button
                onClick={irAGeo}
                className={`w-full rounded-3xl py-7 text-2xl font-black shadow-xl transition active:scale-[0.97] ${
                  tipoMarc === 'entrada'
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'bg-[#2f5d50] text-white hover:bg-[#264d42]'
                }`}
              >
                {tipoMarc === 'entrada' ? '🟢 MARCAR ENTRADA' : '🔴 MARCAR SALIDA'}
              </button>
            )}

            {/* ── PASO 1: Geolocalización ───────────────────────────── */}
            {paso === 'geo' && (
              <div className="rounded-3xl bg-white px-6 py-6 shadow-xl space-y-4">
                <h3 className="text-lg font-bold text-stone-800">Paso 1 — Verificando ubicación</h3>

                {geoLoading && (
                  <div className="flex items-center gap-3 text-amber-600">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                    <span className="text-sm font-medium">Obteniendo ubicación GPS...</span>
                  </div>
                )}

                {!geoLoading && geoError && (
                  <div className="space-y-3">
                    <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{geoError}</p>
                    <button onClick={detectarUbicacion} className="rounded-2xl border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
                      Reintentar
                    </button>
                  </div>
                )}

                {!geoLoading && geoData && (
                  <div className="space-y-3">
                    <div className={`flex items-center gap-3 rounded-2xl px-4 py-4 ${geoData.valido ? 'bg-emerald-50' : 'bg-red-50'}`}>
                      <span className="text-3xl">{geoData.valido ? '✅' : '❌'}</span>
                      <div>
                        <p className={`font-bold text-base ${geoData.valido ? 'text-emerald-700' : 'text-red-700'}`}>
                          {geoData.valido ? 'En rango — dentro de la sede' : 'Fuera de rango'}
                        </p>
                        <p className="text-xs text-stone-500">
                          Distancia: <strong>{geoData.distancia}m</strong> · Radio permitido: <strong>{geoData.sede?.radio_metros}m</strong>
                        </p>
                        <p className="text-xs text-stone-400">
                          Sede: {geoData.sede?.nombre}
                        </p>
                      </div>
                    </div>

                    {geoData.valido ? (
                      <button
                        onClick={irACamara}
                        className="w-full rounded-3xl bg-[#2f5d50] py-4 text-base font-bold text-white hover:bg-[#264d42]"
                      >
                        Continuar → Tomar foto
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-stone-500">No estás dentro del área de la sede. Acércate a <strong>{geoData.sede?.nombre}</strong>.</p>
                        <button onClick={detectarUbicacion} className="w-full rounded-2xl border border-stone-300 py-3 text-sm font-semibold hover:bg-stone-50">
                          Actualizar ubicación
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── PASO 2: Cámara ────────────────────────────────────── */}
            {paso === 'camara' && (
              <div className="rounded-3xl bg-white px-6 py-6 shadow-xl space-y-4">
                <h3 className="text-lg font-bold text-stone-800">Paso 2 — Toma tu selfie</h3>

                {camaraError && (
                  <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{camaraError}</p>
                )}

                <div className="relative overflow-hidden rounded-2xl bg-stone-900" style={{ aspectRatio: '4/3' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  {!camaraLista && !camaraError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-600 border-t-white" />
                    </div>
                  )}
                  {/* Guía de encuadre */}
                  {camaraLista && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="h-48 w-36 rounded-full border-2 border-white/50 border-dashed" />
                    </div>
                  )}
                </div>

                <canvas ref={canvasRef} className="hidden" />

                <button
                  onClick={capturarFoto}
                  disabled={!camaraLista}
                  className="w-full rounded-3xl bg-stone-800 py-5 text-xl font-black text-white disabled:opacity-40 hover:bg-stone-700 active:scale-[0.97] transition"
                >
                  📸 Capturar foto
                </button>
              </div>
            )}

            {/* ── PASO 3: Preview foto ──────────────────────────────── */}
            {(paso === 'preview' || paso === 'subiendo') && fotoDataUrl && (
              <div className="rounded-3xl bg-white px-6 py-6 shadow-xl space-y-4">
                <h3 className="text-lg font-bold text-stone-800">Paso 3 — Confirmar marcación</h3>

                <div className="overflow-hidden rounded-2xl bg-stone-100" style={{ aspectRatio: '4/3' }}>
                  <img src={fotoDataUrl} alt="selfie" className="h-full w-full object-cover" />
                </div>

                {/* Resumen */}
                <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Tipo</span>
                    <strong className={tipoMarc === 'entrada' ? 'text-emerald-700' : 'text-[#2f5d50]'}>
                      {tipoMarc === 'entrada' ? 'ENTRADA' : 'SALIDA'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Hora</span>
                    <strong>{new Date().toTimeString().slice(0,5)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Sede</span>
                    <span>{geoData?.sede?.nombre || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Distancia</span>
                    <span className="text-emerald-600 font-semibold">{geoData?.distancia}m ✓</span>
                  </div>
                </div>

                {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={retomar}
                    disabled={busy}
                    className="rounded-3xl border border-stone-300 py-4 text-sm font-bold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
                  >
                    Repetir foto
                  </button>
                  <button
                    onClick={confirmarMarcacion}
                    disabled={busy}
                    className="rounded-3xl bg-[#2f5d50] py-4 text-base font-black text-white hover:bg-[#264d42] disabled:opacity-40 active:scale-[0.97] transition"
                  >
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Registrando...
                      </span>
                    ) : '✓ Confirmar'}
                  </button>
                </div>
              </div>
            )}

            {/* ── PASO 4: Éxito ─────────────────────────────────────── */}
            {paso === 'ok' && (
              <div className="rounded-3xl bg-white px-6 py-10 text-center shadow-xl space-y-4">
                <p className="text-6xl">✅</p>
                <p className="text-2xl font-black text-emerald-700">{msgOk}</p>
                {tipoMarc === 'entrada' && isBirthdayToday(selected?.fecha_nacimiento) && (
                  <div className="rounded-3xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-pink-50 px-5 py-4">
                    <p className="text-lg font-black text-amber-700">El equipo Legucorp te desea un feliz cumpleaños!</p>
                  </div>
                )}
                <p className="text-sm text-stone-500">
                  {selected.nombres} {selected.apellidos}
                </p>
                {fotoDataUrl && (
                  <img src={fotoDataUrl} alt="selfie" className="mx-auto h-24 w-24 rounded-full object-cover border-4 border-emerald-200" />
                )}
                <div className="pt-2 space-y-2">
                  {marcHoy?.hora_entrada && !marcHoy?.hora_salida && (
                    <button
                      onClick={() => { setTipoMarc('salida'); setPaso('inicio') }}
                      className="w-full rounded-3xl bg-stone-100 py-3 text-sm font-bold text-stone-700 hover:bg-stone-200"
                    >
                      Marcar salida ahora
                    </button>
                  )}
                  <button
                    onClick={resetear}
                    className="w-full rounded-3xl bg-[#2f5d50] py-4 text-base font-bold text-white hover:bg-[#264d42]"
                  >
                    {operarioAutenticado ? 'Listo' : 'Listo — Siguiente operario'}
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  )
}
