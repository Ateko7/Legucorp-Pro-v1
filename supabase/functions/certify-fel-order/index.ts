import {
  corsHeaders,
  getServiceClient,
  jsonResponse,
  logIntegrationEvent,
  parseJson,
  requirePost,
} from '../_shared/intercompany.ts'

type FelLine = {
  line_no: number
  descripcion: string
  codigo_producto: string | null
  cantidad: number
  unidad_medida: string
  precio_unitario: number
  descuento: number
  subtotal: number
  iva: number
  total_linea: number
  bien_o_servicio: string
}

type FelDocument = {
  id: string
  organization_id: string
  tipo_documento: string
  serie: string | null
  numero: string | null
  fecha_emision: string
  emisor_nit: string
  emisor_nombre: string | null
  receptor_nit: string | null
  receptor_nombre: string | null
  receptor_direccion: string | null
  receptor_email: string | null
  moneda: string
  tipo_cambio: number | null
  subtotal: number
  descuento: number
  iva: number
  otros_impuestos: number
  total: number
  es_exportacion: boolean
  source_id: string | null
  fel_document_lines: FelLine[]
}

function bearerToken(req: Request) {
  const header = req.headers.get('authorization') || ''
  return header.replace(/^Bearer\s+/i, '').trim()
}

async function getUserProfile(supabase: ReturnType<typeof getServiceClient>, req: Request) {
  const token = bearerToken(req)
  if (!token) throw new Error('Authorization bearer token is required')

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData.user) throw new Error('Invalid Supabase session')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', userData.user.id)
    .single()

  if (profileError || !profile) throw new Error('User profile not found')
  return profile
}

function buildMegaprintPayload(document: FelDocument) {
  return {
    document_id: document.id,
    tipo_documento: document.tipo_documento,
    fecha_emision: document.fecha_emision,
    moneda: document.moneda,
    tipo_cambio: document.tipo_cambio,
    emisor: {
      nit: document.emisor_nit,
      nombre: document.emisor_nombre,
    },
    receptor: {
      nit: document.receptor_nit || 'CF',
      nombre: document.receptor_nombre || 'Consumidor final',
      direccion: document.receptor_direccion || 'Ciudad',
      email: document.receptor_email,
    },
    totales: {
      subtotal: document.subtotal,
      descuento: document.descuento,
      iva: document.iva,
      otros_impuestos: document.otros_impuestos,
      total: document.total,
    },
    lineas: (document.fel_document_lines || []).map((line) => ({
      numero_linea: line.line_no,
      descripcion: line.descripcion,
      codigo_producto: line.codigo_producto,
      cantidad: line.cantidad,
      unidad_medida: line.unidad_medida,
      precio_unitario: line.precio_unitario,
      descuento: line.descuento,
      subtotal: line.subtotal,
      iva: line.iva,
      total_linea: line.total_linea,
      bien_o_servicio: line.bien_o_servicio,
    })),
    metadata: {
      source_type: 'order',
      source_id: document.source_id,
      es_exportacion: document.es_exportacion,
    },
  }
}

function cdata(value: string) {
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatAmount(value: number | null | undefined, decimals = 6) {
  const num = Number(value || 0)
  return num.toFixed(decimals)
}

function roundAmount(value: number, decimals = 6) {
  const factor = 10 ** decimals
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor
}

function formatFelDateTime(value: string) {
  const pad = (num: number) => String(num).padStart(2, '0')
  const source = value || new Date().toISOString()

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(source)) {
    const parsed = new Date(source)
    if (!Number.isNaN(parsed.getTime())) {
      const gt = new Date(parsed.getTime() - 6 * 60 * 60 * 1000)
      return `${gt.getUTCFullYear()}-${pad(gt.getUTCMonth() + 1)}-${pad(gt.getUTCDate())}T${pad(gt.getUTCHours())}:${pad(gt.getUTCMinutes())}:${pad(gt.getUTCSeconds())}-06:00`
    }
  }

  const match = source.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return formatFelDateTime(new Date().toISOString())

  return `${match[1]}T${match[2] || '00'}:${match[3] || '00'}:${match[4] || '00'}-06:00`
}

function cleanNit(value: string | null | undefined, fallback = 'CF') {
  const cleaned = String(value || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return cleaned || fallback
}

function taxableBase(total: number, iva: number) {
  if (Number(iva || 0) > 0) return Number(total || 0) - Number(iva || 0)
  return Number(total || 0) / 1.12
}

function ivaAmount(total: number, iva: number) {
  if (Number(iva || 0) > 0) return Number(iva || 0)
  return Number(total || 0) - (Number(total || 0) / 1.12)
}

function buildMegaprintDteXml(document: FelDocument) {
  const lines = (document.fel_document_lines || []).map((line) => {
    const quantity = Number(line.cantidad || 0)
    const discount = Number(line.descuento || 0)
    const total = Number(line.total_linea || line.subtotal || 0)
    const price = roundAmount(total + discount)
    const unitPrice = quantity > 0 ? roundAmount(price / quantity) : 0
    const iva = ivaAmount(total, Number(line.iva || 0))
    const base = taxableBase(total, iva)

    return `
            <dte:Item BienOServicio="${escapeXml(line.bien_o_servicio || 'B')}" NumeroLinea="${line.line_no}">
              <dte:Cantidad>${formatAmount(quantity)}</dte:Cantidad>
              <dte:UnidadMedida>${escapeXml(line.unidad_medida || 'UNI')}</dte:UnidadMedida>
              <dte:Descripcion>${escapeXml(line.descripcion || 'Producto')}</dte:Descripcion>
              <dte:PrecioUnitario>${formatAmount(unitPrice)}</dte:PrecioUnitario>
              <dte:Precio>${formatAmount(price)}</dte:Precio>
              <dte:Descuento>${formatAmount(discount)}</dte:Descuento>
              <dte:Impuestos>
                <dte:Impuesto>
                  <dte:NombreCorto>IVA</dte:NombreCorto>
                  <dte:CodigoUnidadGravable>1</dte:CodigoUnidadGravable>
                  <dte:MontoGravable>${formatAmount(base)}</dte:MontoGravable>
                  <dte:MontoImpuesto>${formatAmount(iva)}</dte:MontoImpuesto>
                </dte:Impuesto>
              </dte:Impuestos>
              <dte:Total>${formatAmount(total)}</dte:Total>
            </dte:Item>`
  }).join('')

  const total = Number(document.total || 0)
  const iva = Number(document.iva || 0) > 0
    ? Number(document.iva || 0)
    : (document.fel_document_lines || []).reduce((sum, line) => sum + ivaAmount(Number(line.total_linea || line.subtotal || 0), Number(line.iva || 0)), 0)
  const emisorNit = cleanNit(document.emisor_nit, Deno.env.get('MEGAPRINT_USER') || '69232121')
  const receptorNit = cleanNit(document.receptor_nit, 'CF')

  return `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" Version="0.1">
  <dte:SAT ClaseDocumento="dte">
    <dte:DTE ID="DatosCertificados">
      <dte:DatosEmision ID="DatosEmision">
        <dte:DatosGenerales CodigoMoneda="${escapeXml(document.moneda || 'GTQ')}" FechaHoraEmision="${escapeXml(formatFelDateTime(document.fecha_emision))}" Tipo="${escapeXml(document.tipo_documento || 'FACT')}"/>
        <dte:Emisor AfiliacionIVA="GEN" CodigoEstablecimiento="1" CorreoEmisor="" NITEmisor="${escapeXml(emisorNit)}" NombreComercial="${escapeXml(document.emisor_nombre || 'LEGUCORP')}" NombreEmisor="${escapeXml(document.emisor_nombre || 'LEGUCORP, SOCIEDAD ANONIMA')}">
          <dte:DireccionEmisor>
            <dte:Direccion>Ciudad</dte:Direccion>
            <dte:CodigoPostal>01001</dte:CodigoPostal>
            <dte:Municipio>Guatemala</dte:Municipio>
            <dte:Departamento>Guatemala</dte:Departamento>
            <dte:Pais>GT</dte:Pais>
          </dte:DireccionEmisor>
        </dte:Emisor>
        <dte:Receptor ${document.receptor_email ? `CorreoReceptor="${escapeXml(document.receptor_email)}"` : ''} IDReceptor="${escapeXml(receptorNit)}" NombreReceptor="${escapeXml(document.receptor_nombre || 'Consumidor Final')}">
          <dte:DireccionReceptor>
            <dte:Direccion>${escapeXml(document.receptor_direccion || 'Ciudad')}</dte:Direccion>
            <dte:CodigoPostal>01001</dte:CodigoPostal>
            <dte:Municipio>Guatemala</dte:Municipio>
            <dte:Departamento>Guatemala</dte:Departamento>
            <dte:Pais>GT</dte:Pais>
          </dte:DireccionReceptor>
        </dte:Receptor>
        <dte:Frases>
          <dte:Frase CodigoEscenario="1" TipoFrase="1"/>
        </dte:Frases>
        <dte:Items>${lines}
        </dte:Items>
        <dte:Totales>
          <dte:TotalImpuestos>
            <dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${formatAmount(iva)}"/>
          </dte:TotalImpuestos>
          <dte:GranTotal>${formatAmount(total)}</dte:GranTotal>
        </dte:Totales>
      </dte:DatosEmision>
    </dte:DTE>
  </dte:SAT>
</dte:GTDocumento>`
}

function buildMegaprintRegisterRequest(document: FelDocument, signedXml: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<RegistraDocumentoXMLRequest id="${escapeXml(document.id.toUpperCase())}">
  <xml_dte>${cdata(signedXml)}</xml_dte>
</RegistraDocumentoXMLRequest>`
}

function buildMegaprintSignRequest(xml: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FirmaDocumentoRequest>
  <xml_dte>${cdata(xml)}</xml_dte>
</FirmaDocumentoRequest>`
}

function readXmlTag(xml: string, names: string[]) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function requestMegaprintToken() {
  const tokenUrl = Deno.env.get('MEGAPRINT_TOKEN_URL')
  const apiKey = Deno.env.get('MEGAPRINT_API_KEY')
  const user = Deno.env.get('MEGAPRINT_USER')

  if (!tokenUrl) throw new Error('Missing MEGAPRINT_TOKEN_URL')
  if (!apiKey) throw new Error('Missing MEGAPRINT_API_KEY')
  if (!user) throw new Error('Missing MEGAPRINT_USER')

  const body = `<SolicitaTokenRequest><usuario>${escapeXml(user)}</usuario><apikey>${escapeXml(apiKey)}</apikey></SolicitaTokenRequest>`
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  })

  const raw = await response.text()
  const token = readXmlTag(raw, ['token', 'Token', 'access_token', 'jwt'])
  if (response.ok && token) return token

  const error = readXmlTag(raw, ['desc_error', 'error', 'mensaje', 'message']) || `Megaprint token responded ${response.status}`
  throw new Error(error)
}

async function signWithMegaprint(xml: string, token: string) {
  const signUrl = Deno.env.get('MEGAPRINT_SIGN_URL')
  const apiKey = Deno.env.get('MEGAPRINT_API_KEY')
  const user = Deno.env.get('MEGAPRINT_USER')

  if (!signUrl) throw new Error('Missing MEGAPRINT_SIGN_URL')

  const response = await fetch(signUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: `Bearer ${token}`,
      ...(apiKey ? { apikey: apiKey, 'x-api-key': apiKey } : {}),
      ...(user ? { usuario: user, 'x-user': user } : {}),
    },
    body: buildMegaprintSignRequest(xml),
  })

  const raw = await response.text()
  const error = readXmlTag(raw, ['desc_error', 'error', 'mensaje', 'message'])
  if (!response.ok || error) {
    throw new Error(error || `Megaprint sign responded ${response.status}`)
  }

  const signedXml = readXmlTag(raw, ['xml_dte', 'xml_firmado', 'xml'])
  if (!signedXml) throw new Error('Megaprint sign response did not include signed XML')

  return decodeXmlEntities(signedXml)
}

async function certifyWithMegaprint(document: FelDocument) {
  const certifyUrl = Deno.env.get('MEGAPRINT_CERTIFY_URL')
  const apiKey = Deno.env.get('MEGAPRINT_API_KEY')
  const user = Deno.env.get('MEGAPRINT_USER')

  if (!certifyUrl) {
    throw new Error('Missing MEGAPRINT_CERTIFY_URL')
  }

  const token = await requestMegaprintToken()
  const unsignedXml = buildMegaprintDteXml(document)
  const signedXml = await signWithMegaprint(unsignedXml, token)

  const response = await fetch(certifyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Authorization: `Bearer ${token}`,
      ...(apiKey ? { apikey: apiKey, 'x-api-key': apiKey } : {}),
      ...(user ? { usuario: user, 'x-user': user } : {}),
    },
    body: buildMegaprintRegisterRequest(document, signedXml),
  })

  const rawResponse = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(rawResponse)
  } catch {
    body = {
      raw_response: rawResponse,
      dte_uuid: readXmlTag(rawResponse, ['uuid', 'dte_uuid', 'numero_autorizacion', 'autorizacion']),
      numero_autorizacion: readXmlTag(rawResponse, ['numero_autorizacion', 'autorizacion', 'uuid']),
      serie: readXmlTag(rawResponse, ['serie']),
      numero: readXmlTag(rawResponse, ['numero']),
      xml_firmado_url: readXmlTag(rawResponse, ['xml_firmado_url', 'xml_url']),
      cafe_pdf_url: readXmlTag(rawResponse, ['cafe_pdf_url', 'pdf_url']),
      error: readXmlTag(rawResponse, ['desc_error', 'error', 'mensaje', 'message']),
    }
  }

  if (!response.ok) {
    const message = typeof body.error === 'string'
      ? body.error
      : `Megaprint responded ${response.status}`
    throw new Error(message)
  }

  if (typeof body.error === 'string' && body.error) {
    throw new Error(body.error)
  }

  return body
}

function mockCertification(document: FelDocument) {
  const now = new Date().toISOString()
  const suffix = document.id.slice(0, 8).toUpperCase()
  return {
    dte_uuid: `MOCK-${suffix}`,
    numero_autorizacion: `MOCK-AUTH-${suffix}`,
    serie: document.serie || 'MOCK',
    numero: document.numero || suffix,
    xml_firmado_url: null,
    cafe_pdf_url: null,
    fecha_certificacion: now,
    raw_response: { adapter: 'mock', certified_at: now },
  }
}

function readCertificationResult(raw: Record<string, unknown>) {
  return {
    dte_uuid: String(raw.dte_uuid || raw.uuid || raw.numero_autorizacion || ''),
    numero_autorizacion: String(raw.numero_autorizacion || raw.authorization_number || raw.uuid || ''),
    serie: raw.serie ? String(raw.serie) : null,
    numero: raw.numero ? String(raw.numero) : null,
    xml_firmado_url: raw.xml_firmado_url ? String(raw.xml_firmado_url) : raw.xml_url ? String(raw.xml_url) : null,
    cafe_pdf_url: raw.cafe_pdf_url ? String(raw.cafe_pdf_url) : raw.pdf_url ? String(raw.pdf_url) : null,
    fecha_certificacion: raw.fecha_certificacion ? String(raw.fecha_certificacion) : new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const methodError = requirePost(req)
  if (methodError) return methodError

  const supabase = getServiceClient()
  let orderId: string | null = null

  try {
    const body = await parseJson(req) as { order_id?: string; force_mock?: boolean }
    if (!body.order_id) throw new Error('order_id is required')
    orderId = body.order_id

    const profile = await getUserProfile(supabase, req)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, organization_id, status, fel_document_id')
      .eq('id', body.order_id)
      .eq('organization_id', profile.organization_id)
      .single()

    if (orderError || !order) throw new Error('Order not found')

    const { data: docId, error: rpcError } = await supabase.rpc('generate_fel_document_for_order', {
      p_order_id: body.order_id,
      p_created_by: profile.id,
    })

    if (rpcError || !docId) throw new Error(rpcError?.message || 'Could not generate FEL document')

    const { data: document, error: docError } = await supabase
      .from('fel_documents')
      .select('*, fel_document_lines(*)')
      .eq('id', docId)
      .single()

    if (docError || !document) throw new Error('FEL document not found')

    if (document.estado_fel === 'certified') {
      await supabase.from('orders').update({ status: 'facturado' }).eq('id', body.order_id)
      return jsonResponse({ status: 'certified', fel_document: document, idempotent: true })
    }

    const { data: cert } = await supabase
      .from('fel_certificadores')
      .select('*')
      .eq('organization_id', profile.organization_id)
      .eq('is_active', true)
      .eq('is_default', true)
      .maybeSingle()

    await supabase
      .from('fel_documents')
      .update({ estado_fel: 'certifying', intentos_certificacion: Number(document.intentos_certificacion || 0) + 1 })
      .eq('id', docId)

    const adapterKey = cert?.adapter_key || 'megaprint'
    const rawCertification = body.force_mock || adapterKey === 'mock'
      ? mockCertification(document as FelDocument)
      : await certifyWithMegaprint(document as FelDocument)

    const result = readCertificationResult(rawCertification)

    if (!result.dte_uuid && !result.numero_autorizacion) {
      throw new Error('Megaprint response did not include DTE UUID or authorization number')
    }

    const { data: certifiedDoc, error: updateDocError } = await supabase
      .from('fel_documents')
      .update({
        estado_fel: 'certified',
        dte_uuid: result.dte_uuid || result.numero_autorizacion,
        numero_autorizacion: result.numero_autorizacion || result.dte_uuid,
        serie: result.serie || document.serie,
        numero: result.numero || document.numero,
        xml_firmado_url: result.xml_firmado_url,
        cafe_pdf_url: result.cafe_pdf_url,
        fecha_certificacion: result.fecha_certificacion,
        fel_error_json: null,
      })
      .eq('id', docId)
      .select()
      .single()

    if (updateDocError) throw new Error(updateDocError.message)

    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update({ status: 'facturado', fel_document_id: docId })
      .eq('id', body.order_id)

    if (orderUpdateError) throw new Error(orderUpdateError.message)

    await logIntegrationEvent(supabase, {
      level: 'info',
      message: 'FEL order certified',
      context: {
        order_id: body.order_id,
        fel_document_id: docId,
        adapter: adapterKey,
        dte_uuid: certifiedDoc.dte_uuid,
      },
    })

    return jsonResponse({ status: 'certified', fel_document: certifiedDoc })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown FEL certification error'

    try {
      if (orderId) {
        const { data: order } = await supabase
          .from('orders')
          .select('fel_document_id')
          .eq('id', orderId)
          .maybeSingle()

        if (order?.fel_document_id) {
          await supabase
            .from('fel_documents')
            .update({ estado_fel: 'rejected', fel_error_json: { message } })
            .eq('id', order.fel_document_id)
        }
      }
    } catch {
      // best-effort failure marking only
    }

    await logIntegrationEvent(supabase, {
      level: 'error',
      message: 'FEL order certification failed',
      context: { error: message },
    })

    return jsonResponse({ error: message }, 500)
  }
})
