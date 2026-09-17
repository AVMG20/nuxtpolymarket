// Void Runner — the in-world 2D overlay: crosshair, target brackets, lead
// markers, waypoints, off-screen threat arrows, damage numbers and radar.
// Drawn straight onto a canvas every frame so it tracks the 3D scene exactly.

import * as THREE from 'three'
import { voidResource } from '#shared/utils/gamelogic/void'
import type { VoidEngine } from './engine'

const _v = new THREE.Vector3()
const _l = new THREE.Vector3()
const FORWARD = new THREE.Vector3(0, 0, -1)
const FONT = '600 11px "Rajdhani", "Inter", system-ui, sans-serif'
const MONO = '600 11px "JetBrains Mono", ui-monospace, monospace'

interface Screen {
    x: number
    y: number
    visible: boolean
    depth: number
}

function project(engine: VoidEngine, pos: THREE.Vector3): Screen {
    _v.copy(pos).project(engine.camera)
    const visible = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) <= 1.05 && Math.abs(_v.y) <= 1.05
    return { x: (_v.x + 1) / 2 * engine.width, y: (1 - _v.y) / 2 * engine.height, visible, depth: _v.z }
}

/** Edge-clamped screen position for something that may be behind the camera. */
function edge(engine: VoidEngine, pos: THREE.Vector3, margin: number) {
    _l.copy(pos).applyMatrix4(engine.camera.matrixWorldInverse)
    const cx = engine.width / 2
    const cy = engine.height / 2
    let angle = Math.atan2(-_l.y, _l.x)
    if (_l.z > 0 && Math.abs(_l.x) < 1e-3 && Math.abs(_l.y) < 1e-3) angle = Math.PI / 2
    const rx = cx - margin
    const ry = cy - margin
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const k = Math.min(rx / Math.max(1e-4, Math.abs(c)), ry / Math.max(1e-4, Math.abs(s)))
    return { x: cx + c * k, y: cy + s * k, angle }
}

function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width = 1.5) {
    const k = Math.max(4, r * 0.4)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ctx.moveTo(x + sx * r, y + sy * (r - k))
        ctx.lineTo(x + sx * r, y + sy * r)
        ctx.lineTo(x + sx * (r - k), y + sy * r)
    }
    ctx.stroke()
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color: string) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 4)
    ctx.fillStyle = color
    ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 2)
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'center', font = FONT) {
    ctx.font = font
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillText(text, x + 1, y + 1)
    ctx.fillStyle = color
    ctx.fillText(text, x, y)
}

function distText(d: number) {
    return d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`
}

export function drawOverlay(ctx: CanvasRenderingContext2D, engine: VoidEngine) {
    const p = engine.player!
    const cam = engine.camera
    const w = engine.width
    const h = engine.height
    const focal = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2))
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // ── Waypoints: station, beacons, lair
    for (const s of engine.structures) {
        const d = s.pos.distanceTo(p.pos)
        const color = s.kind === 'station' ? '#5ec8ff' : '#3dffb0'
        const name = s.kind === 'station' ? 'STATION' : 'BEACON'
        waypoint(ctx, engine, s.pos, color, name, d, s.kind === 'station' ? 'diamond' : 'ring')
    }
    const marker = engine.objectives?.marker
    if (marker) waypoint(ctx, engine, marker.pos, '#ffd27a', marker.label, marker.pos.distanceTo(p.pos), 'diamond')
    for (const well of engine.hazards?.wells ?? []) {
        const d = well.pos.distanceTo(p.pos)
        if (d < 700) waypoint(ctx, engine, well.pos, '#ff7ab0', d < well.radius ? 'GRAVITY PULL' : 'GRAVITY WELL', d, 'ring')
    }
    const eventMarker = engine.sectorEvents?.marker
    if (eventMarker && eventMarker.pos.distanceTo(p.pos) > 250) waypoint(ctx, engine, eventMarker.pos, '#ffc44d', eventMarker.label, eventMarker.pos.distanceTo(p.pos), 'diamond')
    if (!engine.wardenKilled && !engine.warden && !engine.objectives?.suppressWaves) {
        waypoint(ctx, engine, engine.lair, '#ff4f6d', 'WARDEN', engine.lair.distanceTo(p.pos), 'skull')
    }
    if (engine.gate) waypoint(ctx, engine, engine.gate.pos, '#c07bff', engine.fuel > 0 ? 'JUMP GATE' : 'JUMP GATE · NO FUEL', engine.gate.pos.distanceTo(p.pos), 'ring')
    if (engine.trader?.alive && engine.trader.pos.distanceTo(p.pos) < 900) waypoint(ctx, engine, engine.trader.pos, '#9fffd9', 'TRADER', engine.trader.pos.distanceTo(p.pos), 'diamond')
    for (const m of engine.systems?.markers() ?? []) waypoint(ctx, engine, m.pos, m.color, m.label, m.pos.distanceTo(p.pos), 'diamond')

    // ── Enemies
    for (const e of engine.enemies) {
        if (!e.alive || !e.group.visible) continue
        const d = e.pos.distanceTo(cam.position)
        const focus = engine.focus === e
        if (d > (e.elite ? 1400 : 750) && !focus) continue
        const s = project(engine, e.pos)
        const color = e.data.coalition ? '#5ec8ff' : e.kind === 'trader' ? '#9fffd9' : e.kind === 'crate' ? '#ffb45e' : e.kind === 'mine' ? '#ffd23f' : e.elite ? '#ff9a3d' : '#ff4a55'
        if (!s.visible) {
            if (e.aggro && e.hostile && d < 450 && e.kind !== 'mine') {
                const at = edge(engine, e.pos, 46)
                ctx.save()
                ctx.translate(at.x, at.y)
                ctx.rotate(at.angle)
                ctx.fillStyle = color
                ctx.globalAlpha = 0.55 + 0.45 * (1 - d / 450)
                ctx.beginPath()
                ctx.moveTo(10, 0)
                ctx.lineTo(-4, -7)
                ctx.lineTo(-1, 0)
                ctx.lineTo(-4, 7)
                ctx.closePath()
                ctx.fill()
                ctx.restore()
            }
            continue
        }
        const r = Math.max(e.kind === 'warden' ? 30 : 9, (e.radius * focal) / Math.max(1, d) * 1.25)
        // The carrier is too big for brackets, and its fittings only show up close so it stays a surprise.
        if (e.kind === 'mothership' && !focus) continue
        if ((e.kind === 'battery' || e.kind === 'reactor') && !focus && d > 450) continue
        const alpha = focus ? 1 : Math.max(0.35, 1 - d / 900)
        ctx.globalAlpha = alpha
        if (e.kind === 'warden') continue
        brackets(ctx, s.x, s.y, r, color, focus ? 2 : 1.2)
        if (e.hp < e.maxHp || focus) bar(ctx, s.x, s.y + r + 6, Math.max(26, r * 1.6), e.hp / e.maxHp, color)
        if ((e.data.shieldMax ?? 0) > 0 && (e.data.shield! < e.data.shieldMax! || focus)) bar(ctx, s.x, s.y + r + 11, Math.max(26, r * 1.6), e.data.shield! / e.data.shieldMax!, '#6fd8ff')
        if (focus) {
            label(ctx, `${e.name.toUpperCase()}  ${distText(d)}`, s.x, s.y - r - 10, color)
            if (e.hostile && e.vel.lengthSq() > 1) {
                const lead = project(engine, engine.leadPoint(e, _v))
                if (lead.visible) {
                    ctx.strokeStyle = color
                    ctx.lineWidth = 1.5
                    ctx.beginPath()
                    ctx.moveTo(lead.x, lead.y - 5)
                    ctx.lineTo(lead.x + 5, lead.y)
                    ctx.lineTo(lead.x, lead.y + 5)
                    ctx.lineTo(lead.x - 5, lead.y)
                    ctx.closePath()
                    ctx.stroke()
                }
            }
        }
        ctx.globalAlpha = 1
    }
    ctx.globalAlpha = 1

    // ── Rock focus
    if (engine.focusRock?.alive && engine.focusRock.ore) {
        const rock = engine.focusRock
        const s = project(engine, rock.pos)
        if (s.visible) {
            const d = rock.pos.distanceTo(cam.position)
            const r = Math.max(12, (rock.radius * focal) / Math.max(1, d))
            const res = voidResource(rock.ore!)
            const color = `#${res.color.toString(16).padStart(6, '0')}`
            brackets(ctx, s.x, s.y, r, color, 1.5)
            bar(ctx, s.x, s.y + r + 6, Math.max(30, r * 1.4), rock.hp / rock.maxHp, color)
            label(ctx, `${res.name.toUpperCase()}  ${distText(d)}`, s.x, s.y - r - 10, color)
        }
    }

    // ── Loot popups stacked above the ship
    if (p.alive && engine.lootPopups.length) {
        const s = project(engine, _v.copy(p.pos).addScaledVector(_l.set(0, 1, 0).applyQuaternion(engine.camera.quaternion), p.radius * 1.6 + 2))
        if (s.visible) {
            engine.lootPopups.forEach((l, i) => {
                const res = voidResource(l.resource)
                const color = `#${res.color.toString(16).padStart(6, '0')}`
                const alpha = Math.min(1, l.life * 2)
                const scale = 1 + l.pop * 0.35
                const y = s.y + 10 - (engine.lootPopups.length - 1 - i) * 18
                ctx.globalAlpha = alpha
                label(ctx, `+${l.amount} ${res.name}`, s.x + 90, y, color, 'left', `700 ${Math.round(15 * scale)}px "Rajdhani", system-ui, sans-serif`)
            })
            ctx.globalAlpha = 1
        }
    }

    // ── Floating numbers
    for (const f of engine.floats) {
        const s = project(engine, f.pos)
        if (!s.visible) continue
        const t = f.life / f.maxLife
        ctx.globalAlpha = Math.min(1, t * 2)
        label(ctx, f.text, s.x, s.y - (1 - t) * 18, f.color, 'center', `700 ${Math.round(f.size * (1 + (1 - t) * 0.1))}px "Rajdhani", system-ui, sans-serif`)
    }
    ctx.globalAlpha = 1

    // ── Crosshair and nose marker
    if (p.alive && engine.phase === 'flying') {
        const aim = project(engine, _v.copy(cam.position).addScaledVector(_l.copy(FORWARD).applyQuaternion(engine.aimQuat), 400))
        const nose = project(engine, _v.copy(p.pos).addScaledVector(_l.copy(FORWARD).applyQuaternion(p.quat), 400))
        const hot = engine.focus?.hostile
        const cColor = hot ? '#ff5a66' : engine.focus || engine.focusRock ? '#ffd27a' : 'rgba(220,240,255,0.9)'
        if (aim.visible) {
            ctx.strokeStyle = cColor
            ctx.lineWidth = 1.5
            const gap = 7
            const len = 7
            ctx.beginPath()
            ctx.moveTo(aim.x - gap - len, aim.y)
            ctx.lineTo(aim.x - gap, aim.y)
            ctx.moveTo(aim.x + gap, aim.y)
            ctx.lineTo(aim.x + gap + len, aim.y)
            ctx.moveTo(aim.x, aim.y - gap - len)
            ctx.lineTo(aim.x, aim.y - gap)
            ctx.moveTo(aim.x, aim.y + gap)
            ctx.lineTo(aim.x, aim.y + gap + len)
            ctx.stroke()
            ctx.fillStyle = cColor
            ctx.fillRect(aim.x - 1, aim.y - 1, 2, 2)
            // Energy and ability arcs hug the crosshair.
            ctx.lineWidth = 2
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'
            ctx.beginPath()
            ctx.arc(aim.x, aim.y, 26, Math.PI * 0.62, Math.PI * 1.38)
            ctx.stroke()
            ctx.strokeStyle = p.boostLock ? '#ff6b6b' : '#6fd8ff'
            ctx.beginPath()
            ctx.arc(aim.x, aim.y, 26, Math.PI * 1.38 - Math.PI * 0.76 * p.energy, Math.PI * 1.38)
            ctx.stroke()
            const skill = engine.skills
            const ability = skill?.cooldown ?? 0
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'
            ctx.beginPath()
            ctx.arc(aim.x, aim.y, 26, -Math.PI * 0.38, Math.PI * 0.38)
            ctx.stroke()
            const skillColor = skill ? `#${skill.color.toString(16).padStart(6, '0')}` : '#ffd27a'
            ctx.strokeStyle = skill?.active ? '#ffffff' : ability <= 0 ? skillColor : 'rgba(255,210,122,0.45)'
            const readyFrac = skill?.active ? skill.hud().activeFrac : ability <= 0 ? 1 : Math.max(0, 1 - ability / Math.max(0.01, skill?.cooldownMax ?? 1))
            ctx.beginPath()
            ctx.arc(aim.x, aim.y, 26, Math.PI * 0.38 - Math.PI * 0.76 * readyFrac, Math.PI * 0.38)
            ctx.stroke()
        }
        if (aim.visible && (engine.hitMarker > 0 || engine.killMarker > 0)) {
            const kill = engine.killMarker > 0
            const k = kill ? engine.killMarker / 0.35 : engine.hitMarker / 0.18
            const inner = kill ? 9 + (1 - k) * 6 : 6
            const outer = inner + (kill ? 9 : 6)
            ctx.strokeStyle = kill ? `rgba(255,80,90,${k})` : `rgba(255,255,255,${Math.min(1, k * 1.5)})`
            ctx.lineWidth = kill ? 2.5 : 1.8
            ctx.beginPath()
            for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
                ctx.moveTo(aim.x + sx * inner, aim.y + sy * inner)
                ctx.lineTo(aim.x + sx * outer, aim.y + sy * outer)
            }
            ctx.stroke()
        }
        if (nose.visible && Math.hypot(nose.x - aim.x, nose.y - aim.y) > 6) {
            ctx.strokeStyle = 'rgba(160,220,255,0.55)'
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(nose.x, nose.y, 4, 0, Math.PI * 2)
            ctx.stroke()
        }
    }

    drawStrikeMarkers(ctx, engine)
    drawLock(ctx, engine)
    drawCracks(ctx, engine, w, h)
    drawDamageDirections(ctx, engine, w, h)
    drawRadar(ctx, engine, w, h)
    if (engine.mapOpen) drawSectorMap(ctx, engine, w, h)
    ctx.restore()
}


function waypoint(ctx: CanvasRenderingContext2D, engine: VoidEngine, pos: THREE.Vector3, color: string, name: string, dist: number, shape: 'diamond' | 'ring' | 'skull') {
    const s = project(engine, pos)
    let x = s.x
    let y = s.y
    let offscreen = false
    if (!s.visible) {
        const at = edge(engine, pos, 70)
        x = at.x
        y = at.y
        offscreen = true
    }
    ctx.globalAlpha = offscreen ? 0.75 : 0.9
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.6
    ctx.beginPath()
    if (shape === 'diamond') {
        ctx.moveTo(x, y - 7)
        ctx.lineTo(x + 7, y)
        ctx.lineTo(x, y + 7)
        ctx.lineTo(x - 7, y)
        ctx.closePath()
        ctx.stroke()
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
    } else if (shape === 'ring') {
        ctx.arc(x, y, 6, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, y, 2, 0, Math.PI * 2)
        ctx.fill()
    } else {
        ctx.moveTo(x, y - 8)
        ctx.lineTo(x + 8, y + 6)
        ctx.lineTo(x - 8, y + 6)
        ctx.closePath()
        ctx.stroke()
        ctx.fillRect(x - 1, y - 2, 2, 5)
    }
    label(ctx, name, x, y + 16, color, 'center', '700 10px "Rajdhani", system-ui, sans-serif')
    label(ctx, distText(dist), x, y + 28, 'rgba(230,240,255,0.75)', 'center', MONO)
    ctx.globalAlpha = 1
}

function drawRadar(ctx: CanvasRenderingContext2D, engine: VoidEngine, w: number, h: number) {
    const p = engine.player!
    // Top right, clear of the flight readouts and the objectives.
    const R = Math.min(78, h * 0.095)
    const cx = w - 28 - R * 1.25
    const cy = 30 + R
    const range = 700
    ctx.save()
    ctx.globalAlpha = 0.9
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
    grad.addColorStop(0, 'rgba(20,40,70,0.35)')
    grad.addColorStop(1, 'rgba(5,10,25,0.55)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(cx, cy, R * 1.25, R, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,190,255,0.25)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(cx, cy, R * 0.62, R * 0.5, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - R * 1.25, cy)
    ctx.lineTo(cx + R * 1.25, cy)
    ctx.moveTo(cx, cy - R)
    ctx.lineTo(cx, cy + R)
    ctx.stroke()
    // Sweep
    const sweep = (engine.time * 1.4) % (Math.PI * 2)
    ctx.strokeStyle = 'rgba(120,200,255,0.18)'
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(sweep) * R * 1.25, cy + Math.sin(sweep) * R)
    ctx.stroke()

    const inv = new THREE.Quaternion().copy(p.quat).invert()
    const plot = (pos: THREE.Vector3, color: string, size: number, clampEdge = false) => {
        const rel = _v.subVectors(pos, p.pos).applyQuaternion(inv)
        let x = rel.x / range
        let z = rel.z / range
        const len = Math.hypot(x, z)
        if (len > 1) {
            if (!clampEdge) return
            x /= len
            z /= len
        }
        const px = cx + x * R * 1.25
        const py = cy + z * R
        const stem = THREE.MathUtils.clamp(-rel.y / range, -1, 1) * R * 0.5
        if (Math.abs(stem) > 1.5) {
            ctx.strokeStyle = color
            ctx.globalAlpha = 0.5
            ctx.beginPath()
            ctx.moveTo(px, py)
            ctx.lineTo(px, py + stem)
            ctx.stroke()
            ctx.globalAlpha = 0.95
        }
        ctx.fillStyle = color
        ctx.fillRect(px - size / 2, py + stem - size / 2, size, size)
    }
    for (const s of engine.structures) plot(s.pos, s.kind === 'station' ? '#5ec8ff' : '#3dffb0', 5, true)
    if (!engine.wardenKilled) plot(engine.warden?.pos ?? engine.lair, '#ff4f6d', 6, true)
    for (const w of engine.hazards?.wells ?? []) plot(w.pos, '#ff7ab0', 7, false)
    for (const e of engine.enemies) {
        // Capital ships never show up on scopes: you find them by looking.
        if (!e.alive || e.kind === 'mine' || !e.group.visible || e.data.carrier) continue
        plot(e.pos, e.kind === 'crate' ? '#ffb45e' : e.aggro ? '#ff4a55' : '#b04850', e.elite ? 4 : 3)
    }
    // Player chevron
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(cx, cy - 5)
    ctx.lineTo(cx + 4, cy + 4)
    ctx.lineTo(cx, cy + 2)
    ctx.lineTo(cx - 4, cy + 4)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
}

/** Full-screen top-down sector chart while Tab or M is held. */
function drawSectorMap(ctx: CanvasRenderingContext2D, engine: VoidEngine, w: number, h: number) {
    const p = engine.player!
    const size = Math.min(w, h) * 0.8
    const cx = w / 2
    const cy = h / 2
    const scale = size / 2 / 2700
    const to = (pos: THREE.Vector3) => ({ x: cx + pos.x * scale, y: cy + pos.z * scale })
    ctx.save()
    ctx.fillStyle = 'rgba(2, 6, 14, 0.72)'
    ctx.fillRect(0, 0, w, h)
    // Grid rings
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.12)'
    ctx.lineWidth = 1
    for (const r of [650, 1300, 1950, 2600]) {
        ctx.beginPath()
        ctx.arc(cx, cy, r * scale, 0, Math.PI * 2)
        ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255, 194, 77, 0.35)'
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.arc(cx, cy, 2600 * scale, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    // Ore
    for (const rock of engine.asteroids?.rocks ?? []) {
        const at = to(rock.pos)
        if (rock.ore) {
            const res = voidResource(rock.ore)
            ctx.fillStyle = `#${res.color.toString(16).padStart(6, '0')}`
            ctx.globalAlpha = 0.8
            ctx.fillRect(at.x - 1.5, at.y - 1.5, 3, 3)
        } else {
            ctx.fillStyle = '#6a6462'
            ctx.globalAlpha = 0.35
            const r = Math.max(1, rock.radius * scale * 2)
            ctx.fillRect(at.x - r / 2, at.y - r / 2, r, r)
        }
    }
    ctx.globalAlpha = 1
    // Hostiles
    for (const e of engine.enemies) {
        if (!e.alive || e.kind === 'mine' || !e.group.visible || e.data.carrier) continue
        const at = to(e.pos)
        ctx.fillStyle = e.kind === 'crate' ? '#ffb45e' : e.elite ? '#ff9a3d' : e.aggro ? '#ff4a55' : 'rgba(255, 74, 85, 0.45)'
        const r = e.elite ? 3.5 : 2.2
        ctx.beginPath()
        ctx.arc(at.x, at.y, r, 0, Math.PI * 2)
        ctx.fill()
    }
    // Structures and the lair
    for (const s of engine.structures) {
        const at = to(s.pos)
        const color = s.kind === 'station' ? '#5ec8ff' : '#3dffb0'
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(at.x, at.y, s.kind === 'station' ? 9 : 6, 0, Math.PI * 2)
        ctx.stroke()
        label(ctx, s.kind === 'station' ? 'STATION' : 'BEACON', at.x, at.y + 18, color, 'center', '700 11px "Rajdhani", system-ui, sans-serif')
    }
    if (!engine.wardenKilled) {
        const at = to(engine.warden?.pos ?? engine.lair)
        ctx.strokeStyle = '#ff4f6d'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(at.x, at.y - 10)
        ctx.lineTo(at.x + 10, at.y + 7)
        ctx.lineTo(at.x - 10, at.y + 7)
        ctx.closePath()
        ctx.stroke()
        label(ctx, engine.config!.sector.warden.toUpperCase(), at.x, at.y + 22, '#ff4f6d', 'center', '700 11px "Rajdhani", system-ui, sans-serif')
    }
    const marker = engine.objectives?.marker
    if (marker) {
        const at = to(marker.pos)
        ctx.strokeStyle = '#ffd27a'
        ctx.lineWidth = 2
        ctx.strokeRect(at.x - 6, at.y - 6, 12, 12)
    }
    // Player
    const at = to(p.pos)
    const fwd = _v.set(0, 0, -1).applyQuaternion(p.quat)
    const angle = Math.atan2(fwd.z, fwd.x)
    ctx.save()
    ctx.translate(at.x, at.y)
    ctx.rotate(angle + Math.PI / 2)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(0, -9)
    ctx.lineTo(6, 7)
    ctx.lineTo(0, 3)
    ctx.lineTo(-6, 7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    label(ctx, 'SECTOR MAP', cx, cy - size / 2 - 18, 'rgba(230, 241, 255, 0.8)', 'center', '700 14px "Rajdhani", system-ui, sans-serif')
    ctx.restore()
}

/**
 * Hit direction: a chevron around the crosshair pointing at the shooter, plus
 * a soft flash on that edge of the screen. Blue for shield hits, red for hull.
 */
function drawDamageDirections(ctx: CanvasRenderingContext2D, engine: VoidEngine, w: number, h: number) {
    if (!engine.damageDirs.length) return
    const cx = w / 2
    const cy = h / 2
    const r = Math.min(w, h) * 0.2
    ctx.save()
    for (const d of engine.damageDirs) {
        _l.copy(d.from).applyMatrix4(engine.camera.matrixWorldInverse)
        // Behind the camera still points the right way: use the lateral components.
        const angle = Math.atan2(-_l.y, _l.x)
        const a = Math.min(1, d.life * 1.6) * d.strength
        const rgb = d.shield ? '90,200,255' : '255,50,65'
        const c = Math.cos(angle)
        const sn = Math.sin(angle)

        // Edge flash
        const ex = cx + c * w * 0.5
        const ey = cy + sn * h * 0.5
        const edge = ctx.createRadialGradient(ex, ey, 0, ex, ey, Math.max(w, h) * 0.45)
        edge.addColorStop(0, `rgba(${rgb},${0.38 * a})`)
        edge.addColorStop(1, `rgba(${rgb},0)`)
        ctx.fillStyle = edge
        ctx.fillRect(0, 0, w, h)

        // Chevron wedge
        const spread = 0.22 + (1 - d.life) * 0.05
        const r0 = r + (1 - d.life) * 14
        ctx.fillStyle = `rgba(${rgb},${0.9 * a})`
        ctx.shadowColor = `rgba(${rgb},${a})`
        ctx.shadowBlur = 14
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(angle - spread) * r0, cy + Math.sin(angle - spread) * r0)
        ctx.lineTo(cx + c * (r0 + 26), cy + sn * (r0 + 26))
        ctx.lineTo(cx + Math.cos(angle + spread) * r0, cy + Math.sin(angle + spread) * r0)
        ctx.lineTo(cx + c * (r0 + 9), cy + sn * (r0 + 9))
        ctx.closePath()
        ctx.fill()
        ctx.shadowBlur = 0
    }
    ctx.restore()
}

/** Orbital strike marks: a closing ring and a countdown tick on the target. */
function drawStrikeMarkers(ctx: CanvasRenderingContext2D, engine: VoidEngine) {
    const marks = engine.skills?.markers()
    if (!marks?.length) return
    for (const m of marks) {
        const s = project(engine, m.pos)
        if (!s.visible) continue
        const dist = Math.max(1, m.pos.distanceTo(engine.camera.position))
        const px = (m.radius / dist) * (engine.height / (2 * Math.tan((engine.camera.fov * Math.PI) / 360)))
        const r = Math.max(10, px * (1.6 - m.k * 0.6))
        ctx.strokeStyle = `rgba(255,162,61,${0.45 + m.k * 0.5})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(s.x, s.y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.k)
        ctx.stroke()
        ctx.beginPath()
        for (const a of [0, 1, 2, 3]) {
            const ang = a * Math.PI / 2 + engine.time * 2
            ctx.moveTo(s.x + Math.cos(ang) * r * 0.55, s.y + Math.sin(ang) * r * 0.55)
            ctx.lineTo(s.x + Math.cos(ang) * r * 0.85, s.y + Math.sin(ang) * r * 0.85)
        }
        ctx.stroke()
    }
}

/** Lock-on: a closing diamond while E is held, solid when the lock is set. */
function drawLock(ctx: CanvasRenderingContext2D, engine: VoidEngine) {
    const sys = engine.systems
    if (!sys) return
    const target = sys.lockedTarget ?? (sys.lockProgress > 0 ? engine.focus : null)
    if (!target?.alive) return
    const s = project(engine, target.pos)
    if (!s.visible) return
    const k = Math.min(1, sys.lockProgress)
    const locked = !!sys.lockedTarget
    const r = 34 - k * 14
    ctx.save()
    ctx.translate(s.x, s.y)
    ctx.rotate(Math.PI / 4 + (locked ? 0 : engine.time * 3))
    ctx.strokeStyle = locked ? '#ff4f6d' : `rgba(255,120,120,${0.4 + k * 0.5})`
    ctx.lineWidth = locked ? 2.5 : 1.6
    ctx.strokeRect(-r, -r, r * 2, r * 2)
    ctx.restore()
    if (locked) label(ctx, 'LOCKED', s.x, s.y - 40, '#ff4f6d', 'center', '700 11px "Rajdhani", system-ui, sans-serif')
}

/** Cracks creep in from the screen corners when the hull is critical. */
function drawCracks(ctx: CanvasRenderingContext2D, engine: VoidEngine, w: number, h: number) {
    const p = engine.player
    const stats = engine.config?.stats
    if (!p?.alive || !stats) return
    const frac = p.hull / stats.hull
    if (frac > 0.25) return
    const alpha = Math.min(0.55, (0.25 - frac) * 2.5) * (0.8 + Math.sin(engine.time * 6) * 0.2)
    ctx.save()
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`
    ctx.lineWidth = 1.2
    const corners: [number, number, number, number][] = [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]]
    corners.forEach(([x, y, sx, sy], ci) => {
        for (let b = 0; b < 3; b++) {
            ctx.beginPath()
            let cx = x
            let cy = y
            ctx.moveTo(cx, cy)
            for (let i = 0; i < 5; i++) {
                const seed = Math.sin((ci + 1) * 91.7 + b * 37.1 + i * 13.3)
                cx += sx * (30 + Math.abs(seed) * 45)
                cy += sy * (20 + Math.abs(Math.cos(seed * 7)) * 40) * (b === 1 ? 0.5 : 1)
                ctx.lineTo(cx, cy)
            }
            ctx.stroke()
        }
    })
    ctx.restore()
}
