<template>
    <div class="vart" :class="[`vart-${size}`, { 'vart-flat': flat }]" :style="{ '--c': color, '--r': rarityColor }">
        <svg viewBox="0 0 64 64" aria-hidden="true">
            <g v-html="art" />
        </svg>
        <span v-if="tier" class="vart-tier">T{{ tier }}</span>
        <span v-if="level" class="vart-lvl">+{{ level }}</span>
    </div>
</template>

<script setup lang="ts">
import { voidHex } from '#shared/utils/gamelogic/void'
import { VOID_MODS, voidItemType } from '#shared/utils/gamelogic/void-items'

const props = withDefaults(defineProps<{
    /** An item type id (`autocannon`, `pulse`, …) or a relic mod id. */
    type: string
    tier?: number
    level?: number
    /** Rarity colour for the frame; the plate stays neutral without one. */
    rarityColor?: string
    size?: 'sm' | 'md' | 'lg'
    /** Drops the plate and frame, leaving just the silhouette. */
    flat?: boolean
}>(), { size: 'md' })

const color = computed(() => {
    const item = voidItemType(props.type)
    if (item) return voidHex(item.color)
    const mod = VOID_MODS.find(m => m.id === props.type)
    return mod ? voidHex(mod.color) : '#9fb4c8'
})

const rarityColor = computed(() => props.rarityColor ?? 'rgba(255, 255, 255, 0.14)')

/**
 * Every piece of gear draws itself from one small set of SVG shapes: guns point
 * right, turrets sit on a mount, armour and shields are plates and arcs, and
 * relic mods are emblems. Drawn rather than drawn-on so a new type is a few
 * lines here instead of an asset pipeline.
 */
const ART: Record<string, string> = {
    // ─── Guns: side on, muzzle to the right ─────────────────────────────────
    blaster: `
        <rect x="8" y="22" width="26" height="8" rx="2" class="b" />
        <rect x="8" y="34" width="26" height="8" rx="2" class="b" />
        <rect x="32" y="24" width="22" height="4" rx="1.5" class="f" />
        <rect x="32" y="36" width="22" height="4" rx="1.5" class="f" />
        <circle cx="54" cy="26" r="3" class="g" />
        <circle cx="54" cy="38" r="3" class="g" />`,
    autocannon: `
        <rect x="6" y="26" width="24" height="14" rx="3" class="b" />
        <circle cx="16" cy="33" r="7" class="s" />
        <circle cx="16" cy="33" r="3" class="g" />
        <rect x="28" y="29" width="30" height="8" rx="2" class="f" />
        <rect x="38" y="26" width="4" height="14" rx="1" class="s" />
        <rect x="46" y="26" width="4" height="14" rx="1" class="s" />`,
    scatter: `
        <rect x="8" y="26" width="22" height="14" rx="3" class="b" />
        <path d="M30 27 L52 18 L52 48 L30 39 Z" class="f" />
        <circle cx="50" cy="24" r="2.4" class="g" />
        <circle cx="52" cy="33" r="2.4" class="g" />
        <circle cx="50" cy="42" r="2.4" class="g" />`,
    plasma: `
        <rect x="6" y="27" width="22" height="12" rx="3" class="b" />
        <rect x="26" y="29" width="16" height="8" rx="2" class="f" />
        <circle cx="49" cy="33" r="10" class="s" />
        <circle cx="49" cy="33" r="5" class="g" />`,
    lancer: `
        <rect x="6" y="26" width="18" height="14" rx="3" class="b" />
        <rect x="22" y="30" width="24" height="6" rx="2" class="f" />
        <path d="M46 29 L58 33 L46 37 Z" class="s" />
        <rect x="24" y="32" width="36" height="2" rx="1" class="g" />`,
    driver: `
        <rect x="4" y="27" width="16" height="12" rx="3" class="b" />
        <rect x="18" y="30" width="42" height="6" rx="2" class="f" />
        <rect x="28" y="26" width="3" height="14" rx="1" class="s" />
        <rect x="36" y="26" width="3" height="14" rx="1" class="s" />
        <rect x="44" y="26" width="3" height="14" rx="1" class="s" />
        <circle cx="60" cy="33" r="2.5" class="g" />`,

    // ─── Turrets: a mount with something angry on top ───────────────────────
    pulse: `
        <path d="M14 52 L50 52 L46 44 L18 44 Z" class="b" />
        <circle cx="32" cy="34" r="11" class="s" />
        <rect x="29" y="10" width="6" height="22" rx="2" class="f" />
        <circle cx="32" cy="12" r="3" class="g" />`,
    gatling: `
        <path d="M14 52 L50 52 L46 44 L18 44 Z" class="b" />
        <circle cx="32" cy="36" r="10" class="s" />
        <rect x="23" y="12" width="5" height="22" rx="2" class="f" />
        <rect x="30" y="8" width="5" height="26" rx="2" class="f" />
        <rect x="37" y="12" width="5" height="22" rx="2" class="f" />`,
    flak: `
        <path d="M14 52 L50 52 L46 44 L18 44 Z" class="b" />
        <circle cx="32" cy="38" r="9" class="s" />
        <path d="M27 36 L24 14 L40 14 L37 36 Z" class="f" />
        <circle cx="26" cy="9" r="2.6" class="g" />
        <circle cx="32" cy="6" r="2.6" class="g" />
        <circle cx="38" cy="9" r="2.6" class="g" />`,
    tesla: `
        <path d="M14 52 L50 52 L46 44 L18 44 Z" class="b" />
        <rect x="26" y="30" width="12" height="14" rx="2" class="s" />
        <circle cx="32" cy="22" r="9" class="f" />
        <path d="M32 6 L25 20 L32 20 L26 32" class="l" />
        <path d="M44 14 L50 22" class="l" />
        <path d="M20 14 L14 22" class="l" />`,
    beam: `
        <path d="M14 52 L50 52 L46 44 L18 44 Z" class="b" />
        <rect x="24" y="30" width="16" height="14" rx="3" class="s" />
        <path d="M26 30 L32 16 L38 30 Z" class="f" />
        <rect x="30" y="4" width="4" height="14" rx="2" class="g" />`,
    missile: `
        <path d="M14 52 L50 52 L46 44 L18 44 Z" class="b" />
        <rect x="18" y="18" width="28" height="26" rx="3" class="s" />
        <circle cx="27" cy="27" r="4" class="g" />
        <circle cx="37" cy="27" r="4" class="g" />
        <circle cx="27" cy="37" r="4" class="g" />
        <circle cx="37" cy="37" r="4" class="g" />`,
    mortar: `
        <path d="M12 52 L52 52 L47 43 L17 43 Z" class="b" />
        <path d="M20 44 L28 16 L44 22 L36 47 Z" class="f" />
        <ellipse cx="36" cy="18" rx="9" ry="4" class="g" transform="rotate(20 36 18)" />`,
    rail: `
        <path d="M14 52 L50 52 L46 44 L18 44 Z" class="b" />
        <rect x="24" y="34" width="16" height="10" rx="2" class="s" />
        <rect x="21" y="8" width="5" height="28" rx="2" class="f" />
        <rect x="38" y="8" width="5" height="28" rx="2" class="f" />
        <rect x="26" y="18" width="12" height="3" rx="1.5" class="g" />
        <rect x="26" y="28" width="12" height="3" rx="1.5" class="g" />`,

    // ─── Armour ─────────────────────────────────────────────────────────────
    plating: `
        <path d="M32 6 L54 16 L54 40 L32 58 L10 40 L10 16 Z" class="b" />
        <path d="M32 14 L46 21 L46 38 L32 49 L18 38 L18 21 Z" class="s" />
        <path d="M32 22 L39 26 L39 35 L32 41 L25 35 L25 26 Z" class="g" />`,
    bulkhead: `
        <path d="M32 6 L54 16 L54 40 L32 58 L10 40 L10 16 Z" class="b" />
        <path d="M14 22 L50 22 L50 30 L14 30 Z" class="s" />
        <path d="M16 34 L48 34 L44 42 L20 42 Z" class="s" />
        <circle cx="19" cy="26" r="2" class="g" />
        <circle cx="45" cy="26" r="2" class="g" />
        <circle cx="24" cy="38" r="2" class="g" />
        <circle cx="40" cy="38" r="2" class="g" />`,

    // ─── Shields ────────────────────────────────────────────────────────────
    deflector: `
        <path d="M32 7 L53 17 L53 36 C53 48 43 55 32 59 C21 55 11 48 11 36 L11 17 Z" class="b" />
        <path d="M32 15 L45 21 L45 35 C45 43 39 47 32 50 C25 47 19 43 19 35 L19 21 Z" class="s" />
        <path d="M32 23 L38 26 L38 34 C38 38 35 40 32 42 C29 40 26 38 26 34 L26 26 Z" class="g" />`,
    regenerator: `
        <path d="M32 7 L53 17 L53 36 C53 48 43 55 32 59 C21 55 11 48 11 36 L11 17 Z" class="b" />
        <path d="M22 34 A11 11 0 1 1 30 43" class="l" />
        <path d="M32 18 L26 28 L38 28 Z" class="g" />`,

    // ─── Secondary weapons ──────────────────────────────────────────────────
    seekers: `
        <rect x="10" y="20" width="30" height="24" rx="4" class="b" />
        <path d="M40 22 L56 26 L40 30 Z" class="f" />
        <path d="M40 34 L56 38 L40 42 Z" class="f" />
        <circle cx="20" cy="26" r="3" class="g" />
        <circle cx="20" cy="38" r="3" class="g" />`,
    rockets: `
        <path d="M12 30 L38 22 L52 26 L38 30 Z" class="f" />
        <path d="M12 42 L38 34 L52 38 L38 42 Z" class="f" />
        <path d="M14 36 L40 28 L56 32 L40 36 Z" class="s" />
        <path d="M12 30 L6 26 L12 26 Z" class="g" />
        <path d="M12 42 L6 38 L12 38 Z" class="g" />`,
    mines: `
        <circle cx="32" cy="32" r="14" class="s" />
        <circle cx="32" cy="32" r="6" class="g" />
        <path d="M32 8 L32 18 M32 46 L32 56 M8 32 L18 32 M46 32 L56 32" class="l" />
        <path d="M15 15 L22 22 M49 15 L42 22 M15 49 L22 42 M49 49 L42 42" class="l" />`,
    torpedo: `
        <path d="M8 32 L20 22 L48 24 L58 32 L48 40 L20 42 Z" class="b" />
        <path d="M44 26 L58 32 L44 38 Z" class="f" />
        <path d="M14 22 L8 12 L20 20 Z" class="s" />
        <path d="M14 42 L8 52 L20 44 Z" class="s" />
        <circle cx="30" cy="32" r="4" class="g" />`,

    // ─── Devices ────────────────────────────────────────────────────────────
    booster: `
        <path d="M32 7 L53 17 L53 36 C53 48 43 55 32 59 C21 55 11 48 11 36 L11 17 Z" class="b" />
        <path d="M32 18 L42 34 L35 34 L35 46 L29 46 L29 34 L22 34 Z" class="g" />`,
    decoy: `
        <path d="M32 8 L44 40 L32 34 L20 40 Z" class="b" />
        <path d="M32 20 L40 46 L32 41 L24 46 Z" class="d" />
        <circle cx="32" cy="24" r="3" class="g" />`,
    sentry: `
        <circle cx="32" cy="34" r="12" class="b" />
        <circle cx="32" cy="34" r="5" class="g" />
        <rect x="29" y="10" width="6" height="16" rx="2" class="f" />
        <path d="M12 40 L20 34 M52 40 L44 34" class="l" />`,
    cloak: `
        <path d="M32 8 L44 40 L32 34 L20 40 Z" class="s" />
        <path d="M22 46 L42 46 M18 52 L46 52" class="l" />
        <circle cx="32" cy="24" r="3" class="g" />`,
    dilator: `
        <circle cx="32" cy="32" r="16" class="b" />
        <circle cx="32" cy="32" r="16" class="o" />
        <path d="M32 20 L32 32 L41 38" class="l" />
        <path d="M6 32 A26 26 0 0 1 14 14 M58 32 A26 26 0 0 0 50 14" class="l" />`,

    // ─── Relic mods ─────────────────────────────────────────────────────────
    chain: `
        <path d="M34 6 L16 34 L30 34 L26 58 L48 28 L34 28 Z" class="f" />`,
    burn: `
        <path d="M32 6 C40 20 48 24 48 38 A16 16 0 0 1 16 38 C16 26 24 24 24 14 C30 20 30 24 32 6 Z" class="f" />
        <path d="M32 34 C36 40 37 42 37 45 A5 5 0 0 1 27 45 C27 41 30 40 32 34 Z" class="g" />`,
    overcharge: `
        <rect x="12" y="20" width="10" height="24" rx="2" class="s" />
        <rect x="27" y="14" width="10" height="36" rx="2" class="f" />
        <rect x="42" y="24" width="10" height="20" rx="2" class="s" />
        <circle cx="32" cy="32" r="4" class="g" />`,
    frost: `
        <path d="M32 6 L32 58 M9 19 L55 45 M55 19 L9 45" class="l" />
        <path d="M32 14 L26 20 M32 14 L38 20 M32 50 L26 44 M32 50 L38 44" class="l" />
        <circle cx="32" cy="32" r="4" class="g" />`,
    prism: `
        <path d="M32 8 L54 46 L10 46 Z" class="s" />
        <path d="M32 8 L32 46" class="l" />
        <path d="M4 30 L30 30 M34 30 L60 22 M34 34 L60 42" class="l" />`,
    reactive: `
        <path d="M32 6 L54 16 L54 40 L32 58 L10 40 L10 16 Z" class="b" />
        <path d="M32 16 L44 32 L36 32 L42 46 L22 30 L30 30 Z" class="g" />`,
    nanoweave: `
        <path d="M14 20 L50 20 M14 32 L50 32 M14 44 L50 44" class="l" />
        <path d="M22 12 L22 52 M32 12 L32 52 M42 12 L42 52" class="l" />
        <circle cx="32" cy="32" r="5" class="g" />`,
    surge: `
        <circle cx="32" cy="32" r="18" class="o" />
        <path d="M34 14 L22 36 L31 36 L28 50 L42 28 L33 28 Z" class="f" />`,
    static: `
        <circle cx="32" cy="32" r="6" class="g" />
        <circle cx="32" cy="32" r="14" class="o" />
        <circle cx="32" cy="32" r="22" class="o" />`
}

const FALLBACK = `
    <rect x="12" y="12" width="40" height="40" rx="6" class="s" />
    <circle cx="32" cy="32" r="8" class="g" />`

const art = computed(() => ART[props.type] ?? FALLBACK)
</script>

<style>
/*
 * One plate, one silhouette. `b`/`s`/`f` are body, secondary and feature fills
 * at falling opacities, `g` is the hot bit, `l`/`o` are strokes.
 */
.vart { position: relative; display: grid; place-items: center; flex-shrink: 0; background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--c) 18%, transparent), rgba(4, 9, 18, 0.9) 70%); border: 1px solid color-mix(in srgb, var(--r) 55%, transparent); }
.vart-flat { background: none; border: none; }
.vart svg { width: 76%; height: 76%; overflow: visible; }
.vart .b { fill: color-mix(in srgb, var(--c) 55%, #0b1422); }
.vart .s { fill: color-mix(in srgb, var(--c) 72%, #0b1422); }
.vart .f { fill: var(--c); }
.vart .g { fill: #fff; filter: drop-shadow(0 0 4px var(--c)); }
.vart .d { fill: color-mix(in srgb, var(--c) 30%, transparent); }
.vart .l { fill: none; stroke: var(--c); stroke-width: 3; stroke-linecap: round; }
.vart .o { fill: none; stroke: color-mix(in srgb, var(--c) 60%, transparent); stroke-width: 2.5; }

.vart-sm { width: 38px; height: 38px; }
.vart-md { width: 56px; height: 56px; }
.vart-lg { width: 104px; height: 104px; }

.vart-tier { position: absolute; left: 2px; top: 1px; font: 700 9px 'JetBrains Mono', monospace; letter-spacing: 0.04em; color: rgba(230, 241, 255, 0.75); }
.vart-lvl { position: absolute; right: 3px; bottom: 1px; font: 700 10px 'JetBrains Mono', monospace; color: var(--vr-good); }
.vart-sm .vart-tier, .vart-sm .vart-lvl { font-size: 8px; }
</style>
