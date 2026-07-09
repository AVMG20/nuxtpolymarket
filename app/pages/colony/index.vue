<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TIER_NAMES } from '#shared/utils/colony'
import { formatRate, formatDuration } from '~/utils/colony-format'

const colony = useColony()
const { bugs, bugInventory, capacity, placedCount, nutrition, nutritionMax, nutritionDrainPerHour, initialized, pending, pendingLoot } = colony

const manageOpen = ref(false)
const placingKey = ref<string | null>(null)
const unplacingId = ref<string | null>(null)

function stackKey(stack: any) {
  return `${stack.typeId}:${stack.speed}:${stack.yield}:${stack.feed}`
}

async function handlePlace(stack: any) {
  if (placingKey.value) return
  placingKey.value = stackKey(stack)
  try {
    await colony.placeBug(stack.typeId, stack.speed, stack.yield, stack.feed)
  } finally {
    placingKey.value = null
  }
}

async function handleUnplace(bugId: string) {
  if (unplacingId.value) return
  unplacingId.value = bugId
  try {
    await colony.unplaceBug(bugId)
  } finally {
    unplacingId.value = null
  }
}

const isStarving = computed(() => nutrition.value <= 0)
const nutritionLow = computed(() => nutrition.value > 0 && nutrition.value / nutritionMax.value < 0.25)
const nutritionEtaMs = computed(() => nutritionDrainPerHour.value > 0 ? (nutrition.value / nutritionDrainPerHour.value) * 3_600_000 : null)
const nutritionEtaClock = computed(() => {
  if (nutritionEtaMs.value === null) return null
  return new Date(Date.now() + nutritionEtaMs.value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
})

// ─── Canvas (terrarium) ─────────────────────────────────────────────────────

const canvasWrap = ref<HTMLDivElement | null>(null)
let destroyed = false
let app: any = null
let PIXI: any = null
let bugLayer: any = null

interface LiveBug {
  id: string
  typeId: string
  color: number
  tier: number
  x: number
  y: number
  vx: number
  vy: number
  tickMs: number
  baseProgressMs: number
  fetchedAtMs: number
  cyclesSeen: number
}
const liveBugs = new Map<string, LiveBug>()
const bugGfx = new Map<string, { gfx: any, halo: any }>()

function bugSize(tier: number) {
  return 5 + tier * 1.6
}

function syncLiveBugs() {
  const width = app?.screen.width ?? 600
  const height = app?.screen.height ?? 420
  const now = Date.now()

  for (const id of [...liveBugs.keys()]) {
    if (!bugs.value.some((b: any) => b.id === id)) {
      liveBugs.delete(id)
      const entry = bugGfx.get(id)
      if (entry && bugLayer) {
        bugLayer.removeChild(entry.gfx)
        bugLayer.removeChild(entry.halo)
      }
      bugGfx.delete(id)
    }
  }

  for (const bug of bugs.value as any[]) {
    const existing = liveBugs.get(bug.id)
    if (existing) {
      existing.color = bug.color
      existing.tier = bug.tier
      existing.tickMs = bug.tickMs
      existing.baseProgressMs = bug.tickProgressMs
      existing.fetchedAtMs = now
      continue
    }
    const speedBase = 14 + bug.tier * 3
    const angle = Math.random() * Math.PI * 2
    liveBugs.set(bug.id, {
      id: bug.id,
      typeId: bug.typeId,
      color: bug.color,
      tier: bug.tier,
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speedBase * 0.5,
      vy: Math.sin(angle) * speedBase * 0.5,
      tickMs: bug.tickMs,
      baseProgressMs: bug.tickProgressMs,
      fetchedAtMs: now,
      cyclesSeen: 0
    })
  }

  if (!PIXI || !bugLayer) return
  for (const [id, live] of liveBugs) {
    if (bugGfx.has(id)) continue
    const size = bugSize(live.tier)
    const halo = new PIXI.Graphics()
    halo.circle(0, 0, size * 2.4).fill({ color: live.color, alpha: 0.12 })
    const gfx = new PIXI.Graphics()
    gfx.circle(0, 0, size).fill({ color: live.color })
    halo.position.set(live.x, live.y)
    gfx.position.set(live.x, live.y)
    bugLayer.addChild(halo)
    bugLayer.addChild(gfx)
    bugGfx.set(id, { gfx, halo })
  }
}

// ─── Floating popups (over the canvas, per-bug production ticks) ──────────

interface FloatText { id: number, text: string, x: number, y: number }
const bugFloats = ref<FloatText[]>([])
let floatSeq = 0

function spawnBugFloat(text: string, x: number, y: number) {
  const id = floatSeq++
  bugFloats.value.push({ id, text, x, y })
  setTimeout(() => {
    bugFloats.value = bugFloats.value.filter(f => f.id !== id)
  }, 1100)
}

function tickFrame(deltaMS: number) {
  if (!PIXI || !app) return
  const width = app.screen.width
  const height = app.screen.height
  const pad = 14
  const now = Date.now()

  for (const live of liveBugs.values()) {
    if (!isStarving.value) {
      const speedBase = 14 + live.tier * 3
      live.x += (live.vx * deltaMS) / 1000
      live.y += (live.vy * deltaMS) / 1000

      if (live.x < pad || live.x > width - pad) {
        live.vx *= -1
        live.x = Math.max(pad, Math.min(width - pad, live.x))
      }
      if (live.y < pad || live.y > height - pad) {
        live.vy *= -1
        live.y = Math.max(pad, Math.min(height - pad, live.y))
      }

      live.vx += (Math.random() - 0.5) * 2.4
      live.vy += (Math.random() - 0.5) * 2.4
      const speed = Math.hypot(live.vx, live.vy)
      if (speed > speedBase) {
        live.vx = (live.vx / speed) * speedBase
        live.vy = (live.vy / speed) * speedBase
      }

      // predict production ticks client-side for the floating popup — the
      // actual accounting already happened server-side via settleColony
      const elapsedSinceFetch = now - live.fetchedAtMs
      const totalProgress = live.baseProgressMs + elapsedSinceFetch
      const cycles = live.tickMs > 0 ? Math.floor(totalProgress / live.tickMs) : 0
      if (cycles > live.cyclesSeen) {
        live.cyclesSeen = cycles
        const bugData = (bugs.value as any[]).find(b => b.id === live.id)
        if (bugData) spawnBugFloat(`+${bugData.itemEmoji}`, live.x, live.y - bugSize(live.tier))
      }
    }

    const entry = bugGfx.get(live.id)
    if (!entry) continue
    entry.gfx.position.set(live.x, live.y)
    entry.halo.position.set(live.x, live.y)
    const targetAlpha = isStarving.value ? 0.3 : 1
    entry.gfx.alpha += (targetAlpha - entry.gfx.alpha) * 0.08
    entry.halo.alpha += (targetAlpha * 0.4 - entry.halo.alpha) * 0.08
  }
}

onMounted(async () => {
  const pixi = await import('pixi.js')
  if (destroyed) return
  PIXI = pixi

  app = new PIXI.Application()
  await app.init({
    resizeTo: canvasWrap.value ?? undefined,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1)
  })
  if (destroyed) {
    app.destroy(true)
    return
  }
  canvasWrap.value?.appendChild(app.canvas)

  bugLayer = new PIXI.Container()
  app.stage.addChild(bugLayer)

  syncLiveBugs()
  app.ticker.add(() => tickFrame(app.ticker.deltaMS))
})

watch(() => bugs.value.map((b: any) => `${b.id}:${b.tickProgressMs}`).join(','), syncLiveBugs)

onUnmounted(() => {
  destroyed = true
  bugGfx.clear()
  liveBugs.clear()
  if (app) {
    app.destroy(true, { children: true })
    app = null
  }
})

// light poll so nutrition/loot stay fresh without a heavy server loop —
// production itself is always settled analytically on the server when this fires
let pollHandle: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollHandle = setInterval(() => colony.refresh(), 30_000)
})
onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle)
})

// ─── Loot chest ─────────────────────────────────────────────────────────────

const chestFloats = ref<FloatText[]>([])
const chestBusy = ref(false)

async function handleCollect() {
  if (chestBusy.value) return
  chestBusy.value = true
  try {
    const res = await colony.collectLoot()
    const collected = res?.collected ?? []
    // stagger each popup's appearance so they don't all stack on top of
    // each other — pushed one at a time instead of all at once
    collected.forEach((item: any, i: number) => {
      setTimeout(() => {
        const id = floatSeq++
        const x = 50 + (Math.random() - 0.5) * 70
        chestFloats.value.push({ id, text: `+${formatNumber(item.quantity, false)} ${item.emoji}`, x, y: 0 })
        setTimeout(() => {
          chestFloats.value = chestFloats.value.filter(f => f.id !== id)
        }, 1600)
      }, i * 220)
    })
  } finally {
    chestBusy.value = false
  }
}

async function handleInit() {
  await colony.initColony()
}

// ─── Bug list progress bars (right sidebar) ────────────────────────────────

const nowTick = ref(Date.now())
let progressInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  progressInterval = setInterval(() => {
    nowTick.value = Date.now()
  }, 500)
})
onUnmounted(() => {
  if (progressInterval) clearInterval(progressInterval)
})

function bugProgressPct(bug: any) {
  if (isStarving.value) return Math.min(100, (bug.tickProgressMs / bug.tickMs) * 100)
  const live = liveBugs.get(bug.id)
  const elapsed = live ? nowTick.value - live.fetchedAtMs : 0
  const total = bug.tickProgressMs + Math.max(0, elapsed)
  return Math.min(100, ((total % bug.tickMs) / bug.tickMs) * 100)
}

function bugCountdown(bug: any) {
  if (isStarving.value) return 'Idle'
  const live = liveBugs.get(bug.id)
  const elapsed = live ? nowTick.value - live.fetchedAtMs : 0
  const total = bug.tickProgressMs + Math.max(0, elapsed)
  const remaining = bug.tickMs - (total % bug.tickMs)
  const secs = Math.max(0, Math.ceil(remaining / 1000))
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
  if (secs >= 60) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${secs}s`
}

function statDots(level: number) {
  return Array.from({ length: 5 }, (_, i) => i < level)
}
</script>

<template>
  <div class="p-4 md:p-6 w-full">
    <div
      v-if="!pending && !initialized"
      class="flex flex-col items-center justify-center py-24 gap-4 text-center"
    >
      <UIcon
        name="i-lucide-bug"
        class="size-12 text-primary"
      />
      <div>
        <h1 class="text-xl font-bold">
          Start your colony
        </h1>
        <p class="text-sm text-muted max-w-sm">
          You'll get a few starter bugs to begin foraging. Collect their loot from the chest, feed them in the Market, and grow your habitat to unlock rarer species.
        </p>
      </div>
      <UButton
        size="lg"
        icon="i-lucide-sprout"
        @click="handleInit"
      >
        Start Colony
      </UButton>
    </div>

    <template v-else>
      <!-- Nutrition bar on top -->
      <UCard class="mb-4">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-medium text-muted flex items-center gap-1.5">
            <UIcon
              name="i-lucide-heart-pulse"
              class="size-4"
            />
            Colony Nutrition
          </span>
          <span class="text-sm font-mono">{{ nutrition }} / {{ nutritionMax }}</span>
        </div>
        <div class="h-2.5 rounded-full bg-elevated overflow-hidden">
          <div
            class="h-full transition-all"
            :class="isStarving ? 'bg-error' : nutritionLow ? 'bg-warning' : 'bg-primary'"
            :style="{ width: (nutrition / nutritionMax) * 100 + '%' }"
          />
        </div>
        <p
          v-if="isStarving"
          class="text-xs text-error font-medium mt-1.5 flex items-center gap-1"
        >
          <UIcon name="i-lucide-alert-triangle" />
          Colony is starving — bugs have stopped foraging.
          <NuxtLink
            to="/colony/market"
            class="underline"
          >Feed them in the Market</NuxtLink>
        </p>
        <p
          v-else
          class="text-xs mt-1.5 flex items-center gap-1"
          :class="nutritionLow ? 'text-warning' : 'text-muted'"
        >
          <UIcon
            name="i-lucide-clock"
            class="size-3"
          />
          <template v-if="nutritionEtaMs !== null">
            Runs out in {{ formatDuration(nutritionEtaMs) }} (around {{ nutritionEtaClock }})
          </template>
          <template v-else>
            Not draining — no bugs eating right now.
          </template>
          <NuxtLink
            to="/colony/market"
            class="underline ml-1"
          >Feed in the Market</NuxtLink>
        </p>
      </UCard>

      <div class="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6">
        <!-- Terrarium + chest, centered -->
        <div class="space-y-3 flex flex-col items-center">
          <div
            ref="canvasWrap"
            class="relative w-full rounded-xl border border-default bg-elevated/40 overflow-hidden"
            style="height: 560px;"
          >
            <div
              v-for="f in bugFloats"
              :key="f.id"
              class="colony-float pointer-events-none absolute text-sm font-semibold"
              :style="{ left: f.x + 'px', top: f.y + 'px' }"
            >
              {{ f.text }}
            </div>
          </div>

          <div class="relative flex flex-col items-center gap-2 pt-2">
            <UButton
              size="xl"
              color="warning"
              variant="soft"
              icon="i-lucide-package-open"
              :loading="chestBusy"
              @click="handleCollect"
            >
              Open loot chest
            </UButton>
            <div
              v-for="f in chestFloats"
              :key="f.id"
              class="colony-chest-float pointer-events-none absolute text-sm font-semibold whitespace-nowrap"
              :style="{ left: 'calc(50% + ' + (f.x - 50) + 'px)', bottom: '100%' }"
            >
              {{ f.text }}
            </div>
            <div
              v-if="pendingLoot.length"
              class="flex flex-wrap justify-center gap-1.5 max-w-md"
            >
              <UBadge
                v-for="item in pendingLoot"
                :key="item.itemTypeId"
                color="warning"
                variant="subtle"
                size="sm"
              >
                {{ item.emoji }} {{ formatNumber(item.quantity, false) }}
              </UBadge>
            </div>
            <p
              v-else
              class="text-xs text-muted"
            >
              Nothing waiting yet — bugs forage on their own, check back soon.
            </p>
          </div>
        </div>

        <!-- Right sidebar: bug inventory -->
        <div class="space-y-4">
          <UCard>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-muted">Terrarium</span>
              <span class="text-sm font-mono">{{ placedCount }} / {{ capacity }}</span>
            </div>
            <div class="flex items-center justify-between mt-2 gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-settings-2"
                :disabled="!bugs.length"
                @click="manageOpen = true"
              >
                Manage Terrarium
              </UButton>
              <NuxtLink
                to="/colony/habitat"
                class="text-xs text-primary underline"
              >
                Habitat upgrades
              </NuxtLink>
            </div>
          </UCard>

          <UCard
            v-if="bugInventory.length"
            :ui="{ body: 'p-2' }"
          >
            <span class="text-sm font-medium text-muted mb-2 block px-1 pt-1">Inventory</span>
            <div class="space-y-2 max-h-[36rem] overflow-y-auto pr-1">
              <div
                v-for="stack in bugInventory"
                :key="stackKey(stack)"
                class="rounded-xl border border-default bg-elevated overflow-hidden"
              >
                <div
                  class="h-1"
                  :style="{ backgroundColor: '#' + stack.color.toString(16).padStart(6, '0') }"
                />
                <div class="p-2.5 space-y-2">
                  <div class="flex items-start gap-2">
                    <span class="text-2xl leading-none">{{ stack.emoji }}</span>
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-bold truncate flex items-center gap-1.5">
                        {{ stack.name }}
                        <UIcon
                          :name="stack.social ? 'i-lucide-users' : 'i-lucide-user'"
                          class="size-3 text-muted"
                          :title="stack.social ? 'Social — thrives in groups' : 'Solitary — thrives alone'"
                        />
                      </p>
                      <p class="text-xs text-muted">
                        {{ TIER_NAMES[stack.tier] }}
                      </p>
                    </div>
                    <UBadge
                      color="neutral"
                      variant="subtle"
                      size="sm"
                    >
                      x{{ stack.quantity }}
                    </UBadge>
                  </div>

                  <USeparator />

                  <div class="space-y-1">
                    <div
                      v-for="stat in [{ label: 'Speed', level: stack.speed }, { label: 'Yield', level: stack.yield }, { label: 'Feed', level: stack.feed }]"
                      :key="stat.label"
                      class="flex items-center gap-2 text-xs"
                    >
                      <span class="text-muted w-10 shrink-0">{{ stat.label }}</span>
                      <div class="flex gap-0.5">
                        <span
                          v-for="(filled, i) in statDots(stat.level)"
                          :key="i"
                          class="size-1.5 rounded-full"
                          :class="filled ? 'bg-primary' : 'bg-background'"
                        />
                      </div>
                    </div>
                  </div>

                  <UButton
                    block
                    size="xs"
                    icon="i-lucide-arrow-right-circle"
                    :loading="placingKey === stackKey(stack)"
                    :disabled="placedCount >= capacity"
                    @click="handlePlace(stack)"
                  >
                    {{ placedCount >= capacity ? 'Terrarium full' : 'Place in Terrarium' }}
                  </UButton>
                </div>
              </div>
            </div>
          </UCard>

          <UCard v-else>
            <p class="text-sm text-muted text-center py-4">
              No spare bugs — buy more in the Market.
            </p>
          </UCard>
        </div>
      </div>
    </template>

    <UModal
      v-model:open="manageOpen"
      title="Manage Terrarium"
      description="Bugs actively foraging. Remove one to send it back to your inventory."
    >
      <template #body>
        <div
          v-if="bugs.length"
          class="space-y-2 max-h-[28rem] overflow-y-auto pr-1"
        >
          <div
            v-for="bug in bugs"
            :key="bug.id"
            class="rounded-xl border border-default bg-elevated overflow-hidden"
          >
            <div
              class="h-1"
              :style="{ backgroundColor: '#' + bug.color.toString(16).padStart(6, '0') }"
            />
            <div class="p-2.5 space-y-2">
              <div class="flex items-start gap-2">
                <span class="text-2xl leading-none">{{ bug.emoji }}</span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-bold truncate">
                    {{ bug.name }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ TIER_NAMES[bug.tier] }}
                  </p>
                </div>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-arrow-left-circle"
                  :loading="unplacingId === bug.id"
                  @click="handleUnplace(bug.id)"
                >
                  Unplace
                </UButton>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-x"
                  @click="colony.removeBug(bug.id)"
                />
              </div>

              <div class="h-1.5 rounded-full bg-background overflow-hidden">
                <div
                  class="h-full bg-primary transition-all"
                  :style="{ width: bugProgressPct(bug) + '%' }"
                />
              </div>
              <p class="text-xs flex items-center justify-between">
                <span class="text-highlighted font-medium">{{ bug.itemEmoji }} {{ formatRate(bug.itemsPerHour) }}</span>
                <span class="text-muted font-mono">{{ bugCountdown(bug) }}</span>
              </p>
            </div>
          </div>
        </div>
        <p
          v-else
          class="text-sm text-muted text-center py-4"
        >
          Nothing placed yet.
        </p>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.colony-float {
  animation: colony-float-up 1.1s ease-out forwards;
  transform: translate(-50%, -100%);
  color: white;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

.colony-chest-float {
  animation: colony-chest-float-up 1.6s ease-out forwards;
  transform: translateX(-50%);
}

@keyframes colony-float-up {
  0% {
    opacity: 0;
    transform: translate(-50%, -100%) scale(0.8);
  }
  15% {
    opacity: 1;
    transform: translate(-50%, -130%) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -220%) scale(1);
  }
}

@keyframes colony-chest-float-up {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(0);
  }
  15% {
    opacity: 1;
    transform: translateX(-50%) translateY(-20px);
  }
  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(-90px);
  }
}
</style>
