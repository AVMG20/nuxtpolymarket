<script setup lang="ts">
import type { HqIntroRect } from '~/composables/useHqIntro'
import { D, formatHq, formatSeconds } from '#shared/utils/hero-quest/numbers'
import { RARITIES, sealLadderTotal, type GachaSystem } from '#shared/utils/hero-quest/gacha'
import type { FormationRow, Rarity } from '#shared/utils/hero-quest/types'
import { GEAR_SLOTS, GEAR_SLOT_NAME } from '#shared/utils/hero-quest/content/gear'
import { RARITY_STAT_MULTIPLIER, getChampion } from '#shared/utils/hero-quest/content/champions'
import { skillActives } from '#shared/utils/hero-quest/content/skills'
import { investmentScalar } from '#shared/utils/hero-quest/gacha'
import { championInvestmentMultiplier } from '#shared/utils/hero-quest/stats'
import { wealthFactorFor } from '#shared/utils/hero-quest/combat'
import { describeAbility, describeWealth, hqNumber, hqPct, isWealthScaled, modifierLine } from '#shared/utils/hero-quest/describe'
import { ARENA_FIGHT_SECONDS, AUTO_ENGAGE_REPLAY_HOLD_SECONDS, CALENDAR_MAKEUPS_PER_CYCLE, FORMATION_ROW_CAPACITY, FREE_PULLS_PER_DAY, MAX_ARTIFACT_SLOTS, MAX_CHAMPION_SLOTS, MAX_OFFLINE_CAP_LEVEL, MAX_OFFLINE_EFFICIENCY_LEVEL, MAX_SKILL_SLOTS, RAID_DUMMY_SECONDS, RAID_ENRAGE_SECONDS, RAID_RAMPAGE_CAP_SECONDS } from '#shared/utils/hero-quest/constants'
import { ARENA_SHOP } from '#shared/utils/hero-quest/arena'
import { getRaid } from '#shared/utils/hero-quest/content/raids'
import type { ArenaBoardRow, ArenaFace, ArenaItemView, ArenaResultView, ArenaTarget, ArenaView } from '~/utils/hero-quest-art/arena-scene'
import { partyStatsView, type PartyStatsPayload, type PartyStatsView } from '~/utils/hero-quest-art/party-stats'
import type { CollectionAction, CollectionLine, CollectionSection, CollectionTile, DetailButton } from '~/utils/hero-quest-art/collections-scene'
import type { LoadoutEntry, LoadoutSlotView, LoadoutsView } from '~/utils/hero-quest-art/loadouts-scene'
import type { PrestigeView } from '~/utils/hero-quest-art/prestige-scene'
import type { ClassesView } from '~/utils/hero-quest-art/classes-scene'
import type { SpeedView } from '~/utils/hero-quest-art/speed-scene'
import { isStageTarget, type SettingsTarget, type SettingsView } from '~/utils/hero-quest-art/settings-scene'
import type { HqStageSize } from '~/utils/hero-quest-art/stage-size'
import type { CalendarView } from '~/utils/hero-quest-art/calendar-scene'
import type { HolidayGiftIconView, HolidayRevealView } from '~/utils/hero-quest-art/holiday-gift'
import type { ChestToast } from '~/utils/hero-quest-art/gold-chest'
import type { MilestonesView } from '~/utils/hero-quest-art/milestones-scene'
import type { TraitRollView, TraitsTarget, TraitsView } from '~/utils/hero-quest-art/traits-scene'
import type { TreeView } from '~/utils/hero-quest-art/tree-scene'
import type { TraitGrade } from '~/utils/hero-quest-art/palette'
import type { RaidLoadoutOption, RaidRewardView, RaidRowView } from '~/utils/hero-quest-art/raids-scene'
import type { WelcomeNote, WelcomeView } from '~/utils/hero-quest-art/welcome-card'
import type { RaidId as StageRaidId, StageArena, StageRaid } from '~/utils/hero-quest-art/demo'
import { RAIDS, type RaidId } from '#shared/utils/hero-quest/content/raids'
import { TRAIT_GRADES } from '#shared/utils/hero-quest/content/traits'
import { LOADOUT_TARGETS } from '#shared/utils/hero-quest/loadout-session'
import { HQ_SETTING_DEFAULTS } from '#shared/utils/hero-quest/settings'
import { bossLossMark, featureMenuScene, isHqFeature, nextTutorial, revealedFeatures, type HqFeature, type TutorialId } from '#shared/utils/hero-quest/tutorials'
import { GUIDE_NAME, TUTORIAL_PAGES } from '#shared/utils/hero-quest/content/tutorials'
import type { GuideView } from '~/utils/hero-quest-art/guide'
import type { GachaBannerView, GachaButton, GachaCard, GachaSystemId, GachaView, PullPrice } from '~/utils/hero-quest-art/gacha-scene'

/**
 * The game's stage and the battle it plays. The layout keeps it mounted on every scene route, so
 * opening a menu scene draws over the battle instead of tearing it down: the run, a boss fight and
 * the bridge all carry on underneath, and the battle's readouts below the stage only show on it.
 */
const props = defineProps<{
    scene: HqScene
}>()

const emit = defineEmits<{
    /** The stage's menu band asked for a scene. */
    scene: [scene: HqScene]
}>()

const {
    initialized, run, hero, welcome, dismissWelcome, pending, guild, forge, training, digSite, nextPrestigeReward,
    engageBoss, prestige, craft, setLoadout, loadouts, saveLoadout, applyLoadout, renameLoadout,
    loadoutPreferences, loadoutSession, setLoadoutPreference, leaveRaid,
    shop, voidShards, chestGold, collectChest, buyUpgrade, classTree, classToken, pickClass, battleSpeed, buyBattleSpeed,
    pull, freePull, settings, setSetting, raids, engageRaid, quickClearRaid, calendar, claimCalendar,
    holidays, claimHoliday, milestones, claimMilestones, ascendant, tutorials, markTutorialSeen, resetTutorials,
    traits, rollTraits, autoRollTraits, refreshTraits, lockTrait, saveTraits, loadTraits, buyTraitSaveSlot,
    passiveTree, buyPassiveNode, respecPassiveTree,
    arena, arenaCandidates, arenaLog, arenaBoard, loadArenaCandidates, loadArenaLog,
    loadArenaBoard, refreshArenaCandidates, attackArena, buyArenaAttempt, setArenaDefense, buyArenaItem, claimArenaSeason
} = useHeroQuest()
const toast = useToast()
const { user, fetchSession } = useAuth()

/**
 * The Collections scene's tab, off the route, and the roster it shows, with what each entry's
 * detail says and which of its buttons can be pressed. The rules are the collection pages' own:
 * a slot cap on Champions, Skills and Artifacts, one piece per Gear slot, and crafting until maxed.
 * Equip on a Champion, Skill or Artifact opens its picker (`hero-quest-equip.ts`), Gear goes on at once.
 */
const route = useRoute()

const SYSTEM_OF: Readonly<Record<HqCollectionTab, GachaSystem>> = {
    gear: 'gear',
    champions: 'champion',
    skills: 'skill',
    artifacts: 'artifact'
}

/**
 * The two blocks every detail shows: what owning it gives, and what putting it to work gives.
 * The first pays whenever the entry is owned, equipped or not; the second adds to it.
 */
function sections(
    owned: { active: boolean, lines: string[] },
    worked: { title: string, scope: string, active: boolean, lines: CollectionLine[] }
): CollectionSection[] {
    return [
        { title: 'In collection', scope: 'Hero', active: owned.active, lines: owned.lines.length ? owned.lines : ['Nothing'] },
        worked
    ]
}

/** The one button a Champion, Skill or Artifact has: Equip, which opens its picker. */
function equipActions(owned: boolean): CollectionAction[] {
    return owned ? [{ id: 'equip', label: 'Equip', enabled: true }] : []
}

/** The copy a detail describes: the player's own, or a fresh 0★ Lv1 for one not owned yet, as the rosters price it. */
function copyAt(e: { owned: boolean, star: number, level: number }): { star: number, level: number } {
    return e.owned ? { star: e.star, level: Math.max(1, e.level) } : { star: 0, level: 1 }
}

/** What a fielded Champion brings, exactly: its stat multiplier at its star and level, and every ability it casts. */
function championLines(e: { id: string, rarity: Rarity, owned: boolean, star: number, level: number }): string[] {
    const at = copyAt(e)
    const rarity = RARITY_STAT_MULTIPLIER[e.rarity]
    const investment = championInvestmentMultiplier(investmentScalar(at.star, at.level))
    return [
        `All stats ×${hqNumber(rarity * investment)}: rarity ×${hqNumber(rarity)}, star and level ×${hqNumber(investment)}.`,
        ...getChampion(e.id).abilities.map(a => `${a.name}: ${describeAbility(a, { caster: 'champion' })}`)
    ]
}

/** An equipped Active at the copy's potency, and for a wealth-scaled one the Gold banked now and what it does to the hit. */
function activeSkillLines(e: { id: string, owned: boolean, star: number, level: number }, wealthHours: number | null): string[] {
    const [kit] = skillActives([{ contentId: e.id, ...copyAt(e) }])
    if (!kit) return []
    const wealthFactor = wealthHours === null ? undefined : wealthFactorFor(wealthHours)
    return [
        describeAbility(kit, { caster: 'hero', wealthFactor }),
        ...(isWealthScaled(kit) && wealthHours !== null ? [describeWealth(wealthHours)] : [])
    ]
}

function craftButton(e: { maxed: boolean, craftCost: number }, essence: number) {
    return e.maxed ? null : { cost: formatNumber(e.craftCost), enabled: essence >= e.craftCost }
}

/** The saved formation: the Hero's row and every Champion's, fielded or not. */
function savedFormation(): Record<string, FormationRow> {
    const g = guild.value
    const formation: Record<string, FormationRow> = { hero: g?.heroRow ?? 'front' }
    for (const c of g?.roster ?? []) formation[c.id] = c.row
    return formation
}

/** The party as the Champion picker reads it: who is fielded, every row, the slot cap and a row's room. */
function partyState(): HqPartyState {
    const g = guild.value
    return { party: g?.partyChampionIds ?? [], formation: savedFormation(), slots: g?.slots ?? 0, maxSlots: MAX_CHAMPION_SLOTS, capacity: FORMATION_ROW_CAPACITY }
}

function collectionTiles(tab: HqCollectionTab): CollectionTile[] {
    switch (tab) {
        case 'gear': {
            const f = forge.value
            const essence = f?.essence ?? 0
            const worn = new Map((f?.slots ?? []).map(slot => [slot.slot, f?.roster.find(e => e.id === slot.equippedId)]))
            return (f?.roster ?? []).map((e) => {
                const line = modifierLine('stat', e.stat, e.equippedBonus)
                // against what the slot wears now: equipping replaces its bonus, and every owned passive stays
                const delta = e.equippedBonus - (worn.get(e.slot)?.equippedBonus ?? 0)
                const compared: CollectionLine = e.owned && !e.equipped && delta !== 0
                    ? { text: line, delta: hqPct(Math.abs(delta)), up: delta > 0 }
                    : line
                return {
                    ...e,
                    subtitle: GEAR_SLOT_NAME[e.slot],
                    mark: e.equipped ? 'E' as const : null,
                    upgrade: e.owned && !e.equipped && delta > 0,
                    sections: sections(
                        { active: e.owned, lines: [modifierLine('stat', e.stat, e.ownedBonus)] },
                        { title: 'Equipped', scope: 'Hero', active: e.equipped, lines: [compared] }
                    ),
                    // a slot always holds a piece, so equipped Gear is replaced rather than taken off
                    actions: e.owned ? [{ id: 'equip' as const, label: e.equipped ? 'Equipped' : 'Equip', enabled: !e.equipped }] : [],
                    picker: null,
                    craft: craftButton(e, essence)
                }
            })
        }
        case 'champions': {
            const g = guild.value
            const party = g?.partyChampionIds ?? []
            const formation = savedFormation()
            const state = partyState()
            return (g?.roster ?? []).map(e => ({
                ...e,
                subtitle: e.archetypeName,
                // the row it fights in: F front, B back
                mark: party.includes(e.id) ? (formation[e.id] === 'front' ? 'F' as const : 'B' as const) : null,
                sections: sections(
                    { active: e.owned, lines: e.collectionStats.map(stat => modifierLine('stat', stat, e.collectionBonus)) },
                    { title: 'Fielded', scope: 'In the party', active: party.includes(e.id), lines: championLines(e) }
                ),
                actions: equipActions(e.owned),
                picker: e.owned ? hqChampionPicker(e.id, state) : null,
                craft: craftButton(e, g?.essence ?? 0)
            }))
        }
        case 'skills': {
            const t = training.value
            const equipped = t?.equippedSkillIds ?? []
            return (t?.roster ?? []).map(e => ({
                ...e,
                subtitle: e.type,
                mark: equipped.includes(e.id) ? 'E' as const : null,
                // an Active has no lines to share: it only does anything slotted, where it fires
                sections: sections(
                    {
                        active: e.owned,
                        lines: e.modifiers.flatMap(m => m.ownedMagnitude === null ? [] : [modifierLine(m.kind, m.stat, m.ownedMagnitude)])
                    },
                    {
                        title: 'Equipped',
                        scope: 'Hero',
                        active: equipped.includes(e.id),
                        lines: e.type === 'active' ? activeSkillLines(e, t?.wealthHours ?? null) : e.modifiers.map(m => modifierLine(m.kind, m.stat, m.magnitude))
                    }
                ),
                actions: equipActions(e.owned),
                picker: e.owned ? hqSlotPicker(e.id, equipped, t?.slotCount ?? 0, MAX_SKILL_SLOTS, 'skill') : null,
                craft: craftButton(e, t?.essence ?? 0)
            }))
        }
        case 'artifacts': {
            const d = digSite.value
            const equipped = d?.equippedArtifactIds ?? []
            return (d?.roster ?? []).map(e => ({
                ...e,
                subtitle: e.categoryName,
                mark: equipped.includes(e.id) ? 'E' as const : null,
                sections: sections(
                    {
                        active: e.owned,
                        lines: e.effects.flatMap(f => f.ownedMagnitude === null ? [] : [`${f.name}: ${modifierLine(f.kind, f.stat, f.ownedMagnitude)}`])
                    },
                    {
                        title: 'Equipped',
                        scope: 'Whole party',
                        active: equipped.includes(e.id),
                        lines: e.effects.map(f => `${f.name}: ${modifierLine(f.kind, f.stat, f.magnitude)}`)
                    }
                ),
                actions: equipActions(e.owned),
                picker: e.owned ? hqSlotPicker(e.id, equipped, d?.slotCount ?? 0, MAX_ARTIFACT_SLOTS, 'artifact') : null,
                craft: craftButton(e, d?.essence ?? 0)
            }))
        }
    }
}

const collections = computed(() => {
    const tab = hqCollectionTabOf(route.path)
    // common to mythic, as the encyclopedia reads; a stable sort keeps the roster's order within a rarity
    const entries = collectionTiles(tab).sort((a, b) => RARITIES.indexOf(a.rarity as Rarity) - RARITIES.indexOf(b.rarity as Rarity))
    const essence = { gear: forge, champions: guild, skills: training, artifacts: digSite }[tab].value?.essence ?? 0
    return { tab, entries, essence: formatNumber(essence), heroClassId: hero.value?.classId ?? null }
})

/**
 * Something in any tab can be upgraded: an owned entry whose next level the Essence covers, or
 * owned Gear that beats what its slot wears. Dots the Collections button.
 */
const collectionsUpgrade = computed(() => {
    const levelable = (g: { essence: number, roster: readonly { owned: boolean, maxed: boolean, craftCost: number }[] } | null) =>
        !!g?.roster.some(e => e.owned && !e.maxed && g.essence >= e.craftCost)
    if ([forge.value, guild.value, training.value, digSite.value].some(levelable)) return true
    return collectionTiles('gear').some(e => e.upgrade)
})

function openCollectionTab(tab: HqCollectionTab) {
    void navigateTo(hqCollectionTabPath(tab))
}

/** Put a Gear piece on at once, in its slot: the stage has no draft to commit, unlike the pages. */
async function equipGear(id: string) {
    const piece = forge.value?.roster.find(e => e.id === id)
    if (!piece) return
    const gear: Record<string, string> = {}
    for (const slot of forge.value?.slots ?? []) if (slot.equippedId) gear[slot.slot] = slot.equippedId
    gear[piece.slot] = id
    await setLoadout({ gear }, '')
}

/** Carry out a picker's pick, or its Bench/Unequip; a pick that changes nothing sends nothing. */
async function pickEntry(tab: HqCollectionTab, id: string, pick: string) {
    switch (tab) {
        case 'champions': {
            const next = hqApplyChampionPick(id, pick, partyState())
            if (next) await setLoadout(next, '')
            return
        }
        case 'skills': {
            const t = training.value
            const skillIds = hqApplySlotPick(id, pick, t?.equippedSkillIds ?? [], t?.slotCount ?? 0)
            if (skillIds) await setLoadout({ skillIds }, '')
            return
        }
        case 'artifacts': {
            const d = digSite.value
            const artifactIds = hqApplySlotPick(id, pick, d?.equippedArtifactIds ?? [], d?.slotCount ?? 0)
            if (artifactIds) await setLoadout({ artifactIds }, '')
        }
    }
}

const collectionsBusy = ref(false)

async function withCollections(work: () => Promise<unknown>) {
    collectionsBusy.value = true
    try {
        await work()
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        collectionsBusy.value = false
    }
}

function onCollectionAction(action: DetailButton, id: string) {
    const tab = collections.value.tab
    void withCollections(() => action === 'craft' ? craft(SYSTEM_OF[tab], id) : equipGear(id))
}

function onCollectionPick(id: string, pick: string) {
    const tab = collections.value.tab
    void withCollections(() => pickEntry(tab, id, pick))
}

/**
 * The Loadouts scene's slots: every one up to the maximum, locked ones included, each with what it
 * holds resolved against the rosters for its tiles. A slot is active while the live setup holds
 * the same party in the same rows, Skills, Artifacts and Gear; Apply filters a preset through
 * today's slots, so one saved under more slots than are open now never reads active.
 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every(id => b.includes(id))
}

/** A preferred-Loadout target's name: a raid's, or the Arena. */
function targetName(target: string): string {
    return RAIDS.find(r => r.id === target)?.name ?? 'Arena'
}

const loadoutsView = computed<LoadoutsView>(() => {
    const l = loadouts.value
    const g = guild.value
    if (!l) return { slots: [], unlocked: 0, max: 0 }
    const rarity = (roster: readonly { id: string, rarity: string }[] | undefined) => {
        const map = new Map((roster ?? []).map(e => [e.id, e.rarity]))
        return (id: string): LoadoutEntry => ({ id, rarity: map.get(id) ?? 'common' })
    }
    const champion = rarity(g?.roster)
    const skill = rarity(training.value?.roster)
    const artifact = rarity(digSite.value?.roster)
    const gear = rarity(forge.value?.roster)

    const liveFormation = savedFormation()
    const liveParty = g?.partyChampionIds ?? []
    const liveGear: Record<string, string> = {}
    for (const slot of forge.value?.slots ?? []) if (slot.equippedId) liveGear[slot.slot] = slot.equippedId

    // which raids (and the Arena) point at each slot, so Save never overwrites one blindly
    const usedBy = (slotIndex: number) => LOADOUT_TARGETS.filter(t => loadoutPreferences.value[t] === slotIndex).map(targetName)

    const slots: LoadoutSlotView[] = Array.from({ length: l.maxSlots }, (_, slotIndex) => {
        const locked = slotIndex >= l.slots
        const preset = locked ? undefined : l.saved.find(p => p.slotIndex === slotIndex)
        const base = { slotIndex, locked, name: preset?.name ?? `Loadout ${slotIndex + 1}`, party: [], skills: [], artifacts: [], gear: [], usedBy: preset ? usedBy(slotIndex) : [] }
        if (!preset) {
            // only the next slot to buy has a price; the ones past it wait their turn
            const price = locked && slotIndex === l.slots && l.nextSlotCostGems !== null ? formatNumber(l.nextSlotCostGems) : null
            return { ...base, price, empty: !locked, active: false }
        }
        const rowOf = (id: string) => preset.formation[id] ?? liveFormation[id] ?? 'front'
        const active = sameSet(preset.partyChampionIds, liveParty)
            && preset.partyChampionIds.every(id => rowOf(id) === liveFormation[id])
            && (preset.formation.hero ?? liveFormation.hero) === liveFormation.hero
            && sameSet(preset.equippedSkillIds, training.value?.equippedSkillIds ?? [])
            && sameSet(preset.equippedArtifactIds, digSite.value?.equippedArtifactIds ?? [])
            && sameSet(Object.entries(preset.equippedGear).map(([k, v]) => `${k}:${v}`), Object.entries(liveGear).map(([k, v]) => `${k}:${v}`))
        return {
            ...base,
            price: null,
            empty: false,
            active,
            party: preset.partyChampionIds.map(id => ({ ...champion(id), row: rowOf(id) })),
            skills: preset.equippedSkillIds.map(skill),
            artifacts: preset.equippedArtifactIds.map(artifact),
            // in slot order, so the six read the same way on every slot
            gear: GEAR_SLOTS.flatMap(slot => preset.equippedGear[slot] ? [gear(preset.equippedGear[slot]!)] : [])
        }
    })
    return { slots, unlocked: l.slots, max: l.maxSlots }
})

const loadoutsBusy = ref(false)

async function withLoadouts(action: () => Promise<unknown>) {
    loadoutsBusy.value = true
    try {
        await action()
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        loadoutsBusy.value = false
    }
}

/**
 * Save keeps the slot's name, or takes the one being typed when Save was pressed mid-rename.
 * Renaming alone is its own action, since saving re-snapshots the live setup.
 */
function onLoadoutAction(action: 'save' | 'apply', slotIndex: number, name?: string) {
    const slot = loadoutsView.value.slots.find(s => s.slotIndex === slotIndex)
    void withLoadouts(() => action === 'save' ? saveLoadout(slotIndex, name ?? slot?.name) : applyLoadout(slotIndex))
}

function onLoadoutRename(slotIndex: number, name: string) {
    void withLoadouts(() => renameLoadout(slotIndex, name))
}

/**
 * The Prestige scene's shop: every track with what it gives now and next, its price, and whether
 * the balance it is priced in covers it. Loadout slots take Gems, everything else Void Shards.
 * Maxed tracks sink to the end, the rest keeping the shop's own order (the sort is stable), but
 * only as the scene opens: the order is frozen while it is up, so a track maxed by the last press
 * stays under the pointer instead of jumping away, and moves back the next time the shop opens.
 */
const shopOrder = ref<string[]>([])

function freezeShopOrder() {
    const tracks = shop.value ?? []
    shopOrder.value = [...tracks]
        .sort((a, b) => Number(a.nextCost === null) - Number(b.nextCost === null))
        .map(track => track.id)
}

watch(() => props.scene, (scene) => {
    if (scene === 'shop') freezeShopOrder()
}, { immediate: true })

// opened before the payload landed (a reload straight onto the scene): freeze once it arrives
watch(shop, (tracks) => {
    if (props.scene === 'shop' && !shopOrder.value.length && tracks?.length) freezeShopOrder()
})

/** The Shop's tab, off the route: Upgrades, or Battle Speed. */
const shopTab = computed<HqShopTab>(() => hqShopTabOf(route.path))

function onShopTab(tab: HqShopTab) {
    void navigateTo(hqShopTabPath(tab))
}

/** The Calendar's tab, off the route: the login calendar, or the Milestones. */
const calendarTab = computed<HqCalendarTab>(() => hqCalendarTabOf(route.path))

function onCalendarTab(tab: HqCalendarTab) {
    void navigateTo(hqCalendarTabPath(tab))
}

/**
 * Where the player stands, as the tutorials read it: Battle Speed's and the Milestones' own
 * tutorials play on their tabs, the scenes they had before they moved there.
 */
const tutorialScene = computed<string>(() => {
    if (props.scene === 'shop' && shopTab.value === 'speed') return 'speed'
    if (props.scene === 'calendar' && calendarTab.value === 'milestones') return 'milestones'
    return props.scene
})

const prestigeView = computed<PrestigeView>(() => {
    const shards = D(voidShards.value ?? '0')
    const gems = user.value?.gems ?? 0
    const gold = parseFloat(user.value?.balance ?? '0') || 0
    // a track the frozen order does not know yet goes last
    const rank = (id: string) => {
        const i = shopOrder.value.indexOf(id)
        return i < 0 ? shopOrder.value.length : i
    }
    return {
        voidShards: formatHq(voidShards.value ?? '0'),
        gems: formatNumber(gems),
        gold: formatNumber(gold),
        tracks: (shop.value ?? []).map(track => ({
            id: track.id,
            name: track.name,
            level: track.level,
            maxLevel: track.maxLevel,
            current: track.effect.current,
            next: track.effect.next,
            cost: track.nextCost === null ? null : formatNumber(track.nextCost),
            currency: track.currency,
            affordable: track.nextCost !== null && (track.currency === 'gems'
                ? gems >= track.nextCost
                : track.currency === 'gold' ? gold >= track.nextCost : shards.gte(track.nextCost))
        })).sort((a, b) => rank(a.id) - rank(b.id)),
        armed: confirm.armed.value?.startsWith('shop:') ? confirm.armed.value.slice(5) : null
    }
})

const prestigeBusy = ref(false)

/** The Classes scene: the tree with what each class costs to take, and whether the token is held. */
const classesView = computed<ClassesView>(() => ({
    classes: (classTree.value ?? []).map(node => ({
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        tier: node.tier,
        skillName: node.skill.name,
        pickable: node.pickable,
        costsToken: node.costsToken,
        current: node.current
    })),
    token: classToken.value,
    ascendant: ascendant.value
        ? {
            mastersPrestiged: ascendant.value.mastersPrestiged.length,
            masters: ascendant.value.masters.length,
            picks: ascendant.value.skillIds,
            kitSize: ascendant.value.kitSize,
            skills: ascendant.value.pickable
        }
        : null
}))

const classesBusy = ref(false)

/** The Ascendant's picks, set live like any other Loadout component. */
async function onSetAscendantKit(skillIds: string[]) {
    classesBusy.value = true
    try {
        await setLoadout({ ascendantSkillIds: skillIds }, '')
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        classesBusy.value = false
    }
}

async function onPickClass(classId: string) {
    classesBusy.value = true
    try {
        await pickClass(classId)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        classesBusy.value = false
    }
}

/** The four gachas' payloads, in the order the scene hangs their banners. */
const gachaPayloads = computed(() => [
    { system: 'gear' as const, payload: forge.value },
    { system: 'champion' as const, payload: guild.value },
    { system: 'skill' as const, payload: training.value },
    { system: 'artifact' as const, payload: digSite.value }
])

/** Each gacha's free-ten countdown; one each, since each has its own cooldown. */
const freeCountdowns = {
    gear: useHqCountdown(() => forge.value?.freePull.available ? null : forge.value?.freePull.unlocksAt),
    champion: useHqCountdown(() => guild.value?.freePull.available ? null : guild.value?.freePull.unlocksAt),
    skill: useHqCountdown(() => training.value?.freePull.available ? null : training.value?.freePull.unlocksAt),
    artifact: useHqCountdown(() => digSite.value?.freePull.available ? null : digSite.value?.freePull.unlocksAt)
}

/** The pull on the reveal board; `key` deals it again even when a pull repeats the last one's cards. */
const gachaReveal = ref<GachaView['reveal']>(null)
let revealKey = 0

/** The Gacha scene: a banner per gacha, the Gold a Seal costs, and the pull being revealed. */
const gachaView = computed<GachaView>(() => {
    const gold = parseFloat(user.value?.balance ?? '0')
    const banners: GachaBannerView[] = []
    for (const { system, payload: g } of gachaPayloads.value) {
        if (!g) continue
        const left = freeCountdowns[system].value
        banners.push({
            system,
            level: g.gachaLevel,
            levelProgress: g.pullsToNextLevel ? g.gachaProgress / g.pullsToNextLevel : 1,
            seals: g.seals,
            essence: formatNumber(g.essence),
            owned: g.roster.filter(entry => entry.owned).length,
            total: g.roster.length,
            dropRates: g.dropRates,
            free: g.freePull.available ? { state: 'ready' } : left ? { state: 'wait', left } : { state: 'spent' },
            freeLeft: g.freePull.remaining,
            freePerDay: FREE_PULLS_PER_DAY,
            one: pullPrice(system, g, 1, gold),
            ten: pullPrice(system, g, 10, gold)
        })
    }
    return { banners, gold: formatNumber(gold), reveal: gachaReveal.value, armed: gachaArmed.value }
})

/**
 * What a pull costs a banner: Seals from its balance, and the rest bought off today's Gold ladder,
 * priced by the same function the server charges with.
 */
function pullPrice(system: GachaSystemId, g: { seals: number, singleCost: number, tenPullCost: number, sealsBoughtToday: number }, count: 1 | 10, gold: number): PullPrice {
    const cost = count === 10 ? g.tenPullCost : g.singleCost
    const fromBalance = Math.min(cost, g.seals)
    const short = cost - fromBalance
    const goldCost = short > 0 ? sealLadderTotal(system, g.sealsBoughtToday, short) : 0
    return { cost, pulls: count, fromBalance, gold: goldCost, goldText: formatNumber(goldCost), affordable: gold >= goldCost }
}

/**
 * A spend of a hard-won currency waits for a second press: Gold on a pull's Seals, Void Shards or
 * Gems in the shop, Gems on Battle Speed and in the Arena. Each is keyed by what was pressed, and
 * each currency's confirm can be turned off in Settings.
 */
const confirm = useHqConfirm()
const gachaArmed = computed<GachaView['armed']>(() => {
    const [kind, system, button] = confirm.armed.value?.split(':') ?? []
    return kind === 'pull' ? { system: system as GachaSystemId, button: button as 'one' | 'ten' } : null
})

const gachaBusy = ref(false)

// a reveal left up, or a spend waiting for its confirm, belongs to the visit that started it
watch(() => props.scene, () => {
    gachaReveal.value = null
    confirm.clear()
})

async function onGachaAction(system: GachaSystemId, button: GachaButton) {
    // a pull that buys Seals with Gold waits for a second press, unless that is turned off in Settings
    const price = button === 'free' ? null : gachaView.value.banners.find(b => b.system === system)?.[button]
    const asks = button !== 'free' && !!price && price.gold > 0 && (settings.value?.confirmGoldSeals ?? true)
    if (asks && !confirm.press(`pull:${system}:${button}`)) return
    confirm.clear()
    gachaBusy.value = true
    try {
        const result = button === 'free'
            ? await freePull(system)
            : await pull(system, button === 'one' ? 1 : 10, price && price.gold > 0 ? price.gold : undefined)
        const cards: GachaCard[] = (result?.pulls ?? []).map(p => ({ contentId: p.contentId, rarity: p.rarity, isNew: p.isNew, level: p.level, essence: p.essence }))
        if (cards.length) gachaReveal.value = { key: ++revealKey, system, cards }
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        gachaBusy.value = false
    }
}

/**
 * The Raids scene's rows: each raid's Keys, how long until more come, and its best. The countdown
 * reads the shared clock, so it ticks without a payload.
 */
const raidClock = useHqClock()
const raidRows = computed<RaidRowView[]>(() => (raids.value ?? []).map(r => ({
    id: r.id as RaidId,
    open: r.open,
    loadout: preferredName(r.id),
    loadoutSlot: preferredName(r.id) === null ? null : loadoutPreferences.value[r.id] ?? null,
    loadoutLive: loadoutSession.value?.target === r.id && loadoutSession.value.slotIndex !== null,
    keys: r.keys,
    keyCap: r.keyCap,
    nextKeys: r.nextKeyAt === null ? null : countdown(r.nextKeyAt - raidClock.value),
    best: r.best,
    bestReward: r.bestReward
})))

/** The name of the saved slot a raid points at, or null with none. */
function preferredName(target: string): string | null {
    const slot = loadoutPreferences.value[target]
    if (slot === undefined) return null
    return loadouts.value?.saved.find(p => p.slotIndex === slot)?.name ?? null
}

/** The saved slots a raid's picker lists, in slot order. */
const raidLoadoutOptions = computed<RaidLoadoutOption[]>(() => (loadouts.value?.saved ?? [])
    .map(p => ({ slotIndex: p.slotIndex, name: p.name }))
    .sort((a, b) => a.slotIndex - b.slotIndex))

/**
 * A line picked off a raid's Loadout list: the slot it now points at, or none (`loadouts.md` §4).
 * Free; the live loadout moves on the raid's next engage.
 */
async function onRaidLoadout(raidId: RaidId, slotIndex: number | null) {
    if ((loadoutPreferences.value[raidId] ?? null) === slotIndex) return
    raidsBusy.value = true
    try {
        await setLoadoutPreference(raidId, slotIndex)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        raidsBusy.value = false
    }
}

/** `Hh MMm` past an hour, `mm:ss` under one. */
function countdown(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const pad = (value: number) => String(value).padStart(2, '0')
    return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${pad(minutes)}:${pad(seconds % 60)}`
}

/**
 * The raid round the stage is playing in place of the run. Entered from the Raids scene, it is
 * played on the battle; a few seconds after its result goes up the run comes back.
 */
const raidRound = ref<StageRaid | null>(null)
const raidsBusy = ref(false)
/** What the round on the stage paid, held until its replay ends and the popup says so. */
let roundReward: RaidRewardView | null = null
/** The reward popup, after a round's replay ends or a quick-clear lands; its button puts it (and the round) away. */
const raidReward = ref<RaidRewardView | null>(null)
/** A beat between the round's last blow and the popup, so the end is seen. */
const RAID_REWARD_DELAY_MS = 900
let raidHold: ReturnType<typeof setTimeout> | null = null

function closeRaidReward() {
    raidReward.value = null
    // after a round, back to the Raids scene to go again; after a quick-clear it is still there
    if (raidRound.value) {
        // already on the Raids scene (the browser went back mid-round), there is no beat to cover
        raidReturning.value = props.scene !== 'raids'
        emit('scene', 'raids')
    }
    raidRound.value = null
}

/**
 * Leaving the raid lets the run go on and puts back the loadout its preferred one replaced
 * (`loadouts.md` §4): not after each attempt, but once the player is neither on the Raids scene
 * nor watching a round. Every raid opens a session, so every raid is left this way. A reload
 * onto another scene leaves too, since the session is the server's. `raidReturning` covers the
 * beat between a round's popup closing and the route reaching the Raids scene again.
 */
const raidReturning = ref(false)
// the route has moved, to the Raids scene or anywhere else: the beat is over either way
watch(() => props.scene, () => {
    raidReturning.value = false
})
const inRaid = computed(() => props.scene === 'raids' || raidRound.value !== null || raidReturning.value)
/**
 * Whether the player is still where the open Loadout session belongs: a raid's in the Raids scene or
 * a round, the Arena's in the Arena or an Arena round (the user's call, 2026-10-10: the Arena's
 * preferred Loadout works exactly as a raid's). Anywhere else the session is left.
 */
const inSessionScene = computed(() => {
    const target = loadoutSession.value?.target
    if (target === 'arena') return props.scene === 'arena' || arenaRound.value !== null || arenaResult.value !== null
    return inRaid.value
})
let leavingRaid = false

async function leaveRaidIfOpen() {
    if (import.meta.server || inSessionScene.value || !loadoutSession.value || leavingRaid) return
    leavingRaid = true
    try {
        await leaveRaid()
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        leavingRaid = false
    }
}
watch([inSessionScene, loadoutSession], () => { void leaveRaidIfOpen() }, { immediate: true })
onUnmounted(() => {
    // off Hero Quest altogether: the server puts it back; nothing here is left to refresh
    if (loadoutSession.value) void $fetch('/api/hero-quest/raid/leave', { method: 'POST' }).catch(() => {})
})

async function onRaidEnter(raidId: RaidId) {
    raidsBusy.value = true
    try {
        const round = await engageRaid(raidId)
        if (!round) return
        fightProgress.value = { time: 0, done: false }
        // a boss raid lost pays nothing and keeps its Key; the dummy always pays
        const won = round.reward > 0
        roundReward = { raidId, quick: false, won, level: round.level, newBest: round.newBest, reward: round.reward }
        raidRound.value = {
            raid: raidId.slice(5) as StageRaidId,
            level: round.level,
            // the Beast has no clock, only the guard rail its run can't outlast
            timer: raidId === 'raid_training_grounds' ? RAID_DUMMY_SECONDS : raidId === 'raid_trait' ? RAID_RAMPAGE_CAP_SECONDS : RAID_ENRAGE_SECONDS,
            outcome: round.outcome,
            secondsElapsed: round.secondsElapsed,
            events: round.events,
            partyIds: round.partyIds,
            partyMaxHps: round.partyMaxHps,
            enemyMaxHps: round.enemyMaxHps
        }
        emit('scene', 'battle')
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        raidsBusy.value = false
    }
}

async function onRaidQuick(raidId: RaidId) {
    raidsBusy.value = true
    try {
        const cleared = await quickClearRaid(raidId)
        if (cleared) raidReward.value = { raidId, quick: true, won: true, level: cleared.level, newBest: false, reward: cleared.reward }
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        raidsBusy.value = false
    }
}

/**
 * The Arena scene: the payload's Medals, Rating, attacks and defence, and the reads its tabs make
 * as they open (the opponent list, the battle log, the leaderboard). The stage keeps the tab and
 * page; everything here is the server's.
 */
const arenaClock = useHqClock()
const arenaBusy = ref(false)

/** `4D 03H` past a day, `5H 12M` under one. */
function spanLeft(ms: number): string {
    const minutes = Math.max(0, Math.floor(ms / 60_000))
    const days = Math.floor(minutes / 1440)
    const hours = Math.floor((minutes % 1440) / 60)
    if (days > 0) return `${days}D ${String(hours).padStart(2, '0')}H`
    return `${hours}H ${String(minutes % 60).padStart(2, '0')}M`
}

/** How long ago, in the log's terms. */
function ago(at: number): string {
    const minutes = Math.max(0, Math.floor((arenaClock.value - at) / 60_000))
    if (minutes < 60) return `${minutes}M`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}H`
    return `${Math.floor(minutes / 1440)}D`
}

const ARENA_SEAL_NAMES: Readonly<Record<string, string>> = { champion: 'Guild Seal', skill: 'Skill Seal', artifact: 'Excavation Seal', gear: 'Forge Seal' }

const arenaShop: ArenaItemView[] = ARENA_SHOP.map((item) => {
    switch (item.kind) {
        case 'seals': return { id: item.id, kind: item.kind, system: item.system, name: ARENA_SEAL_NAMES[item.system] ?? 'Seal', sub: '', price: item.price }
        case 'keys': return { id: item.id, kind: item.kind, raid: item.raid, name: getRaid(item.raid).key.replace(/s$/, ''), sub: '', price: item.price }
        case 'gems': return { id: item.id, kind: item.kind, name: 'Gem', sub: '', price: item.price }
    }
})

/** A party as faces on its rows: the Hero's class and each Champion. */
function facesOf(classId: string, heroRow: 'front' | 'back', champions: readonly { id: string, row: 'front' | 'back' }[]): ArenaFace[] {
    return [{ asset: `hero/${classId}`, row: heroRow }, ...champions.map(c => ({ asset: `champion/${c.id}`, row: c.row }))]
}

const arenaView = computed<Omit<ArenaView, 'tab' | 'page' | 'pickerOpen' | 'rewardsOpen'>>(() => {
    const a = arena.value
    const rarityIn = (roster: readonly { id: string, rarity: string }[] | undefined) => {
        const map = new Map((roster ?? []).map(e => [e.id, e.rarity]))
        return (id: string) => ({ id, rarity: map.get(id) ?? 'common' })
    }
    const d = a?.defense
    const board = arenaBoard.value
    const rows: ArenaBoardRow[] = board
        ? [...board.top, ...(board.around.length ? [{ rank: 0, name: '', rating: 0, you: false, gap: true }, ...board.around] : [])]
        : []
    return {
        busy: arenaBusy.value,
        rating: a?.rating ?? 0,
        medals: a?.medals ?? 0,
        season: a?.season ?? 1,
        seasonLeft: a ? spanLeft(a.seasonEndsAt - arenaClock.value) : '',
        attemptsLeft: a?.attempts.left ?? 0,
        attemptsFree: a?.attempts.free ?? 0,
        attemptPrice: a?.attempts.nextPrice ?? 0,
        refreshPrice: a?.refreshes.nextPrice ?? 0,
        refreshesLeft: a ? Math.max(0, a.refreshes.free - a.refreshes.used) : 0,
        gems: user.value?.gems ?? 0,
        armed: confirm.armed.value?.startsWith('arena:') ? confirm.armed.value.slice(6) as 'refresh' | 'buy-attempt' : null,
        rewards: a?.unclaimed ?? [],
        candidates: arenaCandidates.value?.map(c => ({
            slot: c.slot,
            id: c.id,
            dummy: c.dummy,
            name: c.name,
            rating: c.rating,
            gpn: c.defenseGpn ? formatHq(c.defenseGpn) : null,
            faces: c.classId ? facesOf(c.classId, c.heroRow ?? 'front', c.champions) : []
        })) ?? null,
        defense: d
            ? {
                gpn: d.gpn ? formatHq(d.gpn) : '-',
                faces: facesOf(hero.value?.classId ?? 'class_beginner', d.formation.hero ?? guild.value?.heroRow ?? 'front', d.partyChampionIds.map(id => ({ id, row: d.formation[id] ?? 'front' }))),
                skills: d.equippedSkillIds.map(rarityIn(training.value?.roster)),
                artifacts: d.equippedArtifactIds.map(rarityIn(digSite.value?.roster)),
                gear: GEAR_SLOTS.flatMap(slot => d.equippedGear[slot] ? [rarityIn(forge.value?.roster)(d.equippedGear[slot]!)] : [])
            }
            : null,
        // the Arena's preferred Loadout, picked as a raid's is (`loadouts.md` §4)
        loadout: preferredName('arena'),
        loadoutLive: loadoutSession.value?.target === 'arena' && loadoutSession.value.slotIndex !== null,
        loadoutSlot: preferredName('arena') === null ? null : loadoutPreferences.value.arena ?? null,
        loadoutOptions: raidLoadoutOptions.value,
        shop: arenaShop,
        log: arenaLog.value?.map(e => ({
            outcome: e.role === 'attacker' ? (e.won ? 'WON' : 'LOST') : (e.won ? 'HELD' : 'FELL'),
            won: e.won,
            attacker: e.role === 'attacker',
            opponent: e.opponentName,
            ratingChange: e.ratingChange,
            medals: e.medalsEarned,
            ago: ago(e.at)
        })) ?? null,
        board: board ? { rows, me: board.me } : null
    }
})

/** The party's stats over the battle, opened from the badge's portrait: the read once it lands, and the cell whose sources are open. */
const partyStatsOpen = ref(false)
const partyStatsPayload = ref<PartyStatsPayload | null>(null)
const partyStatCell = ref<{ row: number, unit: number } | null>(null)
let partyStatsRead = 0
const partyStats = computed<PartyStatsView | null>(() => {
    if (!partyStatsOpen.value) return null
    if (!partyStatsPayload.value) return { units: null }
    return partyStatsView(partyStatsPayload.value, liveHero.value?.className ?? '', hero.value?.classId ?? 'class_beginner', partyStatCell.value)
})

async function openPartyStats() {
    const read = ++partyStatsRead
    partyStatsOpen.value = true
    partyStatsPayload.value = null
    partyStatCell.value = null
    try {
        const payload = await $fetch<PartyStatsPayload>('/api/hero-quest/stats')
        // shut, or opened again, while it was out
        if (read === partyStatsRead && partyStatsOpen.value) partyStatsPayload.value = payload
    } catch (e) {
        if (read === partyStatsRead) partyStatsOpen.value = false
        toast.add({ title: apiErrorMessage(e, 'Could not load the party stats'), color: 'error' })
    }
}

function closePartyStats() {
    partyStatsRead++
    partyStatsOpen.value = false
    partyStatsPayload.value = null
    partyStatCell.value = null
}

// they belong to the battle: leaving it shuts them
watch(() => props.scene, closePartyStats)

/** Run a read for the Arena; a failure is an error toast, never a thrown page. */
async function arenaRead(read: () => Promise<void>) {
    try {
        await read()
    } catch (e) {
        toast.add({ title: apiErrorMessage(e, 'Could not load the Arena'), color: 'error' })
    }
}

/** A tab opened: the reads it shows go out, the list only when there is none yet. */
function onArenaTab(tab: HqArenaTab) {
    if (tab === 'fight' && !arenaCandidates.value) void arenaRead(loadArenaCandidates)
    if (tab === 'log') void arenaRead(loadArenaLog)
    if (tab === 'ranking') void arenaRead(loadArenaBoard)
}

/** The Arena attack the stage is playing in place of the run, and what it came to, held until its replay ends. */
const arenaRound = ref<StageArena | null>(null)
const arenaResult = ref<ArenaResultView | null>(null)
let arenaOutcome: ArenaResultView | null = null

async function onArenaAction(target: ArenaTarget) {
    // a refresh or an attack paid in Gems waits for a second press, unless that is turned off in Settings
    const view = arenaView.value
    const price = target === 'refresh' ? view.refreshPrice : target === 'buy-attempt' ? view.attemptPrice : 0
    if (price > 0 && (settings.value?.confirmGemSpends ?? true) && !confirm.press(`arena:${target}`)) return
    confirm.clear()
    arenaBusy.value = true
    try {
        if (target.startsWith('attack:')) await startArenaAttack(Number(target.slice(7)))
        else if (target === 'refresh') await refreshArenaCandidates()
        else if (target === 'buy-attempt') await buyArenaAttempt()
        else if (target === 'claim') await claimArenaSeason()
        else if (target === 'def:set') await setArenaDefense()
        else if (target.startsWith('pick:')) {
            const key = target.slice(5)
            const slot = key === 'none' ? null : Number(key)
            if ((loadoutPreferences.value.arena ?? null) !== slot) await setLoadoutPreference('arena', slot)
        }
        else if (target.startsWith('shop:')) {
            const [, itemId, quantity] = target.split(':')
            await buyArenaItem(itemId!, Number(quantity))
        }
    } catch {
        // `useHeroQuest` has already shown the error; an attack refused for a stale list gets a fresh one
        if (target.startsWith('attack:')) void arenaRead(loadArenaCandidates)
    } finally {
        arenaBusy.value = false
    }
}

async function startArenaAttack(slot: number) {
    const candidate = arenaCandidates.value?.[slot]
    if (!candidate) return
    const round = await attackArena(slot, candidate.id)
    if (!round) return
    fightProgress.value = { time: 0, done: false }
    arenaOutcome = { won: round.won, dummy: round.dummy, opponent: round.opponentName, ratingChange: round.ratingChange, rating: round.rating, medals: round.medals }
    arenaRound.value = {
        outcome: round.outcome,
        secondsElapsed: round.secondsElapsed,
        events: round.events,
        partyIds: round.partyIds,
        partyMaxHps: round.partyMaxHps,
        enemyMaxHps: round.enemyMaxHps,
        opponent: round.opponentName,
        enemy: round.enemy,
        // Battle Speed never touches an Arena fight (§1): it plays at its own pace
        timer: ARENA_FIGHT_SECONDS
    }
    emit('scene', 'battle')
}

/** The result popup's button: the round is put away and the Arena comes back, to go again. */
function closeArenaResult() {
    arenaResult.value = null
    arenaRound.value = null
    emit('scene', 'arena')
}

/** The Settings scene: every setting's value, and the tutorials ready to reset. */
const { size: stageSize, setSize: setStageSize } = useHqStageSize()
const settingsView = computed<SettingsView>(() => ({ settings: settings.value ?? { ...HQ_SETTING_DEFAULTS }, tutorialsReady: true, stageSize: stageSize.value }))
const settingsBusy = ref(false)

async function onSetting(target: SettingsTarget) {
    // this browser's choice, so nothing goes to the server
    if (isStageTarget(target)) return setStageSize(target.slice(6) as HqStageSize)
    settingsBusy.value = true
    try {
        if (target === 'resetTutorials') {
            seenLocally.value = []
            await resetTutorials()
        } else await setSetting(target, !settingsView.value.settings[target])
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        settingsBusy.value = false
    }
}

/** The time to the calendar's next day, and the whole days left in its cycle. */
const calendarNextDay = useHqCountdown(() => calendar.value?.nextDayAt)
const calendarClock = useHqClock()

/** The Calendar scene: every day's reward and state, the make-ups, and the clocks. */
const calendarView = computed<CalendarView>(() => {
    const c = calendar.value
    return {
        today: c?.today ?? 0,
        days: c?.days ?? [],
        makeupsLeft: c?.makeupsLeft ?? 0,
        makeupsPerCycle: CALENDAR_MAKEUPS_PER_CYCLE,
        makeupDay: c?.makeupDay ?? null,
        nextDayIn: (calendarNextDay.value ?? '').toUpperCase(),
        cycleDaysLeft: c ? Math.max(1, Math.ceil((c.endsAt - calendarClock.value) / 86_400_000)) : 0
    }
})
const calendarBusy = ref(false)

async function onClaimCalendar(makeup: boolean) {
    calendarBusy.value = true
    try {
        await claimCalendar(makeup)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        calendarBusy.value = false
    }
}

const SEAL_NAMES: Readonly<Record<string, string>> = { gear: 'FORGE SEALS', champion: 'GUILD SEALS', skill: 'SKILL SEALS', artifact: 'EXCAVATION SEALS' }

/**
 * The Gold chest shows while the last read says it holds Gold. Not the live forecast: that would
 * bring it straight back after an open, where the read leaves it gone until the next poll.
 */
const chestBusy = ref(false)
const goldChest = computed(() => !chestBusy.value && D(chestGold.value).gt(0))
const chestToast = ref<ChestToast | null>(null)

/** Open the chest: what it paid, or why it didn't, is toasted on the canvas rather than the platform. */
async function onChestCollect() {
    if (chestBusy.value) return
    chestBusy.value = true
    const key = (chestToast.value?.key ?? 0) + 1
    try {
        const res = await collectChest()
        if (res) chestToast.value = { key, text: `+${formatHq(res.collected)} GOLD`, error: false }
    } catch (e) {
        chestToast.value = { key, text: apiErrorMessage(e, 'Could not open the chest').toUpperCase(), error: true }
    } finally {
        chestBusy.value = false
    }
}

/** The holiday gift waiting in the battle view's corner: the earliest open one not yet claimed. */
const holidayGift = computed<HolidayGiftIconView | null>(() => {
    const open = holidays.value?.open.find(g => !g.claimed)
    return open ? { id: open.id, name: open.name } : null
})

/** The gift being opened: it shows at once, and its lines land with the claim. */
const holidayReveal = ref<HolidayRevealView | null>(null)
let holidayRevealKey = 0
/** A claim paid Gold or Gems the header hasn't shown yet: it reads them back once the reveal is put away. */
let holidayPaid = false

function settleHolidayBalance() {
    if (!holidayPaid) return
    holidayPaid = false
    void fetchSession()
}

function onHolidayRevealClose() {
    holidayReveal.value = null
    settleHolidayBalance()
}
onUnmounted(settleHolidayBalance)

/** Open the waiting gift: the reveal starts on the press, and the box bursts once the claim is in. */
async function onHolidayOpen() {
    const gift = holidayGift.value
    if (!gift || holidayReveal.value) return
    const key = ++holidayRevealKey
    holidayReveal.value = { key, id: gift.id, name: gift.name, lines: null }
    try {
        const res = await claimHoliday(gift.id)
        if (!res) return
        holidayPaid = parseFloat(res.gold) > 0 || res.gems > 0
        // a reveal no longer showing still owes the header its balance
        if (holidayReveal.value?.key !== key) return settleHolidayBalance()
        const lines = [
            { icon: 'gold', amount: parseFloat(res.gold) || 0, label: 'GOLD' },
            { icon: 'gems', amount: res.gems, label: 'GEMS' },
            ...res.seals.map(x => ({ icon: `seal_${x.system}`, amount: x.amount, label: SEAL_NAMES[x.system] ?? 'SEALS' }))
        ].filter(line => line.amount > 0)
        holidayReveal.value = { ...holidayReveal.value, lines }
    } catch {
        // `useHeroQuest` has already shown the error; the box goes with it
        if (holidayReveal.value?.key === key) holidayReveal.value = null
    }
}

/** The Milestones scene: every track's next step and what's waiting. */
const milestonesView = computed<MilestonesView>(() => ({ rows: milestones.value }))
const milestonesBusy = ref(false)

async function onClaimMilestones(track: string) {
    milestonesBusy.value = true
    try {
        await claimMilestones(track)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        milestonesBusy.value = false
    }
}

/** The Roll being revealed: its slots spin from the press and land once the new board is in. */
const traitRoll = ref<TraitRollView | null>(null)
let traitRollKey = 0
/** The grade Auto Roll stops at, or better. */
const traitAutoGrade = ref<TraitGrade>('S')
/** STOP was pressed: the run ends after the batch on its way. Leaving the page stops it too. */
let traitAutoStop = false
/** Trait Gems left as the running Auto Roll's batches report them, ahead of the state read. */
const traitAutoGems = ref<number | null>(null)
onUnmounted(() => { traitAutoStop = true })

/**
 * An Auto Roll run: batch after batch, the count running on the stage, until a slot lands at the
 * grade, the Trait Gems run short, or STOP. The state is read once at the end, and a batch that
 * fails after the first ends the run quietly, since what was rolled is already paid and kept.
 */
async function runAutoRoll(): Promise<string> {
    traitAutoStop = false
    let total = { rolls: 0, spent: 0, stoppedBy: 'cap' as 'hit' | 'gems' | 'cap', slots: [] as ({ grade: string } | null)[] }
    try {
        while (true) {
            let res
            try {
                res = await autoRollTraits(traitAutoGrade.value)
            } catch (e) {
                if (total.rolls === 0) throw e
                total = { ...total, stoppedBy: 'gems' }
                break
            }
            if (!res) break
            total = { rolls: total.rolls + res.rolls, spent: total.spent + res.spent, stoppedBy: res.stoppedBy, slots: res.slots }
            traitAutoGems.value = res.traitGems
            if (traitRoll.value) traitRoll.value = { ...traitRoll.value, auto: { rolls: total.rolls, spent: total.spent } }
            if (res.stoppedBy !== 'cap' || traitAutoStop) break
        }
    } finally {
        await refreshTraits()
        traitAutoGems.value = null
    }
    return autoRollNote(total)
}

/** What an Auto Roll came to, for the scene's bottom line. */
function autoRollNote(res: { rolls: number, spent: number, stoppedBy: 'hit' | 'gems' | 'cap', slots: ({ grade: string } | null)[] }): string {
    const rolls = `${res.rolls} ROLL${res.rolls === 1 ? '' : 'S'}, ${formatNumber(res.spent)} TRAIT GEMS`
    if (res.stoppedBy === 'hit') {
        const best = res.slots.reduce((top, slot) => slot && TRAIT_GRADES.indexOf(slot.grade as TraitGrade) > TRAIT_GRADES.indexOf(top) ? slot.grade as TraitGrade : top, 'F' as TraitGrade)
        return `GRADE ${best} AFTER ${rolls}!`
    }
    return res.stoppedBy === 'gems' ? `OUT OF TRAIT GEMS AFTER ${rolls}.` : `STOPPED AFTER ${rolls}.`
}

/**
 * The Traits scene: the live board, the Roll's price, every Set's count and tier, and the save
 * slots. Values arrive as fractions and are spelled out here; the client holds no table.
 */
const traitsView = computed<TraitsView>(() => {
    const t = traits.value
    const gems = user.value?.gems ?? 0
    const armed = confirm.armed.value?.startsWith('trait:') ? confirm.armed.value.slice(6) as TraitsTarget : null
    if (!t) {
        return { traitGems: '0', slots: [], rollCost: 0, rerolls: 0, affordable: false, sets: [], saves: [], saveCost: 0, saveAffordable: false, boardFull: false, gems, armed, roll: null, autoGrade: traitAutoGrade.value, gradePickerOpen: false }
    }
    return {
        traitGems: formatNumber(traitAutoGems.value ?? t.traitGems),
        slots: t.slots.map(slot => slot && {
            statName: slot.statName,
            value: `+${hqPercent(slot.value)}`,
            grade: slot.grade as TraitGrade,
            set: slot.set,
            setName: slot.setName,
            locked: slot.locked
        }),
        rollCost: t.rollCost,
        rerolls: t.slots.length - t.locked,
        affordable: t.canRoll && t.traitGems >= t.rollCost,
        sets: t.sets.map(set => ({
            id: set.id,
            name: set.name,
            pieces: set.pieces,
            tier: set.tier,
            effect: set.effect,
            tiers: set.tiers.map(tier => ({ pieces: tier.pieces, value: hqPercent(tier.magnitude) }))
        })),
        saves: t.saves.slots.map((slot) => {
            // only the next save slot to buy carries a price
            const next = !slot.unlocked && slot.index === t.saves.unlocked ? t.saves.nextSlotCostGems : null
            return {
                index: slot.index,
                unlocked: slot.unlocked,
                price: next === null ? null : formatNumber(next),
                priceGems: next,
                grades: slot.slots ? slot.slots.map(s => (s?.grade ?? 'F') as TraitGrade) : null
            }
        }),
        saveCost: t.saves.cost,
        saveAffordable: t.traitGems >= t.saves.cost,
        boardFull: t.slots.every(slot => slot !== null),
        gems,
        armed,
        roll: traitRoll.value,
        autoGrade: traitAutoGrade.value,
        // the canvas holds whether the list is open
        gradePickerOpen: false
    }
})
const traitsBusy = ref(false)

/**
 * A Traits button. Roll and the locks go at once; what overwrites something — storing over a
 * board, loading over the live one — or spends Gems waits for a second press.
 */
async function onTraitAction(target: TraitsTarget) {
    const [kind, n] = target.split(':') as [string, string | undefined]
    const i = Number(n)
    if (kind === 'grade') {
        if (n) traitAutoGrade.value = n as TraitGrade
        return
    }
    if (kind === 'stop') {
        traitAutoStop = true
        return
    }
    const asks = (settings.value?.confirmTraitSpends ?? true)
        && (kind === 'auto' || kind === 'load' || kind === 'buy' || (kind === 'save' && !!traitsView.value.saves[i]?.grades))
    if (asks && !confirm.press(`trait:${target}`)) return
    confirm.clear()
    traitsBusy.value = true
    try {
        if (kind === 'roll' || kind === 'auto') {
            const slots = traitsView.value.slots.flatMap((slot, index) => slot?.locked ? [] : [index])
            traitRoll.value = { key: ++traitRollKey, slots, landed: false, note: null, auto: kind === 'auto' ? { rolls: 0, spent: 0 } : null }
            try {
                if (kind === 'roll') {
                    await rollTraits()
                    traitRoll.value = { ...traitRoll.value, landed: true }
                } else {
                    traitRoll.value = { ...traitRoll.value, landed: true, note: await runAutoRoll() }
                }
            } catch (e) {
                traitRoll.value = null
                throw e
            }
        }
        else if (kind === 'lock') await lockTrait(i, !traitsView.value.slots[i]?.locked)
        else if (kind === 'save') await saveTraits(i)
        else if (kind === 'load') await loadTraits(i)
        else if (kind === 'buy') await buyTraitSaveSlot()
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        traitsBusy.value = false
    }
}

/** The Passive Skill Tree scene: every node's level and next cost, the points, and the respec. */
const treeBusy = ref(false)
const treeView = computed<TreeView>(() => {
    const t = passiveTree.value
    const armed = confirm.armed.value === 'tree:respec'
    if (!t) return { nodes: [], points: '0', respecFree: false, respecGems: 0, respecAffordable: false, armed, busy: treeBusy.value }
    return {
        nodes: t.nodes,
        points: formatNumber(t.pointsLeft),
        respecFree: t.respecFree,
        respecGems: t.respecGems,
        respecAffordable: (user.value?.gems ?? 0) >= t.respecGems,
        armed,
        busy: treeBusy.value
    }
})

async function onTreeBuy(nodeId: string) {
    confirm.clear()
    treeBusy.value = true
    try {
        await buyPassiveNode(nodeId)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        treeBusy.value = false
    }
}

/** A respec undoes the whole tree, so it waits for a second press unless that is turned off in Settings. */
async function onTreeRespec() {
    if ((settings.value?.confirmTreeRespec ?? true) && !confirm.press('tree:respec')) return
    confirm.clear()
    treeBusy.value = true
    try {
        await respecPassiveTree()
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        treeBusy.value = false
    }
}

/** The running Battle Speed block's time left, off the server's expiry; it stands still in a raid, as the block does. */
const speedLeftLive = useHqCountdown(() => battleSpeed.value?.expiresAt)
const speedLeft = computed(() => loadoutSession.value && battleSpeed.value?.expiresAt
    ? formatHqCountdown(battleSpeed.value.remainingSeconds)
    : speedLeftLive.value)

/** The Battle Speed scene: the running block, the Gems to spend, and every block's price. */
const speedView = computed<SpeedView>(() => {
    const gems = user.value?.gems ?? 0
    const running = speedNow.value
    return {
        multiplier: running,
        left: running > 1 ? speedLeft.value : null,
        gems: formatNumber(gems),
        gemCount: gems,
        offlineEfficiency: run.value?.offlineEfficiency ?? 1,
        tiers: battleSpeed.value?.tiers ?? [],
        armed: armedSpeed.value
    }
})

/** The running block on the battle's HUD. */
const speedTag = computed(() => speedNow.value > 1 && speedLeft.value ? `${speedNow.value}X ${speedLeft.value}` : '')

const speedBusy = ref(false)

/** The Battle Speed block pressed once and waiting for its confirm, off the shared confirm. */
const armedSpeed = computed(() => {
    const [kind, speed, minutes] = confirm.armed.value?.split(':') ?? []
    return kind === 'speed' ? { speed: Number(speed), minutes: Number(minutes) } : null
})

async function onBuySpeed(speed: number, minutes: number) {
    // a block paid in Gems waits for a second press, unless that is turned off in Settings
    if ((settings.value?.confirmGemSpends ?? true) && !confirm.press(`speed:${speed}:${minutes}`)) return
    confirm.clear()
    speedBusy.value = true
    try {
        await buyBattleSpeed(speed, minutes)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        speedBusy.value = false
    }
}

async function onShopBuy(upgradeId: string) {
    // a track paid in Void Shards or Gems waits for a second press, unless that is turned off in Settings
    const track = shop.value?.find(t => t.id === upgradeId)
    const setting = track?.currency === 'voidShards' ? 'confirmVoidShards' : track?.currency === 'gems' ? 'confirmGemSpends' : null
    const asks = !!setting && (settings.value?.[setting] ?? true)
    if (asks && !confirm.press(`shop:${upgradeId}`)) return
    confirm.clear()
    prestigeBusy.value = true
    try {
        await buyUpgrade(upgradeId)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        prestigeBusy.value = false
    }
}

/**
 * The battle screen draws the *projected* run, not the payload.
 *
 * The server settles lazily and this page polls it once a minute, so `run` and `hero` are a
 * minute-old photograph. `useHqLiveRun` walks both forward at the server's own rate — position,
 * kills, level and XP — so the stage counter rolls over into the next stage, the world changes,
 * and the XP bar fills continuously instead of jumping once a minute. Server truth still lands
 * every poll and overwrites all of it; nothing projected is ever sent back.
 *
 * `run`/`hero` stay in scope deliberately: `liveHero` is the right thing to *show* and the wrong
 * thing to compare a payload against, so anything that needs the anchor still has it.
 */
// the run holds while a raid session is open, as the server's settle does
/**
 * A boss the run reached while the player was away waits for them: the welcome-back card goes
 * first, then the stage's challenge button, as for a boss that beat the party. Client-only, so a
 * reload lets it engage itself again; cleared by the next fight.
 */
const bossHeld = useState('hq-boss-held', () => false)
watch(welcome, (report) => {
    if (report?.blockedAtBoss) bossHeld.value = true
}, { immediate: true })
/** The run as the stage plays it: a held boss reads as a lost one, so it is farmed in front of and challenged. */
const shownRun = computed(() => run.value && bossHeld.value && !run.value.bossLost ? { ...run.value, bossLost: true } : run.value)

const { liveRun, liveHero, speedNow, goldSincePayload } = useHqLiveRun(shownRun, hero, battleSpeed, computed(() => loadoutSession.value !== null))

/** The chest's Gold as of now: the last read's, and what the run has banked in it since. */
const chestPreview = computed(() => goldChest.value ? `${formatHq(D(chestGold.value).add(goldSincePayload.value).floor())} GOLD` : null)

/**
 * Who stands on the stage: the Hero and the Champions fielded, in party order, each on its row.
 * Off the guild payload, so it changes with the next payload after an equip.
 */
const party = computed(() => {
    const g = guild.value
    // each unit's kit on its live cooldowns, so skills cast when the fight would cast them
    const kits = hero.value?.kits
    if (!g) return { heroRow: 'front' as const, champions: [], kits }
    const byId = new Map(g.roster.map(c => [c.id, c]))
    return {
        heroRow: g.heroRow,
        kits,
        champions: g.partyChampionIds.flatMap((id) => {
            const c = byId.get(id)
            return c ? [{ id, row: c.row, level: c.level }] : []
        })
    }
})

const fight = ref<Awaited<ReturnType<typeof engageBoss>>>(null)

// ── Feature unlocks and the guide (`tutorials.ts`) ───────────────────────────────────

/**
 * The features open as the boss fight on the stage found them, while its replay plays. The server
 * resolves the fight on engage, so the read that comes back with it already holds what the clear
 * opened; this holds those back until the replay has played out, the way the balance waits for a
 * win's reveal. Local to the stage, so leaving it mid-fight lets everything through.
 */
const heldUnlocks = ref<readonly HqFeature[] | null>(null)
/** The features open, in the order they opened; empty until the first read. */
const unlocked = computed<readonly HqFeature[]>(() => {
    const open = tutorials.value?.unlocked ?? []
    const held = heldUnlocks.value
    return held ? open.filter(f => held.includes(f)) : open
})
/** Closed here before the server says so, so a tutorial doesn't flash back while its write is on its way. */
const seenLocally = ref<string[]>([])
const seenTutorials = computed(() => [...(tutorials.value?.seen ?? []), ...seenLocally.value])
/** The open features the menu shows: with tutorials on, a feature waits for its turn behind one that opened with it. */
const shownFeatures = computed<readonly HqFeature[]>(() => settings.value?.tutorials === false
    ? unlocked.value
    : revealedFeatures(unlocked.value, seenTutorials.value, tutorialScene.value))
/** The menu shows Settings and every feature shown. */
const menuScenes = computed(() => HQ_MENU_SCENES.filter(s => !isHqFeature(s) || shownFeatures.value.includes(s)))
/** Opened and not visited yet: the button carries the red dot until it is, Battle Speed's on the Shop's. */
const newScenes = computed(() => [...new Set(unlocked.value.filter(f => !seenTutorials.value.includes(`${f}:visit`)).map(featureMenuScene))])
/** Battle Speed's tab can be pressed: it is open, and its turn in the tutorials has come. */
const speedOpen = computed(() => shownFeatures.value.includes('speed'))
/** The Milestones' tab can be pressed: they are open, and their turn in the tutorials has come. */
const milestonesOpen = computed(() => shownFeatures.value.includes('milestones'))

/** The scene last opened from the menu: picked from what the menu showed, so it is never sent back. */
let openedFromMenu: HqScene | null = null

/**
 * A scene not open yet, or waiting its turn, reached by a link or a reload falls back to the battle.
 * Checked on arrival and when the tutorials first load, never against a scene opened from the menu:
 * re-checking as the tutorials moved sent players out of scenes they had just opened.
 */
watch([() => props.scene, () => tutorials.value !== null], ([scene]) => {
    if (scene === openedFromMenu) return
    openedFromMenu = null
    if (!tutorials.value || !isHqFeature(scene) || shownFeatures.value.includes(scene)) {
        // the Shop is open but Battle Speed's tab is not yet: the Upgrades tab instead
        if (scene === 'shop' && shopTab.value === 'speed' && tutorials.value && !speedOpen.value) onShopTab('upgrades')
        // and the Calendar's, with the Milestones not open yet
        if (scene === 'calendar' && calendarTab.value === 'milestones' && tutorials.value && !milestonesOpen.value) onCalendarTab('calendar')
        return
    }
    if (import.meta.dev) {
        console.warn('[hero-quest] scene not shown, back to the battle', { scene, unlocked: unlocked.value, seen: seenTutorials.value, shown: shownFeatures.value })
    }
    emit('scene', 'battle')
}, { immediate: true })

/**
 * The tutorial due now, while tips are on. It waits out a boss or raid fight, which wants the
 * player's eyes on the stage rather than on the guide.
 */
const dueTutorial = computed<TutorialId | null>(() => {
    if (!tutorials.value || settings.value?.tutorials === false || fight.value || raidRound.value) return null
    return nextTutorial(unlocked.value, seenTutorials.value, tutorialScene.value)
})
const guidePage = ref(0)
watch(dueTutorial, () => { guidePage.value = 0 })
const guideView = computed<GuideView | null>(() => dueTutorial.value
    ? { name: GUIDE_NAME, pages: TUTORIAL_PAGES[dueTutorial.value], page: guidePage.value, focus: unlockFocus(dueTutorial.value) }
    : null)

function closeTutorial() {
    const id = dueTutorial.value
    if (!id) return
    seenLocally.value = [...seenLocally.value, id]
    markTutorialSeen(id).catch(() => {
        // `useHeroQuest` has already shown the error; the tutorial comes round again on the next read
    })
}

/** An unlock's menu button, the one thing a forced unlock lets the player press: Battle Speed's is the Shop's. */
function unlockFocus(id: TutorialId): HqMenuScene | null {
    return id.endsWith(':unlock') ? featureMenuScene(id.slice(0, -':unlock'.length) as HqFeature) as HqMenuScene : null
}

/** A menu press. Pressing the button an unlock points at is how that unlock is read. */
function onScene(scene: HqScene) {
    const due = dueTutorial.value
    if (guideView.value?.focus === scene) closeTutorial()
    openedFromMenu = scene
    // Battle Speed's and the Milestones' unlocks open their scene on their tab, where the explanation plays
    if (due === 'speed:unlock' && scene === 'shop') onShopTab('speed')
    else if (due === 'milestones:unlock' && scene === 'calendar') onCalendarTab('milestones')
    else emit('scene', scene)
}

/** A boss fight lost: counted toward the guide's one reminder, which shows once the replay is done. */
function countBossLoss() {
    const mark = bossLossMark(seenTutorials.value)
    if (!mark) return
    seenLocally.value = [...seenLocally.value, mark]
    markTutorialSeen(mark).catch(() => {
        // `useHeroQuest` has already shown the error; this loss just goes uncounted
    })
}

function onGuideNext() {
    const view = guideView.value
    if (!view) return
    if (view.page < view.pages.length - 1) guidePage.value++
    else closeTutorial()
}
const engaging = ref(false)

/** How far the stage has played the fight, and whether its result is up. */
const fightProgress = ref({ time: 0, done: false })

/**
 * A boss fight puts itself away once its result has held for `AUTO_ENGAGE_REPLAY_HOLD_SECONDS`:
 * an automatic engage cannot wait on a click, or the run would sit behind the first fight.
 */
let fightHold: ReturnType<typeof setTimeout> | null = null
watch(() => fight.value !== null && fightProgress.value.done, (done) => {
    if (fightHold) clearTimeout(fightHold)
    fightHold = done ? setTimeout(() => { fight.value = null }, AUTO_ENGAGE_REPLAY_HOLD_SECONDS * 1000) : null
})
onUnmounted(() => { if (fightHold) clearTimeout(fightHold) })

// the round's last blow lands, then its reward goes up; the popup's button brings the run back
watch(() => fightProgress.value.done, (done) => {
    if (!done || (!raidRound.value && !arenaRound.value)) return
    if (raidHold) clearTimeout(raidHold)
    raidHold = setTimeout(() => {
        if (arenaRound.value) arenaResult.value = arenaOutcome
        else raidReward.value = roundReward
    }, RAID_REWARD_DELAY_MS)
})
onUnmounted(() => { if (raidHold) clearTimeout(raidHold) })
const battleCanvas = ref<{ skipFight: () => void, closeIris: () => Promise<HqIntroRect | null> } | null>(null)

/**
 * A cleared run waits on the bridge (`HeroQuestPrestigeGate`) instead of the stage. The prestige
 * lands before the party walks into the portal, and the payload it refreshes is already World 1,
 * so `holdGate` keeps the bridge up until the walk is done; a failed prestige lets it go again.
 *
 * The run clears on the super boss's win, while its replay still plays, so the bridge waits for
 * the fight to be put away. `showGate` then trails `wantGate` by the stage's iris: the stage closes
 * on the Hero and the bridge grows out of its box (`useHqIntro`). The way back is the bridge's
 * own, handed over on `crossed`.
 */
const holdGate = ref(false)
const prestiging = ref(false)
const crossing = ref(false)
const wantGate = computed(() => ((liveRun.value?.runCleared ?? false) && !fight.value) || holdGate.value)
const showGate = ref(wantGate.value)

watch(wantGate, async (want) => {
    if (!want) {
        showGate.value = false
        return
    }
    if (showGate.value) return
    const stage = battleCanvas.value
    // no stage up (a first load straight onto a cleared run), or a scene over it: straight to the bridge
    if (!stage || props.scene !== 'battle') {
        showGate.value = true
        return
    }
    handOverHqIntro(await stage.closeIris())
    if (wantGate.value) showGate.value = true
})

/** What the prestige paid, spelled out, for the bridge to raise over the Hero. */
const earnedShards = ref<string | null>(null)

async function beginAgain() {
    holdGate.value = true
    prestiging.value = true
    earnedShards.value = null
    try {
        const result = await prestige()
        if (result) earnedShards.value = formatHq(result.voidShardsEarned)
        crossing.value = true
    } catch {
        holdGate.value = false
    } finally {
        prestiging.value = false
    }
}

function onCrossed(rect: HqIntroRect | null) {
    // the battle stage takes it as it mounts (`takeHqIntro`)
    handOverHqIntro(rect)
    holdGate.value = false
    crossing.value = false
}

/** The bridge walks the save's party, in file. */
const gateParty = computed(() => ({
    classId: hero.value?.classId ?? 'class_beginner',
    heroRow: party.value.heroRow,
    champions: party.value.champions.map(c => ({ id: c.id, row: c.row }))
}))

/**
 * The next gate's boss beat the party last time (`hq_state.boss_lost`, set by the fight that lost).
 * Back at its gate the run is shown farming the stage before it (`useHqLiveRun`), and the boss waits
 * on the stage's challenge button instead of engaging itself (`shouldAutoEngage`). Saved, so it
 * holds across reloads and coming back later.
 */
const lostHere = computed(() => liveRun.value?.bossLost ?? false)
/** The challenge button shows on the stage: farming in front of a lost boss, with no fight on. */
const challenge = computed(() => (liveRun.value?.farming ?? false) && !fight.value)

async function runFightAt(automatic: boolean) {
    engaging.value = true
    bossHeld.value = false
    // before the engage: the read it refreshes already counts the clear
    heldUnlocks.value = [...(tutorials.value?.unlocked ?? [])]
    try {
        const result = await engageBoss({ silentErrors: automatic })
        fightProgress.value = { time: 0, done: false }
        fight.value = result
        if (result && result.outcome !== 'win') countBossLoss()
    } finally {
        engaging.value = false
        if (!fight.value) heldUnlocks.value = null
    }
}

/** The replay has played out, or was put away: what the fight opened shows. */
watch(() => fight.value === null || fightProgress.value.done, (over) => {
    if (over && !engaging.value) heldUnlocks.value = null
})

const onEngage = () => runFightAt(false)

/**
 * Bosses fire on their own while the tab is visible.
 *
 * Visibility is the presence check, and it is the same presence the refresh interval already
 * demonstrates — a backgrounded or closed tab still never engages one, so "a boss requires the
 * player to be present" is unchanged. `shouldAutoEngage` holds the rest of the rules, including
 * the one that stops a cleared run re-fighting the World 10 super boss forever.
 *
 * Driven off `liveRun`, not `run`, so it fires when the *screen* reaches the gate rather than up
 * to a minute later when the next poll lands. That is also why an engage can arrive before the
 * server has settled that far, which `useHqAutoBoss` retries rather than surfaces.
 */
useHqAutoBoss({
    atBossGate: () => liveRun.value?.atBossGate ?? false,
    runCleared: () => liveRun.value?.runCleared ?? false,
    lostHere: () => lostHere.value,
    secondsPerKill: () => liveRun.value?.secondsPerKill ?? null,
    engaging: () => engaging.value,
    // a raid or Arena session holds the run, its gate included, until the player leaves it; the welcome-back card until it is put away
    replayOpen: () => fight.value !== null || raidRound.value !== null || arenaRound.value !== null || loadoutSession.value !== null || welcome.value !== null,
    engage: () => runFightAt(true)
})

/** A duration on the stage's font: "6H 2M". */
function stageDuration(seconds: number): string {
    return formatSeconds(Math.max(0, seconds)).toUpperCase()
}

/**
 * The welcome-back card: what the last stretch away banked, held until it is put away. It waits
 * for the battle, so a fight, a round or another popup never sits under it.
 */
const welcomeView = computed<WelcomeView | null>(() => {
    const r = welcome.value
    if (!r || props.scene !== 'battle' || fight.value || raidRound.value || arenaRound.value || raidReward.value || arenaResult.value) return null
    const notes: WelcomeNote[] = []
    const o = r.offline
    const lostToCap = r.lostToCapSeconds
    if (lostToCap > 0) notes.push({ text: `OFFLINE CAP ${stageDuration(o.capSeconds)}: ${stageDuration(lostToCap)} NOT COUNTED`, tone: 'bad' })
    if (o.efficiency < 1) notes.push({ text: `OFFLINE EFFICIENCY ${Math.round(o.efficiency * 100)}%`, tone: 'warn' })
    if (o.boostedSeconds > 0) notes.push({ text: `BATTLE SPEED ×${o.boostMultiplier} FOR ${stageDuration(o.boostedSeconds)}`, tone: 'info' })
    if (r.blockedAtBoss) notes.push({ text: 'PARKED AT THE BOSS, READY TO FIGHT', tone: 'warn' })
    if (r.wipedOnWave) notes.push({ text: 'THE PARTY KEEPS FALLING ON THIS WAVE', tone: 'bad' })
    // the Shop's offline tracks, once it is open and while they still have a level to give
    if (shownFeatures.value.includes('shop')) {
        const cap = lostToCap > 0 && o.capLevel < MAX_OFFLINE_CAP_LEVEL
        const efficiency = o.efficiency < 1 && o.efficiencyLevel < MAX_OFFLINE_EFFICIENCY_LEVEL
        if (cap || efficiency) {
            const what = cap && efficiency ? 'OFFLINE CAP AND EFFICIENCY' : cap ? 'OFFLINE CAP' : 'OFFLINE EFFICIENCY'
            notes.push({ text: `RAISE THE ${what} IN THE SHOP`, tone: 'good' })
        }
    }
    const moved = r.from.world !== r.to.world || r.from.stage !== r.to.stage
    return {
        away: stageDuration(r.awaySeconds),
        counted: stageDuration(r.effectiveSeconds),
        gold: `+${formatNumber(r.goldEarned)}`,
        xp: `+${formatHq(D(r.xpEarned).floor())}`,
        kills: `${formatNumber(r.kills)} KILLS`,
        level: r.levelsGained > 0 ? `LEVEL ${r.heroLevel - r.levelsGained} > ${r.heroLevel}` : null,
        stage: moved ? `WORLD ${r.from.world} STAGE ${r.from.stage} > WORLD ${r.to.world} STAGE ${r.to.stage}` : null,
        notes
    }
})

function closeWelcome() {
    dismissWelcome()
}
</script>

<template>
  <div
    class="p-4 sm:p-6 space-y-6"
    :class="scene === 'battle' ? '' : 'pb-0 sm:pb-0'"
  >
    <div
      v-if="pending && !run"
      class="text-center py-16 text-muted"
    >
      Loading…
    </div>

    <!-- Founding is explicit, on the splash (`HeroQuestSplash`), so a run never starts behind the player's back. -->
    <template v-else-if="initialized && liveRun && liveHero">
      <!-- A prestige under way holds the bridge up, so the party finishes the walk. -->
      <template v-if="showGate && (scene === 'battle' || holdGate)">
        <HeroQuestPrestigeGate
          :party="gateParty"
          :pending="prestiging"
          :crossing="crossing"
          :earned="earnedShards"
          :reward="formatHq(nextPrestigeReward)"
          :menu-scenes="menuScenes"
          :guide="guideView"
          @begin="beginAgain"
          @crossed="onCrossed"
          @scene="onScene"
          @guide-next="onGuideNext"
        />
      </template>

      <template v-else>
        <HeroQuestBattleCanvas
          ref="battleCanvas"
          :run="liveRun"
          :hero="liveHero"
          :party="party"
          :fight="fight"
          :speed="speedNow"
          :challenge="challenge"
          :scene="scene"
          :shop-tab="shopTab"
          :speed-open="speedOpen"
          :calendar-tab="calendarTab"
          :milestones-open="milestonesOpen"
          @calendar-tab="onCalendarTab"
          @shop-tab="onShopTab"
          :collections="collections"
          :collections-busy="collectionsBusy"
          :loadouts="loadoutsView"
          :loadouts-busy="loadoutsBusy"
          :prestige="prestigeView"
          :prestige-busy="prestigeBusy"
          :speed-view="speedView"
          :speed-busy="speedBusy"
          :speed-tag="speedTag"
          :gacha="gachaView"
          :gacha-busy="gachaBusy"
          :settings="settingsView"
          :settings-busy="settingsBusy"
          :calendar="calendarView"
          :calendar-busy="calendarBusy"
          :milestones="milestonesView"
          :menu-scenes="menuScenes"
          :new-scenes="newScenes"
          :collections-upgrade="collectionsUpgrade"
          :guide="guideView"
          :milestones-busy="milestonesBusy"
          :traits="traitsView"
          :traits-busy="traitsBusy"
          :tree="treeView"
          :raids="raidRows"
          :raids-busy="raidsBusy"
          :raid-loadouts="raidLoadoutOptions"
          :raid-round="raidRound"
          :holiday-gift="holidayGift"
          :gold-chest="goldChest"
          :chest-preview="chestPreview"
          :chest-toast="chestToast"
          :holiday-reveal="holidayReveal"
          :raid-reward="raidReward"
          :welcome="welcomeView"
          :arena="arenaView"
          :arena-round="arenaRound"
          :arena-result="arenaResult"
          :party-stats="partyStats"
          :classes="classesView"
          :classes-busy="classesBusy"
          @fight-progress="fightProgress = $event"
          @challenge="onEngage"
          @scene="onScene"
          @collection-tab="openCollectionTab"
          @collection-action="onCollectionAction"
          @collection-pick="onCollectionPick"
          @loadout-action="onLoadoutAction"
          @loadout-rename="onLoadoutRename"
          @shop-buy="onShopBuy"
          @buy-speed="onBuySpeed"
          @gacha-action="onGachaAction"
          @gacha-close="gachaReveal = null"
          @setting="onSetting"
          @claim-calendar="onClaimCalendar"
          @holiday-open="onHolidayOpen"
          @chest-collect="onChestCollect"
          @holiday-reveal-close="onHolidayRevealClose"
          @claim-milestones="onClaimMilestones"
          @guide-next="onGuideNext"
          @trait-action="onTraitAction"
          @tree-buy="onTreeBuy"
          @tree-respec="onTreeRespec"
          @raid-enter="onRaidEnter"
          @raid-quick="onRaidQuick"
          @raid-loadout="onRaidLoadout"
          @raid-reward-close="closeRaidReward"
          @welcome-close="closeWelcome"
          @arena-action="onArenaAction"
          @arena-tab="onArenaTab"
          @arena-result-close="closeArenaResult"
          @party-stats-open="openPartyStats"
          @party-stats-close="closePartyStats"
          @party-stats-cell="partyStatCell = $event"
          @party-stats-back="partyStatCell = null"
          @pick-class="onPickClass"
          @set-ascendant-kit="onSetAscendantKit"
        />
      </template>
    </template>
  </div>
</template>
