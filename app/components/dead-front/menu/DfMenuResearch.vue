<template>
    <div class="space-y-6">
        <!-- the apothecary shelf -->
        <div class="df-shelf">
            <div class="df-shelf-row">
                <button
                    v-for="(p, i) in perks"
                    :key="p.def.id"
                    type="button"
                    class="df-shelf-item"
                    :class="{ active: selected === p.def.id }"
                    :style="{ '--c': p.def.color, 'animationDelay': `${i * 60}ms` }"
                    :aria-pressed="selected === p.def.id"
                    @click="selected = p.def.id"
                >
                    <span class="df-shelf-glow" aria-hidden="true" />
                    <DfPixelPerk
                        :perk="p.def.id"
                        :color="p.def.color"
                        :size="100"
                        :fill="Math.max(0.06, (p.level + p.frac) / 6)"
                        :glow="selected === p.def.id || profile.researchPerk === p.def.id"
                        :brewing="profile.researchPerk === p.def.id"
                        class="df-shelf-bottle"
                    />
                    <span class="df-shelf-label">
                        <span class="block truncate">{{ shortName(p.def.name) }}</span>
                        <span class="df-shelf-lv">{{ roman(p.level) || '—' }} <span class="opacity-60">/ VI</span></span>
                    </span>
                    <span v-if="profile.researchPerk === p.def.id" class="df-still">In the still</span>
                </button>
            </div>
            <div class="df-shelf-board" aria-hidden="true" />
        </div>

        <section v-if="current" :key="current.def.id" class="df-rx df-paper" :style="{ '--c': current.def.color }">
            <div class="grid gap-6 md:grid-cols-[auto_1fr]">
                <div class="hidden md:block">
                    <DfPixelPerk :perk="current.def.id" :color="current.def.color" :size="160" :fill="Math.max(0.06, (current.level + current.frac) / 6)" glow :brewing="profile.researchPerk === current.def.id" />
                </div>
                <div class="min-w-0">
                    <header class="flex flex-wrap items-start justify-between gap-4">
                        <div class="min-w-0">
                            <p class="df-eyebrow">Apothecary of the 17th · {{ current.def.cost.toLocaleString('en-US') }} pts in the field</p>
                            <h2 class="df-rx-name df-ink-in mt-1"><span class="df-rx-mark">℞</span> {{ current.def.name }}</h2>
                            <p class="mt-1 italic text-[var(--df-ink-2)]">"{{ current.def.jingle }}"</p>
                            <p class="df-type mt-2 text-sm">{{ current.def.description }}</p>
                        </div>
                        <span v-if="profile.researchPerk === current.def.id" class="df-stamp df-stamp-land !text-sm" style="--df-tilt: 6deg">Under research</span>
                        <DfButton v-else tone="blood" icon="flask" :loading="saving" @click="research(current.def.id)">Research this perk</DfButton>
                    </header>

                    <div class="mt-5">
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                            <span class="df-h text-sm">Research {{ roman(current.level) || '0' }} <span class="text-[var(--df-ink-3)]">/ VI</span></span>
                            <span class="df-type text-xs text-[var(--df-ink-2)]">{{ current.level >= 6 ? 'Fully researched' : `${formatNumber(current.into)} / ${formatNumber(current.span)} xp to ${roman(current.level + 1)}` }}</span>
                        </div>
                        <div class="mt-2 flex items-center gap-3">
                            <DfGauge class="flex-1" :value="current.level >= 6 ? 1 : current.frac" :color="current.def.color" size="lg" glow />
                            <div class="flex gap-1" aria-hidden="true">
                                <i v-for="n in 6" :key="n" class="df-pip" :class="{ on: n <= current.level }" />
                            </div>
                        </div>
                        <p class="mt-2 text-xs italic text-[var(--df-ink-3)]">Every match you play steeps the perk you research. Switching keeps what you have earned.</p>
                    </div>
                </div>
            </div>

            <div class="mt-7 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 class="df-h text-lg">Prescriptions</h3>
                    <p class="df-type mt-1 text-xs text-[var(--df-ink-2)]">Each research level unlocks one. Pick {{ DF_MAX_PERK_MODS }}: they apply whenever you drink {{ current.def.name }}.</p>
                </div>
                <!-- the picks: one slot per prescription you can carry -->
                <div class="df-picks" :aria-label="`${chosen.length} of ${DF_MAX_PERK_MODS} prescriptions picked`">
                    <span v-for="n in DF_MAX_PERK_MODS" :key="n" class="df-pick" :class="{ filled: !!pickName(n - 1) }">
                        <span class="df-pick-no">{{ n }}</span>
                        <span class="df-pick-name">{{ pickName(n - 1) ?? 'Free slot' }}</span>
                    </span>
                </div>
            </div>
            <div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <button
                    v-for="m in current.def.modifiers"
                    :key="m.id"
                    type="button"
                    class="df-script"
                    :class="{ active: chosen.includes(m.id), locked: m.level > current.level }"
                    :disabled="m.level > current.level || saving || (!chosen.includes(m.id) && chosen.length >= DF_MAX_PERK_MODS)"
                    @click="toggleMod(m.id)"
                >
                    <span class="df-script-no">{{ roman(m.level) }}</span>
                    <span class="min-w-0 flex-1">
                        <span class="df-script-name block">{{ m.name }}</span>
                        <span class="mt-0.5 block text-[0.8rem] italic leading-snug text-[var(--df-ink-2)]">{{ m.description }}</span>
                    </span>
                    <span v-if="m.level > current.level" class="df-script-seal" aria-label="Locked">
                        <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
                            <path :d="sealPath" class="wax" />
                            <text x="20" y="24" text-anchor="middle">{{ roman(m.level) }}</text>
                        </svg>
                    </span>
                    <span v-else-if="chosen.includes(m.id)" :key="`rx-${m.id}`" class="df-stamp df-stamp-land absolute right-2 bottom-2" style="--df-tilt: -8deg">Prescribed</span>
                </button>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { DF_MAX_PERK_MODS, DF_PERKS, DF_PERK_IDS } from '#shared/utils/dead-front/perks'
import { dfPerkLevelProgress } from '#shared/utils/dead-front/progression'
import type { DfPerkId, DfProfileView } from '#shared/utils/dead-front/types'
import DfButton from '~/components/dead-front/ui/DfButton.vue'
import DfGauge from '~/components/dead-front/ui/DfGauge.vue'
import DfPixelPerk from '~/components/dead-front/ui/DfPixelPerk.vue'

const props = defineProps<{ profile: DfProfileView }>()
const emit = defineEmits<{ update: [profile: DfProfileView] }>()

const toast = useToast()
const saving = ref(false)
const selected = ref<DfPerkId>(props.profile.researchPerk ?? 'ironhide')

const perks = computed(() => DF_PERK_IDS.map(id => ({ def: DF_PERKS[id], ...dfPerkLevelProgress(props.profile.perkXp[id] ?? 0) })))
const current = computed(() => perks.value.find(p => p.def.id === selected.value))
const chosen = computed(() => props.profile.perkMods[selected.value] ?? [])

const sealPath = (() => {
    const pts: string[] = []
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2
        const r = i % 2 ? 16.5 : 18.5
        pts.push(`${(20 + Math.cos(a) * r).toFixed(1)} ${(20 + Math.sin(a) * r).toFixed(1)}`)
    }
    return `M${pts.join('L')}Z`
})()

function pickName(i: number): string | null {
    const id = chosen.value[i]
    if (!id) return null
    return current.value?.def.modifiers.find(m => m.id === id)?.name ?? null
}

function roman(n: number): string {
    return ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] ?? String(n)
}

function shortName(name: string): string {
    return name.split(' ').slice(0, -1).join(' ') || name
}

async function post(url: string, body: Record<string, unknown>, fallback: string) {
    saving.value = true
    try {
        emit('update', await apiFetch<DfProfileView>(url, { method: 'POST', body }))
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, fallback), color: 'error' })
    } finally {
        saving.value = false
    }
}

function research(perk: DfPerkId) {
    return post('/api/dead-front/research', { perk }, 'Could not switch research')
}

function toggleMod(id: string) {
    const mods = chosen.value.includes(id) ? chosen.value.filter(m => m !== id) : [...chosen.value, id]
    return post('/api/dead-front/mods', { perk: selected.value, mods }, 'Could not save the prescriptions')
}
</script>

<style scoped>
/* shelf */
.df-shelf {
    position: relative;
    padding: 0.5rem 0 0;
}

.df-shelf-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem 0.4rem;
    padding: 0 0.5rem;
}

@media (min-width: 768px) {
    .df-shelf-row {
        grid-template-columns: repeat(6, minmax(0, 1fr));
    }
}

.df-shelf-board {
    height: 14px;
    margin-top: -4px;
    background:
        linear-gradient(180deg, rgba(255, 220, 160, 0.18), transparent 30%),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.12) 0 2px, transparent 2px 38px),
        linear-gradient(180deg, #5a3a20, #3a2412 60%, #24160b);
    box-shadow: 0 10px 18px -6px rgba(0, 0, 0, 0.85);
}

@media (max-width: 767px) {
    .df-shelf-board {
        display: none;
    }

    .df-shelf-item {
        border-bottom: 6px solid #3a2412;
    }
}

.df-shelf-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.4rem 0.3rem 0.6rem;
    cursor: pointer;
    animation: df-rise-in 0.5s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}

.df-shelf-item:focus-visible {
    outline: 2px solid var(--df-lamp);
    outline-offset: 2px;
}

.df-shelf-glow {
    position: absolute;
    left: 50%;
    bottom: 3.2rem;
    width: 120%;
    height: 70%;
    transform: translateX(-50%);
    background: radial-gradient(50% 50% at 50% 70%, color-mix(in srgb, var(--c) 32%, transparent), transparent 70%);
    opacity: 0;
    transition: opacity 0.4s;
    pointer-events: none;
}

.df-shelf-item:hover .df-shelf-glow {
    opacity: 0.5;
}

.df-shelf-item.active .df-shelf-glow {
    opacity: 1;
    animation: df-gaslamp 4s ease-in-out infinite;
}

.df-shelf-bottle {
    position: relative;
    transition: transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.df-shelf-item:hover .df-shelf-bottle {
    transform: translateY(-4px);
}

.df-shelf-item.active .df-shelf-bottle {
    transform: translateY(-8px);
}

.df-shelf-label {
    position: relative;
    width: 100%;
    max-width: 8rem;
    padding: 0.25rem 0.35rem 0.2rem;
    text-align: center;
    font-family: var(--df-font-stencil);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--df-ink);
    background: linear-gradient(180deg, #e6d7b0, #cdb98c);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.df-shelf-item.active .df-shelf-label {
    background: linear-gradient(180deg, #f4e9cb, #dccb9f);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 70%, #000), 0 2px 6px rgba(0, 0, 0, 0.5);
}

.df-shelf-lv {
    display: block;
    margin-top: 0.05rem;
    font-family: var(--df-font-serif);
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, var(--c) 70%, #2a1a0a);
}

.df-still {
    position: absolute;
    top: 0.1rem;
    left: 50%;
    padding: 0.05rem 0.4rem;
    transform: translateX(-50%);
    font-family: var(--df-font-type);
    font-size: 0.58rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--df-lamp);
    white-space: nowrap;
    animation: df-gaslamp 2.6s ease-in-out infinite;
}

/* prescription card */
.df-rx {
    padding: 1.4rem 1.3rem 1.6rem;
    border-top: 5px solid var(--c);
    animation: df-rise-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}

@media (min-width: 640px) {
    .df-rx {
        padding: 1.6rem 1.8rem 1.8rem;
    }
}

.df-rx-name {
    font-family: var(--df-font-serif);
    font-size: clamp(1.7rem, 3.5vw, 2.3rem);
    line-height: 1.05;
    color: color-mix(in srgb, var(--c) 55%, #1b1209);
}

.df-rx-mark {
    font-size: 0.85em;
    color: var(--df-blood);
}

.df-pip {
    width: 10px;
    height: 10px;
    border: 1.5px solid color-mix(in srgb, var(--c) 60%, #2a1a0a);
    transition: background 0.4s;
}

.df-pip.on {
    background: var(--c);
    box-shadow: 0 0 6px color-mix(in srgb, var(--c) 70%, transparent);
}

.df-script {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    min-height: 5.4rem;
    padding: 0.75rem 0.8rem 0.85rem;
    text-align: left;
    background: rgba(255, 250, 232, 0.5);
    border: 1px solid rgba(60, 40, 15, 0.22);
    border-left: 3px solid color-mix(in srgb, var(--c) 70%, #2a1a0a);
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.3, 1.5, 0.5, 1), background 0.2s, box-shadow 0.2s;
}

.df-script:hover:not(:disabled) {
    transform: translateY(-2px);
    background: rgba(255, 252, 240, 0.78);
    box-shadow: 0 6px 14px -8px rgba(40, 25, 5, 0.6);
}

.df-script:disabled {
    cursor: not-allowed;
}

.df-script.locked {
    background: rgba(60, 40, 15, 0.07);
    border-left-color: rgba(60, 40, 15, 0.3);
}

.df-script.locked .df-script-name,
.df-script.locked .df-script-no {
    opacity: 0.55;
}

.df-script.active {
    background: rgba(255, 246, 225, 0.85);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent);
}

.df-script:focus-visible {
    outline: 2px solid var(--df-blood);
    outline-offset: 2px;
}

.df-script-no {
    width: 1.7rem;
    flex-shrink: 0;
    font-family: var(--df-font-serif);
    font-size: 1.1rem;
    color: var(--df-blood);
}

.df-script-name {
    font-family: var(--df-font-serif);
    font-size: 1.05rem;
    line-height: 1.15;
    color: var(--df-ink);
}

.df-script-seal {
    flex-shrink: 0;
    transform: rotate(-8deg);
    filter: drop-shadow(0 2px 2px rgba(60, 0, 0, 0.4));
}

.df-script-seal .wax {
    fill: #7e1a10;
}

.df-script-seal text {
    font-family: var(--df-font-serif);
    font-size: 11px;
    fill: #f0c9b5;
}

.df-picks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.df-pick {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 10rem;
    padding: 0.35rem 0.7rem 0.35rem 0.35rem;
    font-family: var(--df-font-stencil);
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--df-ink-3);
    border: 2px dashed rgba(60, 40, 15, 0.4);
}

.df-pick.filled {
    color: var(--df-ink);
    border: 2px solid #120d07;
    background: color-mix(in srgb, var(--c) 14%, #fff8e6);
    box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--c) 55%, transparent);
}

.df-pick-no {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    color: #fff;
    background: rgba(60, 40, 15, 0.35);
}

.df-pick.filled .df-pick-no {
    background: var(--c);
    box-shadow: 0 0 0 2px #120d07;
}

@keyframes df-gaslamp {
    0%, 100% { opacity: 1; }
    42% { opacity: 0.88; }
    45% { opacity: 0.7; }
    48% { opacity: 0.95; }
}
</style>
