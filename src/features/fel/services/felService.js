import { supabase } from '../../../lib/supabase'

async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', user.id)
    .single()

  if (error) throw new Error(error.message)
  return profile
}

function n(value) {
  const num = Number(value)
  return Number.isNaN(num) ? 0 : num
}

export async function getFelInvoices({ status = 'all', search = '', date = '' } = {}) {
  const profile = await getProfile()
  let query = supabase
    .from('fel_documents')
    .select(`
      id, tipo_documento, serie, numero, fecha_emision, fecha_certificacion,
      emisor_nit, emisor_nombre, receptor_nit, receptor_nombre, receptor_direccion,
      moneda, subtotal, iva, total,
      dte_uuid, numero_autorizacion, xml_firmado_url, cafe_pdf_url,
      estado_fel, source_type, source_id, fel_error_json, created_at,
      fel_document_lines (
        id, line_no, descripcion, codigo_producto, cantidad, unidad_medida,
        precio_unitario, descuento, subtotal, iva, total_linea
      )
    `)
    .eq('organization_id', profile.organization_id)
    .order('fecha_emision', { ascending: false })

  if (status !== 'all') query = query.eq('estado_fel', status)
  if (date) {
    const start = `${date}T00:00:00`
    const endDate = new Date(`${date}T00:00:00`)
    endDate.setDate(endDate.getDate() + 1)
    const end = endDate.toISOString().slice(0, 19)
    query = query.gte('fecha_emision', start).lt('fecha_emision', end)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const docs = data || []
  const orderIds = docs
    .filter((doc) => doc.source_type === 'order' && doc.source_id)
    .map((doc) => doc.source_id)

  let ordersById = {}
  if (orderIds.length) {
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id, order_number, delivery_date, status, clients ( id, commercial_name, nit )')
      .in('id', orderIds)

    if (orderError) throw new Error(orderError.message)
    ordersById = (orders || []).reduce((acc, order) => {
      acc[order.id] = order
      return acc
    }, {})
  }

  const term = search.trim().toLowerCase()
  return docs
    .map((doc) => ({
      ...doc,
      total: n(doc.total),
      iva: n(doc.iva),
      subtotal: n(doc.subtotal),
      order: doc.source_type === 'order' ? ordersById[doc.source_id] || null : null,
      fel_document_lines: [...(doc.fel_document_lines || [])].sort((a, b) => a.line_no - b.line_no),
    }))
    .filter((doc) => {
      if (!term) return true
      return [
        doc.serie,
        doc.numero,
        doc.dte_uuid,
        doc.numero_autorizacion,
        doc.receptor_nombre,
        doc.receptor_nit,
        doc.order?.order_number ? `pedido ${doc.order.order_number}` : '',
      ].some((value) => String(value || '').toLowerCase().includes(term))
    })
}
