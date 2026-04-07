import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Subscribes to Supabase Realtime postgres_changes on the given tables.
 * Calls onRefresh (debounced) on any INSERT / UPDATE / DELETE.
 * Also re-fetches when the browser tab becomes visible again.
 *
 * @param {string[]} tables     - table names to watch (must be stable reference or array literal)
 * @param {() => void} onRefresh - the page's load / reload function
 * @param {number} [debounceMs=700] - debounce window to batch rapid changes
 */
export function useRealtimeRefresh(tables, onRefresh, debounceMs = 700) {
  // Keep a stable ref so the subscription closure always calls the latest callback
  const refreshRef = useRef(onRefresh)
  useEffect(() => { refreshRef.current = onRefresh }, [onRefresh])

  // Stable key for the channel so we only re-subscribe when the table list changes
  const tablesKey = Array.isArray(tables) ? tables.slice().sort().join(',') : ''

  useEffect(() => {
    if (!tablesKey) return

    let timer = null

    function triggerRefresh() {
      clearTimeout(timer)
      timer = setTimeout(() => refreshRef.current?.(), debounceMs)
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
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, debounceMs])
}
