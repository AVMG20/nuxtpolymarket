<script setup lang="ts">
import { Application, Container, Graphics } from 'pixi.js'
import { buildPlayerShip, killFxScope, withFxScope } from '~/utils/void-engine/fx'
import { voidShip } from '#shared/utils/gamelogic/void'

const props = withDefaults(defineProps<{
    shipId: string
    /** Dims the hull and drops the drive to idle for something you can't fly yet. */
    locked?: boolean
}>(), { locked: false })

const VIEW_W = 560
const VIEW_H = 260

const host = ref<HTMLDivElement | null>(null)

let app: Application | null = null
let shipRoot: Container | null = null
let disposed = false
let elapsed = 0

/** Slow drifting specks so the hull reads as moving through something. */
function buildBackdrop(layer: Container) {
    const gfx = new Graphics()
    for (let i = 0; i < 90; i++) {
        const x = Math.random() * VIEW_W
        const y = Math.random() * VIEW_H
        const r = 0.6 + Math.random() * 1.6
        gfx.circle(x, y, r).fill({ color: 0xe0f2fe, alpha: 0.12 + Math.random() * 0.4 })
    }
    layer.addChild(gfx)

    // A faint hangar-bay grid under the ship, in perspective-ish bands.
    const grid = new Graphics()
    for (let i = 0; i < 7; i++) {
        const y = VIEW_H * 0.62 + i * i * 3.4
        grid.moveTo(0, y).lineTo(VIEW_W, y).stroke({ width: 1, color: 0x22d3ee, alpha: 0.09 - i * 0.011 })
    }
    for (let i = -6; i <= 6; i++) {
        grid.moveTo(VIEW_W / 2 + i * 26, VIEW_H * 0.62)
            .lineTo(VIEW_W / 2 + i * 110, VIEW_H)
            .stroke({ width: 1, color: 0x22d3ee, alpha: 0.07 })
    }
    layer.addChild(grid)
    return gfx
}

function mountShip() {
    if (!app || disposed) return
    if (shipRoot) {
        shipRoot.destroy({ children: true })
        shipRoot = null
    }
    // Scoped so a run reset in the live engine never kills these tweens, and
    // tearing this preview down never touches the engine's.
    killFxScope('showcase')

    const def = voidShip(props.shipId)
    const built = withFxScope('showcase', () => buildPlayerShip(def.id, def.radius, def.color, def.accent, def.trim))
    shipRoot = built.root
    // Normalise wildly different hull sizes to one comfortable on-screen size.
    const scale = 78 / def.radius
    shipRoot.scale.set(scale)
    shipRoot.position.set(VIEW_W / 2, VIEW_H / 2)
    shipRoot.alpha = props.locked ? 0.45 : 1
    if (props.locked) built.flame.alpha = 0.25
    app.stage.addChild(shipRoot)
}

onMounted(async () => {
    const element = host.value
    if (!element) return

    app = new Application()
    await app.init({
        width: VIEW_W,
        height: VIEW_H,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2)
    })
    if (disposed) {
        app.destroy(true, { children: true })
        app = null
        return
    }

    app.canvas.classList.add('block', 'touch-none')
    // autoDensity writes an inline pixel size that would beat the utility
    // classes and overflow the card.
    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    element.appendChild(app.canvas)

    const backdrop = new Container()
    app.stage.addChild(backdrop)
    const specks = buildBackdrop(backdrop)

    mountShip()

    app.ticker.add((ticker) => {
        elapsed += ticker.deltaMS
        // Specks scroll right-to-left and wrap, hull bobs and yaws gently. A
        // full rotation would read as tumbling wreckage rather than a display.
        specks.x = -((elapsed * 0.012) % VIEW_W)
        if (shipRoot) {
            shipRoot.y = VIEW_H / 2 + Math.sin(elapsed / 900) * 7
            shipRoot.rotation = Math.sin(elapsed / 1600) * 0.07
        }
    })
})

watch(() => [props.shipId, props.locked], () => mountShip())

onUnmounted(() => {
    disposed = true
    killFxScope('showcase')
    if (app) {
        app.destroy(true, { children: true })
        app = null
    }
    shipRoot = null
})
</script>

<template>
  <div ref="host" class="h-full w-full" />
</template>
