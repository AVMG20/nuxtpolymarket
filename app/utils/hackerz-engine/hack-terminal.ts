import * as THREE from 'three'
import { hdr } from './models'

/**
 * The little holo-terminals hostiles pop open while they hack a node: a panel
 * of scrolling attack code floating beside the unit, facing the camera. Every
 * terminal shows the same scrolling feed — one canvas, redrawn a few times a
 * second — so a crowd of hackers costs one texture upload, not one each.
 *
 * Purely cosmetic, so the feed rolls on `Math.random`.
 */

const W = 256
const H = 168
const LINE_H = 15
const ROWS = Math.floor((H - 24) / LINE_H)
/** How often the feed scrolls a line, in seconds. */
const SCROLL_EVERY = 0.09

const VERBS = ['inject', 'bypass', 'spoof', 'overflow', 'brute', 'escalate', 'tunnel', 'patch', 'dump', 'fork']
const TARGETS = ['gate', 'auth', 'kernel', 'node', 'socket', 'heap', 'ring0', 'sudo', 'acl', 'cache']

function hex(n: number) {
    return Math.floor(Math.random() * 16 ** n).toString(16).toUpperCase().padStart(n, '0')
}

function pick<T>(list: readonly T[]) {
    return list[Math.floor(Math.random() * list.length)]!
}

function codeLine() {
    switch (Math.floor(Math.random() * 7)) {
        case 0: return `> ${pick(VERBS)} ${pick(TARGETS)}_${hex(2)}`
        case 1: return `mov eax, [0x${hex(4)}]`
        case 2: return `xor 0x${hex(2)} 0x${hex(2)} 0x${hex(2)}`
        case 3: return `jmp 0x${hex(6)}`
        case 4: return `${'█'.repeat(1 + Math.floor(Math.random() * 7))}${'▒'.repeat(Math.floor(Math.random() * 5))} ${Math.floor(Math.random() * 100)}%`
        case 5: return `push 0x${hex(8)}`
        default: return `ssh root@node-${hex(2)} ...ok`
    }
}

export class HackTerminals {
    readonly group = new THREE.Group()
    private canvas = document.createElement('canvas')
    private ctx: CanvasRenderingContext2D
    private texture: THREE.CanvasTexture
    private panel = new THREE.PlaneGeometry(3.4, 2.2)
    private frameGeometry = new THREE.EdgesGeometry(this.panel)
    private screen: THREE.MeshBasicMaterial
    private frame: THREE.LineBasicMaterial
    private lines: string[] = Array.from({ length: ROWS }, codeLine)
    private scroll = 0
    private live = new Map<object, { group: THREE.Group, age: number }>()

    constructor() {
        this.canvas.width = W
        this.canvas.height = H
        this.ctx = this.canvas.getContext('2d')!
        this.texture = new THREE.CanvasTexture(this.canvas)
        this.texture.colorSpace = THREE.SRGBColorSpace
        this.screen = new THREE.MeshBasicMaterial({
            map: this.texture,
            color: hdr(0xffffff, 1.4),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            toneMapped: false
        })
        this.frame = new THREE.LineBasicMaterial({ color: hdr(0xff2a2a, 1.8), toneMapped: false })
        this.draw()
    }

    /** The terminal for `owner`, opened if it is not up yet. */
    open(owner: object) {
        let entry = this.live.get(owner)
        if (!entry) {
            const group = new THREE.Group()
            group.add(new THREE.Mesh(this.panel, this.screen))
            group.add(new THREE.LineSegments(this.frameGeometry, this.frame))
            group.scale.set(1, 0.01, 1)
            this.group.add(group)
            entry = { group, age: 0 }
            this.live.set(owner, entry)
        }
        return entry.group
    }

    close(owner: object) {
        const entry = this.live.get(owner)
        if (!entry) return
        entry.group.removeFromParent()
        this.live.delete(owner)
    }

    clear() {
        for (const entry of this.live.values()) entry.group.removeFromParent()
        this.live.clear()
    }

    /** Scrolls the shared feed, opens new panels and turns every panel to the camera. */
    update(dt: number, camera: THREE.Camera) {
        if (!this.live.size) return
        this.scroll += dt
        if (this.scroll >= SCROLL_EVERY) {
            this.scroll = 0
            this.lines.shift()
            this.lines.push(codeLine())
            this.draw()
        }
        for (const entry of this.live.values()) {
            entry.age += dt
            // Panels flick open over a fifth of a second, then hold.
            const open = Math.min(1, entry.age / 0.2)
            entry.group.scale.set(1, open * open, 1)
            entry.group.quaternion.copy(camera.quaternion)
        }
    }

    private draw() {
        const ctx = this.ctx
        ctx.clearRect(0, 0, W, H)
        ctx.fillStyle = 'rgba(0, 12, 6, 0.85)'
        ctx.fillRect(0, 0, W, H)
        // Title bar: who is knocking.
        ctx.fillStyle = 'rgba(255, 42, 42, 0.9)'
        ctx.fillRect(0, 0, W, 18)
        ctx.fillStyle = '#000'
        ctx.font = 'bold 12px ui-monospace, Menlo, monospace'
        ctx.fillText('HACK://NODE  ▶ breaching', 6, 13)
        ctx.font = '12px ui-monospace, Menlo, monospace'
        this.lines.forEach((text, i) => {
            const newest = i === this.lines.length - 1
            ctx.fillStyle = newest ? '#d9ffe6' : `rgba(74, 222, 128, ${0.45 + 0.55 * (i / this.lines.length)})`
            ctx.fillText(text, 6, 32 + i * LINE_H)
        })
        // A steady caret on the newest line — steady, because a blink is a strobe.
        ctx.fillStyle = '#d9ffe6'
        ctx.fillRect(6 + ctx.measureText(this.lines[this.lines.length - 1]!).width + 3, 32 + (this.lines.length - 1) * LINE_H - 10, 7, 12)
        this.texture.needsUpdate = true
    }
}
