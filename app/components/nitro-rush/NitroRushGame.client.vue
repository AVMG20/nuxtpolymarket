<script setup lang="ts">
import { NitroAudio } from '~/utils/nitro-rush/audio'
import { findPaint, type PaintId } from '~/utils/nitro-rush/config'
import { NitroRushEngine } from '~/utils/nitro-rush/engine'
import { CONTROL_KEYS, isTyping, NITRO_KEYS } from '~/utils/nitro-rush/input'
import { readStorage, STORAGE_KEYS, writeStorage } from '~/utils/nitro-rush/storage'
import { EMPTY_RECORD, type Control, type CustomTrackEntry, type HudState, type Phase, type Popup, type TrackRecord } from '~/utils/nitro-rush/types'
import { newCustomTrack, sameRoad, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import { findTrack, TRACKS } from '#shared/utils/nitro-rush/tracks'

/** No input, or a hidden tab, for this long sends the player back to the title screen. */
const AWAY_MS = 3 * 60 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'wheel'] as const

const root = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const phase = ref<Phase>('attract')
/** Which menu the attract phase shows: the title, track and car selection, or the track builder. */
const screen = ref<'splash' | 'select' | 'builder'>('splash')
/** The course open in the builder. */
const building = ref<CustomTrack | null>(null)
const paused = ref(false)
const hud = shallowRef<HudState | null>(null)
const popups = ref<(Popup & { id: number })[]>([])
const records = ref<Record<string, TrackRecord>>({})
const trackId = ref('')
const trackName = ref('')
const paint = ref<PaintId>('hotpink')
const musicOn = ref(true)
const sfxOn = ref(true)
/** Whether the best lap's ghost races along. */
const ghostOn = ref(true)
const isTouch = ref(false)
watch(isTouch, t => engine?.setTouch(t))
const isFullscreen = ref(false)

let engine: NitroRushEngine | null = null
const audio = new NitroAudio()
let popupId = 0
let lastActive = Date.now()
let awayTimer: ReturnType<typeof setInterval> | undefined

const custom = useNitroRushCustomTracks()
const customEntries = computed<CustomTrackEntry[]>(() => custom.tracks.value.map(t => ({ track: t, def: custom.compile(t).def })))

const { board, summaries, loadBoard, loadSummaries, submitLap } = useNitroRushBoard(records, (id) => {
    if (engine?.trackId === id) engine.setRecord(records.value[id]!)
})

/** Other players on this course, as live ghost cars. */
const { racers } = useNitroRushLive({ engine: () => engine, trackId, phase, paused, paint })

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

function forgetRecord(id: string) {
    const { [id]: _, ...rest } = records.value
    records.value = rest
    writeStorage(STORAGE_KEYS.records, rest)
}

/** A built-in course, or one of the player's finished ones. */
function resolveTrack(id: string): TrackDef | null {
    return findTrack(id) ?? custom.trackDef(id)
}

/** Puts a course on the engine, also a rebuilt version of the one already on it. */
function loadTrack(def: TrackDef) {
    if (!engine) return
    engine.setTrack(def)
    trackId.value = engine.trackId
    trackName.value = engine.trackName
    engine.setRecord(record.value)
    writeStorage(STORAGE_KEYS.track, { id: def.id })
    loadBoard(def.id)
}

function selectTrack(id: string) {
    const def = resolveTrack(id)
    if (!engine || id === trackId.value || !def) return
    audio.ui()
    loadTrack(def)
}

function openBuilder(id?: string) {
    audio.ui()
    building.value = (id ? custom.find(id) : null) ?? newCustomTrack()
    screen.value = 'builder'
}

/** Stores a course from the builder; a changed road wipes the bests set on the old one. */
function commitCustom(t: CustomTrack) {
    const old = custom.find(t.id)
    custom.save(t)
    if (old && !sameRoad(old, t)) forgetRecord(t.id)
    if (t.id !== trackId.value) return
    // The course on the engine changed under it: rebuild it, or fall back while it's unfinished.
    loadTrack(resolveTrack(t.id) ?? TRACKS[0]!)
}

function onBuilderDone(t: CustomTrack | null) {
    audio.ui()
    if (t) commitCustom(t)
    building.value = null
    screen.value = 'select'
}

function onBuilderDrive(t: CustomTrack) {
    if (t !== building.value) commitCustom(t)
    building.value = null
    screen.value = 'select'
    selectTrack(t.id)
    play()
}

function onBuilderDelete(id: string) {
    audio.ui()
    custom.remove(id)
    forgetRecord(id)
    if (id === trackId.value) loadTrack(TRACKS[0]!)
    building.value = null
    screen.value = 'select'
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
    // A course half built would be lost; the builder waits for the player.
    if (screen.value === 'builder') return
    if (Date.now() - lastActive >= AWAY_MS && (screen.value !== 'splash' || phase.value !== 'attract')) showSplash()
}

function togglePause(force?: boolean) {
    if (!inSession.value) return
    paused.value = force ?? !paused.value
    engine?.setPaused(paused.value)
    engine?.releaseControls()
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

function toggleGhost() {
    ghostOn.value = !ghostOn.value
    engine?.setBestGhost(ghostOn.value)
    writeStorage(STORAGE_KEYS.ghost, { on: ghostOn.value })
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
    // The builder handles its own keys.
    if (menu && screen.value === 'builder') return
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
    custom.load()
    const storedTrack = resolveTrack(readStorage<{ id: string }>(STORAGE_KEYS.track, { id: '' }).id) ?? TRACKS[0]!

    engine = new NitroRushEngine(stage.value!, {
        hud: (h) => {
            hud.value = h
        },
        popup: pushPopup,
        phase: (p) => {
            phase.value = p
            if (p === 'attract') paused.value = false
            if (p === 'finished') engine?.releaseControls()
        },
        record: onRecord
    }, audio, paint.value, storedTrack)
    trackId.value = engine.trackId
    trackName.value = engine.trackName
    engine.setRecord(record.value)
    engine.setTouch(isTouch.value)
    ghostOn.value = readStorage(STORAGE_KEYS.ghost, { on: true }).on !== false
    engine.setBestGhost(ghostOn.value)
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

    <NitroRushHud v-if="hud && inSession" :hud="hud" :rank="rank" :racers="racers" :is-touch="isTouch" @pause="togglePause()" @nitro="nitro" />
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
        :custom-tracks="customEntries"
        @back="backToTitle"
        @select="selectTrack"
        @paint="setPaint"
        @start="play"
        @build="openBuilder"
      />
    </Transition>
    <Transition name="nr-fade">
      <NitroRushBuilder
        v-if="phase === 'attract' && screen === 'builder' && building"
        :track="building"
        :saved="!!custom.find(building.id)"
        @done="onBuilderDone"
        @drive="onBuilderDrive"
        @delete="onBuilderDelete"
      />
    </Transition>

    <NitroRushPause v-if="paused" @resume="togglePause(false)" @restart="play" @quit="toMenu" />
    <NitroRushSettings
      v-if="!inSession || paused"
      :music-on="musicOn"
      :sfx-on="sfxOn"
      :ghost-on="ghostOn"
      :is-fullscreen="isFullscreen"
      @music="toggleMusic"
      @sfx="toggleSfx"
      @ghost="toggleGhost"
      @fullscreen="toggleFullscreen"
    />
  </div>
</template>

<style src="./nitro-rush.css"></style>
