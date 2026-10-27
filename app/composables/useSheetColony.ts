import { useNow } from '@vueuse/core'
import { HABITAT_BUILDER_JOB_ID } from '#shared/utils/colony'

// Colony in spreadsheet mode: nutrition, habitat, loot, terrarium, bug stock,
// the bug shop, items, upgrades and research as tables, played with
// checkboxes. The server validates every action; the sheet only picks what to
// send.

interface ColonyBugStackView { typeId: string, name: string, tier: number, speed: number, yield: number, eat: number, quantity: number, itemName: string }
interface ColonyPlacedBug { id: string, typeId: string, name: string, speed: number, yield: number, eat: number, itemName: string, tickMs: number }
interface ColonySpecies { id: string, name: string, tier: number, itemName: string, itemSellValue: number, spawnCost: number, buyable: boolean, owned: number }
interface ColonyItem { id: string, name: string, tier: number, sellValue: number, quantity: number }
interface ColonyLoot { itemTypeId: string, name: string, quantity: number }
interface ColonyUpgrade {
  id: string
  name: string
  level: number
  maxLevel: number
  atMax: boolean
  currentEffect: string
  nextEffect: string | null
  nextCost: { coins: number, items: { itemTypeId: string, quantity: number }[] } | null
  nextDurationMs: number | null
  requiredLevel: number | null
  meetsHabitatRequirement: boolean
}
interface ColonyResearch { typeId: string, name: string, tier: number, level: number, maxLevel: number, atMax: boolean, cost: number | null, nextSpeedRange: [number, number] | null, nextYieldRange: [number, number] | null }
interface ColonyJob { id: string, kind: 'habitat' | 'track', trackId: string, trackName: string, level: number, completesAt: string }
interface ColonyState {
  initialized: boolean
  capacity: number
  habitatLevel: number
  maxTier: number
  habitatLevelUpCost: number
  habitatLevelUpDurationMs: number
  habitatLevelUpGemCost: number
  nutrition: number
  nutritionMax: number
  nutritionDrainPerHour: number
  feedCost: number
  gemFeedCost: number
  gemBuffActive: boolean
  bugs: ColonyPlacedBug[]
  speciesCatalog: ColonySpecies[]
  inventory: ColonyItem[]
  bugInventory: ColonyBugStackView[]
  placedCount: number
  pendingLoot: ColonyLoot[]
  upgrades: ColonyUpgrade[]
  research: ColonyResearch[]
  builders: ColonyJob[]
  builderCount: number
}

const WIDTHS: Record<number, number> = { 0: 190, 1: 150, 2: 210, 3: 110, 4: 110, 5: 130, 6: 230 }
const MUTED = '#5f6368'
const hours = (ms: number) => ms / 3_600_000

export function useSheetColony() {
  const { balanceNum, user } = useAuth()
  const source = useSheetSource<ColonyState>('/api/colony/state')
  const { busy, error, act } = useSheetAction(source)
  const now = useNow({ interval: 5000 })
  const lastAction = ref('')

  const post = <T>(url: string, body?: Record<string, unknown>) => apiFetch<T>(url, { method: 'POST', body: body ?? {} })
  const stack = (s: ColonyBugStackView) => ({ typeId: s.typeId, speed: s.speed, yield: s.yield, eat: s.eat })
  const stackKey = (s: ColonyBugStackView) => `${s.typeId}:${s.speed}:${s.yield}:${s.eat}`

  const start = () => act('init', () => post('/api/colony/init'))
  const feed = (method: 'coins' | 'gems') => act(`feed:${method}`, async () => {
    await post('/api/colony/feed', { method })
    lastAction.value = method === 'gems' ? 'Fed the colony with gems' : 'Fed the colony'
  })
  const upgradeHabitat = () => act('habitat', () => post('/api/colony/habitat/upgrade'))
  const collectLoot = () => act('loot', async () => {
    const { collected: items } = await post<{ collected: { name: string, quantity: number }[] }>('/api/colony/loot/collect')
    lastAction.value = items.length ? `Collected ${items.map(i => `${i.quantity} ${i.name}`).join(', ')}` : 'Collected loot'
  })
  const place = (s: ColonyBugStackView) => act(`place:${stackKey(s)}`, async () => {
    await post('/api/colony/bugs/place', stack(s))
    lastAction.value = `Placed a ${s.name}`
  })
  const release = (s: ColonyBugStackView) => act(`release:${stackKey(s)}`, async () => {
    const res = await post<{ released: number, refund: number }>('/api/colony/bugs/release', { stacks: [{ ...stack(s), quantity: s.quantity }] })
    lastAction.value = `Released ${res.released} ${s.name} for ${formatCellNumber(res.refund, 'number')}`
  })
  const unplace = (bug: ColonyPlacedBug) => act(`unplace:${bug.id}`, async () => {
    await post('/api/colony/bugs/unplace', { bugId: bug.id })
    lastAction.value = `Moved a ${bug.name} back to stock`
  })
  const buy = (species: ColonySpecies) => act(`buy:${species.id}`, async () => {
    const res = await post<{ speed: number, yield: number, eat: number }>('/api/colony/bugs/buy', { typeId: species.id })
    lastAction.value = `Bought a ${species.name} (speed ${res.speed}, yield ${res.yield}, eat ${res.eat})`
  })
  const sell = (item: ColonyItem) => act(`sell:${item.id}`, async () => {
    const res = await post<{ coins: number, quantity: number }>('/api/colony/market/sell', { itemTypeId: item.id })
    lastAction.value = `Sold ${res.quantity} ${item.name} for ${formatCellNumber(res.coins, 'number')}`
  })
  const startUpgrade = (track: ColonyUpgrade) => act(`upgrade:${track.id}`, () => post('/api/colony/upgrades/start', { trackId: track.id }))
  const collectJob = (job: ColonyJob) => act(`collect:${job.id}`, async () => {
    await post('/api/colony/upgrades/collect', { trackId: job.trackId })
    lastAction.value = `${job.trackName} reached level ${job.level}`
  })
  const research = (row: ColonyResearch) => act(`research:${row.typeId}`, async () => {
    const res = await post<{ level: number }>('/api/colony/research/sacrifice', { typeId: row.typeId })
    lastAction.value = `${row.name} research is now level ${res.level}`
  })

  return computed<SheetTab>(() => {
    const state = source.data.value
    const cells: SheetCells = { ...sourceHeader('Colony', source) }
    if (error.value) cells.C3 = { error: error.value }
    const tab: SheetTab = { id: 'colony', name: 'Colony', widths: WIDTHS, cells, activate: () => source.load() }
    if (!state) return tab

    const checkbox = (key: string, toggle: () => void): SheetCell => ({ type: 'checkbox', v: busy.value === key, toggle })
    const heads = (r: number, labels: string[]) => labels.forEach((label, c) => {
      cells[cellKey(r, c)] = { v: label, ...SHEET_HEADER }
    })
    const section = (r: number, title: string) => {
      cells[cellKey(r, 0)] = { v: title, bold: true }
    }

    if (!state.initialized) {
      cells.A5 = { v: 'Start Colony' }
      cells.B5 = checkbox('init', start)
      return tab
    }

    const items = new Map(state.inventory.map(i => [i.id, i.name] as const))
    const time = now.value.getTime()

    cells.A4 = { v: 'Coins' }
    cells.B4 = { v: balanceNum.value, fmt: 'number' }
    cells.C4 = lastAction.value ? { v: lastAction.value, italic: true, color: MUTED } : {}
    cells.A5 = { v: 'Gems' }
    cells.B5 = { v: parseFloat(String(user.value?.gems ?? 0)), fmt: 'int' }

    // ── Colony ──
    let r = 6
    section(r, 'Colony')
    r++
    heads(r, ['Item', 'Value', 'Detail', 'Cost', 'Gem cost', '', '', 'Do it'])
    r++
    const habitatJob = state.builders.find(j => j.trackId === HABITAT_BUILDER_JOB_ID)
    const rows: [string, SheetCell, string, SheetCell?, SheetCell?, SheetCell?][] = [
      ['Habitat level', { v: state.habitatLevel, fmt: 'int' }, `Next level takes ${formatCellNumber(hours(state.habitatLevelUpDurationMs), 'number')} hours`,
        { v: state.habitatLevelUpCost, fmt: 'number' }, { v: state.habitatLevelUpGemCost, fmt: 'int' },
        habitatJob ? undefined : checkbox('habitat', upgradeHabitat)],
      ['Terrarium', { v: `${state.placedCount} / ${state.capacity}`, align: 'right' }, 'Bugs placed'],
      ['Nutrition', { v: `${formatCellNumber(state.nutrition, 'int')} / ${formatCellNumber(state.nutritionMax, 'int')}`, align: 'right' },
        `Uses ${formatCellNumber(state.nutritionDrainPerHour, 'int')} per hour`,
        { v: state.feedCost, fmt: 'number' }, undefined,
        state.nutrition < state.nutritionMax ? checkbox('feed:coins', () => feed('coins')) : undefined],
      ['Gem feed', { v: state.gemBuffActive }, 'Speeds every bug up while it lasts',
        undefined, { v: state.gemFeedCost, fmt: 'int' }, checkbox('feed:gems', () => feed('gems'))],
      ['Builders', { v: `${state.builders.length} / ${state.builderCount} busy`, align: 'right' }, '']
    ]
    for (const [label, value, detail, cost, gems, action] of rows) {
      cells[cellKey(r, 0)] = { v: label }
      cells[cellKey(r, 1)] = value
      cells[cellKey(r, 2)] = { v: detail, color: MUTED }
      if (cost) cells[cellKey(r, 3)] = cost
      if (gems) cells[cellKey(r, 4)] = gems
      if (action) cells[cellKey(r, 7)] = action
      r++
    }

    // ── Builder jobs ──
    if (state.builders.length) {
      r++
      section(r, `Building (${state.builders.length})`)
      r++
      heads(r, ['Job', 'To level', 'Done at', 'Done', '', '', '', 'Collect'])
      r++
      for (const job of state.builders) {
        const done = new Date(job.completesAt).getTime() <= time
        cells[cellKey(r, 0)] = { v: job.trackName }
        cells[cellKey(r, 1)] = { v: job.level, fmt: 'int' }
        cells[cellKey(r, 2)] = valueCell(job.completesAt)
        cells[cellKey(r, 3)] = { v: done }
        if (done) cells[cellKey(r, 7)] = checkbox(`collect:${job.id}`, () => collectJob(job))
        r++
      }
    }

    // ── Loot ──
    r++
    section(r, 'Loot waiting')
    if (state.pendingLoot.length) cells[cellKey(r, 7)] = checkbox('loot', collectLoot)
    r++
    if (!state.pendingLoot.length) {
      cells[cellKey(r, 0)] = { v: 'Nothing to collect yet.', italic: true, color: MUTED }
      r++
    }
    for (const loot of state.pendingLoot) {
      cells[cellKey(r, 0)] = { v: loot.name }
      cells[cellKey(r, 1)] = { v: loot.quantity, fmt: 'int' }
      r++
    }

    // ── Terrarium ──
    r++
    section(r, `Terrarium (${state.bugs.length})`)
    r++
    heads(r, ['Bug', 'Makes', 'Cycle (min)', 'Speed', 'Yield', 'Eat', '', 'To stock'])
    r++
    for (const bug of state.bugs) {
      cells[cellKey(r, 0)] = { v: bug.name }
      cells[cellKey(r, 1)] = { v: bug.itemName }
      cells[cellKey(r, 2)] = { v: bug.tickMs / 60_000, fmt: 'number' }
      cells[cellKey(r, 3)] = { v: bug.speed, fmt: 'int' }
      cells[cellKey(r, 4)] = { v: bug.yield, fmt: 'int' }
      cells[cellKey(r, 5)] = { v: bug.eat, fmt: 'int' }
      cells[cellKey(r, 7)] = checkbox(`unplace:${bug.id}`, () => unplace(bug))
      r++
    }
    if (!state.bugs.length) {
      cells[cellKey(r, 0)] = { v: 'No bugs placed: place one from your stock.', italic: true, color: MUTED }
      r++
    }

    // ── Bug stock ──
    const full = state.placedCount >= state.capacity
    r++
    section(r, `Bug stock (${state.bugInventory.reduce((n, s) => n + s.quantity, 0)})`)
    r++
    heads(r, ['Bug', 'Makes', 'Quantity', 'Speed', 'Yield', 'Eat', 'Release all', 'Place 1'])
    r++
    for (const s of state.bugInventory) {
      cells[cellKey(r, 0)] = { v: s.name }
      cells[cellKey(r, 1)] = { v: s.itemName }
      cells[cellKey(r, 2)] = { v: s.quantity, fmt: 'int' }
      cells[cellKey(r, 3)] = { v: s.speed, fmt: 'int' }
      cells[cellKey(r, 4)] = { v: s.yield, fmt: 'int' }
      cells[cellKey(r, 5)] = { v: s.eat, fmt: 'int' }
      cells[cellKey(r, 6)] = checkbox(`release:${stackKey(s)}`, () => release(s))
      if (!full) cells[cellKey(r, 7)] = checkbox(`place:${stackKey(s)}`, () => place(s))
      r++
    }
    if (!state.bugInventory.length) {
      cells[cellKey(r, 0)] = { v: 'No spare bugs: buy one below.', italic: true, color: MUTED }
      r++
    }

    // ── Bug shop ──
    r++
    section(r, 'Bug shop')
    r++
    heads(r, ['Bug', 'Makes', 'Tier', 'Price', 'Item value', 'Owned', '', 'Buy'])
    r++
    for (const species of state.speciesCatalog) {
      cells[cellKey(r, 0)] = { v: species.name, color: species.buyable ? undefined : MUTED }
      cells[cellKey(r, 1)] = { v: species.itemName }
      cells[cellKey(r, 2)] = { v: species.tier, fmt: 'int' }
      cells[cellKey(r, 3)] = { v: species.spawnCost, fmt: 'number' }
      cells[cellKey(r, 4)] = { v: species.itemSellValue, fmt: 'number' }
      cells[cellKey(r, 5)] = { v: species.owned, fmt: 'int' }
      cells[cellKey(r, 7)] = species.buyable ? checkbox(`buy:${species.id}`, () => buy(species)) : { v: 'Locked', color: MUTED, align: 'center' }
      r++
    }

    // ── Items ──
    r++
    section(r, 'Items')
    r++
    heads(r, ['Item', 'Tier', 'Quantity', 'Value', 'Total value', '', '', 'Sell all'])
    r++
    for (const item of state.inventory) {
      cells[cellKey(r, 0)] = { v: item.name }
      cells[cellKey(r, 1)] = { v: item.tier, fmt: 'int' }
      cells[cellKey(r, 2)] = { v: item.quantity, fmt: 'int' }
      cells[cellKey(r, 3)] = { v: item.sellValue, fmt: 'number' }
      cells[cellKey(r, 4)] = { v: item.sellValue * item.quantity, fmt: 'number', f: `=C${r + 1}*D${r + 1}` }
      if (item.quantity > 0) cells[cellKey(r, 7)] = checkbox(`sell:${item.id}`, () => sell(item))
      r++
    }

    // ── Upgrades ──
    const runningTracks = new Set(state.builders.map(j => j.trackId))
    const freeBuilder = state.builders.length < state.builderCount
    r++
    section(r, 'Upgrades')
    r++
    heads(r, ['Upgrade', 'Now', 'Next', 'Level', 'Coins', 'Hours', 'Items', 'Start'])
    r++
    for (const track of state.upgrades) {
      cells[cellKey(r, 0)] = { v: track.name }
      cells[cellKey(r, 1)] = { v: track.currentEffect }
      cells[cellKey(r, 2)] = { v: track.nextEffect ?? 'Maxed', color: track.nextEffect ? undefined : MUTED }
      // requiredLevel is what the next habitat level-up needs from this track
      cells[cellKey(r, 3)] = {
        v: `${track.level} / ${track.maxLevel}`,
        align: 'right',
        color: track.meetsHabitatRequirement ? undefined : SHEET_LOSS,
        note: track.requiredLevel ? `The next habitat level needs this at level ${track.requiredLevel}.` : undefined
      }
      if (track.nextCost) {
        cells[cellKey(r, 4)] = { v: track.nextCost.coins, fmt: 'number' }
        cells[cellKey(r, 6)] = { v: track.nextCost.items.map(i => `${formatCellNumber(i.quantity, 'int')} ${items.get(i.itemTypeId) ?? i.itemTypeId}`).join(', ') }
      }
      if (track.nextDurationMs) cells[cellKey(r, 5)] = { v: hours(track.nextDurationMs), fmt: 'number' }
      if (runningTracks.has(track.id)) {
        cells[cellKey(r, 7)] = { v: 'Building', color: MUTED, align: 'center' }
      } else if (!track.atMax && freeBuilder) {
        cells[cellKey(r, 7)] = checkbox(`upgrade:${track.id}`, () => startUpgrade(track))
      }
      r++
    }

    // ── Research ──
    r++
    section(r, 'Research')
    r++
    heads(r, ['Bug', 'Tier', 'Next speed', 'Next yield', 'Level', 'Cost', '', 'Research'])
    r++
    for (const row of state.research) {
      cells[cellKey(r, 0)] = { v: row.name }
      cells[cellKey(r, 1)] = { v: row.tier, fmt: 'int' }
      if (row.nextSpeedRange) cells[cellKey(r, 2)] = { v: `${row.nextSpeedRange[0]}–${row.nextSpeedRange[1]}%`, align: 'right' }
      if (row.nextYieldRange) cells[cellKey(r, 3)] = { v: `${row.nextYieldRange[0]}–${row.nextYieldRange[1]}`, align: 'right' }
      cells[cellKey(r, 4)] = { v: `${row.level} / ${row.maxLevel}`, align: 'right' }
      if (row.cost !== null && !row.atMax) {
        cells[cellKey(r, 5)] = { v: row.cost, fmt: 'number' }
        cells[cellKey(r, 7)] = checkbox(`research:${row.typeId}`, () => research(row))
      } else {
        cells[cellKey(r, 5)] = { v: 'Maxed', color: MUTED, align: 'right' }
      }
      r++
    }

    return tab
  })
}
