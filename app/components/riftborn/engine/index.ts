/*
 * RIFTBORN engine entry: boots PixiJS into the container, wires input and
 * focus handling, and hands the UI its EngineHandle.
 */
import { Application, BitmapFont } from 'pixi.js'
import type { Ticker } from 'pixi.js'
import { DMG_FONT, TAG_FONT } from './fx'
import { Game } from './game'
import { Input } from './input'
import type { CreateEngine, EngineHandle } from './types'

let fontUsers = 0

function installFont(): void {
    if (fontUsers++ > 0) return
    BitmapFont.install({
        name: DMG_FONT,
        chars: [['0', '9'], '.,!+-kMB'],
        resolution: 2,
        padding: 4,
        style: {
            fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
            fontSize: 40,
            fontWeight: '900',
            fill: 0xffffff,
            stroke: { color: 0x12081c, width: 7, join: 'round' }
        }
    })
    BitmapFont.install({
        name: TAG_FONT,
        chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], ' -\'·!.+%'],
        resolution: 2,
        padding: 3,
        style: {
            fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
            fontSize: 24,
            fontWeight: '800',
            fill: 0xffffff,
            stroke: { color: 0x0a0612, width: 5, join: 'round' }
        }
    })
}

function uninstallFont(): void {
    if (--fontUsers > 0) return
    fontUsers = 0
    for (const name of [DMG_FONT, TAG_FONT]) {
        try {
            BitmapFont.uninstall(name)
        } catch {
            // already gone
        }
    }
}

export const createRiftbornEngine: CreateEngine = async (container, options) => {
    const app = new Application()
    await app.init({
        resizeTo: container,
        antialias: true,
        autoDensity: true,
        resolution: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
        background: 0x07060c,
        preference: 'webgl',
        powerPreference: 'high-performance'
    })
    const canvas = app.canvas
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    container.appendChild(canvas)

    installFont()
    const input = new Input(canvas, () => options.sfx.unlock())
    input.attach()
    const game = new Game(app, { ...options, input })
    // Dev-only handle for playtesting from the console
    if (import.meta.dev) (window as unknown as { __rbGame?: unknown, __rbApp?: unknown }).__rbGame = game
    if (import.meta.dev) (window as unknown as { __rbApp?: unknown }).__rbApp = app

    const tick = (t: Ticker) => game.frame(t.deltaMS)
    app.ticker.add(tick)

    // Losing focus pauses the run; pause() is a no-op when already paused
    const onVisibility = () => {
        if (document.hidden) game.pause()
    }
    const onBlur = () => game.pause()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)

    let destroyed = false
    const handle: EngineHandle = {
        choose: index => game.choose(index),
        reroll: () => game.reroll(),
        closeChest: () => game.closeChest(),
        castAbility: slot => game.castAbility(slot),
        pause: () => game.pause(),
        resume: () => game.resume(),
        forfeit: () => game.forfeit(),
        destroy: () => {
            if (destroyed) return
            destroyed = true
            app.ticker.remove(tick)
            document.removeEventListener('visibilitychange', onVisibility)
            window.removeEventListener('blur', onBlur)
            input.detach()
            game.destroy()
            app.destroy({ removeView: true }, { children: true })
            uninstallFont()
        }
    }
    return handle
}
