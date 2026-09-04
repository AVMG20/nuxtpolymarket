<script lang="ts">
// Every import lives in this block: `<script setup>` is compiled after it, so
// an import down there would sit below these declarations in the module.
import {
    meadowbrawlRushGemCost,
    type MeadowbrawlAccountEffects,
    type MeadowbrawlPetEffects,
    type MeadowbrawlPetId,
    type MeadowbrawlRunSave,
    type MeadowbrawlUpgradeId,
    type MeadowbrawlUpgradeLevels,
    type MeadowbrawlWeaponId
} from '#shared/utils/gamelogic/meadowbrawl-meta'
import { WEAPONS, WEAPON_IDS } from '~/utils/meadowbrawl/weapons'

/** Artwork for the pet abilities — the shared defs carry names, not icons. */
export const PET_ABILITY_ICONS: Record<string, string> = {
    flameDash: 'i-lucide-flame',
    cinderHowl: 'i-lucide-crosshair',
    shellWard: 'i-lucide-shield',
    mendingBloom: 'i-lucide-flower-2',
    gust: 'i-lucide-wind',
    luckyFeather: 'i-lucide-feather'
}

export interface MeadowbrawlShopUpgrade {
    id: MeadowbrawlUpgradeId
    name: string
    description: string
    icon: string
    max: number
    level: number
    cost: number | null
}

export interface MeadowbrawlShopPetAbility {
    id: string
    name: string
    description: string
    cooldown: number
    unlockLevel: number
}

export interface MeadowbrawlShopPet {
    id: MeadowbrawlPetId
    name: string
    tagline: string
    color: string
    passive: { name: string, description: string }
    abilities: MeadowbrawlShopPetAbility[]
    level: number
    max: number
    cost: number | null
    effects: MeadowbrawlPetEffects | null
    nextEffects: MeadowbrawlPetEffects | null
}

export interface MeadowbrawlFeat {
    weapon: MeadowbrawlWeaponId
    requires: MeadowbrawlWeaponId
    clearWave: number
    title: string
    description: string
    done: boolean
    progress: number
}

export interface MeadowbrawlActiveRun {
    startedAt: string
    weapon: MeadowbrawlWeaponId | null
    pet: MeadowbrawlPetId | null
    petLevel: number
    coinMult: number
    revision: number
    save: MeadowbrawlRunSave | null
}

/** Exactly what `GET /api/meadowbrawl/state` answers, once serialised. */
export interface MeadowbrawlMetaState {
    balance: string
    levels: MeadowbrawlUpgradeLevels
    effects: MeadowbrawlAccountEffects
    coinMult: number
    totalUpgradeCost: number
    upgrades: MeadowbrawlShopUpgrade[]
    pets: MeadowbrawlShopPet[]
    activePet: MeadowbrawlPetId | null
    weapons: {
        unlocked: MeadowbrawlWeaponId[]
        feats: MeadowbrawlFeat[]
    }
    bestWaveByWeapon: Record<string, number>
    stats: {
        runsPlayed: number
        victories: number
        totalEarned: string
        bestEarned: number
        bestWave: number
    }
    activeRun: MeadowbrawlActiveRun | null
    runCooldown: {
        remainingMs: number
        totalMs: number
        rushGems: number
        until: string | null
    }
}
</script>

<script setup lang="ts">
/** Re-bound here so the template can reach it — plain-script consts cannot. */
const weaponDefs = WEAPONS

const props = defineProps<{
    /** Null while the first `state` fetch is still in the air. */
    state: MeadowbrawlMetaState | null
    loading: boolean
    /** Key of the action currently in flight, so only that button spins. */
    busy: string | null
    /** False when there is no session — the endpoints would 401. */
    signedIn: boolean
}>()

const emit = defineEmits<{
    start: [weapon: MeadowbrawlWeaponId]
    resume: []
    abandon: []
    equip: [petId: MeadowbrawlPetId | null]
    buyUpgrade: [upgradeId: MeadowbrawlUpgradeId]
    buyPet: [petId: MeadowbrawlPetId]
    rush: []
}>()

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

type TabId = 'play' | 'homestead' | 'pets' | 'feats'
const TABS: { id: TabId, label: string, icon: string }[] = [
    { id: 'play', label: 'Play', icon: 'i-lucide-swords' },
    { id: 'homestead', label: 'Homestead', icon: 'i-lucide-home' },
    { id: 'pets', label: 'Pets', icon: 'i-lucide-paw-print' },
    { id: 'feats', label: 'Feats', icon: 'i-lucide-trophy' }
]
const tab = ref<TabId>('play')

const selectedWeapon = ref<MeadowbrawlWeaponId>('sword')

// The cooldown ticks against the wall clock, not against the fetched
// snapshot, so the countdown keeps running between state refreshes.
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
    ticker = setInterval(() => { now.value = Date.now() }, 500)
})
onBeforeUnmount(() => {
    if (ticker) clearInterval(ticker)
})

const activeRun = computed(() => props.state?.activeRun ?? null)
const unlocked = computed(() => props.state?.weapons.unlocked ?? [])
const featByWeapon = computed(() => {
    const map = {} as Record<string, MeadowbrawlFeat>
    for (const feat of props.state?.weapons.feats ?? []) map[feat.weapon] = feat
    return map
})

const weaponCards = computed(() => WEAPON_IDS.map(id => ({
    id,
    def: WEAPONS[id],
    locked: !unlocked.value.includes(id),
    feat: featByWeapon.value[id] ?? null,
    best: props.state?.bestWaveByWeapon[id] ?? 0
})))

const adoptedPets = computed(() => (props.state?.pets ?? []).filter(p => p.level > 0))

const cooldownMs = computed(() => {
    const until = props.state?.runCooldown.until
    if (!until) return 0
    return Math.max(0, Date.parse(until) - now.value)
})
const rushGems = computed(() => meadowbrawlRushGemCost(cooldownMs.value))
const gems = computed(() => user.value?.gems ?? 0)

const weaponLocked = computed(() => !unlocked.value.includes(selectedWeapon.value))
const canFight = computed(() => !!props.state && !activeRun.value && cooldownMs.value <= 0 && !weaponLocked.value)

function formatCountdown(ms: number): string {
    const total = Math.ceil(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const mm = m.toString().padStart(2, '0')
    const ss = s.toString().padStart(2, '0')
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

function pickWeapon(id: MeadowbrawlWeaponId) {
    if (!unlocked.value.includes(id)) return
    selectedWeapon.value = id
}

function affordable(cost: number | null): boolean {
    return cost !== null && balance.value >= cost
}

const shopLocked = computed(() => !!activeRun.value)

const petAbilityIcon = (id: string) => PET_ABILITY_ICONS[id] ?? 'i-lucide-sparkles'

function petAbilityCooldown(pet: MeadowbrawlShopPet, ability: MeadowbrawlShopPetAbility): number {
    return pet.effects?.abilities.find(a => a.id === ability.id)?.cooldown ?? ability.cooldown
}

const pct = (mult: number) => `${Math.round((mult - 1) * 1000) / 10}%`

/** What one more level of a pet actually buys, as short before → after lines. */
function petChanges(pet: MeadowbrawlShopPet): string[] {
    const next = pet.nextEffects
    if (!next) return []
    const from = pet.effects
    const lines: string[] = []
    if (next.damageMult > 1) lines.push(`Damage +${pct(from?.damageMult ?? 1)} → +${pct(next.damageMult)}`)
    if (next.maxHp > 0) lines.push(`Max health +${from?.maxHp ?? 0} → +${next.maxHp}`)
    if (next.damageReduction > 0) lines.push(`Damage taken −${Math.round((from?.damageReduction ?? 0) * 100)}% → −${Math.round(next.damageReduction * 100)}%`)
    if (next.coinMult > 1) lines.push(`Coin value +${pct(from?.coinMult ?? 1)} → +${pct(next.coinMult)}`)
    if (next.pickupMult > 1) lines.push(`Pickup radius +${pct(from?.pickupMult ?? 1)} → +${pct(next.pickupMult)}`)
    const gained = next.abilities.filter(a => !(from?.abilities ?? []).some(b => b.id === a.id))
    for (const a of gained) lines.push(`Unlocks ${a.name}`)
    if (next.potency > (from?.potency ?? 1)) lines.push('Abilities hit twice as hard')
    return lines
}
</script>

<template>
  <div class="absolute inset-0 flex items-center justify-center p-3 sm:p-4 bg-black/45">
    <!-- Signed out ------------------------------------------------------- -->
    <div v-if="!signedIn" class="w-full max-w-md rounded-2xl bg-black/70 backdrop-blur-sm ring-1 ring-white/10 p-6 sm:p-8 text-white text-center">
      <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-amber-200">A melee survival roguelite</div>
      <h1 class="mt-1 text-4xl sm:text-5xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">Meadowbrawl</h1>
      <p class="mt-3 text-sm text-white/70">Sign in to play Meadowbrawl — your homestead, your pets and everything a run pays out live on your account.</p>
      <div class="mt-6 flex justify-center">
        <UButton to="/login" size="lg" color="primary" icon="i-lucide-log-in" class="font-black">Sign in to play</UButton>
      </div>
    </div>

    <!-- Loading ---------------------------------------------------------- -->
    <div v-else-if="!state" class="w-full max-w-md rounded-2xl bg-black/70 backdrop-blur-sm ring-1 ring-white/10 p-8 text-white text-center">
      <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-amber-200" />
      <div class="mt-3 text-sm font-semibold text-white/70">Waking the meadow…</div>
    </div>

    <!-- Lobby ------------------------------------------------------------ -->
    <div v-else class="w-full max-w-5xl max-h-full overflow-y-auto rounded-2xl bg-black/70 backdrop-blur-sm ring-1 ring-white/10 p-4 sm:p-6 text-white">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-[10px] sm:text-[11px] uppercase tracking-[0.4em] font-bold text-amber-200">A melee survival roguelite</div>
          <h1 class="mt-0.5 text-3xl sm:text-5xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)] leading-none">Meadowbrawl</h1>
        </div>
        <div class="flex items-center gap-3 shrink-0 text-sm font-black tabular-nums">
          <CoinBalance :value="user?.balance" />
          <GemBalance :value="gems" />
        </div>
      </div>

      <!-- Tabs -->
      <div class="mt-4 flex flex-wrap items-center gap-1.5">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-black uppercase tracking-wider ring-1 transition-colors"
          :class="tab === t.id ? 'bg-amber-300/20 ring-amber-300/70 text-amber-200' : 'bg-white/5 ring-white/10 text-white/60 hover:bg-white/10 hover:text-white'"
          @click="tab = t.id"
        >
          <UIcon :name="t.icon" class="size-4" />{{ t.label }}
        </button>
        <div class="grow" />
        <div class="flex items-center gap-1.5 rounded-lg bg-amber-300/10 ring-1 ring-amber-300/30 px-2.5 py-1.5 text-xs font-black text-amber-200 tabular-nums" title="Every coin this run drops is worth this much">
          <UIcon :name="loading ? 'i-lucide-loader-circle' : 'i-lucide-coins'" class="size-4" :class="loading ? 'animate-spin' : ''" />Coins ×{{ state.coinMult.toFixed(2) }}
        </div>
      </div>

      <!-- Play ----------------------------------------------------------- -->
      <div v-if="tab === 'play'" class="mt-4">
        <!-- Resume / abandon -->
        <div v-if="activeRun" class="rounded-xl bg-emerald-400/10 ring-1 ring-emerald-300/40 p-3 sm:p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-[10px] uppercase tracking-[0.3em] font-black text-emerald-300">Run in progress</div>
              <div class="mt-0.5 text-lg font-black">
                {{ activeRun.weapon ? weaponDefs[activeRun.weapon].className : 'Unknown' }}
                <span v-if="activeRun.save" class="text-white/60 font-bold text-sm">· wave {{ activeRun.save.wave + 1 }} · {{ formatNumber(activeRun.save.coins) }} coins banked</span>
                <span v-else class="text-white/60 font-bold text-sm">· no checkpoint yet</span>
              </div>
              <div v-if="activeRun.save" class="text-[11px] text-white/50 font-semibold tabular-nums">
                {{ Math.ceil(activeRun.save.hp) }} / {{ activeRun.save.maxHp }} hp · {{ activeRun.save.stats.kills }} slain · coins ×{{ activeRun.coinMult.toFixed(2) }}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                v-if="activeRun.save"
                size="lg"
                color="primary"
                icon="i-lucide-play"
                class="font-black"
                :loading="busy === 'resume'"
                :disabled="!!busy"
                @click="emit('resume')"
              >
                Continue
              </UButton>
              <UButton
                size="lg"
                color="neutral"
                variant="soft"
                icon="i-lucide-flag"
                class="bg-white/10 hover:bg-white/20 text-white font-black"
                :loading="busy === 'abandon'"
                :disabled="!!busy"
                @click="emit('abandon')"
              >
                Abandon (collect {{ formatNumber(Math.floor((activeRun.save?.coins ?? 0) * activeRun.coinMult)) }})
              </UButton>
            </div>
          </div>
        </div>

        <!-- Classes -->
        <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <button
            v-for="w in weaponCards"
            :key="w.id"
            type="button"
            class="relative rounded-xl p-3 text-left ring-1 transition-all"
            :class="[
              w.locked
                ? 'bg-black/40 ring-white/10 opacity-60 cursor-not-allowed'
                : selectedWeapon === w.id
                  ? 'bg-amber-300/15 ring-amber-300/80 shadow-lg shadow-amber-400/20'
                  : 'bg-white/5 ring-white/10 hover:bg-white/10'
            ]"
            :disabled="w.locked"
            @click="pickWeapon(w.id)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-base font-black leading-tight">{{ w.def.className }}</div>
                <div class="text-[11px] text-white/80 font-semibold truncate">{{ w.def.name }} · {{ w.def.tagline }}</div>
              </div>
              <UIcon v-if="w.locked" name="i-lucide-lock" class="size-4 shrink-0 text-white/60" />
              <UIcon v-else-if="selectedWeapon === w.id" name="i-lucide-check" class="size-4 shrink-0 text-amber-300" />
            </div>

            <template v-if="w.locked">
              <div class="mt-2 text-[11px] leading-snug text-white/70">
                <span class="font-black text-amber-200/80">{{ w.feat?.title }}</span> — {{ w.feat?.description }}
              </div>
              <div v-if="w.feat" class="mt-1.5 text-[10.5px] font-bold text-white/50 tabular-nums">
                best: wave {{ w.feat.progress }}/{{ w.feat.clearWave }} with the {{ weaponDefs[w.feat.requires].name }}
              </div>
            </template>
            <template v-else>
              <div class="mt-1 text-[11px] text-amber-200 italic leading-snug">{{ w.def.classTagline }}</div>
              <div class="mt-2 space-y-0.5 text-[10.5px] text-white/65 leading-snug">
                <div><UKbd class="text-[9px]">RMB</UKbd> <span class="text-white/90 font-bold">{{ w.def.special.name }}</span></div>
                <div><UKbd class="text-[9px]">Q</UKbd> <span class="text-white/90 font-bold">{{ w.def.abilities[0].name }}</span></div>
                <div><UKbd class="text-[9px]">E</UKbd> <span class="text-white/90 font-bold">{{ w.def.abilities[1].name }}</span></div>
              </div>
              <div v-if="w.best > 0" class="mt-1.5 text-[10.5px] font-bold text-white/45 tabular-nums">best: wave {{ w.best }}</div>
            </template>
          </button>
        </div>

        <!-- Pet strip -->
        <div class="mt-4">
          <div class="text-[10px] uppercase tracking-[0.3em] font-black text-white/50">Companion</div>
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-lg px-3 py-1.5 text-xs font-black ring-1 transition-colors"
              :class="state.activePet === null ? 'bg-white/15 ring-white/40 text-white' : 'bg-white/5 ring-white/10 text-white/55 hover:bg-white/10'"
              :disabled="!!busy || shopLocked"
              @click="emit('equip', null)"
            >
              None
            </button>
            <button
              v-for="p in adoptedPets"
              :key="p.id"
              type="button"
              class="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-black ring-1 transition-colors disabled:opacity-50"
              :class="state.activePet === p.id ? 'bg-white/15 ring-white/40 text-white' : 'bg-white/5 ring-white/10 text-white/55 hover:bg-white/10'"
              :disabled="!!busy || shopLocked"
              @click="emit('equip', p.id)"
            >
              <span class="size-2.5 rounded-full" :style="{ backgroundColor: p.color }" />
              {{ p.name }}<span class="text-white/40">Lv {{ p.level }}</span>
            </button>
            <span v-if="!adoptedPets.length" class="text-[11px] font-semibold text-white/40">No pets adopted yet — see the Pets tab.</span>
          </div>
        </div>

        <!-- Fight / cooldown -->
        <div class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <div class="flex items-center gap-4 text-xs font-bold text-white/60 tabular-nums">
            <div>
              <div class="text-[10px] uppercase tracking-[0.25em] text-white/40">Best wave</div>
              <div class="text-lg font-black text-white">{{ state.stats.bestWave }}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.25em] text-white/40">Best payout</div>
              <div class="text-lg font-black text-white">{{ formatNumber(state.stats.bestEarned) }}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.25em] text-white/40">Runs</div>
              <div class="text-lg font-black text-white">{{ state.stats.runsPlayed }}<span v-if="state.stats.victories" class="text-amber-200 text-sm"> · {{ state.stats.victories }} won</span></div>
            </div>
          </div>

          <div v-if="cooldownMs > 0" class="flex items-center gap-3">
            <div class="text-right">
              <div class="text-[10px] uppercase tracking-[0.25em] font-black text-white/40">The meadow is recovering</div>
              <div class="text-2xl font-black tabular-nums text-white">{{ formatCountdown(cooldownMs) }}</div>
            </div>
            <UButton
              size="lg"
              color="primary"
              variant="soft"
              icon="i-lucide-gem"
              class="font-black"
              :loading="busy === 'rush'"
              :disabled="!!busy || gems < rushGems"
              @click="emit('rush')"
            >
              Rush for {{ rushGems }} 💎
            </UButton>
          </div>
          <UButton
            v-else-if="!activeRun"
            size="xl"
            color="primary"
            icon="i-lucide-swords"
            class="font-black px-8"
            :loading="busy === 'start'"
            :disabled="!canFight || !!busy"
            @click="emit('start', selectedWeapon)"
          >
            Enter the meadow
          </UButton>
        </div>

        <div class="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-white/60">
          <div><UKbd>W</UKbd><UKbd>A</UKbd><UKbd>S</UKbd><UKbd>D</UKbd> move · mouse aims</div>
          <div><span class="font-bold text-white/85">Left click</span> attack — each tap advances the combo</div>
          <div><span class="font-bold text-white/85">Right click</span> special · <UKbd>Q</UKbd> <UKbd>E</UKbd> abilities</div>
          <div><UKbd>Space</UKbd> dodge roll · hold to sprint</div>
        </div>
      </div>

      <!-- Homestead ------------------------------------------------------ -->
      <div v-else-if="tab === 'homestead'" class="mt-4">
        <p class="text-xs text-white/60">Permanent upgrades. They apply to every run you start from here on — and they are locked while a run is in progress.</p>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          <div
            v-for="up in state.upgrades"
            :key="up.id"
            class="rounded-xl bg-white/5 ring-1 ring-white/10 p-3 flex flex-col"
          >
            <div class="flex items-center gap-2.5">
              <div class="size-10 rounded-lg bg-amber-300/15 ring-1 ring-amber-300/30 flex items-center justify-center shrink-0">
                <UIcon :name="up.icon" class="size-5 text-amber-200" />
              </div>
              <div class="min-w-0">
                <div class="text-base font-black leading-tight">{{ up.name }}</div>
                <div class="text-[11px] font-bold text-white/50 tabular-nums">Level {{ up.level }} / {{ up.max }}</div>
              </div>
            </div>
            <p class="mt-2 text-[11.5px] leading-snug text-white/70 grow">{{ up.description }}</p>
            <div class="mt-2.5 flex gap-1">
              <span
                v-for="i in up.max"
                :key="i"
                class="h-1.5 flex-1 rounded-full"
                :class="i <= up.level ? 'bg-amber-300' : 'bg-white/15'"
              />
            </div>
            <UButton
              class="mt-3 justify-center font-black"
              size="sm"
              :color="up.cost === null ? 'neutral' : 'primary'"
              :variant="up.cost === null ? 'soft' : 'solid'"
              :loading="busy === `upgrade:${up.id}`"
              :disabled="up.cost === null || !affordable(up.cost) || shopLocked || !!busy"
              @click="emit('buyUpgrade', up.id)"
            >
              <template v-if="up.cost === null">Maxed</template>
              <template v-else>Buy · {{ formatNumber(up.cost) }}</template>
            </UButton>
          </div>
        </div>
      </div>

      <!-- Pets ----------------------------------------------------------- -->
      <div v-else-if="tab === 'pets'" class="mt-4">
        <p class="text-xs text-white/60">One companion joins you per run. It fights on its own, and its abilities come online as it grows.</p>
        <div class="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-2.5">
          <div
            v-for="p in state.pets"
            :key="p.id"
            class="rounded-xl bg-white/5 p-3 flex flex-col"
            :style="{ boxShadow: state.activePet === p.id ? `inset 0 0 0 2px ${p.color}` : `inset 0 0 0 1px ${p.color}33` }"
          >
            <div class="flex items-center gap-2.5">
              <div class="size-10 rounded-lg flex items-center justify-center shrink-0" :style="{ backgroundColor: `${p.color}22`, boxShadow: `inset 0 0 0 1px ${p.color}66` }">
                <UIcon name="i-lucide-paw-print" class="size-5" :style="{ color: p.color }" />
              </div>
              <div class="min-w-0">
                <div class="text-base font-black leading-tight" :style="{ color: p.color }">{{ p.name }}</div>
                <div class="text-[11px] font-bold text-white/50 tabular-nums">
                  <span v-if="p.level > 0">Level {{ p.level }} / {{ p.max }}</span>
                  <span v-else>Not adopted</span>
                </div>
              </div>
            </div>
            <p class="mt-2 text-[11.5px] italic leading-snug text-white/60">{{ p.tagline }}</p>

            <div class="mt-2.5 rounded-lg bg-black/30 p-2">
              <div class="text-[10px] uppercase tracking-[0.2em] font-black text-white/40">Passive · {{ p.passive.name }}</div>
              <div class="text-[11.5px] leading-snug text-white/75">{{ p.passive.description }}</div>
            </div>

            <div class="mt-2 space-y-1.5">
              <div
                v-for="a in p.abilities"
                :key="a.id"
                class="flex gap-2"
                :class="p.level >= a.unlockLevel ? '' : 'opacity-45'"
              >
                <div class="size-7 rounded-md bg-white/10 ring-1 ring-white/10 flex items-center justify-center shrink-0">
                  <UIcon :name="p.level >= a.unlockLevel ? petAbilityIcon(a.id) : 'i-lucide-lock'" class="size-3.5" :style="{ color: p.color }" />
                </div>
                <div class="min-w-0">
                  <div class="text-[11.5px] font-black leading-tight">
                    {{ a.name }}
                    <span v-if="p.level >= a.unlockLevel" class="text-white/45 font-bold tabular-nums">· {{ petAbilityCooldown(p, a) }}s</span>
                    <span v-else class="text-white/45 font-bold">· unlocks at level {{ a.unlockLevel }}</span>
                  </div>
                  <div class="text-[10.5px] leading-snug text-white/55">{{ a.description }}</div>
                </div>
              </div>
            </div>

            <div v-if="petChanges(p).length" class="mt-2.5 rounded-lg bg-emerald-400/10 ring-1 ring-emerald-300/25 p-2">
              <div class="text-[10px] uppercase tracking-[0.2em] font-black text-emerald-300">Next level</div>
              <div v-for="line in petChanges(p)" :key="line" class="text-[11px] font-semibold text-white/75 tabular-nums">{{ line }}</div>
            </div>

            <div class="grow" />
            <div class="mt-3 flex gap-2">
              <UButton
                class="flex-1 justify-center font-black"
                size="sm"
                :color="p.cost === null ? 'neutral' : 'primary'"
                :variant="p.cost === null ? 'soft' : 'solid'"
                :loading="busy === `pet:${p.id}`"
                :disabled="p.cost === null || !affordable(p.cost) || shopLocked || !!busy"
                @click="emit('buyPet', p.id)"
              >
                <template v-if="p.cost === null">Maxed</template>
                <template v-else-if="p.level === 0">Adopt · {{ formatNumber(p.cost) }}</template>
                <template v-else>Level up · {{ formatNumber(p.cost) }}</template>
              </UButton>
              <UButton
                v-if="p.level > 0"
                size="sm"
                class="font-black"
                color="neutral"
                variant="soft"
                :class="state.activePet === p.id ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/10 text-white'"
                :icon="state.activePet === p.id ? 'i-lucide-check' : 'i-lucide-paw-print'"
                :loading="busy === `equip:${p.id}`"
                :disabled="!!busy || shopLocked || state.activePet === p.id"
                @click="emit('equip', p.id)"
              >
                {{ state.activePet === p.id ? 'Equipped' : 'Equip' }}
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Feats ---------------------------------------------------------- -->
      <div v-else class="mt-4">
        <p class="text-xs text-white/60">Every weapon past the sword is earned with the one before it.</p>
        <div class="mt-3 space-y-2">
          <div
            v-for="f in state.weapons.feats"
            :key="f.weapon"
            class="rounded-xl p-3 ring-1 flex items-center gap-3"
            :class="f.done ? 'bg-emerald-400/10 ring-emerald-300/30' : 'bg-white/5 ring-white/10'"
          >
            <div class="size-9 rounded-lg flex items-center justify-center shrink-0" :class="f.done ? 'bg-emerald-400/20' : 'bg-black/40'">
              <UIcon :name="f.done ? 'i-lucide-check' : 'i-lucide-lock'" class="size-4.5" :class="f.done ? 'text-emerald-300' : 'text-white/50'" />
            </div>
            <div class="min-w-0 grow">
              <div class="text-sm font-black leading-tight">
                {{ f.title }}
                <span class="text-white/45 font-bold">· unlocks the {{ weaponDefs[f.weapon].name }}</span>
              </div>
              <div class="text-[11.5px] text-white/65 leading-snug">{{ f.description }}</div>
              <div v-if="!f.done" class="mt-1.5 flex items-center gap-2">
                <div class="h-1.5 grow rounded-full bg-white/10 overflow-hidden max-w-[220px]">
                  <div class="h-full rounded-full bg-amber-300" :style="{ width: `${Math.min(100, f.progress / f.clearWave * 100)}%` }" />
                </div>
                <span class="text-[10.5px] font-black text-white/50 tabular-nums">best: wave {{ f.progress }}/{{ f.clearWave }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
