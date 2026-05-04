import { useCallback, useEffect, useState } from 'react'

export function useCommercialModule(loader, initialValue) {
  const [data, setData] = useState(initialValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async (...args) => {
    setLoading(true)
    setError('')
    try {
      const result = await loader(...args)
      setData(result)
      return result
    } catch (err) {
      setError(err.message || 'No se pudo cargar la informacion comercial')
      throw err
    } finally {
      setLoading(false)
    }
  }, [loader])

  useEffect(() => {
    reload().catch(() => {})
  }, [reload])

  return { data, setData, loading, error, reload, setError }
}
