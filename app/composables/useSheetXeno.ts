import { useNow } from '@vueuse/core'
import { getPlant, getPlantDisplay, isHybrid, plantBuyPrice, XENO_UPGRADE_TRACKS, xenoUpgradeCost, type XenoUpgradeId } from '#shared/utils/xeno'

// Xeno in spreadsheet mode: the grid, inventory, seed market, upgrades and
// breeder as tables, played with checkboxes and dropdown chips. The server
// validates every action; the sheet only picks what to send.

interface XenoStack { typeId: string, speed: number, yield: number, quantity: number }
interface XenoGridSlot {
  id: string
  slotIndex: number
  plant: { typeId: string, name: string, tier: number, speed: number, yield: number, completesAt: string } | null
}
interface XenoParent { typeId: string, speed: number | null, yield: number | null }
interface XenoBreederSlot {
  id: string
  slotIndex: number
  parent1: XenoParent | null
  parent2: XenoParent | null
  completesAt: string | null
  resultTypeId: string | null
  resultQuantity: number | null
  wasMutation: boolean | null
  collected: boolean
}
interface XenoState {
  initialized: boolean
  inventory: XenoStack[]
  upgrades: Record<XenoUpgradeId, number>
  unlockedTypeIds: string[]
  grid: { slots: XenoGridSlot[], unlockedCount: number, nextSlotCost: number, maxSlots: number }
  breeder: { slots: XenoBreederSlot[], unlockedCount: number, nextSlotCost: number, maxSlots: number }
  [key: string]: unknown
}

const stackKey = (s: { typeId: string, speed: number | null, yield: number | null }) => `${s.typeId}:${s.speed}:${s.yield}`
const plantName = (typeId: string) => getPlantDisplay(typeId)?.name ?? typeId
const stackLabel = (s: XenoStack) => `${plantName(s.typeId)} · S${s.speed} Y${s.yield}`

const WIDTHS: Record<number, number> = { 0: 170, 1: 170, 2: 170, 5: 150, 8: 170 }
const MUTED = '#5f6368'

export function useSheetXeno() {
  const { balanceNum, setBalance } = useAuth()
  const source = useSheetSource<XenoState>('/api/xeno/state')
  const { busy, error, act } = useSheetAction(source)
  const now = useNow({ interval: 5000 })
  const lastAction = ref('')

  const buyQuantity = ref(1)
  const plantAllKey = ref<string | null>(null)
  // Breeder parents picked per empty slot, by stack key
  const parents = reactive<Record<string, [string | null, string | null]>>({})

  const post = <T>(url: string, body?: Record<string, unknown>) => apiFetch<T>(url, { method: 'POST', body: body ?? {} })
  const stacks = computed(() => source.data.value?.inventory ?? [])
  const findStack = (key: string | null) => stacks.value.find(s => stackKey(s) === key)
  const stackChoices = computed(() => Object.fromEntries(stacks.value.map(s => [stackKey(s), stackLabel(s)])) as Record<string, string>)

  const plant = (slotId: string, stack: XenoStack) => act(`plant:${slotId}`, async () => {
    await post('/api/xeno/grid/plant', { slotId, typeId: stack.typeId, speed: stack.speed, yield: stack.yield })
    lastAction.value = `Planted 1 ${plantName(stack.typeId)}`
  })

  const plantAll = (stack: XenoStack) => act('plant-all', async () => {
    const res = await post<{ planted: number }>('/api/xeno/grid/plant-all', { typeId: stack.typeId, speed: stack.speed, yield: stack.yield })
    lastAction.value = `Planted ${res.planted} ${plantName(stack.typeId)}`
  })

  function describeHarvest(drops: { name: string, count: number }[]) {
    return drops.map(d => `${d.count} ${d.name}`).join(', ')
  }

  const harvest = (slot: XenoGridSlot) => act(`harvest:${slot.id}`, async () => {
    const res = await post<{ drops: { name: string, count: number }[] }>('/api/xeno/grid/harvest', { slotId: slot.id })
    lastAction.value = `Harvested ${describeHarvest(res.drops)}`
  })

  // One at a time: each harvest is its own claim on the server
  const harvestReady = (slots: XenoGridSlot[]) => act('harvest-all', async () => {
    const got: { name: string, count: number }[] = []
    for (const slot of slots) {
      const res = await post<{ drops: { name: string, count: number }[] }>('/api/xeno/grid/harvest', { slotId: slot.id })
      got.push(...res.drops)
    }
    const totals = new Map<string, number>()
    for (const d of got) totals.set(d.name, (totals.get(d.name) ?? 0) + d.count)
    lastAction.value = `Harvested ${describeHarvest([...totals].map(([name, count]) => ({ name, count })))}`
  })

  const sell = (stack: XenoStack, quantity: number) => act(`sell:${stackKey(stack)}:${quantity}`, async () => {
    const res = await post<{ sold: number, total: number, balance: string | number }>('/api/xeno/market/sell', { typeId: stack.typeId, speed: stack.speed, yield: stack.yield, quantity })
    setBalance(res.balance)
    lastAction.value = `Sold ${res.sold} ${plantName(stack.typeId)} for ${formatCellNumber(res.total, 'number')}`
  })

  const buy = (typeId: string) => act(`buy:${typeId}`, async () => {
    const res = await post<{ bought: number, total: number }>('/api/xeno/market/buy', { typeId, quantity: buyQuantity.value })
    lastAction.value = `Bought ${res.bought} ${plantName(typeId)} for ${formatCellNumber(res.total, 'number')}`
  })

  const buyUpgrade = (upgradeId: XenoUpgradeId) => act(`upgrade:${upgradeId}`, () => post('/api/xeno/upgrades/buy', { upgradeId }))
  const unlockGrid = () => act('unlock-grid', () => post('/api/xeno/grid/unlock'))
  const unlockBreeder = () => act('unlock-breeder', () => post('/api/xeno/breeder/unlock'))
  const start = () => act('init', () => post('/api/xeno/init'))

  const collect = (slot: XenoBreederSlot) => act(`collect:${slot.id}`, async () => {
    const res = await post<{ collected: number, plantName: string, wasMutation: boolean }>('/api/xeno/breeder/collect', { slotId: slot.id })
    lastAction.value = `Collected ${res.collected} ${res.plantName}${res.wasMutation ? ' (mutation)' : ''}`
  })

  function breed(slot: XenoBreederSlot) {
    const [a, b] = parents[slot.id] ?? [null, null]
    const p1 = findStack(a)
    const p2 = findStack(b)
    if (!p1 || !p2) {
      error.value = 'Pick both parents first.'
      return
    }
    return act(`breed:${slot.id}`, async () => {
      await post('/api/xeno/breeder/start', {
        slotId: slot.id,
        plant1TypeId: p1.typeId, plant1Speed: p1.speed, plant1Yield: p1.yield,
        plant2TypeId: p2.typeId, plant2Speed: p2.speed, plant2Yield: p2.yield
      })
      delete parents[slot.id]
    })
  }

  return computed<SheetTab>(() => {
    const state = source.data.value
    const cells: SheetCells = { ...sourceHeader('Xeno', source) }
    if (error.value) cells.C3 = { error: error.value }
    const tab: SheetTab = { id: 'xeno', name: 'Xeno', widths: WIDTHS, cells, activate: () => source.load() }
    if (!state) return tab

    const checkbox = (key: string, toggle: () => void): SheetCell => ({ type: 'checkbox', v: busy.value === key, toggle })
    const heads = (r: number, labels: string[]) => labels.forEach((label, c) => {
      cells[cellKey(r, c)] = { v: label, ...SHEET_HEADER }
    })

    if (!state.initialized) {
      cells.A5 = { v: 'Start Xeno' }
      cells.B5 = checkbox('init', start)
      return tab
    }

    cells.A4 = { v: 'Coins' }
    cells.B4 = { v: balanceNum.value, fmt: 'number' }
    cells.C4 = lastAction.value ? { v: lastAction.value, italic: true, color: MUTED } : {}

    const choices = stackChoices.value
    const choiceOptions = Object.values(choices)
    const pickStack = (apply: (stack: XenoStack) => void) => choiceEditor(choices, (key) => {
      const stack = findStack(key)
      if (stack) apply(stack)
    })

    // ── Grid ──
    const time = now.value.getTime()
    const slots = state.grid.slots
    const ready = slots.filter(s => s.plant && new Date(s.plant.completesAt).getTime() <= time)
    let r = 5
    cells[cellKey(r, 0)] = { v: `Grid (${state.grid.unlockedCount}/${state.grid.maxSlots})`, bold: true }
    if (ready.length) {
      cells[cellKey(r, 2)] = { v: `Harvest ${ready.length} ready`, align: 'right' }
      cells[cellKey(r, 3)] = checkbox('harvest-all', () => harvestReady(ready))
    }
    r++
    heads(r, ['Slot', 'Plant', 'Plant from inventory', 'Speed', 'Yield', 'Ready at', 'Ready', 'Harvest'])
    r++
    for (const slot of slots) {
      cells[cellKey(r, 0)] = { v: slot.slotIndex + 1, fmt: 'int', align: 'left' }
      if (slot.plant) {
        const isReady = new Date(slot.plant.completesAt).getTime() <= time
        cells[cellKey(r, 1)] = { v: slot.plant.name }
        cells[cellKey(r, 3)] = { v: slot.plant.speed, fmt: 'int' }
        cells[cellKey(r, 4)] = { v: slot.plant.yield, fmt: 'int' }
        cells[cellKey(r, 5)] = valueCell(slot.plant.completesAt)
        cells[cellKey(r, 6)] = { v: isReady }
        if (isReady) cells[cellKey(r, 7)] = checkbox(`harvest:${slot.id}`, () => harvest(slot))
      } else {
        cells[cellKey(r, 1)] = { v: 'Empty', color: MUTED }
        if (choiceOptions.length) {
          cells[cellKey(r, 2)] = { v: busy.value === `plant:${slot.id}` ? 'Planting…' : '', type: 'dropdown', options: choiceOptions, edit: pickStack(stack => plant(slot.id, stack)) }
        }
      }
      r++
    }
    if (state.grid.unlockedCount < state.grid.maxSlots) {
      cells[cellKey(r, 0)] = { v: 'Unlock a slot', italic: true }
      cells[cellKey(r, 1)] = { v: state.grid.nextSlotCost, fmt: 'number' }
      cells[cellKey(r, 7)] = checkbox('unlock-grid', unlockGrid)
      r++
    }
    if (choiceOptions.length && slots.some(s => !s.plant)) {
      const chosen = findStack(plantAllKey.value)
      cells[cellKey(r, 0)] = { v: 'Fill empty slots with', italic: true }
      cells[cellKey(r, 2)] = { v: chosen ? stackLabel(chosen) : '', type: 'dropdown', options: choiceOptions, edit: pickStack(stack => plantAllKey.value = stackKey(stack)) }
      if (chosen) cells[cellKey(r, 7)] = checkbox('plant-all', () => plantAll(chosen))
      r++
    }

    // ── Inventory ──
    r++
    cells[cellKey(r, 0)] = { v: `Inventory (${stacks.value.reduce((n, s) => n + s.quantity, 0)})`, bold: true }
    r++
    heads(r, ['Plant', 'Tier', 'Quantity', 'Speed', 'Yield', 'Value', 'Total value', 'Sell 1', 'Sell all'])
    r++
    if (!stacks.value.length) {
      cells[cellKey(r, 0)] = { v: 'Nothing in stock: harvest or buy seeds.', italic: true, color: MUTED }
      r++
    }
    for (const stack of stacks.value) {
      const display = getPlantDisplay(stack.typeId)
      const value = display?.value ?? 0
      cells[cellKey(r, 0)] = { v: display?.name ?? stack.typeId }
      cells[cellKey(r, 1)] = { v: display?.tier ?? 0, fmt: 'int' }
      cells[cellKey(r, 2)] = { v: stack.quantity, fmt: 'int' }
      cells[cellKey(r, 3)] = { v: stack.speed, fmt: 'int' }
      cells[cellKey(r, 4)] = { v: stack.yield, fmt: 'int' }
      cells[cellKey(r, 5)] = { v: value, fmt: 'number' }
      cells[cellKey(r, 6)] = { v: value * stack.quantity, fmt: 'number', f: `=C${r + 1}*F${r + 1}` }
      cells[cellKey(r, 7)] = checkbox(`sell:${stackKey(stack)}:1`, () => sell(stack, 1))
      cells[cellKey(r, 8)] = checkbox(`sell:${stackKey(stack)}:${stack.quantity}`, () => sell(stack, stack.quantity))
      r++
    }

    // ── Seed market ──
    const seeds = state.unlockedTypeIds
      .filter(id => !isHybrid(id))
      .map(id => getPlant(id))
      .filter(p => !!p)
      .sort((a, b) => a.tier - b.tier || a.value - b.value)
    r++
    const quantityRow = r + 1
    cells[cellKey(r, 0)] = { v: `Seed market (${seeds.length})`, bold: true }
    cells[cellKey(r, 5)] = { v: 'Buy quantity', align: 'right' }
    cells[cellKey(r, 6)] = { v: buyQuantity.value, fmt: 'int', bg: SHEET_INPUT_BG, edit: numberEditor(n => buyQuantity.value = Math.round(n), 1, 100) }
    r++
    heads(r, ['Plant', 'Tier', 'Price', 'Speed', 'Yield', 'Value', 'Cost', 'Buy'])
    r++
    for (const seed of seeds) {
      const price = plantBuyPrice(seed)
      cells[cellKey(r, 0)] = { v: seed.name }
      cells[cellKey(r, 1)] = { v: seed.tier, fmt: 'int' }
      cells[cellKey(r, 2)] = { v: price, fmt: 'number' }
      cells[cellKey(r, 3)] = { v: seed.speed, fmt: 'int' }
      cells[cellKey(r, 4)] = { v: seed.yield, fmt: 'int' }
      cells[cellKey(r, 5)] = { v: seed.value, fmt: 'number' }
      cells[cellKey(r, 6)] = { v: price * buyQuantity.value, fmt: 'number', f: `=C${r + 1}*$G$${quantityRow}` }
      cells[cellKey(r, 7)] = checkbox(`buy:${seed.id}`, () => buy(seed.id))
      r++
    }

    // ── Upgrades ──
    r++
    cells[cellKey(r, 0)] = { v: 'Upgrades', bold: true }
    r++
    heads(r, ['Upgrade', 'Effect', 'Description', 'Level', 'Max', 'Next cost', '', 'Buy'])
    r++
    for (const track of XENO_UPGRADE_TRACKS) {
      const level = state.upgrades[track.id] ?? 0
      const cost = xenoUpgradeCost(track.id, level)
      cells[cellKey(r, 0)] = { v: track.name }
      cells[cellKey(r, 1)] = { v: track.effectLabel(level) }
      cells[cellKey(r, 2)] = { v: track.description }
      cells[cellKey(r, 3)] = { v: level, fmt: 'int' }
      cells[cellKey(r, 4)] = { v: track.maxLevel, fmt: 'int' }
      cells[cellKey(r, 5)] = cost === null ? { v: 'Maxed', color: MUTED, align: 'right' } : { v: cost, fmt: 'number' }
      if (cost !== null) cells[cellKey(r, 7)] = checkbox(`upgrade:${track.id}`, () => buyUpgrade(track.id))
      r++
    }

    // ── Breeder ──
    r++
    cells[cellKey(r, 0)] = { v: `Breeder (${state.breeder.unlockedCount}/${state.breeder.maxSlots})`, bold: true }
    r++
    heads(r, ['Slot', 'Parent 1', 'Parent 2', 'Ready at', 'Result', 'Mutation', '', 'Start / collect'])
    r++
    for (const slot of state.breeder.slots) {
      cells[cellKey(r, 0)] = { v: slot.slotIndex + 1, fmt: 'int', align: 'left' }
      const finished = slot.resultTypeId !== null && !slot.collected
      if (slot.parent1 && slot.parent2 && !slot.collected) {
        cells[cellKey(r, 1)] = { v: plantName(slot.parent1.typeId) }
        cells[cellKey(r, 2)] = { v: plantName(slot.parent2.typeId) }
        cells[cellKey(r, 3)] = valueCell(slot.completesAt)
        if (finished) {
          cells[cellKey(r, 4)] = { v: `${slot.resultQuantity ?? 1} × ${plantName(slot.resultTypeId!)}` }
          cells[cellKey(r, 5)] = { v: !!slot.wasMutation }
          cells[cellKey(r, 7)] = checkbox(`collect:${slot.id}`, () => collect(slot))
        } else {
          cells[cellKey(r, 4)] = { v: 'Breeding…', color: MUTED }
        }
      } else if (choiceOptions.length) {
        const [a, b] = parents[slot.id] ?? [null, null]
        const pick = (i: 0 | 1) => pickStack((stack) => {
          const next: [string | null, string | null] = [...(parents[slot.id] ?? [null, null])]
          next[i] = stackKey(stack)
          parents[slot.id] = next
        })
        cells[cellKey(r, 1)] = { v: findStack(a) ? stackLabel(findStack(a)!) : '', type: 'dropdown', options: choiceOptions, edit: pick(0) }
        cells[cellKey(r, 2)] = { v: findStack(b) ? stackLabel(findStack(b)!) : '', type: 'dropdown', options: choiceOptions, edit: pick(1) }
        if (findStack(a) && findStack(b)) cells[cellKey(r, 7)] = checkbox(`breed:${slot.id}`, () => breed(slot))
      } else {
        cells[cellKey(r, 1)] = { v: 'Empty', color: MUTED }
      }
      r++
    }
    if (state.breeder.unlockedCount < state.breeder.maxSlots) {
      cells[cellKey(r, 0)] = { v: 'Unlock a slot', italic: true }
      cells[cellKey(r, 1)] = { v: state.breeder.nextSlotCost, fmt: 'number' }
      cells[cellKey(r, 7)] = checkbox('unlock-breeder', unlockBreeder)
    }

    return tab
  })
}
