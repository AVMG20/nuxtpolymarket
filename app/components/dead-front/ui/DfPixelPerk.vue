<template>
    <svg
        class="df-pxperk"
        :class="{ lit: glow, dim, brewing }"
        :viewBox="`0 0 ${W} ${H}`"
        :width="size * W / H"
        :height="size"
        shape-rendering="crispEdges"
        :style="{ '--c': color }"
        aria-hidden="true"
    >
        <defs v-if="brewing">
            <clipPath :id="clipId">
                <rect v-for="(r, i) in sprite.liquid" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" />
            </clipPath>
        </defs>
        <g class="df-pxperk-body">
            <rect v-for="(r, i) in sprite.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
            <template v-if="brewing">
                <!-- bubbles rise through the liquid only (clipped), one sprite pixel per step -->
                <g :clip-path="`url(#${clipId})`">
                    <rect
                        v-for="(b, i) in sprite.bubbles"
                        :key="`b${i}`"
                        class="df-bubble"
                        :x="b.x"
                        :y="b.y"
                        width="1"
                        height="1"
                        :fill="b.fill"
                        :style="{ '--d': b.d, 'animationDuration': `${b.dur}s`, 'animationDelay': `${b.delay}s`, 'animationTimingFunction': `steps(${b.d}, end)` }"
                    />
                </g>
                <!-- steam wisps and sparkles off the cork -->
                <rect
                    v-for="(w, i) in sprite.wisps"
                    :key="`w${i}`"
                    :class="w.spark ? 'df-spark' : 'df-wisp'"
                    :x="w.x"
                    :y="w.y"
                    width="1"
                    height="1"
                    :fill="w.fill"
                    :style="{ '--dx': w.dx, 'animationDelay': `${w.delay}s` }"
                />
            </template>
        </g>
    </svg>
</template>

<script setup lang="ts">
// A perk bottle as a pixel sprite, matching the voxel world: each perk has
// its own silhouette (stout, tonic, rye, round flask, wasp waist, long neck),
// filled with that perk's colour up to `fill`. Sizes that are multiples of
// 20 px land on whole pixels.
import type { DfPerkId } from '#shared/utils/dead-front/types'
import { DF_BOTTLES, DF_BOTTLE_H, DF_BOTTLE_W, dfBottlePixel } from '~/utils/dead-front/world/perk-bottles'
import type { DfBottlePixel } from '~/utils/dead-front/world/perk-bottles'

const props = withDefaults(defineProps<{
    perk: DfPerkId
    color: string
    /** Height in CSS pixels. */
    size?: number
    /** 0..1 liquid level. */
    fill?: number
    glow?: boolean
    dim?: boolean
    /** Being researched: bubbles, steam off the cork, a glow pulse and a slow sway. */
    brewing?: boolean
}>(), { size: 40, fill: 1, glow: false, dim: false, brewing: false })

const clipId = `df-pxperk-${useId()}`

const W = DF_BOTTLE_W
const H = DF_BOTTLE_H

const OUTLINE = '#0b0906'
const CAP = '#8a5d30'
const CAP_HI = '#b9844a'
const PAPER = '#efe2bf'
const INK = '#5a4632'

function hex(c: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim())
    const n = m ? Number.parseInt(m[1]!, 16) : 0xc9a24a
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(c: [number, number, number], to: [number, number, number], t: number): string {
    const r = Math.round(c[0] + (to[0] - c[0]) * t)
    const g = Math.round(c[1] + (to[1] - c[1]) * t)
    const b = Math.round(c[2] + (to[2] - c[2]) * t)
    return `rgb(${r},${g},${b})`
}

interface Px { x: number, y: number, w: number, fill: string }

const sprite = computed(() => {
    const sp = DF_BOTTLES[props.perk]
    const base = hex(props.color)
    const black: [number, number, number] = [10, 8, 6]
    const white: [number, number, number] = [255, 250, 235]
    const liquidHi = mix(base, white, 0.45)
    const fills: Record<Exclude<DfBottlePixel, 'none'>, string> = {
        cork: CAP,
        corkHi: CAP_HI,
        outline: OUTLINE,
        label: PAPER,
        labelBand: mix(base, black, 0.2),
        ink: INK,
        liquid: mix(base, black, 0),
        liquidHi,
        liquidLo: mix(base, black, 0.35),
        glass: mix(base, black, 0.78),
        glassHi: mix(base, white, 0.2)
    }
    const first = sp.spans.findIndex(s => s !== null)
    const bottom = H - 1
    const out: Px[] = []
    const liquidPx: Px[] = []
    let liquidTop = H
    for (let y = 0; y < H; y++) {
        const s = sp.spans[y]
        if (!s) continue
        for (let x = s[0]; x <= s[1]; x++) {
            const k = dfBottlePixel(sp, x, y, props.fill)
            if (k === 'none') continue
            if (k === 'liquid' || k === 'liquidHi' || k === 'liquidLo') {
                liquidPx.push({ x, y, w: 1, fill: '' })
                liquidTop = Math.min(liquidTop, y)
            }
            out.push({ x, y, w: 1, fill: fills[k] })
        }
    }
    const inside = (x: number, y: number): boolean => {
        const k = dfBottlePixel(sp, x, y)
        return k !== 'none' && k !== 'cork' && k !== 'corkHi'
    }
    // Brewing particles: three bubble columns from the bottom to the surface, and
    // wisps / sparkles just above the cork (drawn outside the box; the svg overflows).
    const bubbles: (Px & { d: number, dur: number, delay: number })[] = []
    const wisps: (Px & { dx: number, delay: number, spark: boolean })[] = []
    if (props.brewing) {
        const low = sp.spans[bottom - 1]!
        const mid = Math.round((low[0] + low[1]) / 2)
        const travel = Math.max(1, bottom - 1 - liquidTop)
        const pale = mix(base, white, 0.7)
        ;[low[0] + 2, mid, low[1] - 2].forEach((x, n) => {
            if (!inside(x, bottom - 1)) return
            bubbles.push({ x, y: bottom - 1, w: 1, fill: pale, d: travel, dur: 0.3 * travel + 0.6 + n * 0.25, delay: -n * 0.7 })
        })
        const cork = sp.spans[first]!
        const cx = Math.round((cork[0] + cork[1]) / 2)
        const steam = 'rgb(232,226,212)'
        wisps.push(
            { x: cx - 1, y: first - 1, w: 1, fill: steam, dx: -1, delay: 0, spark: false },
            { x: cx, y: first - 1, w: 1, fill: steam, dx: 1, delay: -1.1, spark: false },
            { x: cx - 3, y: first - 2, w: 1, fill: liquidHi, dx: 0, delay: -0.4, spark: true },
            { x: cx + 2, y: first - 3, w: 1, fill: 'rgb(255,250,235)', dx: 0, delay: -1.3, spark: true }
        )
    }
    return { rects: out, liquid: liquidPx, bubbles, wisps }
})
</script>

<style scoped>
.df-pxperk {
    display: block;
    image-rendering: pixelated;
    filter: drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
    transition: opacity 0.3s, filter 0.3s;
}

.df-pxperk.lit {
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--c) 70%, transparent)) drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
}

.df-pxperk.brewing {
    overflow: visible;
    animation: df-brew-glow 2.4s ease-in-out infinite;
}

.df-pxperk.brewing .df-pxperk-body {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation: df-brew-sway 3.6s ease-in-out infinite;
}

.df-bubble {
    animation-name: df-bubble;
    animation-iteration-count: infinite;
}

.df-wisp {
    opacity: 0;
    animation: df-wisp 2.2s steps(4, end) infinite;
}

.df-spark {
    opacity: 0;
    animation: df-spark 1.8s steps(2, jump-none) infinite;
}

@keyframes df-brew-glow {
    0%, 100% {
        filter: drop-shadow(0 0 4px color-mix(in srgb, var(--c) 55%, transparent)) drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
    }
    50% {
        filter: drop-shadow(0 0 10px color-mix(in srgb, var(--c) 90%, transparent)) drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
    }
}

@keyframes df-brew-sway {
    0%, 100% {
        transform: rotate(-1.5deg);
    }
    50% {
        transform: rotate(1.5deg);
    }
}

@keyframes df-bubble {
    0% {
        transform: translateY(0);
    }
    100% {
        transform: translateY(calc(var(--d) * -1px));
    }
}

@keyframes df-wisp {
    0% {
        opacity: 0.9;
        transform: translate(0, 0);
    }
    100% {
        opacity: 0;
        transform: translate(calc(var(--dx) * 1px), -4px);
    }
}

@keyframes df-spark {
    0%, 100% {
        opacity: 0;
    }
    50% {
        opacity: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .df-pxperk.brewing,
    .df-pxperk.brewing .df-pxperk-body,
    .df-bubble,
    .df-wisp,
    .df-spark {
        animation: none;
    }

    .df-pxperk.brewing {
        filter: drop-shadow(0 0 7px color-mix(in srgb, var(--c) 75%, transparent)) drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
    }

    .df-spark {
        opacity: 0.8;
    }
}

.df-pxperk.dim {
    opacity: 0.5;
    filter: saturate(0.3) drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.7));
}
</style>
