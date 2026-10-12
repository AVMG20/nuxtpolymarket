// Polytown chest opening: the full-screen show a chest (or a reset that
// collects the track) plays over the game area. The streak panel starts it the
// moment a chest is clicked, while the claim is still in flight, and hands it
// the reward once the server has paid it. One module-level slot, drained by
// the <TownChestOpening /> that TownGame mounts.

import type { TownStreakChest, TownStreakExtra } from '#shared/utils/gamelogic/town-streak'

export interface TownChestLoot {
    coins: number
    gems: number
    resources: Record<string, number>
    extras: TownStreakExtra[]
    /** The tier the chest really opened as. */
    chest: TownStreakChest
    /** A lucky charge upgraded it from this tier. */
    upgradedFrom?: TownStreakChest
}

export interface TownChestShow {
    id: number
    mode: 'chest' | 'reset'
    /** The chest on the track (for a reset, the best one collected; null when it collected no chest). */
    chest: TownStreakChest | null
    step: number
    /** Days a reset collected. */
    days: number
    /** Chests a reset opened. */
    chests: number
    /** Filled in once the server has paid; until then the chest rattles. */
    loot: TownChestLoot | null
    /** Pays the held wallet out; runs once, on collect or unmount. */
    onCollect: (() => void) | null
}

const current = shallowRef<TownChestShow | null>(null)
let nextId = 0

function start(show: Omit<TownChestShow, 'id' | 'loot' | 'onCollect'> & { loot?: TownChestLoot | null, onCollect?: (() => void) | null }) {
    const entry: TownChestShow = { loot: null, onCollect: null, ...show, id: ++nextId }
    current.value = entry
    return {
        /** The server paid: the show may burst open. */
        resolve(loot: TownChestLoot, onCollect: () => void) {
            if (current.value?.id !== entry.id) {
                onCollect()
                return
            }
            current.value = { ...current.value, loot, onCollect }
        },
        /** The claim failed: drop the show. */
        cancel() {
            if (current.value?.id === entry.id) current.value = null
        }
    }
}

/** Ends the show and pays the wallet out. */
function finish(id: number) {
    const show = current.value
    if (!show || show.id !== id) return
    current.value = null
    show.onCollect?.()
}

export function useTownChestOpening() {
    return { current, start, finish }
}
