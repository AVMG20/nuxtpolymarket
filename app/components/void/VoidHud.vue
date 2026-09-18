<template>
    <div class="vr-hud pointer-events-none">
        <!-- Top left: sector and run -->
        <div class="vr-hud-tl">
            <div class="vr-sector-name">{{ run?.sectorName }}</div>
            <div class="vr-run-meta">
                <span>{{ clock(hud.elapsed) }}</span>
                <span class="vr-dot" />
                <span>{{ hud.kills }} kills</span>
            </div>
            <div class="vr-wanted" :class="{ 'vr-wanted-hot': hud.wanted >= 4 }" :title="wantedHint">
                <span>Wanted</span>
                <i v-for="n in 5" :key="n" :class="{ 'vr-star-on': n <= hud.wanted }">★</i>
            </div>
            <div v-if="hud.systems && hud.systems.depth > 1" class="vr-zone">Jump {{ hud.systems.depth }} · {{ hud.systems.zone }}</div>
            <div v-if="hud.wardenKilled" class="vr-warden-done">Warden down · dock to claim</div>
            <!-- Objectives -->
            <div v-if="hud.objectives" class="vr-objectives">
                <div class="vr-obj-title">{{ hud.objectives.title }}</div>
                <TransitionGroup name="vr-obj" tag="div">
                    <div v-for="step in hud.objectives.steps" :key="step.text" class="vr-obj-step" :class="{ 'vr-obj-done': step.done, 'vr-obj-active': step.active }">
                        <i />
                        <span>{{ step.text }}</span>
                        <b v-if="step.progress">{{ step.progress }}</b>
                    </div>
                </TransitionGroup>
                <p v-if="hud.objectives.hint" class="vr-obj-hint">{{ hud.objectives.hint }}</p>
            </div>
        </div>

        <!-- Top centre: boss, target, toasts -->
        <div class="vr-hud-tc">
            <div v-if="hud.warden" class="vr-boss">
                <div class="vr-boss-name">{{ hud.warden.name }}</div>
                <div class="vr-boss-bar">
                    <div class="vr-boss-hull" :style="{ width: `${(hud.warden.hp / hud.warden.maxHp) * 100}%` }" />
                    <div v-if="hud.warden.shieldMax > 0" class="vr-boss-shield" :style="{ width: `${(hud.warden.shield / hud.warden.maxHp) * 100}%` }" />
                    <i style="left: 33%" /><i style="left: 66%" />
                </div>
                <div v-if="hud.warden.shield > 0" class="vr-boss-note">Shield holding · energy weapons strip it fastest</div>
            </div>
            <TransitionGroup name="vr-toast" tag="div" class="vr-toasts">
                <div v-for="t in toasts" :key="t.id" class="vr-toast" :class="`vr-toast-${t.tone}`">{{ t.text }}</div>
            </TransitionGroup>
        </div>

        <!-- Bottom left: hull / shield -->
        <div class="vr-hud-bl">
            <div class="vr-ship-line">
                <span class="vr-ship-name">{{ run?.shipName }}</span>
                <span class="vr-speed">{{ Math.round(hud.speed) }} <small>m/s</small></span>
            </div>
            <div class="vr-meter vr-meter-shield">
                <label>SHD</label>
                <div class="vr-meter-track"><div :style="{ width: pct(hud.shield, hud.maxShield) }" /></div>
                <span>{{ Math.ceil(hud.shield) }}</span>
            </div>
            <div class="vr-meter vr-meter-hull" :class="{ 'vr-critical': hud.lowHull }">
                <label>HULL</label>
                <div class="vr-meter-track"><div :style="{ width: pct(hud.hull, hud.maxHull) }" /></div>
                <span>{{ Math.ceil(hud.hull) }}</span>
            </div>
            <div v-if="hud.skill" class="vr-ability vr-skill" :class="{ 'vr-ready': hud.skill.ready >= 1, 'vr-active': hud.skill.active }" :style="{ '--sc': hud.skill.color }">
                <kbd>Q</kbd>
                <div>
                    <div class="vr-ability-name">{{ hud.skill.name }}<small v-if="hud.skill.stacks"> ×{{ hud.skill.stacks }}</small></div>
                    <div class="vr-ability-track"><div :style="{ width: `${(hud.skill.active ? hud.skill.activeFrac : Math.min(1, hud.skill.ready)) * 100}%` }" /></div>
                </div>
            </div>
            <div v-if="hud.systems?.subsystems.length" class="vr-subsys">
                <span v-for="s in hud.systems.subsystems" :key="s.id">{{ subsystemName(s.id) }} offline · {{ Math.ceil(s.left) }}s</span>
            </div>
            <div v-if="hud.systems" class="vr-sys">
                <div v-if="hud.systems.secondary" class="vr-sys-chip" :class="{ 'vr-sys-lock': hud.systems.secondary.locked }" :title="hud.systems.secondary.name">
                    <kbd>E</kbd>{{ hud.systems.secondary.ammo }}/{{ hud.systems.secondary.max }}
                    <i :style="{ width: `${(hud.systems.secondary.lock > 0 ? hud.systems.secondary.lock : hud.systems.secondary.ready) * 100}%` }" />
                </div>
                <div v-if="hud.systems.device" class="vr-sys-chip" :class="{ 'vr-sys-on': hud.systems.device.active }" :title="`${hud.systems.device.name}: ${hud.systems.device.effect}`">
                    <kbd>G</kbd>{{ hud.systems.device.ready >= 1 ? hud.systems.device.name : `${Math.round(hud.systems.device.ready * 100)}%` }}
                    <i :style="{ width: `${hud.systems.device.ready * 100}%` }" />
                </div>
                <div class="vr-sys-chip" title="Scan: marks hidden caches and data logs nearby">
                    <kbd>T</kbd>Scan for loot
                    <i :style="{ width: `${hud.systems.scan * 100}%` }" />
                </div>
                <div class="vr-sys-chip" title="Jump fuel">
                    <UIcon name="i-lucide-fuel" class="size-3" />{{ hud.systems.fuel }}
                </div>
            </div>
            <div class="vr-supplies">
                <div v-for="s in hud.supplies" :key="s.id" class="vr-supply" :class="{ 'vr-supply-out': !s.count }" :style="{ '--sc': s.color }" :title="s.name">
                    <kbd>{{ s.key }}</kbd><b>{{ s.count }}</b>
                </div>
                <div v-if="hud.relics" class="vr-supply vr-relic-count" title="Relic caches">
                    <UIcon name="i-lucide-gem" class="size-3" /><b>{{ hud.relics }}</b>
                </div>
                <div v-if="hud.gearCaches" class="vr-supply vr-gear-count" title="Salvaged gear caches, opened when you extract">
                    <UIcon name="i-lucide-package" class="size-3" /><b>{{ hud.gearCaches }}</b>
                </div>
            </div>
            <div v-if="hud.abilityName" class="vr-ability" :class="{ 'vr-ready': hud.abilityReady >= 1, 'vr-active': hud.abilityActive }">
                <kbd>R</kbd>
                <div>
                    <div class="vr-ability-name">{{ hud.abilityName }}</div>
                    <div class="vr-ability-track"><div :style="{ width: `${Math.min(1, hud.abilityReady) * 100}%` }" /></div>
                </div>
            </div>
        </div>

        <!-- Bottom right: cargo -->
        <div class="vr-hud-br" :class="{ 'vr-bump': bump }">
            <div class="vr-cargo-head">
                <span>Hold</span>
                <span :class="{ 'vr-full': hud.cargoUnits >= hud.cargoCap }">{{ hud.cargoUnits }} / {{ hud.cargoCap }}</span>
            </div>
            <div class="vr-cargo-track"><div :style="{ width: pct(hud.cargoUnits, hud.cargoCap) }" /></div>
            <div class="vr-cargo-list">
                <div v-for="item in cargoList" :key="item.id" class="vr-cargo-item" :class="{ 'vr-cargo-new': recent[item.id] }">
                    <i class="vr-gem" :style="{ '--c': item.hex }" />
                    <span>{{ item.name }}</span>
                    <b>{{ item.amount }}</b>
                </div>
                <div v-if="!cargoList.length" class="vr-cargo-empty">Empty. Shoot ore-veined rocks.</div>
            </div>
            <div v-if="cargoValue > 0" class="vr-cargo-value">≈ {{ formatNumber(cargoValue) }} coins</div>
        </div>

        <!-- Dock prompt -->
        <div v-if="hud.dock && hud.phase === 'flying'" class="vr-dock">
            <div class="vr-dock-ring" :style="{ '--p': hud.dock.progress }">
                <kbd>F</kbd>
            </div>
            <div>
                <div class="vr-dock-title">Hold F to dock at {{ hud.dock.label.toLowerCase() }}</div>
                <div class="vr-dock-sub">Bank {{ hud.cargoUnits }} units<template v-if="hud.wardenKilled"> and claim the sector</template></div>
            </div>
        </div>

        <div v-if="hud.outOfBounds" class="vr-bounds">Uncharted space · patrols hit harder out here</div>
        <div v-if="hud.trader && hud.phase === 'flying'" class="vr-prompt">Press <kbd>F</kbd> to trade</div>

        <Transition name="vr-banner">
            <div v-if="banner" :key="banner.id" class="vr-banner" :class="`vr-banner-${banner.tone}`">
                <div class="vr-banner-line" />
                <div class="vr-banner-title">{{ banner.title }}</div>
                <div class="vr-banner-sub">{{ banner.subtitle }}</div>
                <div class="vr-banner-line" />
            </div>
        </Transition>
        <Transition name="vr-streak">
            <div v-if="hud.streak" :key="hud.streak" class="vr-streak">
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
    banner?: { id: number, title: string, subtitle: string, tone: string } | null
    priceMult?: number
}>()

const WANTED_HINT = [
    'Nobody is looking for you. Fight to draw them out.',
    'A wing is looking for you.',
    'Patrols are hunting you.',
    'Heavy wings, coming often.',
    'They arrive faster than you can lose them. Bank your hold.',
    'Everything in the sector is coming for you.'
]

const wantedHint = computed(() => `${WANTED_HINT[props.hud.wanted] ?? ''} Kills raise it; breaking away lowers it.`)

const SUBSYSTEMS: Record<string, string> = { engines: 'Engines', weapons: 'Weapons', shield: 'Shield' }

function subsystemName(id: string) {
    return SUBSYSTEMS[id] ?? id
}

function streakName(n: number) {
    return n >= 12 ? 'Annihilation' : n >= 8 ? 'Rampage' : n >= 5 ? 'Onslaught' : 'Streak'
}

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
    bump.value = false
    requestAnimationFrame(() => {
        bump.value = true
    })
    clearTimeout(bumpTimer)
    bumpTimer = setTimeout(() => {
        bump.value = false
    }, 300)
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

function clock(seconds: number) {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>
