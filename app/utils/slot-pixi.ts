// Shared pixi.js Application bootstrap for the slot games. Reel building,
// texture atlases and symbol rendering stay in each game — they differ too
// much per theme to generalise — but every game creates its Application with
// the same options and guards the same way against unmounting mid-init.
import type { Application } from 'pixi.js'

interface SlotPixiSize {
  width: number
  height: number
}

// `isDestroyed` is checked right after the await because pixi's async init
// can resolve after the component has already unmounted; the caller owns the
// `destroyed` flag since it's flipped from the same onBeforeUnmount that
// tears down the rest of the game's audio/DOM state.
export async function initSlotPixiApp(ApplicationCtor: typeof Application, size: SlotPixiSize, isDestroyed: () => boolean): Promise<Application | null> {
  const app = new ApplicationCtor()
  await app.init({
    width: size.width,
    height: size.height,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  })

  if (isDestroyed()) {
    app.destroy(true)
    return null
  }

  return app
}

// pixi/reel objects can already be torn down by HMR or a prior teardown pass;
// swallowing that here is what every game's onBeforeUnmount already does per call.
export function safeDestroy(fn: () => void) {
  try {
    fn()
  } catch { /* already destroyed */ }
}
