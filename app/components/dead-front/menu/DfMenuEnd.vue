<template>
    <div class="mx-auto max-w-3xl">
        <article class="df-report df-paper">
            <span class="df-clip" aria-hidden="true" />
            <header class="flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(60,40,15,0.35)] pb-3">
                <div>
                    <p class="df-eyebrow">Army Form B.213 · Sainte-Croix sector</p>
                    <h2 class="df-h mt-1 text-2xl sm:text-3xl">Report of casualties</h2>
                </div>
                <p class="df-type text-right text-xs leading-relaxed text-[var(--df-ink-2)]">
                    Night of {{ today }}<br>Rendered by the C.O.
                </p>
            </header>

            <!-- the round -->
            <div class="mt-5 grid items-center gap-5 sm:grid-cols-[auto_1fr]">
                <div class="df-round-stamp df-stamp-land" style="--df-tilt: -7deg">
                    <span class="df-round-label">Fell on round</span>
                    <span class="df-round-no">{{ end.round }}</span>
                </div>
                <div>
                    <svg v-if="end.round <= 40" class="df-tallies" :viewBox="`0 0 ${tallyWidth} 46`" :width="Math.min(tallyWidth, 420)" aria-hidden="true">
                        <g v-for="(g, gi) in tallyGroups" :key="gi" :transform="`translate(${gi * 46} 0)`">
                            <path
                                v-for="k in Math.min(g, 4)"
                                :key="k"
                                :d="`M${4 + (k - 1) * 8} 6 C ${5 + (k - 1) * 8} 18, ${3 + (k - 1) * 8} 30, ${5 + (k - 1) * 8} 40`"
                                :style="{ animationDelay: `${0.5 + (gi * 5 + k) * 0.06}s` }"
                            />
                            <path v-if="g === 5" d="M-2 34 C 12 26, 26 18, 40 10" class="slash" :style="{ animationDelay: `${0.5 + (gi * 5 + 5) * 0.06}s` }" />
                        </g>
                    </svg>
                    <p class="mt-2 italic text-[var(--df-ink-2)]">
                        {{ end.round === 1 ? 'The line broke in the first round.' : `The squad held ${end.round} rounds into the night.` }}
                    </p>
                </div>
            </div>

            <!-- the roll -->
            <div class="mt-6 overflow-x-auto">
                <table class="df-roll-table w-full">
                    <thead>
                        <tr>
                            <th class="l">Soldier</th>
                            <th>Kills</th>
                            <th>Heads</th>
                            <th>Points</th>
                            <th>Downs</th>
                            <th>Revives</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(p, i) in players" :key="p.pid" class="df-ink-in" :style="{ animationDelay: `${0.3 + i * 0.12}s` }">
                            <td class="l">
                                <span class="df-rank">{{ i + 1 }}.</span>{{ p.name }}
                            </td>
                            <td><DfCountUp :value="p.kills" :delay="500 + i * 120" /></td>
                            <td><DfCountUp :value="p.headshots" :delay="560 + i * 120" /></td>
                            <td><DfCountUp :value="p.points" :delay="620 + i * 120" /></td>
                            <td><DfCountUp :value="p.downs" :delay="680 + i * 120" /></td>
                            <td><DfCountUp :value="p.revives" :delay="740 + i * 120" /></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- what the night earned -->
            <section v-if="progress" class="mt-7 space-y-6">
                <div class="df-earned">
                    <span class="df-h text-base">Earned tonight</span>
                    <span v-if="progress.perk" class="df-chip">+{{ formatNumber(progress.perkXpGained) }} research xp</span>
                    <span v-if="weaponXpTotal" class="df-chip">+{{ formatNumber(weaponXpTotal) }} weapon xp</span>
                    <span v-if="progress.newWeapons.length" class="df-chip gold">{{ progress.newWeapons.length }} new {{ progress.newWeapons.length === 1 ? 'weapon' : 'weapons' }}</span>
                </div>
                <div v-if="progress.perk" class="df-earn">
                    <DfPixelPerk :perk="progress.perk" :color="DF_PERKS[progress.perk].color" :size="60" :fill="Math.max(0.06, (shownLevel + barFrac) / 6)" glow />
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                            <span class="df-h text-sm">{{ DF_PERKS[progress.perk].name }} research</span>
                            <span class="df-type text-xs text-[var(--df-ink-2)]">+{{ formatNumber(progress.perkXpGained) }} xp</span>
                        </div>
                        <DfGauge class="mt-2" :value="barFrac" :color="DF_PERKS[progress.perk].color" glow />
                        <p class="df-type mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                            Level {{ shownLevel }} / 6
                            <span v-if="shownLevel > progress.perkLevelBefore" :key="shownLevel" class="df-stamp df-stamp-land" style="--df-tilt: -4deg">New prescription</span>
                        </p>
                    </div>
                </div>
                <p v-else class="df-type text-sm text-[var(--df-ink-2)]">Pick a perk to research and every match will steep it.</p>

                <div v-if="weaponLines.length">
                    <h3 class="df-h text-base">Weapons</h3>
                    <ul class="mt-2">
                        <li v-for="w in weaponLines" :key="w.id" class="df-wline">
                            <DfWeaponSilhouette :weapon="w.id" :width="64" tone="ink" class="text-[var(--df-ink-2)]" />
                            <span class="min-w-0 flex-1 truncate">{{ w.name }}</span>
                            <span class="df-type text-xs text-[var(--df-ink-2)]">+{{ formatNumber(w.xp) }} xp</span>
                            <span v-if="w.level" class="df-stamp df-stamp--green" style="--df-tilt: 4deg">Level {{ w.level }}</span>
                        </li>
                    </ul>
                </div>

                <div v-if="progress.newWeapons.length">
                    <h3 class="df-h text-base">Added to the armory</h3>
                    <div class="mt-3 grid gap-3 sm:grid-cols-2">
                        <div v-for="(id, i) in progress.newWeapons" :key="id" class="df-issued">
                            <DfWeaponSilhouette :weapon="id" :width="110" />
                            <div class="min-w-0">
                                <p class="truncate text-[1.05rem]">{{ DF_WEAPONS[id].name }}</p>
                                <span class="df-stamp df-stamp-land mt-1" :style="{ '--df-tilt': '-6deg', 'animationDelay': `${1 + i * 0.2}s` }">Issued</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <footer class="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(60,40,15,0.35)] pt-4">
                <p class="df-sc text-sm text-[var(--df-ink-2)]">Signed, for the line and the fallen.</p>
                <DfButton tone="blood" size="lg" icon="helmet" @click="emit('close')">
                    {{ inLobby ? 'Back to the squad' : 'Back to the menu' }}
                </DfButton>
            </footer>
        </article>
    </div>
</template>

<script setup lang="ts">
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import { DF_PERK_LEVEL_XP, dfPerkLevel } from '#shared/utils/dead-front/progression'
import { DF_WEAPONS } from '#shared/utils/dead-front/weapons'
import type { DfMatchEnd } from '#shared/utils/dead-front/protocol'
import type { DfWeaponId } from '#shared/utils/dead-front/types'
import DfButton from '~/components/dead-front/ui/DfButton.vue'
import DfCountUp from '~/components/dead-front/ui/DfCountUp.vue'
import DfGauge from '~/components/dead-front/ui/DfGauge.vue'
import DfPixelPerk from '~/components/dead-front/ui/DfPixelPerk.vue'
import DfWeaponSilhouette from '~/components/dead-front/ui/DfWeaponSilhouette.vue'

const props = defineProps<{
    end: DfMatchEnd
    /** Research XP of the reported perk after the match (from the refreshed profile). */
    perkXpAfter: number | null
    inLobby: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const progress = computed(() => props.end.progress)
const players = computed(() => [...props.end.players].sort((a, b) => b.points - a.points))
const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) + ' 1917'

const tallyGroups = computed(() => {
    const out: number[] = []
    let left = Math.max(0, props.end.round)
    while (left > 0) {
        out.push(Math.min(5, left))
        left -= 5
    }
    return out
})
const tallyWidth = computed(() => Math.max(46, tallyGroups.value.length * 46))

const weaponLines = computed(() => {
    const p = progress.value
    if (!p) return []
    return (Object.entries(p.weaponXpGained) as [DfWeaponId, number][]).map(([id, xp]) => ({
        id, xp, name: DF_WEAPONS[id]?.name ?? id, level: p.weaponLevelsUp[id] ?? 0
    }))
})

const weaponXpTotal = computed(() => weaponLines.value.reduce((n, w) => n + w.xp, 0))

// Animate the research bar from the old XP to the new one, wrapping on level-ups.
const shownXp = ref(0)
const shownLevel = computed(() => dfPerkLevel(shownXp.value))
const barFrac = computed(() => {
    const lv = shownLevel.value
    if (lv >= DF_PERK_LEVEL_XP.length) return 1
    const from = lv === 0 ? 0 : DF_PERK_LEVEL_XP[lv - 1]!
    const to = DF_PERK_LEVEL_XP[lv]!
    return Math.min(1, (shownXp.value - from) / (to - from))
})

let raf = 0
function animate() {
    const p = progress.value
    if (!p?.perk || props.perkXpAfter === null) return
    const after = props.perkXpAfter
    const before = Math.max(0, after - p.perkXpGained)
    shownXp.value = before
    const t0 = performance.now() + 700
    const dur = 1800
    cancelAnimationFrame(raf)
    const step = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - t0) / dur))
        const k = 1 - (1 - t) * (1 - t) * (1 - t)
        shownXp.value = before + (after - before) * k
        if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
}

watch(() => props.perkXpAfter, animate, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<style scoped>
.df-report {
    padding: 1.6rem 1.3rem 1.4rem;
    animation: df-rise-in 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}

@media (min-width: 640px) {
    .df-report {
        padding: 2rem 2.2rem 1.6rem;
    }
}

.df-clip {
    position: absolute;
    top: -12px;
    left: 50%;
    width: 90px;
    height: 24px;
    margin-left: -45px;
    background: linear-gradient(180deg, #9aa3a2, #5b6261);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.df-round-stamp {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 0.4rem 1.2rem 0.2rem;
    color: var(--df-blood);
    border: 3px double currentColor;
    transform: rotate(var(--df-tilt));
    mix-blend-mode: multiply;
    animation-delay: 0.2s;
}

.df-round-label {
    font-family: var(--df-font-stencil);
    font-size: 0.72rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
}

.df-round-no {
    font-family: var(--df-font-stencil);
    font-size: 4.6rem;
    line-height: 1;
}

.df-tallies {
    display: block;
    max-width: 100%;
    height: auto;
    overflow: visible;
}

.df-tallies path {
    fill: none;
    stroke: var(--df-blood);
    stroke-width: 3.2;
    stroke-linecap: round;
    stroke-dasharray: 50;
    stroke-dashoffset: 50;
    animation: df-tally 0.28s ease-out forwards;
}

.df-tallies .slash {
    stroke-width: 2.6;
}

.df-roll-table {
    border-collapse: collapse;
    font-family: var(--df-font-type);
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
}

.df-roll-table th {
    padding: 0.4rem 0.5rem;
    font-weight: 400;
    font-size: 0.64rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    text-align: right;
    color: var(--df-ink-3);
    border-bottom: 1.5px solid rgba(60, 40, 15, 0.5);
}

.df-roll-table td {
    padding: 0.5rem;
    text-align: right;
    border-bottom: 1px solid rgba(60, 80, 120, 0.2);
}

.df-roll-table .l {
    text-align: left;
}

.df-roll-table td.l {
    font-family: var(--df-font-serif);
    font-size: 1rem;
}

.df-rank {
    display: inline-block;
    width: 1.4rem;
    color: var(--df-blood);
}

.df-earn {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.df-wline {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.35rem 0;
    border-bottom: 1px dotted rgba(60, 40, 15, 0.35);
}

.df-issued {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.6rem 0.75rem;
    background: linear-gradient(180deg, #1d1f1c, #141513);
    color: var(--df-chalk);
    box-shadow: 0 6px 14px -8px rgba(0, 0, 0, 0.8);
}

.df-issued .df-stamp {
    mix-blend-mode: normal;
    color: #e0503a;
}

.df-earned {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.7rem;
    padding-bottom: 0.9rem;
    border-bottom: 2px dashed rgba(60, 40, 15, 0.3);
}

.df-chip {
    padding: 0.25rem 0.55rem 0.2rem;
    font-family: var(--df-font-stencil);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    color: #fff2dc;
    background: #3f5a26;
    box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.25), inset 0 -3px 0 rgba(0, 0, 0, 0.3), 0 0 0 2px #120d07;
    animation: df-ink-in 0.4s 0.6s steps(4, end) both;
}

.df-chip.gold {
    color: #261a05;
    background: #e2b24f;
}

@keyframes df-tally {
    to { stroke-dashoffset: 0; }
}
</style>
