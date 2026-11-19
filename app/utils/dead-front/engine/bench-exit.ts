// Leaving the workbench shop (pure, tested): which input closes it, and how
// the Escape that closes it is told apart from the Escape that pauses. The
// browser drops the pointer lock on Escape and may or may not hand the key to
// the page, before or after it says the lock is gone, so nothing here depends
// on the order those arrive in.

/** Why the shop closed. */
export type DfBenchClose = 'escape' | 'back' | 'interact' | 'move' | 'hurt' | 'away' | 'button'

/** A fresh press of one of these closes the shop and plays on. */
export const DF_BENCH_BACK_KEYS: readonly string[] = ['Mouse2', 'Backspace', 'KeyE']
/** Walking off closes it: a fresh press of a movement key (one held on the way in doesn't count). */
export const DF_BENCH_MOVE_KEYS: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']
/** An F press let go within this long (seconds) is a tap: it closes the shop; a longer one is the hold that crafts. */
export const DF_BENCH_TAP = 0.22
/** The Escape key and the lost pointer lock it causes arrive within this long of each other (ms). */
export const DF_BENCH_ESCAPE_WINDOW_MS = 400

export interface DfBenchExitInput {
    /** Was this key or button pressed this frame? */
    pressed(code: string): boolean
    /** F was let go this frame. */
    interactReleased: boolean
    /** When the F press that was let go began (seconds), or null (the press that opened the shop doesn't count). */
    interactAt: number | null
    now: number
    /** A craft went out on this press (letting go of it is no tap). */
    crafted: boolean
    /** Health now and a frame ago. */
    health: number
    lastHealth: number
}

/** What closes the open shop this frame, or null to keep it open. */
export function dfBenchExit(s: DfBenchExitInput): DfBenchClose | null {
    if (s.health < s.lastHealth) return 'hurt'
    if (s.pressed('Escape')) return 'escape'
    if (DF_BENCH_BACK_KEYS.some(k => s.pressed(k))) return 'back'
    if (DF_BENCH_MOVE_KEYS.some(k => s.pressed(k))) return 'move'
    if (s.interactReleased && s.interactAt !== null && !s.crafted && s.now - s.interactAt <= DF_BENCH_TAP) return 'interact'
    return null
}

export interface DfLockLoss {
    /** The window still has the focus (an alt-tab doesn't). */
    focused: boolean
    shopOpen: boolean
    /** Ms since Escape closed the shop (Infinity: it didn't). */
    sinceShopEscape: number
    /** Already playing on without the lock. */
    playingOn: boolean
    /** The chat box just let go of the keyboard. */
    typedJustNow: boolean
}

/**
 * The pointer lock is gone: does the game play on (Escape closed the workbench
 * or the chat box) instead of pausing? Holds whichever came first, the key
 * that closed the shop or the lock change.
 */
export function dfLockLossPlaysOn(s: DfLockLoss): boolean {
    if (!s.focused) return false
    return s.shopOpen || s.playingOn || s.typedJustNow || s.sinceShopEscape < DF_BENCH_ESCAPE_WINDOW_MS
}

/**
 * An Escape key while playing on without the lock: is it the pause? Not the
 * very key that closed the shop (it can arrive after the lock change), and not
 * one that is closing the shop right now.
 */
export function dfEscapePauses(s: { sincePlayingOn: number, shopOpen: boolean }): boolean {
    return !s.shopOpen && s.sincePlayingOn >= DF_BENCH_ESCAPE_WINDOW_MS
}
