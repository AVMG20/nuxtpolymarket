<script setup lang="ts">
import type { HqIntroRect } from '~/composables/useHqIntro'
import { D, formatHq, formatSeconds } from '#shared/utils/hero-quest/numbers'
import { RARITIES, sealLadderTotal, type GachaSystem } from '#shared/utils/hero-quest/gacha'
import type { FormationRow, Rarity } from '#shared/utils/hero-quest/types'
import { GEAR_SLOTS, GEAR_SLOT_NAME } from '#shared/utils/hero-quest/content/gear'
import { FORMATION_ROW_CAPACITY, FREE_PULLS_PER_DAY } from '#shared/utils/hero-quest/constants'
import type { CollectionAction, CollectionLine, CollectionSection, CollectionTile, DetailButton } from '~/utils/hero-quest-art/collections-scene'
import type { LoadoutEntry, LoadoutSlotView, LoadoutsView } from '~/utils/hero-quest-art/loadouts-scene'
import type { PrestigeView } from '~/utils/hero-quest-art/prestige-scene'
import type { ClassesView } from '~/utils/hero-quest-art/classes-scene'
import type { SpeedView } from '~/utils/hero-quest-art/speed-scene'
import type { SettingsTarget, SettingsView } from '~/utils/hero-quest-art/settings-scene'
import { HQ_SETTING_DEFAULTS } from '#shared/utils/hero-quest/settings'
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
    initialized, run, hero, settled, pending, guild, forge, training, digSite, nextPrestigeReward,
    engageBoss, prestige, craft, setLoadout, loadouts, saveLoadout, applyLoadout, renameLoadout,
    shop, voidShards, buyUpgrade, classTree, classToken, pickClass, battleSpeed, buyBattleSpeed,
    pull, freePull, settings, setSetting
} = useHeroQuest()
const { user } = useAuth()

/**
 * The Collections scene's tab, off the route, and the roster it shows, with what each entry's
 * detail says and which of its buttons can be pressed. The rules are the collection pages' own:
 * a slot cap on Champions, Skills and Artifacts, one piece per Gear slot, and crafting until maxed.
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

/** A slotted system's one button: take it off, put it on, or say the slots are full. */
function slotActions(owned: boolean, on: boolean, used: number, slots: number): CollectionAction[] {
    if (!owned) return []
    if (on) return [{ id: 'equip', label: 'Unequip', enabled: true }]
    return [used < slots ? { id: 'equip', label: 'Equip', enabled: true } : { id: 'equip', label: 'Slots full', enabled: false }]
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

/**
 * A Champion's buttons: Front and Back with how full each row is, the Hero counted, and Bench
 * while it is fielded. Its own row shows pressed in; a full row, or a full party for one not yet
 * fielded, cannot be pressed.
 */
function championActions(id: string, owned: boolean): CollectionAction[] {
    const g = guild.value
    if (!owned || !g) return []
    const party = g.partyChampionIds
    const formation = savedFormation()
    const rows = ['hero', ...party].map(member => formation[member])
    const count = (row: FormationRow) => rows.filter(r => r === row).length
    const fielded = party.includes(id)
    const room = fielded || party.length < g.slots
    const rowButton = (row: FormationRow, label: string): CollectionAction => {
        const here = fielded && formation[id] === row
        return { id: row, label: `${label} ${count(row)}/${FORMATION_ROW_CAPACITY}`, enabled: here || (room && count(row) < FORMATION_ROW_CAPACITY), current: here }
    }
    return [
        rowButton('front', 'Front'),
        rowButton('back', 'Back'),
        ...(fielded ? [{ id: 'bench' as const, label: 'Bench', enabled: true }] : [])
    ]
}

function collectionTiles(tab: HqCollectionTab): CollectionTile[] {
    switch (tab) {
        case 'gear': {
            const f = forge.value
            const essence = f?.essence ?? 0
            const worn = new Map((f?.slots ?? []).map(slot => [slot.slot, f?.roster.find(e => e.id === slot.equippedId)]))
            return (f?.roster ?? []).map((e) => {
                const line = hqEffectLine('stat', e.stat, e.equippedBonus)
                // against what the slot wears now: equipping replaces its bonus, and every owned passive stays
                const delta = e.equippedBonus - (worn.get(e.slot)?.equippedBonus ?? 0)
                const compared: CollectionLine = e.owned && !e.equipped && delta !== 0
                    ? { text: line, delta: hqPercent(delta), up: delta > 0 }
                    : line
                return {
                    ...e,
                    subtitle: GEAR_SLOT_NAME[e.slot],
                    mark: e.equipped ? 'E' as const : null,
                    sections: sections(
                        { active: e.owned, lines: [hqEffectLine('stat', e.stat, e.ownedBonus)] },
                        { title: 'Equipped', scope: 'Hero', active: e.equipped, lines: [compared] }
                    ),
                    // a slot always holds a piece, so equipped Gear is replaced rather than taken off
                    actions: e.owned ? [{ id: 'equip' as const, label: e.equipped ? 'Equipped' : 'Equip', enabled: !e.equipped }] : [],
                    craft: craftButton(e, essence)
                }
            })
        }
        case 'champions': {
            const g = guild.value
            const party = g?.partyChampionIds ?? []
            const formation = savedFormation()
            return (g?.roster ?? []).map(e => ({
                ...e,
                subtitle: e.archetypeName,
                // the row it fights in: F front, B back
                mark: party.includes(e.id) ? (formation[e.id] === 'front' ? 'F' as const : 'B' as const) : null,
                sections: sections(
                    { active: e.owned, lines: e.collectionStats.map(stat => hqEffectLine('stat', stat, e.collectionBonus)) },
                    { title: 'Fielded', scope: 'In the party', active: party.includes(e.id), lines: e.abilities }
                ),
                actions: championActions(e.id, e.owned),
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
                        lines: e.modifiers.flatMap(m => m.ownedMagnitude === null ? [] : [hqEffectLine(m.kind, m.stat, m.ownedMagnitude)])
                    },
                    {
                        title: 'Equipped',
                        scope: 'Hero',
                        active: equipped.includes(e.id),
                        lines: e.type === 'active' ? [...e.lines] : e.modifiers.map(m => hqEffectLine(m.kind, m.stat, m.magnitude))
                    }
                ),
                actions: slotActions(e.owned, equipped.includes(e.id), equipped.length, t?.slotCount ?? 0),
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
                        lines: e.effects.flatMap(f => f.ownedMagnitude === null ? [] : [hqEffectLine(f.kind, f.stat, f.ownedMagnitude)])
                    },
                    {
                        title: 'Equipped',
                        scope: 'Whole party',
                        active: equipped.includes(e.id),
                        lines: e.effects.map(f => hqEffectLine(f.kind, f.stat, f.magnitude))
                    }
                ),
                actions: slotActions(e.owned, equipped.includes(e.id), equipped.length, d?.slotCount ?? 0),
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
    return { tab, entries, essence: formatNumber(essence) }
})

function openCollectionTab(tab: HqCollectionTab) {
    void navigateTo(hqCollectionTabPath(tab))
}

/** Toggle `id` in a slotted list. */
function toggled(list: readonly string[], id: string): string[] {
    return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

/** Equip or take off a Gear piece, Skill or Artifact at once: the stage has no draft to commit, unlike the pages. */
async function equipEntry(tab: HqCollectionTab, id: string) {
    switch (tab) {
        case 'gear': {
            const piece = forge.value?.roster.find(e => e.id === id)
            if (!piece) return
            const gear: Record<string, string> = {}
            for (const slot of forge.value?.slots ?? []) if (slot.equippedId) gear[slot.slot] = slot.equippedId
            gear[piece.slot] = id
            await setLoadout({ gear }, '')
            return
        }
        case 'skills':
            await setLoadout({ skillIds: toggled(training.value?.equippedSkillIds ?? [], id) }, '')
            return
        case 'artifacts':
            await setLoadout({ artifactIds: toggled(digSite.value?.equippedArtifactIds ?? [], id) }, '')
    }
}

/** Field a Champion into a row, move it there, or bench it; the rest of the formation goes back as saved. */
async function placeChampion(id: string, row: FormationRow | null) {
    const party = guild.value?.partyChampionIds ?? []
    const formation = savedFormation()
    if (row === null) {
        await setLoadout({ championIds: party.filter(c => c !== id), formation }, '')
        return
    }
    formation[id] = row
    await setLoadout({ championIds: party.includes(id) ? [...party] : [...party, id], formation }, '')
}

const collectionsBusy = ref(false)

async function onCollectionAction(action: DetailButton, id: string) {
    const tab = collections.value.tab
    collectionsBusy.value = true
    try {
        if (action === 'craft') await craft(SYSTEM_OF[tab], id)
        else if (action === 'equip') await equipEntry(tab, id)
        else await placeChampion(id, action === 'bench' ? null : action)
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        collectionsBusy.value = false
    }
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

    const slots: LoadoutSlotView[] = Array.from({ length: l.maxSlots }, (_, slotIndex) => {
        const locked = slotIndex >= l.slots
        const preset = locked ? undefined : l.saved.find(p => p.slotIndex === slotIndex)
        const base = { slotIndex, locked, name: preset?.name ?? `Loadout ${slotIndex + 1}`, party: [], skills: [], artifacts: [], gear: [] }
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
    if (scene === 'prestige') freezeShopOrder()
}, { immediate: true })

// opened before the payload landed (a reload straight onto the scene): freeze once it arrives
watch(shop, (tracks) => {
    if (props.scene === 'prestige' && !shopOrder.value.length && tracks?.length) freezeShopOrder()
})

const prestigeView = computed<PrestigeView>(() => {
    const shards = D(voidShards.value ?? '0')
    const gems = user.value?.gems ?? 0
    // a track the frozen order does not know yet goes last
    const rank = (id: string) => {
        const i = shopOrder.value.indexOf(id)
        return i < 0 ? shopOrder.value.length : i
    }
    return {
        voidShards: formatHq(voidShards.value ?? '0'),
        gems: formatNumber(gems),
        tracks: (shop.value ?? []).map(track => ({
            id: track.id,
            name: track.name,
            level: track.level,
            maxLevel: track.maxLevel,
            current: track.effect.current,
            next: track.effect.next,
            cost: track.nextCost === null ? null : formatNumber(track.nextCost),
            currency: track.currency,
            affordable: track.nextCost !== null && (track.currency === 'gems' ? gems >= track.nextCost : shards.gte(track.nextCost))
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
    token: classToken.value
}))

const classesBusy = ref(false)

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
 * A spend of a hard-won currency waits for a second press: Gold on a pull's Seals, Void Shards in
 * the shop. Each is keyed by what was pressed, and either confirm can be turned off in Settings.
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

/** The Settings scene. Tutorials do not exist yet, so there are no flags to reset. */
const settingsView = computed<SettingsView>(() => ({ settings: settings.value ?? { ...HQ_SETTING_DEFAULTS }, tutorialsReady: false }))
const settingsBusy = ref(false)

async function onSetting(target: SettingsTarget) {
    // the reset has nothing to clear until tutorials and their flags exist; the scene holds its button
    if (target === 'resetTutorials') return
    settingsBusy.value = true
    try {
        await setSetting(target, !settingsView.value.settings[target])
    } catch {
        // `useHeroQuest` has already shown the error
    } finally {
        settingsBusy.value = false
    }
}

/** The running Battle Speed block's time left, off the server's expiry. */
const speedLeft = useHqCountdown(() => battleSpeed.value?.expiresAt)

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
    if ((settings.value?.confirmGemSpeed ?? true) && !confirm.press(`speed:${speed}:${minutes}`)) return
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
    // a track paid in Void Shards waits for a second press, unless that is turned off in Settings
    const track = shop.value?.find(t => t.id === upgradeId)
    const asks = track?.currency === 'voidShards' && (settings.value?.confirmVoidShards ?? true)
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
const { liveRun, liveHero, speedNow } = useHqLiveRun(run, hero, battleSpeed)

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
const engaging = ref(false)
/** Which of the two paths opened the replay — only an automatic one dismisses itself. */
const fightWasAutomatic = ref(false)

/**
 * The boss's name and timer, taken as the fight is engaged: the payload that lands with the
 * result has already moved the run past the gate, so `liveRun` names the next stage's foes.
 */
const fightBoss = ref({ name: 'Boss', timer: 30 })
/** How far the stage has played the fight, and whether its result is up. */
const fightProgress = ref({ time: 0, done: false })
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

/** The stat-attribution slideover. Fetched on open, never with the state payload. */
const breakdownOpen = ref(false)

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
    try {
        // farming in front of a lost boss shows the stage before it; the payload names the boss itself
        const name = liveRun.value?.farming ? run.value?.enemyName : liveRun.value?.enemyName
        const boss = { name: name ?? 'Boss', timer: liveRun.value?.bossTimerSeconds ?? 30 }
        const result = await engageBoss({ silentErrors: automatic })
        fightWasAutomatic.value = automatic
        fightBoss.value = boss
        fightProgress.value = { time: 0, done: false }
        fight.value = result
    } finally {
        engaging.value = false
    }
}

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
    replayOpen: () => fight.value !== null,
    engage: () => runFightAt(true)
})

/**
 * The four headline stats, paired with the glossary entry that explains each.
 *
 * The screen shows *derived* values — Health rather than Vitality, Crit rather than Luck — so the
 * pairing is explicit rather than a key lookup: a player reading "Health" wants to be told about
 * the stat that produces it.
 */
const statTiles = computed(() => {
    const stats = liveHero.value?.stats
    if (!stats) return []
    return [
        { label: 'Power', value: formatHq(stats.pwr), doc: HQ_STAT_DOC_BY_KEY.pwr! },
        { label: 'Defence', value: formatHq(stats.def), doc: HQ_STAT_DOC_BY_KEY.def! },
        { label: 'Health', value: formatHq(stats.maxHp), doc: HQ_STAT_DOC_BY_KEY.vit! },
        { label: 'Crit', value: `${Math.round(stats.critChance * 100)}%`, doc: HQ_STAT_DOC_BY_KEY.lck! }
    ]
})

/**
 * Only worth showing when the player was actually away — an online settle covers ~60s and
 * banking three kills is not news.
 */
const awayReport = computed(() => {
    const report = settled.value
    if (!report || report.online || report.kills <= 0) return null
    return report
})
</script>

<template>
  <div
    class="p-4 sm:p-6 max-w-4xl mx-auto space-y-6"
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
      <UAlert
        v-if="awayReport && scene === 'battle'"
        color="primary"
        variant="subtle"
        icon="i-lucide-moon"
        title="While you were away"
        :description="`${formatNumber(awayReport.kills)} kills over ${formatSeconds(awayReport.effectiveSeconds)} of counted time — ${formatNumber(awayReport.goldEarned)} gold`
          + (awayReport.levelsGained > 0 ? `, ${awayReport.levelsGained} level${awayReport.levelsGained === 1 ? '' : 's'}` : '')
          + (awayReport.blockedAtBoss ? '. Your run is parked at a boss.' : '.')"
      />

      <!-- A prestige under way holds the bridge up, so the party finishes the walk. -->
      <template v-if="showGate && (scene === 'battle' || holdGate)">
        <HeroQuestPrestigeGate
          :party="gateParty"
          :pending="prestiging"
          :crossing="crossing"
          :earned="earnedShards"
          @begin="beginAgain"
          @crossed="onCrossed"
          @scene="emit('scene', $event)"
        />
        <p class="text-center text-sm text-muted">
          Begin again at World 1 for {{ formatHq(nextPrestigeReward) }} Void Shards. Your hero keeps every level.
        </p>
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
          :classes="classesView"
          :classes-busy="classesBusy"
          @fight-progress="fightProgress = $event"
          @challenge="onEngage"
          @scene="emit('scene', $event)"
          @collection-tab="openCollectionTab"
          @collection-action="onCollectionAction"
          @loadout-action="onLoadoutAction"
          @loadout-rename="onLoadoutRename"
          @shop-buy="onShopBuy"
          @buy-speed="onBuySpeed"
          @gacha-action="onGachaAction"
          @gacha-close="gachaReveal = null"
          @setting="onSetting"
          @pick-class="onPickClass"
        />
      </template>

      <!-- Hidden rather than unmounted under a scene: the fight panel closes an automatic fight on its own timer. -->
      <div
        v-show="scene === 'battle' && !showGate"
        class="space-y-6"
      >
        <!-- A boss fight takes the readout's place while the stage plays it. -->
        <HeroQuestBossFightPanel
          v-if="fight"
          :fight="fight"
          :enemy-name="fightBoss.name"
          :boss-timer-seconds="fightBoss.timer"
          :time="fightProgress.time"
          :done="fightProgress.done"
          :auto-close="fightWasAutomatic"
          @skip="battleCanvas?.skipFight()"
          @close="fight = null"
        />

        <HeroQuestBattleView
          v-else
          :run="liveRun"
        />

        <!--
          Not on a cleared run: the World 10 super boss stays parked on its gate after it falls, and
          the server rejects a re-fight there. The battle view already points the player at prestige.
        -->
        <div
          v-if="(liveRun.atBossGate || liveRun.farming) && !liveRun.runCleared && !fight"
          class="flex justify-center"
        >
          <UButton
            size="lg"
            color="error"
            icon="i-lucide-swords"
            :loading="engaging"
            @click="onEngage"
          >
            Fight {{ liveRun.enemyName }}
          </UButton>
        </div>
      </div>

      <div
        v-show="scene === 'battle'"
        class="rounded-lg border border-default bg-elevated/40 p-4"
      >
        <div class="flex items-center justify-between mb-3">
          <span class="font-medium text-highlighted">{{ liveHero.className }}</span>
          <span class="text-sm text-muted">Level {{ liveHero.level }}</span>
        </div>

        <!--
          The payload's power, not a projection: it needs the full snapshot, which only the
          server has. It moves when the next payload lands — every poll, pull, equip and level
          the server has settled.
        -->
        <HeroQuestGlobalPower
          v-if="hero?.power"
          class="mb-4"
          :gpn="hero.power.gpn"
          :dps="hero.power.dps"
          :ehp="hero.power.ehp"
        />

        <div class="mb-4">
          <div class="flex items-center justify-between text-xs text-muted mb-1">
            <span>Experience</span>
            <span>{{ formatHq(liveHero.xp) }} / {{ formatHq(liveHero.xpToNextLevel) }}</span>
          </div>
          <UProgress
            :model-value="liveHero.xpProgress * 100"
            size="sm"
          />
        </div>

        <!--
          Each tile carries its own explanation (session-1 playtest, finding 6). The text comes
          from `HQ_STAT_DOCS`, the same table the wiki renders, so the tooltip and the wiki page
          can never describe a stat differently.
        -->
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-muted">Stats</span>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-list-tree"
            @click="breakdownOpen = true"
          >
            Breakdown
          </UButton>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div
            v-for="tile in statTiles"
            :key="tile.label"
          >
            <div class="text-xs text-muted flex items-center gap-0.5">
              {{ tile.label }}
              <HeroQuestInfoTip
                :title="tile.doc.name"
                :body="tile.doc.short"
                :formula="tile.doc.formula"
                to="/hero-quest/wiki/combat"
              />
            </div>
            <div class="font-medium text-highlighted">
              {{ tile.value }}
            </div>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-default">
          <p class="text-xs text-muted mb-1.5 flex items-center gap-0.5">
            Skills — every one fires the moment its cooldown ends
            <HeroQuestInfoTip
              title="Auto-cast"
              body="There is no cast button anywhere in the game. Every skill on every unit fires
                the instant its cooldown ends, so equipping one is a build decision rather than an
                input you have to keep making."
              to="/hero-quest/wiki"
            />
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="skill in liveHero.skills"
              :key="skill.id"
              color="neutral"
              variant="subtle"
            >
              {{ skill.name }}
            </UBadge>
          </div>
        </div>
      </div>
    </template>

    <HeroQuestStatBreakdown v-model:open="breakdownOpen" />

  </div>
</template>
