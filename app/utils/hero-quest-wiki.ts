import {
    BASE_ATTACK_INTERVAL_SECONDS,
    BASE_HP,
    CRIT_CHANCE_PER_POINT,
    CRIT_DAMAGE_PER_POINT,
    EHP_DEF_CONSTANT,
    GPN_DISPLAY_SCALE,
    HP_PER_VIT,
    K,
    MAX_EVASION,
    MIN_ATTACK_INTERVAL_SECONDS,
    MIN_COOLDOWN_SECONDS,
    MIN_DAMAGE,
    OVERFLOW_CONVERSION_RATE,
    SPD_ATTACK_RATE_PER_POINT
} from '#shared/utils/hero-quest/constants'
import { hqNumber, hqPct } from '#shared/utils/hero-quest/numbers'
import type { HqStatKey } from '#shared/utils/hero-quest/types'
import { checkpointLabel, featureCheckpoint, isHqFeature, type HqFeature } from '#shared/utils/hero-quest/tutorials'
import { RAIDS } from '#shared/utils/hero-quest/content/raids'
import { ARTIFACTS, ARTIFACT_EFFECT_POOL } from '#shared/utils/hero-quest/content/artifacts'
import { CHAMPIONS } from '#shared/utils/hero-quest/content/champions'
import { CLASS_NODES } from '#shared/utils/hero-quest/content/classes'
import { GEAR } from '#shared/utils/hero-quest/content/gear'
import { SKILLS } from '#shared/utils/hero-quest/content/skills'
import { WORLDS } from '#shared/utils/hero-quest/content/worlds'
import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import { HQ_MENU_SCENES, HQ_SCENE_LABELS, type HqMenuScene } from './hero-quest-scenes'

/**
 * The glossary the wiki and every info tooltip read from (session-1 playtest, finding 6:
 * "a new player currently has no idea what each skill or stat means").
 *
 * **One definition per concept, in one place.** A tooltip on the battle screen and a wiki entry
 * describing the same stat differently is worse than having neither, because the player cannot
 * tell which one is out of date. Both render from these tables.
 *
 * **Every number is interpolated from `constants.ts`, never typed out.** That is the whole
 * reason this is a module rather than prose in a template: constants move during tuning (many
 * are still `// UNTUNED ╧`), and a wiki that quietly keeps quoting the old value is worse than
 * no wiki. Prose describes *shape*; numbers come from the
 * source of truth or are not stated.
 *
 * What this cannot do is know *which* constants are still untuned — that lives in a comment, not
 * in a value. The wiki says so once, prominently, rather than pretending to a precision it
 * does not have.
 */

export interface HqStatDoc {
    key: HqStatKey
    /** Player-facing name. The three-letter key is what the UI has room for. */
    name: string
    /** One sentence, for a tooltip. No numbers — those go in `formula`. */
    short: string
    /** A paragraph for the wiki: what it does, and what it is worth caring about. */
    detail: string
    /** The actual rule, with live values. */
    formula: string
}

export const HQ_STAT_DOCS: readonly HqStatDoc[] = [
    {
        key: 'pwr',
        name: 'Power',
        short: 'How hard you hit, and how far through enemy armour you get.',
        detail: 'The damage number. Power does double duty in a party: each unit swings its own '
            + 'Power, but the party pools all of it to decide how much of the enemy\'s Defence it '
            + 'cuts through. A weak Champion therefore adds its own damage *and* thins the armour '
            + 'for everyone else, which is why filling a party slot is always worth something.',
        formula: `damage = PWR × (1 − mitigation) × ability multiplier, never below ${MIN_DAMAGE}`
    },
    {
        key: 'def',
        name: 'Defence',
        short: 'Cuts incoming damage, up to a hard ceiling.',
        detail: 'Defence is a clamped ratio against the attacker\'s Power, not a curve that '
            + 'approaches immunity. Once your Defence reaches K times the attacker\'s Power, '
            + 'mitigation is exactly 100% — and even then damage does not reach zero, it floors. '
            + 'Nothing in the game is unkillable by armour alone.',
        formula: `mitigation = min(100%, DEF ÷ (attacker PWR × ${K})); a fully mitigated hit still deals ${MIN_DAMAGE}`
    },
    {
        key: 'vit',
        name: 'Vitality',
        short: 'Your health pool.',
        detail: 'The only source of HP. Everyone starts with a flat base regardless of build, so '
            + 'Vitality is what separates a body that survives a boss opener from one that does '
            + 'not — it is not what keeps you alive against a wall you have already out-scaled.',
        formula: `HP = ${BASE_HP.toLocaleString('en-US')} + VIT × ${HP_PER_VIT}`
    },
    {
        key: 'spd',
        name: 'Speed',
        short: 'Attack rate and skill cooldowns — one stat, both jobs.',
        detail: 'Speed shortens the gap between basic attacks and shortens every skill cooldown, '
            + 'on the same curve. Levelling up speeds up basic attacks only: cooldowns count just '
            + 'the Speed from your class, gear, skills, artifacts and buffs. Rarer skills and '
            + 'deeper classes have longer cooldowns and hit proportionally harder.',
        formula: `attack every ${BASE_ATTACK_INTERVAL_SECONDS}s ÷ (1 + SPD × ${SPD_ATTACK_RATE_PER_POINT}), `
            + `floored at ${hqNumber(MIN_ATTACK_INTERVAL_SECONDS)}s; cooldowns use the same divisor without level growth, floored at ${MIN_COOLDOWN_SECONDS}s`
    },
    {
        key: 'lck',
        name: 'Luck',
        short: 'Crit chance — and once that caps, crit damage.',
        detail: 'Luck converts linearly into crit chance until it hits 100%. Past that it is not '
            + 'wasted: the surplus overflows into bonus crit damage at a much lower rate. That '
            + 'makes Luck the one stat with no dead zone, but the conversion past the cap is poor '
            + 'enough that piling into it is rarely the best use of a slot.',
        formula: `crit chance = min(100%, LCK × ${hqPct(CRIT_CHANCE_PER_POINT)}); `
            + `every point past the cap adds ${hqPct(OVERFLOW_CONVERSION_RATE)} crit damage`
    },
    {
        key: 'imp',
        name: 'Impact',
        short: 'How much a critical hit is worth.',
        detail: 'Impact does nothing on its own — it multiplies critical hits only. It is the '
            + 'partner stat to Luck, and stacking it without the Luck to land crits is the most '
            + 'common way to build a character that reads strong and hits weak.',
        formula: `crit multiplier = 1 + IMP × ${hqPct(CRIT_DAMAGE_PER_POINT)} (+ Luck overflow)`
    }
]

export const HQ_STAT_DOC_BY_KEY: Readonly<Record<string, HqStatDoc>> = Object.fromEntries(
    HQ_STAT_DOCS.map(doc => [doc.key, doc])
)

/**
 * The Global Power Number (`global-power-number.md`) — one glossary entry, read by the battle
 * screen's tooltip and the wiki's Combat page, on the same one-definition rule as the stats.
 */
export const HQ_POWER_DOC = {
    name: 'Global Power',
    short: 'Your whole fielded party\'s strength, as one number.',
    detail: 'Global Power reads the real stats your party fights with — damage per second and '
        + 'effective health — and combines them. Everything that makes the party stronger moves '
        + 'it: levels, Champions fielded and owned, equipped and collected Gear, Skills and '
        + 'Artifacts. It is a live reading, so benching a strong Champion or unequipping an '
        + 'Artifact lowers it. Because the two multiply, a party that is all damage and no '
        + 'health — or the reverse — scores lower than a balanced one with the same totals.',
    formula: `power = √(party DPS × party effective HP) × ${GPN_DISPLAY_SCALE}; `
        + `effective HP = HP × (1 + DEF ÷ ${EHP_DEF_CONSTANT}) ÷ (1 − evasion, at most ${hqPct(MAX_EVASION)})`
} as const

/**
 * Currencies, and — deliberately — which of them this build actually has.
 *
 * Some currencies (`economy-and-currencies.md`) belong to systems a build may not have yet. A wiki that describes all eleven as
 * though they work is a wiki that sends players hunting for a currency they cannot earn, so the
 * unbuilt ones are listed and marked rather than hidden — a player who reads about Raids in a
 * design doc should find out here that they are not in yet.
 */
export interface HqCurrencyDoc {
    name: string
    /** Where it comes from. */
    source: string
    /** What it is for. */
    sink: string
    /** False for currencies whose system ships in a later phase. */
    live: boolean
    /** True when the balance is shared with every other game on the platform. */
    shared?: boolean
}

export const HQ_CURRENCY_DOCS: readonly HqCurrencyDoc[] = [
    {
        name: 'Gold',
        source: 'Every kill, at a rate set by how deep the run is.',
        sink: 'Buying extra Seals, on a price ladder that resets daily.',
        live: true,
        shared: true
    },
    {
        name: 'Gems',
        source: 'Milestones, the login calendar, holiday gifts and the Arena shop. Shared with the rest of the platform.',
        sink: 'Battle Speed, extra Loadout and Trait save slots, Passive Tree respecs, and extra Arena attacks and refreshes.',
        live: true,
        shared: true
    },
    {
        name: 'Void Shards',
        source: 'Prestige, and nothing else — a full clear of World 10, Stage 10.',
        sink: 'The prestige shop: offline time, party slots, skill slots, artifact slots.',
        live: true
    },
    {
        name: 'Seals (four kinds)',
        source: 'Boss and world-clear milestones, prestige, or bought with Gold.',
        sink: 'Pulls. Each gacha has its own Seal and they are never interchangeable.',
        live: true
    },
    {
        name: 'Essence (four kinds)',
        source: 'Duplicates of a copy that is already fully maxed. There is no other source.',
        sink: 'Crafting one specific item outright — the way past bad luck.',
        live: true
    },
    {
        name: 'Trait Gems',
        source: 'Shardcaller Beast, the Trait Raid, and some login-calendar days.',
        sink: 'Rolling Traits, and storing or loading a Trait board.',
        live: true
    },
    {
        name: 'Raid Keys',
        source: 'A daily allowance per raid, Milestones, the login calendar and the Arena shop.',
        sink: 'Raid rewards: one Key per reward paid.',
        live: true
    },
    {
        name: 'Arena Medals',
        source: 'Every Arena attack (a win pays more), season rewards and Milestones.',
        sink: 'The Arena shop: Seals, raid Keys and Gems.',
        live: true
    }
]

/**
 * The screens: one wiki article per menu scene, plus the battle stage they open over (issue #28).
 *
 * Keyed by scene, so a scene added to `HQ_MENU_SCENES` without an article fails the typecheck, and
 * listed in the menu band's own order. The label is the scene's own (`HQ_SCENE_LABELS`) and the
 * unlock line is read from `FEATURE_UNLOCKS`, so neither can disagree with the game.
 */
export type HqScreenId = 'battle' | HqMenuScene

export interface HqScreenDoc {
    id: HqScreenId
    label: string
    /** The wiki's icon for it. The game's own button is pixel art, described in `button`. */
    icon: string
    /** What its menu button shows. */
    button: string
    /** One line: what the screen is for. */
    summary: string
}

const SCREEN_INFO: Readonly<Record<HqScreenId, Omit<HqScreenDoc, 'id' | 'label'>>> = {
    battle: {
        icon: 'i-lucide-swords',
        button: 'No button: it is what shows when every other screen is closed.',
        summary: 'The run itself: your party fighting, the boss gate, the Gold chest and the menu.'
    },
    gacha: {
        icon: 'i-lucide-dices',
        button: 'A gumball machine.',
        summary: 'Four banners that turn Seals into Gear, Champions, Skills and Artifacts.'
    },
    collections: {
        icon: 'i-lucide-book-open',
        button: 'A red book.',
        summary: 'Everything you own: equip it, field it, and craft what you are missing.'
    },
    loadouts: {
        icon: 'i-lucide-save',
        button: 'A sword behind a blue kite shield.',
        summary: 'Saved setups of party, formation, Skills, Artifacts and Gear, swapped in one press.'
    },
    raids: {
        icon: 'i-lucide-flag',
        button: 'A red war banner.',
        summary: 'Five raid bosses that pay Seals and Trait Gems for Keys.'
    },
    traits: {
        icon: 'i-lucide-gem',
        button: 'A purple Trait Gem.',
        summary: 'Five rolled bonuses for the whole party, paid for in Trait Gems.'
    },
    arena: {
        icon: 'i-lucide-medal',
        button: 'A gold Arena Medal on a ribbon.',
        summary: 'Fight other players\' defences for Rating and Medals.'
    },
    classes: {
        icon: 'i-lucide-git-fork',
        button: 'A small tree of coloured nodes.',
        summary: 'The class tree: spend the token each prestige grants to go one class deeper.'
    },
    tree: {
        icon: 'i-lucide-network',
        button: 'A gold root with red, blue and green spokes.',
        summary: 'Spend a point per Hero level on permanent passive bonuses.'
    },
    shop: {
        icon: 'i-lucide-store',
        button: 'A market stall with a striped awning.',
        summary: 'Permanent upgrades, and Battle Speed boosts.'
    },
    calendar: {
        icon: 'i-lucide-calendar-days',
        button: 'A wall calendar.',
        summary: 'A login reward every day, and the Milestones for everything you achieve.'
    },
    settings: {
        icon: 'i-lucide-settings',
        button: 'A steel cog.',
        summary: 'Tutorials, spending confirmations, display options and the menu\'s red dots.'
    }
}

export const HQ_SCREEN_DOCS: readonly HqScreenDoc[] = (['battle', ...HQ_MENU_SCENES] as const).map(id => ({
    id,
    label: HQ_SCENE_LABELS[id],
    ...SCREEN_INFO[id]
}))

export function hqScreenWikiPath(id: HqScreenId): string {
    return `/hero-quest/wiki/screens/${id}`
}

export type HqWikiRoster = 'classes' | 'champions' | 'skills' | 'gear' | 'artifacts' | 'effects' | 'worlds'

/** The Content reference's rosters, one per page, in the wiki menu's order. */
export const HQ_WIKI_ROSTERS: readonly { key: HqWikiRoster, label: string, count: number }[] = [
    { key: 'classes', label: 'Classes', count: CLASS_NODES.length },
    { key: 'champions', label: 'Champions', count: CHAMPIONS.length },
    { key: 'skills', label: 'Skills', count: SKILLS.length },
    { key: 'gear', label: 'Gear', count: GEAR.length },
    { key: 'artifacts', label: 'Artifacts', count: ARTIFACTS.length },
    { key: 'effects', label: 'Artifact effects', count: Object.values(ARTIFACT_EFFECT_POOL).flat().length },
    { key: 'worlds', label: 'Worlds', count: WORLDS.length }
]

/** The roster a `?roster=` query names, or the first one for anything else. */
export function hqWikiRoster(query: unknown): HqWikiRoster {
    return HQ_WIKI_ROSTERS.find(roster => roster.key === query)?.key ?? 'classes'
}

export function hqWikiRosterPath(key: HqWikiRoster): string {
    return `/hero-quest/wiki/content?roster=${key}`
}

/** When a feature (a screen, or a tab inside one) opens, as a sentence: "Opens once you clear 3 Worlds." */
export function hqFeatureUnlockText(feature: HqFeature): string {
    const at = featureCheckpoint(feature)
    return at.kind === 'start' ? 'Open from the start.' : `Opens once you ${checkpointLabel(at)}.`
}

/** The same for a screen. Battle and Settings are never gated. */
export function hqScreenUnlockText(id: HqScreenId): string {
    return isHqFeature(id) ? hqFeatureUnlockText(id) : 'Open from the start.'
}

/** A gacha's Seals by the name the game gives them ("Forge Seals"): its paired raid's reward. */
export function hqSealName(system: GachaSystem): string {
    return RAIDS.find(raid => raid.pairedSystem === system)?.reward ?? 'Seals'
}
