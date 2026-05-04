import { Link } from 'react-router-dom'

function fmt(value, digits = 2) {
  return Number(value || 0).toLocaleString('es-GT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function riskPill(risk) {
  if (risk === 'ok') return 'bg-emerald-100 text-emerald-700'
  if (risk === 'oversupply') return 'bg-blue-100 text-blue-700'
  return 'bg-red-100 text-red-700'
}

export default function ProgramasPage({ programs = [], selectedSupplierId = '', suppliers = [] }) {
  const visiblePrograms = selectedSupplierId
    ? programs.filter((program) => program.supplier_id === selectedSupplierId)
    : programs

  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Programas activos</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">
            {visiblePrograms.filter((program) => ['activo', 'pausado'].includes(program.status)).length}
          </div>
          <div className="mt-1 text-sm text-stone-500">Planes agrícolas en seguimiento directo.</div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">En riesgo</div>
          <div className="mt-2 text-3xl font-semibold text-red-700">
            {visiblePrograms.filter((program) => program.risk_level === 'risk').length}
          </div>
          <div className="mt-1 text-sm text-stone-500">Subentrega, atraso o cierre comprometido.</div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Cumplimiento promedio</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">
            {visiblePrograms.length
              ? fmt(visiblePrograms.reduce((acc, program) => acc + Number(program.compliance_pct || 0), 0) / visiblePrograms.length)
              : '0.00'}%
          </div>
          <div className="mt-1 text-sm text-stone-500">Avance por volumen entregado vs comprometido.</div>
        </div>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Programas agrícolas</div>
            <h2 className="mt-2 text-xl font-semibold text-stone-900">Seguimiento por proveedor</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-600">
              {selectedSupplierId
                ? suppliers.find((supplier) => supplier.id === selectedSupplierId)?.name || 'Proveedor filtrado'
                : 'Todos los proveedores'}
            </div>
            <Link to="/programas-agricolas" className="rounded-2xl bg-[#2f5d50] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#264c42]">
              Abrir módulo operativo
            </Link>
          </div>
        </div>

        {visiblePrograms.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {visiblePrograms.map((program) => (
              <article key={program.id} className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{program.program_code}</div>
                    <h3 className="mt-2 text-lg font-semibold text-stone-900">{program.material_labels || program.materials?.common_name || 'Materia prima'}</h3>
                    <div className="mt-1 text-sm text-stone-500">
                      {program.start_date} → {program.end_date} · {program.delivery_frequency}
                    </div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${riskPill(program.risk_level)}`}>
                    {program.risk_level === 'ok' ? 'En línea' : program.risk_level === 'oversupply' ? 'Sobreentrega' : 'Riesgo'}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-white px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Comprometido</div>
                    <div className="mt-2 text-lg font-semibold text-stone-900">{fmt(program.quantity_committed_total, 4)} {program.unit}</div>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Entregado</div>
                    <div className="mt-2 text-lg font-semibold text-stone-900">{fmt(program.delivered_total, 4)} {program.unit}</div>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Cumplimiento</div>
                    <div className="mt-2 text-lg font-semibold text-stone-900">{fmt(program.compliance_pct)}%</div>
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-200">
                  <div
                    className={`h-full rounded-full ${program.risk_level === 'risk' ? 'bg-red-500' : 'bg-[#2f5d50]'}`}
                    style={{ width: `${Math.min(100, Number(program.compliance_pct || 0))}%` }}
                  />
                </div>

                <div className="mt-4 space-y-2">
                  {(program.deliveries || []).slice(0, 3).map((delivery) => (
                    <div key={delivery.id} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm">
                      <div className="text-stone-700">{delivery.scheduled_date}</div>
                      <div className="text-stone-500">{fmt(delivery.planned_quantity, 4)} {program.unit}</div>
                      <div className="font-medium text-stone-800">{fmt(delivery.received_quantity, 4)} {program.unit}</div>
                      <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${delivery.computed_status === 'cumplida' ? 'bg-emerald-100 text-emerald-700' : delivery.computed_status === 'parcial' ? 'bg-amber-100 text-amber-700' : delivery.computed_status === 'incumplida' ? 'bg-red-100 text-red-700' : 'bg-stone-100 text-stone-700'}`}>
                        {delivery.computed_status}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">
            No hay programas agrícolas para el filtro actual.
          </div>
        )}
      </section>
    </div>
  )
}
