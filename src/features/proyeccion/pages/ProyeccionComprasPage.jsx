import { useState, useEffect, useCallback } from 'react'
import { getProyeccionData } from '../services/proyeccionService'

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const WEEK_OPTIONS = [4, 8, 12]

function fmt(value, decimals = 2) {
  const num = Number(value)
  if (isNaN(num)) return '0'
  return num.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

function ConfidenceBadge({ confidence }) {
  const styles = {
    alta: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    media: 'border-amber-200 bg-amber-50 text-amber-800',
    baja: 'border-red-200 bg-red-50 text-red-700',
  }
  const labels = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' }
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[confidence] || styles.baja}`}>
      {labels[confidence] || 'Baja'}
    </span>
  )
}

// Mini bar chart sparkline using raw_values
function Sparkline({ values, suggested }) {
  if (!values || values.length === 0) return <span className="text-xs text-stone-400">Sin datos</span>

  const max = Math.max(...values, suggested, 0.001)

  return (
    <div className="flex items-end gap-0.5 h-8">
      {values.map((v, i) => {
        const pct = max > 0 ? (v / max) * 100 : 0
        return (
          <div
            key={i}
            className="w-2 rounded-sm bg-[#2f5d50] opacity-70"
            style={{ height: `${Math.max(pct, 4)}%` }}
            title={`${fmt(v)}`}
          />
        )
      })}
      {/* Suggested line marker */}
      <div
        className="w-1 rounded-sm bg-amber-400"
        style={{ height: `${Math.max((suggested / max) * 100, 4)}%` }}
        title={`Sugerido: ${fmt(suggested)}`}
      />
    </div>
  )
}

// Card for a single material showing one day's stats
function MaterialDayCard({ material, dow }) {
  const day = material.days[dow]

  const hasData = day && day.occurrences > 0 && day.avg > 0

  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{material.code}</span>
          <p className="mt-0.5 text-base font-semibold text-stone-800">{material.name}</p>
        </div>
        {hasData ? (
          <ConfidenceBadge confidence={day.confidence} />
        ) : (
          <span className="rounded-full border border-stone-200 bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-400">Sin datos</span>
        )}
      </div>

      {hasData ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-stone-500 uppercase tracking-wider">Promedio hist.</p>
            <p className="mt-0.5 text-sm font-semibold text-stone-800">
              {fmt(day.avg)} <span className="text-xs text-stone-400">{material.base_unit}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500 uppercase tracking-wider">Mínimo</p>
            <p className="mt-0.5 text-sm font-semibold text-stone-800">
              {fmt(day.min)} <span className="text-xs text-stone-400">{material.base_unit}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500 uppercase tracking-wider">Máximo</p>
            <p className="mt-0.5 text-sm font-semibold text-stone-800">
              {fmt(day.max)} <span className="text-xs text-stone-400">{material.base_unit}</span>
            </p>
          </div>
          <div className="rounded-2xl bg-[#2f5d50]/8 border border-[#2f5d50]/20 p-2">
            <p className="text-xs font-semibold text-[#2f5d50] uppercase tracking-wider">Sugerido</p>
            <p className="mt-0.5 text-sm font-bold text-[#2f5d50]">
              {fmt(day.suggested)} <span className="text-xs font-semibold">{material.base_unit}</span>
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-400">No hubo recepciones este día de la semana en el período.</p>
      )}

      {hasData && (
        <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Sparkline values={day.raw_values} suggested={day.suggested} />
            <span className="text-xs text-stone-400">variabilidad: ±{fmt(day.stddev, 1)} {material.base_unit}</span>
          </div>
          <span className="text-xs text-stone-400">{day.occurrences} semanas analizadas</span>
        </div>
      )}
    </div>
  )
}

// Full week table for a material
function MaterialWeekTable({ material }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-100">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{material.code}</span>
        <p className="mt-0.5 text-base font-semibold text-stone-800">{material.name}</p>
        <p className="text-xs text-stone-400 mt-0.5">Promedio semanal: {fmt(material.weekly_avg)} {material.base_unit}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-400">Día</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Promedio</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Mín</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Máx</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-stone-400">Variabilidad</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[#2f5d50]">Sugerido</th>
              <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-stone-400">Confianza</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
              const day = material.days[dow]
              const hasData = day && day.avg > 0
              const isToday = dow === new Date().getDay()
              return (
                <tr
                  key={dow}
                  className={`border-b border-stone-100 last:border-0 ${isToday ? 'bg-[#2f5d50]/5' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-stone-700">
                    {DAY_NAMES[dow]}
                    {isToday && <span className="ml-2 text-xs font-semibold text-[#2f5d50]">← hoy</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-600">
                    {hasData ? `${fmt(day.avg)} ${material.base_unit}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-500">
                    {hasData ? `${fmt(day.min)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-500">
                    {hasData ? `${fmt(day.max)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-500">
                    {hasData ? `±${fmt(day.stddev, 1)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-[#2f5d50]">
                    {hasData ? `${fmt(day.suggested)} ${material.base_unit}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {hasData ? <ConfidenceBadge confidence={day.confidence} /> : <span className="text-stone-300">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ProyeccionComprasPage() {
  const [weeks, setWeeks] = useState(4)
  const [viewMode, setViewMode] = useState('today') // 'today' | 'week'
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const todayDow = new Date().getDay()
  const todayName = DAY_NAMES[todayDow]

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getProyeccionData(weeks)
      setData(result)
    } catch (err) {
      setError(err.message || 'Error al cargar la proyección')
    } finally {
      setLoading(false)
    }
  }, [weeks])

  useEffect(() => {
    load()
  }, [load])

  // Materials that have data for today
  const materialsWithTodayData = data.filter(
    (m) => m.days[todayDow] && m.days[todayDow].avg > 0
  )
  const materialsWithoutTodayData = data.filter(
    (m) => !m.days[todayDow] || m.days[todayDow].avg === 0
  )

  return (
    <div className="min-h-screen bg-[#f2eadf] px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Inteligencia de abastecimiento
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-800">
            Proyección de Compras
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Estadística histórica de recepciones por día de la semana para orientar órdenes de compra.
          </p>
        </div>
      </div>

      {/* Controls bar */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Period selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-600">Período:</span>
          <div className="flex rounded-2xl border border-stone-300 bg-white overflow-hidden shadow-sm">
            {WEEK_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`px-4 py-2 text-sm font-semibold transition ${
                  weeks === w
                    ? 'bg-[#2f5d50] text-white'
                    : 'text-stone-700 hover:bg-stone-100'
                }`}
              >
                {w} semanas
              </button>
            ))}
          </div>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-600">Vista:</span>
          <div className="flex rounded-2xl border border-stone-300 bg-white overflow-hidden shadow-sm">
            <button
              onClick={() => setViewMode('today')}
              className={`px-4 py-2 text-sm font-semibold transition ${
                viewMode === 'today'
                  ? 'bg-[#2f5d50] text-white'
                  : 'text-stone-700 hover:bg-stone-100'
              }`}
            >
              Hoy ({DAY_NAMES_SHORT[todayDow]})
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-4 py-2 text-sm font-semibold transition ${
                viewMode === 'week'
                  ? 'bg-[#2f5d50] text-white'
                  : 'text-stone-700 hover:bg-stone-100'
              }`}
            >
              Toda la semana
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Today banner */}
      {!loading && !error && viewMode === 'today' && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Hoy es <strong>{todayName}</strong> — mostrando proyección estadística para {todayName.toLowerCase()}.{' '}
          Período analizado: últimas <strong>{weeks} semanas</strong>.
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-3xl bg-stone-200" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && data.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-8 text-center">
          <p className="text-lg font-semibold text-amber-800">Sin historial de recepciones</p>
          <p className="mt-1 text-sm text-amber-700">
            No se encontraron recepciones en las últimas {weeks} semanas. Prueba con un período mayor.
          </p>
        </div>
      )}

      {/* Today view */}
      {!loading && !error && data.length > 0 && viewMode === 'today' && (
        <div className="space-y-4">
          {materialsWithTodayData.length === 0 && (
            <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500 text-center">
              No hay materiales con historial de recepción los {todayName.toLowerCase()}.
            </div>
          )}
          {materialsWithTodayData.map((material) => (
            <MaterialDayCard key={material.material_id} material={material} dow={todayDow} />
          ))}
          {materialsWithoutTodayData.length > 0 && (
            <details className="rounded-3xl border border-stone-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-stone-500 hover:text-stone-700 select-none">
                {materialsWithoutTodayData.length} materiales sin actividad los {todayName.toLowerCase()}
              </summary>
              <div className="px-5 pb-5 space-y-3 border-t border-stone-100 pt-3">
                {materialsWithoutTodayData.map((material) => (
                  <div key={material.material_id} className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-xs text-stone-400 font-medium">{material.code}</span>
                      <span className="ml-2 text-sm text-stone-600">{material.name}</span>
                    </div>
                    <span className="text-xs text-stone-400">promedio semanal: {fmt(material.weekly_avg)} {material.base_unit}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Full week view */}
      {!loading && !error && data.length > 0 && viewMode === 'week' && (
        <div className="space-y-4">
          {data.map((material) => (
            <MaterialWeekTable key={material.material_id} material={material} />
          ))}
        </div>
      )}

      {/* Methodology note */}
      {!loading && !error && data.length > 0 && (
        <div className="mt-8 rounded-2xl border border-stone-200 bg-white px-5 py-4 text-xs text-stone-500">
          <p className="font-semibold text-stone-700 mb-1">Metodología</p>
          <p>
            La proyección se basa en recepciones históricas de materias primas, agrupadas por día de la semana
            dentro de las últimas <strong>{weeks} semanas</strong>.
            El valor <em>Sugerido</em> = promedio + 0.5 × desviación estándar, incorporando un margen conservador
            para reducir desabastos. La confianza es <em>alta</em> si hay ≥3 observaciones, <em>media</em> si hay 2,
            y <em>baja</em> si hay solo 1.
          </p>
        </div>
      )}
    </div>
  )
}
