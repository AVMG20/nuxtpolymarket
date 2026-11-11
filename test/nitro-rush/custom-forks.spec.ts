import { describe, expect, it } from 'vitest'
import { checkpointRoles } from '../../app/utils/nitro-rush/builder-forks'
import { compileCustomTrack, MAX_SECTIONS, sameRoad, sanitizeCustomTrack, sectionCount, sectionWalk, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { branchEnding, canJoin, draftForkedDef, insertSection, joinCandidates, moveSection, removeBranch, removeSection, sectionPartner, setJoin, walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { finishJoin, finishLoop } from '#shared/utils/nitro-rush/finish-loop'
import { Track } from '#shared/utils/nitro-rush/track'

/** A long oval whose first straight splits off to the left and joins back in from the left. */
const MAIN: SectionId[] = ['start', 'split-left', 'straight-200', 'join-left', 'straight-200', 'straight-100', 'straight-10', 'right-wide', 'straight-200', 'right-wide', 'straight-200', 'straight-200', 'straight-200', 'straight-20', 'right-wide', 'straight-200', 'right-wide']
/** Back alongside the road, then an eighth onto the join's diagonal, whose bend in fits the lane it lands on. */
const BOW: SectionId[] = ['right-eighth', 'straight-100', 'straight-20', 'right-eighth-tight']
const LOOP: CustomTrack = { id: 'custom-forks', name: 'Forks', closed: true, sections: MAIN, branches: [{ sections: BOW, from: { branch: 0, at: 1 }, to: { branch: 0, at: 3 } }] }

const withBranch = (t: CustomTrack, sections: SectionId[]): CustomTrack => ({ ...t, branches: [{ ...t.branches![0]!, sections }] })

/** Sprints whose branch has a finish line of its own, off one side and off a Y. */
const SPRINT: CustomTrack = {
    id: 'custom-sprint', name: 'Sprint', closed: false,
    sections: ['straight-20', 'start', 'split-right', 'straight-200', 'finish', 'straight-100'],
    branches: [{ sections: ['left-eighth', 'straight-200', 'finish', 'straight-100'], from: { branch: 0, at: 2 }, to: null }]
}
const Y_SPRINT: CustomTrack = {
    ...SPRINT,
    sections: ['straight-20', 'start', 'split-y', 'right-eighth', 'straight-200', 'finish', 'straight-100'],
    branches: [{ sections: ['left-eighth', 'straight-200', 'finish', 'straight-100'], from: { branch: 0, at: 2 }, to: null }]
}

describe('split and join sections', () => {
    it('compile a loop whose branch splits off and comes into a join', () => {
        const c = compileCustomTrack(LOOP)
        expect(c.error).toBeNull()
        expect(new Track(c.def!).routes).toHaveLength(2)
    })

    it('compile sprints whose branch has its own finish, off one side or a Y', () => {
        expect(compileCustomTrack(SPRINT).error).toBeNull()
        expect(compileCustomTrack(Y_SPRINT).error).toBeNull()
    })

    it('name the branch that is still empty, and a join nothing comes into', () => {
        expect(compileCustomTrack(withBranch(LOOP, [])).error).toBe('branch 1 is empty')
        expect(compileCustomTrack(setJoin(LOOP, 1, null)).error).toMatch(/no road comes into the join on the main road/)
    })

    it('won\'t let a sprint\'s branch race past a join it heads for to a finish of its own', () => {
        const t: CustomTrack = {
            ...SPRINT,
            sections: ['straight-20', 'start', 'split-right', 'straight-200', 'join-left', 'straight-200', 'finish', 'straight-100'],
            branches: [{ ...SPRINT.branches![0]!, to: { branch: 0, at: 4 } }]
        }
        expect(compileCustomTrack(t).error).toBe('branch 1 doesn\'t reach its join')
    })

    it('compile a loop whose branch spans the end of the main road\'s sections, with the start line after it', () => {
        const sections: SectionId[] = [...MAIN.slice(2), 'start', 'split-left']
        const t: CustomTrack = { ...LOOP, sections, branches: [{ sections: BOW, from: { branch: 0, at: sections.length - 1 }, to: { branch: 0, at: 1 } }] }
        expect(compileCustomTrack(t).error).toBeNull()
        const forks = walkForks(t)
        const draft = draftForkedDef(t, forks, true)
        expect(draft?.def.branches).toHaveLength(1)
        // The drawn main line begins at the start line's section, as the compiled loop does.
        const main = forks.walks[0]!
        expect(draft!.shift).toBe(main.pieceStarts[sections.indexOf('start')])
        expect(draft!.def.points[0]).toEqual(main.pts[draft!.shift])
    })

    it('count every line towards the section cap', () => {
        expect(sectionCount(LOOP)).toBe(MAIN.length + BOW.length)
    })

    it('show the second road on their own card: an arm peeling off, or a road bending in to meet the section\'s end', () => {
        const arm = sectionPartner('split-right')!
        expect(arm.end.heading).toBeCloseTo(Math.PI / 4)
        const inlet = sectionPartner('join-left')!
        const own = sectionWalk('join-left').end
        expect(Math.hypot(inlet.end.x - own.x, inlet.end.z - own.z)).toBeLessThan(0.01)
        expect(inlet.end.heading).toBeCloseTo(own.heading)
        expect(sectionPartner('straight-20')).toBeNull()
    })
})

describe('storing a forked course', () => {
    it('keeps its branches through sanitize', () => {
        expect(sanitizeCustomTrack(JSON.parse(JSON.stringify(LOOP)))).toEqual(LOOP)
    })

    it('reads a course without branches as a single road', () => {
        const { branches: _, ...plain } = LOOP
        const straight = { ...plain, sections: MAIN.filter(id => !id.startsWith('split') && !id.startsWith('join')) }
        expect(sanitizeCustomTrack(straight)?.branches).toBeUndefined()
        expect(sanitizeCustomTrack({ ...straight, branches: [] })?.branches).toBeUndefined()
    })

    it('rejects a split without its branch, and spots that aren\'t on a split or join', () => {
        const { branches: _, ...plain } = LOOP
        expect(sanitizeCustomTrack(plain)).toBeNull()
        const bad = (b: object) => sanitizeCustomTrack({ ...LOOP, branches: [{ ...LOOP.branches![0]!, ...b }] })
        expect(bad({ from: { branch: 0, at: 2 } })).toBeNull()
        expect(bad({ to: { branch: 0, at: 1 } })).toBeNull()
        expect(bad({ to: { branch: 1, at: 0 } })).toBeNull()
        expect(bad({ sections: ['nope'] })).toBeNull()
    })

    it('rejects two branches coming into one join', () => {
        const t = { ...LOOP, sections: ['split-right', ...MAIN], branches: [{ ...LOOP.branches![0]!, from: { branch: 0, at: 2 }, to: { branch: 0, at: 4 } }, { sections: BOW, from: { branch: 0, at: 0 }, to: { branch: 0, at: 4 } }] }
        expect(sanitizeCustomTrack(t)).toBeNull()
    })

    it('rejects a course over the cap across all its lines', () => {
        const long = withBranch(LOOP, Array<SectionId>(MAX_SECTIONS - MAIN.length + 1).fill('straight-10'))
        expect(sanitizeCustomTrack(long)).toBeNull()
    })

    it('counts a branch built differently as a different road', () => {
        expect(sameRoad(LOOP, structuredClone(LOOP))).toBe(true)
        expect(sameRoad(LOOP, withBranch(LOOP, BOW.slice(0, -1)))).toBe(false)
    })
})

describe('editing a forked course', () => {
    it('opens a new branch with each split laid', () => {
        const t = insertSection(LOOP, 0, 5, 'split-y')
        expect(t.branches).toHaveLength(2)
        expect(t.branches![1]).toEqual({ sections: [], from: { branch: 0, at: 5 }, to: null })
        expect(t.branches![0]).toEqual(LOOP.branches![0])
    })

    it('moves splits and joins past a section put in or taken out before them', () => {
        const ins = insertSection(LOOP, 0, 1, 'straight-10')
        expect(ins.branches![0]!.from).toEqual({ branch: 0, at: 2 })
        expect(ins.branches![0]!.to).toEqual({ branch: 0, at: 4 })
        expect(removeSection(ins, 0, 1).branches).toEqual(LOOP.branches)
        expect(insertSection(LOOP, 1, 0, 'straight-10').branches![0]!.to).toEqual({ branch: 0, at: 3 })
    })

    it('keeps each split and join with its branch when sections move', () => {
        const moved = moveSection(LOOP, 0, 3, 5)
        expect(moved.sections[5]).toBe('join-left')
        expect(moved.branches![0]!.to).toEqual({ branch: 0, at: 5 })
        expect(moved.branches![0]!.from).toEqual({ branch: 0, at: 1 })
    })

    it('takes a split\'s branch, and every branch off it, away with it', () => {
        let t = insertSection(LOOP, 1, 1, 'split-left')
        t = insertSection(t, 0, 6, 'split-right')
        expect(t.branches).toHaveLength(3)
        const out = removeSection(t, 0, 1)
        expect(out.sections).not.toContain('split-left')
        expect(out.branches).toEqual([{ sections: [], from: { branch: 0, at: 5 }, to: null }])
        expect(removeBranch(out, 1).branches).toBeUndefined()
    })

    it('leaves the branch open when its join goes', () => {
        const out = removeSection(LOOP, 0, 3)
        expect(out.branches![0]!.to).toBeNull()
        expect(out.branches![0]!.from).toEqual({ branch: 0, at: 1 })
    })

    it('offers a join to open branches that aren\'t on its line or behind it', () => {
        const open = setJoin(LOOP, 1, null)
        expect(joinCandidates(open, { branch: 0, at: 3 })).toEqual([1])
        expect(joinCandidates(open, { branch: 1, at: 0 })).toEqual([])
        expect(joinCandidates(LOOP, { branch: 0, at: 3 })).toEqual([])
    })

    it('lets a branch head only for joins that keep every route running forward', () => {
        expect(canJoin(LOOP, 1, { branch: 0, at: 3 })).toBe(true)
        // A join before the branch's split would send it round again.
        const back: CustomTrack = { ...LOOP, sections: ['start', 'join-right', ...MAIN.slice(1)], branches: [{ ...LOOP.branches![0]!, from: { branch: 0, at: 2 }, to: { branch: 0, at: 4 } }] }
        expect(canJoin(back, 1, { branch: 0, at: 1 })).toBe(false)
        expect(canJoin(back, 1, { branch: 0, at: 4 })).toBe(true)
        // Not into its own line or a branch off it.
        const nested: CustomTrack = { ...LOOP, branches: [{ ...LOOP.branches![0]!, sections: ['split-y', ...BOW] }, { sections: ['straight-60', 'join-y'], from: { branch: 1, at: 0 }, to: null }] }
        expect(canJoin(nested, 1, { branch: 2, at: 1 })).toBe(false)
        expect(canJoin(nested, 2, { branch: 1, at: 0 })).toBe(false)
        // Two branches that each come into the other never get back to the start.
        const crossed: CustomTrack = {
            ...LOOP,
            sections: ['start', 'split-left', 'straight-200', 'split-right', 'straight-200', 'join-left', ...MAIN.slice(4)],
            branches: [
                { sections: ['straight-60', 'join-y', 'straight-60'], from: { branch: 0, at: 1 }, to: { branch: 2, at: 1 } },
                { sections: ['straight-60', 'join-y'], from: { branch: 0, at: 3 }, to: null }
            ]
        }
        expect(canJoin(crossed, 2, { branch: 1, at: 1 })).toBe(false)
        expect(canJoin(crossed, 2, { branch: 0, at: 5 })).toBe(true)
        expect(joinCandidates(crossed, { branch: 1, at: 1 })).toEqual([])
    })

    it('keeps a branch with its own finish out of every join', () => {
        const t: CustomTrack = { ...SPRINT, sections: [...SPRINT.sections.slice(0, 4), 'join-left', ...SPRINT.sections.slice(4)] }
        expect(canJoin(t, 1, { branch: 0, at: 4 })).toBe(false)
        expect(joinCandidates(t, { branch: 0, at: 4 })).toEqual([])
    })
})

describe('how a branch ends', () => {
    it('joins, falls short, finishes or is open', () => {
        expect(branchEnding(LOOP, walkForks(LOOP), 1).kind).toBe('joins')
        const short = withBranch(LOOP, BOW.slice(0, 2))
        const e = branchEnding(short, walkForks(short), 1)
        expect(e.kind).toBe('short')
        expect(e.kind === 'short' && e.metres).toBeGreaterThan(30)
        expect(branchEnding(SPRINT, walkForks(SPRINT), 1).kind).toBe('finish')
        const open = setJoin(LOOP, 1, null)
        expect(branchEnding(open, walkForks(open), 1).kind).toBe('open')
    })

    it('bends a branch on its join\'s diagonal in onto the join\'s end', () => {
        const forks = walkForks(LOOP)
        expect(forks.merged).toEqual([true])
        const main = forks.walks[0]!
        const end = main.pts[main.pieceStarts[4]!]!
        const { x, z } = forks.walks[1]!.end
        expect(Math.hypot(x - end[0], z - end[1])).toBeLessThan(0.01)
    })
})

describe('the bend into a join', () => {
    it('fits the lane a branch comes in on, off a tight eighth or a wide one', () => {
        for (const eighth of ['right-eighth-tight', 'right-eighth', 'right-eighth-wide'] as const) {
            const lanes = [0, 1, 2, 3, 4, 5, 6].filter((n) => {
                const t = withBranch(LOOP, ['right-eighth', 'straight-100', ...Array<SectionId>(n).fill('straight-10'), eighth])
                return walkForks(t).merged[0] && compileCustomTrack(t).error === null
            })
            expect(lanes.length, eighth).toBeGreaterThan(0)
        }
    })

    it('says when a branch on the diagonal has gone past its bend in', () => {
        const past = withBranch(LOOP, [...BOW, 'straight-100'])
        expect(branchEnding(past, walkForks(past), 1)).toMatchObject({ kind: 'askew', why: 'runs past its join\'s bend: shorten it' })
    })
})

describe('finishing a branch into its join', () => {
    it('lays road onto the inlet that compiles, from anywhere along the branch', () => {
        for (const cut of [0, 1, 2]) {
            const open = withBranch(LOOP, BOW.slice(0, cut))
            const { sections, error } = finishJoin(open, 1)
            expect(error).toBeNull()
            expect(compileCustomTrack(withBranch(open, [...BOW.slice(0, cut), ...sections!])).error).toBeNull()
        }
    })

    it('needs a join to aim for', () => {
        expect(finishJoin(setJoin(withBranch(LOOP, BOW.slice(0, 2)), 1, null), 1).error).toMatch(/join/)
    })

    it('still finishes the main loop round a split', () => {
        expect(finishLoop({ ...LOOP, sections: MAIN.slice(0, 12) }).error).toBeNull()
    })
})

describe('the builder view of forks', () => {
    it('draws a draft course with its fork opened once the branch comes in', () => {
        expect(draftForkedDef(LOOP, walkForks(LOOP), true)?.def.branches).toHaveLength(1)
        const short = withBranch(LOOP, BOW.slice(0, 2))
        expect(draftForkedDef(short, walkForks(short), true)).toBeNull()
    })

    it('marks a checkpoint on one branch of a fork as one of several, and one on shared road as required', () => {
        // A checkpoint lays as much road as the straight-20 it stands in for.
        const t: CustomTrack = {
            ...LOOP,
            sections: MAIN.map(id => id === 'straight-20' ? 'checkpoint' : id),
            branches: [{ ...LOOP.branches![0]!, sections: BOW.map((id, i) => i === 2 ? 'checkpoint' : id) }]
        }
        const c = compileCustomTrack(t)
        expect(c.error).toBeNull()
        const track = new Track(c.def!)
        const { walks } = walkForks(t)
        expect(checkpointRoles(track, walks[0]!, 0).get(MAIN.indexOf('straight-20'))).toBe('required')
        expect(checkpointRoles(track, walks[1]!, 1).get(2)).toBe('optional')
    })
})
