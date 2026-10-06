import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const systemTheme = (): Theme => (window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light')

const themes: { value: Theme; label: string; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'Light interface',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark interface',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z" />
      </svg>
    ),
  },
]

/**
 * Light or dark interface, at the right end of the status bar. Every visit starts with the system
 * setting (and follows it when it changes); a choice here lasts for this visit and is not remembered.
 * The canvas keeps the colours from the Color settings in both themes.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(systemTheme)

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY)
    if (!query) return
    const follow = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])

  // Before paint, so switching never flashes the other theme.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="theme-toggle segmented" role="group" aria-label="Interface theme">
      {themes.map(({ value, label, icon }) => (
        <button key={value} type="button" aria-pressed={theme === value} aria-label={label} title={label} onClick={() => setTheme(value)}>
          {icon}
        </button>
      ))}
    </div>
  )
}
