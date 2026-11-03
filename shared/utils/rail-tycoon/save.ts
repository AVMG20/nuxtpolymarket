/**
 * Rail Tycoon's binary world save. encodeWorld writes a whole RtWorld at a tick
 * boundary; decodeWorld reads it back under the bounds below. The bytes are uncompressed:
 * store.ts gzips them for the database and room.ts for snapshots.
 *
 * Layout, little-endian, every list prefixed with its count as a varint:
 *   magic 'RTWD' (4 bytes), u16 format version
 *   settings: u16 side, u8 maxCompanies, u8 sharing (0 or 1)
 *   map: varint length + raw bytes for heights, kind and owner; varint length + u32 per tile for payload
 *   entity lists in this order: companies, towns, industries, stations, vehicles. Each is a count of
 *     live entities, then each entity in ascending id, its saved fields in types.ts declaration order
 *     (fields marked derived are skipped)
 *   crossing violations: a count, then each in list order as varint tile, causer and since
 *   scalars: u32 rng state, varint tick, u8 day, u8 month, varint year, varint pathfinder cursor
 *
 * Field encodings: ids, counts, tiles, ticks and other non-negative integers are varints; money is an
 * svarint (it goes negative and past 2^31); a field that may hold RT_NONE is a "ref", the
 * varint of value + 1; booleans and small enums (vehicle kind, state, order kind and flags) are u8.
 *
 * encodeWorld refuses (RangeError) a world that breaks a bound decode enforces, so a save that cannot
 * be loaded is never written.
 *
 * encodeWorldParts splits the same world for loading, resync and storage: an entity part (settings,
 * then the entity lists, violations and scalars exactly as above) and one part per 16x16-tile chunk
 * holding only that chunk's map. rtPartHash tells which parts changed.
 *
 * Stations and industries are tile entities (tile-entities.ts): the map holds their buildings, the
 * entity part their location and state. Decode joins every building to its tile entity by location
 * (rtTileEntityMismatch), and refuses a building without one or a tile entity whose tiles are not its
 * buildings.
 *
 * decodeWorld is a hostile-input boundary: a save may come from a client. Every count is checked
 * against its bound (and against the bytes left) before anything is allocated, every enum and
 * reference is range-checked, and any failure is RtBadData, which decodeWorld turns into null.
 */

import { RtBadData, RtReader, RtWriter } from './bytes'
import { RT_CARGO_IDS, RT_CATALOG, RT_INDUSTRY_TYPE_IDS, RT_VEHICLE_MODEL_IDS, type RtVehicleModelSpec } from './catalog'
import { rtEmptyFinance } from './economy'
import { RT_MAP_SIDES, RT_MAX_HEIGHT, RtMap, RtTileKind } from './map'
import { RT_TRACKDIR_END, rtTrackdirPiece } from './track'
import {
    RT_NONE,
    RT_OWNER_NONE,
    RtFacility,
    RtOrderFlag,
    RtOrderKind,
    RtVehicleKind,
    RtVehicleState,
    type RtCargoPacket,
    type RtCompany,
    type RtCrossingViolation,
    type RtFinance,
    type RtIndustry,
    type RtMonthTotals,
    type RtOrder,
    type RtStation,
    type RtStationCargo,
    type RtTown,
    type RtVehicle
} from './types'
import { RtWorld } from './world'
import { RT_ROAD_LANES, type RtTrackdirPiece } from './occupied'
import { rtRebuildStationIndex } from './stations'
import { rtStationPayloadValid } from './stations-build'
import { rtTileEntityMismatch } from './tile-entities'
import { rtRecountInfrastructure } from './infrastructure'
import { rtClearSignalCache } from './signals'
import {
    RT_FINANCE_KEYS,
    RT_LITTLE_ENDIAN,
    RT_SAVE_BOUNDS,
    rtWriteBool,
    rtWriteEntities,
    rtWriteSavedState
} from './save-write'

/**
 * Save format version encodeWorld writes. To add a saved field: bump this, write the field always,
 * and read it only when ctx.format is at least the new version, giving older saves a default. Stored
 * worlds then keep loading, and the next checkpoint rewrites them in the new format.
 */
export const RT_SAVE_FORMAT = 1

/** The oldest format decodeWorld still reads; raise it only when the saves before it are gone. */
export const RT_SAVE_OLDEST_FORMAT = 1

/** The four bytes every save starts with: 'RTWD'. */
export const RT_SAVE_MAGIC: readonly number[] = Object.freeze([0x52, 0x54, 0x57, 0x44])

export { RT_FINANCE_KEYS, RT_SAVE_BOUNDS } from './save-write'

/**
 * The whole world as a save (uncompressed). Call it only at a tick boundary, between two steps:
 * derived state is not written, and decode rebuilds it. Synchronous; the world is only read. Throws
 * RangeError when the world breaks a save bound.
 */
export function encodeWorld(world: RtWorld): Uint8Array {
    const w = new RtWriter()
    for (const byte of RT_SAVE_MAGIC) w.u8(byte)
    w.u16(RT_SAVE_FORMAT)
    rtWriteSavedState(w, world)
    return w.finish()
}

/* ------------------------------------------------------------------------------------------
 * World parts: the same world split for loading, resync and storage piece by piece
 * ---------------------------------------------------------------------------------------- */

/**
 * Tiles per chunk side. A chunk is the fixed map of its 16x16 tiles: terrain, track, road and
 * buildings, station and industry buildings included. Their tile entities live in the entity part.
 */
export const RT_CHUNK_TILES = 16

/**
 * Version of the part layouts below; a part of another version is refused. Format 1 kept towns,
 * industries and stations in the chunk they were anchored in; it was never released.
 */
export const RT_PART_FORMAT = 2

/** 'RTWE': the entity part. Settings, every entity list, crossing violations and the scalars. */
export const RT_ENTITY_PART_MAGIC: readonly number[] = Object.freeze([0x52, 0x54, 0x57, 0x45])
/** 'RTWC': one chunk part. */
export const RT_CHUNK_PART_MAGIC: readonly number[] = Object.freeze([0x52, 0x54, 0x57, 0x43])

/** Chunks of a map: (side / 16) squared, 16 to 256. */
export function rtChunkCount(side: number): number {
    const across = side / RT_CHUNK_TILES
    return across * across
}

/** The chunk tile `tile` lies in: chunks run row by row like tiles. */
export function rtChunkOfTile(side: number, tile: number): number {
    const across = side / RT_CHUNK_TILES
    const x = tile % side
    const y = (tile / side) | 0
    return ((y / RT_CHUNK_TILES) | 0) * across + ((x / RT_CHUNK_TILES) | 0)
}

/** A whole world as parts: index 0 is the entity part, index 1 + c is chunk c. */
export type RtWorldParts = Uint8Array[]

/** Corner columns (or rows) a chunk owns: its 16, plus the map's far edge for the last chunk. */
function chunkCornerSpan(side: number, start: number): number {
    return start + RT_CHUNK_TILES === side ? RT_CHUNK_TILES + 1 : RT_CHUNK_TILES
}

function writePartHeader(w: RtWriter, magic: readonly number[], world: RtWorld): void {
    for (const byte of magic) w.u8(byte)
    w.u16(RT_PART_FORMAT)
    w.u16(world.settings.side)
}

function writeChunkMap(w: RtWriter, map: RtMap, chunk: number): void {
    const side = map.side
    const across = side / RT_CHUNK_TILES
    const x0 = (chunk % across) * RT_CHUNK_TILES
    const y0 = ((chunk / across) | 0) * RT_CHUNK_TILES
    const cornersX = chunkCornerSpan(side, x0)
    const cornersY = chunkCornerSpan(side, y0)
    for (let y = y0; y < y0 + cornersY; y++) {
        const row = y * (side + 1) + x0
        w.bytes(map.heights.subarray(row, row + cornersX))
    }
    for (let y = y0; y < y0 + RT_CHUNK_TILES; y++) {
        const row = y * side + x0
        w.bytes(map.kind.subarray(row, row + RT_CHUNK_TILES))
    }
    for (let y = y0; y < y0 + RT_CHUNK_TILES; y++) {
        const row = y * side + x0
        w.bytes(map.owner.subarray(row, row + RT_CHUNK_TILES))
    }
    for (let y = y0; y < y0 + RT_CHUNK_TILES; y++) {
        const row = y * side + x0
        for (let x = 0; x < RT_CHUNK_TILES; x++) w.u32(map.payload[row + x]!)
    }
}

/**
 * The world as parts at a tick boundary, under the same bounds as encodeWorld: decodeWorldParts of
 * the result is the same world, so its hash is equal. Throws RangeError when the world breaks a bound.
 */
export function encodeWorldParts(world: RtWorld): RtWorldParts {
    const entities = new RtWriter()
    writePartHeader(entities, RT_ENTITY_PART_MAGIC, world)
    entities.u8(world.settings.maxCompanies)
    rtWriteBool(entities, world.settings.sharing)
    rtWriteEntities(entities, world)

    const parts: RtWorldParts = [entities.finish()]
    const count = rtChunkCount(world.settings.side)
    for (let chunk = 0; chunk < count; chunk++) {
        const w = new RtWriter()
        writePartHeader(w, RT_CHUNK_PART_MAGIC, world)
        w.varint(chunk)
        writeChunkMap(w, world.map, chunk)
        parts.push(w.finish())
    }
    return parts
}

function hex8(value: number): string {
    return (value >>> 0).toString(16).padStart(8, '0')
}

/**
 * A 64-bit content hash of one part as 16 hex digits: two independent 32-bit mixes, so parts with equal
 * hashes are taken to be equal bytes. It decides which parts to send or store, never anything a
 * peer's simulation reads.
 */
export function rtPartHash(bytes: Uint8Array): string {
    let a = 0x811c9dc5
    let b = 0x9747b28c ^ bytes.length
    for (let i = 0; i < bytes.length; i++) {
        const v = bytes[i]!
        a = Math.imul(a ^ v, 0x01000193)
        b = Math.imul(b ^ v, 0x5bd1e995)
        b ^= b >>> 13
    }
    a ^= a >>> 16
    a = Math.imul(a, 0x85ebca6b)
    a ^= a >>> 13
    b = Math.imul(b ^ (b >>> 15), 0xc2b2ae35)
    b ^= b >>> 16
    return hex8(a) + hex8(b)
}

/* ------------------------------------------------------------------------------------------
 * decodeWorld
 * ---------------------------------------------------------------------------------------- */

const TILE_KIND_COUNT = Object.keys(RtTileKind).length

/**
 * Exclusive bound of a train's trackdir (pieces, direction, route): track.ts RT_TRACKDIR_END.
 * 6 and 7 lie inside the bound but are no trackdir; rtTrackdirPiece refuses them in a train's pieces.
 */
const RT_TRACKDIR_LIMIT = RT_TRACKDIR_END

/** Exclusive bound of a road vehicle's direction, which is also its lane (RT_ROAD_LANES). */
const ROAD_DIRECTION_LIMIT = RT_ROAD_LANES

const FACILITY_MASK = RtFacility.rail | RtFacility.busStop | RtFacility.truckStop
const ORDER_FLAG_MASK = RtOrderFlag.fullLoad | RtOrderFlag.unload | RtOrderFlag.noUnload
const ACCEPTANCE_MASK = (1 << RT_CARGO_IDS.length) - 1
const FRACTION_MAX = (1 << RT_CATALOG.production.fracBits) - 1
const BYTE_MAX = 0xff
const U16_MAX = 0xffff

const MODEL_SPECS: readonly RtVehicleModelSpec[] = RT_VEHICLE_MODEL_IDS.map(id => RT_CATALOG.vehicles.models[id])

/** What decode knows so far: the map size and which ids are live, for checking references. */
interface DecodeContext {
    readonly r: RtReader
    /** The save's format: a field added in a later version is read only from saves that have it. */
    readonly format: number
    tileCount: number
    maxCompanies: number
    readonly companies: boolean[]
    readonly towns: boolean[]
    readonly stations: boolean[]
    /** Vehicles per owning company, for vehiclesPerCompany. */
    readonly perCompany: number[]
}

function bad(message: string): never {
    throw new RtBadData(message)
}

/** A varint no greater than max. */
function readUint(r: RtReader, max: number, what: string): number {
    const value = r.varint()
    if (value > max) bad(`${what} out of range: ${value} > ${max}`)
    return value
}

/**
 * A list count, checked against its bound and against the bytes left (every entry takes at least
 * one byte) before the caller allocates or loops, so a crafted count can neither allocate nor spin.
 */
function readCount(r: RtReader, cap: number, what: string): number {
    const count = r.varint()
    if (count > cap) bad(`${what}: ${count} exceeds the save bound ${cap}`)
    if (count > r.remaining()) bad(`${what}: ${count} entries but ${r.remaining()} bytes left`)
    return count
}

/** A ref field: varint of value + 1, so RT_NONE (-1) or a non-negative value. */
function readRef(r: RtReader): number {
    return r.varint() - 1
}

function readBool(r: RtReader, what: string): boolean {
    const value = r.u8()
    if (value > 1) bad(`${what} is not a boolean: ${value}`)
    return value === 1
}

function readU8Max(r: RtReader, max: number, what: string): number {
    const value = r.u8()
    if (value > max) bad(`${what} out of range: ${value} > ${max}`)
    return value
}

function readTile(ctx: DecodeContext, what: string): number {
    return readUint(ctx.r, ctx.tileCount - 1, what)
}

function readRefTile(ctx: DecodeContext, what: string): number {
    const tile = readRef(ctx.r)
    if (tile >= ctx.tileCount) bad(`${what} off the map: ${tile}`)
    return tile
}

/** The next entity id: strictly above the previous one and below the cap. */
function readId(r: RtReader, previous: number, cap: number, what: string): number {
    const id = r.varint()
    if (id <= previous || id >= cap) bad(`${what} id ${id} is not ascending below ${cap}`)
    return id
}

/** A company id that must name a live company. */
function readOwner(ctx: DecodeContext, what: string): number {
    const owner = ctx.r.varint()
    if (owner >= ctx.maxCompanies || !ctx.companies[owner]) bad(`${what} owner ${owner} is not a company`)
    return owner
}

/** A station ref within the station cap; whether it is live is checked once every station is read. */
function readStationRef(r: RtReader, what: string): number {
    const id = readRef(r)
    if (id >= RT_SAVE_BOUNDS.stations) bad(`${what} station out of range: ${id}`)
    return id
}

function checkLiveStation(ctx: DecodeContext, id: number, what: string): void {
    if (id !== RT_NONE && !ctx.stations[id]) bad(`${what} names missing station ${id}`)
}

function readName(r: RtReader): string {
    return r.str(RT_SAVE_BOUNDS.nameBytes)
}

function readCargoUints(r: RtReader, what: string): number[] {
    const count = r.varint()
    if (count !== RT_SAVE_BOUNDS.cargos) bad(`${what}: ${count} entries, not ${RT_SAVE_BOUNDS.cargos}`)
    const values: number[] = []
    for (let k = 0; k < count; k++) values.push(r.varint())
    return values
}

/** Raw bytes into a map array of exactly its length. */
function readRaw(r: RtReader, into: Uint8Array, what: string): void {
    const length = r.varint()
    if (length !== into.length) bad(`map ${what}: ${length} bytes, not ${into.length}`)
    into.set(r.bytes(length))
}

function readMap(ctx: DecodeContext, side: number): RtMap {
    const r = ctx.r
    const corners = (side + 1) * (side + 1)
    const tiles = side * side
    // heights, kind, owner and four payload bytes per tile, before allocating the map
    if (r.remaining() < corners + tiles * 6) bad(`truncated map: ${r.remaining()} bytes left`)
    const map = new RtMap(side)
    readRaw(r, map.heights, 'heights')
    for (let i = 0; i < corners; i++) if (map.heights[i]! > RT_MAX_HEIGHT) bad(`corner ${i} height ${map.heights[i]}`)
    readRaw(r, map.kind, 'kind')
    for (let i = 0; i < tiles; i++) if (map.kind[i]! >= TILE_KIND_COUNT) bad(`tile ${i} kind ${map.kind[i]}`)
    // owners are checked against the companies once those are read
    readRaw(r, map.owner, 'owner')
    const count = r.varint()
    if (count !== tiles) bad(`map payload: ${count} entries, not ${tiles}`)
    const raw = r.bytes(count * 4)
    if (RT_LITTLE_ENDIAN) {
        new Uint8Array(map.payload.buffer, map.payload.byteOffset, map.payload.byteLength).set(raw)
    } else {
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
        for (let i = 0; i < count; i++) map.payload[i] = view.getUint32(i * 4, true)
    }
    ctx.tileCount = tiles
    return map
}

function readFinance(r: RtReader): RtFinance {
    const finance = rtEmptyFinance()
    for (const key of RT_FINANCE_KEYS) finance[key] = r.svarint()
    return finance
}

function readCompany(ctx: DecodeContext, previous: number): RtCompany {
    const r = ctx.r
    const id = readId(r, previous, ctx.maxCompanies, 'company')
    const name = readName(r)
    const colour = readUint(r, RT_CATALOG.companies.colours.length - 1, 'company colour')
    const money = r.svarint()
    const loan = r.svarint()
    const bankruptMonths = r.varint()
    const foundedTick = r.varint()
    const financeThisYear = readFinance(r)
    const financeLastYear = readFinance(r)
    const monthIncome = r.svarint()
    const monthExpenses = r.svarint()
    const months = readCount(r, RT_SAVE_BOUNDS.monthlyIncome, 'monthly income')
    const monthlyIncome: RtMonthTotals[] = []
    for (let k = 0; k < months; k++) {
        const income = r.svarint()
        monthlyIncome.push({ income, expenses: r.svarint() })
    }
    return {
        id, name, colour, money, loan, bankruptMonths, foundedTick,
        infrastructure: { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 },
        financeThisYear, financeLastYear, monthIncome, monthExpenses, monthlyIncome
    }
}

function readTown(ctx: DecodeContext, previous: number): RtTown {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.towns, 'town')
    const name = readName(r)
    const centre = readTile(ctx, 'town centre')
    const houseCount = r.varint()
    const population = r.varint()
    const growthCounter = r.varint()
    const growthRate = r.varint()
    const growing = readBool(r, 'town growing')
    const activeStations = r.varint()
    const receivedThisMonth = readCargoUints(r, 'town cargo')
    const receivedLastMonth = readCargoUints(r, 'town cargo')
    return {
        id, name, centre, houseCount, population, growthCounter, growthRate, growing, activeStations,
        receivedThisMonth, receivedLastMonth
    }
}

function readIndustry(ctx: DecodeContext, previous: number): RtIndustry {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.industries, 'industry')
    const type = readUint(r, RT_INDUSTRY_TYPE_IDS.length - 1, 'industry type')
    const origin = readTile(ctx, 'industry origin')
    const waiting = readCargoUints(r, 'industry cargo')
    const delivered = readCargoUints(r, 'industry cargo')
    const producedThisMonth = readCargoUints(r, 'industry cargo')
    const transportedThisMonth = readCargoUints(r, 'industry cargo')
    return { id, type, origin, waiting, delivered, producedThisMonth, transportedThisMonth }
}

function readPacket(ctx: DecodeContext): RtCargoPacket {
    const r = ctx.r
    const cargo = readUint(r, RT_CARGO_IDS.length - 1, 'packet cargo')
    const count = r.varint()
    const sourceTile = readTile(ctx, 'packet source tile')
    const sourceStation = readStationRef(r, 'packet source')
    const transitPeriods = readUint(r, RT_CATALOG.payment.maxTransitPeriods, 'packet transit periods')
    const feederShare = r.svarint()
    return { cargo, count, sourceTile, sourceStation, transitPeriods, feederShare }
}

function readPackets(ctx: DecodeContext, cap: number, what: string): RtCargoPacket[] {
    const count = readCount(ctx.r, cap, what)
    const packets: RtCargoPacket[] = []
    for (let k = 0; k < count; k++) packets.push(readPacket(ctx))
    return packets
}

function readStationCargo(ctx: DecodeContext, packetsLeft: number): RtStationCargo {
    const r = ctx.r
    const rating = readUint(r, RT_CATALOG.stationRating.max, 'station rating')
    const hasRating = readBool(r, 'station hasRating')
    const loadAttempted = readBool(r, 'station loadAttempted')
    const packets = readPackets(ctx, packetsLeft, 'station packets')
    const fraction = readUint(r, FRACTION_MAX, 'station fraction')
    const cyclesSincePickup = readUint(r, BYTE_MAX, 'station cycles since pickup')
    const maxWaiting = r.varint()
    const lastSpeed = readUint(r, BYTE_MAX, 'station last speed')
    const lastAge = readUint(r, BYTE_MAX, 'station last age')
    return { rating, hasRating, loadAttempted, packets, fraction, cyclesSincePickup, maxWaiting, lastSpeed, lastAge }
}

function readStation(ctx: DecodeContext, previous: number): RtStation {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.stations, 'station')
    const owner = readOwner(ctx, 'station')
    const name = readName(r)
    const town = readRef(r)
    if (town !== RT_NONE && (town >= RT_SAVE_BOUNDS.towns || !ctx.towns[town])) bad(`station ${id} names missing town ${town}`)
    const sign = readTile(ctx, 'station sign')
    const tileCount = readCount(r, RT_SAVE_BOUNDS.stationTiles, 'station tiles')
    const tiles: number[] = []
    for (let k = 0; k < tileCount; k++) {
        const tile = readTile(ctx, 'station tile')
        if (k > 0 && tile <= tiles[k - 1]!) bad(`station ${id} tiles are not ascending`)
        tiles.push(tile)
    }
    const tilesRevision = r.varint()
    const facilities = readUint(r, FACILITY_MASK, 'station facilities')
    const cargoCount = r.varint()
    if (cargoCount !== RT_SAVE_BOUNDS.cargos) bad(`station cargo: ${cargoCount} entries, not ${RT_SAVE_BOUNDS.cargos}`)
    const cargo: RtStationCargo[] = []
    let packetsLeft = RT_SAVE_BOUNDS.stationPackets
    for (let k = 0; k < cargoCount; k++) {
        const entry = readStationCargo(ctx, packetsLeft)
        packetsLeft -= entry.packets.length
        cargo.push(entry)
    }
    const acceptance = readUint(r, ACCEPTANCE_MASK, 'station acceptance')
    const lastPickupTick = readRef(r)
    const lastDeliveryTick = readRef(r)
    const lastVehicleKind = readRef(r)
    if (lastVehicleKind !== RT_NONE && lastVehicleKind !== RtVehicleKind.rail && lastVehicleKind !== RtVehicleKind.road) {
        bad(`station last vehicle kind ${lastVehicleKind}`)
    }
    return {
        id, owner, name, town, sign, tiles, tilesRevision, facilities, cargo, acceptance,
        lastPickupTick, lastDeliveryTick, lastVehicleKind,
        // derived: rebuilt from tiles
        catchment: null, catchmentRevision: 0
    }
}

/** Uints each below limit, as many as count says up to cap. */
function readBelow(r: RtReader, cap: number, limit: number, what: string): number[] {
    const count = readCount(r, cap, what)
    const values: number[] = []
    for (let k = 0; k < count; k++) values.push(readUint(r, limit - 1, what))
    return values
}

function readOrder(ctx: DecodeContext): RtOrder {
    const r = ctx.r
    const kind = readU8Max(r, RtOrderKind.gotoDepot, 'order kind') as RtOrder['kind']
    let target: number
    if (kind === RtOrderKind.gotoStation) {
        target = readStationRef(r, 'order')
        checkLiveStation(ctx, target, 'order')
    } else {
        target = readRefTile(ctx, 'depot order')
    }
    const flags = readU8Max(r, ORDER_FLAG_MASK, 'order flags')
    return { kind, target, flags }
}

function readVehicle(ctx: DecodeContext, previous: number): RtVehicle {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.vehicles, 'vehicle')
    const owner = readOwner(ctx, 'vehicle')
    const owned = (ctx.perCompany[owner] ?? 0) + 1
    if (owned > RT_SAVE_BOUNDS.vehiclesPerCompany) bad(`company ${owner} has more than ${RT_SAVE_BOUNDS.vehiclesPerCompany} vehicles`)
    ctx.perCompany[owner] = owned

    const kind = readU8Max(r, RtVehicleKind.road, 'vehicle kind') as RtVehicleKind
    const rail = kind === RtVehicleKind.rail
    const model = readUint(r, MODEL_SPECS.length - 1, 'vehicle model')
    if (MODEL_SPECS[model]!.role !== (rail ? 'engine' : 'road')) bad(`vehicle ${id} model ${model} does not lead a ${rail ? 'train' : 'road vehicle'}`)
    // a train's consist is bounded by maxTrainLength in half-tile vehicles; a road vehicle is one part
    const parts = readCount(r, rail ? RT_SAVE_BOUNDS.consist : 1, 'consist')
    const consist: number[] = []
    for (let k = 0; k < parts; k++) {
        const part = readUint(r, MODEL_SPECS.length - 1, 'consist model')
        if (MODEL_SPECS[part]!.kind !== MODEL_SPECS[model]!.kind) bad(`vehicle ${id} consist mixes rail and road`)
        consist.push(part)
    }
    if (consist.length === 0 || consist[0] !== model) bad(`vehicle ${id} consist does not start with its model`)
    const wagonCount = readUint(r, consist.length - 1, 'wagon count')

    const directions = rail ? RT_TRACKDIR_LIMIT : ROAD_DIRECTION_LIMIT
    const tileCount = readCount(r, RT_SAVE_BOUNDS.vehicleTiles, 'vehicle tiles')
    const tiles: number[] = []
    for (let k = 0; k < tileCount; k++) tiles.push(readTile(ctx, 'vehicle tile'))
    if (r.varint() !== tileCount) bad(`vehicle ${id} pieces do not match its tiles`)
    const pieces: number[] = []
    for (let k = 0; k < tileCount; k++) pieces.push(readUint(r, directions - 1, 'vehicle piece'))
    const direction = readUint(r, directions - 1, 'vehicle direction')
    const progress = readUint(r, RT_CATALOG.movement.subTileUnits, 'vehicle progress')
    const speed = readUint(r, U16_MAX, 'vehicle speed')
    const subspeed = readUint(r, BYTE_MAX, 'vehicle subspeed')
    const route = readBelow(r, RT_SAVE_BOUNDS.route, directions, 'route')
    const routeIndex = readUint(r, route.length, 'route index')
    const routeTick = readRef(r)
    const reservedEnd = readUint(r, route.length, 'reserved end')

    const orderCount = readCount(r, RT_SAVE_BOUNDS.orders, 'orders')
    const orders: RtOrder[] = []
    for (let k = 0; k < orderCount; k++) orders.push(readOrder(ctx))
    const orderIndex = readUint(r, Math.max(0, orders.length - 1), 'order index')
    const state = readU8Max(r, RtVehicleState.parked, 'vehicle state') as RtVehicleState
    const stopped = readBool(r, 'vehicle stopped')
    const loadTicks = r.varint()
    const loadingStation = readStationRef(r, 'loading')
    checkLiveStation(ctx, loadingStation, 'loading')
    const cargo = readPackets(ctx, RT_SAVE_BOUNDS.vehiclePackets, 'vehicle packets')
    for (const packet of cargo) checkLiveStation(ctx, packet.sourceStation, 'packet source')

    const reliability = readUint(r, U16_MAX, 'reliability')
    const breakdownChance = readUint(r, BYTE_MAX, 'breakdown chance')
    const breakdownTicks = r.varint()
    const breakdownsSinceService = r.varint()
    const lastServiceTick = readRef(r)
    const serviceDepot = readRefTile(ctx, 'service depot')
    const haltInDepot = readBool(r, 'vehicle halt in depot')
    if (haltInDepot && serviceDepot === RT_NONE) throw new RtBadData('halt in depot without a depot')
    const runningTicks = r.varint()
    const lost = readBool(r, 'vehicle lost')
    const lostRetryTick = readRef(r)
    const blockedTicks = r.varint()
    const waitTicks = r.varint()
    const crashTicks = r.varint()
    const age = r.varint()
    const value = r.svarint()
    const profitThisYear = r.svarint()
    const profitLastYear = r.svarint()
    return {
        id, owner, kind, model, consist, wagonCount, tiles, pieces, direction, progress, speed, subspeed,
        route, routeIndex, routeTick, reservedEnd, orders, orderIndex, state, stopped, loadTicks,
        loadingStation, cargo, reliability, breakdownChance, breakdownTicks, breakdownsSinceService,
        lastServiceTick, serviceDepot, haltInDepot, runningTicks, lost, lostRetryTick, blockedTicks, waitTicks,
        crashTicks, age, value, profitThisYear, profitLastYear
    }
}

function readList<T extends { id: number }>(
    ctx: DecodeContext, cap: number, what: string, read: (ctx: DecodeContext, previous: number) => T, live: boolean[]
): T[] {
    const count = readCount(ctx.r, cap, what)
    const list: T[] = []
    let previous = -1
    for (let k = 0; k < count; k++) {
        const entity = read(ctx, previous)
        previous = entity.id
        live[entity.id] = true
        list.push(entity)
    }
    return list
}

/** The crossing violations: tiles on the map and never repeated, causers live companies. */
function readViolations(ctx: DecodeContext): RtCrossingViolation[] {
    const count = readCount(ctx.r, RT_SAVE_BOUNDS.violations, 'violations')
    const seen = new Set<number>()
    const list: RtCrossingViolation[] = []
    for (let k = 0; k < count; k++) {
        const tile = readTile(ctx, 'violation tile')
        if (seen.has(tile)) bad(`violation tile ${tile} repeated`)
        seen.add(tile)
        const causer = readOwner(ctx, 'violation')
        list.push({ tile, causer, since: ctx.r.varint() })
    }
    return list
}

/**
 * A RangeError from the world constructor or the occupied registry given decoded state means the
 * save is bad; any other error is a bug and propagates.
 */
function asBadData<T>(what: string, run: () => T): T {
    try {
        return run()
    } catch (error) {
        if (error instanceof RangeError) bad(`${what}: ${error.message}`)
        throw error
    }
}

/**
 * track.ts's trackdir -> track piece mapping; it throws RangeError on a value that is
 * no trackdir, which decode reports as bad data. The fallback below it is kept for a null mapping.
 * The blockHasPathSignal memo needs no rebuild: it is keyed by the map object and checks
 * every tile it read before answering.
 */
const SAVE_TRACKDIR_PIECE: RtTrackdirPiece | null = rtTrackdirPiece

/**
 * Rebuilds the derived state a save omits (§ 8.4) on a freshly decoded world: dirty
 * tiles empty, pathNodesLeft full, company infrastructure counts from the map, every
 * station's catchment cache marked stale (null), the tile-to-stations index, the path-signal
 * cache dropped and the occupied registry from the vehicles (depot occupants and road vehicles
 * now, train pieces once SAVE_TRACKDIR_PIECE is set). Throws RangeError on a vehicle the registry
 * refuses.
 */
export function rtRebuildDerived(world: RtWorld): void {
    world.dirtyTiles.clear()
    world.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
    rtRecountInfrastructure(world)
    rtClearSignalCache(world.map)
    for (const station of world.stations) {
        if (!station) continue
        station.catchment = null
        station.catchmentRevision = 0
    }
    rtRebuildStationIndex(world)
    if (SAVE_TRACKDIR_PIECE) {
        world.occupied.rebuild(world.vehicles, SAVE_TRACKDIR_PIECE)
        return
    }
    // the same walk as RtOccupiedRegistry.rebuild, minus the train pieces it cannot place yet
    world.occupied.clear()
    for (const vehicle of world.vehicles) {
        if (!vehicle) continue
        if (vehicle.state === RtVehicleState.inDepot) {
            if (vehicle.tiles.length > 0) world.occupied.enterDepot(vehicle.id, vehicle.tiles[0]!)
            continue
        }
        if (vehicle.kind !== RtVehicleKind.road) continue
        for (let k = 0; k < vehicle.tiles.length; k++) world.occupied.holdRoad(vehicle.id, vehicle.tiles[k]!, vehicle.pieces[k]!)
    }
}

/**
 * Parses a format-1 save into a world, or throws RtBadData: wrong magic or version, a short or
 * over-long read, a count past its bound (RT_SAVE_BOUNDS, checked before allocating), an enum or
 * value out of range, ids not strictly ascending, a reference to a missing company, town or station
 * (a packet's source station may be RT_NONE), a building not joined to its tile entity
 * (rtTileEntityMismatch), or trailing bytes. Never throws another error
 * type for any input. Derived state is rebuilt (rtRebuildDerived).
 */
export function decodeWorldOrThrow(bytes: Uint8Array): RtWorld {
    if (!(bytes instanceof Uint8Array)) bad('a save must be a Uint8Array')
    const r = new RtReader(bytes)
    for (const byte of RT_SAVE_MAGIC) if (r.u8() !== byte) bad('not a Rail Tycoon save')
    const format = r.u16()
    if (format < RT_SAVE_OLDEST_FORMAT || format > RT_SAVE_FORMAT) bad(`unsupported save format ${format}`)

    const side = r.u16()
    if (!RT_MAP_SIDES.includes(side)) bad(`map side ${side}`)
    const maxCompanies = r.u8()
    if (maxCompanies < 2 || maxCompanies > RT_SAVE_BOUNDS.companies) bad(`maxCompanies ${maxCompanies}`)
    const sharing = readBool(r, 'sharing')

    const ctx: DecodeContext = { r, format, tileCount: 0, maxCompanies, companies: [], towns: [], stations: [], perCompany: [] }
    const map = readMap(ctx, side)
    const entities = readEntities(ctx)
    r.end()
    checkTileOwners(ctx, map)

    return buildWorld({ side, maxCompanies, sharing }, map, entities)
}

interface RtDecodedEntities {
    companies: RtCompany[]
    towns: RtTown[]
    industries: RtIndustry[]
    stations: RtStation[]
    vehicles: RtVehicle[]
    tail: RtEntityTail
}

/** The entity lists, crossing violations and scalars, as writeEntities wrote them; ctx.tileCount is set. */
function readEntities(ctx: DecodeContext): RtDecodedEntities {
    const companies = readList(ctx, ctx.maxCompanies, 'companies', readCompany, ctx.companies)
    const towns = readList(ctx, RT_SAVE_BOUNDS.towns, 'towns', readTown, ctx.towns)
    const industries = readList(ctx, RT_SAVE_BOUNDS.industries, 'industries', readIndustry, [])
    const stations = readList(ctx, RT_SAVE_BOUNDS.stations, 'stations', readStation, ctx.stations)
    checkPacketSources(ctx, stations)
    const vehicles = readList(ctx, RT_SAVE_BOUNDS.vehicles, 'vehicles', readVehicle, [])
    return { companies, towns, industries, stations, vehicles, tail: readEntityTail(ctx) }
}

/** Every tile's owner is a live company or none, and every station tile's payload fits its owner. */
function checkTileOwners(ctx: DecodeContext, map: RtMap): void {
    for (let i = 0; i < map.tileCount; i++) {
        const owner = map.owner[i]!
        if (owner !== RT_OWNER_NONE && (owner >= ctx.maxCompanies || !ctx.companies[owner])) bad(`tile ${i} owner ${owner} is not a company`)
        if (map.kind[i] === RtTileKind.station && !rtStationPayloadValid(map.payload[i]!, owner)) bad(`tile ${i} station payload ${map.payload[i]}`)
    }
}

/** A station's packets may come from a station with a higher id, so they are checked once all are live. */
function checkPacketSources(ctx: DecodeContext, stations: readonly RtStation[]): void {
    for (const station of stations) {
        for (const cargo of station.cargo) for (const packet of cargo.packets) checkLiveStation(ctx, packet.sourceStation, 'packet source')
    }
}

interface RtEntityTail {
    violations: RtCrossingViolation[]
    rngState: number
    tick: number
    date: { day: number, month: number, year: number }
    pathfinderCursor: number
}

/** The crossing violations and the scalars that end both a whole save and an entity part. */
function readEntityTail(ctx: DecodeContext): RtEntityTail {
    const r = ctx.r
    const violations = readViolations(ctx)
    const rngState = r.u32()
    const tick = r.varint()
    for (const entry of violations) if (entry.since > tick) bad(`violation at tile ${entry.tile} dates from after tick ${tick}`)
    const day = r.u8()
    const month = r.u8()
    const year = r.varint()
    const pathfinderCursor = readUint(r, RT_SAVE_BOUNDS.vehicles, 'pathfinder cursor')
    return { violations, rngState, tick, date: { day, month, year }, pathfinderCursor }
}

function buildWorld(settings: RtWorld['settings'], map: RtMap, entities: RtDecodedEntities): RtWorld {
    const { companies, towns, industries, stations, vehicles, tail } = entities
    const world = asBadData('world', () => new RtWorld({
        settings: { side: settings.side, maxCompanies: settings.maxCompanies, sharing: settings.sharing },
        map,
        rngState: tail.rngState,
        tick: tail.tick,
        date: tail.date,
        pathfinderCursor: tail.pathfinderCursor,
        companies,
        towns,
        industries,
        stations,
        vehicles,
        violations: tail.violations
    }))
    const mismatch = rtTileEntityMismatch(world)
    if (mismatch) bad(mismatch)
    asBadData('derived state', () => rtRebuildDerived(world))
    return world
}

function readPartHeader(r: RtReader, magic: readonly number[], what: string): number {
    for (const byte of magic) if (r.u8() !== byte) bad(`not a Rail Tycoon ${what}`)
    const format = r.u16()
    if (format !== RT_PART_FORMAT) bad(`unsupported ${what} format ${format}`)
    const side = r.u16()
    if (!RT_MAP_SIDES.includes(side)) bad(`${what} map side ${side}`)
    return side
}

/** One chunk's map tiles, straight into the world's map; heights and kinds checked as readMap does. */
function readChunkMap(r: RtReader, map: RtMap, chunk: number): void {
    const side = map.side
    const across = side / RT_CHUNK_TILES
    const x0 = (chunk % across) * RT_CHUNK_TILES
    const y0 = ((chunk / across) | 0) * RT_CHUNK_TILES
    const cornersX = chunkCornerSpan(side, x0)
    const cornersY = chunkCornerSpan(side, y0)
    const tiles = RT_CHUNK_TILES * RT_CHUNK_TILES
    if (r.remaining() < cornersX * cornersY + tiles * 6) bad(`chunk ${chunk} map is truncated`)
    for (let y = y0; y < y0 + cornersY; y++) {
        const row = y * (side + 1) + x0
        const heights = r.bytes(cornersX)
        for (let x = 0; x < cornersX; x++) if (heights[x]! > RT_MAX_HEIGHT) bad(`corner ${row + x} height ${heights[x]}`)
        map.heights.set(heights, row)
    }
    for (let y = y0; y < y0 + RT_CHUNK_TILES; y++) {
        const kinds = r.bytes(RT_CHUNK_TILES)
        for (let x = 0; x < RT_CHUNK_TILES; x++) if (kinds[x]! >= TILE_KIND_COUNT) bad(`tile ${y * side + x0 + x} kind ${kinds[x]}`)
        map.kind.set(kinds, y * side + x0)
    }
    for (let y = y0; y < y0 + RT_CHUNK_TILES; y++) map.owner.set(r.bytes(RT_CHUNK_TILES), y * side + x0)
    for (let y = y0; y < y0 + RT_CHUNK_TILES; y++) {
        const row = y * side + x0
        for (let x = 0; x < RT_CHUNK_TILES; x++) map.payload[row + x] = r.u32()
    }
}

/**
 * Parses a world from its parts (encodeWorldParts), or throws RtBadData under every check
 * decodeWorldOrThrow makes, plus: the part count, and the magic, format and side of each part, and a
 * chunk part out of place. The entities are read first, then the chunks fill the map, then every
 * building is joined to its tile entity. Never throws another error type for any input.
 */
export function decodeWorldPartsOrThrow(parts: readonly Uint8Array[]): RtWorld {
    if (!Array.isArray(parts) || parts.length < 1 || !parts.every(part => part instanceof Uint8Array)) bad('world parts must be Uint8Arrays')
    const r = new RtReader(parts[0]!)
    const side = readPartHeader(r, RT_ENTITY_PART_MAGIC, 'entity part')
    const chunks = rtChunkCount(side)
    if (parts.length !== chunks + 1) bad(`${parts.length - 1} chunk parts for a map of ${chunks} chunks`)
    const maxCompanies = r.u8()
    if (maxCompanies < 2 || maxCompanies > RT_SAVE_BOUNDS.companies) bad(`maxCompanies ${maxCompanies}`)
    const sharing = readBool(r, 'sharing')

    const ctx: DecodeContext = { r, format: RT_SAVE_FORMAT, tileCount: side * side, maxCompanies, companies: [], towns: [], stations: [], perCompany: [] }
    const entities = readEntities(ctx)
    r.end()

    const map = new RtMap(side)
    for (let chunk = 0; chunk < chunks; chunk++) {
        const chunkReader = new RtReader(parts[chunk + 1]!)
        if (readPartHeader(chunkReader, RT_CHUNK_PART_MAGIC, 'chunk part') !== side) bad(`chunk part ${chunk} is for another map side`)
        if (chunkReader.varint() !== chunk) bad(`chunk part ${chunk} is out of place`)
        readChunkMap(chunkReader, map, chunk)
        chunkReader.end()
    }
    checkTileOwners(ctx, map)

    return buildWorld({ side, maxCompanies, sharing }, map, entities)
}

/** The world in a set of parts, or null when any part is malformed or they do not fit together. */
export function decodeWorldParts(parts: readonly Uint8Array[]): RtWorld | null {
    try {
        return decodeWorldPartsOrThrow(parts)
    } catch (error) {
        if (error instanceof RtBadData) return null
        throw error
    }
}

/**
 * The world in a format-1 save, or null when the bytes are malformed, oversized or reference a
 * missing entity. rtLoadWorld (store.ts) and RtLockstep (lockstep.ts) call it.
 */
export function decodeWorld(bytes: Uint8Array): RtWorld | null {
    try {
        return decodeWorldOrThrow(bytes)
    } catch (error) {
        if (error instanceof RtBadData) return null
        throw error
    }
}
