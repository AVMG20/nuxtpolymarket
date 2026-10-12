<script setup lang="ts">
/**
 * The Hero Quest playtest harness. **Development only.**
 *
 * An idle game measured in days cannot be felt in an evening, and the `// UNTUNED ╧` constants
 * are waiting on play data. This page is the shortest path between a question about the curve
 * and an answer.
 *
 * Every control here moves an *input* and lets the real server path do the work. Nothing on this
 * page computes a reward, and it deliberately reads the same `state.get` payload as every other
 * tab, so what you see after a skip is what the game actually believes.
 */

const {
  initialized, run, hero, voidShards, classTree,
  devMode, dev, initRun, refresh
} = useHeroQuest()

// Belt and braces: the tab is already hidden outside dev and the routes 404 there, but a
// hand-typed URL should land somewhere honest rather than on a page of dead buttons.
if (!devMode) throw createError({ statusCode: 404, statusMessage: 'Not found' })

const busy = ref(false)
const lastSkip = ref<{
  chunksRun: number
  kills: number
  goldEarned: number
  levelsGained: number
  blockedAtBoss: boolean
  world: number
  stage: number
  heroLevel: number
} | null>(null)

async function withBusy(action: () => Promise<unknown>) {
  busy.value = true
  try {
    await action()
  } finally {
    busy.value = false
  }
}

// ── Time ────────────────────────────────────────────────────────────────────────────
//
// The two modes are two different experiments, not a preference. `offline` settles the whole
// span as one window, which is what the offline cap and the efficiency tax actually apply to.
// `online` settles it as consecutive presence-length windows — what a player watching the
// screen would have earned. Comparing them is the cap's whole story.

const skipMode = ref<'offline' | 'online'>('offline')
const skipHours = ref(8)

const OFFLINE_PRESETS = [
  { label: '1h', hours: 1 },
  { label: '8h', hours: 8 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 }
]
const ONLINE_PRESETS = [
  { label: '10m', hours: 1 / 6 },
  { label: '1h', hours: 1 },
  { label: '4h', hours: 4 },
  { label: '12h', hours: 12 }
]
const presets = computed(() => skipMode.value === 'offline' ? OFFLINE_PRESETS : ONLINE_PRESETS)

async function skip(hours: number) {
  await withBusy(async () => {
    lastSkip.value = await dev.skip(hours, skipMode.value)
  })
}

// ── Currency ────────────────────────────────────────────────────────────────────────

const grant = reactive({ gold: 1_000_000, gems: 1000, voidShards: 1000, seals: 100, essence: 10_000, traitGems: 500, medals: 1000 })

async function grantOne(field: keyof typeof grant) {
  await withBusy(() => dev.grant({ [field]: grant[field] }))
}

async function grantAll() {
  await withBusy(() => dev.grant({ ...grant }))
}

// ── Collection ──────────────────────────────────────────────────────────────────────

const SYSTEMS = ['gear', 'champion', 'skill', 'artifact'] as const
const chosenSystems = ref<string[]>([...SYSTEMS])
const unlockStar = ref(0)
const unlockLevel = ref(1)
const maxShop = ref(true)

function toggleSystem(system: string) {
  const next = [...chosenSystems.value]
  const at = next.indexOf(system)
  if (at >= 0) next.splice(at, 1)
  else next.push(system)
  chosenSystems.value = next
}

async function unlock() {
  await withBusy(() => dev.unlock({
    systems: chosenSystems.value,
    star: unlockStar.value,
    level: unlockLevel.value,
    maxShop: maxShop.value
  }))
}

// ── Position ────────────────────────────────────────────────────────────────────────
//
// Seeded from the live run on first load so the fields read as "where you are" rather than as
// an empty form, and a one-field jump does not silently reset the other three.

const jump = reactive({ prestige: 0, world: 1, stage: 1, heroLevel: 1 })
const seeded = ref(false)

watchEffect(() => {
  if (seeded.value || !run.value || !hero.value) return
  jump.prestige = run.value.prestige
  jump.world = run.value.world
  jump.stage = run.value.stage
  jump.heroLevel = hero.value.level
  seeded.value = true
})

async function applyJump() {
  await withBusy(() => dev.set({ ...jump }))
}

async function setClass(classId: string) {
  await withBusy(() => dev.set({ heroNodeId: classId }))
}

/** Hand prestige over without the World 10 super boss, so the reset rhythm is testable alone. */
async function allowPrestige() {
  await withBusy(() => dev.set({ runCleared: true }))
}

/** End the session and go to the battle tab, where the splash it ended on stands. */
async function forceAway() {
  await withBusy(async () => {
    await dev.away()
    await navigateTo('/hero-quest')
  })
}

// ── Reset ───────────────────────────────────────────────────────────────────────────

const confirmingReset = ref(false)

async function doReset() {
  await withBusy(async () => {
    await dev.reset()
    confirmingReset.value = false
    seeded.value = false
    lastSkip.value = null
    await refresh()
  })
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
    <UAlert
      icon="i-lucide-flask-conical"
      color="warning"
      variant="soft"
      title="Playtest harness — dev builds only"
      description="These routes 404 in production. Gold and Gems are shared platform balances, so granting them here moves real account state."
    />

    <div
      v-if="!initialized"
      class="rounded-lg border border-default bg-elevated/40 p-6 text-center space-y-3"
    >
      <p class="text-sm text-muted">
        No run founded. Everything below needs one.
      </p>
      <UButton
        color="primary"
        :disabled="busy"
        @click="initRun"
      >
        Found a run
      </UButton>
    </div>

    <template v-else>
      <!-- Time -->
      <section class="rounded-lg border border-default bg-elevated/40 p-4 space-y-3">
        <div class="flex items-baseline justify-between gap-4">
          <h2 class="text-sm font-medium text-highlighted">
            Time travel
          </h2>
          <p class="text-xs text-muted">
            {{ skipMode === 'offline'
              ? 'One window — measures the cap and efficiency tax'
              : 'Consecutive presence-length windows — the live rate' }}
          </p>
        </div>

        <div class="flex gap-1">
          <UButton
            v-for="mode in (['offline', 'online'] as const)"
            :key="mode"
            size="xs"
            class="capitalize"
            :variant="skipMode === mode ? 'solid' : 'soft'"
            :color="skipMode === mode ? 'primary' : 'neutral'"
            :disabled="busy"
            @click="skipMode = mode"
          >
            {{ mode }}
          </UButton>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-for="preset in presets"
            :key="preset.label"
            size="xs"
            variant="soft"
            color="neutral"
            :disabled="busy"
            @click="skip(preset.hours)"
          >
            {{ preset.label }}
          </UButton>

          <div class="flex items-center gap-2 ml-auto">
            <UInput
              v-model.number="skipHours"
              type="number"
              size="xs"
              class="w-24"
              :disabled="busy"
            />
            <UButton
              size="xs"
              color="primary"
              :disabled="busy || !(skipHours > 0)"
              @click="skip(skipHours)"
            >
              Skip hours
            </UButton>
          </div>
        </div>

        <div class="flex items-center justify-between gap-4 pt-1 border-t border-default">
          <p class="text-xs text-muted">
            End the session, as an hour away would: the gap is settled offline and Hero Quest opens on its splash.
          </p>
          <UButton
            size="xs"
            variant="soft"
            color="neutral"
            icon="i-lucide-door-open"
            :disabled="busy"
            @click="forceAway"
          >
            Force away
          </UButton>
        </div>

        <div
          v-if="lastSkip"
          class="rounded border border-primary/40 bg-primary/5 p-3 text-xs space-y-1"
        >
          <p class="text-default">
            {{ formatNumber(lastSkip.kills) }} kills ·
            {{ formatNumber(lastSkip.goldEarned) }} Gold ·
            +{{ lastSkip.levelsGained }} levels ·
            now W{{ lastSkip.world }}-{{ lastSkip.stage }} at level {{ formatNumber(lastSkip.heroLevel) }}
          </p>
          <p
            v-if="lastSkip.blockedAtBoss"
            class="text-warning"
          >
            Stopped after {{ lastSkip.chunksRun }} window(s) — the run parked at a boss gate, and
            no amount of further skipping passes one. Engage it on the Battle tab.
          </p>
        </div>
      </section>

      <!-- Currency -->
      <section class="rounded-lg border border-default bg-elevated/40 p-4 space-y-3">
        <div class="flex items-baseline justify-between gap-4">
          <h2 class="text-sm font-medium text-highlighted">
            Currency
          </h2>
          <UButton
            size="xs"
            color="primary"
            :disabled="busy"
            @click="grantAll"
          >
            Grant all
          </UButton>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div
            v-for="field in (['gold', 'gems', 'voidShards', 'seals', 'essence', 'traitGems', 'medals'] as const)"
            :key="field"
            class="flex items-center gap-2"
          >
            <span class="text-xs text-muted w-24 shrink-0 capitalize">{{ field }}</span>
            <UInput
              v-model.number="grant[field]"
              type="number"
              size="xs"
              class="flex-1"
              :disabled="busy"
            />
            <UButton
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-plus"
              :disabled="busy"
              @click="grantOne(field)"
            />
          </div>
        </div>
        <p class="text-xs text-muted">
          Seals and Essence pay all four systems at once, like every milestone grant.
          Void Shards: {{ formatNumber(Number(voidShards)) }}.
        </p>
      </section>

      <!-- Collection -->
      <section class="rounded-lg border border-default bg-elevated/40 p-4 space-y-3">
        <h2 class="text-sm font-medium text-highlighted">
          Collection
        </h2>
        <p class="text-xs text-muted">
          Owning everything is not about skipping the gacha — Loadouts, formation, the Artifact
          effect pool and the Skill potency curve are all invisible until there is a collection to
          arrange. Star and level drive <code>(star × 10 + level)</code>, the universal investment
          scalar, so 5★/Lv10 is the top of every one of those curves.
        </p>

        <div class="flex flex-wrap gap-1">
          <UButton
            v-for="system in SYSTEMS"
            :key="system"
            size="xs"
            class="capitalize"
            :variant="chosenSystems.includes(system) ? 'solid' : 'soft'"
            :color="chosenSystems.includes(system) ? 'primary' : 'neutral'"
            :disabled="busy"
            @click="toggleSystem(system)"
          >
            {{ system }}
          </UButton>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">Star</span>
            <UInput
              v-model.number="unlockStar"
              type="number"
              size="xs"
              class="w-16"
              :disabled="busy"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">Level</span>
            <UInput
              v-model.number="unlockLevel"
              type="number"
              size="xs"
              class="w-16"
              :disabled="busy"
            />
          </div>
          <UButton
            size="xs"
            :variant="maxShop ? 'solid' : 'soft'"
            :color="maxShop ? 'primary' : 'neutral'"
            :disabled="busy"
            @click="maxShop = !maxShop"
          >
            Max prestige shop
          </UButton>
          <UButton
            size="xs"
            color="primary"
            class="ml-auto"
            :disabled="busy || !chosenSystems.length"
            @click="unlock"
          >
            Unlock
          </UButton>
        </div>
      </section>

      <!-- Position -->
      <section class="rounded-lg border border-default bg-elevated/40 p-4 space-y-3">
        <h2 class="text-sm font-medium text-highlighted">
          Run position
        </h2>

        <div class="grid gap-2 sm:grid-cols-4">
          <div
            v-for="field in (['prestige', 'world', 'stage', 'heroLevel'] as const)"
            :key="field"
            class="flex items-center gap-2"
          >
            <span class="text-xs text-muted shrink-0">{{ field }}</span>
            <UInput
              v-model.number="jump[field]"
              type="number"
              size="xs"
              class="flex-1"
              :disabled="busy"
            />
          </div>
        </div>
        <p class="text-xs text-muted">
          Setting hero level clears banked XP — level and XP-within-level are one pair, and a
          stale remainder would level the hero straight back up on the next settle.
        </p>

        <div class="flex flex-wrap gap-2">
          <UButton
            size="xs"
            color="primary"
            :disabled="busy"
            @click="applyJump"
          >
            Jump
          </UButton>
          <UButton
            size="xs"
            variant="soft"
            color="neutral"
            :disabled="busy"
            @click="allowPrestige"
          >
            Allow prestige
          </UButton>
        </div>

        <div
          v-if="classTree.length"
          class="pt-2 border-t border-default space-y-2"
        >
          <p class="text-xs text-muted">
            Class node — switching keeps every hero level, as it does in the real game.
          </p>
          <div class="flex flex-wrap gap-1">
            <UButton
              v-for="node in classTree"
              :key="node.id"
              size="xs"
              :variant="node.id === hero?.classId ? 'solid' : 'soft'"
              :color="node.id === hero?.classId ? 'primary' : 'neutral'"
              :disabled="busy"
              @click="setClass(node.id)"
            >
              {{ node.name }}
            </UButton>
          </div>
        </div>
      </section>

      <!-- Reset -->
      <section class="rounded-lg border border-error/40 bg-error/5 p-4 space-y-3">
        <h2 class="text-sm font-medium text-highlighted">
          Wipe Hero Quest
        </h2>
        <p class="text-xs text-muted">
          Deletes state, collection, loadouts, shop levels and fight history — the next
          <em>Found a run</em> is a genuinely fresh account, which is the only way to playtest the
          first hour twice. Gold and Gems survive: they are shared platform balances.
        </p>
        <div class="flex gap-2">
          <UButton
            v-if="!confirmingReset"
            size="xs"
            color="error"
            variant="soft"
            :disabled="busy"
            @click="confirmingReset = true"
          >
            Wipe
          </UButton>
          <template v-else>
            <UButton
              size="xs"
              color="error"
              :disabled="busy"
              @click="doReset"
            >
              Yes, wipe it
            </UButton>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              :disabled="busy"
              @click="confirmingReset = false"
            >
              Cancel
            </UButton>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>
