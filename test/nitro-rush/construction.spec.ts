import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useNitroRushConstruction } from '../../app/composables/useNitroRushConstruction'
import { walkCustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'

function construct(sections: SectionId[], full = false, closed = false) {
    const laid = ref(sections)
    const cursor = ref(sections.length - 1)
    const walkOf = (s: SectionId[]) => walkCustomTrack({ id: 'custom-t', name: 'T', closed, sections: s })
    const insert = (id: SectionId) => {
        laid.value = [...laid.value.slice(0, cursor.value + 1), id, ...laid.value.slice(cursor.value + 1)]
        cursor.value++
    }
    const course = {
        cursor,
        walk: computed(() => walkOf(laid.value)),
        closed: ref(closed),
        full: ref(full),
        walkUpTo: (id: SectionId) => walkOf([...laid.value.slice(0, cursor.value + 1), id]),
        insert
    }
    return { laid, cursor, ...useNitroRushConstruction(course) }
}

describe('building a piece at a time', () => {
    it('shows a ghost that digs deeper on the same ground as the road it lifts', () => {
        const c = construct(['start', 'straight-20'])
        c.pick({ slope: 'slope-down-steep' })
        const { rise, ys, end } = c.shownWalk.value
        expect(rise).toBeGreaterThan(0)
        expect(ys[0]).toBeCloseTo(rise)
        expect(c.ghost.value!.ys[0]).toBeCloseTo(end.y)
        expect(Math.min(...c.ghost.value!.ys, c.ghost.value!.end.y)).toBeCloseTo(0)
    })

    it('shows the road as it is when the ghost doesn\'t dig any deeper', () => {
        const c = construct(['start', 'straight-20'])
        expect(c.shownWalk.value.rise).toBe(0)
        expect(c.ghost.value!.rise).toBe(0)
    })

    it('blocks a piece that runs into other road, and builds nothing', () => {
        // Back round to cross its own road at the same height.
        const c = construct(['start', 'straight-100', 'right-tight', 'right-tight', 'straight-60', 'right-tight'])
        c.pick({ curve: 'straight', length: 60 })
        expect(c.blocked.value).toBe(true)
        const laid = c.laid.value
        c.build()
        expect(c.laid.value).toBe(laid)
    })

    it('blocks a crossing just past the start of an unfinished loop, which is no join', () => {
        const c = construct(['start', 'left-tight', 'left-hairpin', 'straight-10', 'left-tight'], false, true)
        c.pick({ curve: 'straight', length: 10 })
        expect(c.next.value).toBe('straight-10')
        expect(c.blocked.value).toBe(true)
    })

    it('lets the same crossing through once it passes high enough over', () => {
        const flat = construct(['start', 'straight-100', 'right-tight', 'right-tight', 'straight-60', 'right-tight'])
        flat.pick({ curve: 'straight', length: 60 })
        expect(flat.blocked.value).toBe(true)
        const c = construct(['start', 'straight-100', 'slope-up-steep', 'right-tight', 'right-tight', 'straight-60', 'right-tight'])
        c.pick({ curve: 'straight', length: 60 })
        expect(c.blocked.value).toBe(false)
    })

    it('doesn\'t block an open road or the last run into a loop\'s own start', () => {
        expect(construct(['start', 'straight-100']).blocked.value).toBe(false)
        const home: SectionId[] = ['start', 'straight-100', 'right-tight', 'straight-60', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'straight-60']
        const c = construct(home, false, true)
        c.pick({ curve: 'right-90', size: 'tight' })
        expect(c.next.value).toBe('right-tight')
        expect(c.blocked.value).toBe(false)
    })

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

    it('has no ghost once the course is full', () => {
        expect(construct(['straight-20'], true).ghost.value).toBeNull()
    })
})
