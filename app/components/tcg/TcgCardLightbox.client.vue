<script setup lang="ts">
// Large single-card viewer: the real WebGL TcgCard (tilt + foil) over a dark
// backdrop. `card: null` means closed, and closing is always the parent's job
// via the `close` event. The one thing it fetches for itself is condition:
// given a copyId (or a printingId to pick copies of) it pulls the server's
// lossy wear spec and hands it to TcgCard — failure just renders clean.
//
// Opening is a FLIP zoom: a card-shaped wrapper pre-sized to the final rect
// starts translated+scaled down onto the clicked tile (`origin`), showing the
// flat card image, and animates to center — only compositable properties move.
// Once settled the live TcgCard mounts over the image; closing runs the same
// trip in reverse and emits `close` when the wrapper is back on the tile.

import type { TcgCopySummary, TcgWearSpec, TcgChainEntry, TcgSaleRow, TcgGradePayload } from '#shared/types/tcg'
import type { TcgServiceKey } from '~/utils/tcg/slab'
import { buildSlabInfo, type SlabCardMeta } from '~/utils/tcg/slab-info'
import { isTcgService } from '#shared/utils/tcg/grading-fees'
import { sellerProceeds } from '#shared/utils/tcg/market'
import { SERVICES } from '#shared/utils/tcg/grading-model'

export interface LightboxCard {
    bundle: string | null
    assetNumber: string | null
    maskKind: string | null
    foilEffect: string | null
    legacySet?: string | null
    holo?: boolean
    name: string
    rarity?: string | null
    /** Raw pattern-variant key ('pokeball' | 'masterball') — drives the foil
     * effect in the renderer. */
    pattern?: string | null
    /** Human finish label for the badge ("Reverse (masterball)"). */
    finishLabel?: string | null
    serial?: string | null
    /** A specific owned copy to inspect — its wear spec is fetched once the
     * zoom settles. Absent → clean render. */
    copyId?: string | null
    /** With `owned > 0`, the lightbox fetches this printing's copies and shows
     * a serial-chip picker; the first copy is inspected by default. */
    printingId?: string | null
    owned?: number
    /** Viewport rect of the clicked tile — plain object, not a DOMRect, so it
     * survives being put in reactive state. Absent → fade+scale from center. */
    origin?: { x: number, y: number, width: number, height: number }
    /** Set/number metadata for the slab label when a graded copy is shown. */
    slabMeta?: Omit<SlabCardMeta, 'name' | 'rarity'>
    /** Market mode: the listing this card was opened from. */
    listing?: {
        id: string
        price: number
        sellerName: string
        note: string | null
        /** The caller's own listing — offer cancel, not buy. */
        mine: boolean
        /** Grade payload of the listed copy, when slabbed. */
        grade?: TcgGradePayload | null
    }
}

const props = defineProps<{ card: LightboxCard | null }>()
const emit = defineEmits<{ close: [] }>()

const ASPECT = 0.718
const ENTER_MS = 280
const LEAVE_MS = 240
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

// ~80% of the viewport height, but never wider than the viewport allows
// (the card is height-driven; width = height * ASPECT ≈ 0.718) and capped so
// huge monitors don't blow the texture up past its resolution.
const cardHeight = ref(420)
const vw = ref(0)
const vh = ref(0)
function computeHeight() {
    vw.value = window.innerWidth
    vh.value = window.innerHeight
    const byHeight = Math.round(window.innerHeight * 0.8)
    const byWidth = Math.round((window.innerWidth * 0.86) / ASPECT)
    cardHeight.value = Math.max(240, Math.min(byHeight, byWidth, 880))
}

// 2x inspect zoom: the card remounts at double height (its key carries the
// height), so the texture actually re-renders sharper rather than scaling up.
const zoom = ref(false)
const effHeight = computed(() => zoom.value ? cardHeight.value * 2 : cardHeight.value)

const finalRect = computed(() => {
    const h = effHeight.value
    const w = Math.round(h * ASPECT)
    return { x: Math.round((vw.value - w) / 2), y: Math.round((vh.value - h) / 2), w, h }
})

/* ---- animation state machine ----------------------------------------- */

const phase = ref<'closed' | 'entering' | 'open' | 'leaving'>('closed')
// True while the wrapper sits on (or is headed back to) the clicked tile.
const atOrigin = ref(true)
const backdropVisible = ref(false)
// The flat <img> stays under the TcgCard until its textures have had a moment
// to load (TcgCard has no load event — a short delay avoids the blank flash).
const imgGone = ref(false)
const transitionEnabled = ref(false)
// prefers-reduced-motion, sampled per open: skip the zoom, fade only.
const reduced = ref(false)

let timers: number[] = []
let raf = 0
function timer(fn: () => void, ms: number) {
    timers.push(window.setTimeout(fn, ms))
}
function clearTimers() {
    for (const t of timers) clearTimeout(t)
    timers = []
    if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
    }
}

const dur = computed(() => phase.value === 'leaving' ? LEAVE_MS : ENTER_MS)

const wrapperStyle = computed(() => {
    const f = finalRect.value
    const o = props.card?.origin
    const zoom = !!o && !reduced.value
    let transform = `translate(${f.x}px, ${f.y}px)`
    let opacity = 1
    if (atOrigin.value) {
        if (zoom) {
            transform = `translate(${o.x}px, ${o.y}px) scale(${o.width / f.w}, ${o.height / f.h})`
        } else {
            // No origin (or reduced motion): fade in place, from 95% unless
            // motion is reduced, in which case opacity alone moves.
            if (!reduced.value) transform += ' scale(0.95)'
            opacity = 0
        }
    }
    return {
        width: `${f.w}px`,
        height: `${f.h}px`,
        transform,
        opacity: String(opacity),
        transformOrigin: '0 0',
        willChange: 'transform, opacity',
        transition: transitionEnabled.value
            ? `transform ${dur.value}ms ${EASE}, opacity ${dur.value}ms ${EASE}`
            : 'none'
    }
})

// Flat print of the card, shown while the wrapper is in motion.
const flatSrc = computed(() => {
    const c = props.card
    if (!c) return ''
    const base = (useRuntimeConfig().public as { pokemonApiBase?: string }).pokemonApiBase
        ?? 'http://127.0.0.1:8080'
    return c.legacySet
        ? `${base}/images/legacy/${c.legacySet}/${c.assetNumber}.png`
        : `${base}/images/cards/${c.bundle}.png`
})

/* ---- condition inspection --------------------------------------------- */

// Which copy is under the glass. Seeded from `card.copyId` (pack reveal) or
// the first fetched copy (collection); serial chips switch it live — TcgCard
// stays mounted, the wear prop is reactive.
const activeCopyId = ref<string | null>(null)
const copies = ref<TcgCopySummary[] | null>(null)
const wear = ref<TcgWearSpec | null>(null)
// The centering measure tool (§6.2) — the ONE measuring tool. Everything
// else stays visual-only, so no other number ever appears here.
const ruler = ref(false)
let wearToken = 0
let copiesToken = 0

function resetInspection(card: LightboxCard | null) {
    wearToken++
    copiesToken++
    copies.value = null
    wear.value = null
    ruler.value = false
    zoom.value = false
    activeCopyId.value = card?.copyId ?? null
    // Lazily list this printing's copies for the chip strip — only when the
    // viewer actually owns some. Failure means no strip, nothing louder.
    if (card?.printingId && (card.owned ?? 0) > 0) {
        const t = copiesToken
        $fetch<TcgCopySummary[]>('/api/tcg/copies', { query: { printingId: card.printingId } })
            .then((list) => {
                if (t !== copiesToken || !list.length) return
                copies.value = list
                if (!activeCopyId.value) activeCopyId.value = list[0]!.id
            })
            .catch(() => {})
    }
}

// The wear spec is only worth fetching once the zoom has settled — and any
// failure (or a pre-condition copy returning null) just renders clean.
watch([phase, activeCopyId], ([ph, id]) => {
    if (ph !== 'open' || !id) return
    const t = ++wearToken
    $fetch<{ wear: TcgWearSpec | null }>('/api/tcg/copy-render', { query: { copyId: id } })
        .then((res) => {
            if (t === wearToken) wear.value = res.wear
        })
        .catch(() => {
            if (t === wearToken) wear.value = null
        })
})

const activeSerial = computed(() => {
    const fromList = copies.value?.find(c => c.id === activeCopyId.value)?.serial
    return fromList ?? props.card?.serial ?? null
})

/* ---- grading (§6.4) --------------------------------------------------- */

const activeCopy = computed(() =>
    copies.value?.find(c => c.id === activeCopyId.value) ?? null)
const activeGrade = computed(() =>
    activeCopy.value?.grade ?? props.card?.listing?.grade ?? null)

const slabInfo = computed(() => {
    const grade = activeGrade.value
    if (!grade || !props.card) return null
    return buildSlabInfo({
        name: props.card.name,
        rarity: props.card.rarity,
        ...props.card.slabMeta
    }, grade)
})
const slabService = computed<TcgServiceKey>(() =>
    (isTcgService(activeGrade.value?.service ?? '') ? activeGrade.value!.service : 'PSI') as TcgServiceKey)

function refetchCopies() {
    if (!props.card?.printingId) return
    const t = ++copiesToken
    $fetch<TcgCopySummary[]>('/api/tcg/copies', { query: { printingId: props.card.printingId } })
        .then((list) => {
            if (t !== copiesToken) return
            copies.value = list
        })
        .catch(() => {})
}

const toast = useToast()
const { fetchSession } = useAuth()

// Submit form. Fees are coins, anchored to the gem exchange's guide price —
// fetched when the panel opens so the preview matches what submit charges.
const gradePanel = ref(false)
const gradeService = ref<TcgServiceKey>('PSI')
const predicted = ref<string | undefined>(undefined)
const submitting = ref(false)
const gradeOptions = ['10', '9.5', '9', '8.5', '8', '7', '6', '5', '4', '3', '2', '1']
const serviceItems = computed(() => (Object.keys(SERVICES) as TcgServiceKey[]).map(key => ({
    label: `${key} — ${(SERVICES as Record<string, { name: string }>)[key]!.name}`,
    value: key
})))
const fees = ref<Record<TcgServiceKey, number> | null>(null)
watch(gradePanel, (open) => {
    if (!open || fees.value) return
    $fetch<Record<TcgServiceKey, number>>('/api/tcg/grading/fees')
        .then((res) => {
            fees.value = res
        })
        .catch(() => {})
})
const feePreview = computed(() => fees.value?.[gradeService.value] ?? null)

async function sendToGrading() {
    const copyId = activeCopyId.value
    if (!copyId || submitting.value) return
    submitting.value = true
    try {
        await $fetch('/api/tcg/grading/submit', {
            method: 'POST',
            body: {
                copyId,
                service: gradeService.value,
                predictedGrade: predicted.value ?? null
            }
        })
        toast.add({ title: 'Sent to the grader — back in 24 hours', color: 'success' })
        gradePanel.value = false
        predicted.value = undefined
        refetchCopies()
        await fetchSession()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not submit'), color: 'error' })
    } finally {
        submitting.value = false
    }
}

// Crack: two-step arm, because it cannot be undone and it can go wrong.
const crackArmed = ref(false)
const cracking = ref(false)
watch(activeCopyId, () => {
    crackArmed.value = false
})

async function crack() {
    const copyId = activeCopyId.value
    if (!copyId || cracking.value) return
    if (!crackArmed.value) {
        crackArmed.value = true
        return
    }
    cracking.value = true
    try {
        const res = await $fetch('/api/tcg/grading/crack', {
            method: 'POST',
            body: { copyId }
        })
        toast.add(res.damaged
            ? { title: 'Cracked — the tools slipped. New damage.', color: 'error' }
            : { title: 'Cracked clean. The card is raw again.', color: 'success' })
        crackArmed.value = false
        refetchCopies()
        // The wear may have changed if the crack damaged the card.
        const t = ++wearToken
        $fetch<{ wear: TcgWearSpec | null }>('/api/tcg/copy-render', { query: { copyId } })
            .then((r) => {
                if (t === wearToken) wear.value = r.wear
            })
            .catch(() => {})
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not crack'), color: 'error' })
    } finally {
        cracking.value = false
    }
}

/* ---- marketplace (§7) -------------------------------------------------- */

const emitClose = () => emit('close')

// Ownership chain + recent sales, fetched once the zoom settles.
const chain = ref<TcgChainEntry[] | null>(null)
const sales = ref<TcgSaleRow[] | null>(null)
watch([phase, () => props.card], ([ph]) => {
    if (ph !== 'open' || !props.card) return
    chain.value = null
    sales.value = null
    const copyId = props.card.copyId ?? activeCopyId.value
    if (props.card.listing && copyId) {
        $fetch<TcgChainEntry[]>('/api/tcg/market/chain', { query: { copyId } })
            .then((res) => {
                chain.value = res
            })
            .catch(() => {})
    }
    if (props.card.printingId) {
        $fetch<TcgSaleRow[]>('/api/tcg/market/history', { query: { printingId: props.card.printingId } })
            .then((res) => {
                sales.value = res.slice(0, 5)
            })
            .catch(() => {})
    }
})

// Buy: two-step arm, real money moves.
const buyArmed = ref(false)
const buying = ref(false)
async function buy() {
    const listing = props.card?.listing
    if (!listing || buying.value) return
    if (!buyArmed.value) {
        buyArmed.value = true
        return
    }
    buying.value = true
    try {
        await $fetch('/api/tcg/market/buy', { method: 'POST', body: { listingId: listing.id } })
        toast.add({ title: 'Bought — the card is yours', color: 'success' })
        await fetchSession()
        emitClose()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not buy'), color: 'error' })
        buyArmed.value = false
    } finally {
        buying.value = false
    }
}

async function cancelMyListing(listingId: string) {
    try {
        await $fetch('/api/tcg/market/cancel', { method: 'POST', body: { listingId } })
        toast.add({ title: 'Listing cancelled', color: 'success' })
        if (props.card?.listing) emitClose()
        else refetchCopies()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not cancel'), color: 'error' })
    }
}

// Sell form for an owned copy.
const sellPanel = ref(false)
const sellPrice = ref(1000)
const sellNote = ref('')
const sellSubmitting = ref(false)
async function listForSale() {
    const copyId = activeCopyId.value
    if (!copyId || sellSubmitting.value) return
    sellSubmitting.value = true
    try {
        await $fetch('/api/tcg/market/list', {
            method: 'POST',
            body: { copyId, price: Number(sellPrice.value), note: sellNote.value || null }
        })
        toast.add({ title: 'Listed on the market', color: 'success' })
        sellPanel.value = false
        sellNote.value = ''
        refetchCopies()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not list'), color: 'error' })
    } finally {
        sellSubmitting.value = false
    }
}

function saleLabel(row: TcgSaleRow): string {
    const grade = row.grade ? `${row.gradeService} ${row.grade}` : 'condition unknown'
    return `${grade} · ${formatNumber(row.price)}`
}

/* Centering readout: dx/dy are EXACT print offsets as fractions of the card's
 * dimensions. Against a nominal border of 6% per side, an offset of +dx makes
 * the left border (b+dx) and the right (b−dx); the ratio of those two is what
 * a collector's ruler would say. Left/right first, then top/bottom.
 */
const RULER_BORDER = 0.06

function ratioPair(delta: number) {
    const a = Math.max(0, RULER_BORDER + delta)
    const b = Math.max(0, RULER_BORDER - delta)
    const first = Math.round((a / Math.max(a + b, 1e-6)) * 100)
    return `${first}/${100 - first}`
}

const centeringLabel = computed(() => {
    const c = wear.value?.centering
    // dy > 0 shifts the print up, growing the bottom border — top/bottom
    // therefore reads from −dy.
    return c ? `${ratioPair(c.dx)} · ${ratioPair(-c.dy)}` : ''
})

// Border guides in a 718×1000 viewBox (the card's aspect): the outer line is
// the cut edge, the inner is where the print frame actually sits.
const rulerGuides = computed(() => {
    const c = wear.value?.centering
    if (!c) return null
    const W = 718
    const H = 1000
    const l = (RULER_BORDER + c.dx) * W
    const r = (RULER_BORDER - c.dx) * W
    const t = (RULER_BORDER - c.dy) * H
    const b = (RULER_BORDER + c.dy) * H
    return { x: l, y: t, w: W - l - r, h: H - t - b }
})

function settleOpen() {
    if (phase.value !== 'entering') return
    phase.value = 'open'
    // The live card mounts transparent over the flat print and only fades in
    // once it reports its first painted frame (onShaderReady) — no timer, no
    // flash.
}

// Crossfade: TcgCard starts at opacity 0 and eases in over the print once
// its first frame is composited; the print is retired after the fade.
const shaderIn = ref(false)
function onShaderReady() {
    shaderIn.value = true
    timer(() => {
        imgGone.value = true
    }, 350)
}

function onWrapperTransitionEnd(e: TransitionEvent) {
    if (e.propertyName === 'transform' || e.propertyName === 'opacity') settleOpen()
}

function startEnter() {
    clearTimers()
    computeHeight()
    reduced.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    phase.value = 'entering'
    imgGone.value = false
    shaderIn.value = false
    backdropVisible.value = false
    transitionEnabled.value = false
    atOrigin.value = true
    // Two frames: one to commit the origin transform without a transition,
    // the next to turn the transition on and release toward center.
    raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
            raf = 0
            transitionEnabled.value = true
            backdropVisible.value = true
            atOrigin.value = false
            timer(settleOpen, ENTER_MS + 60) // fallback if transitionend is lost
        })
    })
}

function requestClose() {
    if (phase.value === 'leaving' || phase.value === 'closed') return
    clearTimers()
    phase.value = 'leaving'
    // Swap back to the flat print instantly and ride the wrapper home — the
    // wrapper is already moving, which masks the reverse handoff.
    imgGone.value = false
    shaderIn.value = false
    backdropVisible.value = false
    transitionEnabled.value = true
    atOrigin.value = true
    timer(() => emit('close'), LEAVE_MS)
}

/* ---- environment: scroll lock, keyboard, resize ----------------------- */

// Capture-phase Escape, stopped: the pack-opening ceremony underneath owns a
// window keydown listener whose Escape closes the whole overlay — ours must
// win and close only the lightbox.
function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    requestClose()
}

let prevOverflow: string | null = null
function unlock() {
    if (prevOverflow === null) return
    document.body.style.overflow = prevOverflow
    prevOverflow = null
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('resize', computeHeight)
}

watch(() => props.card, (card) => {
    if (card) {
        if (prevOverflow === null) {
            prevOverflow = document.body.style.overflow
            document.body.style.overflow = 'hidden'
            window.addEventListener('keydown', onKeydown, true)
            window.addEventListener('resize', computeHeight)
        }
        // Also runs when a new card comes in mid-leave or mid-open: timers are
        // cleared and the zoom restarts cleanly from the new origin.
        resetInspection(card)
        startEnter()
    } else {
        clearTimers()
        unlock()
        resetInspection(null)
        phase.value = 'closed'
        atOrigin.value = true
        backdropVisible.value = false
    }
}, { immediate: true })

onBeforeUnmount(() => {
    clearTimers()
    unlock()
})
</script>

<template>
    <Teleport to="body">
        <div
            v-if="card"
            class="fixed inset-0 z-[60]"
            :class="phase === 'leaving' && 'pointer-events-none'"
        >
            <div
                class="absolute inset-0 bg-black/85 backdrop-blur-sm transition-opacity duration-200"
                :class="backdropVisible ? 'opacity-100' : 'opacity-0'"
                @click="requestClose"
            />

            <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="lg"
                aria-label="Close"
                class="absolute right-4 top-4 transition-opacity duration-200"
                :class="backdropVisible ? 'opacity-100' : 'opacity-0'"
                @click="requestClose"
            />

            <!-- Inspection tools: 2x zoom always; the centering ruler only
                 when a wear spec is actually present. -->
            <div
                v-if="phase === 'open'"
                class="absolute right-4 top-16 flex flex-col gap-1.5"
            >
                <UButton
                    icon="i-lucide-zoom-in"
                    :color="zoom ? 'primary' : 'neutral'"
                    variant="ghost"
                    size="lg"
                    aria-label="2x inspect"
                    @click="zoom = !zoom"
                />
                <UButton
                    v-if="wear"
                    icon="i-lucide-ruler"
                    :color="ruler ? 'primary' : 'neutral'"
                    variant="ghost"
                    size="lg"
                    aria-label="Measure centering"
                    @click="ruler = !ruler"
                />
            </div>

            <!-- The moving piece: pre-sized to the final rect so only
                 transform/opacity ever animate. -->
            <div
                class="absolute left-0 top-0"
                :style="wrapperStyle"
                @transitionend="onWrapperTransitionEnd"
            >
                <img
                    v-if="!imgGone && !activeGrade"
                    :src="flatSrc"
                    :alt="card.name"
                    class="absolute inset-0 h-full w-full rounded-xl object-cover"
                >
                <!-- A graded copy shows as its slab, not as a bare card. -->
                <div
                    v-if="phase === 'open' && activeGrade && slabInfo"
                    class="absolute inset-0 flex items-center justify-center"
                >
                    <TcgSlab
                        :key="`slab-${activeCopyId}-${effHeight}`"
                        :service="slabService"
                        :info="slabInfo"
                        :bundle="card.bundle ?? ''"
                        :asset-number="String(card.assetNumber ?? '')"
                        :mask-kind="card.maskKind ?? 'wp'"
                        :foil-effect="card.foilEffect"
                        :pattern="card.pattern"
                        :legacy-set="card.legacySet ?? null"
                        :holo="card.holo ?? false"
                        :height="effHeight"
                    />
                </div>
                <!-- Keyed on identity + height: TcgCard sizes its renderer at
                     mount, so a resize or card swap needs a fresh mount. It
                     sits over the flat print until the print is retired. -->
                <div
                    v-if="phase === 'open' && !activeGrade"
                    class="absolute inset-0 transition-opacity duration-300"
                    :class="shaderIn ? 'opacity-100' : 'opacity-0'"
                >
                    <TcgCard
                        :key="`${card.bundle ?? card.legacySet}-${card.assetNumber}-${effHeight}`"
                        :bundle="card.bundle ?? ''"
                        :asset-number="String(card.assetNumber ?? '')"
                        :mask-kind="card.maskKind ?? 'wp'"
                        :foil-effect="card.foilEffect"
                        :pattern="card.pattern"
                        :legacy-set="card.legacySet ?? null"
                        :holo="card.holo ?? false"
                        :height="effHeight"
                        :wear="wear"
                        bare
                        @ready="onShaderReady"
                    />
                </div>
                <!-- Centering measure (§6.2): border guides plus the measured
                     ratios. Pointer events pass through, so the tilt still
                     works with the ruler up. -->
                <div
                    v-if="ruler && rulerGuides && phase === 'open' && !activeGrade"
                    class="pointer-events-none absolute inset-0"
                >
                    <svg
                        viewBox="0 0 718 1000"
                        preserveAspectRatio="none"
                        class="absolute inset-0 h-full w-full"
                    >
                        <rect
                            x="4" y="4" width="710" height="992" rx="38"
                            fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"
                        />
                        <rect
                            :x="rulerGuides.x" :y="rulerGuides.y"
                            :width="rulerGuides.w" :height="rulerGuides.h"
                            fill="none" stroke="rgba(120,255,190,0.85)"
                            stroke-width="2" stroke-dasharray="10 7"
                        />
                        <line
                            x1="4" :y1="rulerGuides.y + rulerGuides.h / 2"
                            :x2="rulerGuides.x" :y2="rulerGuides.y + rulerGuides.h / 2"
                            stroke="rgba(255,255,255,0.55)" stroke-width="2"
                        />
                        <line
                            :x1="rulerGuides.x + rulerGuides.w" :y1="rulerGuides.y + rulerGuides.h / 2"
                            x2="714" :y2="rulerGuides.y + rulerGuides.h / 2"
                            stroke="rgba(255,255,255,0.55)" stroke-width="2"
                        />
                        <line
                            :x1="rulerGuides.x + rulerGuides.w / 2" y1="4"
                            :x2="rulerGuides.x + rulerGuides.w / 2" :y2="rulerGuides.y"
                            stroke="rgba(255,255,255,0.55)" stroke-width="2"
                        />
                        <line
                            :x1="rulerGuides.x + rulerGuides.w / 2" :y1="rulerGuides.y + rulerGuides.h"
                            :x2="rulerGuides.x + rulerGuides.w / 2" y2="996"
                            stroke="rgba(255,255,255,0.55)" stroke-width="2"
                        />
                    </svg>
                    <div
                        class="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 font-mono text-xs tabular-nums text-emerald-200"
                    >
                        {{ centeringLabel }}
                    </div>
                </div>
            </div>

            <!-- Zoomed, the card runs past the viewport — the caption pins to
                 the bottom edge instead of hanging off-screen below it. -->
            <div
                class="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1.5 transition-opacity duration-200"
                :class="phase === 'open' ? 'opacity-100' : 'opacity-0'"
                :style="zoom ? { bottom: '12px' } : { top: `${finalRect.y + finalRect.h + 12}px` }"
            >
                <div class="max-w-[80vw] truncate text-base font-semibold text-neutral-100">
                    {{ card.name }}
                </div>
                <div class="flex items-center gap-1.5">
                    <UBadge
                        v-if="card.rarity"
                        color="neutral"
                        variant="subtle"
                        size="sm"
                    >
                        {{ card.rarity }}
                    </UBadge>
                    <UBadge
                        v-if="card.finishLabel ?? card.pattern"
                        color="warning"
                        variant="subtle"
                        size="sm"
                    >
                        {{ card.finishLabel ?? card.pattern }}
                    </UBadge>
                </div>
                <div
                    v-if="wear && activeSerial"
                    class="font-mono text-xs tabular-nums text-neutral-500"
                >
                    inspecting copy · {{ activeSerial }}
                </div>
                <div
                    v-else-if="card.serial"
                    class="font-mono text-xs tabular-nums text-neutral-400"
                >
                    {{ card.serial }}
                </div>
                <!-- Serial chips: one per owned copy of this printing; picking
                     one re-fetches its wear while the card stays mounted. -->
                <div
                    v-if="copies && copies.length"
                    class="pointer-events-auto flex max-w-[86vw] flex-wrap items-center justify-center gap-1.5 pt-1"
                >
                    <button
                        v-for="copy in copies"
                        :key="copy.id"
                        class="cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors"
                        :class="copy.id === activeCopyId
                            ? 'border-neutral-300 bg-neutral-100 text-neutral-900'
                            : 'border-neutral-700 bg-neutral-900/70 text-neutral-400 hover:text-neutral-100'"
                        @click="activeCopyId = copy.id"
                    >
                        {{ copy.serial }}<template v-if="copy.grade"> · {{ copy.grade.service }} {{ copy.grade.grade }}</template>
                        <template v-else-if="copy.lifecycle === 'grading'"> · at grader</template>
                    </button>
                </div>

            </div>

            <!-- Grading (§6.4), docked right where there is vertical room:
                 send the copy under the glass to a grader, or crack the slab
                 it came back in. -->
            <div
                v-if="phase === 'open' && activeCopy"
                class="absolute right-4 top-36 flex w-[300px] flex-col items-stretch gap-2"
            >
                    <template v-if="activeGrade">
                        <div class="font-mono text-xs tabular-nums text-neutral-500">
                            {{ activeGrade.certNumber }}
                        </div>
                        <UButton
                            :color="crackArmed ? 'error' : 'neutral'"
                            variant="subtle"
                            size="xs"
                            icon="i-lucide-hammer"
                            :loading="cracking"
                            :label="crackArmed ? 'Really crack it? This can damage the card' : 'Crack slab'"
                            @click="crack"
                        />
                    </template>
                    <template v-else-if="activeCopy.lifecycle === 'grading'">
                        <div class="text-xs text-neutral-400">
                            This copy is at the grader — see the Grading tab.
                        </div>
                    </template>
                    <template v-else-if="activeCopy.listingId">
                        <div class="text-xs text-neutral-400">
                            Listed at
                            <b class="font-mono tabular-nums text-neutral-200">{{ formatNumber(activeCopy.listedPrice ?? 0) }}</b>
                            coins
                        </div>
                        <UButton
                            color="neutral"
                            variant="subtle"
                            size="xs"
                            icon="i-lucide-tag"
                            label="Cancel listing"
                            @click="cancelMyListing(activeCopy.listingId)"
                        />
                    </template>
                    <template v-else>
                        <div
                            v-if="!gradePanel && !sellPanel"
                            class="flex gap-1.5"
                        >
                            <UButton
                                color="neutral"
                                variant="subtle"
                                size="xs"
                                icon="i-lucide-medal"
                                label="Send to grading"
                                @click="gradePanel = true"
                            />
                            <UButton
                                color="neutral"
                                variant="subtle"
                                size="xs"
                                icon="i-lucide-tag"
                                label="List for sale"
                                @click="sellPanel = true"
                            />
                        </div>
                        <div
                            v-if="sellPanel"
                            class="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/90 p-3"
                        >
                            <UInput
                                v-model.number="sellPrice"
                                type="number"
                                size="sm"
                                :min="1"
                            >
                                <template #leading>
                                    <span class="text-xs text-neutral-500">coins</span>
                                </template>
                            </UInput>
                            <UInput
                                v-model="sellNote"
                                size="sm"
                                placeholder="condition claim (optional, unverified)"
                                :maxlength="280"
                            />
                            <div class="flex items-center justify-between">
                                <span class="text-xs text-neutral-400">
                                    you receive
                                    <b class="font-mono tabular-nums text-neutral-200">{{ formatNumber(sellerProceeds(Number(sellPrice) || 0)) }}</b>
                                    · 5% burned
                                </span>
                                <div class="flex gap-1.5">
                                    <UButton
                                        color="neutral"
                                        variant="ghost"
                                        size="xs"
                                        label="Cancel"
                                        @click="sellPanel = false"
                                    />
                                    <UButton
                                        color="primary"
                                        size="xs"
                                        :loading="sellSubmitting"
                                        label="List"
                                        @click="listForSale"
                                    />
                                </div>
                            </div>
                        </div>
                        <div
                            v-if="gradePanel"
                            class="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/90 p-3"
                        >
                            <USelect
                                v-model="gradeService"
                                :items="serviceItems"
                                size="sm"
                            />
                            <USelect
                                v-model="predicted"
                                :items="gradeOptions"
                                placeholder="your call on the grade"
                                size="sm"
                            />
                            <div class="flex items-center justify-between">
                                <span class="text-xs text-neutral-400">
                                    <b class="font-mono tabular-nums text-neutral-200">{{ feePreview === null ? '…' : formatNumber(feePreview) }}</b>
                                    coins · back in 24h
                                </span>
                                <div class="flex gap-1.5">
                                    <UButton
                                        color="neutral"
                                        variant="ghost"
                                        size="xs"
                                        label="Cancel"
                                        @click="gradePanel = false"
                                    />
                                    <UButton
                                        color="primary"
                                        size="xs"
                                        :loading="submitting"
                                        label="Submit"
                                        @click="sendToGrading"
                                    />
                                </div>
                            </div>
                        </div>
                    </template>
            </div>

            <!-- Market mode (§7.1): the listing this card was opened from —
                 buy or cancel, the seller's unverified claim, the ownership
                 chain, and recent sales for the printing. -->
            <div
                v-if="phase === 'open' && (card.listing || sales?.length)"
                class="absolute left-4 top-36 flex w-[280px] flex-col gap-3"
            >
                <div
                    v-if="card.listing"
                    class="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-950/90 p-3"
                >
                    <div class="flex items-baseline justify-between">
                        <span class="font-mono text-lg tabular-nums text-neutral-100">{{ formatNumber(card.listing.price) }}</span>
                        <span class="text-xs text-neutral-500">coins</span>
                    </div>
                    <div class="text-xs text-neutral-400">
                        sold by <b class="text-neutral-200">{{ card.listing.sellerName }}</b>
                    </div>
                    <div
                        v-if="card.listing.note"
                        class="rounded bg-neutral-900 px-2 py-1.5 text-xs italic text-neutral-300"
                    >
                        “{{ card.listing.note }}”
                        <span class="not-italic text-neutral-500"> — seller's claim, unverified</span>
                    </div>
                    <UButton
                        v-if="!card.listing.mine"
                        :color="buyArmed ? 'error' : 'primary'"
                        size="sm"
                        icon="i-lucide-shopping-cart"
                        :loading="buying"
                        :label="buyArmed ? `Pay ${formatNumber(card.listing.price)} coins?` : 'Buy'"
                        @click="buy"
                    />
                    <UButton
                        v-else
                        color="neutral"
                        variant="subtle"
                        size="sm"
                        icon="i-lucide-tag"
                        label="Cancel listing"
                        @click="cancelMyListing(card.listing.id)"
                    />
                </div>

                <div
                    v-if="card.listing && chain?.length"
                    class="rounded-lg border border-neutral-800 bg-neutral-950/90 p-3"
                >
                    <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Ownership chain</div>
                    <div
                        v-for="(entry, i) in chain"
                        :key="i"
                        class="flex items-center justify-between py-0.5 text-xs"
                    >
                        <span class="text-neutral-300">
                            {{ entry.kind === 'mint' ? 'pulled by' : 'sold to' }}
                            <b class="text-neutral-100">{{ entry.userName }}</b>
                        </span>
                        <span
                            v-if="entry.price !== null"
                            class="font-mono tabular-nums text-neutral-500"
                        >{{ formatNumber(entry.price) }}</span>
                    </div>
                </div>

                <div
                    v-if="sales?.length"
                    class="rounded-lg border border-neutral-800 bg-neutral-950/90 p-3"
                >
                    <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Recent sales</div>
                    <div
                        v-for="(row, i) in sales"
                        :key="i"
                        class="py-0.5 text-xs"
                        :class="row.grade ? 'text-neutral-300' : 'text-neutral-500'"
                    >
                        {{ saleLabel(row) }}
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
