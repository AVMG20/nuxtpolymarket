import * as THREE from 'three'
import { HACKERZ_DEPLOYABLES, hackerzDeployable, type HackerzDeployableId } from '#shared/utils/gamelogic/hackerz'
import { PICK_SLACK_PX } from '../constants'
import type { EnemyEntity } from '../types'
import { PER_WORLD, _v } from './tuning'
import type { HackerzGame } from '../hackerz-game'

/** The deployable each key arms (or sets off, for one with nothing to aim). */
const DEPLOY_KEYS: Record<string, HackerzDeployableId> = Object.fromEntries(HACKERZ_DEPLOYABLES.map(def => [def.key.toLowerCase(), def.id]))

/**
 * The player's mouse and keys on the board.
 */
export class Input {
    constructor(private readonly game: HackerzGame) {}

    private listeners: (() => void)[] = []

    private raycaster = new THREE.Raycaster()

    private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

    attachInput() {
        const view = this.game.view
        if (!view) return
        const canvas = view.renderer.domElement

        const local = (event: PointerEvent | MouseEvent) => {
            const rect = canvas.getBoundingClientRect()
            return { x: event.clientX - rect.left, y: event.clientY - rect.top }
        }

        // A second button pressed or let go while another is held does not
        // raise its own pointerdown/pointerup: it arrives as a pointermove with
        // `button` set. Firing with one hand and pinging with the other needs
        // both, so every button change goes through `press` and `lift`.
        const onPointerMove = (event: PointerEvent) => {
            const p = local(event)
            this.setAimFromScreen(p.x, p.y)
            canvas.style.cursor = !this.game.deployer.armed && this.pickEnemy(p.x, p.y) ? 'pointer' : 'crosshair'
            if (this.game.deployer.armed) this.game.deployer.showGhost(this.game.deployer.armed)
            if (event.button < 0) return
            if (event.buttons & (1 << buttonBit(event.button))) press(event)
            else lift(event)
        }
        const buttonBit = (button: number) => button === 1 ? 2 : button === 2 ? 1 : button
        const onPointerDown = (event: PointerEvent) => press(event)
        const press = (event: PointerEvent) => {
            if (event.button === 2) {
                // Right click puts an armed deployable away; otherwise it pings.
                if (this.game.deployer.armed) this.game.deployer.arm(null)
                else this.game.abilities.firePing()
                return
            }
            if (event.button !== 0) return
            const p = local(event)
            // A White Hat is aimed at a hostile, not at the ground.
            if (this.game.deployer.armed === 'whitehat') {
                this.game.deployer.useWhiteHat(this.pickEnemy(p.x, p.y))
                return
            }
            if (this.game.deployer.armed) {
                this.setAimFromScreen(p.x, p.y)
                this.game.deployer.placeArmed()
                return
            }
            const frozen = this.game.battery.pickFrozenTurret(p.x, p.y)
            if (frozen) {
                this.game.battery.thaw(frozen)
                return
            }
            this.setAimFromScreen(p.x, p.y)
            // Press fires; holding keeps firing. Pressed on a hostile, the rail
            // tracks it for as long as the button stays down — though not
            // through a packet-loss spike, which drops every lock.
            this.game.rail.lockSpot = null
            this.game.rail.target = this.game.lag.boardLagMs > 0 ? null : this.pickEnemy(p.x, p.y)
            this.game.rail.holding = true
            this.game.rail.queuedShot = true
        }
        const release = () => {
            this.game.rail.holding = false
            this.game.rail.target = null
            this.game.rail.lockSpot = null
        }
        // Only letting go of the fire button stops the fire: a ping released
        // mid-burst leaves it running.
        const lift = (event: PointerEvent) => {
            if (event.button === 0) release()
        }
        const onPointerUp = (event: PointerEvent) => lift(event)
        const onBlur = release
        const onContextMenu = (event: MouseEvent) => event.preventDefault()

        const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase()
            if (key === 'r') this.game.rail.beginReload()
            if (key === 'escape') {
                this.game.rail.target = null
                this.game.deployer.arm(null)
            }
            const deploy = DEPLOY_KEYS[key]
            // One with nothing to aim (a Portscan, a Cosmic Blip) goes off at once.
            if (deploy && hackerzDeployable(deploy).instant) this.game.deployer.useInstant(deploy)
            else if (deploy) this.game.deployer.arm(this.game.deployer.armed === deploy ? null : deploy)
            if (key === ' ') {
                // Space scrolls the page by default, which is fatal for a key
                // the player mashes under pressure.
                if (this.game.running) event.preventDefault()
                this.game.abilities.firePulse()
            }
            if (key === 'q') this.game.abilities.fireOverclock()
        }

        canvas.addEventListener('pointermove', onPointerMove)
        canvas.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('blur', onBlur)
        window.addEventListener('keydown', onKeyDown)
        canvas.addEventListener('contextmenu', onContextMenu)

        this.listeners = [
            () => canvas.removeEventListener('pointermove', onPointerMove),
            () => canvas.removeEventListener('pointerdown', onPointerDown),
            () => window.removeEventListener('pointerup', onPointerUp),
            () => window.removeEventListener('blur', onBlur),
            () => window.removeEventListener('keydown', onKeyDown),
            () => canvas.removeEventListener('contextmenu', onContextMenu)
        ]
    }

    detachInput() {
        for (const off of this.listeners) off()
        this.listeners = []
    }

    /** Casts the cursor onto the ground plane and stores it as a field point. */
    private setAimFromScreen(x: number, y: number) {
        const view = this.game.view
        if (!view) return
        const ndc = new THREE.Vector2(x / view.width * 2 - 1, -(y / view.height) * 2 + 1)
        this.raycaster.setFromCamera(ndc, view.camera)
        const hit = this.raycaster.ray.intersectPlane(this.groundPlane, _v)
        if (!hit) return
        this.game.rail.aimU = hit.x * PER_WORLD
        this.game.rail.aimD = Math.max(20, -hit.z * PER_WORLD)
    }

    /**
     * The hostile under the cursor. Each unit's whole model bounding box is
     * projected to the screen and the cursor tested against that rectangle,
     * so a light cycle can be grabbed by its tail as well as its middle. Tiny
     * far-off units get a minimum target size: missing the click is not skill.
     * Where rectangles overlap, the unit nearest the fence wins.
     */
    private pickEnemy(x: number, y: number) {
        const view = this.game.view
        if (!view) return null
        let best: EnemyEntity | null = null
        const screen = { x: 0, y: 0 }
        for (const enemy of this.game.enemies) {
            // Nothing in the dark can be picked out to lock on: fire blind instead.
            if (this.game.combat.untargetable(enemy)) continue
            const root = enemy.rig.root
            root.updateMatrixWorld()
            const box = enemy.rig.box
            let minX = Infinity
            let minY = Infinity
            let maxX = -Infinity
            let maxY = -Infinity
            let visible = false
            for (let c = 0; c < 8; c++) {
                _v.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z)
                    .applyMatrix4(root.matrixWorld)
                if (!view.project(_v, screen)) continue
                visible = true
                minX = Math.min(minX, screen.x)
                maxX = Math.max(maxX, screen.x)
                minY = Math.min(minY, screen.y)
                maxY = Math.max(maxY, screen.y)
            }
            if (!visible) continue
            const pad = 6
            const cx = (minX + maxX) / 2
            const cy = (minY + maxY) / 2
            const halfW = Math.max(PICK_SLACK_PX, (maxX - minX) / 2 + pad)
            const halfH = Math.max(PICK_SLACK_PX, (maxY - minY) / 2 + pad)
            if (Math.abs(x - cx) > halfW || Math.abs(y - cy) > halfH) continue
            if (!best || enemy.d < best.d) best = enemy
        }
        return best
    }
}
