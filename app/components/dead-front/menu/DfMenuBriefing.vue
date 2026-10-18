<template>
    <div class="space-y-7">
    <DfMenuHowTo />
    <div class="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <!-- trench map -->
        <section class="df-map df-paper self-start">
            <div class="flex items-baseline justify-between gap-3">
                <div>
                    <p class="df-eyebrow">Trench map · sheet 62D · secret</p>
                    <h2 class="df-h mt-1 text-2xl">Sainte-Croix</h2>
                </div>
                <span class="df-stamp" style="--df-tilt: 7deg">Corrected to 17.X.17</span>
            </div>
            <svg class="df-map-svg mt-3" viewBox="0 0 420 300" role="img" aria-label="Sketch map of Sainte-Croix: the chapel, the farmhouse, the trenches and the approaches of the dead">
                <defs>
                    <pattern :id="`${uid}-grid`" width="70" height="60" patternUnits="userSpaceOnUse">
                        <path d="M70 0H0V60" fill="none" stroke="rgba(60,80,120,0.35)" stroke-width="0.8" />
                    </pattern>
                    <marker :id="`${uid}-arrow`" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M0 0L10 5L0 10z" fill="#9c1c12" />
                    </marker>
                </defs>
                <rect width="420" height="300" :fill="`url(#${uid}-grid)`" />
                <g class="coords">
                    <text v-for="(c, i) in 'ABCDEF'" :key="c" :x="35 + i * 70" y="10" text-anchor="middle">{{ c }}</text>
                    <text v-for="n in 5" :key="n" x="5" :y="34 + (n - 1) * 60">{{ n }}</text>
                </g>
                <!-- contours -->
                <g class="contour">
                    <path d="M-10 230C60 200 120 250 200 225S330 190 430 215" />
                    <path d="M-10 255C70 228 130 275 210 250S340 220 430 240" />
                    <path d="M260 40C300 20 360 30 400 60S430 120 400 130" />
                </g>
                <!-- road -->
                <path class="road" d="M-10 150C80 140 140 160 210 150S330 130 430 140" />
                <path class="road thin" d="M200 152C204 190 196 230 210 310" />
                <!-- buildings -->
                <g class="bldg">
                    <!-- chapel: a cross plan -->
                    <path class="draw" d="M150 88h40v-18h20v18h40v20h-40v40h-20v-40h-40z" />
                    <text x="200" y="64" text-anchor="middle" class="lbl">Chapel</text>
                    <!-- farmhouse -->
                    <path class="draw" d="M268 170h70v42h-70zM268 190h70M303 170v42" style="animation-delay: .25s" />
                    <text x="303" y="230" text-anchor="middle" class="lbl">Farmhouse</text>
                    <!-- ruins -->
                    <path class="draw ruin" d="M92 180h26v18h-26zM104 180v-6" style="animation-delay: .4s" />
                </g>
                <!-- trenches: firing line zig-zag and communication trench -->
                <path class="trench draw" d="M20 268l14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10 14 10 14-10" style="animation-delay: .5s" />
                <path class="trench thin draw" d="M190 262C192 240 186 220 200 200" style="animation-delay: .7s" />
                <!-- wire -->
                <g class="wire">
                    <path v-for="x in wire" :key="x" :d="`M${x - 3} 285l6 6M${x + 3} 285l-6 6`" />
                </g>
                <!-- the dead come in -->
                <g class="approach">
                    <path :marker-end="`url(#${uid}-arrow)`" d="M30 296C60 240 100 210 140 190" />
                    <path :marker-end="`url(#${uid}-arrow)`" d="M410 296C380 250 360 230 342 214" />
                    <path :marker-end="`url(#${uid}-arrow)`" d="M10 40C60 60 100 80 146 92" />
                </g>
                <!-- power -->
                <g class="mark" transform="translate(330 186)">
                    <path d="M3-9L-4 1h5l-2 9 7-11h-5z" />
                </g>
                <text x="346" y="168" class="lbl red">Power</text>
                <!-- compass -->
                <g transform="translate(380 40)" class="compass">
                    <circle r="16" />
                    <path d="M0-14L4 0L0 14L-4 0z" />
                    <text y="-19" text-anchor="middle">N</text>
                </g>
            </svg>
            <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs df-type text-[var(--df-ink-2)]">
                <span><i class="df-legend red" /> Approaches of the dead</span>
                <span><i class="df-legend trench" /> Firing line</span>
                <span><i class="df-legend wire" /> Wire</span>
            </div>
        </section>

        <!-- field manual -->
        <section class="df-manual df-paper">
            <p class="df-eyebrow">Field service pocket book · Chapter XVII</p>
            <h2 class="df-h mt-1 text-2xl">Orders for the night</h2>
            <ol class="mt-4 space-y-3">
                <li v-for="(s, i) in steps" :key="s.title" class="df-order df-rise" :style="{ animationDelay: `${120 + i * 60}ms` }">
                    <span class="df-order-no">{{ toRoman(i + 1) }}.</span>
                    <div>
                        <p class="df-order-title">{{ s.title }}</p>
                        <p class="text-[0.9rem] leading-snug text-[var(--df-ink-2)]">{{ s.text }}</p>
                    </div>
                </li>
            </ol>

            <div class="df-rule mt-6 text-[var(--df-ink)]" />
            <h3 class="df-h mt-5 text-lg">Drill</h3>
            <dl class="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                <div v-for="c in controls" :key="c.what" class="flex items-center gap-3">
                    <dt class="flex shrink-0 gap-1">
                        <kbd v-for="k in c.keys" :key="k" class="df-key" :class="{ 'df-key--wide': k.length > 2 }">{{ k }}</kbd>
                    </dt>
                    <dd class="text-[0.88rem] leading-tight">{{ c.what }}</dd>
                </div>
            </dl>
        </section>
    </div>
    </div>
</template>

<script setup lang="ts">
import DfMenuHowTo from './DfMenuHowTo.vue'

const uid = `dfm-${useId()}`
const wire = Array.from({ length: 26 }, (_, i) => 18 + i * 15.5)

const controls = [
    { keys: ['W', 'A', 'S', 'D'], what: 'Move' },
    { keys: ['Shift'], what: 'Sprint' },
    { keys: ['Space'], what: 'Jump' },
    { keys: ['C'], what: 'Crouch' },
    { keys: ['LMB'], what: 'Fire' },
    { keys: ['RMB'], what: 'Aim down sights' },
    { keys: ['R'], what: 'Reload' },
    { keys: ['1', '2', '3'], what: 'Swap weapon (or wheel)' },
    { keys: ['V'], what: 'Knife' },
    { keys: ['G'], what: 'Grenade' },
    { keys: ['F'], what: 'Use · hold to rebuild or revive' },
    { keys: ['Tab'], what: 'Scoreboard' },
    { keys: ['Esc'], what: 'Pause' }
]

const steps = [
    { title: 'Earn points', text: 'Every hit pays 10, kills pay more, headshots and the knife most. Rebuild boards at the windows for extra.' },
    { title: 'Open the way', text: 'Spend points on doors and debris to reach the rest of Sainte-Croix and the weapons on its walls.' },
    { title: 'Restore the power', text: 'Find the switch. Power wakes the perk machines and the Pack-a-Punch.' },
    { title: 'Drink perks', text: 'Up to four bottles at once. Go down and you lose them. Your researched prescriptions apply to every bottle.' },
    { title: 'Try the box', text: '950 points for a random weapon, the X-Ray among them. It moves after a few pulls.' },
    { title: 'Pack-a-Punch', text: 'Three tiers: 5,000 points, then 2,500 each. More damage, deeper magazines, new names.' },
    { title: 'Follow the telegram', text: 'The objective tracker leads you through the Arc Generator to the wonder weapon.' }
]

function toRoman(n: number): string {
    return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n - 1] ?? String(n)
}
</script>

<style scoped>
.df-map,
.df-manual {
    padding: 1.3rem 1.3rem 1.4rem;
}

.df-manual {
    background:
        repeating-linear-gradient(180deg, transparent 0 27px, rgba(60, 80, 120, 0.12) 27px 28px),
        var(--df-fibre),
        linear-gradient(170deg, #e8dbb8, #d6c59a);
}

.df-map-svg {
    display: block;
    width: 100%;
    height: auto;
    background: rgba(255, 252, 238, 0.35);
    box-shadow: inset 0 0 0 1px rgba(60, 40, 15, 0.35);
}

.coords text {
    font-family: var(--df-font-type);
    font-size: 9px;
    fill: rgba(60, 80, 120, 0.75);
}

.contour path {
    fill: none;
    stroke: rgba(140, 90, 40, 0.38);
    stroke-width: 1;
}

.road {
    fill: none;
    stroke: rgba(60, 40, 15, 0.45);
    stroke-width: 5;
    stroke-linecap: round;
}

.road.thin {
    stroke-width: 2.5;
    stroke-dasharray: 6 4;
}

.bldg path {
    fill: rgba(60, 40, 15, 0.12);
    stroke: #2a1d0c;
    stroke-width: 1.6;
}

.bldg .ruin {
    stroke-dasharray: 5 3;
}

.lbl {
    font-family: var(--df-font-sc);
    font-size: 12px;
    fill: #2a1d0c;
}

.lbl.red {
    fill: #9c1c12;
    font-size: 11px;
}

.trench {
    fill: none;
    stroke: #3b4a6a;
    stroke-width: 2.2;
    stroke-linejoin: miter;
}

.trench.thin {
    stroke-width: 1.4;
    stroke-dasharray: 3 2;
}

.wire path {
    stroke: #2a1d0c;
    stroke-width: 1;
}

.approach path {
    fill: none;
    stroke: #9c1c12;
    stroke-width: 2.4;
    stroke-dasharray: 7 5;
    animation: df-march 1.6s linear infinite;
}

.mark path {
    fill: #9c1c12;
}

.compass circle {
    fill: none;
    stroke: #2a1d0c;
    stroke-width: 0.8;
}

.compass path {
    fill: #2a1d0c;
}

.compass text {
    font-family: var(--df-font-sc);
    font-size: 10px;
    fill: #2a1d0c;
}

.draw {
    stroke-dasharray: 700;
    stroke-dashoffset: 700;
    animation: df-pen 1.6s cubic-bezier(0.5, 0, 0.3, 1) forwards;
}

.df-legend {
    display: inline-block;
    width: 18px;
    height: 0;
    margin-right: 0.35rem;
    vertical-align: middle;
    border-top: 2px dashed #9c1c12;
}

.df-legend.trench {
    border-top: 2px solid #3b4a6a;
}

.df-legend.wire {
    border-top: 2px dotted #2a1d0c;
}

.df-order {
    display: flex;
    gap: 0.75rem;
}

.df-order-no {
    width: 2.2rem;
    flex-shrink: 0;
    text-align: right;
    font-family: var(--df-font-serif);
    font-size: 1.15rem;
    line-height: 1.2;
    color: var(--df-blood);
}

.df-order-title {
    font-family: var(--df-font-stencil);
    font-size: 0.95rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--df-ink);
}

@keyframes df-pen {
    to { stroke-dashoffset: 0; }
}

@keyframes df-march {
    to { stroke-dashoffset: -24; }
}
</style>
