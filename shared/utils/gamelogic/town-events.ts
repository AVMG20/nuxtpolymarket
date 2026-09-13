/**
 * What a Polytown notification carries. The server writes these as a building,
 * upgrade or project finishes and as resting offers get taken; the client
 * renders them from the catalog, so only ids travel.
 */
export type TownEventData =
    /** A first construction finished. */
    | { kind: 'built', type: string, level: number }
    /** An upgrade finished. */
    | { kind: 'upgraded', type: string, level: number }
    /** A research project was banked. */
    | { kind: 'research', researchId: string }
    /**
     * Another mayor took some or all of a resting offer. `side` is the offer
     * owner's side; `coins` is what changed hands for this fill; `done` says
     * the offer is now fully filled.
     */
    | { kind: 'trade', side: 'buy' | 'sell', resource: string, quantity: number, price: number, coins: number, done: boolean }

export type TownEventKind = TownEventData['kind']

export interface TownEvent {
    id: string
    data: TownEventData
    /** Epoch ms of when it happened. */
    at: number
}

/** How many events one page of the notification centre shows. */
export const TOWN_EVENTS_PAGE = 10
/** The most one request may ask for. */
export const TOWN_EVENTS_MAX_PAGE = 100
/** Events older than this are pruned on the next settle. */
export const TOWN_EVENTS_KEEP_MS = 30 * 24 * 3_600_000
