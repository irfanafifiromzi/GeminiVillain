import { reactive } from 'vue'

export type ThemeName = 'dark' | 'light'

const KEY = 'gv.theme'

const state = reactive({ name: 'dark' as ThemeName })

const apply = (name: ThemeName) => {
  state.name = name
  document.documentElement.dataset.theme = name
  try {
    localStorage.setItem(KEY, name)
  } catch {
    /* a locked-down profile is not worth failing over */
  }
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export const useTheme = () => {
  const load = () => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(KEY)
    } catch {
      /* ignore */
    }
    apply(stored === 'light' ? 'light' : 'dark')
  }

  /**
   * Swap the theme behind a ripple spreading from wherever you clicked.
   *
   * The View Transitions API animates the real UI rather than a coloured
   * overlay, so the ripple reveals the new theme over the old one instead of
   * wiping through a blank screen. Without it, or with reduced motion, the
   * theme just changes.
   */
  const toggle = async (origin?: { x: number; y: number }) => {
    const next: ThemeName = state.name === 'dark' ? 'light' : 'dark'
    const start = document.startViewTransition?.bind(document)

    if (!start || prefersReducedMotion()) {
      apply(next)
      return
    }

    const transition = start(() => apply(next))
    try {
      await transition.ready
    } catch {
      return // a transition already in flight; the theme still changed
    }

    const x = origin?.x ?? window.innerWidth - 40
    const y = origin?.y ?? 20
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )

    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
      },
      {
        duration: 620,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    )
  }

  return { state, load, toggle }
}
