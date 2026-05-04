import { useMemo, useRef, useState } from 'react'
import {
  downloadImportTemplate,
  importWorkbookData,
  readImportWorkbook,
  validateWorkbookData,
} from '../services/excelImporterService'

const SHEET_LABELS = {
  suppliers: 'Proveedores',
  clients: 'Clientes',
  materials: 'Materias primas',
  product_bases: 'Productos base',
  product_presentations: 'Presentaciones',
  client_prices: 'Precios cliente',
  recipes: 'Recetas',
}

const TEMPLATE_NOTES = [
  'Llena solo las hojas que quieras importar. Las demas pueden quedarse vacias.',
  'El importador actualiza por NIT, codigo o nombre cuando encuentra registros existentes.',
  'Importa proveedores antes que materias primas para poder asignarlos como proveedor preferido.',
  'La hoja de recetas actualiza la receta activa de cada SKU usando porcentaje por materia prima.',
  'Las recetas requieren que el SKU ya exista en el sistema y que la suma por SKU sea exactamente 100%.',
  'Los precios por cliente desactivan el precio activo anterior para ese cliente y producto.',
  'Regimen fiscal de proveedor acepta: pequeno_contribuyente, pagos_trimestrales, sujeto_a_retencion.',
  'Categoria de materia prima acepta: materia_prima_vegetal, material_empaque, insumo_proceso, producto_granel, quimico_sanitizante, otros.',
]

function formatCount(value) {
  return new Intl.NumberFormat('es-GT').format(value || 0)
}

export default function ExcelImporterPage() {
  const fileInputRef = useRef(null)
  const errorsRef = useRef(null)
  const [fileName, setFileName] = useState('')
  const [workbookData, setWorkbookData] = useState(null)
  const [validation, setValidation] = useState({ counts: {}, errors: [] })
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [summary, setSummary] = useState(null)

  const totalRows = useMemo(() => {
    return Object.values(validation.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0)
  }, [validation.counts])

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    setSummary(null)
    setMessage('')
    setWorkbookData(null)
    setValidation({ counts: {}, errors: [] })

    if (!file) {
      setFileName('')
      return
    }

    try {
      setStatus('reading')
      setFileName(file.name)
      const parsed = await readImportWorkbook(file)
      const nextValidation = validateWorkbookData(parsed)
      setWorkbookData(parsed)
      setValidation(nextValidation)
      setStatus('ready')
      setMessage(
        nextValidation.errors.length
          ? `Se encontraron ${formatCount(nextValidation.errors.length)} errores. Revisa el detalle antes de importar.`
          : 'Archivo listo para importar.'
      )
      if (nextValidation.errors.length) {
        window.setTimeout(() => {
          errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 50)
      }
    } catch (error) {
      setStatus('error')
      setMessage(error.message || 'No se pudo leer el archivo.')
    }
  }

  async function handleImport() {
    if (!workbookData || validation.errors.length) return

    try {
      setStatus('importing')
      setMessage('Importando datos...')
      const result = await importWorkbookData(workbookData)
      setSummary(result)
      setStatus('done')
      setMessage('Importacion completada.')
    } catch (error) {
      setStatus('error')
      setMessage(error.message || 'No se pudo importar el archivo.')
    }
  }

  function resetFile() {
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFileName('')
    setWorkbookData(null)
    setValidation({ counts: {}, errors: [] })
    setSummary(null)
    setStatus('idle')
    setMessage('')
  }

  const canImport = workbookData && totalRows > 0 && validation.errors.length === 0 && status !== 'importing'
  const errorSummary = Object.entries(SHEET_LABELS)
    .map(([sheet, label]) => ({
      label,
      count: validation.errors.filter((error) => error.sheet === sheet).length,
    }))
    .filter((item) => item.count > 0)

  return (
    <div className="min-h-screen bg-[#faf9f7] p-6 text-stone-800">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-stone-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Sistema</p>
            <h1 className="mt-2 text-3xl font-bold text-stone-900">Importar Excel</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-600">
              Carga clientes, productos, materias primas y precios desde una plantilla controlada.
            </p>
          </div>
          <button
            type="button"
            onClick={downloadImportTemplate}
            className="inline-flex items-center justify-center rounded-lg bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#274d43]"
          >
            Descargar plantilla
          </button>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-stone-900">Archivo</h2>
                <p className="mt-1 text-sm text-stone-500">
                  Usa el archivo .xlsx generado por la plantilla para evitar columnas faltantes.
                </p>
              </div>
              {fileName ? (
                <button
                  type="button"
                  onClick={resetFile}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                >
                  Limpiar
                </button>
              ) : null}
            </div>

            <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center transition hover:border-[#2f5d50] hover:bg-[#eef4f1]">
              <span className="text-sm font-semibold text-stone-800">
                {fileName || 'Seleccionar Excel'}
              </span>
              <span className="mt-2 text-xs text-stone-500">.xlsx o .xls</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            {message ? (
              <div
                className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                  status === 'error' || validation.errors.length
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                {message}
                {validation.errors.length ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                    {errorSummary.map((item) => (
                      <span key={item.label} className="rounded-full bg-white/70 px-2.5 py-1">
                        {item.label}: {formatCount(item.count)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!canImport}
                onClick={handleImport}
                className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {status === 'importing' ? 'Importando...' : 'Importar datos'}
              </button>
              <span className="text-sm text-stone-500">
                {formatCount(totalRows)} filas detectadas
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-900">Como llenar la plantilla</h2>
            <ul className="mt-4 space-y-3 text-sm text-stone-600">
              {TEMPLATE_NOTES.map((note) => (
                <li key={note} className="flex gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f5d50]" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-stone-900">Revision del archivo</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
                <tr>
                  <th className="px-5 py-3">Hoja</th>
                  <th className="px-5 py-3">Filas</th>
                  <th className="px-5 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Object.entries(SHEET_LABELS).map(([sheet, label]) => {
                  const sheetErrors = validation.errors.filter((error) => error.sheet === sheet)
                  return (
                    <tr key={sheet}>
                      <td className="px-5 py-3 font-medium text-stone-800">{label}</td>
                      <td className="px-5 py-3 text-stone-600">{formatCount(validation.counts[sheet])}</td>
                      <td className="px-5 py-3">
                        {sheetErrors.length ? (
                          <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                            {sheetErrors.length} errores
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {validation.errors.length ? (
          <section ref={errorsRef} className="rounded-lg border border-red-200 bg-red-50 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-red-700">Errores</h2>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg bg-white">
              {validation.errors.map((error, index) => (
                <div key={`${error.sheet}-${error.row}-${index}`} className="border-b border-red-100 px-4 py-3 text-sm text-red-800 last:border-b-0">
                  {SHEET_LABELS[error.sheet] || error.sheet}, fila {error.row}: {error.message}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {summary ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-800">Resultado</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(SHEET_LABELS).map(([sheet, label]) => (
                <div key={sheet} className="rounded-lg bg-white p-4">
                  <p className="text-sm font-semibold text-stone-800">{label}</p>
                  <p className="mt-2 text-xs text-stone-500">
                    {formatCount(summary[sheet]?.created)} creados
                  </p>
                  <p className="text-xs text-stone-500">
                    {formatCount(summary[sheet]?.updated)} actualizados
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
