import { useNow } from '@vueuse/core'
import { getPlant, getPlantDisplay, isHybrid, plantBuyPrice, XENO_UPGRADE_TRACKS, xenoUpgradeCost, type XenoUpgradeId } from '#shared/utils/xeno'

// Xeno in spreadsheet mode: the grid, inventory, seed market, upgrades and
// breeder as tables, played with checkboxes and dropdown chips. Every action
// goes through useXeno, the same code the Xeno page runs.

type XenoState = NonNullable<ReturnType<typeof useXeno>['state']['value']>
type XenoStack = XenoState['inventory'][number]
type XenoGridSlot = XenoState['grid']['slots'][number]
type XenoBreederSlot = XenoState['breeder']['slots'][number]
type HarvestDrop = { name: string, count: number }

const stackKey = (s: { typeId: string, speed: number | null, yield: number | null }) => `${s.typeId}:${s.speed}:${s.yield}`
const plantName = (typeId: string) => getPlantDisplay(typeId)?.name ?? typeId
const stackLabel = (s: XenoStack) => `${plantName(s.typeId)} · S${s.speed} Y${s.yield}`

const WIDTHS: Record<number, number> = { 0: 170, 1: 170, 2: 170, 5: 150, 8: 170 }

export function useSheetXeno() {
  const { balanceNum } = useAuth()
  const xeno = useXeno({ silent: true, immediate: false })
  const source = useComposableSource(xeno.state, xeno.refresh)
  const { error, run, checkbox, confirmCheckbox } = useSheetRun()
  const now = useNow({ interval: 5000 })
  const lastAction = ref('')

  const buyQuantity = ref(1)
  const plantAllKey = ref<string | null>(null)
  // Breeder parents picked per empty slot, by stack key
  const parents = reactive<Record<string, [string | null, string | null]>>({})

  const stacks = computed(() => xeno.state.value?.inventory ?? [])
  const findStack = (key: string | null) => stacks.value.find(s => stackKey(s) === key)
  const choicesFor = (list: XenoStack[]) => Object.fromEntries(list.map(s => [stackKey(s), stackLabel(s)])) as Record<string, string>

  const plant = (slotId: string, stack: XenoStack) => run(`plant:${slotId}`, async () => {
    await xeno.plantInSlot(slotId, stack.typeId, stack.speed, stack.yield)
    lastAction.value = `Planted 1 ${plantName(stack.typeId)}`
  })

  const plantAll = (stack: XenoStack) => run('plant-all', async () => {
    const res = await xeno.plantAllSlots(stack.typeId, stack.speed, stack.yield) as { planted: number }
    lastAction.value = `Planted ${res.planted} ${plantName(stack.typeId)}`
  })

  const describeHarvest = (drops: HarvestDrop[]) => drops.map(d => `${d.count} ${d.name}`).join(', ')
  const harvestOne = async (slot: XenoGridSlot) => ((await xeno.harvestSlot(slot.id)) as { drops: HarvestDrop[] }).drops

  const harvest = (slot: XenoGridSlot) => run(`harvest:${slot.id}`, async () => {
    lastAction.value = `Harvested ${describeHarvest(await harvestOne(slot))}`
  })

  // One at a time: each harvest is its own claim on the server
  const harvestReady = (slots: XenoGridSlot[]) => run('harvest-all', async () => {
    const totals = new Map<string, number>()
    for (const slot of slots) {
      for (const d of await harvestOne(slot)) totals.set(d.name, (totals.get(d.name) ?? 0) + d.count)
    }
    lastAction.value = `Harvested ${describeHarvest([...totals].map(([name, count]) => ({ name, count })))}`
  })

  const sell = (stack: XenoStack, quantity: number) => run(`sell:${stackKey(stack)}:${quantity}`, async () => {
    const res = await xeno.sellPlants(stack.typeId, stack.speed, stack.yield, quantity) as { sold: number, total: number }
    lastAction.value = `Sold ${res.sold} ${plantName(stack.typeId)} for ${formatCellNumber(res.total, 'number')}`
  })

  const buy = (typeId: string) => run(`buy:${typeId}`, async () => {
    const res = await xeno.buyPlants(typeId, buyQuantity.value) as { bought: number, total: number }
    lastAction.value = `Bought ${res.bought} ${plantName(typeId)} for ${formatCellNumber(res.total, 'number')}`
  })

  const buyUpgrade = (upgradeId: XenoUpgradeId) => run(`upgrade:${upgradeId}`, () => xeno.buyUpgrade(upgradeId))
  const unlockGrid = () => run('unlock-grid', () => xeno.unlockGridSlot())
  const unlockBreeder = () => run('unlock-breeder', () => xeno.unlockBreederSlot())
  const start = () => run('init', () => xeno.initGame())

  const collect = (slot: XenoBreederSlot) => run(`collect:${slot.id}`, async () => {
    const res = await xeno.collectBreed(slot.id) as { collected: number, plantName: string, wasMutation: boolean }
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
    return run(`breed:${slot.id}`, async () => {
      await xeno.startBreed(slot.id, p1.typeId, p1.speed, p1.yield, p2.typeId, p2.speed, p2.yield)
      parents[slot.id] = [null, null]
    })
  }

  return computed<SheetTab>(() => {
    const state = source.data.value
    const cells: SheetCells = { ...sourceHeader('Xeno', source) }
    if (error.value) cells.C3 = { error: error.value }
    const tab: SheetTab = { id: 'xeno', name: 'Xeno', widths: WIDTHS, cells, activate: () => source.load() }
    if (!state) return tab

    const heads = (r: number, labels: string[]) => sheetHeads(cells, r, labels)

    if (!state.initialized) {
      cells.A5 = { v: 'Start Xeno' }
      cells.B5 = checkbox('init', start)
      return tab
    }

    cells.A4 = { v: 'Coins' }
    cells.B4 = { v: balanceNum.value, fmt: 'number' }
    cells.C4 = lastAction.value ? { v: lastAction.value, italic: true, color: SHEET_MUTED } : {}

    const choices = choicesFor(stacks.value)
    const choiceOptions = Object.values(choices)
    const pickStack = (apply: (stack: XenoStack) => void, from = choices) => choiceEditor(from, (key) => {
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
        cells[cellKey(r, 1)] = { v: 'Empty', color: SHEET_MUTED }
        // Only the plants this slot can host, as on the Xeno page (void plants need an artifact)
        const hostable = choicesFor(stacks.value.filter(s => xeno.canHost(slot, s.typeId)))
        const options = Object.values(hostable)
        if (options.length) {
          cells[cellKey(r, 2)] = { v: '', type: 'dropdown', options, edit: pickStack(stack => plant(slot.id, stack), hostable) }
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
      cells[cellKey(r, 0)] = { v: 'Nothing in stock: harvest or buy seeds.', italic: true, color: SHEET_MUTED }
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
      cells[cellKey(r, 8)] = confirmCheckbox(`sell:${stackKey(stack)}:${stack.quantity}`, () => sell(stack, stack.quantity))
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
      cells[cellKey(r, 5)] = cost === null ? { v: 'Maxed', color: SHEET_MUTED, align: 'right' } : { v: cost, fmt: 'number' }
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
          cells[cellKey(r, 4)] = { v: 'Breeding…', color: SHEET_MUTED }
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
        cells[cellKey(r, 1)] = { v: 'Empty', color: SHEET_MUTED }
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
