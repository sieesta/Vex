import { useCallback, useEffect, useState } from 'react'

function readStored(key, fallback, validate) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw)
    return validate && !validate(parsed) ? fallback : parsed
  } catch {
    return fallback
  }
}

/** useState with transparent localStorage persistence and corruption guards. */
export function useLocalStorageState(key, initialValue, validate) {
  const [value, setValue] = useState(() => readStored(key, initialValue, validate))

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* private mode or a full quota — the app still works in memory */
    }
  }, [key, value])

  const update = useCallback((next) => {
    setValue((previous) => (typeof next === 'function' ? next(previous) : next))
  }, [])

  return [value, update]
}
