// ─── Motor de Pricing Comercial ───────────────────────────────────────────────
// Toda esta lógica es INTERNA al ERP. Nunca debe mostrarse al cliente.

export const DISCOUNT_HIGH   = 5    // % de descuento para volumen alto
export const PREMIUM_LOW     = 8    // % de sobreprecio para volumen bajo
export const ADJUSTMENT_MED  = 2    // % de ajuste para volumen medio

/**
 * Clasifica el volumen respecto a los umbrales del producto.
 * @returns {'bajo'|'medio'|'alto'}
 */
export function classifyVolume(volume, lowThreshold = 50, highThreshold = 200) {
  const v = Number(volume) || 0
  if (v >= highThreshold) return 'alto'
  if (v <= lowThreshold)  return 'bajo'
  return 'medio'
}

/**
 * Motor principal de pricing.
 * Calcula el precio sugerido a partir de la información del producto y contexto comercial.
 *
 * @param {object} params
 * @param {number}  params.refPrice          - Precio medio de referencia (suggested_price)
 * @param {number}  params.minPrice          - Precio mínimo rentable
 * @param {number}  params.volume            - Volumen estimado de compra
 * @param {number}  params.lowThreshold      - Umbral bajo (por producto)
 * @param {number}  params.highThreshold     - Umbral alto (por producto)
 * @param {'baja'|'media'|'alta'} params.growthOpportunity - Oportunidad de crecimiento
 * @returns {PricingResult}
 */
export function computePricing({
  refPrice,
  minPrice,
  volume,
  lowThreshold = 50,
  highThreshold = 200,
  growthOpportunity = 'media',
}) {
  const ref = Number(refPrice) || 0
  const min = Number(minPrice) || 0
  const vol = Number(volume)   || 0

  if (ref <= 0) {
    return {
      volumeClass:    classifyVolume(vol, lowThreshold, highThreshold),
      adjustmentPct:  0,
      ruleApplied:    'Sin precio de referencia definido',
      suggestedPrice: 0,
      autoNote:       null,
      belowMinimum:   false,
    }
  }

  const volumeClass = classifyVolume(vol, lowThreshold, highThreshold)
  let adjustmentPct = 0
  let ruleApplied   = ''
  let autoNote      = null

  // Caso 1: Volumen alto → descuento sobre la media
  if (volumeClass === 'alto') {
    adjustmentPct = -DISCOUNT_HIGH
    ruleApplied   = `Volumen alto: −${DISCOUNT_HIGH}% sobre precio medio`

  // Caso 3: Volumen bajo + alta oportunidad → precio medio + nota
  } else if (volumeClass === 'bajo' && growthOpportunity === 'alta') {
    adjustmentPct = 0
    ruleApplied   = 'Volumen bajo con alta oportunidad: precio medio aplicado'
    autoNote      = 'Los precios podrán renegociarse conforme crecimiento de volúmenes de compra.'

  // Caso 2: Volumen bajo → precio sobre la media
  } else if (volumeClass === 'bajo') {
    adjustmentPct = PREMIUM_LOW
    ruleApplied   = `Volumen bajo: +${PREMIUM_LOW}% sobre precio medio`

  // Caso 4: Volumen medio → ajuste mínimo
  } else {
    adjustmentPct = ADJUSTMENT_MED
    ruleApplied   = `Volumen medio: +${ADJUSTMENT_MED}% ajuste estándar`
  }

  let suggestedPrice = ref * (1 + adjustmentPct / 100)

  // Nunca por debajo del mínimo rentable
  let belowMinimum = false
  if (min > 0 && suggestedPrice < min) {
    suggestedPrice = min
    ruleApplied   += ' → ajustado al mínimo rentable'
    belowMinimum   = true
  }

  return {
    volumeClass,
    adjustmentPct,
    ruleApplied,
    suggestedPrice: Math.round(suggestedPrice * 10000) / 10000,
    autoNote,
    belowMinimum,
  }
}

/**
 * Determina si el precio final ingresado por el usuario está por debajo del mínimo.
 */
export function isBelowMinimum(finalPrice, minPrice) {
  const fp = Number(finalPrice) || 0
  const mp = Number(minPrice)   || 0
  return mp > 0 && fp < mp
}

/**
 * Calcula el subtotal de una línea.
 */
export function calcSubtotal(finalPrice, volume) {
  return Math.round(Number(finalPrice) * Number(volume) * 100) / 100
}

/**
 * Calcula el total general de todas las líneas.
 */
export function calcTotal(items) {
  return items.reduce((acc, i) => acc + (Number(i.subtotal) || 0), 0)
}

export const VOLUME_CLASS_LABEL = {
  bajo:  'Bajo',
  medio: 'Medio',
  alto:  'Alto',
}

export const VOLUME_CLASS_COLOR = {
  bajo:  'bg-red-100 text-red-700',
  medio: 'bg-amber-100 text-amber-700',
  alto:  'bg-emerald-100 text-emerald-700',
}
