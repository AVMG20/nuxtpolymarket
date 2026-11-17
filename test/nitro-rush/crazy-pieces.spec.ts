import { describe, expect, it } from 'vitest'
import { drive, trackOf } from './bot-lap'
import { compileCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'

const sprint = (...sections: SectionId[]): SectionId[] => ['straight-20', 'start', 'straight-100', ...sections, 'straight-200', 'finish', 'straight-200']
const course = (sections: SectionId[]): CustomTrack => ({ id: 'custom-test', name: 'Test', closed: false, sections })

describe('big stunt pieces', () => {
    it.each<[string, SectionId[]]>([
        ['a double spiral up and back down', ['left-double-spiral-up', 'straight-200', 'right-double-spiral-down']],
        ['a tall ramp up and down', ['tall-ramp-up', 'straight-100', 'tall-ramp-down']],
        ['a mega jump', ['jump-ramp-mega', 'empty-60', 'landing-ramp']],
        ['a big looping', ['looping-big-left', 'straight-100']]
    ])('lay %s', (_, pieces) => {
        expect(compileCustomTrack(course(sprint(...pieces))).error).toBeNull()
    })

    it.each<[string, SectionId[]]>([
        ['a mega jump', ['jump-ramp-mega', 'empty-60', 'landing-ramp']],
        ['a big looping', ['looping-big-right', 'straight-100']],
        ['a double spiral', ['right-double-spiral-up', 'straight-200', 'left-double-spiral-down']]
    ])('let the bot drive %s and the server take its lap', (_, pieces) => {
        const track = trackOf(false, sprint(...pieces))
        expect(ghostDrivesTrack(track, drive(track))).toBe(true)
    })
})
