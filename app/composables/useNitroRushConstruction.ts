import { computed, ref, watch, type Ref } from 'vue'
import { nextSection, stateAfter, stepsFor, type Construction } from '#shared/utils/nitro-rush/construct'
import { lastPieceWalk, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'

/** What construction needs of the course being built. */
interface ConstructionCourse {
    cursor: Ref<number>
    walk: Ref<LayoutWalk>
    full: Ref<boolean>
    walkUpTo: (id: SectionId) => LayoutWalk
    insert: (id: SectionId) => void
}

/** Building a piece at a time: the controls' settings, the section they'd lay next and its ghost while `active`. */
export function useNitroRushConstruction({ cursor, walk, full, walkUpTo, insert }: ConstructionCourse, active: Ref<boolean>) {
    const choice = ref<Construction>({ curve: 'straight', size: 'medium', length: 60, slope: 'slope-flat', bank: 'bank-flat' })
    const state = computed(() => stateAfter(walk.value, cursor.value))
    const next = computed(() => nextSection(choice.value, state.value))
    const ghost = computed(() => active.value && !full.value ? lastPieceWalk(walkUpTo(next.value)) : null)

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
        building = true
        insert(next.value)
        building = false
    }

    return { choice, next, ghost, pick, build }
}
