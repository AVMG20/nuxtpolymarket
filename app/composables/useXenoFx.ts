import type { XenoBurstParticle, XenoFlash } from '~/components/xeno/BurstLayer.vue'

// Screen-space visual effects for the garden: number floats, sprite bursts
// and radial flashes. Everything here is decoration, so Math.random() is fine.
export function useXenoFx() {
  let seq = 0
  const floats = ref<Array<{ id: number; x: number; y: number; count: number; colorClass: string; plantId?: string; emoji?: string; label?: string }>>([])
  const particles = ref<XenoBurstParticle[]>([])
  const flashes = ref<XenoFlash[]>([])

  function remove<T extends { id: number }>(list: Ref<T[]>, id: number, after: number) {
    setTimeout(() => { list.value = list.value.filter(i => i.id !== id) }, after)
  }

  function float(x: number, y: number, count: number, opts: { plantId?: string; emoji?: string; colorClass?: string; label?: string } = {}) {
    const id = ++seq
    floats.value.push({ id, x, y, count, colorClass: opts.colorClass ?? 'text-primary', plantId: opts.plantId, emoji: opts.emoji, label: opts.label })
    remove(floats, id, 1500)
  }

  /** Stack one float per drop so a hybrid harvest lists every resource. */
  function floatDrops(x: number, y: number, drops: Array<{ id?: string; emoji?: string; count: number; isHybrid?: boolean }>) {
    drops.forEach((d, i) => {
      float(x, y - 10 - i * 24, d.count, {
        plantId: d.isHybrid ? undefined : d.id,
        emoji: d.emoji ?? (d.isHybrid ? '🧬' : undefined),
        colorClass: d.isHybrid ? 'text-sky-300' : 'text-primary',
        label: d.isHybrid ? 'hybrid' : undefined
      })
    })
  }

  /** Radial burst of sprites / glowing dots from a point. */
  function burst(x: number, y: number, opts: { plantId?: string; count?: number; color?: string; spread?: number; size?: number } = {}) {
    const n = opts.count ?? 10
    const spread = opts.spread ?? 70
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.6
      const dist = spread * (0.5 + Math.random() * 0.7)
      const id = ++seq
      const usePlant = opts.plantId && i % 2 === 0
      const size = usePlant ? (opts.size ?? 16) + Math.random() * 8 : 4 + Math.random() * 5
      const dur = 0.7 + Math.random() * 0.5
      particles.value.push({
        id, x, y, size,
        plantId: usePlant ? opts.plantId : undefined,
        color: opts.color,
        style: {
          '--dx': `${Math.cos(angle) * dist}px`,
          '--dy': `${Math.sin(angle) * dist - 30}px`,
          '--rot': `${(Math.random() * 2 - 1) * 360}deg`,
          '--scale': String(0.6 + Math.random() * 0.8),
          '--dur': `${dur}s`
        }
      })
      remove(particles, id, dur * 1000 + 50)
    }
  }

  function flash(x?: number, y?: number) {
    const id = ++seq
    flashes.value.push({
      id,
      style: {
        '--fx': x != null ? `${x}px` : '50%',
        '--fy': y != null ? `${y}px` : '50%'
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

  return { floats, particles, flashes, float, floatDrops, burst, flash, centerOf }
}
