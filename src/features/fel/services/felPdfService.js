import { jsPDF } from 'jspdf'

function n(value) {
  const num = Number(value)
  return Number.isNaN(num) ? 0 : num
}

function money(value) {
  return n(value).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function integerToSpanishWords(value) {
  const units = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
  const teens = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve']
  const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
  const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

  function underHundred(num) {
    if (num < 10) return units[num]
    if (num < 20) return teens[num - 10]
    if (num === 20) return 'veinte'
    if (num < 30) return `veinti${units[num - 20]}`
    const ten = Math.floor(num / 10)
    const unit = num % 10
    return unit ? `${tens[ten]} y ${units[unit]}` : tens[ten]
  }

  function underThousand(num) {
    if (num === 0) return ''
    if (num === 100) return 'cien'
    if (num < 100) return underHundred(num)
    const hundred = Math.floor(num / 100)
    const rest = num % 100
    return rest ? `${hundreds[hundred]} ${underHundred(rest)}` : hundreds[hundred]
  }

  function chunk(num) {
    if (num === 0) return 'cero'
    if (num < 1000) return underThousand(num)
    if (num < 1000000) {
      const thousands = Math.floor(num / 1000)
      const rest = num % 1000
      const prefix = thousands === 1 ? 'mil' : `${underThousand(thousands)} mil`
      return rest ? `${prefix} ${underThousand(rest)}` : prefix
    }
    const millions = Math.floor(num / 1000000)
    const rest = num % 1000000
    const prefix = millions === 1 ? 'un millon' : `${chunk(millions)} millones`
    return rest ? `${prefix} ${chunk(rest)}` : prefix
  }

  return chunk(Math.max(0, Math.floor(value)))
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

function totalInWords(total, currency = 'GTQ') {
  const amount = Math.round(n(total) * 100) / 100
  const integer = Math.floor(amount)
  const cents = Math.round((amount - integer) * 100)
  const currencyName = String(currency).toUpperCase() === 'USD'
    ? (integer === 1 ? 'dolar' : 'dolares')
    : (integer === 1 ? 'quetzal' : 'quetzales')

  return `${capitalize(integerToSpanishWords(integer))} ${currencyName} con ${String(cents).padStart(2, '0')}/100`
}

const LEGUCORP_LEGAL_NAME = 'LEGUCORP, SOCIEDAD ANONIMA'
const LEGUCORP_NIT = '69232121'
const LEGUCORP_ADDRESS = 'CALLE REAL ZONA 16 FINCA LAS MARIAS, ALAMEDA SAN ISIDRO A SAN GASPAR, GUATEMALA, GUATEMALA'
const FEL_BLUE = [14, 58, 79]
const LIGHT_BORDER = [205, 205, 205]

function dateText(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function dateTimeText(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 19)
  return date.toLocaleString('es-GT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function cleanFilePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function cleanAddress(value) {
  return String(value || '')
    .replace(/coordenadas\s*:\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim()
}

let cachedLogo = null

async function getLogoDataUrl() {
  if (cachedLogo) return cachedLogo

  const response = await fetch('/legucorp-logo.png')
  if (!response.ok) return null

  const blob = await response.blob()
  cachedLogo = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })

  return cachedLogo
}

function drawLabelValue(doc, label, value, x, y, width = 82) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(120, 113, 108)
  doc.text(label, x, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(28, 25, 23)
  doc.text(doc.splitTextToSize(String(value || '-'), width), x, y + 5)
}

function drawPanel(doc, x, y, w, h, title) {
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, w, h, 2, 2, 'F')
  doc.setDrawColor(...LIGHT_BORDER)
  doc.setLineWidth(0.25)
  doc.roundedRect(x, y, w, h, 2, 2)
  doc.setFillColor(...FEL_BLUE)
  doc.roundedRect(x, y, w, 8, 2, 2, 'F')
  doc.rect(x, y + 4, w, 4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text(title, x + w / 2, y + 5.5, { align: 'center' })
}

function drawPanelRow(doc, label, value, x, y, labelWidth = 26, width = 92, fontSize = 8) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(fontSize)
  doc.setTextColor(36, 36, 36)
  doc.text(label, x, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  doc.text(doc.splitTextToSize(String(value || '-'), width), x + labelWidth, y)
}

function drawStackedPanelRow(doc, label, value, x, y, width = 58, fontSize = 7.5) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(fontSize)
  doc.setTextColor(36, 36, 36)
  doc.text(label, x, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  doc.text(doc.splitTextToSize(String(value || '-'), width), x, y + 4)
}

function drawTableHeader(doc, y, pageWidth) {
  const left = 14
  const width = pageWidth - 28
  doc.setFillColor(...FEL_BLUE)
  doc.rect(left, y, width, 10, 'F')
  doc.setDrawColor(178, 178, 178)
  doc.setLineWidth(0.25)
  doc.rect(left, y, width, 10)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text('Cantidad', 18, y + 6.5)
  doc.text('Producto', 40, y + 6.5)
  doc.text('Precio (Q)', 134, y + 6.5, { align: 'right' })
  doc.text('IVA (Q)', 162, y + 6.5, { align: 'right' })
  doc.text('Total (Q)', pageWidth - 20, y + 6.5, { align: 'right' })
}

function drawTableGrid(doc, y, height, pageWidth) {
  const xs = [14, 38, 112, 140, 168, pageWidth - 14]
  doc.setDrawColor(218, 218, 218)
  doc.setLineWidth(0.2)
  xs.forEach((x) => doc.line(x, y, x, y + height))
  doc.line(14, y + height, pageWidth - 14, y + height)
}

function addPageLabel(doc, page, pageCount) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.2)
  doc.setTextColor(36, 36, 36)
  if (page === 1) {
    doc.text(`Pagina ${page} de ${pageCount}`, 192, 76, { align: 'right' })
  } else {
    doc.text(`Pagina ${page} de ${pageCount}`, pageWidth - 14, 16, { align: 'right' })
  }
}

function addFooter(doc, invoice) {
  const pageCount = doc.internal.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(70, 70, 70)
    doc.text('Certificador: MEGAPRINT, S.A.', 14, pageHeight - 14)
    doc.text(`Emisor: ${invoice.emisor_nombre || 'LEGUCORP, SOCIEDAD ANONIMA'}`, pageWidth - 14, pageHeight - 14, { align: 'right' })
    addPageLabel(doc, page, pageCount)
  }
}

export function felPdfFileName(invoice) {
  const number = cleanFilePart(invoice.numero || invoice.dte_uuid || invoice.id)
  const client = cleanFilePart(invoice.receptor_nombre || invoice.order?.clients?.commercial_name || 'cliente')
  return `factura-fel-${number || 'sin-numero'}-${client || 'cliente'}.pdf`
}

export async function buildFelPdfBlob(invoice) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logo = await getLogoDataUrl()
  const lines = invoice.fel_document_lines || []
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  if (logo) {
    doc.addImage(logo, 'PNG', 22, 12, 22, 22, undefined, 'FAST')
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(55, 65, 81)
  doc.text('Factura', pageWidth / 2, 17, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(40, 40, 40)
  doc.text('Regimen FEL', pageWidth - 14, 16, { align: 'right' })
  doc.text('Documento Tributario Electronico', pageWidth - 14, 22, { align: 'right' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(50, 50, 50)
  doc.text('LEGUCORP', 39, 42, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(LEGUCORP_LEGAL_NAME, 39, 48, { align: 'center' })
  doc.text(doc.splitTextToSize(LEGUCORP_ADDRESS, 55), 39, 54, { align: 'center' })
  doc.text(`NIT: ${invoice.emisor_nit || LEGUCORP_NIT}`, 39, 72, { align: 'center' })

  drawPanel(doc, 68, 30, 74, 50, 'DATOS DEL CLIENTE')
  drawPanelRow(doc, 'Nombre:', invoice.receptor_nombre || invoice.order?.clients?.commercial_name || 'Consumidor final', 72, 44, 18, 45, 7.5)
  drawPanelRow(doc, 'NIT:', invoice.receptor_nit || invoice.order?.clients?.nit || 'CF', 72, 55, 18, 45, 7.5)
  drawPanelRow(doc, 'Direccion:', cleanAddress(invoice.receptor_direccion), 72, 66, 18, 47, 7.5)

  drawPanel(doc, 145, 30, 51, 50, 'DATOS DE LA FACTURA')
  drawStackedPanelRow(doc, 'NUMERO DE AUTORIZACION:', invoice.numero_autorizacion || invoice.dte_uuid || '-', 149, 42, 44, 5.9)
  drawPanelRow(doc, 'Serie:', invoice.serie || '-', 149, 58, 16, 28, 7.2)
  drawPanelRow(doc, 'Numero:', invoice.numero || '-', 149, 65, 16, 28, 7.2)
  drawPanelRow(doc, 'Emision:', dateTimeText(invoice.fecha_emision), 149, 72, 16, 30, 7.2)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(55, 65, 81)
  doc.text(`No. Interno: FEL-${invoice.order?.order_number || invoice.numero || ''}`, pageWidth - 74, 90)

  let y = 96
  drawTableHeader(doc, y, pageWidth)
  y += 10

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(28, 25, 23)

  lines.forEach((line) => {
    const description = doc.splitTextToSize(line.descripcion || 'Producto', 68)
    const rowHeight = Math.max(9, description.length * 4 + 3)

    if (y + rowHeight > pageHeight - 40) {
      doc.addPage()
      y = 18
      drawTableHeader(doc, y, pageWidth)
      y += 10
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(28, 25, 23)
    }

    if (Math.floor((y - 106) / Math.max(rowHeight, 1)) % 2 === 0) {
      doc.setFillColor(250, 250, 249)
      doc.rect(14, y - 1, pageWidth - 28, rowHeight, 'F')
    }
    drawTableGrid(doc, y - 1, rowHeight, pageWidth)
    doc.text(`${money(line.cantidad)} Uni`, 36, y + 4, { align: 'right' })
    doc.text(description, 40, y + 4)
    doc.text(money(line.precio_unitario), 134, y + 4, { align: 'right' })
    doc.text(`IVA: ${money(line.iva)}`, 162, y + 4, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(money(line.total_linea), pageWidth - 20, y + 4, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += rowHeight
  })

  const totalY = pageHeight - 34
  doc.setDrawColor(...LIGHT_BORDER)
  doc.roundedRect(14, totalY - 13, pageWidth - 28, 28, 2, 2)
  doc.setFillColor(250, 250, 249)
  doc.rect(14.5, totalY - 12.5, pageWidth - 29, 27, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(28, 25, 23)
  doc.text('SUJETO A PAGOS TRIMESTRALES', 14, totalY)
  doc.text('TOTALES:', 102, totalY)
  doc.text(`${invoice.moneda || 'Q'} ${money(invoice.total)}`, 158, totalY, { align: 'right' })
  doc.text(`IVA: ${money(invoice.iva)}`, pageWidth - 20, totalY, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(doc.splitTextToSize(totalInWords(invoice.total, invoice.moneda), 92), 102, totalY + 11)

  addFooter(doc, invoice)
  return doc.output('blob')
}

export async function downloadFelPdf(invoice) {
  const blob = await buildFelPdfBlob(invoice)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = felPdfFileName(invoice)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
