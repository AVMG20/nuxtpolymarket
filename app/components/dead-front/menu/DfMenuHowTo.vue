<template>
    <section class="df-howto df-board-dark" aria-labelledby="df-howto-title">
        <header class="flex flex-wrap items-start justify-between gap-3">
            <div>
                <p class="df-eyebrow">First night at the front</p>
                <h2 id="df-howto-title" class="df-h mt-1 text-2xl text-[var(--df-chalk)]">How to play</h2>
            </div>
            <DfButton v-if="dismissable" tone="ghost" size="sm" icon="x" @click="emit('dismiss')">Got it</DfButton>
        </header>

        <ol class="steps mt-4">
            <li v-for="(s, i) in STEPS" :key="s.title" class="step df-rise" :style="{ 'animationDelay': `${80 + i * 60}ms`, '--c': s.color }">
                <span class="icon" aria-hidden="true">
                    <svg viewBox="0 0 7 7" width="28" height="28" shape-rendering="crispEdges">
                        <rect v-for="(r, j) in pixels(s.icon)" :key="j" :x="r[0]" :y="r[1]" width="1" height="1" />
                    </svg>
                </span>
                <div class="min-w-0">
                    <p class="title"><span class="no">{{ i + 1 }}</span>{{ s.title }}</p>
                    <p class="text">{{ s.text }}</p>
                </div>
            </li>
        </ol>

        <div class="keys mt-4">
            <span v-for="k in KEYS" :key="k.what"><kbd v-for="c in k.keys" :key="c" class="df-key" :class="{ 'df-key--wide': c.length > 2 }">{{ c }}</kbd> {{ k.what }}</span>
        </div>
        <p class="df-type mt-3 text-xs text-[var(--df-chalk-3)]">
            Between matches: weapons you find stay unlocked in the Armory, and every match steeps the perk you pick in Research.
        </p>
    </section>
</template>

<script setup lang="ts">
// A short "how to play" for first-time players: four steps that read in a
// glance, the five keys that matter, and where progress goes between matches.
import DfButton from '~/components/dead-front/ui/DfButton.vue'

defineProps<{ dismissable?: boolean }>()
const emit = defineEmits<{ dismiss: [] }>()

// 7x7 pixel icons, '#' = filled
const ICONS = {
    skull: ['.#####.', '#######', '#..#..#', '#..#..#', '###.###', '.#####.', '.#.#.#.'],
    door: ['.#####.', '#.....#', '#.....#', '#...#.#', '#.....#', '#.....#', '#######'],
    bolt: ['...###.', '..###..', '.###...', '#######', '...###.', '..###..', '.###...'],
    cross: ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..']
} as const

const STEPS: { title: string, text: string, icon: keyof typeof ICONS, color: string }[] = [
    { title: 'Shoot the dead', text: 'Every hit pays 10 points, kills pay more. Headshots and the knife pay most.', icon: 'skull', color: '#e2412f' },
    { title: 'Spend your points', text: 'Open doors, buy guns off the walls, or try the mystery box.', icon: 'door', color: '#e2b24f' },
    { title: 'Restore the power', text: 'Find the switch. It wakes the perk machines and the Pack-a-Punch.', icon: 'bolt', color: '#7f93ff' },
    { title: 'Stay together', text: 'A downed mate needs you: hold F next to them. If everyone goes down, it is over.', icon: 'cross', color: '#8ab052' }
]

const KEYS = [
    { keys: ['W', 'A', 'S', 'D'], what: 'move' },
    { keys: ['LMB'], what: 'fire' },
    { keys: ['R'], what: 'reload' },
    { keys: ['F'], what: 'use / revive' },
    { keys: ['Tab'], what: 'scores' }
]

function pixels(name: keyof typeof ICONS): [number, number][] {
    const out: [number, number][] = []
    ICONS[name].forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            if (row[x] === '#') out.push([x, y])
        }
    })
    return out
}
</script>

<style scoped>
.df-howto {
    padding: 1.2rem 1.2rem 1.1rem;
}

.steps {
    display: grid;
    gap: 0.9rem 1.2rem;
}

@media (min-width: 640px) {
    .steps {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (min-width: 1100px) {
    .steps {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
}

.step {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
}

.icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--c) 16%, #0c0e10);
    box-shadow: inset 0 -4px 0 color-mix(in srgb, var(--c) 60%, #000), 0 0 0 2px #000;
}

.icon svg {
    fill: var(--c);
}

.title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--df-font-stencil);
    font-size: 0.95rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--df-chalk);
}

.no {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.2rem;
    height: 1.2rem;
    font-size: 0.75rem;
    color: #0c0e10;
    background: var(--c);
}

.text {
    margin-top: 0.2rem;
    font-size: 0.92rem;
    line-height: 1.35;
    color: var(--df-chalk-2);
}

.keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1.2rem;
    padding-top: 0.9rem;
    border-top: 2px dashed rgba(241, 232, 207, 0.12);
    font-family: var(--df-font-type);
    font-size: 0.8rem;
    color: var(--df-chalk-2);
}

.keys span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
}

.keys .df-key {
    font-size: 0.7rem;
}
</style>
