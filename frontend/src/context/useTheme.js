import { useState, useEffect } from 'react'

const STORAGE_KEY = 'app-theme'

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    // Light unless the user has chosen dark.
    return saved === 'dark' ? 'dark' : 'light'
  })

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return { theme, setTheme, toggleTheme }
}
