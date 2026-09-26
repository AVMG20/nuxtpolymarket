// Every Hero Quest art asset, in one registry.
//
// An entry is a frame size, a frame count and a render function. The in-app gallery, the PNG
// exporter (`bun run art:hero-quest`) and the coverage spec all read this list, so an asset
// that exists here exists everywhere and one that is missing fails the spec.
//
// IDs are paths — `hero/class_warrior/attack` — and become the exported file names.

import { ANIM_FPS, frameCount } from './anim'
import { C, CLEAR, RARITY_COLORS, TRAIT_GRADES, SCENERY, SCENERY_RAMPS, type ColorName } from './palette'
import { drawText } from './font'
import type { Surface } from './surface'
import { Actor } from './rig'
import { HERO_ART, HERO_GAIT, HERO_STATES } from './heroes'
import { CHASSIS, CHAMPION_STATES, CHAMPION_ART_IDS, championLook } from './champions'
import { DISCIPLE_CLIPS, DISCIPLE_LOOK, RAISED_DEAD_CLIPS, RAISED_DEAD_LOOK, SUMMON_STATES, WOLF } from './summons'
import { ENEMY_RIGS, ENEMY_STATES, ENEMY_WEAPONS, ELITE_MARK, drawEliteMark, enemyLook } from './enemies'
import { drawCreature, stateFrames, type CreatureDef } from './creature'
import { BOSS_STATES } from './boss-kit'
import { BOSSES_A } from './bosses-a'
import { BOSSES_B } from './bosses-b'
import { VFX, MULTI_STRIKE, drawMultiStrike, drawVfxStage } from './vfx'
import { VL } from './vfx-kit'
import { CINEMATIC_BY_ID, CINEMATIC_VFX, cinematicStage } from './vfx-cinematic'
import { drawSkillBanner } from './presentation'
import { ICON, SMALL_ICON, glyph, squareFrame, circleFrame, crestFrame, itemTile } from './icon-kit'
import { CLASS_SKILL_ICONS, CHAMPION_ABILITY_ICONS, TRAINING_SKILL_ICONS } from './icons-abilities'
import { ARTIFACT_ICONS, GEAR_ICONS, CURRENCY_ICONS, CURRENCY_LABELS } from './icons-items'
import { FRAME, rarityFrame, traitFrame, ARCHETYPE_BADGES, classNodeIcon, STATUS_ICONS, drawStatusIcon } from './icons-misc'
import { CLASS_NODES, classPath, CLASS_BY_ID  } from '../../../shared/utils/hero-quest/content/classes'
import { CHAMPION_ABILITY_POOL, CHAMPION_BY_ID, championDisplayName, abilityId  } from '../../../shared/utils/hero-quest/content/champions'
import { SKILLS } from '../../../shared/utils/hero-quest/content/skills'
import { ARTIFACTS } from '../../../shared/utils/hero-quest/content/artifacts'
import { GEAR } from '../../../shared/utils/hero-quest/content/gear'
import { NUMBER_STYLES, drawNumberPop, drawNumberAtlas, numberAtlasWidth, numberHeight, drawPartyFrame, drawCooldown, drawEnrageTimer, drawAddWaveSpawn, drawPhaseShift, drawRevealBase, REVEAL_LUT, REVEAL_SIZE } from './feedback'
import { Surface as Surf, blit, rect } from './surface'
import { WORLD_SCENES, SW, SH, BG_FRAMES, composeScene } from './scenery'
import { drawWorldMap, TAB_BACKGROUNDS, CHROME, drawLogo, drawAppIcon, drawSplash } from './ui-art'
import { GILDED_WARLORD, DRILLMASTER, BURIED_COLOSSUS, DIG_SCARAB, RELIC_SHARD, ANVIL_HEART, RAMPANT, TRAINING_DUMMY } from './raids'
import { WORLDS } from '../../../shared/utils/hero-quest/content/worlds'

export type ArtGroup =
    | 'heroes' | 'champions' | 'summons' | 'enemies' | 'bosses' | 'raids'
    | 'vfx' | 'feedback' | 'icons' | 'frames' | 'backgrounds' | 'ui' | 'branding'

export const ART_GROUPS: readonly { id: ArtGroup, label: string }[] = [
    { id: 'heroes', label: 'Hero' },
    { id: 'champions', label: 'Champions' },
    { id: 'summons', label: 'Summons' },
    { id: 'enemies', label: 'Enemies' },
    { id: 'bosses', label: 'Bosses' },
    { id: 'raids', label: 'Raids & Arena' },
    { id: 'vfx', label: 'Ability VFX' },
    { id: 'feedback', label: 'Combat feedback' },
    { id: 'icons', label: 'Icons' },
    { id: 'frames', label: 'Frames & badges' },
    { id: 'backgrounds', label: 'Backgrounds' },
    { id: 'ui', label: 'UI chrome' },
    { id: 'branding', label: 'Branding' }
]

export interface ArtAsset {
    id: string
    group: ArtGroup
    /** Sub-heading inside the group (a class, a world, an icon set). */
    section: string
    label: string
    w: number
    h: number
    frames: number
    fps: number
    loop: boolean
    /** Draw frame `f` into `dst` (w × h, already cleared to transparent). */
    render(dst: Surface, f: number): void
    /** Draws its own opaque background (scenes); galleries skip the checkerboard. */
    opaque?: boolean
    /** Preview-only context drawn under the asset (never exported) — the VFX stage. */
    underlay?: (dst: Surface) => void
    /** Where the feet land inside the frame (bodies); absent means top-left placement. */
    ax?: number
    ay?: number
    /** The review round that last changed it (see ART_ROUNDS); absent for the original pass. */
    round?: number
}

/**
 * Review rounds: each restyle pass lists the asset IDs it touched (by prefix), so the
 * gallery can show one round's changes on their own. Newest last.
 *
 * The count has restarted four times, all on 2026-09-25/26: once the chibi style was adopted,
 * again once the Hero designs were locked, again once World 1 was locked, and again once every
 * world background was locked. The next round is 1; the earlier rounds are recorded in
 * art-style.md.
 */
export const ART_ROUNDS: readonly { n: number, label: string, prefixes: readonly string[] }[] = []

/** An asset rendered once into reusable frames — what the live stage blits. */
export interface Baked { frames: Surface[], ax: number, ay: number, fps: number, loop: boolean }

export function bake(a: ArtAsset): Baked {
    const frames: Surface[] = []
    for (let f = 0; f < a.frames; f++) {
        const s = new Surf(a.w, a.h, 0, 0)
        a.render(s, f)
        frames.push(s)
    }
    return { frames, ax: a.ax ?? 0, ay: a.ay ?? 0, fps: a.fps, loop: a.loop }
}

const ACTOR = new Actor(64)
const SPRITE = 64
const FOOT = 58

function actorAsset(id: string, group: ArtGroup, section: string, label: string,
    look: () => Parameters<Actor['draw']>[3], clip: Parameters<Actor['draw']>[4], facing: 1 | -1 = 1, mark = CLEAR,
    after?: (dst: Surface, t: number) => void): ArtAsset {
    return {
        id, group, section, label, w: SPRITE, h: SPRITE, frames: frameCount(clip), fps: ANIM_FPS, loop: clip.loop, ax: SPRITE / 2, ay: FOOT,
        render(dst, f) {
            ACTOR.draw(dst, SPRITE / 2, FOOT, look(), clip, f / ANIM_FPS, facing, mark)
            after?.(dst, f / ANIM_FPS)
        }
    }
}

export function creatureAsset(id: string, group: ArtGroup, section: string, label: string, def: CreatureDef, st: string, facing: 1 | -1 = -1, pad = 0): ArtAsset {
    const size = def.size + pad * 2
    return {
        id, group, section, label, w: size, h: size, frames: stateFrames(def, st), fps: ANIM_FPS, loop: def.states[st]!.loop,
        ax: size / 2, ay: size - (def.foot ?? 6) - pad,
        render(dst, f) {
            drawCreature(dst, size / 2, size - (def.foot ?? 6) - pad, def, st, f / ANIM_FPS, facing)
        }
    }
}

const TITLE: Record<string, string> = { idle: 'Idle', attack: 'Basic Attack', cast: 'Skill cast', hit: 'Hit', death: 'Death', move: 'Move', entry: 'Entry' }

// ── Characters ─────────────────────────────────────────────────────────────────────

function heroAssets(): ArtAsset[] {
    return Object.entries(HERO_ART).flatMap(([id, art]) => HERO_STATES.map(st => actorAsset(
        `hero/${id}/${st}`, 'heroes', CLASS_BY_ID[id as keyof typeof CLASS_BY_ID]?.name ?? id,
        st === 'cast' ? `Skill cast — ${CLASS_BY_ID[id as keyof typeof CLASS_BY_ID]?.skill.name}` : TITLE[st]!,
        // `move` is derived per class rather than authored on it, so it comes from the gait table
        () => art.look, st === 'move' ? HERO_GAIT[id]! : art.clips[st]
    )))
}

function championAssets(): ArtAsset[] {
    // 20 chassis sets, shown on the first skin of each archetype, then every skin's idle and cast.
    const out: ArtAsset[] = []
    for (const arch of ['damage', 'tank', 'support', 'control'] as const) {
        const first = CHAMPION_ART_IDS.find(id => CHAMPION_BY_ID[id]!.archetype === arch)!
        for (const st of CHAMPION_STATES) {
            out.push(actorAsset(`champion/chassis_${arch}/${st}`, 'champions', `${arch[0]!.toUpperCase()}${arch.slice(1)} chassis`,
                st === 'cast' ? 'Ability-cast pose' : TITLE[st]!, () => championLook(first), CHASSIS[arch][st]))
        }
    }
    for (const id of CHAMPION_ART_IDS) {
        const def = CHAMPION_BY_ID[id]!
        for (const st of CHAMPION_STATES) {
            out.push(actorAsset(`champion/${id}/${st}`, 'champions', `${def.archetype[0]!.toUpperCase()}${def.archetype.slice(1)} skins`,
                `${championDisplayName(def)} (${def.rarity}) — ${TITLE[st]}`, () => championLook(id), CHASSIS[def.archetype][st]))
        }
    }
    return out
}

function summonAssets(): ArtAsset[] {
    return [
        ...SUMMON_STATES.map(st => actorAsset(`summon/disciple/${st}`, 'summons', 'Disciple (Paladin)', TITLE[st]!, () => DISCIPLE_LOOK, DISCIPLE_CLIPS[st])),
        ...SUMMON_STATES.map(st => actorAsset(`summon/raised_dead/${st}`, 'summons', 'Raised Dead (Witch Doctor)', TITLE[st]!, () => RAISED_DEAD_LOOK, RAISED_DEAD_CLIPS[st])),
        ...SUMMON_STATES.map(st => creatureAsset(`summon/wolf/${st}`, 'summons', 'Wolf (Beast Master)', TITLE[st]!, WOLF, st, 1, 8))
    ]
}

function enemyAssets(): ArtAsset[] {
    const out: ArtAsset[] = []
    WORLDS.forEach(world => {
        for (const w of ENEMY_WEAPONS) {
            for (const st of ENEMY_STATES) {
                out.push(actorAsset(`enemy/${world.id}/${w}/${st}`, 'enemies', `${world.index}. ${world.name} — ${world.enemyName}`,
                    `${w} · ${TITLE[st]}`, () => enemyLook(world.index, w), ENEMY_RIGS[w][st], -1))
            }
        }
    })
    // the elite mark, shown once per world on the sword rig's idle
    WORLDS.forEach(world => {
        out.push(actorAsset(`enemy/${world.id}/elite/idle`, 'enemies', 'Elite mark (one treatment, every world)',
            `${world.enemyName} — elite`, () => enemyLook(world.index, 'sword'), ENEMY_RIGS.sword.idle, -1, ELITE_MARK,
            (dst, t) => drawEliteMark(dst, SPRITE / 2, FOOT - 36, t)))
    })
    return out
}

function bossAssets(): ArtAsset[] {
    const pairs = [...BOSSES_A, ...BOSSES_B]
    const out: ArtAsset[] = []
    pairs.forEach(([boss, sup], i) => {
        const world = WORLDS[i]!
        for (const [def, kind] of [[boss, 'boss'], [sup, 'super']] as const) {
            for (const st of BOSS_STATES) {
                out.push(creatureAsset(`${kind === 'boss' ? 'boss' : 'superboss'}/${world.id}/${st}`, 'bosses', `${world.index}. ${world.name}`,
                    `${def.name} — ${TITLE[st]}`, def, st, -1))
            }
        }
    })
    return out
}

function raidAssets(): ArtAsset[] {
    const out: ArtAsset[] = []
    const five = (id: string, section: string, def: CreatureDef) => {
        for (const st of BOSS_STATES) out.push(creatureAsset(`raid/${id}/${st}`, 'raids', section, `${def.name} — ${TITLE[st]}`, def, st, -1))
    }
    five('guild', 'Guild Raid · solo_boss', GILDED_WARLORD)
    five('training_grounds', 'Training Grounds Raid · solo_boss', DRILLMASTER)
    five('dig_site', 'Dig-site Raid · reinforced_boss', BURIED_COLOSSUS)
    for (const [id, def] of [['dig_scarab', DIG_SCARAB], ['relic_shard', RELIC_SHARD]] as const) {
        for (const st of ['idle', 'attack', 'death']) out.push(creatureAsset(`raid/dig_site/add_${id}/${st}`, 'raids', 'Dig-site Raid · add wave', `${def.name} — ${TITLE[st]}`, def, st, -1))
    }
    ANVIL_HEART.forEach((def, i) => {
        const states = i === 0 ? ['entry', 'idle', 'attack', 'hit'] : i === 2 ? ['idle', 'attack', 'hit', 'death'] : ['idle', 'attack', 'hit']
        for (const st of states) out.push(creatureAsset(`raid/forge/phase${i + 1}/${st}`, 'raids', `Forge Raid · phased_boss — phase ${i + 1}`, `${def.name} — ${TITLE[st]}`, def, st, -1))
    })
    RAMPANT.forEach((def, i) => {
        const states = i < RAMPANT.length - 1 ? ['idle', 'attack', 'hit', 'escalate'] : ['idle', 'attack', 'hit']
        for (const st of states) out.push(creatureAsset(`raid/trait/rampage${i + 1}/${st}`, 'raids', `Trait Raid · rampaging_boss — rampage ${i + 1}`, `${def.name} — ${st === 'escalate' ? 'Escalation' : TITLE[st]}`, def, st, -1))
    })
    out.push(creatureAsset('arena/training_dummy/static', 'raids', 'Arena training dummy', 'Static pose', TRAINING_DUMMY, 'static', -1))
    out.push(creatureAsset('arena/training_dummy/hit', 'raids', 'Arena training dummy', 'Hit reaction', TRAINING_DUMMY, 'hit', -1))
    return out
}

function vfxAssets(): ArtAsset[] {
    const SECTION = { class: 'Hero skills', champion: 'Champion abilities', training: 'Training Grounds actives' } as const
    const out: ArtAsset[] = VFX.map(v => ({
        id: `vfx/${v.id}`, group: 'vfx' as const, section: SECTION[v.source], label: `${v.name} — ${v.owner}`,
        w: VL.W, h: VL.H, frames: Math.round(v.dur * ANIM_FPS), fps: ANIM_FPS, loop: false,
        render: (dst: Surface, f: number) => v.draw(dst, f / ANIM_FPS),
        underlay: CINEMATIC_BY_ID[v.id] ? cinematicStage(v.id) : drawVfxStage
    }))
    for (const m of MULTI_STRIKE) {
        out.push({
            id: `vfx/strike_${m.id}`, group: 'vfx', section: 'Multi-strike', label: m.label,
            w: VL.W, h: VL.H, frames: Math.round((0.45 + m.shots * 0.18) * ANIM_FPS), fps: ANIM_FPS, loop: false,
            render: (dst, f) => drawMultiStrike(dst, f / ANIM_FPS, m), underlay: drawVfxStage
        })
    }
    return out
}

function still(id: string, group: ArtGroup, section: string, label: string, w: number, h: number, draw: (dst: Surface) => void): ArtAsset {
    return { id, group, section, label, w, h, frames: 1, fps: ANIM_FPS, loop: false, render: dst => draw(dst) }
}

const LINE_M = {
    beginner: [C.gold0, C.gold1, C.gold2], warrior: [C.red0, C.red1, C.red2],
    mage: [C.blue0, C.blue1, C.blue2], archer: [C.green0, C.green1, C.green2]
} as const
const ARCH_M = {
    damage: [C.red0, C.red1, C.red2], tank: [C.blue0, C.blue1, C.blue2],
    support: [C.green0, C.green1, C.green3], control: [C.purple0, C.purple1, C.purple2]
} as const
const TIER_INDEX = { beginner: 0, base: 1, elite: 2, master: 3 } as const

function classLine(id: string): keyof typeof LINE_M {
    const second = classPath(id as never)[1]
    return second ? (second.id.replace('class_', '') as keyof typeof LINE_M) : 'beginner'
}

function iconAssets(): ArtAsset[] {
    const out: ArtAsset[] = []
    for (const node of CLASS_NODES) {
        const g = CLASS_SKILL_ICONS[node.skill.id]
        if (!g) continue
        out.push(still(`icon/skill/${node.skill.id}`, 'icons', 'Class-tree skills (square)', `${node.skill.name} — ${node.name}`, ICON, ICON,
            dst => { squareFrame(dst, LINE_M[classLine(node.id)]); glyph(dst, g, 12, 12) }))
    }
    for (const sk of SKILLS) {
        const g = TRAINING_SKILL_ICONS[sk.id]
        if (!g) continue
        out.push(still(`icon/skill/${sk.id}`, 'icons', `Training Grounds skills (circular) — ${sk.type}`, `${sk.name} (${sk.rarity})`, ICON, ICON,
            dst => { circleFrame(dst, RARITY_COLORS[sk.rarity]!); glyph(dst, g, 12, 12) }))
    }
    for (const arch of ['damage', 'tank', 'support', 'control'] as const) {
        for (const name of CHAMPION_ABILITY_POOL[arch]) {
            const g = CHAMPION_ABILITY_ICONS[name]
            if (!g) continue
            out.push(still(`icon/ability/${abilityId(name)}`, 'icons', 'Champion abilities (crest)', `${name} — ${arch}`, ICON, ICON,
                dst => { crestFrame(dst, ARCH_M[arch]); glyph(dst, g, 12, 12) }))
        }
    }
    for (const a of ARTIFACTS) {
        const g = ARTIFACT_ICONS[a.id]
        if (!g) continue
        out.push(still(`icon/artifact/${a.id}`, 'icons', `Artifacts — ${a.category}`, `${a.name} (${a.rarity})`, ICON, ICON,
            dst => { itemTile(dst, RARITY_COLORS[a.rarity]!); glyph(dst, g, 12, 12) }))
    }
    for (const gear of GEAR) {
        const g = GEAR_ICONS[gear.id]
        if (!g) continue
        out.push(still(`icon/gear/${gear.id}`, 'icons', `Gear — ${gear.slot}`, `${gear.name} (${gear.rarity})`, ICON, ICON,
            dst => { itemTile(dst, RARITY_COLORS[gear.rarity]!); glyph(dst, g, 12, 12) }))
    }
    for (const [id, g] of Object.entries(CURRENCY_ICONS)) {
        out.push(still(`icon/currency/${id}`, 'icons', 'Currencies', CURRENCY_LABELS[id]!, SMALL_ICON, SMALL_ICON, dst => glyph(dst, g, 8, 8, true)))
    }
    for (const st of STATUS_ICONS) {
        out.push(still(`icon/status/${st.id}`, 'icons', 'Status effects', st.label, SMALL_ICON, SMALL_ICON, dst => drawStatusIcon(dst, st, glyph)))
    }
    return out
}

function frameAssets(): ArtAsset[] {
    const out: ArtAsset[] = []
    for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']) {
        out.push(still(`frame/rarity/${r}`, 'frames', 'Rarity frames', r, FRAME, FRAME, dst => rarityFrame(dst, r)))
    }
    for (const g of TRAIT_GRADES) out.push(still(`frame/trait/grade_${g.toLowerCase()}`, 'frames', 'Trait grade frames', `Grade ${g}`, ICON, ICON, dst => traitFrame(dst, g)))
    for (const [id, g] of Object.entries(ARCHETYPE_BADGES)) out.push(still(`badge/archetype/${id}`, 'frames', 'Archetype badges', id, SMALL_ICON, SMALL_ICON, dst => glyph(dst, g, 8, 8, true)))
    for (const node of CLASS_NODES) {
        out.push(still(`icon/class/${node.id}`, 'frames', 'Class-tree node icons', node.name, ICON, ICON,
            dst => classNodeIcon(dst, node.id, classLine(node.id), TIER_INDEX[node.tier])))
    }
    return out
}

function anim(id: string, group: ArtGroup, section: string, label: string, w: number, h: number, frames: number, loop: boolean,
    draw: (dst: Surface, t: number, f: number) => void, underlay?: (dst: Surface) => void): ArtAsset {
    return { id, group, section, label, w, h, frames, fps: ANIM_FPS, loop, render: (dst, f) => draw(dst, f / ANIM_FPS, f), underlay }
}

const REVEAL_TMP = new Surf(REVEAL_SIZE, REVEAL_SIZE, 0, 0)

function feedbackAssets(): ArtAsset[] {
    const out: ArtAsset[] = []
    for (const st of NUMBER_STYLES) {
        out.push(anim(`feedback/number/${st.id}`, 'feedback', 'Damage numbers', `${st.label} — pop`, 80, 32, 9, false, (d, t) => drawNumberPop(d, st, st.sample, 40, 26, t)))
        const w = numberAtlasWidth(st)
        out.push(still(`feedback/number/${st.id}_atlas`, 'feedback', 'Damage numbers', `${st.label} — glyph atlas`, w, numberHeight(st) + 7, d => drawNumberAtlas(d, st)))
    }
    out.push(anim('feedback/party_frame', 'feedback', 'HP bar + party frame', 'Portrait, HP (taking a hit), status pips', 72, 22, 10, false, (d, t) => drawPartyFrame(d, t)))
    const sample = CLASS_SKILL_ICONS.skill_whirlwind!
    out.push(anim('feedback/cooldown', 'feedback', 'Cooldown radial overlay', 'Sweep over an equipped skill icon', ICON, ICON, 13, true, (d, _t, f) => drawCooldown(d, Math.min(1, f / 12)),
        d => { squareFrame(d, LINE_M.warrior); glyph(d, sample, 12, 12) }))
    out.push(anim('feedback/enrage_timer', 'feedback', 'Boss enrage timer', 'Draining → low → enraged', 88, 14, 16, false, (d, t, f) => drawEnrageTimer(d, f / 14, t)))
    out.push(anim('feedback/add_wave_spawn', 'feedback', 'Raid VFX', 'Reinforced Boss add-wave spawn (Dig-site)', 64, 48, 12, false, (d, t) => drawAddWaveSpawn(d, t)))
    for (const v of CINEMATIC_VFX) {
        out.push(anim(`feedback/skill_banner/${v.id}`, 'feedback', 'Skill banner', `${v.name} — ${v.owner}`, 160, 16, 8, false,
            (d, t) => drawSkillBanner(d, v.name.toUpperCase(), 80, 4, t)))
    }
    out.push(anim('feedback/phase_transition', 'feedback', 'Raid VFX', 'Phased Boss phase transition (Forge)', 96, 96, 12, false, (d, t) => drawPhaseShift(d, t)))
    return out
}

function revealAssets(): ArtAsset[] {
    const out: ArtAsset[] = [anim('ui/gacha_reveal/base', 'ui', 'Gacha reveal', 'Base flash (neutral)', REVEAL_SIZE, REVEAL_SIZE, 14, false, (d, t) => drawRevealBase(d, t))]
    for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']) {
        out.push(anim(`ui/gacha_reveal/${r}`, 'ui', 'Gacha reveal', `${r} recolour`, REVEAL_SIZE, REVEAL_SIZE, 14, false, (d, t) => {
            REVEAL_TMP.clear()
            drawRevealBase(REVEAL_TMP, t)
            blit(d, REVEAL_TMP, 0, 0, REVEAL_LUT[r]!)
        }))
    }
    return out
}

function backgroundAssets(): ArtAsset[] {
    return WORLD_SCENES.map((scene, i) => ({
        ...anim(`bg/world/${scene.id}`, 'backgrounds', 'World backgrounds', `${WORLDS[i]!.index}. ${WORLDS[i]!.name}`, SW, SH, BG_FRAMES, true, (d, t) => composeScene(scene, d, 0, t)),
        opaque: true
    }))
}

// ── Palette sheets ──────────────────────────────────────────────────────────────────

const SWATCH = 9
const LABEL_W = 34

/** One row per ramp: its name, then its colours dark → light. */
function paletteSheet(id: string, label: string, rows: readonly (readonly [string, readonly number[]])[]): ArtAsset {
    const cols = Math.max(...rows.map(r => r[1].length))
    const w = LABEL_W + cols * (SWATCH + 1) + 3
    const h = rows.length * (SWATCH + 1) + 3
    return still(id, 'ui', 'Palette', label, w, h, (d) => {
        rect(d, 0, 0, w, h, C.ink)
        rows.forEach(([name, cs], r) => {
            const y = 2 + r * (SWATCH + 1)
            drawText(d, name.toUpperCase(), 2, y + 2, C.bone1, { shadow: 0 })
            cs.forEach((c, k) => rect(d, LABEL_W + k * (SWATCH + 1), y, SWATCH, SWATCH, c))
        })
    })
}

/** The character tier, grouped by name (red0…red3 → RED); singles share one row. */
function characterRamps(): [string, number[]][] {
    const groups = new Map<string, number[]>()
    const singles: number[] = []
    for (const [name, i] of Object.entries(C) as [ColorName, number][]) {
        if (SCENERY.has(i)) continue
        const base = name.replace(/\d+$/, '')
        if (base === name) { singles.push(i); continue }
        groups.set(base, [...(groups.get(base) ?? []), i])
    }
    const rows = [...groups.entries()]
    for (let k = 0; k < singles.length; k += 6) rows.push([k ? '' : 'singles', singles.slice(k, k + 6)])
    return rows
}

function paletteAssets(): ArtAsset[] {
    return [
        paletteSheet('ui/palette/scenery', 'Scenery tier — behind the fight line', Object.entries(SCENERY_RAMPS).map(([n, r]) => [n, r.map(c => C[c])] as const)),
        paletteSheet('ui/palette/characters', 'Character tier — bodies and effects', characterRamps())
    ]
}

function uiAssets(): ArtAsset[] {
    const out: ArtAsset[] = [{ ...anim('bg/world_map', 'backgrounds', 'UI backgrounds', 'Stage-select / world map', SW, SH, 8, true, (d, t) => drawWorldMap(d, t)), opaque: true }]
    for (const tab of TAB_BACKGROUNDS) {
        out.push({ ...anim(`bg/tab/${tab.id}`, 'backgrounds', 'UI backgrounds', `${tab.label} tab${tab.built ? '' : ' (Phase 4)'}`, SW, SH, 12, true, (d, t) => tab.draw(d, t)), opaque: true })
    }
    for (const c of CHROME) out.push(anim(`ui/${c.id}`, 'ui', 'UI chrome', c.label, c.w, c.h, c.frames, c.frames > 1, (d, t) => c.draw(d, t)))
    return out
}

function brandingAssets(): ArtAsset[] {
    return [
        anim('branding/logo', 'branding', 'Branding', 'Hero Quest logo (name pending — see trademark note)', 200, 64, 16, true, (d, t) => drawLogo(d, 100, 14, t, 2)),
        still('branding/app_icon', 'branding', 'Branding', 'App icon', 32, 32, d => drawAppIcon(d)),
        { ...anim('branding/splash', 'branding', 'Branding', 'Splash / loading screen', SW, SH, 20, true, (d, t) => drawSplash(d, t)), opaque: true }
    ]
}

// ── Registry ───────────────────────────────────────────────────────────────────────

type Provider = () => ArtAsset[]
const PROVIDERS: Provider[] = [heroAssets, championAssets, summonAssets, enemyAssets, bossAssets, raidAssets, vfxAssets, iconAssets, frameAssets, feedbackAssets, revealAssets, backgroundAssets, uiAssets, paletteAssets, brandingAssets]

/** Register more providers (bosses, VFX, icons, …) — each module adds its own. */
export function registerArt(p: Provider): void {
    PROVIDERS.push(p)
    cache = null
}

let cache: ArtAsset[] | null = null

export function allArt(): readonly ArtAsset[] {
    if (!cache) {
        cache = PROVIDERS.flatMap(p => p())
        for (const a of cache) {
            for (const r of ART_ROUNDS) if (r.prefixes.some(p => a.id.startsWith(p))) a.round = r.n
        }
    }
    return cache
}

export function artById(id: string): ArtAsset | undefined {
    return allArt().find(a => a.id === id)
}
