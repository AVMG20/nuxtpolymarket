<script setup lang="ts">
import { NitroAudio } from '~/utils/nitro-rush/audio'
import { findPaint, type PaintId } from '~/utils/nitro-rush/config'
import { NitroRushEngine } from '~/utils/nitro-rush/engine'
import { CONTROL_KEYS, isTyping, NITRO_KEYS } from '~/utils/nitro-rush/input'
import { readStorage, STORAGE_KEYS, writeStorage } from '~/utils/nitro-rush/storage'
import { EMPTY_RECORD, type Control, type HudState, type Phase, type Popup, type TrackRecord } from '~/utils/nitro-rush/types'
import { findTrack, TRACKS } from '#shared/utils/nitro-rush/tracks'

/** No input, or a hidden tab, for this long sends the player back to the title screen. */
const AWAY_MS = 3 * 60 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'wheel'] as const

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
const paint = ref<PaintId>('hotpink')
const musicOn = ref(true)
const sfxOn = ref(true)
const isTouch = ref(false)
const isFullscreen = ref(false)

let engine: NitroRushEngine | null = null
const audio = new NitroAudio()
let popupId = 0
let lastActive = Date.now()
let awayTimer: ReturnType<typeof setInterval> | undefined

const { board, summaries, loadBoard, loadSummaries, submitLap } = useNitroRushBoard(records, (id) => {
    if (engine?.trackId === id) engine.setRecord(records.value[id]!)
})

const record = computed<TrackRecord>(() => ({ ...EMPTY_RECORD, ...records.value[trackId.value] }))
const inRace = computed(() => phase.value === 'racing' || phase.value === 'countdown')
/** On the clock, or between runs of a sprint: everything but the menu. */
const inSession = computed(() => inRace.value || phase.value === 'finished')
const rank = computed(() => board.value?.me ? { rank: board.value.me.rank, entries: board.value.entries } : null)

function pushPopup(p: Popup) {
    const id = ++popupId
    popups.value = [...popups.value.slice(-3), { ...p, id }]
    setTimeout(() => {
        popups.value = popups.value.filter(x => x.id !== id)
    }, p.big ? 1300 : 1000)
}

function onRecord(id: string, r: TrackRecord) {
    records.value = { ...records.value, [id]: r }
    writeStorage(STORAGE_KEYS.records, records.value)
    if (r.bestLap !== null) submitLap(id, r.bestLap)
}

function selectTrack(id: string) {
    if (!engine || id === trackId.value || !findTrack(id)) return
    audio.ui()
    engine.setTrack(id)
    trackId.value = engine.trackId
    trackName.value = engine.trackName
    engine.setRecord(record.value)
    writeStorage(STORAGE_KEYS.track, { id })
    loadBoard(id)
}

/** Clears a pause and any held controls before the run restarts or ends. */
function unpause() {
    paused.value = false
    engine?.setPaused(false)
    engine?.releaseControls()
}

function play() {
    audio.unlock()
    audio.startMusic()
    audio.ui()
    popups.value = []
    unpause()
    engine?.start()
    root.value?.focus()
}

function toMenu() {
    audio.ui()
    unpause()
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
        unpause()
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
    writeStorage(STORAGE_KEYS.paint, { id })
    audio.unlock()
    audio.ui()
}

function toggleMusic() {
    musicOn.value = !musicOn.value
    audio.setMusic(musicOn.value)
    saveAudio()
}

function toggleSfx() {
    sfxOn.value = !sfxOn.value
    audio.setSfx(sfxOn.value)
    saveAudio()
}

function saveAudio() {
    writeStorage(STORAGE_KEYS.audio, { music: musicOn.value, sfx: sfxOn.value })
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
    const c = CONTROL_KEYS[e.code]
    if (!c) return
    e.preventDefault()
    engine?.setControl(c, true)
}

function onKeyUp(e: KeyboardEvent) {
    const c = CONTROL_KEYS[e.code]
    if (c) engine?.setControl(c, false)
}

// A key let go while the window is unfocused never fires keyup.
function onBlur() {
    engine?.releaseControls()
}

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

function onFullscreen() {
    isFullscreen.value = !!document.fullscreenElement
}

onMounted(() => {
    records.value = readStorage<Record<string, TrackRecord>>(STORAGE_KEYS.records, {})
    paint.value = findPaint(readStorage<{ id: string }>(STORAGE_KEYS.paint, { id: '' }).id).id
    const a = readStorage(STORAGE_KEYS.audio, { music: true, sfx: true })
    musicOn.value = a.music
    sfxOn.value = a.sfx
    audio.setMusic(a.music)
    audio.setSfx(a.sfx)
    isTouch.value = window.matchMedia('(pointer: coarse)').matches
    const storedTrack = readStorage<{ id: string }>(STORAGE_KEYS.track, { id: TRACKS[0]!.id }).id

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
</script>

<template>
  <div
    ref="root"
    tabindex="0"
    class="nr-root relative h-full w-full select-none overflow-hidden rounded-xl outline-none"
    :class="{ 'nr-nitro': hud?.nitroActive }"
  >
    <div ref="stage" class="absolute inset-0" />

    <NitroRushHud v-if="hud && inSession" :hud="hud" :rank="rank" :is-touch="isTouch" @pause="togglePause()" @nitro="nitro" />
    <NitroRushTouchPads v-if="isTouch && inSession && !paused" @control="touchControl" />
    <NitroRushPopups :popups="popups" />

    <Transition name="nr-fade">
      <NitroRushTitle v-if="phase === 'attract' && screen === 'splash'" :is-touch="isTouch" @drive="openSelect" />
    </Transition>
    <Transition name="nr-fade">
      <NitroRushSelect
        v-if="phase === 'attract' && screen === 'select'"
        :track-id="trackId"
        :track-name="trackName"
        :paint="paint"
        :is-touch="isTouch"
        :records="records"
        :summaries="summaries"
        @back="backToTitle"
        @select="selectTrack"
        @paint="setPaint"
        @start="play"
      />
    </Transition>

    <NitroRushPause v-if="paused" @resume="togglePause(false)" @restart="play" @quit="toMenu" />
    <NitroRushSettings
      v-if="!inSession || paused"
      :music-on="musicOn"
      :sfx-on="sfxOn"
      :is-fullscreen="isFullscreen"
      @music="toggleMusic"
      @sfx="toggleSfx"
      @fullscreen="toggleFullscreen"
    />
  </div>
</template>

<style src="./nitro-rush.css"></style>
