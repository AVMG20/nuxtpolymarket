<script setup lang="ts">
import type { WheelResult, WheelDifficulty } from '#shared/utils/gamelogic/wheel'
import { WHEEL_CONFIGS } from '#shared/utils/gamelogic/wheel'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, v => { if (v !== undefined) balance.value = parseFloat(v ?? '0') })

const bet = ref(10)
const difficulty = ref<WheelDifficulty>('medium')
const isSpinning = ref(false)
const isFetching = ref(false)
const lastResult = ref<WheelResult | null>(null)
const lastBet = ref(0)
const errorMsg = ref('')
const history = ref<{ multiplier: number; won: boolean; payout: number; bet: number }[]>([])

const canvasRef = ref<HTMLCanvasElement | null>(null)
// rotationOffset: how far the wheel has been rotated clockwise (radians).
// Segment i occupies angles [i*arc, (i+1)*arc] measured clockwise from top (12 o'clock).
// After rotation, segment i's midpoint sits at: rotationOffset + (i + 0.5) * arc  (clockwise from top)
// The pointer is at 0 (top). Segment is under pointer when: (rotationOffset + (i+0.5)*arc) % 2π == 0
const rotationOffset = ref(0)
const animFrame = ref<number | null>(null)

const difficultyOptions: { label: string; value: WheelDifficulty; desc: string }[] = [
  { label: 'Easy',   value: 'easy',   desc: '1 loss / 10' },
  { label: 'Medium', value: 'medium', desc: '3 losses / 10' },
  { label: 'Hard',   value: 'hard',   desc: '5 losses / 10' },
]

const COLOR_MAP: Record<string, string> = {
  0:      '#ef4444',
  red:    '#ef4444',
  blue:   '#3b82f6',
  yellow: '#f59e0b',
  green:  '#22c55e',
}


// Color tiers by multiplier value
function segmentColor(color: string): string {
  return COLOR_MAP[color] ?? '#a7a3a3'
}

// Build flat interleaved segment list (losses evenly spread)
const wheelSegments = computed(() => {
  const segs = WHEEL_CONFIGS[difficulty.value]
  const lossCount = segs.find(s => s.multiplier === 0)?.count ?? 0
  const nonLossFlat: { multiplier: number; color: string }[] = []
  for (const seg of segs.filter(s => s.multiplier > 0)) {
    for (let i = 0; i < seg.count; i++) {
      nonLossFlat.push({ multiplier: seg.multiplier, color: segmentColor(seg.color) })
    }
  }
  if (lossCount === 0) return nonLossFlat

  const result: { multiplier: number; color: string }[] = []
  const spacing = nonLossFlat.length / lossCount
  let nextLoss = Math.floor(spacing / 2)
  let lossPlaced = 0
  let nlIdx = 0

  while (nlIdx < nonLossFlat.length || lossPlaced < lossCount) {
    if (lossPlaced < lossCount && result.length >= Math.round(nextLoss + lossPlaced)) {
      result.push({ multiplier: 0, color: segmentColor(0) })
      lossPlaced++
      nextLoss += spacing
    } else if (nlIdx < nonLossFlat.length) {
      result.push(nonLossFlat[nlIdx]!)
      nlIdx++
    } else {
      result.push({ multiplier: 0, color: segmentColor(0) })
      lossPlaced++
    }
  }
  return result
})

// ─── Draw ──────────────────────────────────────────────────────────────────
// We define segment i's start angle (canvas coords, 0=right, clockwise) as:
//   canvasAngle = -π/2 + rotationOffset + i * arc
// This means rotationOffset=0 puts segment 0's start at the top (12 o'clock).
// Segment i's midpoint is at: -π/2 + rotationOffset + (i + 0.5) * arc
// Under pointer (top = -π/2 in canvas) means midpoint = -π/2:
//   rotationOffset + (i + 0.5) * arc ≡ 0 (mod 2π)
//   rotationOffset ≡ -(i + 0.5) * arc   (mod 2π)

function drawWheel(highlightIndex?: number) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const segs = wheelSegments.value
  const n   = segs.length
  const cx  = canvas.width  / 2
  const cy  = canvas.height / 2
  const r   = cx - 6
  const arc = (2 * Math.PI) / n

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  for (let i = 0; i < n; i++) {
    const startAngle = -Math.PI / 2 + rotationOffset.value + i * arc
    const endAngle   = startAngle + arc
    const isHighlit  = highlightIndex === i

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, startAngle, endAngle)
    ctx.closePath()
    ctx.fillStyle = isHighlit ? lighten(segs[i]!.color, 55) : segs[i]!.color
    ctx.fill()
    ctx.strokeStyle = '#0a0a0a'
    ctx.lineWidth = 2
    ctx.stroke()

    // Label — centred in the segment, rotated to read outward
    const midAngle = startAngle + arc / 2
    const labelR   = r * 0.66
    ctx.save()
    ctx.translate(cx + Math.cos(midAngle) * labelR, cy + Math.sin(midAngle) * labelR)
    ctx.rotate(midAngle + Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = isHighlit ? '#000' : '#fff'
    ctx.font = `bold ${n <= 12 ? 14 : 11}px ui-monospace, monospace`
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 3
    ctx.fillText(segs[i]!.multiplier === 0 ? '0×' : `${segs[i]!.multiplier}×`, 0, 0)
    ctx.restore()
  }

  // Outer ring
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 2 * Math.PI)
  ctx.strokeStyle = '#222'
  ctx.lineWidth = 3
  ctx.stroke()

  // Hub
  ctx.beginPath()
  ctx.arc(cx, cy, 18, 0, 2 * Math.PI)
  ctx.fillStyle = '#111'
  ctx.fill()
  ctx.strokeStyle = '#2a2a2a'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, 2 * Math.PI)
  ctx.fillStyle = '#444'
  ctx.fill()
}

function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, ((n >> 16) & 0xff) + amt)
  const g = Math.min(255, ((n >>  8) & 0xff) + amt)
  const b = Math.min(255, ( n        & 0xff) + amt)
  return `rgb(${r},${g},${b})`
}

// ─── Animation ────────────────────────────────────────────────────────────
function easeOut(t: number) { return 1 - Math.pow(1 - t, 4) }

function animateSpin(from: number, to: number, duration: number, winIdx: number, onDone: () => void) {
  const startTime = Date.now()
  const tick = () => {
    const t = Math.min(1, (Date.now() - startTime) / duration)
    rotationOffset.value = from + (to - from) * easeOut(t)
    drawWheel()
    if (t < 1) {
      animFrame.value = requestAnimationFrame(tick)
    } else {
      rotationOffset.value = to % (2 * Math.PI)
      drawWheel(winIdx)
      onDone()
    }
  }
  animFrame.value = requestAnimationFrame(tick)
}

// ─── Spin ──────────────────────────────────────────────────────────────────
async function spin() {
  if (isSpinning.value || balance.value < bet.value) return
  isSpinning.value = true
  isFetching.value = true
  lastResult.value = null
  errorMsg.value = ''
  lastBet.value = bet.value

  try {
    const data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'wheel', options: { difficulty: difficulty.value } }
    }) as { gameData: WheelResult; balance: number }

    isFetching.value = false

    const segs = wheelSegments.value
    const n   = segs.length
    const arc = (2 * Math.PI) / n

    // Pick any flat index that matches the winning multiplier
    const winMult    = data.gameData.multiplier
    const candidates = segs.map((s, i) => i).filter(i => segs[i]!.multiplier === winMult)
    const winIdx     = candidates[Math.floor(Math.random() * candidates.length)]!

    // Target rotationOffset so winIdx's midpoint is at the top:
    //   rotationOffset ≡ -(winIdx + 0.5) * arc  (mod 2π)
    const targetBase = ((-(winIdx + 0.5) * arc) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)

    // How much more do we need to rotate from current normalised position to reach targetBase?
    const currentNorm = ((rotationOffset.value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const remaining   = ((targetBase - currentNorm) + 2 * Math.PI) % (2 * Math.PI)

    // Add full spins so it looks dramatic, never go backwards
    const extraSpins  = (2 + Math.floor(Math.random() * 4)) * 2 * Math.PI
    const targetOffset = rotationOffset.value + extraSpins + remaining

    animateSpin(rotationOffset.value, targetOffset, 1800, winIdx, () => {
      lastResult.value = data.gameData
      balance.value = data.balance
      setBalance(data.balance)
      history.value.unshift({ multiplier: data.gameData.multiplier, won: data.gameData.won, payout: data.gameData.payout, bet: lastBet.value })
      if (history.value.length > 8) history.value.pop()
      isSpinning.value = false
    })
  } catch (e: unknown) {
    isFetching.value = false
    isSpinning.value = false
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function pillClass(m: number): string {
  if (m === 0)   return 'bg-red-500/20 text-red-400'     // red
  if (m < 1.8)   return 'bg-blue-500/20 text-blue-400'   // blue (1.4, 1.8 on easy)
  if (m < 3)     return 'bg-green-500/20 text-green-400'  // green (1.8, 2)
  if (m < 5)     return 'bg-amber-500/20 text-amber-400'  // yellow (3, 5)
  return 'bg-amber-500/20 text-amber-400'                 // yellow (5)
}

const totalSegments = computed(() =>
  WHEEL_CONFIGS[difficulty.value].reduce((s, seg) => s + seg.count, 0)
)
const winChancePct = computed(() => {
  const cfg = WHEEL_CONFIGS[difficulty.value]
  const winning = cfg.filter(s => s.multiplier > 0).reduce((a, s) => a + s.count, 0)
  return ((winning / totalSegments.value) * 100).toFixed(0)
})
const maxPayout = computed(() =>
  bet.value * Math.max(...WHEEL_CONFIGS[difficulty.value].map(s => s.multiplier))
)

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); spin() }
}
onMounted(() => { window.addEventListener('keydown', onKeydown); nextTick(() => drawWheel()) })
onUnmounted(() => { window.removeEventListener('keydown', onKeydown); if (animFrame.value) cancelAnimationFrame(animFrame.value) })
watch(difficulty, () => { rotationOffset.value = 0; lastResult.value = null; nextTick(() => drawWheel()) })
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon name="i-lucide-circle-dot" class="size-6 text-primary" />
        Wheel
      </h1>
      <p class="text-sm text-muted mt-0.5">98% RTP</p>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">

      <!-- Controls -->
      <UCard>
        <template #header><h2 class="font-semibold">Controls</h2></template>
        <div class="space-y-4">

          <!-- Bet -->
          <div>
            <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">Bet Amount</label>
            <div class="flex items-center gap-2">
              <UInput v-model.number="bet" type="number" min="1" :disabled="isSpinning" class="flex-1 font-mono" size="lg" />
              <div class="flex gap-1">
                <UButton color="neutral" variant="soft" :disabled="isSpinning" @click="bet = Math.max(1, Math.floor(bet / 2))">½</UButton>
                <UButton color="neutral" variant="soft" :disabled="isSpinning" @click="bet = bet * 2">2×</UButton>
              </div>
            </div>
          </div>

          <!-- Difficulty -->
          <div>
            <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">Difficulty</label>
            <div class="grid grid-cols-3 gap-1.5">
              <button
                v-for="opt in difficultyOptions" :key="opt.value"
                :disabled="isSpinning"
                class="flex flex-col items-center py-2 px-1 rounded-lg border text-xs font-bold transition-all disabled:opacity-40"
                :class="difficulty === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-default bg-elevated text-muted hover:border-muted'"
                @click="difficulty = opt.value"
              >
                <span>{{ opt.label }}</span>
                <span class="font-normal text-[10px] mt-0.5 opacity-60">{{ opt.desc }}</span>
              </button>
            </div>
          </div>

          <!-- Legend -->
          <div class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <p class="text-xs text-muted uppercase tracking-wide font-medium mb-2">Segments</p>
            <div v-for="seg in WHEEL_CONFIGS[difficulty]" :key="seg.multiplier" class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <span class="size-3 rounded-sm flex-shrink-0" :style="`background:${segmentColor(seg.color)}`" />
                <span class="text-muted">{{ seg.multiplier === 0 ? 'Loss' : `${seg.multiplier}×` }}</span>
              </div>
              <span class="font-mono font-bold text-xs text-muted">{{ seg.count }}/{{ totalSegments }}</span>
            </div>
          </div>

          <!-- Stats -->
          <div class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <div class="flex justify-between text-sm">
              <span class="text-muted">Win Chance</span>
              <span class="font-bold">{{ winChancePct }}%</span>
            </div>
            <USeparator />
            <div class="flex justify-between text-sm">
              <span class="text-muted">Max Payout</span>
              <span class="font-bold text-success">${{ formatNumber(maxPayout, false) }}</span>
            </div>
          </div>

          <Transition name="fade-up">
            <UAlert v-if="errorMsg" color="error" variant="soft" :description="errorMsg"
                    :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }" @close="errorMsg = ''" />
          </Transition>

          <div class="rounded-lg bg-elevated border border-default p-3 flex justify-between items-center">
            <span class="text-xs text-muted uppercase tracking-wide font-medium">Balance</span>
            <span class="font-bold text-sm"><CoinBalance :value="balance" :compact="false" /></span>
          </div>
        </div>
      </UCard>

      <!-- Game Area -->
      <div class="lg:col-span-2 flex flex-col gap-4">
        <UCard :ui="{ body: 'relative overflow-hidden min-h-[400px] flex flex-col p-6' }">

          <!-- History pills -->
          <div class="flex gap-1.5 flex-wrap mb-3 min-h-[26px]">
            <TransitionGroup name="pill-slide">
              <span v-for="(h, i) in history" :key="i"
                    class="inline-flex items-center px-2 py-1 rounded text-xs font-mono font-bold"
                    :class="pillClass(h.multiplier)">{{ h.multiplier }}×</span>
            </TransitionGroup>
          </div>

          <div class="flex-1 flex flex-col items-center justify-center gap-5 relative z-10">

            <!-- Wheel + pointer -->
            <div class="relative flex items-start justify-center">
              <!-- Downward triangle pointer, tip touching the wheel rim -->
              <div class="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
                   style="top: -16px; width: 0; height: 0;
                       border-left: 12px solid transparent;
                       border-right: 12px solid transparent;
                       border-top: 22px solid #22c55e;
                       filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));" />
              <canvas
                ref="canvasRef"
                width="340" height="340"
                class="block rounded-full"
                :class="isSpinning ? 'drop-shadow-[0_0_28px_rgba(34,197,94,0.2)]' : ''"
              />
            </div>

            <!-- Result -->
            <Transition name="fade-up" mode="out-in">
              <div v-if="!isSpinning && lastResult" :key="String(lastResult.multiplier)" class="text-center">
                <div class="text-4xl font-black font-mono tabular-nums"
                     :class="lastResult.won ? 'text-success' : 'text-error'">
                  {{ lastResult.won ? `+$${formatNumber(lastResult.payout, false)}` : '+$0' }}
                </div>
                <div class="text-sm text-muted mt-1">{{ lastResult.multiplier }}× multiplier</div>
              </div>
              <div v-else-if="isFetching" key="fetching" class="text-muted font-mono animate-pulse text-sm">Spinning...</div>
              <div v-else key="idle" class="h-16" />
            </Transition>
          </div>

          <div class="absolute inset-0 pointer-events-none transition-opacity duration-300"
               :class="isSpinning ? 'opacity-10 animate-pulse bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/30 via-transparent to-transparent' : 'opacity-0'" />
        </UCard>

        <!-- Spin button -->
        <UCard>
          <div class="flex items-center gap-4">
            <UButton block :loading="isSpinning" :disabled="balance < bet" color="primary" size="xl"
                     class="flex-1 h-16 text-lg font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
                     @click="spin">
              {{ isSpinning ? 'Spinning...' : 'Spin' }}
            </UButton>
            <div class="hidden sm:flex flex-col items-end px-4 text-sm font-mono text-muted whitespace-nowrap">
              <span>Press <kbd class="px-2 py-1 bg-elevated rounded text-xs font-sans font-bold border border-default">SPACE</kbd></span>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }
.pill-slide-enter-active { transition: all 0.25s ease; }
.pill-slide-enter-from { opacity: 0; transform: translateX(-8px); }
</style>
