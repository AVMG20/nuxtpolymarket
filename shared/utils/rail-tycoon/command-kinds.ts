/**
 * The player command vocabulary: kinds, shapes, refusal codes and results. A leaf module, so the
 * command rules (commands.ts) and the codec (command-codec.ts) both build their per-kind tables on it.
 */

import { RtBuildError } from './track'
import { RT_OWNER_NONE, type RtOrder } from './types'

/** Command kinds. Fixed for protocol version 1 (the encoder writes them as a u8); a new one takes a new value. */
export const RtCommandKind = {
    buildRail: 0,
    buildRailLine: 1,
    removeRail: 2,
    buildRoad: 3,
    buildRoadLine: 4,
    removeRoad: 5,
    buildRailStation: 6,
    buildRoadStop: 7,
    buildDepot: 8,
    placeSignal: 9,
    demolish: 10,
    demolishArea: 11,
    buyVehicle: 12,
    sellVehicle: 13,
    setOrders: 14,
    startStop: 15,
    sendToDepot: 16,
    reverseTrain: 17,
    changeLoan: 18,
    renameCompany: 19,
    buildSiding: 20,
    removeSiding: 21,
    /** Server-only: a player joins a world. decodeClientMsg refuses it from clients. */
    foundCompany: 22
} as const
export type RtCommandKind = typeof RtCommandKind[keyof typeof RtCommandKind]

export type RtCommand =
    | { kind: typeof RtCommandKind.buildRail, tile: number, piece: number }
    /** A drag along a trackdir from tile to endTile, inclusive; diagonal drags alternate the two pieces. */
    | { kind: typeof RtCommandKind.buildRailLine, tile: number, endTile: number, trackdir: number }
    | { kind: typeof RtCommandKind.removeRail, tile: number, piece: number }
    | { kind: typeof RtCommandKind.buildRoad, tile: number, bits: number }
    /** A straight drag from tile to endTile, inclusive, on one row or one column. */
    | { kind: typeof RtCommandKind.buildRoadLine, tile: number, endTile: number }
    | { kind: typeof RtCommandKind.removeRoad, tile: number, bits: number }
    | { kind: typeof RtCommandKind.buildRailStation, tile: number, axis: number, tracks: number, length: number }
    /**
     * A bus or truck stop; shape is an RtRoadStopShape, auto (a drive-through stop along the road there)
     * when left out, as every stop command before bays.
     */
    | { kind: typeof RtCommandKind.buildRoadStop, tile: number, stop: number, shape?: number }
    | { kind: typeof RtCommandKind.buildDepot, tile: number, vehicleKind: number, facing: number }
    | { kind: typeof RtCommandKind.placeSignal, tile: number, piece: number, signalType: number }
    | { kind: typeof RtCommandKind.demolish, tile: number }
    /** The rectangle with corners tile and endTile, inclusive, walked row by row. */
    | { kind: typeof RtCommandKind.demolishArea, tile: number, endTile: number }
    | { kind: typeof RtCommandKind.buyVehicle, depot: number, model: number, wagons: number[] }
    | { kind: typeof RtCommandKind.sellVehicle, vehicle: number }
    | { kind: typeof RtCommandKind.setOrders, vehicle: number, orders: RtOrder[] }
    /** Sets the vehicle stopped or started; refused when it already is. */
    | { kind: typeof RtCommandKind.startStop, vehicle: number, stopped: boolean }
    /** Sends the vehicle to its nearest own depot to stop there, or cancels that when already sent. */
    | { kind: typeof RtCommandKind.sendToDepot, vehicle: number }
    | { kind: typeof RtCommandKind.reverseTrain, vehicle: number }
    /** Loan steps: positive borrows, negative repays. */
    | { kind: typeof RtCommandKind.changeLoan, steps: number }
    | { kind: typeof RtCommandKind.renameCompany, name: string }
    | { kind: typeof RtCommandKind.buildSiding, tile: number }
    | { kind: typeof RtCommandKind.removeSiding, tile: number }
    | { kind: typeof RtCommandKind.foundCompany, name: string, colour: number }

/** The command of one kind. */
export type RtCommandOf<K extends RtCommandKind> = Extract<RtCommand, { kind: K }>

/**
 * Why a command was refused: the build rule codes (RtBuildError, 0 to 9) and the command layer's
 * own. The room sends the code to the sender only (protocol result).
 */
export const RtCommandError = {
    ...RtBuildError,
    /** The company cannot pay for it (cash, which includes the loan). */
    money: 10,
    /** The acting company does not exist, or the command is not one it may issue. */
    noCompany: 11,
    /** validateOrders refused the list; detail holds its RtOrderError. */
    orders: 12,
    /** changeLoan refused; detail holds its RtLoanError. */
    loan: 13,
    /** No own depot of the vehicle's kind can be reached. */
    noDepot: 14,
    /** The vehicle is not in a state where that button is shown. */
    state: 15
} as const
export type RtCommandError = typeof RtCommandError[keyof typeof RtCommandError]

/** ok with the signed cost (a refund negative) and the id made: the company, the vehicle, or the station built or joined. */
export type RtCommandResult =
    | { ok: true, cost: number, id?: number }
    | { ok: false, error: RtCommandError, detail?: number }

/** The company id stamped on a server-issued command (the protocol's 255). */
export const RT_SERVER_COMPANY = RT_OWNER_NONE
