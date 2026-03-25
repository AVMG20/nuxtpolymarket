<script setup lang="ts">
import type { GridCell, GameFrame } from '#shared/utils/gamelogic/cyber-cascade'
import { GRID_SIZE, GRID_WIDTH, GRID_HEIGHT, playGame } from '#shared/utils/gamelogic/cyber-cascade'
const { user } = useAuth()

// --- State ---
const balance = ref(parseFloat(user.value?.balance ?? '0'))
const bet = ref(10)
const grid = ref<GridCell[]>(getEmptyGrid())
const trails = ref<number[]>(Array(GRID_SIZE).fill(0))
const currentWin = ref(0)
const isSpinning = ref(false)
const isPlayingFrames = ref(false)
const bonusActive = ref(false)
const freeSpinsLeft = ref(0)
const bonusTotalWin = ref(0)
const status = ref('SYSTEM READY')
const muted = ref(false)
const showPaytable = ref(false)
const showAutoSpin = ref(false)
const isAutoSpinning = ref(false)
const autoSpinsLeft = ref(0)
const activePopups = ref<{ id: string, amount: number, row: number, col: number }[]>([])

// --- Simulation modal state ---
const showSimulation = ref(false)
const simulating = ref(false)
const simProgress = ref(0)
const simIterations = ref(10000)
interface SimStats {
  totalSpins: number; totalWin: number; totalBet: number
  bonusCount: number; rtp: number
  topWins: { rank: number, amount: number, multiple: number, type: string }[]
}
const simStats = ref<SimStats | null>(null)

function getEmptyGrid(): GridCell[] {
  return Array(GRID_SIZE).fill(null).map(() => ({
    id: crypto.randomUUID(),
    type: 'EMPTY' as const,
    baseValue: 0
  }))
}

watch(() => user.value?.balance, (val) => {
  if (val !== undefined) balance.value = parseFloat(val ?? '0')
})

// --- Audio ---
const audioCtxRef = ref<AudioContext | null>(null)

function initAudio() {
  if (!audioCtxRef.value) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtxRef.value = new AC()
  }
  if (audioCtxRef.value.state === 'suspended') audioCtxRef.value.resume()
}

function playSound(type: 'spin' | 'win' | 'bonus') {
  if (muted.value || !audioCtxRef.value) return
  const ctx = audioCtxRef.value
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  if (type === 'spin') {
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(200, t)
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.3)
    gain.gain.setValueAtTime(0.1, t)
    gain.gain.linearRampToValueAtTime(0, t + 0.3)
    osc.start(t); osc.stop(t + 0.3)
  } else if (type === 'win') {
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, t)
    osc.frequency.linearRampToValueAtTime(880, t + 0.1)
    gain.gain.setValueAtTime(0.1, t)
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5)
    osc.start(t); osc.stop(t + 0.5)
  } else if (type === 'bonus') {
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(100, t)
    osc.frequency.linearRampToValueAtTime(800, t + 1)
    gain.gain.setValueAtTime(0.2, t)
    gain.gain.linearRampToValueAtTime(0, t + 2)
    osc.start(t); osc.stop(t + 2)
  }
}

// --- Frame playback ---
async function playFrames(frames: GameFrame[]) {
  for (const frame of frames) {
    grid.value = frame.grid
    trails.value = frame.trails
    if (frame.action === 'MATCH' && frame.winEvents.length > 0) {
      playSound('win')
      currentWin.value = frame.roundWin
      const newPopups = frame.winEvents.map(we => ({
        id: Math.random().toString(36).slice(2),
        amount: we.amount,
        row: we.row,
        col: we.col
      }))
      activePopups.value = [...activePopups.value, ...newPopups]
      setTimeout(() => {
        const ids = new Set(newPopups.map(p => p.id))
        activePopups.value = activePopups.value.filter(p => !ids.has(p.id))
      }, 500)
    }
    const delay = frame.action === 'INIT' ? 300 : frame.action === 'MATCH' ? 600 : frame.action === 'GRAVITY' ? 400 : 300
    await new Promise(r => setTimeout(r, delay))
  }
}

// --- Main spin ---
async function runRound() {
  if (isSpinning.value || isPlayingFrames.value) return
  if (balance.value < bet.value) {
    status.value = 'INSUFFICIENT FUNDS'
    isAutoSpinning.value = false
    return
  }

  isSpinning.value = true
  isPlayingFrames.value = true
  currentWin.value = 0
  activePopups.value = []
  playSound('spin')
  status.value = 'SCANNING SECTORS...'

  try {
    const result = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'cyber-cascade' }
    }) as { gameData: ReturnType<typeof playGame>, balance: number }

    const { gameData } = result

    await playFrames(gameData.baseRound.frames)

    if (gameData.freeSpins && gameData.freeSpins.length > 0) {
      playSound('bonus')
      status.value = '!!! BONUS PROTOCOL INITIATED !!!'
      await new Promise(r => setTimeout(r, 1500))
      bonusActive.value = true
      freeSpinsLeft.value = gameData.freeSpins.length
      let runningBonusTotal = 0

      for (let i = 0; i < gameData.freeSpins.length; i++) {
        currentWin.value = 0
        freeSpinsLeft.value = gameData.freeSpins.length - i
        status.value = `BONUS SEQUENCE ${i + 1}/${gameData.freeSpins.length}`
        await playFrames(gameData.freeSpins[i].frames)
        runningBonusTotal += gameData.freeSpins[i].totalWin
        bonusTotalWin.value = runningBonusTotal
        currentWin.value = 0
        await new Promise(r => setTimeout(r, 800))
      }

      status.value = `BONUS COMPLETE — WIN: $${runningBonusTotal.toFixed(2)}`
      currentWin.value = gameData.payout
      bonusActive.value = false
      bonusTotalWin.value = 0
      freeSpinsLeft.value = 0
      isAutoSpinning.value = false
    } else {
      currentWin.value = gameData.payout
      status.value = gameData.payout > 0 ? `WIN: $${gameData.payout.toFixed(2)}` : 'SYSTEM READY'
    }

    balance.value = result.balance
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'GAME ERROR'
    status.value = message
    isAutoSpinning.value = false
  }

  isPlayingFrames.value = false
  isSpinning.value = false
}

// --- Auto spin ---
let autoSpinTimer: ReturnType<typeof setTimeout> | null = null

watch([isAutoSpinning, isSpinning, bonusActive, autoSpinsLeft], () => {
  if (autoSpinTimer) { clearTimeout(autoSpinTimer); autoSpinTimer = null }
  if (isAutoSpinning.value && !isSpinning.value && !bonusActive.value && autoSpinsLeft.value > 0) {
    autoSpinTimer = setTimeout(() => {
      autoSpinsLeft.value = Math.max(0, autoSpinsLeft.value - 1)
      runRound()
    }, 500)
  } else if (autoSpinsLeft.value === 0 && isAutoSpinning.value) {
    isAutoSpinning.value = false
  }
})

onUnmounted(() => { if (autoSpinTimer) clearTimeout(autoSpinTimer) })

function startAutoSpin(count: number) {
  autoSpinsLeft.value = count
  isAutoSpinning.value = true
  showAutoSpin.value = false
  initAudio()
}

function stopAutoSpin() {
  isAutoSpinning.value = false
  autoSpinsLeft.value = 0
}

// --- Simulation ---
function runSimulation() {
  simulating.value = true
  simStats.value = null
  simProgress.value = 0

  setTimeout(() => {
    let count = 0
    let totalWin = 0
    let bonusCount = 0
    const topWins: { rank: number, amount: number, multiple: number, type: string }[] = []
    const chunkSize = 200

    const processChunk = () => {
      const end = Math.min(count + chunkSize, simIterations.value)
      for (; count < end; count++) {
        const session = playGame(bet.value)
        totalWin += session.payout
        if (session.freeSpins) bonusCount++
        if (session.payout > 0) {
          const entry = { rank: 0, amount: session.payout, multiple: session.payout / bet.value, type: session.freeSpins ? 'BONUS' : 'BASE' }
          if (topWins.length < 20) { topWins.push(entry); topWins.sort((a, b) => b.amount - a.amount) }
          else if (session.payout > topWins[topWins.length - 1].amount) { topWins.pop(); topWins.push(entry); topWins.sort((a, b) => b.amount - a.amount) }
        }
      }
      simProgress.value = count / simIterations.value
      if (count < simIterations.value) {
        requestAnimationFrame(processChunk)
      } else {
        const totalBet = simIterations.value * bet.value
        simStats.value = { totalSpins: simIterations.value, totalWin, totalBet, bonusCount, rtp: (totalWin / totalBet) * 100, topWins: topWins.map((w, i) => ({ ...w, rank: i + 1 })) }
        simulating.value = false
      }
    }
    requestAnimationFrame(processChunk)
  }, 100)
}

const displayWin = computed(() => bonusActive.value ? bonusTotalWin.value + currentWin.value : currentWin.value)
</script>

<template>
  <div class="min-h-screen bg-zinc-950 font-mono text-cyan-50 overflow-hidden relative">
    <!-- Grid bg -->
    <div class="absolute inset-0 z-0 pointer-events-none opacity-20">
      <div class="absolute inset-0 bg-[linear-gradient(rgba(0,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.08)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)]" />
    </div>

    <main class="relative z-10 flex flex-col items-center justify-center min-h-screen p-4 gap-4">
      <!-- Header -->
      <header class="text-center">
        <h1
          class="text-4xl md:text-6xl font-black tracking-tighter uppercase transition-colors duration-500"
          :class="bonusActive
            ? 'text-fuchsia-500 drop-shadow-[0_0_25px_rgba(217,70,239,0.4)]'
            : 'text-transparent bg-clip-text bg-gradient-to-br from-cyan-300 to-blue-600'"
        >
          Cyber Cascade
        </h1>
        <div class="flex items-center justify-center gap-2 text-[10px] font-bold tracking-[0.3em] text-slate-500 mt-1">
          <span>VOLATILE</span><span class="w-1 h-1 bg-slate-600 rounded-full" /><span>GRID</span><span class="w-1 h-1 bg-slate-600 rounded-full" /><span>SYSTEM</span>
        </div>
      </header>

      <!-- Status bar -->
      <div class="w-full max-w-[600px] flex justify-between items-end border-b border-white/10 pb-2 px-1">
        <div>
          <div class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Status</div>
          <div class="text-base font-bold tracking-wider animate-pulse" :class="bonusActive ? 'text-fuchsia-400' : 'text-cyan-400'">
            {{ status }}
          </div>
        </div>
        <div v-if="bonusActive" class="text-right">
          <div class="text-[10px] text-fuchsia-600 font-bold uppercase tracking-widest">Free Games</div>
          <div class="text-2xl font-black text-fuchsia-500 leading-none">{{ freeSpinsLeft }}</div>
        </div>
        <div v-else-if="isAutoSpinning" class="text-right">
          <div class="text-[10px] text-cyan-600 font-bold uppercase tracking-widest">Auto Left</div>
          <div class="text-lg font-bold text-cyan-500 leading-none">{{ autoSpinsLeft > 900 ? '∞' : autoSpinsLeft }}</div>
        </div>
      </div>

      <!-- Grid -->
      <div class="relative">
        <div
          class="absolute -inset-1 rounded-sm blur-md opacity-75 transition-all duration-500"
          :class="bonusActive ? 'bg-fuchsia-600/30' : 'bg-cyan-600/20'"
        />
        <div class="relative bg-black border border-white/10 p-1 rounded-sm shadow-2xl">
          <div class="grid gap-1 w-[300px] md:w-[540px]" :style="`grid-template-columns: repeat(${GRID_WIDTH}, 1fr); aspect-ratio: ${GRID_WIDTH}/${GRID_HEIGHT};`">
            <GamesCyberCascadeGridItem
              v-for="(cell, index) in grid"
              :key="cell.id"
              :cell="cell"
              :trail-multiplier="trails[index]"
              :index="index"
            />
          </div>

          <!-- Floating win popups -->
          <TransitionGroup name="popup" tag="div" class="absolute inset-0 pointer-events-none">
            <div
              v-for="popup in activePopups"
              :key="popup.id"
              class="absolute z-50 w-0 h-0 flex items-center justify-center"
              :style="{ left: `${(popup.col + 0.5) * (100 / GRID_WIDTH)}%`, top: `${(popup.row + 0.5) * (100 / GRID_HEIGHT)}%` }"
            >
              <div class="bg-black/90 border border-yellow-500/50 rounded px-2 py-0.5 shadow-[0_0_15px_rgba(234,179,8,0.4)] whitespace-nowrap">
                <span class="font-bold text-sm text-yellow-400 font-mono">${{ popup.amount.toFixed(2) }}</span>
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <!-- Win display -->
      <div class="h-12 w-full max-w-[600px] flex items-center justify-center">
        <Transition name="win">
          <div v-if="displayWin > 0" class="flex flex-col items-center">
            <span class="text-[10px] text-yellow-500 font-bold uppercase tracking-[0.2em]">
              {{ bonusActive ? 'Total Bonus Win' : 'Round Win' }}
            </span>
            <span class="text-3xl md:text-4xl font-black text-white drop-shadow-[0_0_15px_rgba(234,179,8,0.6)]">
              ${{ displayWin.toFixed(2) }}
            </span>
          </div>
        </Transition>
      </div>

      <!-- Controls -->
      <div class="w-full max-w-[600px] grid grid-cols-[1fr_auto_1fr] gap-4 items-center bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
        <!-- Balance -->
        <div>
          <div class="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Credits</div>
          <div class="text-xl font-mono text-white">${{ balance.toFixed(2) }}</div>
        </div>

        <!-- Spin + Auto buttons -->
        <div class="relative flex items-center justify-center">
          <button
            :disabled="isSpinning || isAutoSpinning"
            class="w-20 h-20 flex items-center justify-center rounded-full border-4 transition-all duration-200"
            :class="bonusActive
              ? 'border-fuchsia-500/50 bg-fuchsia-950/50 text-fuchsia-400'
              : isSpinning || isAutoSpinning
                ? 'border-slate-700 bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'border-cyan-500/50 bg-cyan-950/50 text-cyan-400 hover:scale-110 hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(34,211,238,0.4)]'"
            @click="() => { initAudio(); runRound() }"
          >
            <UIcon v-if="bonusActive" name="i-lucide-rotate-cw" class="size-8 animate-spin" />
            <div v-else-if="isSpinning" class="w-3 h-3 bg-current rounded-full animate-bounce" />
            <UIcon v-else name="i-lucide-play" class="size-8 ml-1" />
          </button>

          <!-- Auto spin toggle -->
          <button
            :disabled="isSpinning && !isAutoSpinning"
            class="absolute -right-12 w-10 h-10 flex items-center justify-center rounded-full border-2 transition-all"
            :class="isAutoSpinning
              ? 'bg-red-950/50 border-red-500 text-red-500 hover:bg-red-900'
              : 'bg-zinc-900 border-zinc-700 text-slate-400 hover:border-cyan-400 hover:text-cyan-400'"
            @click="isAutoSpinning ? stopAutoSpin() : showAutoSpin = true"
          >
            <UIcon v-if="isAutoSpinning" name="i-lucide-square" class="size-4" />
            <UIcon v-else name="i-lucide-refresh-cw" class="size-4" />
          </button>
        </div>

        <!-- Bet control -->
        <div class="flex flex-col items-end">
          <div class="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Bet Level</div>
          <div class="flex items-center gap-1.5">
            <button
              :disabled="isSpinning || isAutoSpinning"
              class="px-1.5 py-1 text-xs font-bold bg-zinc-800 rounded hover:bg-white/10 disabled:opacity-50 text-slate-400"
              @click="!isSpinning && !isAutoSpinning && (bet = Math.max(1, Math.floor(bet / 2)))"
            >½</button>
            <button
              :disabled="isSpinning || isAutoSpinning"
              class="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white disabled:opacity-50"
              @click="!isSpinning && !isAutoSpinning && bet > 1 && bet--"
            >
              <UIcon name="i-lucide-minus" class="size-3.5" />
            </button>
            <span class="text-xl font-mono text-white min-w-[3ch] text-center">{{ bet }}</span>
            <button
              :disabled="isSpinning || isAutoSpinning"
              class="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white disabled:opacity-50"
              @click="!isSpinning && !isAutoSpinning && bet++"
            >
              <UIcon name="i-lucide-plus" class="size-3.5" />
            </button>
            <button
              :disabled="isSpinning || isAutoSpinning"
              class="px-1.5 py-1 text-xs font-bold bg-zinc-800 rounded hover:bg-white/10 disabled:opacity-50 text-slate-400"
              @click="!isSpinning && !isAutoSpinning && (bet = bet * 2)"
            >2x</button>
          </div>
        </div>
      </div>

      <!-- Footer buttons -->
      <div class="flex gap-5 text-slate-500 text-xs font-bold uppercase tracking-widest">
        <button class="hover:text-cyan-400 transition-colors flex items-center gap-1.5" @click="showPaytable = true">
          <UIcon name="i-lucide-info" class="size-3.5" /> Data Logs
        </button>
        <button class="hover:text-fuchsia-400 transition-colors flex items-center gap-1.5" @click="showSimulation = true">
          <UIcon name="i-lucide-activity" class="size-3.5" /> RTP Test
        </button>
        <button class="hover:text-cyan-400 transition-colors flex items-center gap-1.5" @click="muted = !muted">
          <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-3.5" />
          {{ muted ? 'Muted' : 'Audio' }}
        </button>
      </div>
    </main>

    <!-- Auto Spin Modal -->
    <Transition name="modal">
      <div v-if="showAutoSpin" class="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-zinc-950 border border-cyan-500/50 p-6 rounded-xl shadow-[0_0_30px_rgba(6,182,212,0.2)] max-w-sm w-full">
          <div class="flex justify-between items-center mb-6">
            <h3 class="text-cyan-400 font-bold uppercase tracking-widest flex items-center gap-2">
              <UIcon name="i-lucide-refresh-cw" class="size-4" /> Auto-Pilot
            </h3>
            <button class="text-slate-500 hover:text-white" @click="showAutoSpin = false">
              <UIcon name="i-lucide-x" class="size-5" />
            </button>
          </div>
          <div class="grid grid-cols-3 gap-3 mb-4">
            <button
              v-for="count in [10, 25, 50, 100, 250, 1000]"
              :key="count"
              class="bg-zinc-900 border border-white/10 hover:border-cyan-400 hover:bg-cyan-950/30 hover:text-cyan-400 text-slate-300 py-3 rounded font-mono font-bold transition-all"
              @click="startAutoSpin(count)"
            >
              {{ count === 1000 ? '∞' : count }}
            </button>
          </div>
          <p class="text-center text-[10px] text-slate-500 uppercase tracking-widest">Stops on bonus feature</p>
        </div>
      </div>
    </Transition>

    <!-- Paytable Modal -->
    <Transition name="modal">
      <div v-if="showPaytable" class="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4" @click.self="showPaytable = false">
        <div class="bg-zinc-950 border border-cyan-900 w-full max-w-2xl max-h-[80vh] overflow-auto rounded-xl shadow-2xl">
          <div class="sticky top-0 bg-zinc-950/95 border-b border-white/10 p-4 flex justify-between items-center z-10">
            <h2 class="text-cyan-500 font-bold uppercase tracking-widest">System Database</h2>
            <button @click="showPaytable = false"><UIcon name="i-lucide-x" class="size-5 text-slate-400 hover:text-white" /></button>
          </div>
          <GamesCyberCascadePaytable :bet="bet" />
        </div>
      </div>
    </Transition>

    <!-- Simulation Modal -->
    <Transition name="modal">
      <div v-if="showSimulation" class="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
        <div class="bg-zinc-950 border border-fuchsia-900 w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl shadow-2xl overflow-hidden">
          <div class="bg-zinc-900/50 p-4 border-b border-white/10 flex justify-between items-center">
            <h2 class="text-fuchsia-500 font-bold uppercase tracking-widest flex items-center gap-2">
              <UIcon name="i-lucide-activity" class="size-5 animate-pulse" /> System Simulation
            </h2>
            <button v-if="!simulating" class="text-slate-400 hover:text-white" @click="showSimulation = false; simStats = null">
              <UIcon name="i-lucide-x" class="size-5" />
            </button>
          </div>
          <div class="p-6 overflow-y-auto flex-1 space-y-6 font-mono">
            <template v-if="!simStats && !simulating">
              <div class="flex flex-col items-center gap-6 py-8">
                <div class="text-center space-y-2">
                  <p class="text-slate-400 text-xs uppercase font-bold tracking-widest">Simulation Cycles</p>
                  <div class="flex gap-2 flex-wrap justify-center">
                    <button
                      v-for="v in [1000, 10000, 100000, 1000000]"
                      :key="v"
                      class="px-4 py-2 rounded border transition-all font-mono text-sm"
                      :class="simIterations === v ? 'bg-fuchsia-600 border-fuchsia-500 text-white' : 'bg-black border-zinc-800 text-slate-500 hover:border-zinc-600 hover:text-white'"
                      @click="simIterations = v"
                    >{{ v.toLocaleString() }}</button>
                  </div>
                </div>
                <button
                  class="px-8 py-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold tracking-widest rounded-full"
                  @click="runSimulation"
                >START SEQUENCE</button>
              </div>
            </template>
            <template v-else-if="simulating">
              <div class="flex flex-col items-center justify-center py-16 gap-4">
                <div class="text-fuchsia-400 font-mono text-2xl animate-pulse">PROCESSING...</div>
                <div class="w-full max-w-md h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div class="h-full bg-fuchsia-500 transition-all duration-100" :style="{ width: `${simProgress * 100}%` }" />
                </div>
                <div class="text-slate-500">{{ Math.floor(simProgress * 100) }}%</div>
              </div>
            </template>
            <template v-else-if="simStats">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div class="bg-zinc-900 border border-white/5 p-4 rounded text-center">
                  <div class="text-slate-500 text-[10px] uppercase tracking-widest mb-1">RTP</div>
                  <div class="text-2xl font-black" :class="simStats.totalWin > simStats.totalBet ? 'text-green-500' : 'text-red-500'">
                    {{ simStats.rtp.toFixed(2) }}%
                  </div>
                </div>
                <div class="bg-zinc-900 border border-white/5 p-4 rounded text-center">
                  <div class="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Total Rounds</div>
                  <div class="text-xl text-white">{{ simStats.totalSpins.toLocaleString() }}</div>
                </div>
                <div class="bg-zinc-900 border border-white/5 p-4 rounded text-center">
                  <div class="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Bonus Freq</div>
                  <div class="text-xl text-white">1 in {{ simStats.bonusCount > 0 ? (simStats.totalSpins / simStats.bonusCount).toFixed(0) : '—' }}</div>
                </div>
                <div class="bg-zinc-900 border border-white/5 p-4 rounded text-center">
                  <div class="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Total Profit</div>
                  <div class="text-xl" :class="simStats.totalWin - simStats.totalBet > 0 ? 'text-green-500' : 'text-slate-300'">
                    ${{ (simStats.totalWin - simStats.totalBet).toFixed(0) }}
                  </div>
                </div>
              </div>
              <div class="bg-black/40 border border-white/5 rounded-lg overflow-hidden">
                <div class="bg-white/5 px-4 py-2 border-b border-white/5 text-xs font-bold text-slate-400 uppercase tracking-widest">Top 20 Wins</div>
                <table class="w-full text-sm">
                  <thead><tr class="border-b border-white/5 text-slate-500 text-xs">
                    <th class="p-3 text-left">Rank</th><th class="p-3 text-left">Type</th>
                    <th class="p-3 text-right">Multiplier</th><th class="p-3 text-right">Win</th>
                  </tr></thead>
                  <tbody>
                    <tr v-for="win in simStats.topWins" :key="win.rank" class="border-b border-white/5 hover:bg-white/5">
                      <td class="p-3 text-slate-400">#{{ win.rank }}</td>
                      <td class="p-3"><span :class="win.type === 'BONUS' ? 'bg-fuchsia-950 text-fuchsia-400 border-fuchsia-900' : 'bg-cyan-950 text-cyan-400 border-cyan-900'" class="px-2 py-0.5 rounded text-[10px] font-bold border">{{ win.type }}</span></td>
                      <td class="p-3 text-right text-yellow-500 font-bold">{{ win.multiple.toFixed(1) }}x</td>
                      <td class="p-3 text-right text-white">${{ win.amount.toFixed(2) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="flex justify-center">
                <button class="px-6 py-2 border border-slate-700 hover:bg-white/10 text-slate-300 rounded text-xs uppercase tracking-widest" @click="simStats = null">Reset</button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.popup-enter-active { transition: all 0.3s ease; }
.popup-leave-active { transition: all 0.4s ease; }
.popup-enter-from { opacity: 0; transform: translateY(8px) scale(0.8); }
.popup-leave-to { opacity: 0; transform: translateY(-20px) scale(0.9); }

.win-enter-active, .win-leave-active { transition: all 0.3s ease; }
.win-enter-from, .win-leave-to { opacity: 0; transform: translateY(12px); }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
