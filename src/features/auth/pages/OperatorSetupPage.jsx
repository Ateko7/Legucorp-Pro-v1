import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { getMyProfile, getOperatorSetupStatus } from '../services/authService'
import { getSedes } from '../../nomina/services/sedesService'
import { getEmpleado, updateEmpleadoSede } from '../../nomina/services/empleadosService'
import {
  getBiometriaFacialEmpleado,
  subirFotoBiometriaFacial,
  upsertBiometriaFacialEmpleado,
} from '../../nomina/services/biometriaFacialService'

const INP = 'w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800 outline-none transition focus:border-[#2f5d50] focus:bg-white focus:ring-4 focus:ring-[#2f5d50]/10'

function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8 = new Uint8Array(n)
  while (n--) u8[n] = bstr.charCodeAt(n)
  return new Blob([u8], { type: mime })
}

export default function OperatorSetupPage() {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState(null)
  const [empleado, setEmpleado] = useState(null)
  const [sedes, setSedes] = useState([])
  const [biometria, setBiometria] = useState(null)
  const [sedeId, setSedeId] = useState('')
  const [fotoDataUrl, setFotoDataUrl] = useState(null)
  const [fotoBlob, setFotoBlob] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const myProfile = await getMyProfile()
        if (!active) return
        setProfile(myProfile)

        if (myProfile?.role !== 'operario' || !myProfile?.empleado_id) {
          return
        }

        const [setup, sedesData, empleadoData, biometriaData] = await Promise.all([
          getOperatorSetupStatus(myProfile),
          getSedes(true),
          getEmpleado(myProfile.empleado_id),
          getBiometriaFacialEmpleado(myProfile.empleado_id).catch(() => null),
        ])

        if (!active) return

        if (!setup.needsSetup) {
          navigate('/marcacion', { replace: true })
          return
        }

        setSedes(sedesData)
        setEmpleado(empleadoData)
        setBiometria(biometriaData)
        setSedeId(empleadoData?.sede_id || '')
      } catch (err) {
        if (!active) return
        setError(err.message || 'No se pudo preparar el onboarding del operario')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [navigate])

  useEffect(() => {
    if (loading || profile?.role !== 'operario') return

    let cancelled = false

    async function startCamera() {
      setCameraReady(false)
      setCameraError('')

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            if (cancelled) return
            videoRef.current.play()
            setCameraReady(true)
          }
        }
      } catch {
        if (!cancelled) {
          setCameraError('No se pudo acceder a la cámara. Revisa permisos del navegador.')
        }
      }
    }

    if (!fotoDataUrl && biometria?.enrollment_status !== 'active') {
      startCamera()
    }

    return () => {
      cancelled = true
    }
  }, [loading, profile?.role, biometria?.enrollment_status, fotoDataUrl])

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current

    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.scale(-1, 1)
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
    ctx.restore()

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setFotoDataUrl(dataUrl)
    setFotoBlob(dataURLtoBlob(dataUrl))

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  function retakePhoto() {
    setFotoDataUrl(null)
    setFotoBlob(null)
    setBiometria((prev) => (prev?.enrollment_status === 'active' ? prev : null))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!empleado?.id) {
      setError('No se encontró el empleado del operario.')
      return
    }

    if (!sedeId) {
      setError('Debes seleccionar una sede de trabajo.')
      return
    }

    if (biometria?.enrollment_status !== 'active' && !fotoBlob) {
      setError('Debes capturar tu foto para crear la biometría facial.')
      return
    }

    setSaving(true)
    try {
      await updateEmpleadoSede(empleado.id, sedeId)

      if (fotoBlob) {
        const fotoUrl = await subirFotoBiometriaFacial(fotoBlob, empleado.id)
        const savedBio = await upsertBiometriaFacialEmpleado({
          empleadoId: empleado.id,
          profileId: profile.id,
          enrollmentPhotoUrl: fotoUrl,
          metadata: {
            source: 'operator_onboarding',
            enrolled_at: new Date().toISOString(),
          },
        })
        setBiometria(savedBio)
      }

      setSuccess('Configuración lista. Ya puedes ingresar a Marcación.')
      setTimeout(() => navigate('/marcacion', { replace: true }), 900)
    } catch (err) {
      setError(err.message || 'No se pudo guardar la configuración del operario')
    } finally {
      setSaving(false)
    }
  }

  if (!loading && profile && profile.role !== 'operario') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f1e8] px-4 py-12">
      <div className="w-full max-w-3xl rounded-3xl border border-[#dccfbe] bg-white p-7 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-stone-900">Configura tu acceso</h1>
          <p className="mt-2 text-sm text-stone-500">
            Antes de entrar a Marcación necesitamos tu sede de trabajo y tu biometría facial.
          </p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-stone-500">Preparando tu configuración...</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
              <p className="text-sm font-semibold text-stone-800">Operario</p>
              <p className="mt-1 text-sm text-stone-500">
                {empleado ? `${empleado.apellidos}, ${empleado.nombres} · ${empleado.codigo_empleado}` : 'Sin empleado vinculado'}
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-stone-700">Sede de trabajo</span>
                  <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} className={INP} required>
                    <option value="">Selecciona una sede</option>
                    {sedes.map((sede) => (
                      <option key={sede.id} value={sede.id}>
                        {sede.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-stone-500">
                  Esta sede se usará para validar que tu marcación ocurra dentro del rango permitido.
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-stone-700">Biometría facial</p>
                {biometria?.enrollment_status === 'active' && !fotoDataUrl ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    Ya tienes biometría facial activa. Si quieres reemplazarla, toma una foto nueva.
                  </div>
                ) : null}

                <div className="overflow-hidden rounded-2xl bg-stone-900" style={{ aspectRatio: '4/3' }}>
                  {fotoDataUrl ? (
                    <img src={fotoDataUrl} alt="Biometría facial" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-full w-full object-cover"
                        style={{ transform: 'scaleX(-1)' }}
                      />
                      {!cameraReady && !cameraError && (
                        <div className="flex h-full items-center justify-center text-sm text-white/70">
                          Activando cámara...
                        </div>
                      )}
                    </>
                  )}
                </div>

                <canvas ref={canvasRef} className="hidden" />

                {cameraError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {cameraError}
                  </div>
                )}

                <div className="flex gap-3">
                  {!fotoDataUrl ? (
                    <button
                      type="button"
                      onClick={capturePhoto}
                      disabled={!cameraReady}
                      className="flex-1 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-60"
                    >
                      Capturar foto
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={retakePhoto}
                      className="flex-1 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                    >
                      Repetir foto
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}
            {success && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-2xl bg-[#2f5d50] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#264c42] disabled:opacity-60"
            >
              {saving ? 'Guardando configuración...' : 'Continuar a Marcación'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
