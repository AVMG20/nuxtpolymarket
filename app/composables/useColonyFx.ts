// Screen-space visual effects for the colony: floating numbers, emoji/dot
// bursts and radial flashes. Shared page-wide via useState so a burst fired
// from a card lands in the single FxLayer mounted by the colony shell.
// Everything here is decoration, so Math.random() is fine.

export interface ColonyParticle {
  id: number
  x: number
  y: number
  emoji?: string
  color?: string
  size: number
  style: Record<string, string>
}

export interface ColonyFlash {
  id: number
  style: Record<string, string>
}

export interface ColonyFloat {
  id: number
  x: number
  y: number
  text: string
  colorClass: string
}

let seq = 0

export function useColonyFx() {
  const floats = useState<ColonyFloat[]>('colony-fx-floats', () => [])
  const particles = useState<ColonyParticle[]>('colony-fx-particles', () => [])
  const flashes = useState<ColonyFlash[]>('colony-fx-flashes', () => [])

  function remove<T extends { id: number }>(list: Ref<T[]>, id: number, after: number) {
    setTimeout(() => { list.value = list.value.filter(i => i.id !== id) }, after)
  }

  /** Floating text at viewport coordinates. */
  function float(x: number, y: number, text: string, colorClass = 'text-white') {
    const id = ++seq
    floats.value.push({ id, x, y, text, colorClass })
    remove(floats, id, 1500)
  }

  /** Radial burst of emoji or glowing dots from a viewport point. */
  function burst(x: number, y: number, opts: { emoji?: string | string[]; count?: number; color?: string; spread?: number; size?: number } = {}) {
    const n = opts.count ?? 12
    const spread = opts.spread ?? 80
    const emojis = Array.isArray(opts.emoji) ? opts.emoji : opts.emoji ? [opts.emoji] : []
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.7
      const dist = spread * (0.45 + Math.random() * 0.75)
      const id = ++seq
      particles.value.push({
        id,
        x,
        y,
        emoji: emojis.length ? emojis[Math.floor(Math.random() * emojis.length)] : undefined,
        color: opts.color,
        size: (opts.size ?? 16) * (0.7 + Math.random() * 0.7),
        style: {
          '--dx': `${Math.cos(angle) * dist}px`,
          '--dy': `${Math.sin(angle) * dist - 40}px`,
          '--rot': `${(Math.random() - 0.5) * 540}deg`,
          '--dur': `${0.7 + Math.random() * 0.5}s`
        }
      })
      remove(particles, id, 1300)
    }
  }

  function flash(x?: number, y?: number, color?: string) {
    const id = ++seq
    flashes.value.push({
      id,
      style: {
        '--fx': x != null ? `${x}px` : '50%',
        '--fy': y != null ? `${y}px` : '50%',
        '--fc': color ?? 'var(--ui-primary)'
      }
    })
    remove(flashes, id, 800)
  }

  /** Centre of a DOM element in viewport coordinates (null if it's gone). */
  function centerOf(el: Element | null | undefined): { x: number; y: number } | null {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  /** Burst + float from a DOM element in one call — the usual "reward" combo. */
  function celebrate(el: Element | null | undefined, opts: { emoji?: string | string[]; text?: string; count?: number; color?: string; flash?: boolean } = {}) {
    const c = centerOf(el)
    if (!c) return
    burst(c.x, c.y, { emoji: opts.emoji, count: opts.count, color: opts.color })
    if (opts.text) float(c.x, c.y - 10, opts.text)
    if (opts.flash) flash(c.x, c.y, opts.color)
  }

  return { floats, particles, flashes, float, burst, flash, centerOf, celebrate }
}
