import { computed, ref, type Ref } from 'vue'
import { nextSection, type Construction } from '#shared/utils/nitro-rush/construct'
import { lastPieceWalk, lineSections, sectionFault, type CustomTrack, type LooseRoad, type SectionId } from '#shared/utils/nitro-rush/custom'
import { walkForks, withLineSections } from '#shared/utils/nitro-rush/custom-forks'
import { GRID, type LayoutWalk, type RoadState } from '#shared/utils/nitro-rush/layout'
import { endOf, LaidRoad, LEVEL_HEIGHT, SNAP_RADIUS, startingAt, walkLoose, type DraftGround, type RoadEndPose } from '#shared/utils/nitro-rush/loose-road'
import { ROAD } from '#shared/utils/nitro-rush/tracks'

/** Where a piece placed with the mouse goes: onto the end of a line, onto the end of loose road, or down on its own. */
export type PlaceTarget =
    | { kind: 'line', line: number, end: RoadEndPose }
    | { kind: 'loose', k: number, end: RoadEndPose }
    | { kind: 'free', x: number, z: number }

/** Highest level free road goes down on. */
export const MAX_LEVEL = 8
/** Ground a placed piece may overlap where it sets off and where it ends: what it joins. */
const ATTACH_FREE = 24
const LEVEL: RoadState = { bank: 0, grade: 0, halfWidth: ROAD.halfWidth, air: 0 }

interface PlacementCourse {
    draft: Ref<CustomTrack>
    ground: Ref<DraftGround>
    /** Per line, whether its end needs nothing more: a loop that closes, a branch on its join. */
    ended: Ref<readonly boolean[]>
    choice: Ref<Construction>
    full: Ref<boolean>
    appendTo: (line: number, id: SectionId) => void
    extendLoose: (k: number, id: SectionId) => void
    placeLoose: (r: LooseRoad) => void
}

/** Building with the mouse: the spot under the pointer, what a click there would lay and whether it may. */
export function useNitroRushPlacement({ draft, ground, ended, choice, full, appendTo, extendLoose, placeLoose }: PlacementCourse) {
    /** The pointer on the ground, in metres, and whether it's over road, where only an end it's near builds; null off the view. */
    const hover = ref<{ x: number, z: number, onRoad: boolean } | null>(null)
    /** Quarter turns right that free road sets off at, and how many levels up it goes down. */
    const quarters = ref(0)
    const level = ref(0)

    const sockets = computed(() => [
        ...ground.value.lines.flatMap((w, line): PlaceTarget[] => ended.value[line] ? [] : [{ kind: 'line', line, end: endOf(w) }]),
        ...ground.value.loose.map((w, k): PlaceTarget => ({ kind: 'loose', k, end: endOf(w) }))
    ])

    const target = computed<PlaceTarget | null>(() => {
        const h = hover.value
        if (!h) return null
        let best: PlaceTarget | null = null
        let bestD = SNAP_RADIUS
        for (const s of sockets.value) {
            if (s.kind === 'free') continue
            const { x, z, heading } = s.end
            // Just past an end counts as on it: that's where the next piece goes.
            const d = Math.min(Math.hypot(h.x - x, h.z - z), Math.hypot(h.x - x - Math.sin(heading) * 12, h.z - z + Math.cos(heading) * 12))
            if (d < bestD) {
                best = s
                bestD = d
            }
        }
        if (best || h.onRoad) return best
        return { kind: 'free', x: Math.round(h.x / GRID) * GRID, z: Math.round(h.z / GRID) * GRID }
    })

    const state = computed(() => {
        const t = target.value
        return !t || t.kind === 'free' ? LEVEL : t.end.state
    })
    const next = computed(() => nextSection(choice.value, state.value))

    /** Free road: its start, and the height it's drawn at. */
    const freeRoad = computed(() => {
        const t = target.value
        if (t?.kind !== 'free') return null
        const r: LooseRoad = { x: t.x, z: t.z, eighths: quarters.value * 2, y: 0, sections: [next.value] }
        const walk = walkLoose(r)
        const drawnAt = level.value * LEVEL_HEIGHT + walk.rise
        return { road: { ...r, y: Math.round((drawnAt - ground.value.rise) * 1e4) / 1e4 }, walk: startingAt(walk, drawnAt) }
    })

    const ghost = computed<LayoutWalk | null>(() => {
        const t = target.value
        if (!t || full.value) return null
        const id = next.value
        if (t.kind === 'free') return freeRoad.value?.walk ?? null
        if (t.kind === 'line') {
            const walk = walkForks(withLineSections(draft.value, t.line, [...lineSections(draft.value, t.line), id])).walks[t.line]!
            return startingAt(lastPieceWalk(walk), t.end.y)
        }
        const r = draft.value.loose?.[t.k]
        return r ? startingAt(lastPieceWalk(walkLoose({ ...r, sections: [...r.sections, id] })), t.end.y) : null
    })

    const laid = computed(() => new LaidRoad([...ground.value.lines, ...ground.value.loose]))
    /** Forks only go on the course itself. */
    const forked = computed(() => /^(split|join)-/.test(next.value) && target.value?.kind !== 'line')
    const fault = computed(() => forked.value ? 'forks go on the course\'s own road' : sectionFault(next.value, state.value))
    const blocked = computed(() => {
        const g = ghost.value
        if (!g) return false
        return laid.value.clashes(g, target.value?.kind === 'free' ? 0 : ATTACH_FREE, ATTACH_FREE)
    })

    function place() {
        const t = target.value
        if (!t || full.value || blocked.value || fault.value) return false
        if (t.kind === 'line') appendTo(t.line, next.value)
        else if (t.kind === 'loose') extendLoose(t.k, next.value)
        else if (freeRoad.value) placeLoose(freeRoad.value.road)
        return true
    }

    function turn(by: number) {
        quarters.value = (((quarters.value + by) % 4) + 4) % 4
    }

    function raise(by: number) {
        level.value = Math.max(0, Math.min(MAX_LEVEL, level.value + by))
    }

    return { hover, quarters, level, target, next, ghost, blocked, fault, place, turn, raise }
}
