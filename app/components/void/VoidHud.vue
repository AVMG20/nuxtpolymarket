<template>
    <div class="vx-hud pointer-events-none" :class="{ 'vx-cockpit': hud.cockpit, 'vx-hurt': hullHit, 'vx-critical': hud.lowHull }">
        <div class="vx-vignette" />

        <!-- Top left: sector, wanted level, objectives -->
        <div class="vx-tl">
            <div class="vx-sector">
                <i class="vx-sector-mark" />
                <div>
                    <div class="vx-sector-name">{{ run?.sectorName }}</div>
                    <div class="vx-sector-meta">
                        <span>{{ clock(hud.elapsed) }}</span>
                        <span><UIcon name="i-lucide-crosshair" />{{ hud.kills }}</span>
                        <span v-if="hud.systems && hud.systems.depth > 1" class="vx-zone">Jump {{ hud.systems.depth }} · {{ hud.systems.zone }}</span>
                    </div>
                    <VoidZoneChips v-if="hud.systems && hud.systems.depth > 1" :zone="hud.systems.zoneId" small />
                </div>
            </div>
            <div class="vx-wanted" :class="[`vx-wanted-${Math.min(5, hud.wanted)}`, { 'vx-wanted-hot': hud.wanted >= 4 }]">
                <span class="vx-wanted-label">Wanted</span>
                <svg v-for="n in 5" :key="`${n}-${n <= hud.wanted}`" viewBox="0 0 20 20" :class="{ 'vx-star-on': n <= hud.wanted }">
                    <path d="M10 1.2l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L10 15l-5.6 3.3 1.4-6.3L1 7.7l6.4-.6z" />
                </svg>
            </div>
            <div v-if="hud.wardenKilled" class="vx-claim"><UIcon name="i-lucide-trophy" />Warden down · dock to claim</div>
            <div v-if="hud.objectives" class="vx-obj">
                <div class="vx-obj-title">{{ hud.objectives.title }}</div>
                <TransitionGroup name="vx-objstep" tag="div" class="vx-obj-steps">
                    <div v-for="step in hud.objectives.steps" :key="step.text" class="vx-obj-step" :class="{ 'vx-obj-done': step.done, 'vx-obj-active': step.active }">
                        <i />
                        <span>{{ step.text }}</span>
                        <b v-if="step.progress && !step.done">{{ step.progress }}</b>
                        <em v-if="fraction(step.progress) !== null && !step.done" :style="{ '--p': fraction(step.progress) ?? 0 }" />
                    </div>
                </TransitionGroup>
                <Transition name="vx-swap" mode="out-in">
                    <p v-if="hud.objectives.hint" :key="hud.objectives.hint" class="vx-obj-hint">{{ hud.objectives.hint }}</p>
                </Transition>
            </div>
        </div>

        <!-- Top centre: boss bar and target -->
        <div class="vx-tc">
            <Transition name="vx-drop">
                <div v-if="hud.warden" class="vx-boss" :class="{ 'vx-boss-locked': (hud.warden.locks ?? 0) > 0, 'vx-boss-hit': bossHit }">
                    <div class="vx-boss-head">
                        <i /><UIcon :name="hud.warden.carrier ? 'i-lucide-ship' : 'i-lucide-skull'" /><span>{{ hud.warden.name }}</span><i />
                    </div>
                    <div class="vx-boss-bar">
                        <div class="vx-boss-ghost" :style="{ width: pct(hud.warden.hp, hud.warden.maxHp) }" />
                        <div class="vx-boss-hull" :style="{ width: pct(hud.warden.hp, hud.warden.maxHp) }" />
                        <div v-if="hud.warden.shieldMax > 0" class="vx-boss-shield" :style="{ width: pct(hud.warden.shield, hud.warden.maxHp) }" />
                        <template v-if="!hud.warden.carrier"><b style="left: 33.3%" /><b style="left: 66.6%" /></template>
                        <b v-for="m in hud.warden.marks ?? []" :key="m" :style="{ left: `${m * 100}%` }" />
                    </div>
                    <div class="vx-boss-foot">
                        <template v-if="hud.warden.carrier">
                            <span v-if="hud.warden.locks" class="vx-boss-note"><UIcon name="i-lucide-shield" />{{ hud.warden.lockLabel ?? 'Reactors' }}</span>
                            <span class="vx-pips"><i v-for="n in hud.warden.locks ?? 0" :key="n" class="vx-pip-lock" /></span>
                        </template>
                        <template v-else>
                            <span class="vx-pips"><i v-for="n in 3" :key="n" :class="{ 'vx-pip-spent': n < bossPhase, 'vx-pip-now': n === bossPhase }" /></span>
                            <span v-if="hud.warden.shield > 0" class="vx-boss-note"><UIcon name="i-lucide-shield" />Energy weapons strip it</span>
                        </template>
                    </div>
                </div>
            </Transition>
            <Transition name="vx-drop">
                <div v-if="hud.target && !(hud.warden && hud.target.name === hud.warden.name)" class="vx-target" :class="`vx-target-${targetTone}`">
                    <svg viewBox="0 0 32 32" class="vx-target-glyph">
                        <path v-if="hud.target.kind === 'rock'" d="M9 5l12-1 7 9-3 12-12 3-9-8 1-10z" />
                        <path v-else-if="hud.target.kind === 'crate'" d="M5 10l11-5 11 5v12l-11 5-11-5zM5 10l11 5 11-5M16 15v12" />
                        <path v-else d="M16 3l4 11 9 8-9-2-4 9-4-9-9 2 9-8z" />
                    </svg>
                    <div class="vx-target-body">
                        <div class="vx-target-line">
                            <span class="vx-target-name">{{ hud.target.name }}</span>
                            <em v-if="hud.target.detail">{{ hud.target.detail }}</em>
                            <b>{{ dist(hud.target.dist) }}</b>
                        </div>
                        <div v-if="hud.target.shieldMax > 0" class="vx-target-bar vx-target-shield"><div :style="{ width: pct(hud.target.shield, hud.target.shieldMax) }" /></div>
                        <div class="vx-target-bar"><div :style="{ width: pct(hud.target.hp, hud.target.maxHp) }" /></div>
                    </div>
                </div>
            </Transition>
        </div>
        <TransitionGroup name="vx-toast" tag="div" class="vx-toasts">
            <div v-for="t in toasts" :key="t.id" class="vx-toast" :class="`vx-toast-${t.tone}`"><i />{{ t.text }}</div>
        </TransitionGroup>

        <!-- Bottom left: ship vitals -->
        <div class="vx-bl">
            <div v-if="hud.systems?.subsystems.length" class="vx-subsys">
                <span v-for="s in hud.systems.subsystems" :key="s.id"><UIcon name="i-lucide-triangle-alert" />{{ subsystemName(s.id) }} {{ Math.ceil(s.left) }}s</span>
            </div>
            <div class="vx-ship">
                <span class="vx-ship-name">{{ run?.shipName }}</span>
                <span class="vx-speed" :class="{ 'vx-speed-boost': hud.boosting }">{{ Math.round(hud.speed) }}<small>m/s</small></span>
            </div>
            <div class="vx-vital vx-vital-shield" :class="{ 'vx-vital-hit': shieldHit, 'vx-vital-down': hud.maxShield > 0 && hud.shield <= 0 }">
                <UIcon name="i-lucide-shield" />
                <div class="vx-vital-track">
                    <div class="vx-vital-ghost" :style="{ width: pct(hud.shield, hud.maxShield) }" />
                    <div class="vx-vital-fill" :style="{ width: pct(hud.shield, hud.maxShield) }" />
                </div>
                <b>{{ Math.ceil(hud.shield) }}</b>
            </div>
            <div class="vx-vital vx-vital-hull" :class="{ 'vx-vital-hit': hullHit, 'vx-vital-low': hud.lowHull }">
                <UIcon name="i-lucide-heart-pulse" />
                <div class="vx-vital-track">
                    <div class="vx-vital-ghost" :style="{ width: pct(hud.hull, hud.maxHull) }" />
                    <div class="vx-vital-fill" :style="{ width: pct(hud.hull, hud.maxHull) }" />
                </div>
                <b>{{ Math.ceil(hud.hull) }}</b>
            </div>
        </div>

        <!-- Bottom centre: action bar -->
        <div class="vx-bar">
            <div v-if="hud.skill" class="vx-slot vx-slot-lg" :class="slotState(hud.skill.ready, hud.skill.active)" :style="{ '--c': hud.skill.color, '--p': hud.skill.active ? hud.skill.activeFrac : Math.min(1, hud.skill.ready) }">
                <div class="vx-slot-face"><UIcon :name="SKILL_ICONS[hud.skill.id] ?? 'i-lucide-sparkles'" /></div>
                <kbd>Q</kbd>
                <b v-if="hud.skill.stacks">×{{ hud.skill.stacks }}</b>
                <span>{{ hud.skill.name }}</span>
            </div>
            <div v-if="hud.abilityName" class="vx-slot vx-slot-lg" :class="slotState(hud.abilityReady, hud.abilityActive)" :style="{ '--c': '#ffd27a', '--p': Math.max(0, Math.min(1, hud.abilityReady)) }">
                <div class="vx-slot-face"><UIcon name="i-lucide-zap" /></div>
                <kbd>R</kbd>
                <span>{{ hud.abilityName }}</span>
            </div>
            <template v-if="hud.systems">
                <div v-if="hud.systems.secondary" class="vx-slot" :class="[slotState(hud.systems.secondary.ammo > 0 ? hud.systems.secondary.ready : 0, hud.systems.secondary.locked), { 'vx-slot-locking': hud.systems.secondary.lock > 0 }]" :style="{ '--c': '#ff6b7d', '--p': hud.systems.secondary.lock > 0 ? hud.systems.secondary.lock : hud.systems.secondary.ready }">
                    <div class="vx-slot-face"><UIcon name="i-lucide-rocket" /></div>
                    <kbd>E</kbd>
                    <b>{{ hud.systems.secondary.ammo }}</b>
                    <span>{{ hud.systems.secondary.locked ? 'Locked' : hud.systems.secondary.name }}</span>
                </div>
                <div v-if="hud.systems.device" class="vx-slot" :class="slotState(hud.systems.device.ready, hud.systems.device.active)" :style="{ '--c': '#9fe8ff', '--p': Math.min(1, hud.systems.device.ready) }">
                    <div class="vx-slot-face"><UIcon name="i-lucide-cpu" /></div>
                    <kbd>G</kbd>
                    <span>{{ hud.systems.device.name }}</span>
                </div>
                <div class="vx-slot" :class="slotState(hud.systems.scan, false)" :style="{ '--c': '#7dffc8', '--p': Math.min(1, hud.systems.scan) }">
                    <div class="vx-slot-face"><UIcon name="i-lucide-radar" /></div>
                    <kbd>T</kbd>
                    <span>Scan</span>
                </div>
            </template>
            <i v-if="hud.supplies.length" class="vx-bar-split" />
            <div v-for="s in hud.supplies" :key="s.id" class="vx-slot vx-slot-sm" :class="s.count ? 'vx-slot-ready' : 'vx-slot-empty'" :style="{ '--c': s.color, '--p': 1 }">
                <div class="vx-slot-face"><UIcon :name="SUPPLY_ICONS[s.id] ?? 'i-lucide-box'" /></div>
                <kbd>{{ s.key }}</kbd>
                <b>{{ s.count }}</b>
            </div>
        </div>

        <!-- Bottom right: the hold -->
        <div class="vx-br" :class="{ 'vx-bump': bump, 'vx-hold-full': holdFull }">
            <div class="vx-hold-head">
                <span><UIcon name="i-lucide-container" />{{ holdFull ? 'Hold full' : 'Hold' }}</span>
                <b>{{ hud.cargoUnits }}<small>/{{ hud.cargoCap }}</small></b>
            </div>
            <div class="vx-hold-gauge" :style="{ '--p': Math.min(1, hud.cargoUnits / Math.max(1, hud.cargoCap)) }"><div /></div>
            <TransitionGroup name="vx-cargo" tag="div" class="vx-hold-list">
                <div v-for="item in cargoList" :key="item.id" class="vx-hold-item" :class="{ 'vx-hold-new': recent[item.id] }">
                    <i class="vr-gem" :style="{ '--c': item.hex }" />
                    <span>{{ item.name }}</span>
                    <b>{{ item.amount }}</b>
                </div>
            </TransitionGroup>
            <div class="vx-hold-foot">
                <span v-if="hud.systems" class="vx-chip vx-chip-fuel" :class="{ 'vx-chip-dim': !hud.systems.fuel }"><UIcon name="i-lucide-fuel" />{{ hud.systems.fuel }}</span>
                <span v-if="hud.relics" class="vx-chip vx-chip-relic"><UIcon name="i-lucide-gem" />{{ hud.relics }}</span>
                <span v-if="hud.gearCaches" class="vx-chip vx-chip-gear"><UIcon name="i-lucide-package" />{{ hud.gearCaches }}</span>
                <span v-if="cargoValue > 0" class="vx-hold-value"><UIcon name="i-lucide-coins" />{{ formatNumber(cargoValue) }}</span>
            </div>
        </div>

        <!-- Prompts above the action bar -->
        <div class="vx-prompts">
            <Transition name="vx-rise" mode="out-in">
                <div v-if="hud.dock && hud.phase === 'flying'" key="dock" class="vx-prompt vx-prompt-dock">
                    <div class="vx-ring" :style="{ '--p': hud.dock.progress }"><kbd>F</kbd></div>
                    <div>
                        <div class="vx-prompt-title">Hold to dock · {{ hud.dock.label }}</div>
                        <div class="vx-prompt-sub">Bank the hold<template v-if="hud.wardenKilled"> · claim the sector</template></div>
                    </div>
                </div>
                <div v-else-if="hud.trader && hud.phase === 'flying'" key="trade" class="vx-prompt">
                    <div class="vx-ring"><kbd>F</kbd></div>
                    <div class="vx-prompt-title">Trade</div>
                </div>
            </Transition>
        </div>

        <Transition name="vx-rise">
            <div v-if="hud.outOfBounds" class="vx-bounds"><UIcon name="i-lucide-triangle-alert" />Uncharted space<small>Patrols hit harder out here</small></div>
        </Transition>

        <Transition name="vx-banner">
            <div v-if="banner" :key="banner.id" class="vx-banner" :class="`vx-banner-${banner.tone}`">
                <div class="vx-banner-rule" />
                <div class="vx-banner-title">{{ banner.title }}</div>
                <div class="vx-banner-sub">{{ banner.subtitle }}</div>
                <VoidZoneChips v-if="banner.zone" :zone="banner.zone.id" :depth="banner.zone.depth" center />
                <div class="vx-banner-rule" />
            </div>
        </Transition>
        <Transition name="vx-streak">
            <div v-if="hud.streak" :key="hud.streak" class="vx-streak" :class="{ 'vx-streak-big': hud.streak >= 8 }">
                <b>×{{ hud.streak }}</b>
                <span>{{ streakName(hud.streak) }}</span>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { VOID_RESOURCE_IDS, voidBundleValue, voidHex, voidResource, type VoidResourceBundle } from '#shared/utils/gamelogic/void'
import type { HudState } from '~/utils/void/types'

const props = defineProps<{
    hud: HudState
    run: { sectorName: string, shipName: string } | null
    toasts: { id: number, text: string, tone: string }[]
    banner?: { id: number, title: string, subtitle: string, tone: string, zone?: { id: string, depth: number } } | null
    priceMult?: number
}>()

const SKILL_ICONS: Record<string, string> = {
    seeker: 'i-lucide-rocket',
    shockwave: 'i-lucide-radio',
    berserk: 'i-lucide-flame',
    wingmen: 'i-lucide-send',
    overdrive: 'i-lucide-gauge',
    strike: 'i-lucide-satellite-dish'
}
const SUPPLY_ICONS: Record<string, string> = { nanites: 'i-lucide-wrench', cell: 'i-lucide-battery-charging', emp: 'i-lucide-zap' }
const SUBSYSTEMS: Record<string, string> = { engines: 'Engines', weapons: 'Weapons', shields: 'Shields', shield: 'Shields' }

function subsystemName(id: string) {
    return SUBSYSTEMS[id] ?? id
}

function streakName(n: number) {
    return n >= 12 ? 'Annihilation' : n >= 8 ? 'Rampage' : n >= 5 ? 'Onslaught' : 'Streak'
}

function slotState(ready: number, active: boolean) {
    return active ? 'vx-slot-active' : ready >= 1 ? 'vx-slot-ready' : 'vx-slot-cooling'
}

/** "3/5" style progress as 0-1, so a step can show a bar under its text. */
function fraction(progress?: string) {
    const m = progress?.match(/^\s*([\d.]+)\s*\/\s*([\d.]+)/)
    if (!m) return null
    return Math.max(0, Math.min(1, Number(m[1]) / Math.max(1, Number(m[2]))))
}

const bossPhase = computed(() => {
    const w = props.hud.warden
    if (!w) return 1
    const frac = w.hp / Math.max(1, w.maxHp)
    return frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3
})

const targetTone = computed(() => {
    const t = props.hud.target
    return !t ? 'idle' : t.kind === 'rock' ? 'rock' : t.kind === 'crate' ? 'crate' : !t.hostile ? 'friend' : t.detail ? 'elite' : 'hostile'
})

const holdFull = computed(() => props.hud.cargoUnits >= props.hud.cargoCap)

/** A one-shot class that drops itself, for hit flashes driven by a falling number. */
function useFlash(source: () => number, ms: number) {
    const on = ref(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    watch(source, (now, before) => {
        if (now >= before - 0.5) return
        on.value = true
        clearTimeout(timer)
        timer = setTimeout(() => {
            on.value = false
        }, ms)
    })
    onBeforeUnmount(() => clearTimeout(timer))
    return on
}

const hullHit = useFlash(() => props.hud.hull, 260)
const shieldHit = useFlash(() => props.hud.shield, 220)
const bossHit = useFlash(() => (props.hud.warden ? props.hud.warden.hp + props.hud.warden.shield : 0), 160)

const bump = ref(false)
const recent = ref<Record<string, boolean>>({})
let bumpTimer: ReturnType<typeof setTimeout> | undefined
const timers: Record<string, ReturnType<typeof setTimeout>> = {}

// Flash the hold panel and the row that grew whenever loot lands.
watch(() => ({ ...props.hud.cargo }), (now, before) => {
    let grew = false
    for (const [id, amount] of Object.entries(now)) {
        if ((amount ?? 0) > ((before as Record<string, number | undefined>)[id] ?? 0)) {
            grew = true
            recent.value = { ...recent.value, [id]: true }
            clearTimeout(timers[id])
            timers[id] = setTimeout(() => {
                recent.value = { ...recent.value, [id]: false }
            }, 450)
        }
    }
    if (!grew) return
    bump.value = true
    clearTimeout(bumpTimer)
    bumpTimer = setTimeout(() => {
        bump.value = false
    }, 320)
})

onBeforeUnmount(() => {
    clearTimeout(bumpTimer)
    for (const t of Object.values(timers)) clearTimeout(t)
})

const cargoList = computed(() => bundleItems(props.hud.cargo))
const cargoValue = computed(() => Math.round(voidBundleValue(props.hud.cargo) * (props.priceMult ?? 1)))

function bundleItems(bundle: VoidResourceBundle) {
    return VOID_RESOURCE_IDS
        .filter(id => (bundle[id] ?? 0) > 0)
        .map(id => ({ id, name: voidResource(id).name, hex: voidHex(voidResource(id).color), amount: bundle[id]! }))
}

function pct(v: number, max: number) {
    return `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`
}

function dist(d: number) {
    return d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`
}

function clock(seconds: number) {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>
