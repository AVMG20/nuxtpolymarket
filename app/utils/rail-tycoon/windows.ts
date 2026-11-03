// Rail Tycoon — the window registry and the game view's shared context.
//
// useRtWindows() keeps the open game windows: one per kind plus entity id (one finances window, one
// window per vehicle or station). open() focuses a window that is already open instead of adding a
// second, new windows cascade from the top-left, and focus() raises a window above the others. The
// page renders every entry through its kind-to-component map; RtWindow reads its
// stacking order and closes itself through the same registry.
//
// The game view provides an RtGameContext to its toolbar, status bar and windows: the lockstep,
// the tools, the camera and a throttled tick to re-render on. The formatters below show the game's own
// money (pounds, not Polynux coins) and calendar.

import { inject, reactive, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RtCommandError, type RtCommand, type RtCommandResult } from '#shared/utils/rail-tycoon/commands'
import { changeLoan } from '#shared/utils/rail-tycoon/economy'
import type { RtClientMsg, RtErrorCode, RtPauseReason, RtRole } from '#shared/utils/rail-tycoon/protocol'
import type { RtCompany, RtDate } from '#shared/utils/rail-tycoon/types'
import type { RtCamera } from './camera'
import type { RtLockstep } from './lockstep'
import type { RtToolKind, RtToolOptions, RtTools } from './tools'

/* ------------------------------------------------------------------------------------------
 * Window registry
 * ---------------------------------------------------------------------------------------- */

/** Every kind of game window; the page maps each to its component. */
export const RT_WINDOW_KINDS = Object.freeze(['finances', 'buyVehicle', 'vehicleList', 'vehicle', 'station', 'minimap', 'buildPicker'] as const)
export type RtWindowKind = typeof RT_WINDOW_KINDS[number]

export interface RtWindowEntry {
    /** kind, or kind:id for a window about one entity. */
    readonly key: string
    readonly kind: RtWindowKind
    /** The vehicle, station or depot tile the window is about; null for a single window of its kind. */
    readonly id: number | null
    /** Cascade slot the window was placed in. */
    readonly slot: number
    /** Initial position in CSS pixels inside the window layer. */
    x: number
    y: number
    /** Stacking order: higher is in front. */
    z: number
    /** Extra props for the window component (the last open() call's win). */
    props: Record<string, unknown>
}

export interface RtWindowsOptions {
    /** Top-left of the first cascade slot (CSS pixels). */
    origin?: { x: number, y: number }
    /** Offset between cascade slots, both ways (CSS pixels). */
    step?: number
    /** Slots before the cascade starts over at the origin. */
    slots?: number
}

export interface RtWindows {
    /** Open windows in opening order; render them sorted or not, z decides what is in front. */
    readonly list: readonly RtWindowEntry[]
    /** Opens a window, or focuses it when one with that kind and id is open. */
    open(kind: RtWindowKind, id?: number | null, props?: Record<string, unknown>): RtWindowEntry
    close(key: string): void
    /** Raises a window above every other one. */
    focus(key: string): void
    get(key: string): RtWindowEntry | undefined
    isOpen(kind: RtWindowKind, id?: number | null): boolean
    /** The key of the frontmost window, or null with none open. */
    top(): string | null
    /** Closes every window for which `match` is true. */
    closeWhere(match: (entry: RtWindowEntry) => boolean): void
    closeAll(): void
}

export const RT_WINDOW_ORIGIN = Object.freeze({ x: 48, y: 16 })
export const RT_WINDOW_STEP = 24
export const RT_WINDOW_SLOTS = 8

/** The registry key of a window: its kind, plus the entity id for a window about one entity. */
export function rtWindowKey(kind: RtWindowKind, id: number | null = null): string {
    return id === null ? kind : `${kind}:${id}`
}

/** A fresh registry. Tests and the shared useRtWindows() both build one here. */
export function createRtWindows(options: RtWindowsOptions = {}): RtWindows {
    const origin = options.origin ?? RT_WINDOW_ORIGIN
    const step = options.step ?? RT_WINDOW_STEP
    const slots = Math.max(1, options.slots ?? RT_WINDOW_SLOTS)
    const list = reactive<RtWindowEntry[]>([])
    let z = 0

    const get = (key: string) => list.find(entry => entry.key === key)

    function focus(key: string): void {
        const entry = get(key)
        if (!entry) return
        // already in front: no bump, so a click inside the front window re-renders nothing
        if (entry.z === z) return
        entry.z = ++z
    }

    /** The first cascade slot no open window sits in; once all are taken, the next round. */
    function freeSlot(): number {
        const taken = new Set(list.map(entry => entry.slot % slots))
        for (let slot = 0; slot < slots; slot++) if (!taken.has(slot)) return slot
        return list.length
    }

    function open(kind: RtWindowKind, id: number | null = null, props: Record<string, unknown> = {}): RtWindowEntry {
        const key = rtWindowKey(kind, id)
        const existing = get(key)
        if (existing) {
            Object.assign(existing.props, props)
            focus(key)
            return existing
        }
        const slot = freeSlot()
        const k = slot % slots
        list.push({ key, kind, id, slot, x: origin.x + k * step, y: origin.y + k * step, z: ++z, props: { ...props } })
        return list[list.length - 1]!
    }

    function close(key: string): void {
        const i = list.findIndex(entry => entry.key === key)
        if (i >= 0) list.splice(i, 1)
    }

    function closeWhere(match: (entry: RtWindowEntry) => boolean): void {
        for (let i = list.length - 1; i >= 0; i--) if (match(list[i]!)) list.splice(i, 1)
    }

    return {
        list,
        open,
        close,
        focus,
        get,
        isOpen: (kind, id = null) => get(rtWindowKey(kind, id)) !== undefined,
        top: () => list.reduce<RtWindowEntry | null>((best, entry) => best && best.z >= entry.z ? best : entry, null)?.key ?? null,
        closeWhere,
        closeAll: () => {
            list.splice(0, list.length)
        }
    }
}

let shared: RtWindows | null = null

/**
 * The page's window registry, shared by the toolbar, the windows and the page that renders them.
 * Client side it is one registry per tab (the game view empties it on unmount); during server
 * rendering each call gets its own, so no request sees another's windows.
 */
export function useRtWindows(): RtWindows {
    if (typeof window === 'undefined') return createRtWindows()
    return shared ??= createRtWindows()
}

/* ------------------------------------------------------------------------------------------
 * The game view's context
 * ---------------------------------------------------------------------------------------- */

/** What the status bar's connection indicator shows. */
export type RtConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'resyncing' | 'spectating' | 'closed' | 'stopped'

/** Why the game view asks the page to go back to the chooser. */
export type RtLeaveReason = 'user' | 'deleted' | 'broken' | 'noAccess'

/**
 * Provided by RtGameView to everything in its slots (inject with useRtGame). The lockstep is replaced
 * after every resync or reopen, so read it through the ref each time, and re-subscribe to its events
 * when it changes. World objects mutate in place and are not reactive: read `tick.value` in a computed
 * or a render first, so it re-runs as the world steps.
 */
export interface RtGameContext {
    readonly worldId: string
    readonly lockstep: Readonly<ShallowRef<RtLockstep | null>>
    readonly tools: RtTools
    readonly camera: RtCamera
    /** The world tick, updated at most every RT_GAME_TICK_MS while it steps and on every new lockstep. */
    readonly tick: Readonly<Ref<number>>
    readonly status: Readonly<Ref<RtConnectionStatus>>
    readonly role: Readonly<Ref<RtRole>>
    /** The player's company id, or null for a spectator. */
    readonly companyId: Readonly<Ref<number | null>>
    readonly owner: Readonly<Ref<boolean>>
    readonly inviteCode: Readonly<Ref<string | null>>
    /** Why the room is paused, or null while it runs. */
    readonly paused: Readonly<Ref<RtPauseReason | null>>
    /** The owner stopped the world: everyone spectates. */
    readonly closed: Readonly<Ref<boolean>>
    /** The selected tool, mirrored from RtTools for the toolbar's highlight. */
    readonly tool: Readonly<Ref<RtToolKind>>
    /**
     * The vehicle window whose orders editor holds the map's pick mode (its window key), or null: one
     * at a time across every open vehicle window, so a pick lands in the window that asked for it.
     */
    readonly orderPickOwner: Ref<string | null>
    /** The tool options, mirrored from RtTools; change them with tools.setOptions(). */
    readonly toolOptions: Readonly<ShallowRef<Readonly<RtToolOptions>>>
    /** Whether this client may send commands now (a player of an open world, in step, connected). */
    canCommand(): boolean
    /** The player's company as it is now (not reactive), or null. */
    company(): RtCompany | null
    /** Sends a player command; false when it was not sent (spectator, closed, resyncing, offline). A refusal comes back as an error toast. */
    sendCommand(command: RtCommand): boolean
    /** sendCommand, with a warning toast when the command was not sent. */
    sendCommandOrWarn(command: RtCommand): boolean
    /** The player's command checked against the world as it is now, without applying it; null for a spectator or before the world loads. */
    tryCommand(command: RtCommand): RtCommandResult | null
    /** Sends a world-level message such as stop; false when the socket is down. */
    send(msg: RtClientMsg): boolean
    /** send, with a warning toast when the socket is down. */
    sendOrWarn(msg: RtClientMsg): boolean
    selectTool(tool: RtToolKind): void
    zoom(step: 1 | -1): void
    centreOnTile(tile: number): void
    /** Back to the chooser. */
    leave(): void
}

export const RT_GAME_KEY: InjectionKey<RtGameContext> = Symbol('rail-tycoon-game')

/** Milliseconds between tick updates for the UI. */
export const RT_GAME_TICK_MS = 100

/** The game view's context; only inside RtGameView's slots. */
export function useRtGame(): RtGameContext {
    const game = inject(RT_GAME_KEY, null)
    if (!game) throw new Error('useRtGame() needs an RtGameView above it')
    return game
}

/**
 * What window.__railTycoon holds: read-only views of local state for the browser harness.
 * Screen positions are client (viewport) CSS pixels.
 */
export interface RtDebugHook {
    readonly ready: boolean
    readonly worldId: string
    readonly tick: number | null
    readonly hash: number | null
    readonly company: number | null
    readonly role: RtRole | null
    /** Screen position of the centre of tile (x, y) at its surface, or null before the world loaded. */
    tileToScreen(x: number, y: number): { x: number, y: number } | null
    screenToTile(clientX: number, clientY: number): { x: number, y: number } | null
}

/* ------------------------------------------------------------------------------------------
 * Formatting
 * ---------------------------------------------------------------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** In-game money in pounds, as the original: £12,345 or -£12,345. */
export function rtFormatMoney(amount: number): string {
    const rounded = Math.round(amount)
    const text = `£${Math.abs(rounded).toLocaleString('en-GB')}`
    return rounded < 0 ? `-${text}` : text
}

function ordinal(day: number): string {
    const tens = day % 100
    if (tens >= 11 && tens <= 13) return `${day}th`
    switch (day % 10) {
        case 1: return `${day}st`
        case 2: return `${day}nd`
        case 3: return `${day}rd`
        default: return `${day}th`
    }
}

/** The game date as the original's status bar shows it: 1st Jan 1950. */
export function rtFormatDate(date: RtDate): string {
    return `${ordinal(date.day)} ${MONTHS[date.month] ?? '?'} ${date.year}`
}

/** A company colour index (RtCompany.colour) as a CSS colour, for title bars and swatches. */
export function rtCompanyCss(colourIndex: number): string {
    const colour = RT_CATALOG.companies.colours[colourIndex]
    return colour === undefined ? '#6b6b6b' : `#${colour.toString(16).padStart(6, '0')}`
}

/** A month's short name (0 = January). */
export function rtMonthName(month: number): string {
    return MONTHS[((month % 12) + 12) % 12]!
}

/* ------------------------------------------------------------------------------------------
 * Loan
 * ---------------------------------------------------------------------------------------- */

/** Whether one loan step each way would pass changeLoan's rule, tried on a copy. */
export function rtLoanActions(company: RtCompany | null): { borrow: boolean, repay: boolean } {
    if (!company) return { borrow: false, repay: false }
    return {
        borrow: changeLoan({ ...company }, 1).ok,
        repay: changeLoan({ ...company }, -1).ok
    }
}

export const RT_LOAN_STEP = RT_CATALOG.economy.loanStep
export const RT_MAX_LOAN = RT_CATALOG.economy.maxLoan

/* ------------------------------------------------------------------------------------------
 * Error text
 * ---------------------------------------------------------------------------------------- */

/** RtCommandError codes (commands.ts), as the toast a refused command shows. */
const COMMAND_ERRORS: Readonly<Record<RtCommandError, string>> = {
    [RtCommandError.occupied]: 'Something is in the way',
    [RtCommandError.notOwner]: 'Owned by someone else',
    [RtCommandError.badSlope]: 'Land sloped in the wrong direction',
    [RtCommandError.water]: 'Can\'t build on water',
    [RtCommandError.conflict]: 'Something is in the way',
    [RtCommandError.edge]: 'Too close to the edge of the map',
    [RtCommandError.tooSpread]: 'Station too spread out',
    [RtCommandError.alreadyBuilt]: 'Already built',
    [RtCommandError.invalid]: 'Can\'t do that here',
    [RtCommandError.limit]: 'Too many of those in this world',
    [RtCommandError.money]: 'Not enough cash',
    [RtCommandError.noCompany]: 'You have no company in this world',
    [RtCommandError.orders]: 'Those orders can\'t be used',
    [RtCommandError.loan]: 'Can\'t change the loan',
    [RtCommandError.noDepot]: 'No depot in reach',
    [RtCommandError.state]: 'The vehicle can\'t do that now',
    [RtCommandError.wrongDirection]: 'Road is in the wrong direction'
}

export function rtCommandErrorText(code: number): string {
    return COMMAND_ERRORS[code as RtCommandError] ?? 'That action was refused'
}

const SERVER_ERRORS: Record<RtErrorCode, string> = {
    badRequest: 'The server could not read that request',
    tooSoon: 'Too soon, try again in a moment',
    busy: 'The server is busy, try again in a moment',
    worldBroken: 'This world failed to run and is unavailable for now',
    noAccess: 'You don\'t have access to that world',
    worldFull: 'That world has no room for another company',
    worldClosed: 'This world is closed',
    notPlayer: 'Only players with a company can do that',
    notOwner: 'Only the world\'s owner can do that',
    atCap: 'You have reached the limit of worlds',
    badInvite: 'That invite link matches no world',
    rateLimited: 'Too many actions at once, slow down'
}

export function rtServerErrorText(code: RtErrorCode): string {
    return SERVER_ERRORS[code] ?? 'Something went wrong'
}
