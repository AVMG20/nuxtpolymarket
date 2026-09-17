import { beforeAll, describe, expect, it } from 'vitest'
import { createPathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map'
import { pathwardenSaveIsHydratable } from '#shared/utils/gamelogic/pathwarden-map-validation'

const noop = () => {}

function stubCanvas() {
    const ctx: Record<string, unknown> = new Proxy({}, {
        get(target, property) {
            if (property === 'canvas') return canvas
            if (property === 'measureText') return () => ({ width: 10 })
            if (property === 'createLinearGradient' || property === 'createRadialGradient') {
                return () => ({ addColorStop: noop })
            }
            if (property === 'createPattern') return () => null
            if (property === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
            if (property in target) return (target as Record<string | symbol, unknown>)[property]
            return noop
        },
        set(target, property, value) {
            (target as Record<string | symbol, unknown>)[property] = value
            return true
        }
    })
    const canvas = {
        width: 0,
        height: 0,
        style: {},
        getContext: () => ctx,
        addEventListener: noop,
        removeEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
    }
    return canvas as unknown as HTMLCanvasElement
}

beforeAll(() => {
    const globals = globalThis as Record<string, unknown>
    globals.window = { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1 }
    globals.document = { addEventListener: noop, removeEventListener: noop }
    globals.Image = class {
        src = ''
        complete = true
        addEventListener = noop
        removeEventListener = noop
    }
    globals.requestAnimationFrame = () => 0
    globals.cancelAnimationFrame = noop
})

const callbacks = { onState: noop, onUpgrade: noop, onGameOver: noop } as never

describe('pathwarden march restore', () => {
    it('rebuilds a march saved on the map it was played on', async () => {
        const { PathwardenEngine } = await import('../../app/utils/pathwarden-engine')
        const mapPlan = createPathwardenMapPlan({ seed: 20_260_813, realm: 1 })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const engine: any = new PathwardenEngine(stubCanvas(), callbacks, undefined, 1, 'warden-stone', { mapPlan }, true)
        expect(engine.exportMapPlan().seed).toBe(mapPlan.seed)

        for (let claim = 0; claim < 5 && engine.pathChoices.length; claim++) {
            engine.phase = 'path'
            engine.extendPath(engine.pathChoices[0])
        }
        const gameState = engine.exportGameState()
        expect(gameState.claimedRoomIds.length).toBe(5)
        expect(pathwardenSaveIsHydratable(mapPlan, gameState)).toBe(true)
        expect(() => new PathwardenEngine(
            stubCanvas(), callbacks, undefined, 1, 'warden-stone', { mapPlan, gameState }, true
        )).not.toThrow()

        // The march the client played and the map the run row stores have to be
        // the same one: rebuilt against another plan the road no longer joins up.
        const otherPlan = createPathwardenMapPlan({ seed: 777, realm: 1 })
        expect(pathwardenSaveIsHydratable(otherPlan, gameState)).toBe(false)
        expect(() => new PathwardenEngine(
            stubCanvas(), callbacks, undefined, 1, 'warden-stone', { mapPlan: otherPlan, gameState }, true
        )).toThrow(/Disconnected road route/)
    }, 120_000)

    it('never calls a genuine march unrestorable', async () => {
        const { PathwardenEngine } = await import('../../app/utils/pathwarden-engine')
        const rejected: string[] = []
        for (let seed = 1; seed <= 6; seed++) {
            const mapPlan = createPathwardenMapPlan({ seed, realm: (seed % 5) + 1 })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const engine: any = new PathwardenEngine(
                stubCanvas(), callbacks, undefined, (seed % 5) + 1, 'warden-stone', { mapPlan }, true
            )
            let random = (seed * 2_654_435_761) >>> 0
            for (let claim = 0; claim < 25 && engine.pathChoices.length; claim++) {
                random = (random * 1_664_525 + 1_013_904_223) >>> 0
                engine.phase = 'path'
                engine.extendPath(engine.pathChoices[random % engine.pathChoices.length])
                if (pathwardenSaveIsHydratable(mapPlan, engine.exportGameState())) continue
                rejected.push(`seed ${seed} claim ${claim}`)
                break
            }
        }
        expect(rejected).toEqual([])
    }, 300_000)
})
