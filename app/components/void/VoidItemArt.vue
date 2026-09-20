<template>
    <div class="vart" :class="[`vart-${size}`, { 'vart-flat': flat }]" :style="{ '--c': color, '--r': rarityColor }">
        <svg viewBox="0 0 64 64" aria-hidden="true">
            <defs>
                <linearGradient :id="`${uid}M`" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" class="vart-m1" /><stop offset="1" class="vart-m3" />
                </linearGradient>
                <linearGradient :id="`${uid}A`" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" class="vart-a1" /><stop offset="0.45" class="vart-a2" /><stop offset="1" class="vart-a3" />
                </linearGradient>
                <radialGradient :id="`${uid}G`">
                    <stop offset="0" class="vart-hot" /><stop offset="0.4" class="vart-a1" /><stop offset="1" class="vart-fade" />
                </radialGradient>
            </defs>
            <g v-html="art" />
        </svg>
        <span v-if="tier" class="vart-tier">T{{ tier }}</span>
        <span v-if="level" class="vart-lvl">+{{ level }}</span>
    </div>
</template>

<script setup lang="ts">
import { voidHex } from '#shared/utils/gamelogic/void'
import { VOID_MODS, voidItemType } from '#shared/utils/gamelogic/void-items'
import { VOID_ITEM_ART, VOID_ITEM_ART_FALLBACK } from '~/utils/void/item-art'

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

const uid = useId()

/** Gradient ids are per instance: two icons sharing one would share its colours. */
const art = computed(() => (VOID_ITEM_ART[props.type] ?? VOID_ITEM_ART_FALLBACK).replaceAll('#~', `#${uid}`))
</script>

<style>
/*
 * One plate, one object. The markup lives in `utils/void/item-art.ts`; these
 * are its materials: gunmetal `m1`–`m4`, the item's colour `a1`–`a4`, and the
 * glowing bits.
 */
.vart {
    --m1: color-mix(in srgb, var(--c) 10%, #b4c0d4);
    --m2: color-mix(in srgb, var(--c) 12%, #66758f);
    --m3: color-mix(in srgb, var(--c) 10%, #2f3b50);
    --m4: #0d1522;
    --a1: color-mix(in srgb, var(--c) 50%, #fff);
    --a2: var(--c);
    --a3: color-mix(in srgb, var(--c) 58%, #0a101c);
    --a4: color-mix(in srgb, var(--c) 26%, #0a101c);
    position: relative; display: grid; place-items: center; flex-shrink: 0;
    background:
        radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--c) 24%, transparent), transparent 68%),
        linear-gradient(160deg, #111a2b, #060b15);
    border: 1px solid color-mix(in srgb, var(--r) 55%, transparent);
    border-radius: 6px;
    overflow: hidden;
}
.vart-flat { background: none; border: none; border-radius: 0; overflow: visible; }
.vart svg { width: 80%; height: 80%; overflow: visible; }
.vart-flat svg { width: 92%; height: 92%; }

.vart .m1 { fill: var(--m1); }
.vart .m2 { fill: var(--m2); }
.vart .m3 { fill: var(--m3); }
.vart .m4 { fill: var(--m4); }
.vart .a1 { fill: var(--a1); }
.vart .a2 { fill: var(--a2); }
.vart .a3 { fill: var(--a3); }
.vart .a4 { fill: var(--a4); }
.vart .g { fill: #fff; filter: drop-shadow(0 0 3px var(--c)); }
.vart .e { fill: var(--a1); filter: drop-shadow(0 0 2.5px var(--c)); }
.vart .gl { fill: color-mix(in srgb, var(--c) 24%, transparent); }
.vart .hl { fill: rgba(255, 255, 255, 0.28); }
.vart .sh { fill: rgba(2, 6, 14, 0.4); }
.vart .l, .vart .l2, .vart .l3, .vart .l4, .vart .l5, .vart .lw, .vart .ln, .vart .ln2, .vart .hs, .vart .o { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.vart .l { stroke: var(--c); stroke-width: 3; }
.vart .l2 { stroke: var(--a1); stroke-width: 1.7; }
.vart .l3 { stroke: var(--a1); stroke-width: 1; opacity: 0.7; }
.vart .l4 { stroke: var(--c); stroke-width: 6; stroke-linecap: butt; }
.vart .l5 { stroke: var(--a1); stroke-width: 5; filter: drop-shadow(0 0 3px var(--c)); }
.vart .lw { stroke: #fff; stroke-width: 2; filter: drop-shadow(0 0 2.5px var(--c)); }
.vart .ln { stroke: rgba(4, 9, 18, 0.75); stroke-width: 1.4; }
.vart .ln2 { stroke: var(--m2); stroke-width: 1.8; }
.vart .hs { stroke: rgba(255, 255, 255, 0.6); stroke-width: 1; }
.vart .o { stroke: color-mix(in srgb, var(--c) 60%, transparent); stroke-width: 2.5; }
.vart-m1 { stop-color: var(--m1); }
.vart-m3 { stop-color: var(--m3); }
.vart-a1 { stop-color: var(--a1); }
.vart-a2 { stop-color: var(--a2); }
.vart-a3 { stop-color: var(--a3); }
.vart-hot { stop-color: #fff; }
.vart-fade { stop-color: var(--c); stop-opacity: 0; }

.vart-sm { width: 38px; height: 38px; }
.vart-md { width: 56px; height: 56px; }
.vart-lg { width: 104px; height: 104px; border-radius: 10px; }

.vart-tier { position: absolute; left: 3px; top: 1px; font: 700 9px 'JetBrains Mono', monospace; letter-spacing: 0.04em; color: rgba(230, 241, 255, 0.85); text-shadow: 0 0 3px #000, 0 0 3px #000; }
.vart-lvl { position: absolute; right: 3px; bottom: 1px; font: 700 10px 'JetBrains Mono', monospace; color: var(--vr-good); text-shadow: 0 0 3px #000, 0 0 3px #000; }
.vart-sm .vart-tier, .vart-sm .vart-lvl { font-size: 8px; }
</style>
