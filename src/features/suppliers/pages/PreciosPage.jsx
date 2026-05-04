function fmt(value, digits = 2) {
  return Number(value || 0).toLocaleString('es-GT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function TrendBars({ rows }) {
  const max = Math.max(...rows.map((row) => Number(row.unit_price || 0)), 1)

  return (
    <div className="flex h-24 items-end gap-2">
      {rows.map((row) => {
        const pct = (Number(row.unit_price || 0) / max) * 100
        return (
          <div key={row.id} className="group relative flex flex-1 flex-col items-center">
            <div className="w-full rounded-t-lg bg-[#2f5d50]" style={{ height: `${Math.max(pct, 10)}%` }} />
            <div className="mt-2 text-[10px] text-stone-400">{String(row.effective_date || '').slice(5)}</div>
            <div className="absolute bottom-full mb-2 hidden whitespace-nowrap rounded-lg bg-stone-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
              Q {fmt(row.unit_price, 4)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PreciosPage({ priceRows = [], selectedSupplierId = '' }) {
  const visibleRows = selectedSupplierId
    ? priceRows.filter((row) => row.supplier_id === selectedSupplierId)
    : priceRows

  const byMaterial = Object.values(
    visibleRows.reduce((acc, row) => {
      const key = row.material_id || row.materials?.common_name || row.id
      if (!acc[key]) {
        acc[key] = {
          material_id: row.material_id || key,
          material_name: row.materials?.common_name || 'Materia prima',
          unit: row.unit,
          rows: [],
        }
      }
      acc[key].rows.push(row)
      return acc
    }, {}),
  )

  const latestComparisons = Object.values(
    visibleRows.reduce((acc, row) => {
      const key = `${row.material_id || 'sin_material'}:${row.supplier_id}`
      if (!acc[key] || String(row.effective_date) > String(acc[key].effective_date)) {
        acc[key] = row
      }
      return acc
    }, {}),
  )

  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Movimientos</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">{visibleRows.length}</div>
          <div className="mt-1 text-sm text-stone-500">Registros de precio consolidados desde compras.</div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Materiales con historia</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">{byMaterial.length}</div>
          <div className="mt-1 text-sm text-stone-500">SKU monitoreados para tendencia y comparación.</div>
        </div>
        <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Variación promedio</div>
          <div className="mt-2 text-3xl font-semibold text-stone-900">
            {visibleRows.length
              ? fmt(visibleRows.reduce((acc, row) => acc + Math.abs(Number(row.price_variation_pct || 0)), 0) / visibleRows.length)
              : '0.00'}%
          </div>
          <div className="mt-1 text-sm text-stone-500">Desviación contra promedio histórico del material.</div>
        </div>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Tendencia</div>
          <h2 className="mt-2 text-xl font-semibold text-stone-900">Historial de precios por materia prima</h2>
        </div>

        {byMaterial.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {byMaterial.map((group) => {
              const trendRows = [...group.rows]
                .sort((a, b) => String(a.effective_date).localeCompare(String(b.effective_date)))
                .slice(-8)

              return (
                <article key={group.material_id} className="rounded-[24px] border border-stone-200 bg-stone-50/70 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-stone-900">{group.material_name}</h3>
                      <div className="mt-1 text-sm text-stone-500">{trendRows.length} movimientos · unidad {group.unit}</div>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-right">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Último precio</div>
                      <div className="mt-1 text-lg font-semibold text-stone-900">Q {fmt(trendRows.at(-1)?.unit_price, 4)}</div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <TrendBars rows={trendRows} />
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">
            No hay historial de precios disponible todavía.
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">Comparación</div>
          <h2 className="mt-2 text-xl font-semibold text-stone-900">Último precio por proveedor y material</h2>
        </div>

        {latestComparisons.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                  <th className="px-4 py-3">Materia prima</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3 text-right">Volumen</th>
                  <th className="px-4 py-3 text-right">Variación</th>
                </tr>
              </thead>
              <tbody>
                {latestComparisons.map((row) => (
                  <tr key={`${row.material_id}-${row.supplier_id}`} className="border-b border-stone-100">
                    <td className="px-4 py-3 text-stone-700">{row.materials?.common_name || 'Materia prima'}</td>
                    <td className="px-4 py-3 text-stone-700">{row.suppliers?.name || 'Proveedor'}</td>
                    <td className="px-4 py-3 text-stone-500">{row.effective_date}</td>
                    <td className="px-4 py-3 text-right font-medium text-stone-900">Q {fmt(row.unit_price, 4)}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{fmt(row.volume, 4)} {row.unit}</td>
                    <td className={`px-4 py-3 text-right font-medium ${Number(row.price_variation_pct || 0) > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {Number(row.price_variation_pct || 0) >= 0 ? '+' : ''}{fmt(row.price_variation_pct)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-5 py-10 text-center text-sm text-stone-500">
            Aún no hay base suficiente para comparar proveedores.
          </div>
        )}
      </section>
    </div>
  )
}
