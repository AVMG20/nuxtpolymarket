/**
 * The wiki glossary (session-1 playtest, finding 6).
 *
 * The wiki's whole claim is that **it cannot go stale**: prose describes shape, and every number
 * is interpolated from `constants.ts`. That claim is only as good as the next person who edits a
 * formula string, and typing `1%` instead of `${CRIT_CHANCE_PER_POINT * 100}%` would look
 * identical on screen the day it was written and be silently wrong after the tuning pass.
 *
 * So these specs check the formulas against the live constants. If a constant moves and a
 * formula does not move with it, this fails — which is the only way the "cannot go stale"
 * property is actually enforced rather than merely intended.
 *
 * The content-reference half of the wiki needs no spec here: it is a `v-for` over the content
 * modules, and `content.spec.ts` already owns those rosters' invariants.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
    HQ_CURRENCY_DOCS,
    HQ_POWER_DOC,
    HQ_SCREEN_DOCS,
    HQ_STAT_DOCS,
    HQ_STAT_DOC_BY_KEY,
    hqFeatureUnlockText,
    hqScreenUnlockText,
    hqScreenWikiPath
} from '../../app/utils/hero-quest-wiki'
import { HQ_MENU_SCENES } from '../../app/utils/hero-quest-scenes'
import { HQ_FEATURES, checkpointLabel, featureCheckpoint } from '../../shared/utils/hero-quest/tutorials'
import {
    BASE_HP,
    CRIT_CHANCE_PER_POINT,
    CRIT_DAMAGE_PER_POINT,
    EHP_DEF_CONSTANT,
    HP_PER_VIT,
    K,
    MAX_EVASION,
    MIN_DAMAGE
} from '../../shared/utils/hero-quest/constants'
import type { HqStatKey } from '../../shared/utils/hero-quest/types'

const STAT_KEYS: readonly HqStatKey[] = ['pwr', 'spd', 'lck', 'imp', 'vit', 'def']

describe('the stat glossary', () => {
    it('covers all six stats, exactly once each', () => {
        // A missing entry is a tooltip that renders nothing on the battle screen, because
        // `index.vue` indexes straight into this map.
        expect(HQ_STAT_DOCS).toHaveLength(STAT_KEYS.length)
        for (const key of STAT_KEYS) {
            expect(HQ_STAT_DOC_BY_KEY[key], key).toBeDefined()
        }
        expect(new Set(HQ_STAT_DOCS.map(doc => doc.key)).size).toBe(STAT_KEYS.length)
    })

    it('gives every stat a name, a tooltip line and a detail paragraph', () => {
        for (const doc of HQ_STAT_DOCS) {
            expect(doc.name.length, doc.key).toBeGreaterThan(0)
            expect(doc.short.length, doc.key).toBeGreaterThan(0)
            // The tooltip line has to fit in a popover; the detail is what the wiki page prints.
            expect(doc.short.length, doc.key).toBeLessThan(120)
            expect(doc.detail.length, doc.key).toBeGreaterThan(doc.short.length)
        }
    })

    it('keeps numbers out of the tooltip prose', () => {
        // Prose describes shape, formulas carry magnitudes. A number in `short` is a number that
        // no constant change can reach, which is exactly the staleness this split prevents.
        for (const doc of HQ_STAT_DOCS) {
            expect(doc.short, `${doc.key}: ${doc.short}`).not.toMatch(/\d/)
        }
    })
})

describe('formulas track the live constants', () => {
    /**
     * Each case names a constant and the doc whose formula must quote it. If someone replaces an
     * interpolation with a literal, the literal stops matching the moment the constant moves.
     *
     * The expected substring carries **surrounding context**, not the bare value, and that is
     * load-bearing rather than tidiness: `MIN_DAMAGE` is currently `1`, and every one of these
     * formulas already contains a `1` somewhere (`100%`, `(1 − mitigation)`). Asserting on the
     * digit alone would pass no matter what the formula said.
     */
    const cases: readonly { key: HqStatKey; label: string; value: string }[] = [
        { key: 'vit', label: 'BASE_HP', value: `= ${BASE_HP.toLocaleString('en-US')} +` },
        { key: 'vit', label: 'HP_PER_VIT', value: `VIT × ${HP_PER_VIT}` },
        { key: 'def', label: 'K', value: `PWR × ${K})` },
        { key: 'def', label: 'MIN_DAMAGE', value: `deals ${MIN_DAMAGE}` },
        { key: 'pwr', label: 'MIN_DAMAGE', value: `never below ${MIN_DAMAGE}` },
        { key: 'lck', label: 'CRIT_CHANCE_PER_POINT', value: `LCK × ${CRIT_CHANCE_PER_POINT * 100}%` },
        { key: 'imp', label: 'CRIT_DAMAGE_PER_POINT', value: `IMP × ${CRIT_DAMAGE_PER_POINT * 100}%` }
    ]

    it.each(cases)('$key quotes $label', ({ key, value }) => {
        expect(HQ_STAT_DOC_BY_KEY[key]!.formula).toContain(value)
    })

    it('gives every stat a formula, not just the ones checked above', () => {
        for (const doc of HQ_STAT_DOCS) {
            expect(doc.formula.length, doc.key).toBeGreaterThan(0)
            // Every rule states a magnitude somewhere; a formula with no digits is prose that
            // wandered into the wrong field.
            expect(doc.formula, doc.key).toMatch(/\d/)
        }
    })
})

describe('the Global Power entry', () => {
    it('quotes the live EHP constant and evasion cap', () => {
        expect(HQ_POWER_DOC.formula).toContain(`DEF ÷ ${EHP_DEF_CONSTANT})`)
        expect(HQ_POWER_DOC.formula).toContain(`at most ${MAX_EVASION * 100}%`)
    })

    it('keeps numbers out of the tooltip line, like the stats', () => {
        expect(HQ_POWER_DOC.short).not.toMatch(/\d/)
        expect(HQ_POWER_DOC.short.length).toBeLessThan(120)
    })
})

describe('the currency list', () => {
    it('lists Raid Keys and Arena Medals as live now that both systems ship', () => {
        // They were marked unbuilt while Raids and the Arena were still to come; a wiki that keeps
        // saying so sends players away from two screens they can open.
        for (const name of ['Raid Keys', 'Arena Medals']) {
            expect(HQ_CURRENCY_DOCS.find(currency => currency.name === name)?.live, name).toBe(true)
        }
    })

    it('describes a source and a sink for everything it lists', () => {
        for (const currency of HQ_CURRENCY_DOCS) {
            expect(currency.source.length, currency.name).toBeGreaterThan(0)
            expect(currency.sink.length, currency.name).toBeGreaterThan(0)
        }
    })

    it('flags exactly the two platform-shared balances', () => {
        // Gold and Gems are spent across every game here, and a player who does not know that can
        // drain a balance another game was holding.
        const shared = HQ_CURRENCY_DOCS.filter(currency => currency.shared).map(c => c.name)
        expect(shared).toEqual(['Gold', 'Gems'])
    })

    it('has no duplicate entries', () => {
        const names = HQ_CURRENCY_DOCS.map(currency => currency.name)
        expect(new Set(names).size).toBe(names.length)
    })
})

describe('the screen articles', () => {
    const pagesDir = fileURLToPath(new URL('../../app/pages', import.meta.url))

    it('covers the battle stage and every menu scene, in the menu band\'s order', () => {
        // Issue #28: every menu screen gets an article. A scene added to the band without one
        // fails here (and in the typecheck, which keys the article list by scene).
        expect(HQ_SCREEN_DOCS.map(doc => doc.id)).toEqual(['battle', ...HQ_MENU_SCENES])
    })

    it('has a page behind every article link', () => {
        for (const doc of HQ_SCREEN_DOCS) {
            const page = `${pagesDir}${hqScreenWikiPath(doc.id)}.vue`
            expect(existsSync(page), page).toBe(true)
        }
    })

    it('states each unlock from the live schedule', () => {
        for (const feature of HQ_FEATURES) {
            const at = featureCheckpoint(feature)
            const text = hqFeatureUnlockText(feature)
            if (at.kind === 'start') expect(text, feature).toBe('Open from the start.')
            else expect(text, feature).toContain(checkpointLabel(at))
        }
        expect(hqScreenUnlockText('battle')).toBe('Open from the start.')
        expect(hqScreenUnlockText('settings')).toBe('Open from the start.')
    })
})
