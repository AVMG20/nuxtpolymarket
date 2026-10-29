<template>
    <svg
        class="df-sil"
        :class="`tone-${tone}`"
        viewBox="0 0 160 56"
        :width="width"
        :height="width * 56 / 160"
        aria-hidden="true"
    >
        <g fill-rule="evenodd">
            <path v-for="(p, i) in parts" :key="i" :d="p.d" :class="p.k" />
        </g>
    </svg>
</template>

<script setup lang="ts">
// Side-on silhouette of each 1900s weapon, muzzle to the right. Parts are
// tagged steel / wood / brass / glow so the same drawing works as a flat ink
// stencil on paper or as a coloured plate on the dark board.
import type { DfWeaponId } from '#shared/utils/dead-front/types'

const props = withDefaults(defineProps<{
    weapon: DfWeaponId
    width?: number
    tone?: 'ink' | 'color' | 'chalk'
}>(), { width: 160, tone: 'color' })

type Part = { d: string, k: 'steel' | 'wood' | 'brass' | 'glow' }

// Trigger guard: a U-shaped ring (even-odd hole) with the trigger inside.
const GUARD = (x: number, y: number) => `M${x} ${y}h14a7 7 0 0 1-14 0zM${x + 2.5} ${y}h9a4.5 4.5 0 0 1-9 0zM${x + 6} ${y}h2l-1 4.2h-1.4z`

const SHAPES: Record<DfWeaponId, Part[]> = {
    m1911: [
        { k: 'steel', d: 'M44 15h68a2 2 0 0 1 2 2v7a1 1 0 0 1-1 1H44zM40 13h5v6h-5z' },
        { k: 'steel', d: 'M50 25h32v4H50z' + GUARD(66, 29) },
        { k: 'wood', d: 'M48 27h15l-4 22c-.3 1.2-1.2 2-2.5 2H45c-1.4 0-2.3-1.2-2-2.5z' },
        { k: 'steel', d: 'M108 13h3v2h-3z' }
    ],
    c96: [
        { k: 'steel', d: 'M38 13h34v13H38zM34 10h6v6h-6z' },
        { k: 'steel', d: 'M72 16h56v5H72zM124 13h2v3h-2z' },
        { k: 'steel', d: 'M61 26h12v12H61z' + GUARD(46, 26) },
        { k: 'wood', d: 'M34 26h12c2.5 8 2 17-1.5 25h-12c3.5-8 4-17 1.5-25z' }
    ],
    m1897: [
        { k: 'wood', d: 'M4 25c0-2 1-3 3-3.5L40 16v13L9 37c-3 .8-5-.8-5-3z' },
        { k: 'steel', d: 'M40 14h24v15H40z' + GUARD(46, 29) },
        { k: 'steel', d: 'M64 16h84v4H64zM64 22h66v3H64z' },
        { k: 'wood', d: 'M78 20.5h24v8H78z' },
        { k: 'steel', d: 'M90 11h52v4H90zM94 12h2v2h-2zM100 12h2v2h-2zM106 12h2v2h-2zM112 12h2v2h-2zM118 12h2v2h-2zM124 12h2v2h-2zM130 12h2v2h-2zM136 12h2v2h-2z' },
        { k: 'steel', d: 'M140 21h14v2h-14z' }
    ],
    kar98k: [
        { k: 'wood', d: 'M3 27c0-2.5 1.5-4 4-4.5L34 18h76v7H44c-4 0-6 1-9 3L10 37c-3.5 1.2-7-.5-7-3.5z' },
        { k: 'steel', d: 'M36 15h34v5H36zM110 19h48v3h-48zM154 16h2v3h-2z' },
        { k: 'steel', d: 'M60 20l5 7.5 2.6-1.5-4.4-6z' },
        { k: 'steel', d: 'M64.5 28.5a2.4 2.4 0 1 0 0 .1z' },
        { k: 'steel', d: GUARD(44, 25) },
        { k: 'steel', d: 'M88 18h3v8h-3zM104 18h3v8h-3z' }
    ],
    thompson: [
        { k: 'wood', d: 'M4 22.5c0-1.5 1-2.5 2.5-2.6L32 18v11L9 35c-3 .8-5-.6-5-3z' },
        { k: 'steel', d: 'M32 15h46v12H32z' + GUARD(44, 27) },
        { k: 'wood', d: 'M34 27h10l-3 17c-.2 1-1 1.6-2 1.6h-7c-1 0-1.8-.9-1.6-2z' },
        { k: 'steel', d: 'M78 18h40v4H78z' },
        { k: 'steel', d: 'M112 15.5h12v9h-12zM114 15.5v9h1.2v-9zM117 15.5v9h1.2v-9zM120 15.5v9h1.2v-9z' },
        { k: 'wood', d: 'M86 22h9l1.4 17c.1 1-.7 1.8-1.7 1.8h-6c-1 0-1.7-.8-1.6-1.8z' },
        { k: 'steel', d: 'M69 37m-11 0a11 11 0 1 0 22 0a11 11 0 1 0-22 0zM69 37m-3 0a3 3 0 1 1 6 0a3 3 0 1 1-6 0z' }
    ],
    mp18: [
        { k: 'wood', d: 'M3 27c0-2 1.2-3.5 3.5-4L36 18h32v8H44c-3 0-5 .8-8 2.5L10 38c-3.5 1.2-7-.6-7-3.5z' },
        { k: 'steel', d: 'M36 15h32v9H36z' + GUARD(44, 25) },
        { k: 'steel', d: 'M68 13h54v11H68zM73 16h3v4h-3zM80 16h3v4h-3zM87 16h3v4h-3zM94 16h3v4h-3zM101 16h3v4h-3zM108 16h3v4h-3zM115 16h3v4h-3z' },
        { k: 'steel', d: 'M122 16.5h12v4h-12z' },
        { k: 'steel', d: 'M54 25m-7.5 0a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0-15 0zM54 25m-2 0a2 2 0 1 1 4 0a2 2 0 1 1-4 0z' }
    ],
    ppsh: [
        { k: 'wood', d: 'M4 19c0-1.5 1-2.4 2.5-2.5L44 15.5V25h32v4H45c-1.5 3.5-2.5 8-5 11.5c-1.6 2-4.6 1.6-5.6-.8c-.9-2.6-1.2-5.6-3.4-6.6L9 38c-3 .8-5-.6-5-3z' },
        { k: 'steel', d: 'M44 15h33v10H44zM80 12.5h5V15h-5z' + GUARD(45, 29) },
        { k: 'steel', d: 'M77 16.5h67l-6 8H77zM84 20.5a4.5 2 0 1 0 9 0a4.5 2 0 1 0-9 0zM98 20.5a4.5 2 0 1 0 9 0a4.5 2 0 1 0-9 0zM112 20.5a4.5 2 0 1 0 9 0a4.5 2 0 1 0-9 0zM126 20.5a4.5 2 0 1 0 9 0a4.5 2 0 1 0-9 0z' },
        { k: 'steel', d: 'M136 11h6v5.5h-1.2v-4.2h-3.6v4.2H136zM138.5 13.2h1v3.3h-1z' },
        { k: 'steel', d: 'M64 25h8v4h-8zM68 39m-10.5 0a10.5 10.5 0 1 0 21 0a10.5 10.5 0 1 0-21 0zM68 39m-2.5 0a2.5 2.5 0 1 1 5 0a2.5 2.5 0 1 1-5 0z' }
    ],
    bar: [
        { k: 'wood', d: 'M3 24c0-1.8 1.2-3 3-3.3L34 17v12L9 36c-3.2.9-6-.6-6-3.5z' },
        { k: 'steel', d: 'M34 15h48v12H34z' + GUARD(40, 27) },
        { k: 'steel', d: 'M54 27h15v13H54z' },
        { k: 'wood', d: 'M82 16.5h34v8H82z' },
        { k: 'steel', d: 'M116 18h36v4h-36zM148 16.5h9v7h-9z' },
        { k: 'steel', d: 'M120 22l-6 14h2l6-13zM126 22l6 14h-2l-6-13z' }
    ],
    lewis: [
        { k: 'wood', d: 'M3 25c0-1.8 1.2-3 3-3.3L34 18v12L9 37c-3.2.9-6-.6-6-3.5z' },
        { k: 'steel', d: 'M34 17h28v13H34z' + GUARD(38, 30) },
        { k: 'steel', d: 'M62 13h64v17H62zM126 15l11 3v9l-11 3z' },
        { k: 'steel', d: 'M137 19.5h16v4h-16z' },
        { k: 'steel', d: 'M34 7h42v6H34zM52 4h6v3h-6z' }
    ],
    xray: [
        { k: 'brass', d: 'M38 15h40c5 0 8 3 8 7.5S83 30 78 30H38c-2 0-3-1-3-3V18c0-2 1-3 3-3z' },
        { k: 'wood', d: 'M44 30h14l-5 19c-.3 1.2-1.2 2-2.5 2h-8c-1.4 0-2.3-1.2-2-2.5z' },
        { k: 'steel', d: GUARD(56, 30) },
        { k: 'brass', d: 'M86 19h32v7H86zM90 16h3v13h-3zM98 16h3v13h-3zM106 16h3v13h-3z' },
        { k: 'brass', d: 'M118 17l16-7v25l-16-7z' },
        { k: 'glow', d: 'M48 9h26a2 2 0 0 1 2 2v4H46v-4a2 2 0 0 1 2-2z' }
    ],
    webley: [
        { k: 'steel', d: 'M72 14h48v5H72zM116 11h3v3h-3zM52 12h22v4H52z' },
        { k: 'steel', d: 'M56 16h18v12H56zM60 18h2v8h-2zM66 18h2v8h-2z' },
        { k: 'brass', d: 'M54 18h2v8h-2z' },
        { k: 'steel', d: 'M48 27h28v4H48z' + GUARD(58, 31) },
        { k: 'steel', d: 'M45 9l6 3v5h-4z' },
        { k: 'wood', d: 'M45 27h12l-3 17c-.4 2-2 3-4 3h-6c-2 0-3-1.5-2.4-3.2z' },
        { k: 'steel', d: 'M43 48a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM44.3 48a1.2 1.2 0 1 1 2.4 0a1.2 1.2 0 1 1-2.4 0z' }
    ],
    sawnoff: [
        { k: 'wood', d: 'M4 25c0-2 1-3 3-3.5L44 16v12L9 37c-3 .8-5-.8-5-3z' },
        { k: 'steel', d: 'M44 14h22v14H44z' + GUARD(48, 28) },
        { k: 'steel', d: 'M56 8l4 6h-3l-3-5zM61 8l4 6h-3l-3-5z' },
        { k: 'steel', d: 'M66 13h68v5H66zM66 19h68v4H66z' },
        { k: 'wood', d: 'M70 23h30v5H70z' },
        { k: 'brass', d: 'M130 10.5h2.5v2.5H130z' }
    ],
    win1895: [
        { k: 'wood', d: 'M3 27c0-2.5 1.5-4 4-4.5L36 18h10v9H44c-4 0-6 1-9 3L10 37c-3.5 1.2-7-.5-7-3.5z' },
        { k: 'steel', d: 'M46 14h22v14H46zM44 10h3v5h-3z' },
        { k: 'steel', d: 'M60 28h8v6h-8z' },
        { k: 'steel', d: 'M46 28h2v9h-2zM46 36h13v2H46zM57 31h2v7h-2z' },
        { k: 'wood', d: 'M68 19h44v6H68z' },
        { k: 'steel', d: 'M68 16h88v3H68zM100 13h3v3h-3zM152 13h2v3h-2zM88 19h3v6h-3z' }
    ],
    chauchat: [
        { k: 'wood', d: 'M3 24c0-1.8 1.2-3 3-3.3L36 16v13L9 36c-3.2.9-6-.6-6-3.5z' },
        { k: 'steel', d: 'M36 13h30v15H36zM56 9h3v4h-3z' + GUARD(40, 28) },
        { k: 'wood', d: 'M37 28h8l-2 13h-7z' },
        { k: 'steel', d: 'M54 28h9c0 9-3 16-10 21l-6-3c5-4 8-10 7-18z' },
        { k: 'steel', d: 'M66 16h60v7H66zM100 14h1.5v11H100zM104 14h1.5v11H104zM108 14h1.5v11H108zM112 14h1.5v11H112zM116 14h1.5v11H116z' },
        { k: 'wood', d: 'M80 23h5v12h-5z' },
        { k: 'steel', d: 'M126 15l12-2.5v14l-12-2.5zM128 8h2v7h-2z' }
    ],
    flammen: [
        { k: 'steel', d: 'M4 21c-3 6-3 14-1 22h4c-2-8-2-15 1-21z' },
        { k: 'wood', d: 'M13 27h8l-3 14h-7z' },
        { k: 'brass', d: 'M20 13h16v16H20zM24 6h8v3h-8z' },
        { k: 'steel', d: 'M36 19h98v4H36zM78 23h6v13h-6z' },
        { k: 'wood', d: 'M78 24h6v12h-6z' },
        { k: 'steel', d: 'M88 24h28v8H88z' },
        { k: 'brass', d: 'M134 17h10v8h-10zM84 25h4v6h-4z' },
        { k: 'brass', d: 'M140 27h6v2.5h-6z' }
    ],
    granatwerfer: [
        { k: 'wood', d: 'M3 24c0-1.8 1.2-3 3-3.3L32 16v14L9 36c-3.2.9-6-.6-6-3.5z' },
        { k: 'steel', d: 'M32 14h28v16H32z' + GUARD(38, 30) },
        { k: 'steel', d: 'M44 30m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0z' },
        { k: 'steel', d: 'M60 15h70v12H60z' },
        { k: 'brass', d: 'M128 13h8v16h-8zM70 13h3v16h-3z' },
        { k: 'wood', d: 'M86 27h8v10h-8z' }
    ],
    wunder: [
        { k: 'wood', d: 'M3 25c0-1.8 1.2-3 3-3.3L34 17v13L9 37c-3.2.9-6-.6-6-3.5z' },
        { k: 'steel', d: 'M34 14h40v16H34z' + GUARD(40, 30) },
        { k: 'steel', d: 'M74 19.5h50v4H74z' },
        { k: 'brass', d: 'M80 15h4v13h-4zM88 15h4v13h-4zM96 15h4v13h-4zM104 15h4v13h-4zM112 15h4v13h-4z' },
        { k: 'steel', d: 'M124 12h3v19h-3zM124 12h22v3h-22zM124 28h22v3h-22z' },
        { k: 'glow', d: 'M54 10m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0z' },
        { k: 'glow', d: 'M134 21.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z' }
    ]
}

const parts = computed(() => SHAPES[props.weapon] ?? SHAPES.m1911)
</script>

<style scoped>
.df-sil {
    display: block;
    overflow: visible;
}

.tone-color .steel { fill: #4b5352; }
.tone-color .wood { fill: #6e4426; }
.tone-color .brass { fill: #b98e3a; }
.tone-color .glow { fill: #8ef2a4; filter: drop-shadow(0 0 3px #4ee07a); }

.tone-color {
    filter: drop-shadow(0 1px 0 rgba(255, 240, 200, 0.12)) drop-shadow(0 3px 4px rgba(0, 0, 0, 0.7));
}

.tone-ink path {
    fill: currentColor;
}

.tone-ink .wood {
    opacity: 0.78;
}

.tone-ink .glow {
    opacity: 0.6;
}

.tone-chalk path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linejoin: round;
}
</style>
