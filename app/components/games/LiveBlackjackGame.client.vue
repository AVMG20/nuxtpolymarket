<script setup lang="ts">
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import { canDouble, canSplit, canSurrender } from '#shared/utils/live-blackjack/rules'
import { buildTextures } from '~/utils/live-blackjack/art'
import { LiveBlackjackScene, STAGE_H, STAGE_W } from '~/utils/live-blackjack/scene'

const table = useLiveBlackjack()
const { state, youId, balance, connected, feed, mySeat, myHand, isMyTurn } = table

const canvasWrap = ref<HTMLDivElement | null>(null)
const showCount = ref(false)
const chatDraft = ref('')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any = null
let scene: LiveBlackjackScene | null = null
let destroyed = false

const rack = computed(() => chipRackFor(balance.value).map(c => c.value))

const decksLeft = computed(() => {
    const shoe = state.value?.shoe
    if (!shoe) return 0
    return Math.max(0.5, (shoe.total - shoe.dealt) / 52)
})

const trueCount = computed(() => {
    const shoe = state.value?.shoe
    if (!shoe) return 0
    return shoe.runningCount / decksLeft.value
})

const phaseLabel = computed(() => {
    switch (state.value?.phase) {
        case 'betting': return 'Place your bets'
        case 'dealing': return 'Dealing'
        case 'insurance': return 'Insurance'
        case 'playing': return 'In play'
        case 'dealer': return 'Dealer'
        case 'payout': return 'Paying out'
        default: return 'Waiting'
    }
})

const secondsLeft = ref(0)
let clockTimer: ReturnType<typeof setInterval> | null = null

const pendingBet = computed(() => mySeat.value?.pendingBet ?? 0)
const isBetting = computed(() => state.value?.phase === 'betting' && !!mySeat.value)

const needsInsurance = computed(() =>
    state.value?.phase === 'insurance' && !!mySeat.value?.hands.length && !mySeat.value.insuranceDecided)

const seatHands = computed(() => mySeat.value?.hands ?? [])
const canDoubleNow = computed(() =>
    !!myHand.value && canDouble(myHand.value) && balance.value >= myHand.value.bet)
const canSplitNow = computed(() =>
    !!myHand.value && canSplit(myHand.value, seatHands.value) && balance.value >= myHand.value.bet)
const canSurrenderNow = computed(() =>
    !!myHand.value && canSurrender(myHand.value, seatHands.value))

const visibleFeed = computed(() => feed.value.slice(-7))

const scoreboard = computed(() => state.value?.scoreboard ?? [])

function sendChat() {
    const text = chatDraft.value.trim()
    if (!text) return
    table.chat(text)
    chatDraft.value = ''
}

watch([state, balance], () => {
    if (!scene || !state.value) return
    scene.update(state.value, youId.value, balance.value, rack.value)
})

onMounted(async () => {
    const PIXI = await import('pixi.js')
    if (destroyed) return

    app = new PIXI.Application()
    await app.init({
        width: STAGE_W,
        height: STAGE_H,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1)
    })
    if (destroyed) {
        app.destroy(true)
        return
    }

    app.canvas.style.width = '100%'
    app.canvas.style.height = '100%'
    app.canvas.style.display = 'block'
    canvasWrap.value?.appendChild(app.canvas)

    const textures = buildTextures(PIXI, app.renderer)
    scene = new LiveBlackjackScene(PIXI, app, textures, {
        onSit: seat => table.sit(seat),
        onChip: value => table.bet(value)
    })
    if (state.value) scene.update(state.value, youId.value, balance.value, rack.value)

    clockTimer = setInterval(() => {
        const endsAt = state.value?.phaseEndsAt
        if (!endsAt) {
            secondsLeft.value = 0
            return
        }
        const skew = (state.value?.now ?? Date.now()) - Date.now()
        secondsLeft.value = Math.max(0, Math.ceil((endsAt - Date.now() - skew) / 1000))
    }, 200)
})

onBeforeUnmount(() => {
    destroyed = true
    if (clockTimer) clearInterval(clockTimer)
    scene?.destroy()
    scene = null
    app?.destroy(true, { children: true, texture: true })
    app = null
})
</script>

<template>
  <div class="relative w-full overflow-hidden rounded-2xl bg-[#0b0806] ring-1 ring-white/10">
    <div ref="canvasWrap" class="w-full" style="aspect-ratio: 8 / 5;" />

    <!-- Table results: biggest winners first, biggest losers last -->
    <div class="absolute left-2 top-2 w-[22%] min-w-46.5 rounded-xl bg-black/70 p-2.5 backdrop-blur-sm ring-1 ring-white/10">
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-wider text-amber-300/80">Table results</span>
        <span class="text-[10px] text-muted">{{ state?.watching ?? 0 }} watching</span>
      </div>
      <div v-if="!scoreboard.length" class="py-2 text-center text-[11px] text-muted">
        No hands played yet
      </div>
      <ul v-else class="space-y-0.5">
        <li
          v-for="(entry, i) in scoreboard"
          :key="entry.userId"
          class="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs"
          :class="entry.userId === youId ? 'bg-amber-400/10' : ''"
        >
          <span class="w-3 shrink-0 text-[10px] text-muted">{{ i + 1 }}</span>
          <ProfileEmblem :emblem="entry.emblem" :name="entry.name" class="size-4 shrink-0 text-[8px]" />
          <span
            class="truncate font-medium"
            :class="entry.seated ? 'text-default' : 'text-muted line-through decoration-white/30'"
          >{{ entry.name }}</span>
          <span
            class="ml-auto shrink-0 font-mono text-[11px] font-bold tabular-nums"
            :class="entry.net > 0 ? 'text-green-400' : entry.net < 0 ? 'text-red-400' : 'text-muted'"
          >{{ entry.net > 0 ? '+' : entry.net < 0 ? '−' : '' }}{{ formatNumber(Math.abs(entry.net)) }}</span>
        </li>
      </ul>
    </div>

    <!-- Shoe, penetration and the count, for anyone who wants to keep one -->
    <div class="absolute right-2 top-2 w-[19%] min-w-41 rounded-xl bg-black/70 p-2.5 backdrop-blur-sm ring-1 ring-white/10">
      <div class="flex items-center justify-between text-[11px]">
        <span class="font-bold uppercase tracking-wider text-amber-300/80">{{ phaseLabel }}</span>
        <span v-if="secondsLeft > 0" class="font-mono font-bold tabular-nums text-default">{{ secondsLeft }}s</span>
      </div>
      <div class="mt-1.5 flex items-center justify-between text-[11px] text-muted">
        <span>Decks left</span>
        <span class="font-mono tabular-nums text-default">{{ decksLeft.toFixed(1) }} / {{ state?.shoe.decks ?? 6 }}</span>
      </div>
      <div class="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          class="h-full bg-amber-400/70 transition-[width] duration-500"
          :style="{ width: `${Math.round((decksLeft / (state?.shoe.decks ?? 6)) * 100)}%` }"
        />
      </div>
      <button
        class="mt-2 w-full rounded-md bg-white/5 px-2 py-1 text-[11px] font-semibold text-muted transition hover:bg-white/10 hover:text-default"
        @click="showCount = !showCount"
      >
        {{ showCount ? 'Hide' : 'Show' }} count
      </button>
      <div v-if="showCount" class="mt-1.5 grid grid-cols-2 gap-1 text-center">
        <div class="rounded bg-white/5 py-1">
          <div class="text-[9px] uppercase text-muted">Running</div>
          <div class="font-mono text-sm font-bold tabular-nums text-default">
            {{ (state?.shoe.runningCount ?? 0) > 0 ? '+' : '' }}{{ state?.shoe.runningCount ?? 0 }}
          </div>
        </div>
        <div class="rounded bg-white/5 py-1">
          <div class="text-[9px] uppercase text-muted">True</div>
          <div
            class="font-mono text-sm font-bold tabular-nums"
            :class="trueCount >= 2 ? 'text-green-400' : trueCount <= -2 ? 'text-red-400' : 'text-default'"
          >
            {{ trueCount > 0 ? '+' : '' }}{{ trueCount.toFixed(1) }}
          </div>
        </div>
      </div>
    </div>

    <!-- Live feed + table chat -->
    <div class="absolute bottom-2 left-2 w-[20%] min-w-46.5 rounded-xl bg-black/70 p-2 backdrop-blur-sm ring-1 ring-white/10">
      <ul class="mb-1.5 h-26 space-y-0.5 overflow-hidden text-[11px] leading-tight">
        <li
          v-for="item in visibleFeed"
          :key="item.id"
          :class="item.tone === 'win' ? 'text-green-400' : item.tone === 'loss' ? 'text-red-400' : 'text-muted'"
        >
          <span v-if="item.kind === 'chat'" class="text-default">
            <span class="font-bold text-amber-300/90">{{ item.name }}:</span> {{ item.text }}
          </span>
          <span v-else>{{ item.text }}</span>
        </li>
      </ul>
      <form class="flex gap-1" @submit.prevent="sendChat">
        <input
          v-model="chatDraft"
          maxlength="120"
          placeholder="Say something…"
          class="min-w-0 flex-1 rounded-md bg-white/5 px-2 py-1 text-[11px] text-default placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-amber-400/40"
        >
        <UButton type="submit" size="xs" color="neutral" variant="soft" icon="i-lucide-send" />
      </form>
    </div>

    <!-- Controls -->
    <div class="absolute bottom-2 right-2 w-[20%] min-w-50 rounded-xl bg-black/70 p-2.5 backdrop-blur-sm ring-1 ring-white/10">
      <div v-if="!connected" class="py-3 text-center text-xs text-muted">
        <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Connecting…
      </div>

      <template v-else-if="!mySeat">
        <p class="py-2 text-center text-xs text-muted">
          Click an open <span class="font-bold text-default">SIT</span> spot to join the table.
        </p>
      </template>

      <template v-else-if="needsInsurance">
        <p class="mb-1.5 text-center text-[11px] text-amber-300">
          Dealer shows an Ace — insurance costs half your bet.
        </p>
        <div class="grid grid-cols-2 gap-1.5">
          <UButton size="sm" color="warning" block @click="table.insurance(true)">
            Insure
          </UButton>
          <UButton size="sm" color="neutral" variant="soft" block @click="table.insurance(false)">
            No
          </UButton>
        </div>
      </template>

      <template v-else-if="isMyTurn">
        <div class="grid grid-cols-2 gap-1.5">
          <UButton size="sm" color="primary" block @click="table.act('hit')">
            Hit
          </UButton>
          <UButton size="sm" color="neutral" block @click="table.act('stand')">
            Stand
          </UButton>
          <UButton size="sm" color="success" variant="soft" block :disabled="!canDoubleNow" @click="table.act('double')">
            Double
          </UButton>
          <UButton size="sm" color="info" variant="soft" block :disabled="!canSplitNow" @click="table.act('split')">
            Split
          </UButton>
          <UButton
            v-if="canSurrenderNow"
            size="xs"
            color="neutral"
            variant="ghost"
            block
            class="col-span-2"
            @click="table.act('surrender')"
          >
            Surrender
          </UButton>
        </div>
      </template>

      <template v-else-if="isBetting">
        <div class="mb-1.5 flex items-baseline justify-between">
          <span class="text-[11px] uppercase tracking-wide text-muted">Your bet</span>
          <span class="font-mono text-sm font-bold tabular-nums text-amber-300">{{ formatNumber(pendingBet) }}</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <UButton size="xs" color="neutral" variant="soft" block :disabled="!pendingBet" @click="table.undoBet()">
            Undo
          </UButton>
          <UButton size="xs" color="neutral" variant="soft" block :disabled="!pendingBet" @click="table.clearBet()">
            Clear
          </UButton>
          <UButton size="xs" color="warning" variant="soft" block @click="table.repeatBet()">
            Repeat
          </UButton>
        </div>
        <p class="mt-1.5 text-center text-[10px] text-muted">
          Click chips on the rail to add them
        </p>
      </template>

      <template v-else>
        <p class="py-2 text-center text-xs text-muted">{{ state?.message }}</p>
      </template>

      <div v-if="mySeat" class="mt-2 border-t border-white/10 pt-1.5">
        <p v-if="mySeat.leaving" class="mb-1 text-center text-[10px] text-amber-300">
          Standing up once this hand settles
        </p>
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-muted">Seat {{ mySeat.index + 1 }}</span>
          <div class="flex gap-1">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :class="mySeat.away || mySeat.leaving ? 'text-amber-300' : ''"
              @click="table.setAway(false)"
              v-if="mySeat.away || mySeat.leaving"
            >
              {{ mySeat.leaving ? 'Stay' : 'Sit in' }}
            </UButton>
            <UButton v-else size="xs" color="neutral" variant="ghost" @click="table.setAway(true)">
              Sit out
            </UButton>
            <UButton v-if="!mySeat.leaving" size="xs" color="error" variant="ghost" @click="table.leave()">
              Leave
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
