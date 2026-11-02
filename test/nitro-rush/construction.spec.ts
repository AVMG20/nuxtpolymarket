import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useNitroRushConstruction } from '../../app/composables/useNitroRushConstruction'
import { walkCustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'

function construct(sections: SectionId[], active = true) {
    const laid = ref(sections)
    const cursor = ref(sections.length - 1)
    const walkOf = (s: SectionId[]) => walkCustomTrack({ id: 'custom-t', name: 'T', closed: false, sections: s })
    const insert = (id: SectionId) => {
        laid.value = [...laid.value.slice(0, cursor.value + 1), id, ...laid.value.slice(cursor.value + 1)]
        cursor.value++
    }
    const course = {
        cursor,
        walk: computed(() => walkOf(laid.value)),
        full: ref(false),
        walkUpTo: (id: SectionId) => walkOf([...laid.value.slice(0, cursor.value + 1), id]),
        insert
    }
    return { laid, cursor, ...useNitroRushConstruction(course, ref(active)) }
}

describe('building a piece at a time', () => {
    it('keeps a second change asked for while the first is built', () => {
        const c = construct(['straight-20'])
        c.pick({ slope: 'slope-up', bank: 'bank-right', curve: 'right-90' })
        c.build()
        expect(c.laid.value.at(-1)).toBe('slope-up')
        expect(c.choice.value.bank).toBe('bank-right')
        expect(c.next.value).toBe('bank-right')
        c.build()
        expect(c.next.value).toBe('right-medium')
    })

    it('reads the road when the cursor moves or a build is undone', () => {
        const c = construct(['straight-20', 'slope-up', 'straight-20', 'slope-flat'])
        expect(c.choice.value.slope).toBe('slope-flat')
        c.cursor.value = 1
        expect(c.choice.value.slope).toBe('slope-up')
        c.cursor.value = 3
        c.pick({ slope: 'slope-up-steep' })
        c.build()
        expect(c.choice.value.slope).toBe('slope-up-steep')
        c.laid.value = c.laid.value.slice(0, -1)
        c.cursor.value--
        expect(c.choice.value.slope).toBe('slope-flat')
    })

    it('ghosts the next piece where it goes in, ending the way that piece ends', () => {
        const c = construct(['straight-20', 'straight-60', 'right-tight'])
        c.cursor.value = 0
        const ghost = c.ghost.value!
        expect(ghost.pts[0]![1]).toBeCloseTo(-20)
        expect(ghost.end.z).toBeCloseTo(-80)
        expect(ghost.end.heading).toBeCloseTo(0)
    })

    it('has no ghost unless building', () => {
        expect(construct(['straight-20'], false).ghost.value).toBeNull()
    })
})
