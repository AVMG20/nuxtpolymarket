<script setup lang="ts">
import { chipRackFor } from '#shared/utils/live-blackjack/chips'
import { canDouble, canSplit, canSurrender } from '#shared/utils/live-blackjack/rules'
import { buildTextures } from '~/utils/live-blackjack/art'
import { LiveBlackjackScene, STAGE_H, STAGE_W } from '~/utils/live-blackjack/scene'

const table = useLiveBlackjack()
const { state, actionPulse, youId, balance, connected, feed, mySeat, myHand, isMyTurn } = table

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
const insuranceCost = computed(() => (mySeat.value?.hands[0]?.bet ?? 0) / 2)

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

watch(actionPulse, (pulse) => {
    if (pulse) scene?.flashAction(pulse.seat, pulse.action)
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

    <!--
      One control zone for everything. While chips are on the rail it sits in the
      band above them; every other phase hides the rail and it drops into its
      place, so controls and chips can never share the same space.
    -->
    <div
      class="absolute left-1/2 w-[54%] min-w-75 -translate-x-1/2"
      :class="isBetting ? 'bottom-[14%]' : 'bottom-[4%]'"
    >
      <div v-if="!connected" class="rounded-xl bg-black/70 py-3 text-center text-sm text-muted backdrop-blur-sm">
        <UIcon name="i-lucide-loader-circle" class="animate-spin" /> Connecting…
      </div>

      <div v-else-if="!mySeat" class="rounded-xl bg-black/60 py-3 text-center text-sm text-muted backdrop-blur-sm">
        Click an open <span class="font-bold text-default">SIT</span> spot to join the table
      </div>

      <div
        v-else-if="needsInsurance"
        class="rounded-xl bg-amber-500/15 p-2.5 text-center ring-2 ring-amber-400/70 backdrop-blur-sm"
      >
        <p class="mb-2 text-sm font-bold text-amber-200">
          Dealer shows an Ace — insure for {{ formatNumber(insuranceCost) }}?
        </p>
        <div class="mx-auto flex max-w-90 gap-2">
          <button class="lb-tile lb-tile-amber flex-1" @click="table.insurance(true)">
            Insurance
          </button>
          <button class="lb-tile lb-tile-slate flex-1" @click="table.insurance(false)">
            No thanks
          </button>
        </div>
      </div>

      <div v-else-if="isMyTurn" class="flex gap-2">
        <button class="lb-tile lb-tile-green flex-1" @click="table.act('hit')">
          HIT
        </button>
        <button class="lb-tile lb-tile-blue flex-1" @click="table.act('stand')">
          STAND
        </button>
        <button class="lb-tile lb-tile-amber flex-1" :disabled="!canDoubleNow" @click="table.act('double')">
          DOUBLE
        </button>
        <button class="lb-tile lb-tile-yellow flex-1" :disabled="!canSplitNow" @click="table.act('split')">
          SPLIT
        </button>
        <button v-if="canSurrenderNow" class="lb-tile lb-tile-red flex-1" @click="table.act('surrender')">
          FOLD
        </button>
      </div>

      <div v-else-if="isBetting" class="flex items-center gap-2">
        <div class="rounded-xl bg-black/70 px-3 py-2 text-center backdrop-blur-sm ring-1 ring-white/10">
          <div class="text-[9px] uppercase tracking-wider text-muted">Your bet</div>
          <div class="font-mono text-lg font-bold leading-tight tabular-nums text-amber-300">
            {{ formatNumber(pendingBet) }}
          </div>
        </div>
        <button class="lb-tile lb-tile-amber flex-1" :disabled="!mySeat.lastBet" @click="table.repeatBet()">
          REPEAT
        </button>
        <button class="lb-tile lb-tile-slate flex-1" :disabled="!pendingBet" @click="table.undoBet()">
          UNDO
        </button>
        <button class="lb-tile lb-tile-red flex-1" :disabled="!pendingBet" @click="table.clearBet()">
          CLEAR
        </button>
      </div>

      <div v-else class="rounded-xl bg-black/60 py-3 text-center text-sm font-semibold text-default backdrop-blur-sm">
        {{ state?.message }}
      </div>
    </div>

    <!-- Seat controls, out of the way of the action -->
    <div v-if="mySeat" class="absolute bottom-2 right-2 rounded-xl bg-black/70 px-2 py-1.5 backdrop-blur-sm ring-1 ring-white/10">
      <p v-if="mySeat.leaving" class="mb-1 text-center text-[10px] text-amber-300">
        Standing up after this hand
      </p>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-muted">Seat {{ mySeat.index + 1 }}</span>
        <UButton
          v-if="mySeat.away || mySeat.leaving"
          size="xs"
          color="warning"
          variant="ghost"
          @click="table.setAway(false)"
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
</template>

<style scoped>
/* Translucent so the felt reads through, but with a solid colour edge that
   stays legible over cards, chips and the dark rail alike. */
.lb-tile {
  padding: 0.7rem 0.5rem;
  border-radius: 0.75rem;
  border-width: 2px;
  border-style: solid;
  font-size: 0.9rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #f8fafc;
  backdrop-filter: blur(6px);
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
  transition: transform 0.12s ease, filter 0.12s ease;
}
.lb-tile:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.3);
}
.lb-tile:active:not(:disabled) {
  transform: translateY(1px);
}
.lb-tile:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}
.lb-tile-green {
  background: rgb(34 197 94 / 0.28);
  border-color: rgb(74 222 128 / 0.75);
}
.lb-tile-blue {
  background: rgb(59 130 246 / 0.28);
  border-color: rgb(96 165 250 / 0.75);
}
.lb-tile-amber {
  background: rgb(245 158 11 / 0.28);
  border-color: rgb(251 191 36 / 0.75);
}
.lb-tile-yellow {
  background: rgb(234 179 8 / 0.3);
  border-color: rgb(253 224 71 / 0.8);
  color: #fefce8;
}
.lb-tile-red {
  background: rgb(239 68 68 / 0.28);
  border-color: rgb(248 113 113 / 0.75);
}
.lb-tile-slate {
  background: rgb(100 116 139 / 0.3);
  border-color: rgb(148 163 184 / 0.7);
}
</style>
