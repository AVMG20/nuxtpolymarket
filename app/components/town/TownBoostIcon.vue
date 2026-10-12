<script setup lang="ts">
// Polytown boost badges. One hand-drawn style for every boost: a rounded
// two-tone badge with a soft shine, a thick dark outline and a bright glyph,
// so they read at 16px and still hold up at 96px.

export type TownBoostIconKind = 'build' | 'production' | 'market' | 'builder' | 'instant' | 'lucky'

const props = withDefaults(defineProps<{
    kind: TownBoostIconKind
    size?: number
}>(), { size: 20 })

interface Palette {
    /** Badge, top and bottom. */
    bg: [string, string]
    /** Outline. */
    ink: string
    /** Main glyph, light and deep. */
    glyph: [string, string]
}

const PALETTES: Record<TownBoostIconKind, Palette> = {
    build: { bg: ['#fdba74', '#c2410c'], ink: '#3b1404', glyph: ['#fff7d6', '#fbbf24'] },
    production: { bg: ['#86efac', '#15803d'], ink: '#062e16', glyph: ['#ecfccb', '#4ade80'] },
    market: { bg: ['#fde047', '#a16207'], ink: '#3a2502', glyph: ['#fffbe0', '#f5b301'] },
    builder: { bg: ['#93c5fd', '#1d4ed8'], ink: '#0a1a4a', glyph: ['#e0f2fe', '#38bdf8'] },
    instant: { bg: ['#d8b4fe', '#7e22ce'], ink: '#2a0b4a', glyph: ['#faf5ff', '#e9d5ff'] },
    lucky: { bg: ['#5eead4', '#0f766e'], ink: '#03302b', glyph: ['#d1fae5', '#10b981'] }
}

const LABELS: Record<TownBoostIconKind, string> = {
    build: 'Builder\'s rush',
    production: 'Production surge',
    market: 'Market day',
    builder: 'Free builder',
    instant: 'Instant finish',
    lucky: 'Lucky chest'
}

const uid = useId()
const id = (name: string) => `tbi-${uid}-${name}`
const url = (name: string) => `url(#${id(name)})`

const p = computed(() => PALETTES[props.kind])

// An 8-tooth gear around (24, 25), built once.
const GEAR = (() => {
    const cx = 24
    const cy = 25
    const pts: string[] = []
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        for (const [r, d] of [[12.6, -0.36], [16.5, -0.21], [16.5, 0.21], [12.6, 0.36]] as const) {
            pts.push(`${(cx + Math.cos(a + d) * r).toFixed(2)} ${(cy + Math.sin(a + d) * r).toFixed(2)}`)
        }
    }
    return `M${pts.join('L')}Z`
})()

// A heart-shaped clover leaf with its tip at the origin, pointing up.
const LEAF = 'M0 0C-2 -2 -7 -4 -7 -8C-7 -11 -4 -12.5 -2 -11Q0 -10 0 -8.5Q0 -10 2 -11C4 -12.5 7 -11 7 -8C7 -4 2 -2 0 0Z'
</script>

<template>
    <svg
        class="town-boost-icon"
        :width="size"
        :height="size"
        viewBox="0 0 48 48"
        role="img"
        :aria-label="LABELS[kind]"
    >
        <defs>
            <linearGradient :id="id('bg')" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" :stop-color="p.bg[0]" />
                <stop offset="1" :stop-color="p.bg[1]" />
            </linearGradient>
            <linearGradient :id="id('shine')" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#fff" stop-opacity=".6" />
                <stop offset="1" stop-color="#fff" stop-opacity="0" />
            </linearGradient>
            <linearGradient :id="id('glyph')" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" :stop-color="p.glyph[0]" />
                <stop offset="1" :stop-color="p.glyph[1]" />
            </linearGradient>
            <linearGradient :id="id('wood')" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#c98a4b" />
                <stop offset="1" stop-color="#7a4419" />
            </linearGradient>
            <linearGradient :id="id('gold')" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#fff3b0" />
                <stop offset="1" stop-color="#f59e0b" />
            </linearGradient>
            <linearGradient :id="id('green')" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#bbf7d0" />
                <stop offset="1" stop-color="#16a34a" />
            </linearGradient>
        </defs>

        <!-- Badge -->
        <rect x="2.5" y="2.5" width="43" height="43" rx="12" :fill="url('bg')" :stroke="p.ink" stroke-width="3" />
        <rect x="5.5" y="5.5" width="37" height="37" rx="9.5" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.2" />
        <path d="M6 17C6 9.5 9.5 6 17 6H31C38.5 6 42 9.5 42 17C33 21.5 15 21.5 6 17Z" :fill="url('shine')" />

        <g :stroke="p.ink" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">
            <!-- Builder's rush: an amber hammer mid-swing -->
            <template v-if="kind === 'build'">
                <g fill="none" stroke="#fff" stroke-width="2.4">
                    <path d="M7.5 15H13M6.5 20.5H14M8.5 26H13" :stroke="p.ink" stroke-width="5" />
                    <path d="M7.5 15H13M6.5 20.5H14M8.5 26H13" />
                </g>
                <g transform="rotate(30 24 26)">
                    <rect x="21.8" y="18" width="5.4" height="24" rx="2.4" :fill="url('wood')" />
                    <rect x="12.5" y="10.5" width="24" height="10.5" rx="2.8" :fill="url('glyph')" />
                    <path d="M15 13.2H33" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" paint-order="normal" />
                </g>
            </template>

            <!-- Production surge: a green gear with a lightning bolt -->
            <template v-else-if="kind === 'production'">
                <path :d="GEAR" :fill="url('glyph')" />
                <circle cx="24" cy="25" r="7.6" fill="#14532d" stroke-width="2" />
                <path d="M27.5 12L17 27.5H23L20.5 38.5L31.5 22H25.5Z" :fill="url('gold')" />
            </template>

            <!-- Market day: a coin stack with an up arrow -->
            <template v-else-if="kind === 'market'">
                <template v-for="y in [35, 28.5, 22]" :key="y">
                    <path :d="`M9 ${y}V${y + 4}A10 4 0 0 0 29 ${y + 4}V${y}Z`" fill="#d97706" />
                    <ellipse cx="19" :cy="y" rx="10" ry="4" :fill="url('glyph')" />
                </template>
                <ellipse cx="19" cy="22" rx="5.5" ry="2" fill="none" stroke="#d97706" stroke-width="1.2" paint-order="normal" />
                <path d="M35.5 8.5L43 18H39V33H32V18H28Z" :fill="url('green')" />
            </template>

            <!-- Free builder: a blue hard hat with a plus -->
            <template v-else-if="kind === 'builder'">
                <path d="M9.5 27C9.5 16.5 15.5 10 24 10C32.5 10 38.5 16.5 38.5 27Z" :fill="url('glyph')" />
                <rect x="20.8" y="8" width="6.4" height="19" rx="3" fill="#e0f2fe" />
                <rect x="6" y="25.5" width="36" height="6.5" rx="3.2" fill="#0ea5e9" />
                <circle cx="35.5" cy="36" r="8" :fill="url('green')" />
                <path d="M35.5 31.5V40.5M31 36H40" fill="none" stroke="#fff" stroke-width="2.6" paint-order="normal" />
            </template>

            <!-- Instant finish: a purple hourglass with a spark -->
            <template v-else-if="kind === 'instant'">
                <path d="M14 12H30C30 19 25 22 24 24.5C25 27 30 30 30 37H14C14 30 19 27 20 24.5C19 22 14 19 14 12Z" :fill="url('glyph')" />
                <path d="M17 15H27C26 19 23.5 21 22 23C20.5 21 18 19 17 15Z" :fill="url('gold')" stroke="none" />
                <path d="M16 35C17 31 20 29.2 22 28.8C24 29.2 27 31 28 35Z" :fill="url('gold')" stroke="none" />
                <path d="M22 23V29" fill="none" stroke="#f59e0b" stroke-width="1.2" paint-order="normal" />
                <rect x="11" y="7" width="22" height="5.5" rx="2.6" fill="#a855f7" />
                <rect x="11" y="36.5" width="22" height="5.5" rx="2.6" fill="#a855f7" />
                <path d="M37.5 5.5Q38.5 11 44 12Q38.5 13 37.5 18.5Q36.5 13 31 12Q36.5 11 37.5 5.5Z" fill="#fff9c4" stroke-width="2.6" />
            </template>

            <!-- Lucky chest: an emerald clover popping out of a tiny chest -->
            <template v-else>
                <g transform="translate(24 15) rotate(15)" :fill="url('glyph')">
                    <path v-for="a in [0, 90, 180, 270]" :key="a" :d="LEAF" :transform="`rotate(${a}) scale(.78)`" />
                </g>
                <path d="M10 28V24.5C10 21 13 19.5 16.5 19.5H31.5C35 19.5 38 21 38 24.5V28Z" :fill="url('wood')" />
                <rect x="10" y="27" width="28" height="14" rx="2.6" :fill="url('wood')" />
                <path d="M10.5 28H37.5" fill="none" stroke="#fcd34d" stroke-width="1.8" paint-order="normal" />
                <rect x="21" y="25.5" width="6" height="7" rx="1.4" :fill="url('gold')" stroke-width="2.4" />
            </template>
        </g>
    </svg>
</template>

<style scoped>
.town-boost-icon { display: inline-block; flex-shrink: 0; vertical-align: middle; overflow: visible; }
</style>
