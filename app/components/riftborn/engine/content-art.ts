/*
 * A tiny drawing kit for the procedural enemy and boss sprites. Every helper
 * routes its colour through `c()`, so the same draw() call bakes both the
 * normal frame and the solid-white hit-flash frame.
 */
import type { Graphics } from 'pixi.js'

export const OUTLINE = 0x0b0712
export const TAU = Math.PI * 2

export function shade(color: number, f: number): number {
    const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 255) * f)))
    const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 255) * f)))
    const b = Math.max(0, Math.min(255, Math.round((color & 255) * f)))
    return (r << 16) | (g << 8) | b
}

export function mix(a: number, b: number, t: number): number {
    const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t))
    const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t))
    const bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * t))
    return (r << 16) | (g << 8) | bl
}

export interface Pen {
    readonly g: Graphics
    readonly white: boolean
    c(color: number): number
    /** Fill the current path */
    fill(color: number, alpha?: number): Pen
    /** Stroke the current path */
    stroke(color: number, width: number, alpha?: number): Pen
    circle(x: number, y: number, r: number, color: number, alpha?: number): Pen
    /** Filled circle with a dark outline */
    disc(x: number, y: number, r: number, color: number, outline?: number, width?: number): Pen
    ellipse(x: number, y: number, rx: number, ry: number, color: number, alpha?: number): Pen
    oval(x: number, y: number, rx: number, ry: number, color: number, outline?: number, width?: number): Pen
    poly(points: number[], color: number, alpha?: number): Pen
    shape(points: number[], color: number, outline?: number, width?: number): Pen
    ring(x: number, y: number, r: number, color: number, width: number, alpha?: number): Pen
    line(x1: number, y1: number, x2: number, y2: number, color: number, width: number, alpha?: number): Pen
    /** Polyline through the given points */
    path(points: number[], color: number, width: number, alpha?: number): Pen
    /** Soft halo: stacked translucent circles */
    halo(x: number, y: number, r: number, color: number, alpha?: number): Pen
    /** A glowing eye: halo, iris, hot core, white glint */
    eye(x: number, y: number, r: number, color: number): Pen
    star(x: number, y: number, points: number, r: number, inner: number, color: number, rotation?: number, alpha?: number): Pen
    rect(x: number, y: number, w: number, h: number, color: number, radius?: number, alpha?: number): Pen
    /**
     * A lit sphere: dark core, body offset toward the light (top-left), a soft
     * highlight, a specular glint, an optional rim light on the shadow side
     */
    ball(x: number, y: number, r: number, color: number, rim?: number, outline?: number, width?: number): Pen
    /** Lit ellipse, same layering as ball() */
    egg(x: number, y: number, rx: number, ry: number, color: number, rim?: number, outline?: number, width?: number): Pen
    /** Stroke an arc (angles in radians, clockwise from +x) */
    arc(x: number, y: number, r: number, from: number, to: number, color: number, width: number, alpha?: number): Pen
    /** Rim light on the lower-right edge of a circle */
    rim(x: number, y: number, r: number, color: number, width?: number, alpha?: number): Pen
    /** An outlined limb: dark stroke under a coloured one */
    limb(points: number[], color: number, width: number, outline?: number): Pen
    /** Smooth quadratic stroke with an outline */
    curve(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, color: number, width: number, outline?: number): Pen
    /** Glowing slit eye that narrows with `open` (0..1) */
    slit(x: number, y: number, w: number, h: number, color: number, open?: number): Pen
    /** Contact shadow, skipped in the hit-flash frame */
    shadow(x: number, y: number, rx: number, ry: number, alpha?: number): Pen
}

export function pen(g: Graphics, white: boolean): Pen {
    const c = (color: number) => (white ? 0xffffff : color)
    const p: Pen = {
        g,
        white,
        c,
        fill(color, alpha = 1) {
            g.fill({ color: c(color), alpha })
            return p
        },
        stroke(color, width, alpha = 1) {
            g.stroke({ color: c(color), width, alpha, join: 'round', cap: 'round' })
            return p
        },
        circle(x, y, r, color, alpha = 1) {
            g.circle(x, y, Math.max(0.1, r)).fill({ color: c(color), alpha })
            return p
        },
        disc(x, y, r, color, outline = OUTLINE, width = 2.5) {
            r = Math.max(0.1, r)
            g.circle(x, y, r).fill({ color: c(shade(color, 0.7)) })
            g.circle(x - r * 0.1, y - r * 0.12, r * 0.86).fill({ color: c(color) })
            if (r > 4) g.ellipse(x - r * 0.34, y - r * 0.4, r * 0.36, r * 0.24).fill({ color: c(mix(color, 0xffffff, 0.35)), alpha: 0.55 })
            g.circle(x, y, r).stroke({ color: c(outline), width, join: 'round' })
            return p
        },
        ellipse(x, y, rx, ry, color, alpha = 1) {
            // drop shadows stay out of the hit-flash silhouette
            if (white && color === 0x000000) return p
            g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry)).fill({ color: c(color), alpha })
            return p
        },
        oval(x, y, rx, ry, color, outline = OUTLINE, width = 2.5) {
            rx = Math.max(0.1, rx)
            ry = Math.max(0.1, ry)
            g.ellipse(x, y, rx, ry).fill({ color: c(shade(color, 0.7)) })
            g.ellipse(x - rx * 0.08, y - ry * 0.12, rx * 0.88, ry * 0.85).fill({ color: c(color) })
            if (Math.min(rx, ry) > 4) g.ellipse(x - rx * 0.3, y - ry * 0.42, rx * 0.4, ry * 0.26).fill({ color: c(mix(color, 0xffffff, 0.35)), alpha: 0.5 })
            g.ellipse(x, y, rx, ry).stroke({ color: c(outline), width, join: 'round' })
            return p
        },
        poly(points, color, alpha = 1) {
            g.poly(points).fill({ color: c(color), alpha })
            return p
        },
        shape(points, color, outline = OUTLINE, width = 2.5) {
            g.poly(points).fill({ color: c(color) }).stroke({ color: c(outline), width, join: 'round' })
            return p
        },
        ring(x, y, r, color, width, alpha = 1) {
            g.circle(x, y, Math.max(0.1, r)).stroke({ color: c(color), width, alpha })
            return p
        },
        line(x1, y1, x2, y2, color, width, alpha = 1) {
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: c(color), width, alpha, cap: 'round' })
            return p
        },
        path(points, color, width, alpha = 1) {
            if (points.length < 4) return p
            g.moveTo(points[0]!, points[1]!)
            for (let i = 2; i < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!)
            g.stroke({ color: c(color), width, alpha, cap: 'round', join: 'round' })
            return p
        },
        halo(x, y, r, color, alpha = 0.35) {
            // glows stay out of the solid hit-flash silhouette
            if (white) return p
            g.circle(x, y, r).fill({ color: c(color), alpha: alpha * 0.35 })
            g.circle(x, y, r * 0.68).fill({ color: c(color), alpha: alpha * 0.6 })
            g.circle(x, y, r * 0.4).fill({ color: c(color), alpha })
            return p
        },
        eye(x, y, r, color) {
            if (!white) {
                g.circle(x, y, r * 2.2).fill({ color, alpha: 0.18 })
                g.circle(x, y, r * 1.45).fill({ color, alpha: 0.38 })
            }
            g.circle(x, y, r).fill({ color: c(color) })
            g.circle(x, y, r * 0.55).fill({ color: c(mix(color, 0xffffff, 0.6)) })
            g.circle(x - r * 0.3, y - r * 0.3, Math.max(0.8, r * 0.28)).fill({ color: 0xffffff })
            return p
        },
        star(x, y, points, r, inner, color, rotation = 0, alpha = 1) {
            g.star(x, y, points, r, inner, rotation).fill({ color: c(color), alpha })
            return p
        },
        rect(x, y, w, h, color, radius = 0, alpha = 1) {
            if (radius > 0) g.roundRect(x, y, w, h, radius)
            else g.rect(x, y, w, h)
            g.fill({ color: c(color), alpha })
            return p
        },
        ball(x, y, r, color, rim, outline = OUTLINE, width = 2.5) {
            r = Math.max(0.5, r)
            g.circle(x, y, r).fill({ color: c(shade(color, 0.55)) })
            g.circle(x - r * 0.08, y - r * 0.1, r * 0.9).fill({ color: c(shade(color, 0.8)) })
            g.circle(x - r * 0.16, y - r * 0.2, r * 0.72).fill({ color: c(color) })
            g.ellipse(x - r * 0.3, y - r * 0.38, r * 0.42, r * 0.3).fill({ color: c(mix(color, 0xffffff, 0.4)), alpha: 0.75 })
            g.circle(x - r * 0.4, y - r * 0.45, Math.max(0.7, r * 0.13)).fill({ color: 0xffffff, alpha: 0.85 })
            if (rim !== undefined) g.arc(x, y, r * 0.84, 0.05, 1.65).stroke({ color: c(rim), width: Math.max(1, r * 0.16), alpha: 0.85, cap: 'round' })
            g.circle(x, y, r).stroke({ color: c(outline), width, join: 'round' })
            return p
        },
        egg(x, y, rx, ry, color, rim, outline = OUTLINE, width = 2.5) {
            rx = Math.max(0.5, rx)
            ry = Math.max(0.5, ry)
            g.ellipse(x, y, rx, ry).fill({ color: c(shade(color, 0.55)) })
            g.ellipse(x - rx * 0.06, y - ry * 0.1, rx * 0.92, ry * 0.88).fill({ color: c(shade(color, 0.8)) })
            g.ellipse(x - rx * 0.12, y - ry * 0.2, rx * 0.76, ry * 0.7).fill({ color: c(color) })
            g.ellipse(x - rx * 0.28, y - ry * 0.42, rx * 0.42, ry * 0.26).fill({ color: c(mix(color, 0xffffff, 0.4)), alpha: 0.7 })
            if (rim !== undefined) {
                g.moveTo(x + rx * 0.86, y + ry * 0.1).quadraticCurveTo(x + rx * 0.7, y + ry * 0.75, x + rx * 0.05, y + ry * 0.86)
                    .stroke({ color: c(rim), width: Math.max(1, Math.min(rx, ry) * 0.16), alpha: 0.85, cap: 'round' })
            }
            g.ellipse(x, y, rx, ry).stroke({ color: c(outline), width, join: 'round' })
            return p
        },
        arc(x, y, r, from, to, color, width, alpha = 1) {
            g.arc(x, y, Math.max(0.1, r), from, to).stroke({ color: c(color), width, alpha, cap: 'round' })
            return p
        },
        rim(x, y, r, color, width = 1.6, alpha = 0.85) {
            g.arc(x, y, Math.max(0.1, r - width * 0.7), 0.1, 1.6).stroke({ color: c(color), width, alpha, cap: 'round' })
            return p
        },
        limb(points, color, width, outline = OUTLINE) {
            p.path(points, outline, width + 2.6)
            p.path(points, color, width)
            p.path(points.map((v, i) => v - (i % 2 === 0 ? width * 0.12 : width * 0.18)), mix(color, 0xffffff, 0.28), Math.max(0.8, width * 0.3), 0.7)
            return p
        },
        curve(x1, y1, cx, cy, x2, y2, color, width, outline = OUTLINE) {
            g.moveTo(x1, y1).quadraticCurveTo(cx, cy, x2, y2).stroke({ color: c(outline), width: width + 2.6, cap: 'round', join: 'round' })
            g.moveTo(x1, y1).quadraticCurveTo(cx, cy, x2, y2).stroke({ color: c(color), width, cap: 'round', join: 'round' })
            return p
        },
        slit(x, y, w, h, color, open = 1) {
            const hh = Math.max(0.4, h * open)
            if (!white) {
                g.ellipse(x, y, w * 1.9, hh * 2.4 + 1).fill({ color, alpha: 0.2 })
                g.ellipse(x, y, w * 1.3, hh * 1.6 + 0.6).fill({ color, alpha: 0.35 })
            }
            g.ellipse(x, y, w, hh).fill({ color: c(color) })
            g.ellipse(x, y, w * 0.55, hh * 0.5).fill({ color: c(mix(color, 0xffffff, 0.7)) })
            return p
        },
        shadow(x, y, rx, ry, alpha = 0.28) {
            if (white) return p
            g.ellipse(x, y, rx, ry).fill({ color: 0x000000, alpha })
            return p
        }
    }
    return p
}
