import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeRefresh'
import {
  getFelIntercompanyDashboard,
  saveFelCertificador,
  saveIntercompanyPartner,
  savePriceAgreement,
} from '../services/felIntercompanyService'

const today = new Date().toISOString().slice(0, 10)

const emptyPartner = {
  codigo: '',
  nombre: '',
  tax_id: '',
  partner_org_id: '',
  default_client_id: '',
  endpoint_url: '',
  public_key: '',
  shared_secret_vault_ref: '',
  currency: 'GTQ',
  default_payment_terms: '30',
  default_fel_tipo_documento: 'FACT',
  is_active: true,
  notas: '',
}

const emptyAgreement = {
  partner_id: '',
  scope_type: 'global',
  sku_id: '',
  product_base_id: '',
  category: '',
  method: 'cost_plus',
  markup_pct: '15',
  currency: 'GTQ',
  valid_from: today,
  valid_to: '',
  tp_study_ref: '',
  tp_study_url: '',
  is_active: true,
  notas: '',
}

const emptyCert = {
  nombre: '',
  adapter_key: 'mock',
  endpoint: '',
  credentials_vault_ref: '',
  ambiente: 'sandbox',
  is_default: false,
  is_active: true,
}

function fmtMoney(value, currency = 'GTQ') {
  return `${currency} ${Number(value || 0).toLocaleString('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function fmtDate(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
}

function Badge({ children, tone = 'stone' }) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    stone: 'bg-stone-100 text-stone-600',
  }
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-1 py-3 text-sm font-medium ${
        active
          ? 'border-[#2f5d50] text-[#2f5d50]'
          : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800'
      }`}
    >
      {children}
    </button>
  )
}

function TextInput({ label, value, onChange, type = 'text', required = false, placeholder = '', disabled = false, hint = '' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100"
      />
      {hint ? <span className="mt-1 block text-xs leading-5 text-stone-500">{hint}</span> : null}
    </label>
  )
}

function SelectInput({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#2f5d50] focus:ring-2 focus:ring-emerald-100"
      >
        {children}
      </select>
    </label>
  )
}

function CheckInput({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 pt-7 text-sm text-stone-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-stone-300 accent-[#2f5d50]"
      />
      {label}
    </label>
  )
}

function Section({ title, actions, children }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 px-4 py-10">
      <div className="w-full max-w-3xl rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Cerrar
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function PartnersTab({ partners, clients, onSaved }) {
  const [form, setForm] = useState(emptyPartner)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function buildClientCode(client) {
    const source = client?.nit || client?.commercial_name || client?.legal_name || client?.id || 'SV'
    const normalized = String(source)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase()
      .slice(0, 16)
    return `IC-${normalized || 'SV'}`
  }

  function selectClient(clientId) {
    const client = clients.find((item) => item.id === clientId)
    if (!client) {
      setForm((prev) => ({
        ...prev,
        default_client_id: '',
        codigo: '',
        nombre: '',
        tax_id: '',
        partner_org_id: '',
      }))
      return
    }

    setForm((prev) => ({
      ...prev,
      default_client_id: client.id,
      codigo: buildClientCode(client),
      nombre: client.commercial_name || client.legal_name || 'Cliente intercompany',
      tax_id: client.nit || 'CF',
      partner_org_id: prev.partner_org_id,
    }))
  }

  function edit(partner) {
    setEditingId(partner.id)
    setShowForm(true)
    setForm({
      codigo: partner.codigo || '',
      nombre: partner.nombre || '',
      tax_id: partner.tax_id || '',
      partner_org_id: partner.partner_org_id || '',
      default_client_id: partner.default_client_id || '',
      endpoint_url: partner.endpoint_url || '',
      public_key: partner.public_key || '',
      shared_secret_vault_ref: partner.shared_secret_vault_ref || '',
      currency: partner.currency || 'GTQ',
      default_payment_terms: String(partner.default_payment_terms || 30),
      default_fel_tipo_documento: partner.default_fel_tipo_documento || 'FACT',
      is_active: partner.is_active !== false,
      notas: partner.notas || '',
    })
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await saveIntercompanyPartner(form, editingId)
      setForm(emptyPartner)
      setEditingId(null)
      setShowForm(false)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {showForm && (
        <Modal
          title={editingId ? 'Editar partner' : 'Nuevo partner'}
          onClose={() => {
            setShowForm(false)
            setEditingId(null)
            setForm(emptyPartner)
          }}
        >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <SelectInput label="Cliente existente" value={form.default_client_id} onChange={selectClient}>
              <option value="">Crear cliente interno automatico</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.commercial_name || client.legal_name} {client.nit ? `- ${client.nit}` : ''}
                </option>
              ))}
            </SelectInput>
            <TextInput label="Codigo" value={form.codigo} onChange={(value) => set('codigo', value)} disabled />
            <TextInput label="Nombre" value={form.nombre} onChange={(value) => set('nombre', value)} disabled />
            <TextInput label="NIT" value={form.tax_id} onChange={(value) => set('tax_id', value)} disabled />
            {editingId && (
              <TextInput label="Organizacion partner UUID" value={form.partner_org_id} onChange={(value) => set('partner_org_id', value)} disabled />
            )}
            <TextInput
              label="Endpoint bridge"
              value={form.endpoint_url}
              onChange={(value) => set('endpoint_url', value)}
              placeholder="https://..."
              hint="URL del ERP destino para enviar eventos intercompany."
            />
            <TextInput
              label="Vault ref secreto"
              value={form.shared_secret_vault_ref}
              onChange={(value) => set('shared_secret_vault_ref', value)}
              placeholder="intercompany/sv/shared-secret"
              hint="Referencia del secreto guardado en Vault; no es la clave en texto."
            />
            <SelectInput label="Moneda" value={form.currency} onChange={(value) => set('currency', value)}>
              <option value="GTQ">GTQ</option>
              <option value="USD">USD</option>
            </SelectInput>
            <TextInput label="Dias credito" type="number" value={form.default_payment_terms} onChange={(value) => set('default_payment_terms', value)} />
            <SelectInput label="Tipo FEL default" value={form.default_fel_tipo_documento} onChange={(value) => set('default_fel_tipo_documento', value)}>
              <option value="FACT">FACT</option>
              <option value="FCAM">FCAM</option>
              <option value="FESP">FESP</option>
              <option value="FACA">FACA</option>
              <option value="FAPE">FAPE</option>
            </SelectInput>
          </div>
          <TextInput
            label="Llave publica"
            value={form.public_key}
            onChange={(value) => set('public_key', value)}
            hint="Clave publica del partner para validar mensajes firmados o cifrados."
          />
          <TextInput label="Notas" value={form.notas} onChange={(value) => set('notas', value)} />
          <div className="flex items-center justify-between">
            <CheckInput label="Activo" checked={form.is_active} onChange={(value) => set('is_active', value)} />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyPartner) }} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
                Cancelar
              </button>
              <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </form>
        </Modal>
      )}

      <Section
        title="Partners"
        actions={
          <button
            type="button"
            onClick={() => {
              setEditingId(null)
              setForm(emptyPartner)
              setShowForm(true)
            }}
            className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]"
          >
            Nuevo partner
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-semibold text-stone-500">
                <th className="px-3 py-2">Codigo</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">NIT</th>
                <th className="px-3 py-2">Moneda</th>
                <th className="px-3 py-2">Cliente interno</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Accion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {partners.map((partner) => (
                <tr key={partner.id}>
                  <td className="px-3 py-3 font-medium text-stone-900">{partner.codigo}</td>
                  <td className="px-3 py-3 text-stone-700">{partner.nombre}</td>
                  <td className="px-3 py-3 text-stone-600">{partner.tax_id}</td>
                  <td className="px-3 py-3 text-stone-600">{partner.currency}</td>
                  <td className="px-3 py-3 text-stone-600">
                    {clients.find((client) => client.id === partner.default_client_id)?.commercial_name || (partner.default_client_id ? 'Enlazado' : 'Pendiente')}
                  </td>
                  <td className="px-3 py-3"><Badge tone={partner.is_active ? 'green' : 'stone'}>{partner.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => edit(partner)} className="text-sm font-medium text-[#2f5d50] hover:text-[#264c42]">Editar</button>
                  </td>
                </tr>
              ))}
              {partners.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-500">No hay partners intercompany.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function AgreementsTab({ agreements, partners, onSaved }) {
  const [form, setForm] = useState(emptyAgreement)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await savePriceAgreement(form)
      setForm({ ...emptyAgreement, partner_id: form.partner_id })
      setShowForm(false)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {showForm && (
        <Modal
          title="Nuevo acuerdo de precio"
          onClose={() => {
            setShowForm(false)
            setForm(emptyAgreement)
          }}
        >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <SelectInput label="Partner" value={form.partner_id} onChange={(value) => set('partner_id', value)}>
              <option value="">Selecciona</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.codigo} - {partner.nombre}</option>)}
            </SelectInput>
            <SelectInput label="Alcance" value={form.scope_type} onChange={(value) => set('scope_type', value)}>
              <option value="global">Global</option>
              <option value="category">Categoria</option>
              <option value="product">Producto base UUID</option>
              <option value="sku">SKU UUID</option>
            </SelectInput>
            <TextInput label="Markup %" type="number" value={form.markup_pct} onChange={(value) => set('markup_pct', value)} />
            <TextInput label="Vigente desde" type="date" value={form.valid_from} onChange={(value) => set('valid_from', value)} />
            {form.scope_type === 'category' && <TextInput label="Categoria" value={form.category} onChange={(value) => set('category', value)} />}
            {form.scope_type === 'product' && <TextInput label="Product base ID" value={form.product_base_id} onChange={(value) => set('product_base_id', value)} />}
            {form.scope_type === 'sku' && <TextInput label="SKU ID" value={form.sku_id} onChange={(value) => set('sku_id', value)} />}
            <TextInput label="Vigente hasta" type="date" value={form.valid_to} onChange={(value) => set('valid_to', value)} />
            <TextInput label="Referencia TP" value={form.tp_study_ref} onChange={(value) => set('tp_study_ref', value)} />
            <TextInput label="URL estudio" value={form.tp_study_url} onChange={(value) => set('tp_study_url', value)} />
            <CheckInput label="Activo" checked={form.is_active} onChange={(value) => set('is_active', value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setForm(emptyAgreement)
              }}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">
              {saving ? 'Guardando...' : 'Guardar acuerdo'}
            </button>
          </div>
        </form>
        </Modal>
      )}

      <Section
        title="Acuerdos"
        actions={
          <button
            type="button"
            onClick={() => {
              setForm(emptyAgreement)
              setShowForm(true)
            }}
            className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]"
          >
            Nuevo acuerdo
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-semibold text-stone-500">
                <th className="px-3 py-2">Partner</th>
                <th className="px-3 py-2">Alcance</th>
                <th className="px-3 py-2 text-right">Markup</th>
                <th className="px-3 py-2">Vigencia</th>
                <th className="px-3 py-2">Estudio</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {agreements.map((agreement) => (
                <tr key={agreement.id}>
                  <td className="px-3 py-3 text-stone-800">{agreement.intercompany_partners?.codigo || '-'} {agreement.intercompany_partners?.nombre || ''}</td>
                  <td className="px-3 py-3 text-stone-600">{agreement.scope_type}</td>
                  <td className="px-3 py-3 text-right font-medium text-stone-900">{Number(agreement.markup_pct || 0).toFixed(2)}%</td>
                  <td className="px-3 py-3 text-stone-600">{fmtDate(agreement.valid_from)} a {fmtDate(agreement.valid_to)}</td>
                  <td className="px-3 py-3 text-stone-600">{agreement.tp_study_ref || '-'}</td>
                  <td className="px-3 py-3"><Badge tone={agreement.is_active ? 'green' : 'stone'}>{agreement.is_active ? 'Activo' : 'Inactivo'}</Badge></td>
                </tr>
              ))}
              {agreements.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-stone-500">No hay acuerdos de precio.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function FelTab({ certificadores, documents, onSaved }) {
  const [form, setForm] = useState(emptyCert)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await saveFelCertificador(form)
      setForm(emptyCert)
      setShowForm(false)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {showForm && (
        <Modal
          title="Certificador FEL"
          onClose={() => {
            setShowForm(false)
            setForm(emptyCert)
          }}
        >
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Nombre" value={form.nombre} onChange={(value) => set('nombre', value)} required />
              <SelectInput label="Adapter" value={form.adapter_key} onChange={(value) => set('adapter_key', value)}>
                <option value="mock">mock</option>
                <option value="infile">infile</option>
                <option value="megaprint">megaprint</option>
                <option value="face">face</option>
              </SelectInput>
              <SelectInput label="Ambiente" value={form.ambiente} onChange={(value) => set('ambiente', value)}>
                <option value="sandbox">sandbox</option>
                <option value="produccion">produccion</option>
              </SelectInput>
              <TextInput label="Vault ref credenciales" value={form.credentials_vault_ref} onChange={(value) => set('credentials_vault_ref', value)} required />
              <div className="md:col-span-2">
                <TextInput label="Endpoint" value={form.endpoint} onChange={(value) => set('endpoint', value)} required />
              </div>
              <CheckInput label="Default" checked={form.is_default} onChange={(value) => set('is_default', value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setForm(emptyCert)
                }}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                Cancelar
              </button>
              <button disabled={saving} className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42] disabled:opacity-60">
                {saving ? 'Guardando...' : 'Guardar certificador'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section
          title="Certificadores"
          actions={
            <button
              type="button"
              onClick={() => {
                setForm(emptyCert)
                setShowForm(true)
              }}
              className="rounded-lg bg-[#2f5d50] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264c42]"
            >
              Nuevo certificador
            </button>
          }
        >
          <div className="space-y-3">
            {certificadores.map((cert) => (
              <div key={cert.id} className="rounded-lg border border-stone-200 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-stone-900">{cert.nombre}</div>
                    <div className="text-sm text-stone-500">{cert.adapter_key} · {cert.ambiente}</div>
                  </div>
                  <Badge tone={cert.is_default ? 'green' : 'stone'}>{cert.is_default ? 'Default' : cert.is_active ? 'Activo' : 'Inactivo'}</Badge>
                </div>
              </div>
            ))}
            {certificadores.length === 0 && <p className="py-6 text-center text-sm text-stone-500">No hay certificadores configurados.</p>}
          </div>
        </Section>

        <Section title="Documentos FEL">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs font-semibold text-stone-500">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Receptor</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-3 py-3 text-stone-600">{fmtDate(doc.fecha_emision)}</td>
                    <td className="px-3 py-3 font-medium text-stone-900">{doc.tipo_documento}</td>
                    <td className="px-3 py-3 text-stone-700">{doc.receptor_nombre || doc.receptor_nit || '-'}</td>
                    <td className="px-3 py-3 text-right text-stone-900">{fmtMoney(doc.total, doc.moneda)}</td>
                    <td className="px-3 py-3"><Badge tone={doc.estado_fel === 'certified' ? 'green' : doc.estado_fel === 'rejected' ? 'red' : 'amber'}>{doc.estado_fel}</Badge></td>
                  </tr>
                ))}
                {documents.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-stone-500">No hay documentos FEL.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}

function QueueTab({ outbox, inbox, snapshots, transactions, integrationEvents, pricingLogs }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Transacciones intercompany">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-semibold text-stone-500">
                <th className="px-3 py-2">Codigo</th>
                <th className="px-3 py-2">Ruta</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Producto</th>
                <th className="px-3 py-2 text-right">Flete</th>
                <th className="px-3 py-2 text-right">Seguro</th>
                <th className="px-3 py-2 text-right">Costos</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="px-3 py-3 font-medium text-stone-900">{tx.transaction_code}</td>
                  <td className="px-3 py-3 text-stone-600">{tx.source_company} {'->'} {tx.target_company}</td>
                  <td className="px-3 py-3 text-right">{Number(tx.total_qty || 0).toLocaleString('es-GT')}</td>
                  <td className="px-3 py-3 text-right">{fmtMoney(tx.total_value, tx.currency)}</td>
                  <td className="px-3 py-3 text-right">{fmtMoney(tx.freight_cost, tx.currency)}</td>
                  <td className="px-3 py-3 text-right">{fmtMoney(tx.insurance_cost, tx.currency)}</td>
                  <td className="px-3 py-3 text-right font-medium text-stone-900">{fmtMoney(tx.logistics_cost_total, tx.currency)}</td>
                  <td className="px-3 py-3"><Badge tone={tx.status === 'RECEIVED' || tx.status === 'CLOSED' ? 'green' : tx.status === 'REJECTED' ? 'red' : 'amber'}>{tx.status}</Badge></td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-stone-500">No hay transacciones.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Eventos de integracion">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-semibold text-stone-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Transaccion</th>
                <th className="px-3 py-2">Evento</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {integrationEvents.map((event) => (
                <tr key={event.id}>
                  <td className="px-3 py-3 text-stone-600">{fmtDate(event.created_at)}</td>
                  <td className="px-3 py-3 text-stone-800">{event.intercompany_transactions?.transaction_code || '-'}</td>
                  <td className="px-3 py-3 text-stone-700">{event.event_type}</td>
                  <td className="px-3 py-3"><Badge tone={event.status === 'sent' ? 'green' : event.status === 'failed' ? 'red' : 'amber'}>{event.status}</Badge></td>
                </tr>
              ))}
              {integrationEvents.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-stone-500">No hay eventos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Outbox">
        <QueueTable rows={outbox} direction="out" />
      </Section>
      <Section title="Inbox">
        <QueueTable rows={inbox} direction="in" />
      </Section>
      <div className="xl:col-span-2">
        <Section title="Transfer pricing">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs font-semibold text-stone-500">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Transaccion</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2 text-right">Costo</th>
                  <th className="px-3 py-2 text-right">Markup</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2">Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {pricingLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-3 py-3 text-stone-600">{fmtDate(log.created_at)}</td>
                    <td className="px-3 py-3 text-stone-800">{log.intercompany_transactions?.transaction_code || '-'}</td>
                    <td className="px-3 py-3 text-stone-700">{log.product_sku}</td>
                    <td className="px-3 py-3 text-right">{fmtMoney(log.cost)}</td>
                    <td className="px-3 py-3 text-right">{(Number(log.applied_margin_pct || 0) * 100).toFixed(2)}%</td>
                    <td className="px-3 py-3 text-right font-medium text-stone-900">{fmtMoney(log.calculated_price)}</td>
                    <td className="px-3 py-3"><Badge tone={log.compliance_adjustment ? 'amber' : 'green'}>{log.compliance_adjustment ? 'Ajustado' : 'Normal'}</Badge></td>
                  </tr>
                ))}
                {pricingLogs.length === 0 && snapshots.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-stone-500">No hay calculos registrados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}

function QueueTable({ rows, direction }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs font-semibold text-stone-500">
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Partner</th>
            <th className="px-3 py-2">Evento</th>
            <th className="px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-3 text-stone-600">{fmtDate(direction === 'out' ? row.created_at : row.received_at)}</td>
              <td className="px-3 py-3 text-stone-800">{row.intercompany_partners?.codigo || '-'}</td>
              <td className="px-3 py-3 text-stone-700">{row.event_type}</td>
              <td className="px-3 py-3"><Badge tone={['sent', 'acked', 'processed'].includes(row.status) ? 'green' : ['failed'].includes(row.status) ? 'red' : 'amber'}>{row.status}</Badge></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="px-3 py-8 text-center text-stone-500">Sin eventos.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function FelIntercompanyPage() {
  const [tab, setTab] = useState('partners')
  const [data, setData] = useState({
    partners: [],
    agreements: [],
    certificadores: [],
    felDocuments: [],
    snapshots: [],
    transactions: [],
    integrationEvents: [],
    pricingRules: [],
    pricingLogs: [],
    clients: [],
    outbox: [],
    inbox: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await getFelIntercompanyDashboard())
    } catch (err) {
      setError(err.message || 'No se pudo cargar FEL/intercompany')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useRealtimeRefresh(
    [
      'intercompany_partners',
      'intercompany_price_agreements',
      'fel_certificadores',
      'fel_documents',
      'transfer_pricing_snapshots',
      'intercompany_transactions',
      'integration_events',
      'transfer_pricing_rules',
      'transfer_pricing_logs',
      'intercompany_outbox',
      'intercompany_inbox',
    ],
    load,
  )

  const totals = useMemo(() => ({
    pendingFel: data.felDocuments.filter((doc) => ['pending', 'certifying', 'rejected'].includes(doc.estado_fel)).length,
    activePartners: data.partners.filter((partner) => partner.is_active).length,
    pendingOutbox: data.integrationEvents.filter((event) => event.status === 'pending').length + data.outbox.filter((event) => event.status === 'pending').length,
  }), [data])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-stone-900">FEL e intercompany</h1>
          <p className="mt-1 text-sm text-stone-500">Partners, acuerdos de precio, documentos FEL y cola de integracion.</p>
        </div>
        <div className="flex gap-3 text-sm">
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
            <div className="font-semibold text-stone-900">{totals.activePartners}</div>
            <div className="text-stone-500">partners activos</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
            <div className="font-semibold text-stone-900">{totals.pendingFel}</div>
            <div className="text-stone-500">FEL pendientes</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
            <div className="font-semibold text-stone-900">{totals.pendingOutbox}</div>
            <div className="text-stone-500">outbox pendiente</div>
          </div>
        </div>
      </div>

      <div className="border-b border-stone-200">
        <div className="flex gap-6">
          <TabButton active={tab === 'partners'} onClick={() => setTab('partners')}>Partners</TabButton>
          <TabButton active={tab === 'agreements'} onClick={() => setTab('agreements')}>Acuerdos</TabButton>
          <TabButton active={tab === 'fel'} onClick={() => setTab('fel')}>FEL</TabButton>
          <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>Cola y TP</TabButton>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="rounded-lg border border-stone-200 bg-white py-12 text-center text-sm text-stone-500">Cargando...</div>
      ) : tab === 'partners' ? (
        <PartnersTab partners={data.partners} clients={data.clients} onSaved={load} />
      ) : tab === 'agreements' ? (
        <AgreementsTab agreements={data.agreements} partners={data.partners} onSaved={load} />
      ) : tab === 'fel' ? (
        <FelTab certificadores={data.certificadores} documents={data.felDocuments} onSaved={load} />
      ) : (
        <QueueTab
          outbox={data.outbox}
          inbox={data.inbox}
          snapshots={data.snapshots}
          transactions={data.transactions}
          integrationEvents={data.integrationEvents}
          pricingLogs={data.pricingLogs}
        />
      )}
    </div>
  )
}
