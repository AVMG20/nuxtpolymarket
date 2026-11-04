<template>
    <div class="grid gap-6 lg:grid-cols-[17rem_1fr]">
        <!-- the rack -->
        <ul class="df-rack df-scroll" aria-label="Weapons">
            <li v-for="(w, i) in weapons" :key="w.id" class="df-rise" :style="{ animationDelay: `${i * 35}ms` }">
                <button
                    type="button"
                    class="df-rack-card"
                    :class="{ active: selected === w.id, locked: !w.unlocked }"
                    :aria-pressed="selected === w.id"
                    @click="selected = w.id"
                >
                    <DfWeaponSilhouette :weapon="w.id" :width="96" :tone="w.unlocked ? 'color' : 'chalk'" class="df-rack-sil" />
                    <span class="min-w-0 flex-1 text-left">
                        <span class="df-rack-name block truncate">{{ w.def.name }}</span>
                        <span class="df-rack-sub block">
                            <template v-if="!w.unlocked"><DfIcon name="lock" :size="11" /> Not yet found</template>
                            <template v-else>{{ w.def.class }} · Lv {{ w.level }}</template>
                        </span>
                    </span>
                    <span v-if="w.id === 'm1911'" class="df-rack-tag df-brass" title="Everyone starts with the M1911">Start</span>
                </button>
            </li>
        </ul>

        <!-- the schematic -->
        <section v-if="current" :key="current.id" class="df-sheet df-paper">
            <header class="flex flex-wrap items-start justify-between gap-4">
                <div class="min-w-0">
                    <p class="df-eyebrow">Pattern {{ current.def.year }} · {{ current.def.class }}</p>
                    <h2 class="df-h df-ink-in mt-1 flex flex-wrap items-center gap-3 text-3xl sm:text-4xl">
                        {{ current.def.name }}
                        <span v-if="current.unlocked" class="df-lv df-brass" :title="`Service level ${current.level} of ${maxLevel}`">Lv {{ current.level }}</span>
                    </h2>
                    <p class="mt-1.5 max-w-prose text-[0.95rem] italic leading-snug text-[var(--df-ink-2)]">{{ current.def.description }}</p>
                </div>
                <span v-if="current.id === 'm1911'" class="df-stamp df-stamp-land mt-1 !text-sm" style="--df-tilt: -5deg">Standard issue · everyone starts with it</span>
            </header>

            <!-- drawing -->
            <div class="df-drawing mt-5" :class="{ locked: !current.unlocked }">
                <div class="df-drawing-grid" aria-hidden="true" />
                <span class="df-drawing-label tl">Fig. {{ figNo }}</span>
                <span class="df-drawing-label br">Scale 1 : 6 · Sainte-Croix depot</span>
                <div class="df-drawing-model">
                    <DfWeaponPreview
                        v-if="current.unlocked && !previewFailed"
                        :weapon="current.id"
                        :attachments="choice"
                        @failed="previewFailed = true"
                    />
                    <div v-else class="flex h-full items-center justify-center">
                        <DfWeaponSilhouette :weapon="current.id" :width="340" :tone="current.unlocked ? 'color' : 'chalk'" class="df-drawing-sil" />
                    </div>
                </div>

                <!-- fittings on the schematic -->
                <template v-if="current.unlocked && slots.length">
                    <svg class="df-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                        <path
                            v-for="s in slots"
                            :key="s.slot"
                            :d="`M${FIT[s.slot].from[0]} ${FIT[s.slot].from[1]}L${FIT[s.slot].to[0]} ${FIT[s.slot].to[1]}`"
                            :class="{ on: activeSlot === s.slot }"
                        />
                    </svg>
                    <button
                        v-for="s in slots"
                        :key="s.slot"
                        type="button"
                        class="df-fitting"
                        :class="[`at-${s.slot}`, { on: activeSlot === s.slot, filled: !!s.fitted }]"
                        @click="activeSlot = s.slot"
                    >
                        <span class="df-bolt" aria-hidden="true" />
                        <span class="min-w-0 text-left">
                            <span class="df-fitting-slot">{{ s.slot }}</span>
                            <span class="df-fitting-name">{{ s.fitted?.def.name ?? 'Standard issue' }}</span>
                        </span>
                    </button>
                </template>

                <div v-if="!current.unlocked" class="df-locknote df-paper">
                    <p class="df-h flex items-center gap-1.5 text-sm"><DfIcon name="lock" :size="14" /> Find it in a match</p>
                    <p class="mt-1 text-sm italic leading-snug">{{ lockedHint(current.id) }}</p>
                </div>
            </div>

            <!-- small screens: the fittings sit in a row under the drawing -->
            <div v-if="current.unlocked && slots.length" class="df-fit-row mt-3">
                <button
                    v-for="s in slots"
                    :key="s.slot"
                    type="button"
                    class="df-fitting static"
                    :class="{ on: activeSlot === s.slot, filled: !!s.fitted }"
                    @click="activeSlot = s.slot"
                >
                    <span class="df-bolt" aria-hidden="true" />
                    <span class="min-w-0 text-left">
                        <span class="df-fitting-slot">{{ s.slot }}</span>
                        <span class="df-fitting-name">{{ s.fitted?.def.name ?? 'Standard issue' }}</span>
                    </span>
                </button>
            </div>

            <template v-if="current.unlocked">
                <!-- service level -->
                <div class="mt-5">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <span class="df-h text-sm">Service level {{ current.level }} <span class="text-[var(--df-ink-3)]">/ {{ maxLevel }}</span></span>
                        <span class="df-type text-xs text-[var(--df-ink-2)]">{{ current.nextXp === null ? 'Mastered' : `${formatNumber(current.xp)} / ${formatNumber(current.nextXp)} xp` }}</span>
                    </div>
                    <DfGauge class="mt-2" :value="current.frac" color="#d39a36" />
                </div>

                <!-- performance: bars against the best in the armory; fittings show their change -->
                <dl class="df-bars mt-5 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                    <div v-for="b in bars" :key="b.label" class="df-bar">
                        <dt>{{ b.label }}</dt>
                        <dd>
                            <span class="track" :style="{ '--v': b.value, '--b': b.base }">
                                <span class="fill" :class="{ up: b.value > b.base + 0.005, down: b.value < b.base - 0.005 }" />
                                <span v-if="Math.abs(b.value - b.base) > 0.005" class="was" />
                            </span>
                            <span class="num" :class="{ good: b.delta > 0, bad: b.delta < 0 }">{{ b.text }}</span>
                        </dd>
                    </div>
                </dl>
                <p class="df-type mt-2 text-[0.7rem] text-[var(--df-ink-3)]">
                    Bars compare against the best in the armory. Reserve {{ stats.reserve }} · aimed zoom ×{{ stats.adsZoom.toFixed(1) }}<template v-if="stats.penetration"> · pierces {{ stats.penetration }}</template>
                </p>

                <!-- fittings for the selected slot -->
                <p v-if="!slots.length" class="df-type mt-5 text-sm text-[var(--df-ink-2)]">This weapon takes no fittings.</p>
                <div v-else-if="activeGroup" class="mt-6">
                    <div class="flex items-baseline justify-between gap-2">
                        <h3 class="df-h text-lg">{{ activeGroup.slot }} fittings</h3>
                        <span class="df-type text-xs text-[var(--df-ink-2)]">click again to remove</span>
                    </div>
                    <div class="mt-3 grid gap-3 sm:grid-cols-2">
                        <button
                            v-for="a in activeGroup.items"
                            :key="a.def.id"
                            type="button"
                            class="df-part-card"
                            :class="{ active: a.active, locked: !a.unlocked }"
                            :disabled="!a.unlocked || saving"
                            @click="toggle(activeGroup.slot, a.def.id)"
                        >
                            <div class="flex items-start justify-between gap-2">
                                <span class="df-part-name">{{ a.def.name }}</span>
                                <span v-if="!a.unlocked" class="df-stamp df-stamp--ink shrink-0" style="--df-tilt: 3deg"><DfIcon name="lock" :size="10" /> Lv {{ a.def.level }}</span>
                                <span v-else-if="a.active" :key="`fit-${a.def.id}`" class="df-stamp df-stamp-land shrink-0" style="--df-tilt: -6deg">Fitted</span>
                            </div>
                            <p class="mt-1 text-[0.82rem] italic leading-snug text-[var(--df-ink-2)]">{{ a.def.description }}</p>
                            <p v-if="a.deltas.length" class="mt-2 flex flex-wrap gap-1.5">
                                <span v-for="d in a.deltas" :key="d.label" class="df-delta" :class="d.good ? 'good' : 'bad'">{{ d.label }} {{ d.text }}</span>
                            </p>
                        </button>
                    </div>
                </div>
            </template>
        </section>
    </div>
</template>

<script setup lang="ts">
import { DF_WEAPONS, DF_WEAPON_IDS, DF_WEAPON_LEVEL_XP, dfWeaponLevel, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfAttachmentChoice, DfAttachmentSlot, DfLoadout, DfProfileView, DfWeaponId } from '#shared/utils/dead-front/types'
import DfIcon from '~/components/dead-front/ui/DfIcon.vue'
import DfGauge from '~/components/dead-front/ui/DfGauge.vue'
import DfWeaponSilhouette from '~/components/dead-front/ui/DfWeaponSilhouette.vue'

const props = defineProps<{ profile: DfProfileView }>()
const emit = defineEmits<{ update: [profile: DfProfileView] }>()

const toast = useToast()
const saving = ref(false)
const selected = ref<DfWeaponId>('m1911')
const activeSlot = ref<DfAttachmentSlot | null>(null)
const previewFailed = ref(false)

// The 3D preview pulls in three.js and the weapon models: load it on demand,
// and fall back to the drawn silhouette if it can't load.
const DfWeaponPreview = defineAsyncComponent({
    loader: () => import('~/components/dead-front/ui/DfWeaponPreview.client.vue'),
    onError(_e, _retry, fail) {
        previewFailed.value = true
        fail()
    }
})
const maxLevel = DF_WEAPON_LEVEL_XP.length

/** Where each fitting sits on the drawing and where its leader line meets the weapon (percent). */
const FIT: Record<DfAttachmentSlot, { from: [number, number], to: [number, number] }> = {
    optic: { from: [26, 15], to: [50, 40] },
    muzzle: { from: [80, 15], to: [80, 46] },
    magazine: { from: [76, 86], to: [56, 60] },
    stock: { from: [20, 86], to: [26, 56] }
}

const weapons = computed(() => DF_WEAPON_IDS.map((id) => {
    const xp = props.profile.weaponXp[id] ?? 0
    const level = dfWeaponLevel(xp)
    const from = DF_WEAPON_LEVEL_XP[level - 1] ?? 0
    const to = DF_WEAPON_LEVEL_XP[level]
    return {
        id,
        def: DF_WEAPONS[id],
        unlocked: props.profile.unlockedWeapons.includes(id),
        xp,
        level,
        nextXp: to ?? null,
        frac: to === undefined ? 1 : Math.min(1, (xp - from) / Math.max(1, to - from))
    }
}))

const current = computed(() => weapons.value.find(w => w.id === selected.value))
const choice = computed<DfAttachmentChoice>(() => props.profile.loadout.attachments[selected.value] ?? {})
const figNo = computed(() => DF_WEAPON_IDS.indexOf(selected.value) + 1)

interface StatRow { key: keyof DfWeaponStats, label: string, lowerIsBetter?: boolean, fmt?: (n: number) => string }
const STAT_ROWS: StatRow[] = [
    { key: 'damage', label: 'Damage' },
    { key: 'rpm', label: 'Rounds per minute' },
    { key: 'magSize', label: 'Magazine' },
    { key: 'reserve', label: 'Reserve' },
    { key: 'reloadTime', label: 'Reload', lowerIsBetter: true, fmt: n => `${n.toFixed(1)} s` },
    { key: 'range', label: 'Range', fmt: n => `${Math.round(n)} m` },
    { key: 'hipSpread', label: 'Hip spread', lowerIsBetter: true, fmt: n => `${(n * 100).toFixed(1)}` },
    { key: 'adsSpread', label: 'Aimed spread', lowerIsBetter: true, fmt: n => `${(n * 100).toFixed(2)}` },
    { key: 'adsTime', label: 'Time to aim', lowerIsBetter: true, fmt: n => `${n.toFixed(2)} s` },
    { key: 'recoil', label: 'Recoil', lowerIsBetter: true, fmt: n => `${(n * 100).toFixed(1)}` },
    { key: 'moveMult', label: 'Mobility', fmt: n => `${Math.round(n * 100)}%` }
]

const stats = computed(() => dfWeaponStats(selected.value, 0, choice.value))

interface BarRow { label: string, get: (s: DfWeaponStats) => number, lowerIsBetter?: boolean, fmt: (n: number) => string }
const BAR_ROWS: BarRow[] = [
    { label: 'Damage', get: s => s.damage * Math.max(1, s.pellets), fmt: n => String(Math.round(n)) },
    { label: 'Fire rate', get: s => s.rpm, fmt: n => `${Math.round(n)} rpm` },
    { label: 'Magazine', get: s => s.magSize, fmt: n => String(Math.round(n)) },
    { label: 'Reload', get: s => s.reloadTime, lowerIsBetter: true, fmt: n => `${n.toFixed(1)} s` },
    { label: 'Range', get: s => s.range, fmt: n => `${Math.round(n)} m` },
    { label: 'Accuracy', get: s => s.adsSpread, lowerIsBetter: true, fmt: n => `${(n * 1000).toFixed(1)} mrad` },
    { label: 'Aim speed', get: s => s.adsTime, lowerIsBetter: true, fmt: n => `${n.toFixed(2)} s` },
    { label: 'Mobility', get: s => s.moveMult, fmt: n => `${Math.round(n * 100)}%` }
]

// The best value of each row across every weapon, bare (no fittings, no Pack-a-Punch).
const BAR_BEST = BAR_ROWS.map((r) => {
    const vals = DF_WEAPON_IDS.filter(id => id !== 'wunder').map(id => r.get(dfWeaponStats(id, 0, {}))).filter(v => Number.isFinite(v) && v > 0)
    return r.lowerIsBetter ? Math.min(...vals) : Math.max(...vals)
})

function barScore(r: BarRow, best: number, v: number): number {
    if (!(v > 0) || !(best > 0)) return 0
    // square root: a pistol next to a shotgun's pellet volley should still read
    return Math.max(0.05, Math.sqrt(Math.min(1, r.lowerIsBetter ? best / v : v / best)))
}

const bars = computed(() => {
    const bare = dfWeaponStats(selected.value, 0, {})
    return BAR_ROWS.map((r, i) => {
        const v = r.get(stats.value)
        const b = r.get(bare)
        const value = barScore(r, BAR_BEST[i]!, v)
        const base = barScore(r, BAR_BEST[i]!, b)
        return { label: r.label, value, base, delta: Math.sign(value - base) * (Math.abs(value - base) > 0.005 ? 1 : 0), text: r.fmt(v) }
    })
})

const SLOT_ORDER: DfAttachmentSlot[] = ['optic', 'muzzle', 'magazine', 'stock']

const slots = computed(() => {
    const w = current.value
    if (!w) return []
    const base = dfWeaponStats(w.id, 0, {})
    type Item = { def: (typeof w.def.attachments)[number], unlocked: boolean, active: boolean, deltas: { label: string, text: string, good: boolean }[] }
    const groups = new Map<DfAttachmentSlot, Item[]>()
    for (const def of w.def.attachments) {
        const with1 = dfWeaponStats(w.id, 0, { [def.slot]: def.id })
        const deltas = STAT_ROWS.flatMap((r) => {
            const a = base[r.key] as number
            const b = with1[r.key] as number
            if (!a || Math.abs(b - a) < 1e-9) return []
            const pct = Math.round(((b - a) / a) * 100)
            if (!pct) return []
            return [{ label: r.label, text: `${pct > 0 ? '+' : ''}${pct}%`, good: r.lowerIsBetter ? pct < 0 : pct > 0 }]
        })
        // the Maxim silencer's salvage bonus (not a weapon stat)
        if (def.salvage && def.salvage !== 1) deltas.push({ label: 'Salvage', text: `+${Math.round((def.salvage - 1) * 100)}%`, good: true })
        const list = groups.get(def.slot) ?? []
        list.push({ def, unlocked: def.level <= w.level, active: choice.value[def.slot] === def.id, deltas })
        groups.set(def.slot, list)
    }
    return SLOT_ORDER.filter(s => groups.has(s)).map((slot) => {
        const items = groups.get(slot)!
        return { slot, items, fitted: items.find(i => i.active) ?? null }
    })
})

const activeGroup = computed(() => slots.value.find(s => s.slot === activeSlot.value) ?? slots.value[0] ?? null)

watch(selected, () => {
    activeSlot.value = slots.value[0]?.slot ?? null
}, { immediate: true })

function lockedHint(id: DfWeaponId): string {
    const def = DF_WEAPONS[id]
    if (id === 'wunder') return 'Only the Arc Generator yields this one. Follow the objective tracker through the night.'
    if (def.wallCost && def.inBox) return 'Buy it off a wall or pull it from the mystery box once, and it is yours for good.'
    if (def.wallCost) return 'Buy it off a wall once, and it is yours for good.'
    return 'Pull it from the mystery box once, and it is yours for good.'
}

function toggle(slot: DfAttachmentSlot, id: string) {
    const next = Object.fromEntries(Object.entries(choice.value).filter(([k]) => k !== slot)) as DfAttachmentChoice
    if (choice.value[slot] !== id) next[slot] = id
    save({ ...props.profile.loadout.attachments, [selected.value]: next })
}

async function save(attachments: DfLoadout['attachments']) {
    saving.value = true
    try {
        const profile = await apiFetch<DfProfileView>('/api/dead-front/loadout', { method: 'POST', body: { attachments } })
        emit('update', profile)
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not save the loadout'), color: 'error' })
    } finally {
        saving.value = false
    }
}
</script>

<style scoped>
/* rack */
.df-rack-card {
    position: relative;
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    background: linear-gradient(180deg, rgba(40, 38, 32, 0.9), rgba(24, 23, 20, 0.92));
    border: 1px solid rgba(201, 162, 74, 0.16);
    box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.3, 1.5, 0.5, 1), border-color 0.2s, background 0.2s;
}

.df-rack-card:hover {
    transform: translateX(3px);
    border-color: rgba(201, 162, 74, 0.45);
}

.df-rack-card.active {
    background: linear-gradient(180deg, #e8dab6, #d3c092);
    border-color: #6c521d;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 22px -6px rgba(255, 178, 78, 0.5);
}

.df-rack-card:focus-visible {
    outline: 2px solid var(--df-lamp);
    outline-offset: 2px;
}

.df-rack-sil {
    flex-shrink: 0;
    width: 72px;
    height: auto;
    transition: transform 0.3s;
}

.df-rack-card:hover .df-rack-sil {
    transform: translateX(3px);
}

.df-rack-card.locked .df-rack-sil {
    color: rgba(236, 226, 198, 0.55);
}

.df-rack-card.active.locked .df-rack-sil {
    color: rgba(60, 40, 15, 0.45);
}

.df-rack-name {
    font-family: var(--df-font-stencil);
    font-size: 0.86rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--df-chalk);
}

.df-rack-sub {
    font-family: var(--df-font-type);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    color: var(--df-chalk-3);
    text-transform: uppercase;
}

.df-rack-card.active .df-rack-name {
    color: var(--df-ink);
}

.df-rack-card.active .df-rack-sub {
    color: var(--df-ink-3);
}

.df-rack-card.locked:not(.active) .df-rack-name {
    color: var(--df-chalk-3);
}

.df-rack-tag {
    position: absolute;
    top: -6px;
    right: 6px;
    padding: 0.05rem 0.4rem;
    font-family: var(--df-font-stencil);
    font-size: 0.6rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
}

.df-rack {
    display: grid;
    gap: 0.5rem;
}

/* Below the desktop layout the rack becomes a sideways strip. */
@media (max-width: 1023px) {
    .df-rack {
        display: flex;
        margin: 0 -0.4rem;
        padding: 0.8rem 0.4rem 0.6rem;
        overflow-x: auto;
        scroll-snap-type: x proximity;
    }

    .df-rack > li {
        flex: 0 0 10.5rem;
        scroll-snap-align: start;
    }

    .df-rack-card {
        height: 100%;
        flex-direction: column;
        align-items: flex-start;
    }

    .df-rack-card > span {
        width: 100%;
    }

    .df-rack-sil {
        width: 88px;
    }
}

/* sheet */
.df-sheet {
    padding: 1.3rem 1.3rem 1.5rem;
    animation: df-rise-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}

@media (min-width: 640px) {
    .df-sheet {
        padding: 1.6rem 1.8rem 1.8rem;
    }
}

.df-drawing {
    position: relative;
    height: 17rem;
    overflow: hidden;
    background:
        radial-gradient(70% 80% at 50% 45%, rgba(255, 190, 110, 0.13), transparent 70%),
        linear-gradient(180deg, #1b1d1b, #121412);
    box-shadow: inset 0 0 0 1px rgba(201, 162, 74, 0.25), inset 0 0 40px rgba(0, 0, 0, 0.8);
}

.df-drawing-grid {
    position: absolute;
    inset: 0;
    background-image:
        linear-gradient(rgba(201, 162, 74, 0.09) 1px, transparent 1px),
        linear-gradient(90deg, rgba(201, 162, 74, 0.09) 1px, transparent 1px),
        linear-gradient(rgba(201, 162, 74, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(201, 162, 74, 0.04) 1px, transparent 1px);
    background-size: 60px 60px, 60px 60px, 12px 12px, 12px 12px;
    background-position: -1px -1px;
}

.df-drawing-label {
    position: absolute;
    font-family: var(--df-font-type);
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(201, 162, 74, 0.6);
}

.df-drawing-label.tl {
    top: 0.6rem;
    left: 0.75rem;
}

.df-drawing-label.br {
    right: 0.75rem;
    bottom: 0.55rem;
}

.df-drawing-model {
    position: absolute;
    inset: 1.5rem 5% 2rem;
}

.df-drawing-sil {
    width: min(340px, 80%);
    height: auto;
    color: rgba(236, 226, 198, 0.5);
}

.df-drawing.locked .df-drawing-model {
    filter: blur(0.3px);
}

.df-leaders {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.df-leaders path {
    fill: none;
    stroke: rgba(236, 226, 198, 0.32);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
    transition: stroke 0.2s;
}

.df-leaders path.on {
    stroke: var(--df-lamp);
    stroke-dasharray: none;
    animation: df-leader 0.4s ease-out;
}

.df-fitting {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    max-width: 11rem;
    padding: 0.3rem 0.6rem 0.3rem 0.35rem;
    background: rgba(18, 18, 15, 0.86);
    border: 1px solid rgba(201, 162, 74, 0.35);
    color: var(--df-chalk);
    cursor: pointer;
    transform: translate(-50%, -50%);
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s cubic-bezier(0.3, 1.5, 0.5, 1);
}

.df-fitting:hover {
    transform: translate(-50%, -50%) scale(1.04);
    border-color: var(--df-brass);
}

.df-fitting.on {
    border-color: var(--df-lamp);
    box-shadow: 0 0 16px -4px rgba(255, 178, 78, 0.7);
}

.df-fitting:focus-visible {
    outline: 2px solid var(--df-lamp);
    outline-offset: 2px;
}

.df-fitting.at-optic { left: 26%; top: 15%; }
.df-fitting.at-muzzle { left: 80%; top: 15%; }
.df-fitting.at-magazine { left: 76%; top: 86%; }
.df-fitting.at-stock { left: 20%; top: 86%; }

.df-bolt {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    background:
        linear-gradient(45deg, transparent 44%, rgba(40, 25, 5, 0.75) 44% 56%, transparent 56%),
        radial-gradient(circle at 35% 30%, #fff1c4, #c9a24a 45%, #5a4214 90%);
    box-shadow: 0 0 0 1px #3a2a0c, 0 1px 2px rgba(0, 0, 0, 0.6);
    transition: transform 0.4s cubic-bezier(0.3, 1.5, 0.5, 1);
}

.df-fitting.filled .df-bolt {
    transform: rotate(90deg);
}

.df-fitting:not(.filled) .df-bolt {
    filter: saturate(0.2) brightness(0.7);
}

.df-fitting-slot {
    display: block;
    font-family: var(--df-font-type);
    font-size: 0.56rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--df-brass);
}

.df-fitting-name {
    display: block;
    overflow: hidden;
    font-family: var(--df-font-serif);
    font-size: 0.82rem;
    line-height: 1.1;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.df-fit-row {
    display: none;
}

@media (max-width: 639px) {
    .df-drawing {
        height: 13rem;
    }

    .df-drawing .df-fitting,
    .df-leaders {
        display: none;
    }

    .df-fit-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.5rem;
    }

    .df-fitting.static {
        position: relative;
        max-width: none;
        transform: none;
    }

    .df-fitting.static:hover {
        transform: none;
    }
}

.df-locknote {
    position: absolute;
    left: 50%;
    bottom: 1rem;
    width: min(22rem, 86%);
    padding: 0.7rem 0.9rem;
    transform: translateX(-50%);
}

/* performance bars */
.df-bar {
    display: grid;
    grid-template-columns: 6.2rem 1fr;
    align-items: center;
    gap: 0.6rem;
}

.df-bar dt {
    font-family: var(--df-font-stencil);
    font-size: 0.74rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--df-ink-2);
}

.df-bar dd {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
}

.df-bar .track {
    position: relative;
    flex: 1;
    height: 10px;
    background: repeating-linear-gradient(90deg, rgba(60, 40, 15, 0.16) 0 8px, transparent 8px 10px), rgba(60, 40, 15, 0.1);
    box-shadow: 0 0 0 2px #120d07;
}

.df-bar .fill {
    position: absolute;
    inset: 0;
    clip-path: inset(0 calc((1 - var(--v)) * 100%) 0 0);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0 2px, transparent 2px), #3a3024;
    -webkit-mask: repeating-linear-gradient(90deg, #000 0 8px, transparent 8px 10px);
    mask: repeating-linear-gradient(90deg, #000 0 8px, transparent 8px 10px);
    transition: clip-path 0.4s cubic-bezier(0.25, 1.2, 0.4, 1);
}

.df-bar .fill.up {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0 2px, transparent 2px), #3f6a26;
}

.df-bar .fill.down {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.35) 0 2px, transparent 2px), #a8241a;
}

/* where the bare weapon sits, when a fitting moves the bar */
.df-bar .was {
    position: absolute;
    top: -4px;
    bottom: -4px;
    left: calc(var(--b) * 100% - 1px);
    width: 3px;
    background: #120d07;
}

.df-bar .num {
    width: 5.6rem;
    flex-shrink: 0;
    font-family: var(--df-font-type);
    font-size: 0.78rem;
    text-align: right;
    color: var(--df-ink);
    font-variant-numeric: tabular-nums;
}

.df-bar .num.good {
    color: #2f5a1c;
}

.df-bar .num.bad {
    color: #8e1d13;
}

.df-lv {
    padding: 0.2rem 0.5rem 0.15rem;
    font-size: 0.9rem;
    letter-spacing: 0.12em;
}

/* fitting cards */
.df-part-card {
    position: relative;
    padding: 0.75rem 0.85rem 0.8rem;
    text-align: left;
    background: rgba(255, 250, 232, 0.45);
    border: 1px solid rgba(60, 40, 15, 0.25);
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.3, 1.5, 0.5, 1), background 0.2s, border-color 0.2s;
}

.df-part-card:hover:not(:disabled) {
    transform: translateY(-2px);
    background: rgba(255, 252, 240, 0.7);
    border-color: rgba(60, 40, 15, 0.45);
}

.df-part-card.active {
    background: rgba(255, 246, 225, 0.8);
    border-color: var(--df-blood);
    box-shadow: inset 0 0 0 1px rgba(156, 28, 18, 0.3);
}

.df-part-card.locked {
    cursor: not-allowed;
    opacity: 0.6;
}

.df-part-card:focus-visible {
    outline: 2px solid var(--df-blood);
    outline-offset: 2px;
}

.df-part-name {
    font-family: var(--df-font-serif);
    font-size: 1.05rem;
    line-height: 1.15;
    color: var(--df-ink);
}

.df-delta {
    padding: 0.05rem 0.35rem;
    font-family: var(--df-font-type);
    font-size: 0.68rem;
    border: 1px solid currentColor;
}

.df-delta.good {
    color: #2f5a26;
}

.df-delta.bad {
    color: #8e1d13;
}

@keyframes df-leader {
    from { stroke-dasharray: 0 200; }
    to { stroke-dasharray: 200 0; }
}
</style>
