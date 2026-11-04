// Rail Tycoon — window.__railTycoon, the browser harness's read-only view of a game view's local
// state: whether it is ready, its tick, hash, company and role, and tile to screen conversions.
import type { ShallowRef } from 'vue'
import { rtCornerHeightsAt, type RtCamera } from '~/utils/rail-tycoon/camera'
import type { RtLockstep } from '~/utils/rail-tycoon/lockstep'
import type { RtDebugHook } from '~/utils/rail-tycoon/windows'

export interface RtDebugHookOptions {
  worldId: string
  lockstep: Readonly<ShallowRef<RtLockstep | null>>
  camera: RtCamera
  /** The renderer's canvas while it runs. */
  canvas(): HTMLCanvasElement | null
  /** Whether the world is open and in step. */
  ready(): boolean
}

type HookWindow = { __railTycoon?: RtDebugHook }

export function useRtDebugHook(options: RtDebugHookOptions) {
  const { lockstep, camera } = options

  const hook: RtDebugHook = {
    get ready() {
      return options.ready()
    },
    worldId: options.worldId,
    get tick() {
      return lockstep.value?.world.tick ?? null
    },
    get hash() {
      return lockstep.value?.world.hash() ?? null
    },
    get company() {
      return lockstep.value?.company ?? null
    },
    get role() {
      return lockstep.value?.role ?? null
    },
    tileToScreen(x, y) {
      const ls = lockstep.value
      const canvas = options.canvas()
      if (!ls || !canvas || x < 0 || y < 0 || x >= ls.world.map.side || y >= ls.world.map.side) return null
      const [n, w, e, s] = rtCornerHeightsAt(ls.world.map, x, y)
      const point = camera.tileToScreen(x + 0.5, y + 0.5, (n + w + e + s) / 4)
      const rect = canvas.getBoundingClientRect()
      return { x: rect.left + point.x, y: rect.top + point.y }
    },
    screenToTile(clientX, clientY) {
      const ls = lockstep.value
      const canvas = options.canvas()
      if (!ls || !canvas) return null
      const rect = canvas.getBoundingClientRect()
      return camera.screenToTile(clientX - rect.left, clientY - rect.top, ls.world.map)
    }
  }

  onMounted(() => {
    (window as unknown as HookWindow).__railTycoon = hook
  })

  onBeforeUnmount(() => {
    const w = window as unknown as HookWindow
    if (w.__railTycoon?.worldId === options.worldId) delete w.__railTycoon
  })
}
