<script setup lang="ts">
import { MeadowbrawlGame, type RunConfig } from '~/utils/meadowbrawl/engine'
import { MeadowbrawlRenderer } from '~/utils/meadowbrawl/renderer'
import { MeadowbrawlSound } from '~/utils/meadowbrawl/sound'
import { WEAPONS } from '~/utils/meadowbrawl/weapons'
import { ELEMENT_COLOR, ELEMENT_ICON, KIND_ICON, RARITY_LABEL, UPGRADE_BY_ID } from '~/utils/meadowbrawl/upgrades'
import { TOTAL_WAVES, type Offer, type WeaponId } from '~/utils/meadowbrawl/types'
import MeadowbrawlLobby, { PET_ABILITY_ICONS, type MeadowbrawlMetaState } from '~/components/meadowbrawl/MeadowbrawlLobby.vue'
import {
    MEADOWBRAWL_PETS,
    type MeadowbrawlAccountEffects,
    type MeadowbrawlPetEffects,
    type MeadowbrawlPetId,
    type MeadowbrawlRunSave,
    type MeadowbrawlUpgradeId,
    type MeadowbrawlWeaponId
} from '#shared/utils/gamelogic/meadowbrawl-meta'

const wrapper = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

const game = new MeadowbrawlGame()
const sound = new MeadowbrawlSound()
let renderer: MeadowbrawlRenderer | null = null
let raf = 0
let lastFrame = 0

const muted = ref(false)
const isFullscreen = ref(false)

const { user, fetchSession } = useAuth()
const toast = useToast()

// ------------------------------------------------------------ account meta

interface StartRunResult {
    weapon: MeadowbrawlWeaponId
    pet: MeadowbrawlPetEffects | null
    effects: MeadowbrawlAccountEffects
    coinMult: number
    runStartedAt: string
}

interface FinishRunResult {
    awarded: number
    counted: number
    capped: boolean
    coinMult: number
    cleared: number
    won: boolean
    bestWave: number
    bestEarned: number
    newlyUnlocked: MeadowbrawlWeaponId[]
    unlockedWeapons: MeadowbrawlWeaponId[]
}

const meta = ref<MeadowbrawlMetaState | null>(null)
const metaLoading = ref(false)
/** Key of the lobby action in flight — the lobby spins only that button. */
const busy = ref<string | null>(null)

function errorMessage(err: unknown, fallback: string): string {
    const e = err as { data?: { statusMessage?: string, message?: string }, statusMessage?: string, message?: string } | null
    return e?.data?.statusMessage || e?.data?.message || e?.statusMessage || e?.message || fallback
}

function fail(err: unknown, fallback: string) {
    toast.add({ title: errorMessage(err, fallback), color: 'error', icon: 'i-lucide-triangle-alert' })
}

async function refreshMeta() {
    if (!user.value) {
        meta.value = null
        return
    }
    metaLoading.value = true
    try {
        meta.value = await $fetch<MeadowbrawlMetaState>('/api/meadowbrawl/state')
    } catch (err) {
        console.error('[meadowbrawl] state failed', err)
    } finally {
        metaLoading.value = false
    }
}

watch(user, (u) => {
    if (u) void refreshMeta()
    else meta.value = null
}, { immediate: true })

// ------------------------------------------------------------ run lifecycle

/** Every checkpoint is POSTed, one at a time, in the order they happened. */
let saveChain: Promise<unknown> = Promise.resolve()
let runStartedMs = 0
/** One settle per run — set the moment the finish request goes out. */
let finishSubmitted = false
let finishWon = false

const finish = reactive({
    state: 'idle' as 'idle' | 'pending' | 'done' | 'error',
    result: null as FinishRunResult | null,
    error: ''
})

function runConfig(effects: MeadowbrawlAccountEffects, coinMult: number, pet: { id: MeadowbrawlPetId, level: number } | null): RunConfig {
    return {
        coinMult,
        pet: pet ? { id: pet.id, level: pet.level } : null
    }
}

function armRun() {
    finish.state = 'idle'
    finish.result = null
    finish.error = ''
    finishSubmitted = false
    finishWon = false
    runStartedMs = Date.now()
}

async function beginRun(weapon: MeadowbrawlWeaponId) {
    if (busy.value) return
    busy.value = 'start'
    try {
        const res = await $fetch<StartRunResult>('/api/meadowbrawl/start-run', { method: 'POST', body: { weapon } })
        sound.unlock()
        armRun()
        game.startRun(res.weapon as WeaponId, runConfig(res.effects, res.coinMult, res.pet))
        void refreshMeta()
    } catch (err) {
        fail(err, 'Could not enter the meadow')
        // A 409 means a run is already armed — the lobby needs to see it so
        // the player can resume or abandon.
        void refreshMeta()
    } finally {
        busy.value = null
    }
}

function resumeRun() {
    const run = meta.value?.activeRun
    const effects = meta.value?.effects
    if (!run?.save || !run.weapon || !effects || busy.value) return
    sound.unlock()
    armRun()
    // The clock is the server's; a resumed run keeps its original start, so
    // report only the time this session actually played.
    game.restoreRun(
        run.weapon as WeaponId,
        run.save as MeadowbrawlRunSave,
        runConfig(effects, run.coinMult, run.pet ? { id: run.pet, level: run.petLevel } : null)
    )
}

async function abandonRun() {
    if (busy.value) return
    busy.value = 'abandon'
    try {
        const res = await $fetch<FinishRunResult>('/api/meadowbrawl/finish-run', {
            method: 'POST',
            body: { wave: 0, coins: 0, kills: 0, won: false, playedMs: 0, abandoned: true }
        })
        toast.add({
            title: `Run abandoned — collected ${formatNumber(res.awarded)}`,
            description: `${formatNumber(res.counted)} coins × ${res.coinMult.toFixed(2)}`,
            color: 'success',
            icon: 'i-lucide-coins'
        })
        await Promise.all([fetchSession(), refreshMeta()])
    } catch (err) {
        fail(err, 'Could not abandon the run')
        void refreshMeta()
    } finally {
        busy.value = null
    }
}

async function submitFinish(won: boolean) {
    finishWon = won
    finish.state = 'pending'
    finish.error = ''
    try {
        const res = await $fetch<FinishRunResult>('/api/meadowbrawl/finish-run', {
            method: 'POST',
            body: {
                wave: game.wave,
                coins: Math.floor(game.coins),
                kills: game.stats.kills,
                won,
                playedMs: runStartedMs ? Date.now() - runStartedMs : 0,
                abandoned: false
            }
        })
        finish.result = res
        finish.state = 'done'
        if (res.newlyUnlocked.length) {
            toast.add({
                title: res.newlyUnlocked.length > 1 ? 'New weapons unlocked' : 'New weapon unlocked',
                description: res.newlyUnlocked.map(id => WEAPONS[id as WeaponId].name).join(', '),
                color: 'success',
                icon: 'i-lucide-swords'
            })
        }
        await Promise.all([fetchSession(), refreshMeta()])
    } catch (err) {
        finish.state = 'error'
        finish.error = errorMessage(err, 'Could not reach the meadow')
    }
}

function retryFinish() {
    if (finish.state === 'pending') return
    void submitFinish(finishWon)
}

/** Fires once per run, as soon as the run is provably over. */
function maybeFinish() {
    if (finishSubmitted) return
    if (game.phase === 'victory') {
        finishSubmitted = true
        void submitFinish(true)
    } else if (game.phase === 'dead' && game.deathT > 1.2) {
        finishSubmitted = true
        void submitFinish(false)
    }
}

function backToMeadow() {
    game.restart()
    finish.state = 'idle'
    finish.result = null
    finish.error = ''
    syncHud()
    void refreshMeta()
}

// ------------------------------------------------------------- lobby shop

async function equipPet(petId: MeadowbrawlPetId | null) {
    if (busy.value) return
    busy.value = petId ? `equip:${petId}` : 'equip:none'
    try {
        await $fetch('/api/meadowbrawl/pet-equip', { method: 'POST', body: { petId } })
        await refreshMeta()
    } catch (err) {
        fail(err, 'Could not field that pet')
    } finally {
        busy.value = null
    }
}

async function buyUpgrade(upgradeId: MeadowbrawlUpgradeId) {
    if (busy.value) return
    busy.value = `upgrade:${upgradeId}`
    try {
        const res = await $fetch<{ level: number }>('/api/meadowbrawl/upgrade', { method: 'POST', body: { upgradeId } })
        const def = meta.value?.upgrades.find(u => u.id === upgradeId)
        toast.add({ title: `${def?.name ?? 'Upgrade'} is now level ${res.level}`, color: 'success', icon: 'i-lucide-arrow-big-up' })
        await Promise.all([fetchSession(), refreshMeta()])
    } catch (err) {
        fail(err, 'Could not buy that upgrade')
    } finally {
        busy.value = null
    }
}

async function buyPet(petId: MeadowbrawlPetId) {
    if (busy.value) return
    busy.value = `pet:${petId}`
    try {
        const res = await $fetch<{ level: number }>('/api/meadowbrawl/pet-upgrade', { method: 'POST', body: { petId } })
        const def = MEADOWBRAWL_PETS.find(p => p.id === petId)
        toast.add({
            title: res.level === 1 ? `${def?.name ?? 'Pet'} adopted` : `${def?.name ?? 'Pet'} is now level ${res.level}`,
            color: 'success',
            icon: 'i-lucide-paw-print'
        })
        await Promise.all([fetchSession(), refreshMeta()])
    } catch (err) {
        fail(err, 'Could not raise that pet')
    } finally {
        busy.value = null
    }
}

async function rushCooldown() {
    if (busy.value) return
    busy.value = 'rush'
    try {
        const res = await $fetch<{ gemCost: number }>('/api/meadowbrawl/rush', { method: 'POST' })
        toast.add({ title: `The meadow is ready — ${res.gemCost} gems spent`, color: 'success', icon: 'i-lucide-gem' })
        await Promise.all([fetchSession(), refreshMeta()])
    } catch (err) {
        fail(err, 'Could not rush the cooldown')
    } finally {
        busy.value = null
    }
}

// ------------------------------------------------------------------- HUD

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
    highestCombo: 0,
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
    elites: [] as { id: number, name: string, hp: number, max: number, stun: number, stunMax: number, stunLock: number }[],
    bloodlust: 0,
    banner: '',
    bannerSub: '',
    bannerT: 0,
    upgrades: [] as { id: string, name: string, icon: string, stacks: number, color: string }[],
    offers: [] as Offer[],
    sprinting: false,
    className: '',
    q: { name: '', icon: '', cd: 0, max: 1 },
    e: { name: '', icon: '', cd: 0, max: 1 },
    fx: [] as { name: string, t: number, color: string }[],
    coins: 0,
    coinMult: 1,
    deathT: 0,
    pet: {
        active: false,
        name: '',
        color: '#ffffff',
        level: 0,
        ward: false,
        bloom: 0,
        quick: 0,
        a: [
            { name: '', icon: '', cd: 0, max: 0 },
            { name: '', icon: '', cd: 0, max: 0 }
        ]
    }
})

function syncHud() {
    const p = game.player
    hud.phase = game.phase
    hud.paused = game.paused
    hud.hp = Math.max(0, Math.ceil(p.hp))
    hud.maxHp = p.maxHp
    hud.wave = game.wave
    hud.remaining = game.remainingInWave
    hud.kills = game.stats.kills
    hud.highestCombo = game.stats.highestCombo
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
    hud.coins = Math.floor(game.coins)
    hud.coinMult = game.coinMult
    hud.deathT = game.deathT
    const elites = game.elites
    if (elites.length !== hud.elites.length || elites.some((e, i) => hud.elites[i]!.id !== e.id || hud.elites[i]!.hp !== e.hp || hud.elites[i]!.stun !== e.stun || hud.elites[i]!.stunLock !== e.stunLock)) {
        hud.elites = elites.map(e => ({ id: e.id, name: e.def.name, hp: Math.max(0, e.hp), max: e.maxHp, stun: e.stun, stunMax: e.stunMax, stunLock: e.stunLock }))
    }
    hud.bloodlust = p.bloodlust
    const wdef = WEAPONS[p.weapon]
    hud.className = wdef.className
    hud.q.name = wdef.abilities[0].name
    hud.q.icon = wdef.abilities[0].icon
    hud.q.cd = p.abilityCd.q
    hud.q.max = p.abilityCdMax.q
    hud.e.name = wdef.abilities[1].name
    hud.e.icon = wdef.abilities[1].icon
    hud.e.cd = p.abilityCd.e
    hud.e.max = p.abilityCdMax.e
    const companion = game.companion
    hud.pet.active = !!companion
    if (companion) {
        const def = MEADOWBRAWL_PETS.find(d => d.id === companion.id)
        hud.pet.name = def?.name ?? ''
        hud.pet.color = def?.color ?? '#ffffff'
        hud.pet.level = companion.level
        hud.pet.ward = companion.ward
        hud.pet.bloom = companion.bloom
        hud.pet.quick = companion.quick
        for (let i = 0; i < 2; i++) {
            const slot = hud.pet.a[i]!
            const ability = def?.abilities[i]
            slot.name = ability?.name ?? ''
            slot.icon = ability ? PET_ABILITY_ICONS[ability.id] ?? 'i-lucide-sparkles' : 'i-lucide-sparkles'
            slot.cd = companion.cd[i] ?? 0
            slot.max = companion.cdMax[i] ?? 0
        }
    }
    const fx: { name: string, t: number, color: string }[] = []
    if (p.fx.shieldWall > 0) fx.push({ name: 'Shield Wall', t: p.fx.shieldWall, color: 'text-sky-200' })
    if (p.fx.rally > 0) fx.push({ name: 'Rallied', t: p.fx.rally, color: 'text-amber-200' })
    if (p.fx.bloodrage > 0) fx.push({ name: 'Bloodrage', t: p.fx.bloodrage, color: 'text-red-300' })
    if (p.fx.ironSkin > 0) fx.push({ name: 'Iron Skin', t: p.fx.ironSkin, color: 'text-slate-200' })
    if (p.fx.smoke > 0) fx.push({ name: 'Hidden', t: p.fx.smoke, color: 'text-violet-200' })
    if (fx.length !== hud.fx.length || fx.some((f, i) => hud.fx[i]!.name !== f.name)) hud.fx = fx
    else for (const [i, f] of fx.entries()) hud.fx[i]!.t = f.t
    hud.banner = game.banner?.text ?? ''
    hud.bannerSub = game.banner?.sub ?? ''
    hud.bannerT = game.banner?.t ?? 0
    if (hud.upgrades.length !== p.upgrades.size || hud.upgrades.some(u => u.stacks !== p.upgrades.get(u.id))) {
        hud.upgrades = [...p.upgrades.entries()].map(([id, stacks]) => {
            const def = UPGRADE_BY_ID[id]!
            return { id, name: def.name, icon: def.icon, stacks, color: def.element ? ELEMENT_COLOR[def.element] : def.rarity === 'legendary' ? '#ffd166' : '#fde68a' }
        })
    }
    if (game.phase === 'upgrade' && hud.offers !== game.offers) hud.offers = game.offers
    if (game.phase !== 'upgrade' && hud.offers.length) hud.offers = []
    maybeFinish()
}

function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0)
    lastFrame = now
    game.update(dt)
    for (const ev of game.events) sound.play(ev)
    game.events.length = 0
    const pool = game.world.pool
    sound.setScene(Math.hypot(game.player.x - pool.x, game.player.y - pool.y), game.wave, game.phase === 'wave', dt)
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
    // The lobby is a form, not a fight: leave every key to the browser so
    // buttons, tabs and scrolling behave. Starting a run needs the server.
    if (game.phase === 'menu') return
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
        if (game.phase === 'dead' && game.deathT > 1.2) {
            if (finish.state === 'done') backToMeadow()
            return
        }
        if (game.phase === 'victory') {
            if (finish.state === 'done') backToMeadow()
            return
        }
        game.input.spaceDown = true
        game.input.spacePressed = true
        return
    }
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat) {
        if (e.code === 'KeyQ') game.input.qPressed = true
        else game.input.ePressed = true
        e.preventDefault()
        return
    }
    if (e.code === 'Escape') {
        if (game.phase === 'wave' || game.phase === 'calm') game.paused = !game.paused
        return
    }
    if (game.phase === 'upgrade') {
        if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4') {
            choose(Number(e.code.slice(-1)) - 1)
        }
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

function choose(i: number) {
    if (i >= game.offers.length) return
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
    // Checkpoints are fire-and-forget, but they must land in order: a later
    // wave must never be overwritten by a save that was still in flight.
    game.onCheckpoint = (save) => {
        saveChain = saveChain
            .then(() => $fetch('/api/meadowbrawl/save-run', { method: 'POST', body: { save } }))
            .catch(err => console.error('[meadowbrawl] checkpoint failed', err))
    }
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
    game.onCheckpoint = null
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
    legendary: { ring: 'border-amber-300 ring-2 ring-amber-300/40', text: 'text-amber-200', glow: 'shadow-amber-400/60' },
    weapon: { ring: 'border-amber-300/90', text: 'text-amber-300', glow: 'shadow-amber-400/40' }
}

/** Card chrome for a boon: the element paints it, otherwise the rarity does. */
function offerAccent(o: Offer): string {
    if (o.upgrade.element) return ELEMENT_COLOR[o.upgrade.element]
    return o.upgrade.rarity === 'legendary' ? '#ffd166' : o.upgrade.rarity === 'epic' ? '#e879f9' : o.upgrade.rarity === 'rare' ? '#38bdf8' : '#34d399'
}

const KIND_LABEL: Record<string, string> = { stat: 'Buff', effect: 'Effect', pact: 'Pact' }
const ELEMENT_LABEL: Record<string, string> = { fire: 'Fire', ice: 'Ice', shock: 'Shock' }

function formatTime(t: number): string {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

const showHint = computed(() => hud.phase === 'wave' && hud.wave === 1)
const showDeath = computed(() => hud.phase === 'dead' && hud.deathT > 1.2)
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
                <span class="text-[10px] uppercase tracking-[0.2em] font-bold text-white/70 drop-shadow"><span class="text-amber-200">{{ hud.className }}</span> · {{ hud.specialName }}</span>
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
            <div class="flex items-center gap-1.5 pt-2">
              <div
                v-for="slot in [{ key: 'Q', a: hud.q }, { key: 'E', a: hud.e }]"
                :key="slot.key"
                class="relative size-10 rounded-lg ring-1 overflow-hidden"
                :class="slot.a.cd <= 0 ? 'bg-amber-300/20 ring-amber-300/80 shadow-[0_0_14px_rgba(252,211,77,0.45)]' : 'bg-black/60 ring-white/15'"
                :title="slot.a.name"
              >
                <UIcon :name="slot.a.icon" class="absolute inset-0 m-auto size-5" :class="slot.a.cd <= 0 ? 'text-amber-200' : 'text-white/45'" />
                <div v-if="slot.a.cd > 0" class="absolute inset-x-0 bottom-0 bg-sky-400/40" :style="{ height: `${(1 - slot.a.cd / Math.max(0.01, slot.a.max)) * 100}%` }" />
                <span class="absolute left-1 top-0.5 text-[9px] font-black text-white/80">{{ slot.key }}</span>
                <span v-if="slot.a.cd > 0" class="absolute right-1 bottom-0.5 text-[10px] font-black tabular-nums text-white">{{ Math.ceil(slot.a.cd) }}</span>
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
          <div class="mt-1.5 flex flex-wrap gap-1">
            <span v-for="f in hud.fx" :key="f.name" class="inline-flex items-center gap-1 rounded-md bg-black/60 ring-1 ring-white/15 px-1.5 py-0.5 text-[11px] font-black" :class="f.color">
              {{ f.name }} <span class="tabular-nums opacity-70">{{ f.t.toFixed(1) }}s</span>
            </span>
          </div>
          <div class="mt-1.5 flex flex-wrap gap-1">
            <span v-if="hud.bloodlust > 0" class="inline-flex items-center gap-1 rounded-md bg-red-900/70 ring-1 ring-red-400/40 px-1.5 py-0.5 text-[11px] font-black text-red-200">
              <UIcon name="i-lucide-activity" class="size-3.5" />×{{ hud.bloodlust }}
            </span>
            <span
              v-for="u in hud.upgrades"
              :key="u.id"
              class="inline-flex items-center gap-1 rounded-md bg-black/55 ring-1 ring-white/10 px-1.5 py-0.5 text-[11px] font-semibold"
              :title="u.name"
            >
              <UIcon :name="u.icon" class="size-3.5" :style="{ color: u.color }" />
              <span v-if="u.stacks > 1" :style="{ color: u.color }">×{{ u.stacks }}</span>
            </span>
          </div>

          <!-- Companion -->
          <div v-if="hud.pet.active" class="mt-2 inline-flex items-center gap-2 rounded-lg bg-black/55 ring-1 ring-white/10 px-2 py-1.5">
            <div class="leading-tight">
              <div class="text-[10px] uppercase tracking-[0.18em] font-black" :style="{ color: hud.pet.color }">{{ hud.pet.name }}</div>
              <div class="text-[9px] font-bold text-white/45 tabular-nums">Lv {{ hud.pet.level }}</div>
            </div>
            <div
              v-for="(a, i) in hud.pet.a"
              :key="i"
              class="relative size-8 rounded-md ring-1 overflow-hidden"
              :class="a.max <= 0 ? 'bg-black/50 ring-white/10' : a.cd <= 0 ? 'ring-white/60 bg-white/15' : 'bg-black/60 ring-white/15'"
              :title="a.max <= 0 ? `${a.name} — not unlocked yet` : a.name"
            >
              <UIcon
                :name="a.max <= 0 ? 'i-lucide-lock' : a.icon"
                class="absolute inset-0 m-auto size-4"
                :style="a.max > 0 && a.cd <= 0 ? { color: hud.pet.color } : undefined"
                :class="a.max <= 0 ? 'text-white/25' : a.cd > 0 ? 'text-white/40' : ''"
              />
              <div v-if="a.max > 0 && a.cd > 0" class="absolute inset-x-0 bottom-0 bg-white/20" :style="{ height: `${(1 - a.cd / Math.max(0.01, a.max)) * 100}%` }" />
            </div>
            <span
              v-if="hud.pet.ward"
              class="size-2.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]"
              title="Ward up — the next hit is swallowed"
            />
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
          <!-- Coins -->
          <div class="rounded-lg bg-black/50 ring-1 ring-amber-300/25 px-2 py-1 text-right tabular-nums drop-shadow">
            <div class="flex items-center justify-end gap-1.5 text-base font-black text-amber-200 leading-none">
              <UIcon name="i-lucide-coins" class="size-4" />{{ formatNumber(hud.coins) }}
            </div>
            <div class="text-[10px] font-bold text-amber-200/60 leading-tight mt-0.5">
              ≈ {{ formatNumber(Math.floor(hud.coins * hud.coinMult)) }} · ×{{ hud.coinMult.toFixed(2) }}
            </div>
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
            <!-- Poise meter: fill it to break them, then it locks out. -->
            <div class="mt-0.5 h-1.5 rounded bg-black/60 ring-1 ring-black/70 overflow-hidden">
              <div
                class="h-full transition-[width] duration-150"
                :class="e.stunLock > 0 ? 'bg-white/25' : 'bg-gradient-to-r from-amber-600 to-amber-300'"
                :style="{ width: `${e.stunLock > 0 ? 100 : e.stun / Math.max(1, e.stunMax) * 100}%` }"
              />
            </div>
          </div>
        </div>

        <!-- Controls hint -->
        <div v-if="showHint" class="absolute left-3 bottom-3 sm:left-5 sm:bottom-5 text-[11px] font-semibold text-white/75 drop-shadow space-y-0.5">
          <div><span class="text-white">WASD</span> move · <span class="text-white">Mouse</span> aim</div>
          <div><span class="text-white">LMB</span> combo · <span class="text-white">RMB</span> special · <span class="text-white">Q</span>/<span class="text-white">E</span> abilities</div>
          <div><span class="text-white">Space</span> dodge (hold to sprint)</div>
        </div>

        <!-- Paused -->
        <div v-if="hud.paused" class="absolute inset-0 flex items-center justify-center">
          <div class="text-center">
            <div class="text-4xl font-black tracking-tight drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">Paused</div>
            <div class="text-sm text-white/70 mt-1">Press <UKbd>Esc</UKbd> to resume</div>
          </div>
        </div>
      </div>

      <!-- Lobby ----------------------------------------------------------- -->
      <MeadowbrawlLobby
        v-if="hud.phase === 'menu'"
        :state="meta"
        :loading="metaLoading"
        :busy="busy"
        :signed-in="!!user"
        @start="beginRun"
        @resume="resumeRun"
        @abandon="abandonRun"
        @equip="equipPet"
        @buy-upgrade="buyUpgrade"
        @buy-pet="buyPet"
        @rush="rushCooldown"
      />

      <!-- Upgrade choice -------------------------------------------------- -->
      <div v-if="hud.phase === 'upgrade'" class="absolute inset-0 flex items-center justify-center p-4">
        <div class="w-full max-w-4xl text-white">
          <div class="text-center mb-4">
            <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-amber-200">Wave {{ hud.wave }} cleared</div>
            <div class="text-3xl sm:text-4xl font-black tracking-tight drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">Choose a boon</div>
          </div>
          <div class="grid grid-cols-1 gap-3" :class="hud.offers.length > 3 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'">
            <button
              v-for="(o, i) in hud.offers"
              :key="o.upgrade.id"
              type="button"
              class="boon-card group relative rounded-2xl bg-black/70 backdrop-blur-sm border-2 p-4 text-left transition-all hover:-translate-y-1 hover:bg-black/80 shadow-xl"
              :class="[
                RARITY_STYLE[o.upgrade.rarity]!.ring,
                RARITY_STYLE[o.upgrade.rarity]!.glow,
                o.upgrade.rarity === 'legendary' ? 'boon-legendary' : '',
                o.upgrade.kind === 'pact' ? 'boon-pact' : ''
              ]"
              :style="{ '--accent': offerAccent(o), 'animation-delay': `${i * 90}ms` }"
              @click="choose(i)"
            >
              <!-- Tier, badges and the hotkey. -->
              <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] uppercase tracking-[0.3em] font-black" :class="RARITY_STYLE[o.upgrade.rarity]!.text">
                  {{ RARITY_LABEL[o.upgrade.rarity] }}
                </span>
                <div class="flex items-center gap-1">
                  <span
                    class="inline-flex size-5 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15"
                    :title="KIND_LABEL[o.upgrade.kind]"
                  >
                    <UIcon :name="KIND_ICON[o.upgrade.kind]" class="size-3" :class="o.upgrade.kind === 'pact' ? 'text-red-300' : o.upgrade.kind === 'effect' ? 'text-amber-200' : 'text-white/70'" />
                  </span>
                  <span
                    v-if="o.upgrade.element"
                    class="inline-flex size-5 items-center justify-center rounded-md ring-1"
                    :style="{ backgroundColor: `${ELEMENT_COLOR[o.upgrade.element]}22`, boxShadow: `inset 0 0 0 1px ${ELEMENT_COLOR[o.upgrade.element]}66` }"
                    :title="ELEMENT_LABEL[o.upgrade.element]"
                  >
                    <UIcon :name="ELEMENT_ICON[o.upgrade.element]" class="size-3" :style="{ color: ELEMENT_COLOR[o.upgrade.element] }" />
                  </span>
                  <UKbd class="bg-white/10 text-white/80">{{ i + 1 }}</UKbd>
                </div>
              </div>
              <!-- Icon and name. -->
              <div class="mt-3 flex items-center gap-3">
                <div
                  class="boon-icon size-12 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform ring-1"
                  :style="{ backgroundColor: `${offerAccent(o)}1f`, boxShadow: `inset 0 0 0 1px ${offerAccent(o)}55, 0 0 18px ${offerAccent(o)}33` }"
                >
                  <UIcon :name="o.upgrade.icon" class="size-6" :style="{ color: offerAccent(o) }" />
                </div>
                <div class="min-w-0">
                  <div class="text-base font-black leading-tight">{{ o.upgrade.name }}</div>
                  <!-- Stack pips: no numbers to read, just how far along it is. -->
                  <div v-if="o.upgrade.maxStacks > 1 && o.upgrade.maxStacks <= 6" class="mt-1 flex items-center gap-1">
                    <span
                      v-for="n in o.upgrade.maxStacks"
                      :key="n"
                      class="h-1.5 w-3 rounded-full"
                      :style="{ backgroundColor: n < o.stack ? offerAccent(o) : n === o.stack ? '#ffffff' : 'rgba(255,255,255,0.15)' }"
                    />
                  </div>
                </div>
              </div>
              <p class="mt-3 text-xs text-white/80 leading-snug">{{ o.upgrade.description }}</p>
              <p v-if="o.upgrade.catch" class="mt-1 inline-flex items-center gap-1 text-[11px] font-black text-red-300">
                <UIcon name="i-lucide-triangle-alert" class="size-3" />{{ o.upgrade.catch }}
              </p>
            </button>
          </div>
        </div>
      </div>

      <!-- Death ----------------------------------------------------------- -->
      <div v-if="showDeath" class="absolute inset-0 flex items-center justify-center p-4">
        <div class="w-full max-w-lg max-h-full overflow-y-auto rounded-2xl bg-black/70 backdrop-blur-sm ring-1 ring-red-400/30 p-6 sm:p-8 text-white text-center">
          <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-red-300">The meadow keeps you</div>
          <div class="mt-1 text-5xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">Slain</div>
          <div class="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-left">
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Wave</div>
              <div class="text-xl font-black tabular-nums">{{ hud.wave }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Slain</div>
              <div class="text-xl font-black tabular-nums">{{ hud.kills }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Best combo</div>
              <div class="text-xl font-black tabular-nums">×{{ hud.highestCombo }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Time</div>
              <div class="text-xl font-black tabular-nums">{{ formatTime(hud.time) }}</div>
            </div>
          </div>
          <div v-if="hud.upgrades.length" class="mt-4 flex flex-wrap justify-center gap-1.5">
            <span v-for="u in hud.upgrades" :key="u.id" class="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold">
              <UIcon :name="u.icon" class="size-3.5 text-amber-200" />{{ u.name }}<span v-if="u.stacks > 1" class="text-amber-200">×{{ u.stacks }}</span>
            </span>
          </div>

          <!-- Payout -->
          <div class="mt-5 rounded-xl bg-amber-300/10 ring-1 ring-amber-300/30 p-3">
            <div v-if="finish.state === 'pending' || finish.state === 'idle'" class="flex items-center justify-center gap-2 py-2 text-sm font-bold text-white/70">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />Settling with the meadow…
            </div>
            <template v-else-if="finish.state === 'done' && finish.result">
              <div class="text-[10px] uppercase tracking-[0.3em] font-black text-amber-200">Payout</div>
              <div class="mt-1 text-lg font-black tabular-nums">
                {{ formatNumber(finish.result.counted) }} coins × {{ finish.result.coinMult.toFixed(2) }}
                <span class="text-white/40">=</span>
                <span class="text-amber-200">{{ formatNumber(finish.result.awarded) }}</span>
              </div>
              <div v-if="finish.result.capped" class="mt-1 text-[11px] font-bold text-white/50">Capped to what the waves you cleared could drop.</div>
              <div v-if="finish.result.newlyUnlocked.length" class="mt-2 rounded-lg bg-emerald-400/15 ring-1 ring-emerald-300/40 px-2 py-1.5 text-[12px] font-black text-emerald-200">
                New weapon unlocked: {{ finish.result.newlyUnlocked.map(id => WEAPONS[id as WeaponId].name).join(', ') }}
              </div>
            </template>
            <template v-else>
              <div class="text-sm font-bold text-red-300">{{ finish.error }}</div>
              <UButton class="mt-2 font-black" size="sm" color="primary" icon="i-lucide-rotate-cw" @click="retryFinish">Retry payout</UButton>
            </template>
          </div>

          <div class="mt-5 flex justify-center gap-2">
            <UButton
              size="lg"
              color="primary"
              icon="i-lucide-flower-2"
              class="font-black"
              :disabled="finish.state === 'pending' || finish.state === 'idle'"
              @click="backToMeadow"
            >
              Back to meadow
            </UButton>
          </div>
          <div v-if="finish.state === 'done'" class="mt-2 text-[11px] text-white/50">or press <UKbd>Space</UKbd></div>
        </div>
      </div>

      <!-- Victory --------------------------------------------------------- -->
      <div v-if="hud.phase === 'victory'" class="absolute inset-0 flex items-center justify-center p-4">
        <div class="w-full max-w-lg max-h-full overflow-y-auto rounded-2xl bg-black/70 backdrop-blur-sm ring-1 ring-amber-300/40 p-6 sm:p-8 text-white text-center">
          <div class="text-[11px] uppercase tracking-[0.4em] font-bold text-amber-200">Thirty waves</div>
          <div class="mt-1 text-5xl font-black tracking-tight drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">The meadow is yours</div>
          <div class="mt-5 grid grid-cols-3 gap-2 text-left">
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Slain</div>
              <div class="text-xl font-black tabular-nums">{{ hud.kills }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Best combo</div>
              <div class="text-xl font-black tabular-nums">×{{ hud.highestCombo }}</div>
            </div>
            <div class="rounded-lg bg-white/5 p-2.5">
              <div class="text-[10px] uppercase tracking-widest text-white/50 font-bold">Time</div>
              <div class="text-xl font-black tabular-nums">{{ formatTime(hud.time) }}</div>
            </div>
          </div>

          <!-- Payout -->
          <div class="mt-5 rounded-xl bg-amber-300/10 ring-1 ring-amber-300/30 p-3">
            <div v-if="finish.state === 'pending' || finish.state === 'idle'" class="flex items-center justify-center gap-2 py-2 text-sm font-bold text-white/70">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />Settling with the meadow…
            </div>
            <template v-else-if="finish.state === 'done' && finish.result">
              <div class="text-[10px] uppercase tracking-[0.3em] font-black text-amber-200">Payout</div>
              <div class="mt-1 text-lg font-black tabular-nums">
                {{ formatNumber(finish.result.counted) }} coins × {{ finish.result.coinMult.toFixed(2) }}
                <span class="text-white/40">=</span>
                <span class="text-amber-200">{{ formatNumber(finish.result.awarded) }}</span>
              </div>
              <div v-if="finish.result.won" class="mt-1 text-[11px] font-black text-amber-200/80">Victory bonus ×1.25 included</div>
              <div v-if="finish.result.capped" class="mt-1 text-[11px] font-bold text-white/50">Capped to what the waves you cleared could drop.</div>
              <div v-if="finish.result.newlyUnlocked.length" class="mt-2 rounded-lg bg-emerald-400/15 ring-1 ring-emerald-300/40 px-2 py-1.5 text-[12px] font-black text-emerald-200">
                New weapon unlocked: {{ finish.result.newlyUnlocked.map(id => WEAPONS[id as WeaponId].name).join(', ') }}
              </div>
            </template>
            <template v-else>
              <div class="text-sm font-bold text-red-300">{{ finish.error }}</div>
              <UButton class="mt-2 font-black" size="sm" color="primary" icon="i-lucide-rotate-cw" @click="retryFinish">Retry payout</UButton>
            </template>
          </div>

          <div class="mt-5 flex justify-center">
            <UButton
              size="lg"
              color="primary"
              icon="i-lucide-flower-2"
              class="font-black"
              :disabled="finish.state === 'pending' || finish.state === 'idle'"
              @click="backToMeadow"
            >
              Back to meadow
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.boon-card {
  animation: boon-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}
@keyframes boon-in {
  from { opacity: 0; transform: translateY(14px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.boon-pact {
  border-color: rgba(252, 165, 165, 0.55);
  box-shadow: 0 0 22px rgba(239, 68, 68, 0.22);
}
.boon-legendary {
  border-color: rgba(253, 224, 71, 0.9);
  box-shadow: 0 0 34px rgba(250, 204, 21, 0.45), inset 0 0 22px rgba(250, 204, 21, 0.12);
  animation: boon-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2) both, boon-shimmer 2.4s ease-in-out infinite 0.35s;
}
.boon-legendary::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 1rem;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 30%, rgba(255, 244, 200, 0.28) 48%, transparent 62%);
  background-size: 250% 100%;
  animation: boon-sheen 2.4s linear infinite;
}
@keyframes boon-shimmer {
  0%, 100% { box-shadow: 0 0 30px rgba(250, 204, 21, 0.35), inset 0 0 22px rgba(250, 204, 21, 0.1); }
  50% { box-shadow: 0 0 46px rgba(250, 204, 21, 0.6), inset 0 0 26px rgba(250, 204, 21, 0.18); }
}
@keyframes boon-sheen {
  from { background-position: 120% 0; }
  to { background-position: -30% 0; }
}
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
