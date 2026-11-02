import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RtSignalType } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtRoadStopShape, RtStationTile } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y } from '#shared/utils/rail-tycoon/track'
import { RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import { rtPickerSceneItems, type RtPickerScene } from '../../app/utils/rail-tycoon/picker'
import { RtRailDirection, rtRailDirectionPieces } from '../../app/utils/rail-tycoon/tools'
import type { RtSpriteLookup } from '../../app/utils/rail-tycoon/renderer'

const json = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/rail-tycoon/opengfx/atlas.json'), 'utf8')) as {
    meta: RtSpriteLookup['meta']
    sprites: Record<string, { layer?: 'rear' | 'front' | null }>
}
const names = Object.keys(json.sprites)
const lookup: RtSpriteLookup = {
    meta: json.meta,
    has: name => name in json.sprites,
    variantCount: prefix => names.filter(name => name.startsWith(`${prefix}.`) && !name.slice(prefix.length + 1).includes('.')).length,
    get: name => ({ layer: json.sprites[name]?.layer ?? null })
}

const drawn = (scene: RtPickerScene) => rtPickerSceneItems(scene, lookup).map(item => item.name)

describe('build picker pictures', () => {
    it('builds every choice with the game\'s commands and draws it with atlas sprites', () => {
        const scenes: [RtPickerScene, string][] = [
            [{ kind: 'railStation', axis: RtAxis.x }, 'station.rail.x'],
            [{ kind: 'railStation', axis: RtAxis.y }, 'station.rail.y'],
            ...[0, 1, 2, 3].map(facing => [{ kind: 'depot', vehicleKind: RtVehicleKind.rail, facing }, `depot.rail.${['ne', 'se', 'sw', 'nw'][facing]}`] as [RtPickerScene, string]),
            ...[0, 1, 2, 3].map(facing => [{ kind: 'depot', vehicleKind: RtVehicleKind.road, facing }, `depot.road.${['ne', 'se', 'sw', 'nw'][facing]}`] as [RtPickerScene, string]),
            [{ kind: 'roadStop', stop: RtStationTile.bus, shape: RtRoadStopShape.driveX }, 'roadstop.bus'],
            [{ kind: 'roadStop', stop: RtStationTile.truck, shape: RtRoadStopShape.driveX }, 'roadstop.truck'],
            [{ kind: 'signal', signalType: RtSignalType.block }, 'signal.block'],
            [{ kind: 'signal', signalType: RtSignalType.path }, 'signal.path']
        ]
        for (const [scene, prefix] of scenes) {
            const list = drawn(scene)
            expect(list.every(name => name in json.sprites), `${JSON.stringify(scene)}: ${list}`).toBe(true)
            expect(list.some(name => name.startsWith(prefix)), `${JSON.stringify(scene)}: ${list}`).toBe(true)
        }
    })

    it('draws each track direction, autorail and both road axes as their own picture', () => {
        const pictures = [
            ...[RtRailDirection.vertical, RtRailDirection.x, RtRailDirection.horizontal, RtRailDirection.y, RtRailDirection.auto]
                .map(direction => drawn({ kind: 'rail', pieces: rtRailDirectionPieces(direction) })),
            drawn({ kind: 'road', bits: RT_ROAD_X }),
            drawn({ kind: 'road', bits: RT_ROAD_Y }),
            drawn({ kind: 'road', bits: RT_ROAD_X | RT_ROAD_Y })
        ]
        for (const list of pictures) {
            expect(list.length).toBeGreaterThan(0)
            expect(list.every(name => name in json.sprites), `${list}`).toBe(true)
        }
        expect(new Set(pictures.map(list => list.join())).size).toBe(pictures.length)
    })

    it('offers the original\'s six stop pictures for buses and lorries, each its own', () => {
        const shapes = [
            [RtRoadStopShape.bayNe, 'ne.ground'],
            [RtRoadStopShape.baySe, 'se.ground'],
            [RtRoadStopShape.baySw, 'sw.ground'],
            [RtRoadStopShape.bayNw, 'nw.ground'],
            [RtRoadStopShape.driveX, null],
            [RtRoadStopShape.driveY, null]
        ] as const
        for (const [stop, kind] of [[RtStationTile.bus, 'bus'], [RtStationTile.truck, 'truck']] as const) {
            const pictures = shapes.map(([shape, ground]) => {
                const list = drawn({ kind: 'roadStop', stop, shape })
                expect(list.every(name => name in json.sprites), `${shape}: ${list}`).toBe(true)
                if (ground) {
                    // a bay: its own ground by its entrance, no road through
                    expect(list[0]).toBe(`roadstop.${kind}.${ground}`)
                } else {
                    // a drive-through stop: the straight road it laid, under the stop's parts
                    expect(list[0]).toBe(shape === RtRoadStopShape.driveX ? 'road.grass.ne-sw' : 'road.grass.se-nw')
                    expect(list.slice(1).every(name => name.startsWith(`roadstop.${kind}.`))).toBe(true)
                }
                return list.join(' ')
            })
            expect(new Set(pictures).size).toBe(6)
        }
    })
})
