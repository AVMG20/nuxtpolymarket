<script setup lang="ts">
import { NitroAudio } from '~/utils/nitro-rush/audio'
import { PAINTS, type PaintId } from '~/utils/nitro-rush/config'
import { NitroRushEngine, type Control, type HudState, type Phase, type Popup, type TrackRecord } from '~/utils/nitro-rush/engine'
import { findTrack, formatLapTime, Track, TRACK_GROUPS, TRACKS } from '#shared/utils/nitro-rush/track'
import type { NrBoard, NrTrackSummary } from '#server/utils/nitro-rush'

const RECORDS_KEY = 'nitro-rush:records'
const PAINT_KEY = 'nitro-rush:paint'
const AUDIO_KEY = 'nitro-rush:audio'
const TRACK_KEY = 'nitro-rush:track'
const EMPTY_RECORD: TrackRecord = { bestLap: null, bestSplits: null }
/** No input, or a hidden tab, for this long sends the player back to the title screen. */
const AWAY_MS = 3 * 60 * 1000

const root = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const phase = ref<Phase>('attract')
/** Which menu the attract phase shows: the title, or track and car selection. */
const screen = ref<'splash' | 'select'>('splash')
const paused = ref(false)
const hud = shallowRef<HudState | null>(null)
const popups = ref<(Popup & { id: number })[]>([])
const records = ref<Record<string, TrackRecord>>({})
const trackId = ref('')
const trackName = ref('')
const board = ref<NrBoard | null>(null)
const summaries = ref<Record<string, NrTrackSummary>>({})
const paint = ref<PaintId>('hotpink')
const musicOn = ref(true)
const sfxOn = ref(true)
const isTouch = ref(false)
const isFullscreen = ref(false)

let engine: NitroRushEngine | null = null
const audio = new NitroAudio()
const toast = useToast()
let popupId = 0
let boardRequest = 0
let lastActive = Date.now()
let awayTimer: ReturnType<typeof setInterval> | undefined

function readStorage<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key)
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    } catch {
        return fallback
    }
}

function writeStorage(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Private mode or blocked storage: the game still plays, it just forgets.
    }
}

function pushPopup(p: Popup) {
    const id = ++popupId
    popups.value = [...popups.value.slice(-3), { ...p, id }]
    setTimeout(() => {
        popups.value = popups.value.filter(x => x.id !== id)
    }, p.big ? 1300 : 1000)
}

function onRecord(id: string, r: TrackRecord) {
    records.value = { ...records.value, [id]: r }
    writeStorage(RECORDS_KEY, records.value)
    if (r.bestLap !== null) submitLap(id, r.bestLap)
}

async function submitLap(id: string, seconds: number) {
    try {
        const res = await apiPost('/api/nitro-rush/lap', { trackId: id, lapMs: Math.round(seconds * 1000) })
        if (id === trackId.value) board.value = res.board
        noteBoard(res.board)
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Your lap could not be saved to the leaderboard'), color: 'warning' })
    }
}

async function loadBoard(id: string) {
    const request = ++boardRequest
    try {
        const b = await apiFetch<NrBoard>('/api/nitro-rush/leaderboard', { query: { track: id } })
        if (request !== boardRequest) return
        board.value = b
        noteBoard(b)
        // A best set on another device: race against it, without this browser's splits from a slower lap.
        const server = b.me ? b.me.lapMs / 1000 : null
        const local = records.value[id]?.bestLap ?? null
        if (server !== null && (local === null || server < local - 0.0005)) {
            records.value = { ...records.value, [id]: { bestLap: server, bestSplits: null } }
            if (engine?.trackId === id) engine.setRecord(records.value[id]!)
        }
    } catch {
        // Only the HUD's rank line goes without it.
    }
}

async function loadSummaries() {
    try {
        const list = await apiFetch<NrTrackSummary[]>('/api/nitro-rush/tracks')
        summaries.value = { ...Object.fromEntries(list.map(t => [t.trackId, t])), ...summaries.value }
    } catch {
        // The cards fall back to this browser's own times.
    }
}

/** A fresher board than the menu summary was built from. */
function noteBoard(b: NrBoard) {
    const top = b.top[0]
    summaries.value = {
        ...summaries.value,
        [b.trackId]: { trackId: b.trackId, entries: b.entries, record: top ? { name: top.name, lapMs: top.lapMs } : null, myLapMs: b.me?.lapMs ?? null }
    }
}

function selectTrack(id: string) {
    if (!engine || id === trackId.value || !findTrack(id)) return
    audio.ui()
    engine.setTrack(id)
    trackId.value = engine.trackId
    trackName.value = engine.trackName
    engine.setRecord(record.value)
    writeStorage(TRACK_KEY, { id })
    board.value = null
    loadBoard(id)
}

function play() {
    audio.unlock()
    audio.startMusic()
    audio.ui()
    popups.value = []
    paused.value = false
    engine?.setPaused(false)
    engine?.releaseControls()
    engine?.start()
    root.value?.focus()
}

function toMenu() {
    audio.ui()
    paused.value = false
    engine?.setPaused(false)
    engine?.releaseControls()
    engine?.toMenu()
}

function openSelect() {
    audio.unlock()
    audio.ui()
    screen.value = 'select'
}

/** Back to the title, ending any run in progress. */
function showSplash() {
    if (inSession.value) {
        paused.value = false
        engine?.setPaused(false)
        engine?.releaseControls()
        engine?.toMenu()
    }
    screen.value = 'splash'
}

function backToTitle() {
    audio.ui()
    showSplash()
}

function markActive() {
    lastActive = Date.now()
}

function checkAway() {
    if (Date.now() - lastActive >= AWAY_MS && (screen.value !== 'splash' || phase.value !== 'attract')) showSplash()
}

function togglePause(force?: boolean) {
    if (!inSession.value) return
    paused.value = force ?? !paused.value
    engine?.setPaused(paused.value)
    engine?.releaseControls()
    if (!paused.value && isTouch.value && phase.value === 'racing') engine?.setControl('throttle', true)
}

function setPaint(id: PaintId) {
    paint.value = id
    engine?.setPaint(id)
    writeStorage(PAINT_KEY, { id })
    audio.unlock()
    audio.ui()
}

function toggleMusic() {
    musicOn.value = !musicOn.value
    audio.setMusic(musicOn.value)
    writeStorage(AUDIO_KEY, { music: musicOn.value, sfx: sfxOn.value })
}

function toggleSfx() {
    sfxOn.value = !sfxOn.value
    audio.setSfx(sfxOn.value)
    writeStorage(AUDIO_KEY, { music: musicOn.value, sfx: sfxOn.value })
}

async function toggleFullscreen() {
    try {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await root.value?.requestFullscreen()
    } catch {
        // Fullscreen refused (iOS Safari): nothing to do.
    }
}

function nitro() {
    audio.unlock()
    engine?.nitro()
}

// ─── Keyboard: the car responds to held keys, so keyup matters too ────────

const KEYS: Record<string, Control> = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake'
}
const NITRO_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyE', 'KeyN'])

function isTyping(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

function onKeyDown(e: KeyboardEvent) {
    markActive()
    if (isTyping(e)) return
    const menu = phase.value === 'attract'
    if (e.code === 'Escape' && menu && screen.value === 'select') {
        backToTitle()
        return
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
        togglePause()
        return
    }
    const confirm = e.code === 'Enter' || e.code === 'Space'
    // On the menus a focused button (a track card, a swatch) handles the key itself.
    if (confirm && menu && e.target instanceof HTMLElement && e.target.closest('button')) return
    if (confirm && (menu || (phase.value === 'finished' && !paused.value))) {
        e.preventDefault()
        if (e.repeat) return
        if (menu && screen.value === 'splash') openSelect()
        else play()
        return
    }
    if (e.code === 'KeyR' && !e.repeat && inSession.value) {
        play()
        return
    }
    if (paused.value) return
    if (NITRO_KEYS.has(e.code)) {
        e.preventDefault()
        if (!e.repeat) nitro()
        return
    }
    const c = KEYS[e.code]
    if (!c) return
    e.preventDefault()
    engine?.setControl(c, true)
}

function onKeyUp(e: KeyboardEvent) {
    const c = KEYS[e.code]
    if (c) engine?.setControl(c, false)
}

// A key let go while the window is unfocused never fires keyup.
function onBlur() {
    engine?.releaseControls()
}

// ─── Touch: steering pads and a brake pedal; the gas is held for you ──────

function touchControl(c: Control, down: boolean) {
    audio.unlock()
    isTouch.value = true
    engine?.setControl(c, down)
    // The pedal lifts the auto-gas, so it slows the car as well as starting a drift.
    if (c === 'brake') engine?.setControl('throttle', !down && phase.value === 'racing')
}

function onVisibility() {
    if (document.visibilityState === 'hidden') togglePause(true)
    else checkAway()
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'wheel'] as const

function onFullscreen() {
    isFullscreen.value = !!document.fullscreenElement
}

onMounted(() => {
    const storedRecords = readStorage<Record<string, TrackRecord>>(RECORDS_KEY, {})
    records.value = storedRecords
    const storedPaint = readStorage<{ id: string }>(PAINT_KEY, { id: 'hotpink' }).id
    paint.value = (PAINTS.find(p => p.id === storedPaint)?.id ?? 'hotpink') as PaintId
    const a = readStorage(AUDIO_KEY, { music: true, sfx: true })
    musicOn.value = a.music
    sfxOn.value = a.sfx
    audio.setMusic(a.music)
    audio.setSfx(a.sfx)
    isTouch.value = window.matchMedia('(pointer: coarse)').matches
    const storedTrack = readStorage<{ id: string }>(TRACK_KEY, { id: TRACKS[0]!.id }).id

    engine = new NitroRushEngine(stage.value!, {
        hud: (h) => {
            hud.value = h
        },
        popup: pushPopup,
        phase: (p) => {
            phase.value = p
            if (p === 'attract') paused.value = false
            if (p === 'racing' && isTouch.value) engine?.setControl('throttle', true)
            if (p === 'finished') engine?.releaseControls()
        },
        record: onRecord
    }, audio, paint.value, storedTrack)
    trackId.value = engine.trackId
    trackName.value = engine.trackName
    engine.setRecord(record.value)
    loadBoard(engine.trackId)
    loadSummaries()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', onFullscreen)
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, markActive, { passive: true })
    awayTimer = setInterval(checkAway, 10_000)
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('fullscreenchange', onFullscreen)
    for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, markActive)
    clearInterval(awayTimer)
    engine?.dispose()
    engine = null
    audio.dispose()
})

const record = computed<TrackRecord>(() => ({ ...EMPTY_RECORD, ...records.value[trackId.value] }))
const inRace = computed(() => phase.value === 'racing' || phase.value === 'countdown')
/** On the clock, or between runs of a sprint: everything but the menu. */
const inSession = computed(() => inRace.value || phase.value === 'finished')
const nitroFull = computed(() => !!hud.value && !hud.value.nitroActive && hud.value.nitro >= 1)
const time = (t: number | null) => t === null ? '-:--.---' : formatLapTime(t)
const trackGroups = TRACK_GROUPS
    .map(g => ({ ...g, tracks: TRACKS.filter(t => t.group === g.id).map(t => ({ ...t, km: new Track(t).lapLength / 1000 })) }))
    .filter(g => g.tracks.length)
const paintLabel = computed(() => PAINTS.find(p => p.id === paint.value)?.label ?? '')
const trackRecord = (id: string) => summaries.value[id]?.record ?? null
/** Quickest of this browser's best and the server's, which may have been set on another device. */
function myBest(id: string) {
    const local = records.value[id]?.bestLap ?? null
    const server = summaries.value[id]?.myLapMs ?? null
    if (server === null) return local
    return local === null ? server / 1000 : Math.min(local, server / 1000)
}
</script>

<template>
  <div
    ref="root"
    tabindex="0"
    class="nr-root relative h-full w-full select-none overflow-hidden rounded-xl outline-none"
    :class="{ 'nr-nitro': hud?.nitroActive }"
  >
    <div ref="stage" class="absolute inset-0" />

    <!-- HUD -->
    <div v-if="hud && inSession" class="pointer-events-none absolute inset-0 p-3 sm:p-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="nr-label">{{ hud.closed ? 'LAP' : 'RUN' }} <b class="nr-lap tabular-nums">{{ hud.lap }}</b></div>
          <NitroRushDigits class="nr-time block" :text="time(hud.lapTime)" />
          <div class="mt-1.5 flex flex-col gap-0.5">
            <div class="nr-label tabular-nums">LAST <span class="nr-mono">{{ time(hud.lastLap) }}</span></div>
            <div class="nr-label tabular-nums">BEST <span class="nr-mono nr-best">{{ time(hud.bestLap) }}</span></div>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1.5">
          <button class="nr-icon-btn pointer-events-auto" aria-label="Pause" @click="togglePause()">
            <UIcon name="i-lucide-pause" class="size-4" />
          </button>
          <div class="nr-label">SESSION BEST</div>
          <div class="nr-total tabular-nums">{{ time(hud.sessionBest) }}</div>
          <div v-if="board?.me" class="nr-label tabular-nums">RANK <span class="nr-mono">#{{ board.me.rank }}<span class="text-white/50"> / {{ board.entries }}</span></span></div>
        </div>
      </div>

      <div v-if="hud.wrongWay" class="absolute inset-x-0 top-[40%] text-center">
        <span class="nr-wrong">WRONG WAY</span>
      </div>

      <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 sm:p-5" :class="{ 'pb-32': isTouch }">
        <div class="nr-speedo">
          <NitroRushDigits :text="hud.speedKmh" />
          <span class="nr-label">KM/H</span>
        </div>
        <div class="flex flex-1 flex-col items-center gap-1.5 pb-1">
          <div class="nr-drift" :class="{ 'is-on': hud.drifting }">DRIFT</div>
          <button
            class="nr-nitro-bar pointer-events-auto"
            :class="{ 'is-full': nitroFull, 'is-active': hud.nitroActive }"
            @pointerdown.stop="nitro"
          >
            <div class="nr-nitro-fill" :style="{ width: `${Math.min(1, hud.nitro) * 100}%` }" />
            <span class="nr-nitro-text">
              <UIcon name="i-lucide-zap" class="size-3.5" />
              {{ hud.nitroActive ? 'NITRO' : nitroFull ? (isTouch ? 'TAP FOR NITRO' : 'SHIFT FOR NITRO') : 'DRIFT TO CHARGE' }}
            </span>
          </button>
        </div>
        <div class="nr-speedo invisible" aria-hidden="true">
          <span>000</span>
        </div>
      </div>
    </div>

    <!-- Touch pedals -->
    <div v-if="isTouch && inSession && !paused" class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
      <div class="flex gap-2">
        <button
          v-for="c in (['left', 'right'] as const)"
          :key="c"
          class="nr-pad"
          :aria-label="`Steer ${c}`"
          @pointerdown.prevent="touchControl(c, true)"
          @pointerup="touchControl(c, false)"
          @pointercancel="touchControl(c, false)"
          @pointerleave="touchControl(c, false)"
        >
          <UIcon :name="c === 'left' ? 'i-lucide-chevron-left' : 'i-lucide-chevron-right'" class="size-10" />
        </button>
      </div>
      <button
        class="nr-pad nr-pad-brake"
        aria-label="Brake and drift"
        @pointerdown.prevent="touchControl('brake', true)"
        @pointerup="touchControl('brake', false)"
        @pointercancel="touchControl('brake', false)"
        @pointerleave="touchControl('brake', false)"
      >
        <span>BRAKE<br><small>+ STEER: DRIFT</small></span>
      </button>
    </div>

    <!-- Popups -->
    <div class="pointer-events-none absolute inset-x-0 top-[20%] flex flex-col items-center gap-1">
      <div v-for="p in popups" :key="p.id" class="nr-popup" :class="[`tone-${p.tone}`, { 'is-big': p.big }]">
        <div class="nr-popup-text tabular-nums">{{ p.text }}</div>
        <div v-if="p.sub" class="nr-popup-sub">{{ p.sub }}</div>
      </div>
    </div>

    <!-- Title screen -->
    <Transition name="nr-fade">
      <div v-if="phase === 'attract' && screen === 'splash'" class="absolute inset-0 flex flex-col items-center justify-center-safe gap-7 overflow-y-auto bg-gradient-to-t from-black/70 via-black/10 to-transparent p-5 text-center">
        <div>
          <h1 class="nr-title">NITRO<br>RUSH</h1>
          <p class="mt-2 text-sm font-semibold tracking-[0.3em] text-white/80">TIME TRIAL</p>
        </div>
        <button class="nr-play" @click="openSelect">
          <UIcon name="i-lucide-play" class="size-6" />
          DRIVE
        </button>
        <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-semibold text-white/75" :class="isTouch ? 'sm:grid-cols-4' : 'sm:grid-cols-3'">
          <template v-if="isTouch">
            <span>◀ ▶ steer</span><span>Gas is automatic</span><span>Brake + steer: drift</span><span>Tap bar: nitro</span>
          </template>
          <template v-else>
            <span>↑ / W gas</span><span>↓ / S brake</span><span>← → / A D steer</span><span>Brake or Space + steer: drift</span><span>Shift / E nitro</span><span>R restart</span>
          </template>
        </div>
      </div>
    </Transition>

    <!-- Track and car selection -->
    <Transition name="nr-fade">
      <div v-if="phase === 'attract' && screen === 'select'" class="nr-select absolute inset-0 flex flex-col gap-4 overflow-y-auto p-4 sm:p-6 lg:overflow-hidden">
        <div class="flex items-center gap-3 pr-32">
          <button class="nr-icon-btn shrink-0" aria-label="Back to the title screen" @click="backToTitle">
            <UIcon name="i-lucide-chevron-left" class="size-5" />
          </button>
          <h2 class="nr-heading">CHOOSE A TRACK</h2>
        </div>

        <div class="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-start lg:justify-between">
          <div class="nr-card w-full text-left lg:max-h-full lg:max-w-2xl lg:overflow-y-auto">
            <section v-for="g in trackGroups" :key="g.id" class="mt-5 first:mt-0">
              <div class="mb-1.5 flex items-baseline justify-between gap-3">
                <h3 class="nr-group">{{ g.name.toUpperCase() }}</h3>
                <span class="truncate text-[11px] font-semibold text-white/50 [font-family:system-ui,sans-serif]">{{ g.blurb }}</span>
              </div>
              <div class="nr-track-grid">
                <button
                  v-for="t in g.tracks"
                  :key="t.id"
                  class="nr-track"
                  :class="{ 'is-active': t.id === trackId }"
                  :aria-pressed="t.id === trackId"
                  @click="selectTrack(t.id)"
                >
                  <NitroRushTrackPreview class="nr-track-preview" :points="t.points" :heights="t.heights" :closed="t.closed !== false" :color="t.id === trackId ? '#ff2bd6' : '#3df2ff'" />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="nr-track-name">{{ t.name }}</span>
                      <span class="shrink-0 text-[11px] text-white/50 tabular-nums">{{ t.km.toFixed(2) }} KM</span>
                    </div>
                    <dl class="nr-track-times tabular-nums">
                      <dt>RECORD</dt>
                      <dd>
                        {{ time(trackRecord(t.id) ? trackRecord(t.id)!.lapMs / 1000 : null) }}
                        <span v-if="trackRecord(t.id)" class="nr-track-holder">{{ trackRecord(t.id)!.name }}</span>
                      </dd>
                      <dt>YOUR BEST</dt>
                      <dd class="is-you">{{ time(myBest(t.id)) }}</dd>
                    </dl>
                  </div>
                </button>
              </div>
            </section>
          </div>

          <div class="nr-card flex w-full flex-col gap-4 text-left lg:w-72 lg:shrink-0">
            <div>
              <div class="nr-label mb-2">CAR</div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-for="p in PAINTS"
                  :key="p.id"
                  class="nr-swatch"
                  :class="{ 'is-active': paint === p.id }"
                  :style="{ '--swatch': `#${p.color.toString(16).padStart(6, '0')}` }"
                  :aria-label="p.label"
                  :title="p.label"
                  @click="setPaint(p.id)"
                />
              </div>
              <div class="mt-2 text-sm text-white/70">{{ paintLabel }}</div>
            </div>
            <div>
              <div class="nr-label mb-1">TRACK</div>
              <div class="nr-track-name">{{ trackName }}</div>
            </div>
            <button class="nr-play self-center" @click="play">
              <UIcon name="i-lucide-flag" class="size-6" />
              START
            </button>
            <p v-if="!isTouch" class="text-center text-[11px] font-semibold text-white/50 [font-family:system-ui,sans-serif]">Enter to start · Esc for the title</p>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Pause -->
    <div v-if="paused" class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="flex flex-col items-center gap-4">
        <div class="nr-title !text-5xl">PAUSED</div>
        <button class="nr-play" @click="togglePause(false)">
          <UIcon name="i-lucide-play" class="size-6" />
          RESUME
        </button>
        <div class="flex gap-2">
          <button class="nr-ghost" @click="play">Restart</button>
          <button class="nr-ghost" @click="toMenu">Quit</button>
        </div>
      </div>
    </div>

    <!-- Corner controls -->
    <div v-if="!inSession || paused" class="absolute right-3 top-3 flex gap-1.5 sm:right-5 sm:top-5">
      <button class="nr-icon-btn" :aria-label="musicOn ? 'Mute music' : 'Unmute music'" @click="toggleMusic">
        <UIcon :name="musicOn ? 'i-lucide-music' : 'i-lucide-music-2'" class="size-4" :class="{ 'opacity-40': !musicOn }" />
      </button>
      <button class="nr-icon-btn" :aria-label="sfxOn ? 'Mute sound' : 'Unmute sound'" @click="toggleSfx">
        <UIcon :name="sfxOn ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4" />
      </button>
      <button class="nr-icon-btn" aria-label="Fullscreen" @click="toggleFullscreen">
        <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" class="size-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Game art palette: the HUD is part of the neon scene, not app chrome. */
.nr-root {
    --nr-pink: #ff2bd6;
    --nr-cyan: #3df2ff;
    --nr-gold: #ffd23d;
    --nr-orange: #ff8a1f;
    --nr-blue: #5b8cff;
    --nr-red: #ff3b5c;
    --nr-green: #4dff8a;
    --nr-violet: #b46bff;
    background: #0b0221;
    touch-action: none;
    font-family: 'Tilt Neon', system-ui, sans-serif;
    /* Tilt Neon has one weight; a faked bold smears its tube strokes. */
    font-synthesis-weight: none;
    color: #fff;
}

.nr-label {
    font-size: 11px;
    letter-spacing: 0.18em;
    color: rgb(255 255 255 / 0.75);
    font-family: system-ui, sans-serif;
    font-weight: 800;
    text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}

.nr-lap {
    font-family: 'Tilt Neon', system-ui, sans-serif;
    font-weight: 400;
    font-size: 22px;
    letter-spacing: 0.02em;
    color: #fff;
    text-shadow: 0 0 14px var(--nr-pink);
}

.nr-lap span {
    font-size: 15px;
    color: rgb(255 255 255 / 0.6);
}

.nr-time {
    font-size: clamp(30px, 5.4vw, 50px);
    line-height: 1;
    font-style: italic;
    text-shadow: 0 0 18px var(--nr-pink), 0 2px 0 rgb(0 0 0 / 0.5);
}

.nr-mono {
    margin-left: 4px;
    font-family: 'Tilt Neon', system-ui, sans-serif;
    font-weight: 400;
    font-size: 15px;
    letter-spacing: 0.04em;
    color: #fff;
}

.nr-best { color: var(--nr-violet); text-shadow: 0 0 10px var(--nr-violet); }

.nr-total {
    font-size: clamp(20px, 3.2vw, 28px);
    line-height: 1;
    font-style: italic;
    text-shadow: 0 0 14px var(--nr-cyan);
}

.nr-wrong {
    display: inline-block;
    padding: 4px 18px;
    border-radius: 10px;
    font-size: clamp(28px, 6vw, 54px);
    font-style: italic;
    background: rgb(120 0 20 / 0.55);
    color: #fff;
    text-shadow: 0 0 18px var(--nr-red);
    animation: nr-blink 0.5s steps(2) infinite;
}

.nr-speedo {
    display: flex;
    flex-direction: column;
    line-height: 1;
    font-size: clamp(30px, 5vw, 52px);
    font-weight: 900;
    font-style: italic;
    text-shadow: 0 0 16px var(--nr-cyan);
}

.nr-nitro .nr-speedo {
    color: #cfe0ff;
    text-shadow: 0 0 22px var(--nr-blue), 0 0 40px var(--nr-blue);
}

.nr-drift {
    font-size: 15px;
    font-style: italic;
    letter-spacing: 0.2em;
    color: var(--nr-orange);
    text-shadow: 0 0 12px var(--nr-orange);
    opacity: 0;
    transform: scale(0.8);
    transition: opacity 0.15s, transform 0.15s;
}

.nr-drift.is-on {
    opacity: 1;
    transform: scale(1);
}

.nr-nitro-bar {
    position: relative;
    width: min(420px, 62vw);
    height: 26px;
    border-radius: 999px;
    overflow: hidden;
    background: rgb(5 5 20 / 0.6);
    border: 2px solid rgb(120 160 255 / 0.5);
    box-shadow: inset 0 0 12px rgb(0 0 0 / 0.6);
    cursor: pointer;
}

.nr-nitro-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #2d4dff, var(--nr-blue), var(--nr-cyan));
    box-shadow: 0 0 18px var(--nr-blue);
    transition: width 0.12s linear;
}

.nr-nitro-bar.is-full {
    border-color: #fff;
    animation: nr-ready 0.6s ease-in-out infinite alternate;
}

.nr-nitro-bar.is-active .nr-nitro-fill {
    background: linear-gradient(90deg, #fff, var(--nr-cyan), var(--nr-blue));
}

.nr-nitro-text {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 100%;
    font-size: 12px;
    letter-spacing: 0.16em;
    font-family: system-ui, sans-serif;
    font-weight: 900;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.8);
}

.nr-pad {
    display: grid;
    place-items: center;
    width: 78px;
    height: 78px;
    border-radius: 22px;
    background: rgb(5 5 20 / 0.45);
    border: 2px solid rgb(255 255 255 / 0.25);
    color: #fff;
    touch-action: none;
}

.nr-pad:active { background: rgb(61 242 255 / 0.25); border-color: var(--nr-cyan); }

.nr-pad-brake {
    width: 108px;
    font-size: 16px;
    line-height: 1.1;
    text-align: center;
}

.nr-pad-brake small {
    font-family: system-ui, sans-serif;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: rgb(255 255 255 / 0.65);
}

.nr-pad-brake:active { background: rgb(255 59 92 / 0.3); border-color: var(--nr-red); }

.nr-icon-btn {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: rgb(5 5 20 / 0.55);
    border: 1px solid rgb(255 255 255 / 0.2);
    color: #fff;
    cursor: pointer;
}

.nr-icon-btn:hover { background: rgb(40 20 70 / 0.8); }

.nr-popup {
    text-align: center;
    animation: nr-pop 1s cubic-bezier(0.2, 1.4, 0.4, 1) forwards;
    --c: var(--nr-cyan);
}

.nr-popup.is-big { animation-duration: 1.3s; }

.nr-popup-text {
    font-size: clamp(20px, 3.6vw, 34px);
    line-height: 1;
    color: #fff;
    -webkit-text-stroke: 1px rgb(0 0 0 / 0.35);
    text-shadow: 0 0 14px var(--c), 0 0 32px var(--c), 0 3px 0 rgb(0 0 0 / 0.4);
    font-style: italic;
}

.nr-popup.is-big .nr-popup-text { font-size: clamp(36px, 8vw, 76px); }

.nr-popup-sub {
    font-size: 15px;
    color: var(--c);
    font-weight: 900;
    text-shadow: 0 0 10px var(--c);
}

.tone-good { --c: var(--nr-green); }
.tone-bad { --c: var(--nr-red); }
.tone-best { --c: var(--nr-violet); }
.tone-lap { --c: var(--nr-cyan); }
.tone-drift { --c: var(--nr-orange); }
.tone-nitro { --c: var(--nr-blue); }
.tone-danger { --c: var(--nr-red); }
.tone-count { --c: #fff; }

.nr-title {
    font-size: clamp(56px, 13vw, 120px);
    line-height: 0.85;
    font-style: italic;
    /* The gradient only paints inside the box, and the faked slant leans the last letter past it. */
    padding: 0.06em 0.16em;
    background: linear-gradient(180deg, #fff 10%, var(--nr-gold) 45%, var(--nr-pink) 80%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 0 18px rgb(255 43 214 / 0.8)) drop-shadow(0 4px 0 rgb(40 0 60 / 0.9));
    animation: nr-float 3s ease-in-out infinite;
}

.nr-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 42px;
    border-radius: 999px;
    font-size: 26px;
    font-style: italic;
    color: #fff;
    background: linear-gradient(90deg, var(--nr-pink), var(--nr-orange));
    box-shadow: 0 0 28px rgb(255 43 214 / 0.8), inset 0 -3px 0 rgb(0 0 0 / 0.25);
    cursor: pointer;
    transition: transform 0.12s;
    animation: nr-glow 1.4s ease-in-out infinite alternate;
}

.nr-play:hover { transform: scale(1.05); }
.nr-play:active { transform: scale(0.97); }

.nr-ghost {
    padding: 10px 18px;
    border-radius: 999px;
    font-family: system-ui, sans-serif;
    font-weight: 800;
    font-size: 14px;
    color: #fff;
    border: 1px solid rgb(255 255 255 / 0.3);
    background: rgb(255 255 255 / 0.06);
    cursor: pointer;
}

.nr-ghost:hover { background: rgb(255 255 255 / 0.14); }

.nr-select {
    background: linear-gradient(90deg, rgb(0 0 0 / 0.6), rgb(0 0 0 / 0.15) 55%, rgb(0 0 0 / 0.5));
}

.nr-heading {
    padding-right: 0.15em;
    font-size: clamp(24px, 4vw, 36px);
    font-style: italic;
    line-height: 1;
    text-shadow: 0 0 14px var(--nr-pink);
}

/* Cards wrap into as many columns as fit, so the list grows with the track count. */
.nr-track-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: 8px;
}

.nr-group {
    font-size: 15px;
    letter-spacing: 0.08em;
    color: var(--nr-cyan);
}

.nr-track {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 12px 8px 8px;
    border-radius: 14px;
    text-align: left;
    background: rgb(255 255 255 / 0.05);
    border: 1px solid rgb(255 255 255 / 0.12);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
}

.nr-track:hover { background: rgb(255 255 255 / 0.1); }

.nr-track.is-active {
    background: rgb(255 43 214 / 0.16);
    border-color: var(--nr-pink);
    box-shadow: 0 0 18px rgb(255 43 214 / 0.35);
}

.nr-track-preview {
    flex-shrink: 0;
    width: 84px;
    height: 60px;
    border-radius: 10px;
    background: radial-gradient(ellipse at 50% 60%, rgb(61 242 255 / 0.1), rgb(0 0 0 / 0.35) 75%);
    filter: drop-shadow(0 0 3px rgb(61 242 255 / 0.5));
}

.nr-track.is-active .nr-track-preview {
    background: radial-gradient(ellipse at 50% 60%, rgb(255 43 214 / 0.14), rgb(0 0 0 / 0.35) 75%);
    filter: drop-shadow(0 0 3px rgb(255 43 214 / 0.6));
}

.nr-track-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 17px;
}

.nr-track-times {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 10px;
    margin-top: 3px;
    align-items: baseline;
}

.nr-track-times dt {
    font-family: system-ui, sans-serif;
    font-weight: 800;
    font-size: 10px;
    letter-spacing: 0.08em;
    color: rgb(255 255 255 / 0.5);
}

.nr-track-times dd {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: 16px;
    color: var(--nr-gold);
}

.nr-track-times dd.is-you { color: var(--nr-violet); }

.nr-track-holder {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: rgb(255 255 255 / 0.55);
}

.nr-swatch {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    background: var(--swatch);
    border: 3px solid rgb(255 255 255 / 0.25);
    box-shadow: 0 0 12px var(--swatch);
    cursor: pointer;
    transition: transform 0.12s;
}

.nr-swatch.is-active {
    border-color: #fff;
    transform: scale(1.18);
}

.nr-card {
    padding: 22px;
    border-radius: 22px;
    background: linear-gradient(180deg, rgb(30 8 50 / 0.92), rgb(8 4 22 / 0.95));
    border: 1px solid rgb(255 43 214 / 0.45);
    box-shadow: 0 0 40px rgb(255 43 214 / 0.35);
    animation: nr-card-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1);
}

.nr-fade-enter-active, .nr-fade-leave-active { transition: opacity 0.35s; }
.nr-fade-enter-from, .nr-fade-leave-to { opacity: 0; }

@keyframes nr-pop {
    0% { transform: scale(0.3) translateY(10px); opacity: 0; }
    15% { transform: scale(1.18); opacity: 1; }
    30% { transform: scale(1); }
    75% { opacity: 1; }
    100% { transform: scale(1) translateY(-30px); opacity: 0; }
}

@keyframes nr-blink {
    0% { opacity: 1; }
    100% { opacity: 0.35; }
}

@keyframes nr-ready {
    from { box-shadow: 0 0 10px var(--nr-blue); }
    to { box-shadow: 0 0 30px var(--nr-cyan), 0 0 50px var(--nr-blue); }
}

@keyframes nr-glow {
    from { box-shadow: 0 0 18px rgb(255 43 214 / 0.6); }
    to { box-shadow: 0 0 38px rgb(255 138 31 / 0.9); }
}

@keyframes nr-float {
    0%, 100% { transform: translateY(0) rotate(-2deg); }
    50% { transform: translateY(-6px) rotate(-1deg); }
}

@keyframes nr-card-in {
    from { transform: scale(0.8); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}
</style>
