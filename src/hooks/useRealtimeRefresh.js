import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Subscribes to Supabase Realtime postgres_changes on the given tables.
 * Calls onRefresh (debounced) on any INSERT / UPDATE / DELETE.
 * Also re-fetches when the browser tab becomes visible again.
 *
 * @param {string[]} tables     - table names to watch (must be stable reference or array literal)
 * @param {() => void} onRefresh - the page's load / reload function
 * @param {number|{debounceMs?: number, minIntervalMs?: number}} [options=700]
 * - debounceMs: window to batch rapid changes
 * - minIntervalMs: minimum gap between refreshes
 */
export function useRealtimeRefresh(tables, onRefresh, options = 700) {
  // Keep a stable ref so the subscription closure always calls the latest callback
  const refreshRef = useRef(onRefresh)
  useEffect(() => { refreshRef.current = onRefresh }, [onRefresh])

  const debounceMs = typeof options === 'number' ? options : (options?.debounceMs ?? 700)
  const minIntervalMs = typeof options === 'number' ? 0 : (options?.minIntervalMs ?? 0)

  // Stable key for the channel so we only re-subscribe when the table list changes
  const tablesKey = Array.isArray(tables) ? tables.slice().sort().join(',') : ''

  useEffect(() => {
    if (!tablesKey) return

    let debounceTimer = null
    let intervalTimer = null
    let lastRefreshAt = 0

    function runRefresh() {
      lastRefreshAt = Date.now()
      refreshRef.current?.()
    }

    function scheduleRefresh() {
      const elapsed = Date.now() - lastRefreshAt
      const remaining = Math.max(0, minIntervalMs - elapsed)

      clearTimeout(intervalTimer)

      if (remaining === 0) {
        runRefresh()
        return
      }

      intervalTimer = setTimeout(runRefresh, remaining)
    }

    function triggerRefresh() {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(scheduleRefresh, debounceMs)
    }

    // Re-fetch when the user switches back to this tab
    function onVisibility() {
      if (document.visibilityState === 'visible') triggerRefresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    // One Supabase channel per page, listening to all relevant tables
    const channelName = `rt-${tablesKey}-${Math.random().toString(36).slice(2, 7)}`
    let channel = supabase.channel(channelName)

    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        triggerRefresh,
      )
    }

    channel.subscribe()

    return () => {
      clearTimeout(debounceTimer)
      clearTimeout(intervalTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, debounceMs, minIntervalMs])
}
