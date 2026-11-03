// Rail Tycoon — the build pickers' preview pictures, as the original's track, station, depot, stop
// and signal windows show them. Each picture is one tile of a tiny world with the thing built on it by the
// game's own commands, drawn by the renderer's own tile rules (rtTileDrawList) from the OpenGFX atlas
// onto a 2D canvas, so a picker always shows what the map will.
import { applyCommand, RtCommandKind, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import type { RtSignalType } from '#shared/utils/rail-tycoon/signals'
import type { RtAxis, RtRoadStopShape, RtStationTile } from '#shared/utils/rail-tycoon/stations-build'
import { RT_TRACK_COUNT, RtTrack } from '#shared/utils/rail-tycoon/track'
import type { RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany } from '#shared/utils/rail-tycoon/world'
import { rtTileDrawList, type RtDrawItem, type RtSpriteLookup } from './tile-draw'
import { RT_ATLAS_BASE_URL, rtFetchAtlasJson, type RtAtlasJson } from './sprites'

/** One picture a picker offers. */
export type RtPickerScene =
    /** The track pieces whose bits are set, one tile holding them all. */
    | { kind: 'rail', pieces: number }
    /** Road bits (RT_ROAD_DIR_BIT halves) on one tile. */
    | { kind: 'road', bits: number }
    | { kind: 'railStation', axis: RtAxis }
    | { kind: 'depot', vehicleKind: RtVehicleKind, facing: number }
    /** A bay facing a side or a drive-through stop along an axis (RtRoadStopShape, never auto). */
    | { kind: 'roadStop', stop: typeof RtStationTile.bus | typeof RtStationTile.truck, shape: RtRoadStopShape }
    | { kind: 'signal', signalType: RtSignalType }

const SIDE = 64
const AT = 32 * SIDE + 32
const OWNER = 0

/** The tile the scene builds on, as the map would draw it. */
export function rtPickerSceneItems(scene: RtPickerScene, lookup: RtSpriteLookup): RtDrawItem[] {
    const world = RtWorld.empty({ side: SIDE, maxCompanies: 2, sharing: false }, { companies: [rtNewCompany(OWNER, 'Picker', 0, 0)] })
    world.company(OWNER)!.money = 1e9
    const commands: RtCommand[] = []
    switch (scene.kind) {
        case 'rail':
            for (let piece = 0; piece < RT_TRACK_COUNT; piece++) {
                if ((scene.pieces & (1 << piece)) !== 0) commands.push({ kind: RtCommandKind.buildRail, tile: AT, piece })
            }
            break
        case 'road':
            commands.push({ kind: RtCommandKind.buildRoad, tile: AT, bits: scene.bits })
            break
        case 'railStation':
            commands.push({ kind: RtCommandKind.buildRailStation, tile: AT, axis: scene.axis, tracks: 1, length: 1 })
            break
        case 'depot':
            commands.push({ kind: RtCommandKind.buildDepot, tile: AT, vehicleKind: scene.vehicleKind, facing: scene.facing })
            break
        case 'roadStop':
            // on clear land: a drive-through stop lays its own road, a bay needs none
            commands.push({ kind: RtCommandKind.buildRoadStop, tile: AT, stop: scene.stop, shape: scene.shape })
            break
        case 'signal':
            commands.push({ kind: RtCommandKind.buildRail, tile: AT, piece: RtTrack.x })
            commands.push({ kind: RtCommandKind.placeSignal, tile: AT, piece: RtTrack.x, signalType: scene.signalType })
            break
    }
    for (const command of commands) {
        const result = applyCommand(world, OWNER, command, true)
        if (!result.ok) throw new Error(`picker scene ${scene.kind}: command ${command.kind} refused (${result.error})`)
    }
    return rtTileDrawList(world, AT, lookup)
}

let atlas: Promise<{ image: HTMLImageElement, json: RtAtlasJson, lookup: RtSpriteLookup }> | null = null

function loadAtlas() {
    atlas ??= (async () => {
        const json = await rtFetchAtlasJson()
        const image = new Image()
        image.src = `${RT_ATLAS_BASE_URL}atlas.png`
        await image.decode()
        const names = Object.keys(json.sprites)
        const lookup: RtSpriteLookup = {
            meta: json.meta,
            has: name => name in json.sprites,
            variantCount: prefix => names.filter(name => name.startsWith(`${prefix}.`) && !name.slice(prefix.length + 1).includes('.')).length,
            get: name => ({ layer: json.sprites[name]?.layer ?? null })
        }
        return { image, json, lookup }
    })()
    // a failed load is retried by the next picker
    atlas.catch(() => {
        atlas = null
    })
    return atlas
}

/** Canvas size of a picture in sprite pixels: one tile with room for a building. */
export const RT_PICKER_W = 68
export const RT_PICKER_H = 64

/** Draws a scene onto a canvas, its tile centred and its feet near the bottom. */
export async function rtDrawPickerScene(canvas: HTMLCanvasElement, scene: RtPickerScene): Promise<void> {
    const { image, json, lookup } = await loadAtlas()
    const items = rtPickerSceneItems(scene, lookup)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = RT_PICKER_W
    canvas.height = RT_PICKER_H
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // the tile's north corner (rtTileToWorld of 32, 32): its diamond spans x - 32 to x + 32, y to y + 32
    const tx = 0
    const ty = (32 + 32) * 16
    const left = tx - 32 - (RT_PICKER_W - 64) / 2
    const top = ty + 32 + 2 - RT_PICKER_H
    for (const item of items) {
        const frame = json.sprites[item.name]
        if (!frame) continue
        ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, item.wx + frame.ox - left, item.wy + frame.oy - top, frame.w, frame.h)
    }
}
