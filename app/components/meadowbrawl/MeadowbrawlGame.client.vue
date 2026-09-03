<script setup lang="ts">
import { MeadowbrawlGame } from '~/utils/meadowbrawl/engine'
import { MeadowbrawlRenderer } from '~/utils/meadowbrawl/renderer'
import { MeadowbrawlSound } from '~/utils/meadowbrawl/sound'
import { WEAPONS, WEAPON_IDS } from '~/utils/meadowbrawl/weapons'
import { RARITY_LABEL, UPGRADE_BY_ID } from '~/utils/meadowbrawl/upgrades'
import { TOTAL_WAVES, type Offer, type WeaponId } from '~/utils/meadowbrawl/types'

const wrapper = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

const game = new MeadowbrawlGame()
const sound = new MeadowbrawlSound()
let renderer: MeadowbrawlRenderer | null = null
let raf = 0
let lastFrame = 0

const selectedWeapon = ref<WeaponId>('sword')
const muted = ref(false)
const isFullscreen = ref(false)

// A per-frame snapshot of the bits of state the HUD needs. Kept as plain
// reactive fields so Vue only re-renders the overlay, never the canvas.
const hud = reactive({
    phase: game.phase,
    paused: false,
    hp: 100,
    maxHp: 100,
    wave: 0,
    remaining: 0,
    kills: 0,
    time: 0,
    special: 0,
    specialName: '',
    weapon: 'sword' as WeaponId,
    dodge: 1,
    dodgeMax: 1,
    comboHits: 0,
    comboIndex: 0,
    chainLength: 3,
    comboTimer: 0,
    inCombo: false,
    elites: [] as { id: number, name: string, hp: number, max: number }[],
    bloodlust: 0,
    banner: '',
    bannerSub: '',
    bannerT: 0,
    upgrades: [] as { id: string, name: string, icon: string, stacks: number }[],
    offers: [] as Offer[],
    sprinting: false
})

const stats = computed(() => game.stats)

function syncHud() {
    const p = game.player
    hud.phase = game.phase
    hud.paused = game.paused
    hud.hp = Math.max(0, Math.ceil(p.hp))
    hud.maxHp = p.maxHp
    hud.wave = game.wave
    hud.remaining = game.remainingInWave
    hud.kills = game.stats.kills
    hud.time = game.time
    hud.special = p.specialCdMax > 0 ? 1 - p.specialCd / p.specialCdMax : 1
    hud.specialName = WEAPONS[p.weapon].special.name
    hud.weapon = p.weapon
    hud.dodge = p.dodgeCharges
    hud.dodgeMax = p.dodgeMax
    hud.comboHits = p.comboHits
    hud.comboIndex = p.attack ? p.attack.index : p.comboTimer > 0 ? p.comboIndex - 1 : -1
    hud.chainLength = p.chain.length
    hud.inCombo = !!p.attack || p.comboTimer > 0
    hud.sprinting = p.sprinting
    const elites = game.elites
    if (elites.length !== hud.elites.length || elites.some((e, i) => hud.elites[i]!.id !== e.id || hud.elites[i]!.hp !== e.hp)) {
        hud.elites = elites.map(e => ({ id: e.id, name: e.def.name, hp: Math.max(0, e.hp), max: e.maxHp }))
    }
    hud.bloodlust = p.bloodlust
    hud.banner = game.banner?.text ?? ''
    hud.bannerSub = game.banner?.sub ?? ''
    hud.bannerT = game.banner?.t ?? 0
    if (hud.upgrades.length !== p.upgrades.size || hud.upgrades.some(u => u.stacks !== p.upgrades.get(u.id))) {
        hud.upgrades = [...p.upgrades.entries()].map(([id, stacks]) => {
            const def = UPGRADE_BY_ID[id]!
            return { id, name: def.name, icon: def.icon, stacks }
        })
    }
    if (game.phase === 'upgrade' && hud.offers !== game.offers) hud.offers = game.offers
    if (game.phase !== 'upgrade' && hud.offers.length) hud.offers = []
}

function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0)
    lastFrame = now
    game.update(dt)
    for (const ev of game.events) sound.play(ev)
    game.events.length = 0
    renderer?.render(dt)
    syncHud()
}

// ------------------------------------------------------------------ input

const KEYS: Record<string, keyof typeof held> = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right'
}
const held = { up: false, down: false, left: false, right: false }

function applyMove() {
    game.input.moveX = (held.right ? 1 : 0) - (held.left ? 1 : 0)
    game.input.moveY = (held.down ? 1 : 0) - (held.up ? 1 : 0)
}

function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const dir = KEYS[e.code]
    if (dir) {
        held[dir] = true
        applyMove()
        e.preventDefault()
        return
    }
    if (e.code === 'Space') {
        e.preventDefault()
        if (e.repeat) return
        if (game.phase === 'menu') {
            start()
            return
        }
        if (game.phase === 'dead' && game.deathT > 1.2) {
            restart()
            return
        }
        game.input.spaceDown = true
        game.input.spacePressed = true
        return
    }
    if (e.code === 'Escape') {
        if (game.phase === 'wave' || game.phase === 'calm') game.paused = !game.paused
        return
    }
    if (game.phase === 'upgrade' && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
        choose(Number(e.code.slice(-1)) - 1)
    }
}

function onKeyUp(e: KeyboardEvent) {
    const dir = KEYS[e.code]
    if (dir) {
        held[dir] = false
        applyMove()
    }
    if (e.code === 'Space') {
        if (game.input.spaceDown) game.input.spaceReleased = true
        game.input.spaceDown = false
    }
}

function onMouseMove(e: MouseEvent) {
    if (!renderer) return
    const w = renderer.screenToWorld(e.clientX, e.clientY)
    game.input.aimX = w.x
    game.input.aimY = w.y
}

function onMouseDown(e: MouseEvent) {
    sound.unlock()
    if (game.phase !== 'wave' && game.phase !== 'calm') return
    if (e.button === 0) {
        game.input.attackPressed = true
        game.input.attackHeld = true
    } else if (e.button === 2) {
        game.input.specialPressed = true
    }
    e.preventDefault()
}

function onMouseUp(e: MouseEvent) {
    if (e.button === 0) game.input.attackHeld = false
}

function onBlur() {
    held.up = held.down = held.left = held.right = false
    applyMove()
    game.input.spaceDown = false
    game.input.attackHeld = false
    if (game.phase === 'wave' || game.phase === 'calm') game.paused = true
}

function onVisibility() {
    if (document.hidden) onBlur()
}

// ---------------------------------------------------------------- actions

function start() {
    sound.unlock()
    game.startRun(selectedWeapon.value)
}

function restart() {
    game.restart()
}

function choose(i: number) {
    sound.unlock()
    game.chooseOffer(i)
}

function togglePause() {
    if (game.phase === 'wave' || game.phase === 'calm') game.paused = !game.paused
}

function toggleMute() {
    muted.value = !muted.value
    sound.setMuted(muted.value)
}

async function toggleFullscreen() {
    const el = wrapper.value
    if (!el) return
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el.requestFullscreen()
}

function onFullscreenChange() {
    isFullscreen.value = !!document.fullscreenElement
    requestAnimationFrame(() => renderer?.resize())
}

// ------------------------------------------------------------- lifecycle

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
    if (!canvas.value) return
    renderer = new MeadowbrawlRenderer(canvas.value, game)
    resizeObserver = new ResizeObserver(() => renderer?.resize())
    resizeObserver.observe(canvas.value)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    lastFrame = performance.now()
    raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    resizeObserver?.disconnect()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    sound.dispose()
})

// ---------------------------------------------------------------- helpers

const RARITY_STYLE: Record<string, { ring: string, text: string, glow: string }> = {
    common: { ring: 'border-emerald-400/60', text: 'text-emerald-300', glow: 'shadow-emerald-500/20' },
    rare: { ring: 'border-sky-400/70', text: 'text-sky-300', glow: 'shadow-sky-500/30' },
    epic: { ring: 'border-fuchsia-400/80', text: 'text-fuchsia-300', glow: 'shadow-fuchsia-500/40' },
    weapon: { ring: 'border-amber-300/90', text: 'text-amber-300', glow: 'shadow-amber-400/40' }
}

function formatTime(t: number): string {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

const weaponCards = WEAPON_IDS.map(id => ({ id, def: WEAPONS[id] }))
const showHint = computed(() => hud.phase === 'wave' && hud.wave === 1)
</script>

<template>
  <div class="p-3 sm:p-6 max-w-[1500px] mx-auto select-none">
    <div
      ref="wrapper"
      class="relative w-full aspect-video rounded-xl overflow-hidden bg-[#213d1c] ring-1 ring-black/40 shadow-2xl shadow-black/40"
      :class="isFullscreen ? 'rounded-none' : ''"
      @contextmenu.prevent
    >
      <canvas
        ref="canvas"
        class="absolute inset-0 w-full h-full cursor-crosshair"
        @mousedown="onMouseDown"
      />

      <!-- HUD ------------------------------------------------------------ -->
      <div v-if="hud.phase !== 'menu'" class="absolute inset-0 pointer-events-none text-white font-sans">
        <!-- Top left: vitals -->
        <div class="absolute left-3 top-3 sm:left-5 sm:top-5 w-[38%] max-w-[360px]">
          <div class="flex items-end justify-between mb-1">
            <span class="text-[11px] uppercase tracking-[0.2em] font-bold text-white/70 drop-shadow">Health</span>
            <span class="text-sm font-black tabular-nums drop-shadow">{{ hud.hp }} <span class="text-white/50">/ {{ hud.maxHp }}</span></span>
          </div>
          <div class="h-4 rounded-md bg-black/55 ring-1 ring-black/60 overflow-hidden">
            <div
              class="h-full rounded-md transition-[width] duration-150 bg-gradient-to-r from-red-700 via-red-500 to-rose-400"
              :style="{ width: `${Math.max(0, hud.hp / hud.maxHp) * 100}%` }"
            />
          </div>
          <div class="mt-2 flex items-center gap-2">
            <div class="flex-1">
              <div class="flex items-center justify-between mb-0.5">
                <span class="text-[10px] uppercase tracking-[0.2em] font-bold text-white/70 drop-shadow">{{ hud.specialName }}</span>
                <span class="text-[10px] font-bold text-white/60">RMB</span>
              </div>
              <div class="h-2 rounded bg-black/55 ring-1 ring-black/60 overflow-hidden">
                <div
                  class="h-full rounded"
                  :class="hud.special >= 1 ? 'bg-gradient-to-r from-amber-300 to-yellow-200' : 'bg-sky-400/80'"
                  :style="{ width: `${hud.special * 100}%` }"
                />
              </div>
            </div>
            <div class="flex items-center gap-1 pt-3" title="Dodge charges">
              <span
                v-for="i in hud.dodgeMax"
                :key="i"
                class="size-3 rounded-full ring-1 ring-black/60"
                :class="i <= hud.dodge ? 'bg-emerald-300' : 'bg-black/50'"
              />
            </div>
          </div>
          <div class="mt-2 flex flex-wrap gap-1">
            <span v-if="hud.bloodlust > 0" class="inline-flex items-center gap-1 rounded-md bg-red-900/70 ring-1 ring-red-400/40 px-1.5 py-0.5 text-[11px] font-black text-red-200">
              <UIcon name="i-lucide-activity" class="size-3.5" />×{{ hud.bloodlust }}
            </span>
            <span
              v-for="u in hud.upgrades"
              :key="u.id"
              class="inline-flex items-center gap-1 rounded-md bg-black/55 ring-1 ring-white/10 px-1.5 py-0.5 text-[11px] font-semibold"
              :title="u.name"
            >
              <UIcon :name="u.icon" class="size-3.5 text-amber-200" />
              <span v-if="u.stacks > 1" class="text-amber-200">×{{ u.stacks }}</span>
            </span>
          </div>
        </div>

        <!-- Top centre: wave -->
        <div class="absolute left-1/2 top-3 sm:top-4 -translate-x-1/2 text-center">
          <div class="text-[11px] uppercase tracking-[0.3em] font-bold text-white/70 drop-shadow">Wave</div>
          <div class="text-3xl font-black leading-none drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] tabular-nums">
            {{ hud.wave }}<span class="text-white/40 text-lg"> / {{ TOTAL_WAVES }}</span>
          </div>
          <div class="text-xs font-semibold text-white/80 drop-shadow mt-0.5 tabular-nums">
            <span v-if="hud.phase === 'wave'">{{ hud.remaining }} remaining</span>
            <span v-else-if="hud.phase === 'calm'">Cleared</span>
          </div>
        </div>

        <!-- Top right: run stats + buttons -->
        <div class="absolute right-3 top-3 sm:right-5 sm:top-5 flex flex-col items-end gap-2">
          <div class="flex items-center gap-2 pointer-events-auto">
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              :icon="hud.paused ? 'i-lucide-play' : 'i-lucide-pause'"
              class="bg-black/50 hover:bg-black/70 text-white"
              aria-label="Pause"
              @click="togglePause"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
              class="bg-black/50 hover:bg-black/70 text-white"
              aria-label="Mute"
              @click="toggleMute"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
              class="bg-black/50 hover:bg-black/70 text-white"
              aria-label="Fullscreen"
              @click="toggleFullscreen"
            />
          </div>
          <div class="text-right drop-shadow tabular-nums">
            <div class="text-sm font-black">{{ hud.kills }} <span class="text-white/50 font-semibold text-xs">slain</span></div>
            <div class="text-xs font-semibold text-white/70">{{ formatTime(hud.time) }}</div>
          </div>
        </div>

        <!-- Banner -->
        <Transition name="mb-banner">
          <div v-if="hud.banner" :key="hud.banner + hud.wave" class="absolute inset-x-0 top-[28%] text-center">
            <div class="text-5xl sm:text-6xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">{{ hud.banner }}</div>
            <div v-if="hud.bannerSub" class="mt-1 text-base sm:text-lg font-bold uppercase tracking-[0.35em] text-amber-200 drop-shadow">{{ hud.bannerSub }}</div>
          </div>
        </Transition>

        <!-- Combo -->
        <div class="absolute left-1/2 bottom-[14%] -translate-x-1/2 flex flex-col items-center gap-1">
          <Transition name="mb-pop">
            <div v-if="hud.comboHits > 1" :key="hud.comboHits" class="text-3xl font-black italic text-amber-200 drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">
              ×{{ hud.comboHits }}
            </div>
          </Transition>
          <div class="flex items-center gap-1.5">
            <span
              v-for="i in hud.chainLength"
              :key="i"
              class="rounded-full ring-1 ring-black/60 transition-all duration-100"
              :class="[
                i === hud.chainLength ? 'size-3' : 'size-2',
                hud.inCombo && i - 1 <= hud.comboIndex ? 'bg-amber-200' : 'bg-white/25'
              ]"
            />
          </div>
        </div>

        <!-- Elite bars -->
        <div v-if="hud.elites.length" class="absolute left-1/2 bottom-4 sm:bottom-6 -translate-x-1/2 w-[46%] max-w-[520px] space-y-2">
          <div v-for="e in hud.elites" :key="e.id">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-black uppercase tracking-[0.25em] text-red-300 drop-shadow">{{ e.name }}</span>
              <span class="text-[11px] font-bold text-white/70 tabular-nums">{{ Math.ceil(e.hp) }}</span>
            </div>
            <div class="h-3 rounded bg-black/60 ring-1 ring-black/70 overflow-hidden">
              <div class="h-full bg-gradient-to-r from-red-800 via-red-500 to-orange-400 transition-[width] duration-150" :style="{ width: `${e.hp / Math.max(1, e.max) * 100}%` }" />
            </div>
          </div>
        </div>

        <!-- Controls hint -->
        <div v-if="showHint" class="absolute left-3 bottom-3 sm:left-5 sm:bottom-5 text-[11px] font-semibold text-white/75 drop-shadow space-y-0.5">
          <div><span class="text-white">WASD</span> move · <span class="text-white">Mouse</span> aim</div>
          <div><span class="text-white">LMB</span> combo · <span class="text-white">RMB</span> special</div>
          <div><span class="text-white">Space</span> tap to dodge, hold to sprint</div>
        </div>

        <!-- Paused -->
        <div v-if="hud.paused" class="absolute inset-0 flex items-center justify-center">
          <div class="text-center">
            <div class="text-4xl font-black tracking-tight drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">Paused</div>
            <div class="text-sm text-white/70 mt-1">Press <UKbd>Esc</UKbd> to resume</div>
          </div>
        </div>
      </div>

      <!-- Menu ----------------------------------------------------------- -->
      <div v-if="hud.phase === 'menu'" class="absolute inset-0 flex items-center justify-center p-4 bg-black/40">
        <div class="w-full max-w-3xl max-h-full overflow-y-auto rounded-2xl bg-black/65 backdrop-blur-sm ring-1 ring-white/10 p-5 sm:p-8 text-white">
          <div class="text-center">
            <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-amber-200">A melee survival roguelite</div>
            <h1 class="mt-1 text-5xl sm:text-6xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">Meadowbrawl</h1>
            <p class="mt-2 text-sm text-white/70">Thirty waves. Pick a weapon, chain your combo, dodge the telegraphs, and let the build get out of hand. Ten is a run; twenty is a feat; thirty is a legend.</p>
          </div>

          <div class="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <button
              v-for="w in weaponCards"
              :key="w.id"
              type="button"
              class="rounded-xl p-3 text-left ring-1 transition-all"
              :class="selectedWeapon === w.id ? 'bg-amber-300/15 ring-amber-300/80 shadow-lg shadow-amber-400/20' : 'bg-white/5 ring-white/10 hover:bg-white/10'"
              @click="selectedWeapon = w.id"
            >
              <div class="text-sm font-black">{{ w.def.name }}</div>
              <div class="text-[11px] text-amber-200 font-semibold">{{ w.def.tagline }}</div>
              <div class="mt-1 text-[11px] text-white/60 leading-snug">{{ w.def.special.name }}: {{ w.def.special.description }}</div>
            </button>
          </div>

          <div class="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-white/75">
            <div><UKbd>W</UKbd><UKbd>A</UKbd><UKbd>S</UKbd><UKbd>D</UKbd> move · mouse aims</div>
            <div><span class="font-bold text-white">Left click</span> attack — each tap advances the combo</div>
            <div><span class="font-bold text-white">Right click</span> weapon special (short cooldown)</div>
            <div><UKbd>Space</UKbd> tap to dodge roll (i-frames) · hold to sprint</div>
            <div class="sm:col-span-2 text-white/55">Dodging and sprinting cancel your combo. Finishers hit harder and knock further.</div>
          </div>

          <div class="mt-6 flex justify-center">
            <UButton size="xl" color="primary" icon="i-lucide-swords" class="font-black px-8" @click="start">
              Enter the meadow
            </UButton>
          </div>
        </div>
      </div>

      <!-- Upgrade choice -------------------------------------------------- -->
      <div v-if="hud.phase === 'upgrade'" class="absolute inset-0 flex items-center justify-center p-4">
        <div class="w-full max-w-3xl text-white">
          <div class="text-center mb-4">
            <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-amber-200">Wave {{ hud.wave }} cleared</div>
            <div class="text-3xl sm:text-4xl font-black tracking-tight drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">Choose a boon</div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              v-for="(o, i) in hud.offers"
              :key="o.upgrade.id"
              type="button"
              class="group relative rounded-2xl bg-black/70 backdrop-blur-sm border-2 p-4 text-left transition-all hover:-translate-y-1 hover:bg-black/80 shadow-xl"
              :class="[RARITY_STYLE[o.upgrade.rarity]!.ring, RARITY_STYLE[o.upgrade.rarity]!.glow]"
              @click="choose(i)"
            >
              <div class="flex items-center justify-between">
                <span class="text-[10px] uppercase tracking-[0.3em] font-black" :class="RARITY_STYLE[o.upgrade.rarity]!.text">
                  {{ RARITY_LABEL[o.upgrade.rarity] }}
                </span>
                <UKbd class="bg-white/10 text-white/80">{{ i + 1 }}</UKbd>
              </div>
              <div class="mt-3 flex items-center gap-3">
                <div class="size-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <UIcon :name="o.upgrade.icon" class="size-6" :class="RARITY_STYLE[o.upgrade.rarity]!.text" />
                </div>
                <div class="min-w-0">
                  <div class="text-base font-black leading-tight">{{ o.upgrade.name }}</div>
                  <div v-if="o.stack > 1" class="text-[11px] font-bold text-amber-200">Stack {{ o.stack }} / {{ o.upgrade.maxStacks }}</div>
                </div>
              </div>
              <p class="mt-3 text-xs text-white/75 leading-relaxed">{{ o.upgrade.description }}</p>
            </button>
          </div>
        </div>
      </div>

      <!-- Death ----------------------------------------------------------- -->
      <div v-if="hud.phase === 'dead' && game.deathT > 1.2" class="absolute inset-0 flex items-center justify-center p-4">
        <div class="w-full max-w-lg rounded-2xl bg-black/70 backdrop-blur-sm ring-1 ring-red-400/30 p-6 sm:p-8 text-white text-center">
          <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-red-300">The meadow keeps you</div>
          <div class="mt-1 text-5xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">Slain</div>
          <div class="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-left">
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Wave</div>
              <div class="text-xl font-black tabular-nums">{{ hud.wave }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Slain</div>
              <div class="text-xl font-black tabular-nums">{{ stats.kills }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Best combo</div>
              <div class="text-xl font-black tabular-nums">×{{ stats.highestCombo }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Time</div>
              <div class="text-xl font-black tabular-nums">{{ formatTime(stats.time) }}</div>
            </div>
          </div>
          <div v-if="hud.upgrades.length" class="mt-4 flex flex-wrap justify-center gap-1.5">
            <span v-for="u in hud.upgrades" :key="u.id" class="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold">
              <UIcon :name="u.icon" class="size-3.5 text-amber-200" />{{ u.name }}<span v-if="u.stacks > 1" class="text-amber-200">×{{ u.stacks }}</span>
            </span>
          </div>
          <div class="mt-6 flex justify-center gap-2">
            <UButton size="lg" color="primary" icon="i-lucide-rotate-ccw" class="font-black" @click="restart">Again</UButton>
          </div>
          <div class="mt-2 text-[11px] text-white/50">or press <UKbd>Space</UKbd></div>
        </div>
      </div>

      <!-- Victory --------------------------------------------------------- -->
      <div v-if="hud.phase === 'victory'" class="absolute inset-0 flex items-center justify-center p-4">
        <div class="w-full max-w-lg rounded-2xl bg-black/70 backdrop-blur-sm ring-1 ring-amber-300/40 p-6 sm:p-8 text-white text-center">
          <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-amber-200">Thirty waves</div>
          <div class="mt-1 text-5xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">The meadow is yours</div>
          <div class="mt-5 grid grid-cols-3 gap-2 text-left">
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Slain</div>
              <div class="text-xl font-black tabular-nums">{{ stats.kills }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Best combo</div>
              <div class="text-xl font-black tabular-nums">×{{ stats.highestCombo }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Time</div>
              <div class="text-xl font-black tabular-nums">{{ formatTime(stats.time) }}</div>
            </div>
          </div>
          <div class="mt-6 flex justify-center">
            <UButton size="lg" color="primary" icon="i-lucide-rotate-ccw" class="font-black" @click="restart">Run it back</UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mb-banner-enter-active {
  animation: mb-banner-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.mb-banner-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.mb-banner-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
@keyframes mb-banner-in {
  from { opacity: 0; transform: scale(1.6); }
  to { opacity: 1; transform: scale(1); }
}
.mb-pop-enter-active {
  animation: mb-pop 0.18s ease-out;
}
@keyframes mb-pop {
  from { transform: scale(1.6); }
  to { transform: scale(1); }
}
</style>
