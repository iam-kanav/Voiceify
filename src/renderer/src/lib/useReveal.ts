import { useEffect, useRef } from 'react'

/**
 * On phones, results sit below the controls, out of sight. When `key` changes to something truthy
 * (e.g. a job starts), scroll the returned element into view. Does nothing on wider screens.
 */
export function useRevealOnPhone<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (key && window.matchMedia('(max-width: 767px)').matches) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [key])
  return ref
}
