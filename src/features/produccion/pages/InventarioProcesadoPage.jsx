import { useEffect, useMemo, useState } from 'react';
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  getProcessedInventoryDashboard,
  updateProcessedInventoryLot,
} from '../services/processedInventoryService';

function numberOrZero(value) {
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function formatNumber(value) {
  return numberOrZero(value).toLocaleString('es-GT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-GT');
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-stone-100 text-stone-700 border border-stone-200',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    yellow: 'bg-amber-50 text-amber-700 border border-amber-200',
    red: 'bg-rose-50 text-rose-700 border border-rose-200',
    gray: 'bg-gray-100 text-gray-700 border border-gray-200',
    blue: 'bg-blue-50 text-blue-700 border border-blue-200',
    purple: 'bg-violet-50 text-violet-700 border border-violet-200',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${tones[tone] || tones.slate}`}
    >
      {children}
    </span>
  );
}

function getStatusTone(status) {
  if (status === 'disponible') return 'green';
  if (status === 'parcial') return 'yellow';
  if (status === 'agotado') return 'gray';
  if (status === 'bloqueado') return 'red';
  return 'slate';
}

function getTypeTone(type) {
  if (type === 'mini') return 'purple';
  return 'blue';
}

function getStageTone(stage) {
  if (stage === 'secado') return 'green';
  if (stage === 'lavado') return 'yellow';
  if (stage === 'deshoje') return 'blue';
  return 'slate';
}

function EmptyState({ text }) {
  return (
    <div className="border border-dashed border-stone-300 rounded-2xl p-10 text-center text-stone-500 text-sm bg-stone-50">
      {text}
    </div>
  );
}

function KpiCard({ label, value, hint }) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-stone-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-400">{hint}</div> : null}
    </div>
  );
}

function SectionShell({ children }) {
  return (
    <div className="bg-white border border-stone-200 rounded-3xl shadow-sm overflow-hidden">
      {children}
    </div>
  );
}

function EditLotModal({ lot, onClose, onSave, saving }) {
  const [location, setLocation] = useState(lot?.location || '');
  const [status, setStatus] = useState(lot?.status || 'disponible');

  if (!lot) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      lotId: lot.id,
      location,
      status,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-xl font-semibold text-stone-900">Editar lote procesado</h3>
            <p className="text-sm text-stone-500 mt-1">{lot.internal_lot}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-stone-500">Material</span>
                <span className="font-medium text-stone-800">{lot.material_name}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-stone-500">Disponible</span>
                <span className="font-medium text-stone-800">
                  {formatNumber(lot.available_quantity)} {lot.unit}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm text-stone-600 mb-1.5">Ubicación</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full border border-stone-300 rounded-2xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#2f5d50]/10"
                placeholder="Ej. Cuarto frío procesado"
              />
            </div>

            <div>
              <label className="block text-sm text-stone-600 mb-1.5">Estado</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full border border-stone-300 rounded-2xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#2f5d50]/10"
              >
                <option value="disponible">disponible</option>
                <option value="parcial">parcial</option>
                <option value="agotado">agotado</option>
                <option value="bloqueado">bloqueado</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-2xl border border-stone-300 text-stone-700 hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 rounded-2xl bg-[#2f5d50] text-white hover:bg-[#264c42] disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InventarioProcesadoPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lots, setLots] = useState([]);
  const [summary, setSummary] = useState({
    totalLots: 0,
    availableLots: 0,
    totalAvailableQty: 0,
    miniLots: 0,
    normalLots: 0,
  });
  const [statusFilter, setStatusFilter] = useState('todos');
  const [search, setSearch] = useState('');
  const [selectedLot, setSelectedLot] = useState(null);

  async function loadData() {
    try {
      setLoading(true);
      setError('');
      const data = await getProcessedInventoryDashboard();
      setLots(data.lots || []);
      setSummary(data.summary || {});
    } catch (err) {
      setError(err.message || 'No se pudo cargar el inventario procesado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);
  useRealtimeRefresh(['processed_inventory_lots'], loadData)

  const filteredLots = useMemo(() => {
    return lots.filter((lot) => {
      const matchStatus = statusFilter === 'todos' ? true : lot.status === statusFilter;
      const term = search.trim().toLowerCase();

      const matchSearch =
        !term ||
        lot.internal_lot?.toLowerCase().includes(term) ||
        lot.material_name?.toLowerCase().includes(term) ||
        lot.material_code?.toLowerCase().includes(term) ||
        lot.processed_type?.toLowerCase().includes(term) ||
        lot.location?.toLowerCase().includes(term);

      return matchStatus && matchSearch;
    });
  }, [lots, statusFilter, search]);

  async function handleSaveLot(payload) {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      await updateProcessedInventoryLot(payload);
      setSelectedLot(null);
      setSuccess('Lote actualizado correctamente.');
      await loadData();
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el lote.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-stone-50/60 p-4 md:p-6 space-y-6">
      <div className="bg-green-800 rounded-3xl p-6 md:p-7 text-white shadow-lg">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl md:text-3xl font-bold">Inventario procesado</h1>
          <p className="text-stone-200 max-w-3xl">
            Visualiza, organiza y da seguimiento a los lotes procesados que ya salieron de
            Procesos MP y están listos para el siguiente paso del flujo.
          </p>
        </div>
      </div>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 text-rose-700 rounded-2xl px-4 py-3">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-2xl px-4 py-3">
          {success}
        </div>
      ) : null}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <KpiCard label="Total lotes" value={summary.totalLots} hint="Registrados en inventario procesado" />
        <KpiCard label="Disponibles" value={summary.availableLots} hint="Con cantidad utilizable" />
        <KpiCard
          label="Cantidad disponible"
          value={formatNumber(summary.totalAvailableQty)}
          hint="Suma total de existencias"
        />
        <KpiCard label="Mini" value={summary.miniLots} hint="Lotes tipo mini" />
        <KpiCard label="Normal" value={summary.normalLots} hint="Lotes tipo normal" />
      </div>

      <SectionShell>
        <div className="p-5 border-b border-stone-200 bg-white">
          <div className="flex flex-col xl:flex-row gap-4 xl:items-end xl:justify-between">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full xl:max-w-3xl">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Buscar</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full border border-stone-300 rounded-2xl px-3 py-2.5 bg-white outline-none focus:ring-2 focus:ring-[#2f5d50]/10"
                  placeholder="Lote, material, código, tipo, ubicación..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">
                  Filtrar por estado
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full border border-stone-300 rounded-2xl px-3 py-2.5 bg-white outline-none focus:ring-2 focus:ring-[#2f5d50]/10"
                >
                  <option value="todos">Todos</option>
                  <option value="disponible">disponible</option>
                  <option value="parcial">parcial</option>
                  <option value="agotado">agotado</option>
                  <option value="bloqueado">bloqueado</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-sm text-stone-500">
                {filteredLots.length} lote{filteredLots.length === 1 ? '' : 's'}
              </div>
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="px-4 py-2.5 rounded-2xl border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                {loading ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white">
          {loading ? (
            <div className="p-5">
              <EmptyState text="Cargando inventario procesado..." />
            </div>
          ) : filteredLots.length ? (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50/80">
                  <tr className="text-left border-b border-stone-200">
                    <th className="py-3 px-5 font-semibold text-stone-600">Lote</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Material</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Tipo</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Etapa</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Disponible</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Original</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Costo</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Ubicación</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Estado</th>
                    <th className="py-3 px-5 font-semibold text-stone-600">Fecha</th>
                    <th className="py-3 px-5 font-semibold text-stone-600 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLots.map((lot) => (
                    <tr
                      key={lot.id}
                      className="border-b border-stone-100 hover:bg-stone-50/70 transition-colors"
                    >
                      <td className="py-4 px-5">
                        <div className="font-semibold text-stone-900">{lot.internal_lot}</div>
                        <div className="text-xs text-stone-500 mt-1">
                          Origen: {lot.source_internal_lot || '—'}
                        </div>
                      </td>

                      <td className="py-4 px-5">
                        <div className="font-medium text-stone-800">{lot.material_name || '—'}</div>
                        <div className="text-xs text-stone-500 mt-1">{lot.material_code || 'Sin código'}</div>
                      </td>

                      <td className="py-4 px-5">
                        <Badge tone={getTypeTone(lot.processed_type)}>
                          {lot.processed_type || 'unico'}
                        </Badge>
                      </td>

                      <td className="py-4 px-5">
                        <Badge tone={getStageTone(lot.processed_stage)}>
                          {lot.processed_stage || '—'}
                        </Badge>
                      </td>

                      <td className="py-4 px-5">
                        <div className="font-semibold text-stone-900">
                          {formatNumber(lot.available_quantity)} {lot.unit}
                        </div>
                      </td>

                      <td className="py-4 px-5 text-stone-700">
                        {formatNumber(lot.original_quantity)} {lot.unit}
                      </td>

                      <td className="py-4 px-5 text-stone-700">
                        {formatNumber(lot.accumulated_cost)}
                      </td>

                      <td className="py-4 px-5">
                        <div className="text-stone-700">{lot.location || '—'}</div>
                      </td>

                      <td className="py-4 px-5">
                        <Badge tone={getStatusTone(lot.status)}>
                          {lot.status}
                        </Badge>
                      </td>

                      <td className="py-4 px-5 text-stone-600">
                        {formatDate(lot.created_at)}
                      </td>

                      <td className="py-4 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedLot(lot)}
                          className="px-3.5 py-2 rounded-xl bg-[#2f5d50] text-white text-xs font-medium hover:bg-[#264c42]"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <EmptyState text="No hay lotes en inventario procesado." />
            </div>
          )}
        </div>
      </SectionShell>

      <EditLotModal
        lot={selectedLot}
        onClose={() => setSelectedLot(null)}
        onSave={handleSaveLot}
        saving={saving}
      />
    </div>
  );
}