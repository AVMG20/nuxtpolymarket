import { computed, ref, watch, type Ref } from 'vue'
import { nextSection, stateAfter, stepsFor, type Construction } from '#shared/utils/nitro-rush/construct'
import { lastPieceWalk, raisedTo, type SectionId } from '#shared/utils/nitro-rush/custom'
import { lastPieceClashes } from '#shared/utils/nitro-rush/road-checks'
import { ROAD } from '#shared/utils/nitro-rush/tracks'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'

/** What construction needs of the course being built. */
interface ConstructionCourse {
    cursor: Ref<number>
    walk: Ref<LayoutWalk>
    closed: Ref<boolean>
    full: Ref<boolean>
    walkUpTo: (id: SectionId) => LayoutWalk
    insert: (id: SectionId) => void
}

/** Building a piece at a time: the controls' settings, the section they'd lay next, its ghost and whether it may be built. */
export function useNitroRushConstruction({ cursor, walk, closed, full, walkUpTo, insert }: ConstructionCourse) {
    const choice = ref<Construction>({ curve: 'straight', size: 'medium', length: 60, slope: 'slope-flat', bank: 'bank-flat' })
    const state = computed(() => stateAfter(walk.value, cursor.value))
    const next = computed(() => nextSection(choice.value, state.value))
    const withNext = computed(() => full.value ? null : walkUpTo(next.value))
    // A ghost that digs deeper lifts the whole road, so the road shows that lift along with it.
    const rise = computed(() => Math.max(walk.value.rise, withNext.value?.rise ?? 0))
    const shownWalk = computed(() => raisedTo(walk.value, rise.value))
    const ghost = computed(() => withNext.value && lastPieceWalk(raisedTo(withNext.value, rise.value)))
    const blocked = computed(() => !!withNext.value && lastPieceClashes(withNext.value, closed.value, ROAD.wallOffset))

    let building = false

    // Moving along the road, or undoing, the controls read what's there; synchronous so `building` covers only a build.
    watch([cursor, () => state.value.bank, () => state.value.grade], () => {
        if (!building) choice.value = { ...choice.value, ...stepsFor(state.value) }
    }, { immediate: true, flush: 'sync' })

    function pick(change: Partial<Construction>) {
        choice.value = { ...choice.value, ...change }
    }

    /** Lays the next section; a second change still asked for stays asked for. */
    function build() {
        if (blocked.value) return
        building = true
        insert(next.value)
        building = false
    }

    return { choice, next, shownWalk, ghost, blocked, pick, build }
}
