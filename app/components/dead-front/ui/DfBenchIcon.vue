<template>
    <svg
        v-if="name === 'scrap' || name === 'part'"
        class="df-bench-icon"
        viewBox="0 0 7 7"
        :width="size"
        :height="size"
        shape-rendering="crispEdges"
        aria-hidden="true"
    >
        <rect v-for="(px, k) in name === 'scrap' ? COG : VALVE" :key="k" :x="px[0]" :y="px[1]" :width="px[2]" height="1" />
    </svg>
    <svg v-else class="df-bench-icon" viewBox="0 0 64 64" :width="size" :height="size" aria-hidden="true">
        <!-- Lewis gun on a tripod: the fat cooling shroud, the pan drum on top -->
        <g v-if="name === 'sentry'">
            <rect x="12" y="21" width="30" height="10" rx="2.5" />
            <rect x="42" y="24" width="15" height="4" rx="1" />
            <rect x="56" y="22.5" width="3" height="7" rx="1" />
            <path d="M4 23h9v6l-9 5z" />
            <ellipse class="a" cx="27" cy="17" rx="12" ry="4" />
            <ellipse cx="27" cy="16" rx="3" ry="1.2" class="d" />
            <path d="M27 31h3l-1 6z" />
            <path class="leg" d="M28.5 35L14 58M28.5 35L43 58M28.5 35v23" />
        </g>
        <!-- gramophone: the flared horn, the turntable, the cabinet -->
        <g v-else-if="name === 'decoy'">
            <rect x="10" y="40" width="34" height="16" rx="2" />
            <rect x="13" y="44" width="28" height="2" class="d" />
            <ellipse class="a" cx="27" cy="39" rx="15" ry="3.2" />
            <path class="leg" d="M30 37l6-14" />
            <path d="M33 25l3-4c4-6 10-12 18-16 4 4 6 12 5 20-7-2-15-1-21 4z" />
            <ellipse class="a" cx="56.5" cy="14" rx="3" ry="9.5" transform="rotate(-40 56.5 14)" />
            <path class="note" d="M10 12v12M10 12l7-2v10" />
            <circle class="note-dot" cx="8" cy="24" r="2.4" />
            <circle class="note-dot" cx="15" cy="20" r="2.4" />
        </g>
        <!-- field kit: a canvas satchel with the red cross -->
        <g v-else-if="name === 'kit'">
            <path class="leg" d="M24 19v-5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v5" />
            <rect x="8" y="19" width="48" height="36" rx="6" />
            <rect x="8" y="27" width="48" height="3" class="d" />
            <path class="a" d="M28 33h8v6h6v8h-6v6h-8v-6h-6v-8h6z" />
        </g>
        <!-- artillery barrage: a brass-cased shell and its fuze -->
        <g v-else-if="name === 'barrage'">
            <path class="a" d="M32 4c6 5 9 12 9 19H23c0-7 3-14 9-19z" />
            <rect x="23" y="23" width="18" height="21" />
            <rect x="22" y="40" width="20" height="4" class="d" />
            <rect x="21" y="44" width="22" height="14" rx="1.5" class="b" />
            <rect x="19" y="56" width="26" height="3" rx="1" class="b" />
            <path class="spark" d="M10 14l4 3M54 14l-4 3M8 28h5M51 28h5" />
        </g>
        <!-- Zeppelin raid: the airship, its gondola and a stick of bombs -->
        <g v-else-if="name === 'zeppelin'">
            <ellipse cx="32" cy="22" rx="26" ry="10" />
            <path d="M6 22l-3-9h7l5 6zM6 22l-3 9h7l5-6z" />
            <path d="M14 20h40" class="d" />
            <rect x="26" y="31" width="12" height="5" rx="1.5" />
            <ellipse class="a" cx="24" cy="45" rx="2.6" ry="4" />
            <ellipse class="a" cx="32" cy="50" rx="2.6" ry="4" />
            <ellipse class="a" cx="40" cy="56" rx="2.6" ry="4" />
        </g>
        <!-- Granatwerfer: a stubby launcher and the grenade it lobs -->
        <g v-else-if="name === 'launcher'">
            <path d="M3 33l15-5v11L4 44c-1 .3-1.5-.3-1.5-1z" />
            <rect x="17" y="25" width="15" height="14" rx="1.5" />
            <rect x="31" y="22" width="27" height="12" rx="2.5" />
            <rect x="55" y="21" width="5" height="14" rx="1.5" class="d" />
            <path d="M22 39h7l-3 13h-6z" />
            <path class="leg" d="M29 41c3 3 3 6 0 7" />
            <circle class="a" cx="47" cy="49" r="7" />
            <rect class="a" x="44.5" y="39.5" width="5" height="3.5" rx="1" />
        </g>
        <!-- Bomber run: a Gotha biplane, two bombs under it -->
        <g v-else-if="name === 'bomber'">
            <path d="M4 27l48-3c3 0 6 2 7 4-1 2-4 4-7 4L4 31z" />
            <rect x="16" y="14" width="30" height="5" rx="2" />
            <rect x="13" y="34" width="36" height="5" rx="2" />
            <path class="leg" d="M22 19v15M40 19v15" />
            <path d="M3 18l7 9H4z" />
            <rect x="59" y="19" width="2.5" height="18" rx="1" class="d" />
            <ellipse class="a" cx="26" cy="49" rx="3" ry="5" />
            <ellipse class="a" cx="37" cy="54" rx="3" ry="5" />
        </g>
        <!-- weapon upgrade: stacked chevrons -->
        <g v-else-if="name === 'upgrade'">
            <path class="a" d="M32 6l22 18h-10L32 14 20 24H10z" />
            <path d="M32 22l22 18h-10L32 30 20 40H10z" />
            <path d="M32 38l22 18h-10L32 46 20 56H10z" opacity="0.55" />
        </g>
    </svg>
</template>

<script setup lang="ts">
// Hand-drawn icons for the workbench shop: one per recipe and the weapon
// upgrade, filled with the current colour and accented with `--df-icon-a`
// (the item's own colour); scrap and rare parts as the HUD's pixel runs.
import type { DfBenchPick } from '~/utils/dead-front/engine/arsenal-prompt'

withDefaults(defineProps<{ name: DfBenchPick | 'scrap' | 'part', size?: number }>(), { size: 48 })

type Runs = [number, number, number][]
const COG: Runs = [[2, 0, 3], [0, 1, 7], [1, 2, 2], [4, 2, 2], [0, 3, 2], [5, 3, 2], [1, 4, 2], [4, 4, 2], [0, 5, 7], [2, 6, 3]]
const VALVE: Runs = [[2, 0, 3], [3, 1, 1], [1, 2, 5], [1, 3, 5], [0, 4, 7], [1, 5, 5], [2, 6, 3]]
</script>

<style scoped>
.df-bench-icon {
    display: block;
    flex: none;
    fill: currentColor;
}

.a {
    fill: var(--df-icon-a, var(--df-brass));
}

.b {
    fill: var(--df-brass);
}

.d {
    fill: rgba(0, 0, 0, 0.45);
}

.leg,
.spark,
.note {
    fill: none;
    stroke: currentColor;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.spark {
    stroke: var(--df-icon-a, var(--df-brass));
    stroke-width: 2.5;
}

.note-dot {
    fill: currentColor;
}
</style>
