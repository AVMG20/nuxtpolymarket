<script setup lang="ts">
// Polytown's reward chests, drawn by hand: wooden planks with iron bands,
// brushed silver with steel-blue straps, and gold with crimson straps and gem
// inlays. The lid is its own layer so the chest opening can swing it open; in
// `stage` mode the chest also gets the inside of the lid, a heap of loot, the
// glow leaking from the seam (`--leak`, 0 to 1) and cracks (`--crack`).
import type { TownStreakChest } from '#shared/utils/gamelogic/town-streak'

const props = withDefaults(defineProps<{
    tier: TownStreakChest
    /** Width in px; the chest is 120:110. */
    size?: number
    /** Draw the opening layers (inner lid, loot, glow, cracks). */
    stage?: boolean
    open?: boolean
}>(), { size: 48, stage: false, open: false })

interface Look {
    ink: string
    body: [string, string, string]
    band: [string, string]
    trim: string
    rivet: string
    lock: [string, string]
    inside: [string, string]
    glow: string
}

const LOOKS: Record<TownStreakChest, Look> = {
    wooden: {
        ink: '#2a1608',
        body: ['#d39556', '#a8672f', '#74401a'],
        band: ['#7b8491', '#3d434c'],
        trim: '#4a515b',
        rivet: '#e3e7ec',
        lock: ['#ffe08a', '#c48a0e'],
        inside: ['#4a250d', '#2a1406'],
        glow: '#ffd76a'
    },
    silver: {
        ink: '#18202e',
        body: ['#ffffff', '#c3cdd8', '#7f8c9c'],
        band: ['#5874a0', '#253655'],
        trim: '#dfe7f1',
        rivet: '#f4f8fc',
        lock: ['#f6f9fc', '#9fb0c4'],
        inside: ['#24324c', '#121a2b'],
        glow: '#c4e6ff'
    },
    golden: {
        ink: '#3a2000',
        body: ['#fff1a8', '#f7bd1b', '#b77400'],
        band: ['#c42a46', '#6c0d22'],
        trim: '#ffe27a',
        rivet: '#fff6cf',
        lock: ['#fff6c9', '#e0a106'],
        inside: ['#6d0f27', '#3a0614'],
        glow: '#fff1a6'
    }
}

const look = computed(() => LOOKS[props.tier])
const uid = useId()
const id = (name: string) => `tca-${uid}-${name}`
const url = (name: string) => `url(#${id(name)})`

const BODY = 'M12 54H108V96Q108 104 100 104H20Q12 104 12 96Z'
const LID = 'M10 57V38C10 25 32 17 60 17C88 17 110 25 110 38V57Z'
const BACK = 'M17 58L21 10C36 2 84 2 99 10L103 58Z'
const LOOT = 'M20 58Q24 46 36 46Q42 38 52 41Q60 33 70 39Q80 36 86 44Q97 45 100 58Z'
</script>

<template>
    <span
        class="tca"
        :class="[`tier-${tier}`, { 'is-stage': stage, 'is-open': open }]"
        :style="{ '--tca-w': `${size}px`, '--tca-glow': look.glow }"
    >
        <svg width="0" height="0" class="tca-defs" aria-hidden="true">
            <defs>
                <linearGradient :id="id('body')" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" :stop-color="look.body[0]" />
                    <stop offset=".45" :stop-color="look.body[1]" />
                    <stop offset="1" :stop-color="look.body[2]" />
                </linearGradient>
                <linearGradient :id="id('band')" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" :stop-color="look.band[0]" />
                    <stop offset=".55" :stop-color="look.band[0]" />
                    <stop offset="1" :stop-color="look.band[1]" />
                </linearGradient>
                <linearGradient :id="id('bandH')" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" :stop-color="look.band[0]" />
                    <stop offset="1" :stop-color="look.band[1]" />
                </linearGradient>
                <linearGradient :id="id('lock')" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" :stop-color="look.lock[0]" />
                    <stop offset="1" :stop-color="look.lock[1]" />
                </linearGradient>
                <linearGradient :id="id('inside')" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" :stop-color="look.inside[0]" />
                    <stop offset="1" :stop-color="look.inside[1]" />
                </linearGradient>
                <linearGradient :id="id('loot')" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#fff7c2" />
                    <stop offset=".5" stop-color="#ffcf33" />
                    <stop offset="1" stop-color="#c98a00" />
                </linearGradient>
                <radialGradient :id="id('rivet')" cx=".35" cy=".35" r=".7">
                    <stop offset="0" stop-color="#fff" />
                    <stop offset="1" :stop-color="look.rivet" />
                </radialGradient>
                <linearGradient :id="id('shine')" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stop-color="#fff" stop-opacity="0" />
                    <stop offset=".5" stop-color="#fff" stop-opacity=".75" />
                    <stop offset="1" stop-color="#fff" stop-opacity="0" />
                </linearGradient>
                <pattern :id="id('brush')" width="6" height="2.4" patternUnits="userSpaceOnUse">
                    <rect width="6" height=".8" fill="#fff" fill-opacity=".22" />
                </pattern>
                <clipPath :id="id('clipBody')"><path :d="BODY" /></clipPath>
                <clipPath :id="id('clipLid')"><path :d="LID" /></clipPath>
            </defs>
        </svg>

        <!-- Behind the chest: the light pouring out once it is open. -->
        <span v-if="stage" class="tca-glow" />

        <!-- The inside of the lid, standing open, and the loot heaped inside. -->
        <svg v-if="stage" class="tca-layer tca-back" viewBox="0 0 120 110" aria-hidden="true">
            <path :d="BACK" :fill="url('inside')" :stroke="look.ink" stroke-width="3" stroke-linejoin="round" />
            <path d="M23 54L26 14C40 7 80 7 94 14L97 54" fill="none" :stroke="look.trim" stroke-opacity=".55" stroke-width="2.4" />
            <rect x="27" y="6" width="10" height="52" :fill="url('band')" fill-opacity=".8" />
            <rect x="83" y="6" width="10" height="52" :fill="url('band')" fill-opacity=".8" />
            <path :d="BACK" fill="none" :stroke="look.ink" stroke-width="3" stroke-linejoin="round" />
            <path :d="LOOT" :fill="url('loot')" :stroke="look.ink" stroke-width="2.4" stroke-linejoin="round" />
            <g :stroke="look.ink" stroke-width="1.4">
                <ellipse cx="38" cy="50" rx="5" ry="2.2" fill="#ffe27a" />
                <ellipse cx="66" cy="44" rx="5" ry="2.2" fill="#ffe27a" />
                <ellipse cx="84" cy="51" rx="5" ry="2.2" fill="#ffe27a" />
                <path d="M50 46L54 42L58 46L54 51Z" fill="#5ad1ff" />
                <path v-if="tier !== 'wooden'" d="M74 49L77.5 45.5L81 49L77.5 53Z" fill="#ff5a7a" />
                <path v-if="tier === 'golden'" d="M28 52L31 49L34 52L31 56Z" fill="#4ef08f" />
            </g>
        </svg>

        <!-- Body -->
        <svg class="tca-layer tca-body" viewBox="0 0 120 110" aria-hidden="true">
            <path :d="BODY" :fill="url('body')" />
            <g :clip-path="url('clipBody')">
                <template v-if="tier === 'wooden'">
                    <path d="M12 70H108M12 87H108" :stroke="look.ink" stroke-opacity=".45" stroke-width="1.6" />
                    <path d="M14 63C24 61 30 64 40 62S58 60 70 63M44 78C56 76 64 79 80 77S96 76 106 78M16 95C26 93 34 96 46 94M66 96C76 94 88 97 104 95" fill="none" :stroke="look.ink" stroke-opacity=".18" stroke-width="1" />
                    <path d="M12 71H108M12 88H108" stroke="#fff" stroke-opacity=".16" stroke-width="1" />
                </template>
                <rect v-else x="0" y="50" width="120" height="60" :fill="url('brush')" />
                <rect x="0" y="94" width="120" height="14" fill="#000" fill-opacity=".16" />
                <rect x="0" y="56" width="120" height="5" fill="#fff" fill-opacity=".18" />
                <!-- Rim, seen once the lid is off. -->
                <rect x="10" y="51" width="100" height="8" :fill="url('bandH')" :stroke="look.ink" stroke-width="1.5" />
                <!-- Straps -->
                <rect x="24" y="40" width="11" height="70" :fill="url('band')" :stroke="look.ink" stroke-width="1.6" />
                <rect x="85" y="40" width="11" height="70" :fill="url('band')" :stroke="look.ink" stroke-width="1.6" />
                <template v-if="tier === 'golden'">
                    <path d="M25.8 40V110M33.2 40V110M86.8 40V110M94.2 40V110" :stroke="look.trim" stroke-width="1.2" />
                </template>
                <!-- A sweep of light across polished metal. -->
                <g v-if="tier !== 'wooden'" class="tca-shine">
                    <rect x="-40" y="0" width="26" height="130" :fill="url('shine')" transform="skewX(-20)" />
                </g>
                <path
                    v-if="stage"
                    class="tca-crack"
                    d="M40 60L46 70L42 78L48 88M76 59L72 68L79 75L74 86M58 82L62 92L57 100M18 64L22 72M100 66L97 76"
                    fill="none"
                    :stroke="look.glow"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </g>
            <!-- Corner caps -->
            <g :fill="url('bandH')" :stroke="look.ink" stroke-width="1.6" stroke-linejoin="round">
                <path d="M12 88V96Q12 104 20 104H26V97.5H18.5V88Z" />
                <path d="M108 88V96Q108 104 100 104H94V97.5H101.5V88Z" />
            </g>
            <g :fill="url('rivet')" :stroke="look.ink" stroke-width="1">
                <circle cx="29.5" cy="66" r="2.3" />
                <circle cx="29.5" cy="82" r="2.3" />
                <circle cx="90.5" cy="66" r="2.3" />
                <circle cx="90.5" cy="82" r="2.3" />
            </g>
            <template v-if="tier === 'golden'">
                <g :stroke="look.ink" stroke-width="1.2">
                    <path d="M29.5 92L33 95.5L29.5 99L26 95.5Z" fill="#5ad1ff" />
                    <path d="M90.5 92L94 95.5L90.5 99L87 95.5Z" fill="#4ef08f" />
                </g>
            </template>
            <!-- Lock plate -->
            <path d="M49 56H71V70Q71 78 60 83Q49 78 49 70Z" :fill="url('lock')" :stroke="look.ink" stroke-width="2" stroke-linejoin="round" />
            <path d="M52 59H68" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" />
            <template v-if="tier === 'golden'">
                <path d="M60 62L65.5 68L60 76L54.5 68Z" fill="#ff4d6d" :stroke="look.ink" stroke-width="1.4" stroke-linejoin="round" />
                <path d="M57.5 66.5L60 64L62 66.5" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.1" />
            </template>
            <template v-else>
                <circle cx="60" cy="66" r="3.2" :fill="look.ink" />
                <path d="M58.7 67H61.3L62 74H58Z" :fill="look.ink" />
            </template>
            <path :d="BODY" fill="none" :stroke="look.ink" stroke-width="3" stroke-linejoin="round" />
        </svg>

        <!-- Lid -->
        <svg class="tca-layer tca-lid" viewBox="0 0 120 110" aria-hidden="true">
            <path :d="LID" :fill="url('body')" />
            <g :clip-path="url('clipLid')">
                <template v-if="tier === 'wooden'">
                    <path d="M10 46C10 35 32 28 60 28C88 28 110 35 110 46M10 55C10 44 32 38 60 38C88 38 110 44 110 55" fill="none" :stroke="look.ink" stroke-opacity=".4" stroke-width="1.6" />
                    <path d="M18 34C30 30 40 31 50 29M70 30C82 31 92 33 102 37" fill="none" :stroke="look.ink" stroke-opacity=".18" stroke-width="1" />
                </template>
                <rect v-else x="0" y="10" width="120" height="50" :fill="url('brush')" />
                <path d="M14 34C20 25 38 21 60 21C82 21 100 25 106 34" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2.4" stroke-linecap="round" />
                <rect x="24" y="0" width="11" height="60" :fill="url('band')" :stroke="look.ink" stroke-width="1.6" />
                <rect x="85" y="0" width="11" height="60" :fill="url('band')" :stroke="look.ink" stroke-width="1.6" />
                <template v-if="tier === 'golden'">
                    <path d="M25.8 0V60M33.2 0V60M86.8 0V60M94.2 0V60" :stroke="look.trim" stroke-width="1.2" />
                </template>
                <g v-if="tier !== 'wooden'" class="tca-shine">
                    <rect x="-40" y="0" width="26" height="130" :fill="url('shine')" transform="skewX(-20)" />
                </g>
                <!-- Lip -->
                <rect x="8" y="50" width="104" height="8" :fill="url('bandH')" :stroke="look.ink" stroke-width="1.6" />
            </g>
            <g :fill="url('rivet')" :stroke="look.ink" stroke-width="1">
                <circle cx="29.5" cy="31" r="2.3" />
                <circle cx="90.5" cy="31" r="2.3" />
                <circle cx="29.5" cy="43" r="2.3" />
                <circle cx="90.5" cy="43" r="2.3" />
            </g>
            <template v-if="tier === 'golden'">
                <g :stroke="look.ink" stroke-width="1.4" stroke-linejoin="round">
                    <ellipse cx="60" cy="31" rx="7" ry="5" fill="#ff4d6d" />
                    <path d="M56 29.5Q59 27 62 28" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.2" />
                    <path d="M44 33.5L47 30.5L50 33.5L47 36.5Z" fill="#5ad1ff" />
                    <path d="M70 33.5L73 30.5L76 33.5L73 36.5Z" fill="#4ef08f" />
                </g>
            </template>
            <ellipse v-else-if="tier === 'silver'" cx="60" cy="31" rx="5" ry="3.6" fill="#4d9bff" :stroke="look.ink" stroke-width="1.4" />
            <!-- Hasp -->
            <rect x="54" y="45" width="12" height="14" rx="2.6" :fill="url('lock')" :stroke="look.ink" stroke-width="1.8" />
            <path :d="LID" fill="none" :stroke="look.ink" stroke-width="3" stroke-linejoin="round" />
        </svg>

        <!-- Light escaping through the seam as the lock strains. -->
        <span v-if="stage" class="tca-leak" />
    </span>
</template>

<style scoped>
.tca {
    position: relative;
    display: inline-block;
    flex-shrink: 0;
    width: var(--tca-w);
    height: calc(var(--tca-w) * 110 / 120);
    --leak: 0;
    --crack: 0;
}
.tca-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.tca-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
}
.tca.tier-golden { filter: drop-shadow(0 0 calc(var(--tca-w) * 0.08) rgba(255, 200, 60, 0.5)); }

/* The lid hinges on the seam; the inside of the lid stands up from just behind it. */
.tca-lid { transform-origin: 50% 52%; }
.tca-back { transform-origin: 50% 53%; opacity: 0; transform: scaleY(0); }
.tca.is-open .tca-lid { opacity: 0; transform: translateY(-34%) scaleY(0); }
.tca.is-open .tca-back { opacity: 1; transform: none; }
/* Opening: the lid tips back off the seam and its inside swings up past upright, then settles. */
.tca.is-stage.is-open .tca-lid { animation: tca-lid-off 0.32s cubic-bezier(.3, .6, .5, 1) both; }
.tca.is-stage.is-open .tca-back { animation: tca-back-in 0.7s cubic-bezier(.2, .9, .3, 1) both; }
@keyframes tca-lid-off {
    0% { opacity: 1; transform: none; }
    45% { opacity: 1; transform: translateY(-14%) scaleY(0.55); }
    100% { opacity: 0; transform: translateY(-34%) scaleY(0); }
}
@keyframes tca-back-in {
    0% { opacity: 0; transform: scaleY(0); }
    20% { opacity: 1; transform: scaleY(0.2); }
    55% { opacity: 1; transform: scaleY(1.22) skewX(-3deg); }
    75% { transform: scaleY(0.92) skewX(1deg); }
    90% { transform: scaleY(1.04); }
    100% { opacity: 1; transform: none; }
}

.tca-crack { opacity: var(--crack); filter: drop-shadow(0 0 2px var(--tca-glow)); }

.tca-leak {
    position: absolute;
    left: -6%;
    right: -6%;
    top: 44%;
    height: 14%;
    border-radius: 50%;
    background: radial-gradient(ellipse at center, #fff 0%, var(--tca-glow) 30%, color-mix(in srgb, var(--tca-glow) 0%, transparent) 70%);
    opacity: var(--leak);
    mix-blend-mode: screen;
    pointer-events: none;
}
.tca-glow {
    position: absolute;
    left: 50%;
    top: 40%;
    width: 170%;
    height: 150%;
    transform: translate(-50%, -50%) scale(0.4);
    border-radius: 50%;
    background: radial-gradient(circle, #fff 0%, var(--tca-glow) 22%, color-mix(in srgb, var(--tca-glow) 0%, transparent) 62%);
    opacity: 0;
    pointer-events: none;
}
.tca.is-open .tca-glow { opacity: 0.95; transform: translate(-50%, -50%) scale(1); transition: opacity 0.3s ease, transform 0.7s cubic-bezier(.2, 1.4, .4, 1); }

/* A sweep of light now and then across silver and gold. */
.tca-shine { animation: tca-shine 3.6s ease-in-out infinite; }
.tca.tier-golden .tca-shine { animation-duration: 2.8s; }
@keyframes tca-shine {
    0%, 55% { transform: translateX(0); }
    100% { transform: translateX(190px); }
}
@media (prefers-reduced-motion: reduce) {
    .tca-shine { animation: none; display: none; }
    .tca.is-stage.is-open .tca-lid,
    .tca.is-stage.is-open .tca-back { animation: none; }
}
</style>
