import { BANK_MAX_AMOUNT } from '#shared/utils/limits'
import { MIN_DEPLOY_SUCCESS } from '#shared/utils/hack-config'
import { TOWN_ADVICE_LABELS } from '#shared/utils/gamelogic/town-advisor'
import { GEM_EXCHANGE_MAX_QUANTITY, GEM_EXCHANGE_MIN_PRICE, gemDefaultPrice, gemOrderTotal } from '#shared/utils/gamelogic/gem-exchange'
import { useNow } from '@vueuse/core'
import type { TownState } from './useTown'

// The spreadsheet-mode tabs that act on a game's state: Bank deposits and
// withdrawals, Hack Ops dispatches and collects, Polytown's recommended
// upgrades, and Gem Exchange offers. Each shows the live state
// below its controls and reloads it after every action.

const ARM_MS = 3000

/**
 * One action at a time per tab, with its error shown in a cell. `checkbox`
 * runs an action when ticked; `confirmCheckbox` is for spending or selling
 * everything at once: the first tick arms it for a few seconds and only a
 * second tick runs it.
 */
export function useSheetRun() {
  const busy = ref<string | null>(null)
  const error = ref('')
  const armed = ref<string | null>(null)
  let disarm: ReturnType<typeof setTimeout> | undefined

  async function run(key: string, request: () => Promise<unknown>) {
    if (busy.value) return
    busy.value = key
    error.value = ''
    try {
      await request()
    } catch (e) {
      error.value = apiErrorMessage(e, 'Action failed')
    } finally {
      busy.value = null
    }
  }

  const checkbox = (key: string, toggle: () => unknown): SheetCell => ({ type: 'checkbox', v: busy.value === key, toggle })

  function confirmCheckbox(key: string, toggle: () => unknown): SheetCell {
    if (armed.value !== key) {
      return {
        ...checkbox(key, () => {
          armed.value = key
          clearTimeout(disarm)
          disarm = setTimeout(() => armed.value = null, ARM_MS)
        }),
        note: 'Tick twice to confirm.'
      }
    }
    return {
      ...checkbox(key, () => {
        armed.value = null
        clearTimeout(disarm)
        return toggle()
      }),
      bg: SHEET_ARMED_BG,
      note: 'Tick again to confirm.'
    }
  }

  return { busy, error, armed, run, checkbox, confirmCheckbox }
}

/**
 * Runs an action on a state endpoint's tab, then reloads the tab. A request
 * that knows the new balance returns `{ balance }`; otherwise the session is
 * refetched.
 */
export function useSheetAction(source: SheetSource) {
  const { fetchSession, setBalance } = useAuth()
  const runner = useSheetRun()

  const act = (key: string, request: () => Promise<unknown>) => runner.run(key, async () => {
    const wallet = await request() as { balance?: number | string } | undefined
    if (wallet?.balance != null) setBalance(wallet.balance)
    await Promise.all([wallet?.balance != null ? undefined : fetchSession(), source.load(true)])
  })

  return { ...runner, act }
}

export function useSheetBank() {
  const source = useSheetSource('/api/bank/state')
  const { busy, error, act } = useSheetAction(source)
  const depositAmount = ref(1000)
  const withdrawAmount = ref(1000)

  const deposit = () => act('deposit', async () => {
    await apiPost('/api/bank/deposit', { amount: depositAmount.value })
  })
  const withdraw = () => act('withdraw', async () => {
    await apiPost('/api/bank/withdraw', { amount: withdrawAmount.value })
  })

  return computed<SheetTab>(() => {
    const data = source.data.value
    const { cells } = data ? jsonToCells(data, 10) : { cells: {} }
    return {
      id: 'bank',
      name: 'Bank',
      widths: { 0: 200, 1: 140 },
      cells: {
        ...cells,
        ...sourceHeader('Bank', source),
        A5: { v: 'Deposit amount' },
        B5: { v: depositAmount.value, fmt: 'number', bg: SHEET_INPUT_BG, edit: stakeEditor(n => depositAmount.value = n, BANK_MAX_AMOUNT) },
        A6: { v: 'Deposit' },
        B6: { type: 'checkbox', v: busy.value === 'deposit', toggle: deposit },
        A7: { v: 'Withdraw amount' },
        B7: { v: withdrawAmount.value, fmt: 'number', bg: SHEET_INPUT_BG, edit: stakeEditor(n => withdrawAmount.value = n, BANK_MAX_AMOUNT) },
        A8: { v: 'Withdraw' },
        B8: { type: 'checkbox', v: busy.value === 'withdraw', toggle: withdraw },
        ...(error.value ? { B9: { error: error.value } } : {})
      },
      activate: () => source.load()
    }
  })
}

type HackState = GetPayload<'/api/hack/state'>
type HackOp = HackState['activeOps'][number]
type HackTemplate = HackState['opTemplates'][number]

const HACK_WIDTHS: Record<number, number> = { 0: 200, 2: 130, 3: 130 }

export function useSheetHackOps() {
  const source = useSheetSource('/api/hack/state')
  const { error, act, checkbox } = useSheetAction(source)
  const now = useNow({ interval: 5000 })

  const collect = (op: HackOp) => act(`collect:${op.id}`, async () => {
    await apiPost('/api/hack/ops/collect', { opId: op.id })
  })

  // Sends the squad the server rates best, the op page's default pick
  const dispatch = (template: HackTemplate) => act(`dispatch:${template.id}`, async () => {
    await apiPost('/api/hack/ops/dispatch', { templateId: template.id, agentIds: template.bestTeamIds })
  })

  return computed<SheetTab>(() => {
    const data = source.data.value
    const cells: SheetCells = { ...sourceHeader('Hack Ops', source) }
    if (error.value) cells.C3 = { error: error.value }
    if (!data) return { id: 'hack', name: 'Hack Ops', widths: HACK_WIDTHS, cells, activate: () => source.load() }

    const names = new Map(data.opTemplates.map(t => [t.id, t.name] as const))
    const time = now.value.getTime()
    let r = 5

    cells[cellKey(r - 1, 0)] = { v: `Active ops (${data.activeOps.length})`, bold: true }
    sheetHeads(cells, r, ['Op', 'Agents', 'Started', 'Completes', 'Done', 'Collect'])
    r++
    for (const op of data.activeOps) {
      const done = new Date(op.completesAt).getTime() <= time
      cells[cellKey(r, 0)] = { v: names.get(op.templateId) ?? op.templateId }
      cells[cellKey(r, 1)] = { v: op.agentIds.length, fmt: 'int' }
      cells[cellKey(r, 2)] = valueCell(op.startedAt)
      cells[cellKey(r, 3)] = valueCell(op.completesAt)
      cells[cellKey(r, 4)] = { v: done }
      if (done) cells[cellKey(r, 5)] = checkbox(`collect:${op.id}`, () => collect(op))
      r++
    }

    r += 2
    cells[cellKey(r - 1, 0)] = { v: `Ops (${data.opTemplates.length})`, bold: true }
    sheetHeads(cells, r, ['Op', 'Squad', 'Min power', 'Best power', 'Success', 'Hours', 'Status', 'Dispatch'])
    r++
    for (const template of data.opTemplates) {
      cells[cellKey(r, 0)] = { v: template.name }
      cells[cellKey(r, 1)] = { v: template.minAgents === template.maxAgents ? `${template.maxAgents}` : `${template.minAgents}-${template.maxAgents}`, align: 'right' }
      cells[cellKey(r, 2)] = { v: template.minPower, fmt: 'int' }
      cells[cellKey(r, 3)] = { v: template.bestPower, fmt: 'int' }
      cells[cellKey(r, 4)] = { v: template.effectiveSuccessChance, fmt: 'percent' }
      cells[cellKey(r, 5)] = { v: template.durationMs / 3_600_000, fmt: 'number' }
      cells[cellKey(r, 6)] = { v: template.status }
      if (template.bestTeamIds.length >= template.minAgents && template.effectiveSuccessChance >= MIN_DEPLOY_SUCCESS) {
        cells[cellKey(r, 7)] = checkbox(`dispatch:${template.id}`, () => dispatch(template))
      }
      r++
    }

    // Agents, items and the rest of the state, as on any inspected tab
    const { activeOps: _ops, opTemplates: _templates, ...rest } = data
    Object.assign(cells, jsonToCells(rest, r + 1).cells)

    return { id: 'hack', name: 'Hack Ops', widths: HACK_WIDTHS, cells, activate: () => source.load() }
  })
}

export function useSheetPolytown() {
  const { balanceNum } = useAuth()
  const source = useSheetSource('/api/town/state')
  const { error, act, checkbox } = useSheetAction(source)

  // The builders popover's Start button: a one-building bulk upgrade
  const upgrade = (buildingId: string) => act(`upgrade:${buildingId}`, async () => {
    const res = await apiPost('/api/town/building/upgrade-bulk', { buildingIds: [buildingId] })
    return { balance: res.balance }
  })

  return computed<SheetTab>(() => {
    const state = source.data.value as TownState | null
    const cells: SheetCells = { ...sourceHeader('Polytown', source) }
    if (error.value) cells.C3 = { error: error.value }
    const tab = { id: 'polytown', name: 'Polytown', widths: POLYTOWN_WIDTHS, cells, activate: () => source.load() }
    if (!state) return tab
    if (!state.initialized) {
      cells.A5 = { v: 'Start your town in Polytown to see recommended upgrades.', italic: true, color: SHEET_MUTED }
      return tab
    }

    const resourceNames = new Map((state.resources ?? []).map(r => [r.id, r.name] as const))
    const buildersFree = Math.max(0, (state.builders?.total ?? 0) - (state.builders?.busy ?? 0))
    const picks = townRecommendations(state, balanceNum.value)
    cells.A5 = { v: `Recommended upgrades (${picks.length})`, bold: true }
    cells.D5 = { v: `${buildersFree} ${buildersFree === 1 ? 'builder' : 'builders'} free`, color: buildersFree ? undefined : SHEET_LOSS }
    sheetHeads(cells, 5, ['Building', 'Level', 'Next', 'Why', 'Coins', 'Goods', 'Affordable', 'Upgrade'])
    if (!picks.length) cells.A7 = { v: 'No upgrades open right now: every building is busy or maxed.', italic: true, color: SHEET_MUTED }
    picks.forEach((pick, i) => {
      const r = 6 + i
      const goods = Object.entries(pick.cost.resources).map(([id, q]) => `${formatCellNumber(q, 'int')} ${resourceNames.get(id) ?? id}`).join(', ')
      cells[cellKey(r, 0)] = { v: pick.name }
      cells[cellKey(r, 1)] = { v: pick.level, fmt: 'int' }
      cells[cellKey(r, 2)] = { v: pick.level + 1, fmt: 'int' }
      cells[cellKey(r, 3)] = pick.reason === 'short' && pick.resource
        ? { v: `${resourceNames.get(pick.resource) ?? pick.resource} ${TOWN_ADVICE_LABELS.short}`, color: SHEET_LOSS }
        : { v: pick.reason ? TOWN_ADVICE_LABELS[pick.reason] : 'Growth' }
      cells[cellKey(r, 4)] = { v: pick.cost.coins, fmt: 'number' }
      cells[cellKey(r, 5)] = { v: goods }
      cells[cellKey(r, 6)] = { v: pick.affordable }
      if (pick.affordable && buildersFree > 0) cells[cellKey(r, 7)] = checkbox(`upgrade:${pick.id}`, () => upgrade(pick.id))
    })

    // The catalog is static reference data; everything else is the town's state
    const { catalog: _catalog, ...rest } = state
    Object.assign(cells, jsonToCells(rest, 8 + Math.max(picks.length, 1)).cells)
    return tab
  })
}

const POLYTOWN_WIDTHS: Record<number, number> = { 0: 200, 3: 120, 5: 220 }

type GemExchangeState = GetPayload<'/api/gem-exchange/state'>
type GemOrder = GemExchangeState['orders'][number]

const SIDES = { buy: 'Buy', sell: 'Sell' } as const
const GEM_WIDTHS: Record<number, number> = { 0: 160, 1: 120, 4: 140 }

export function useSheetGemExchange() {
  const { balanceNum, user } = useAuth()
  const source = useSheetSource('/api/gem-exchange/state')
  const { error, act, checkbox } = useSheetAction(source)
  const lastAction = ref('')

  const side = ref<'buy' | 'sell'>('buy')
  // Unset until the player types one: then it follows the best opposite offer, as on the exchange page
  const price = ref<number | null>(null)
  const quantity = ref(1)

  const quotedPrice = (state: GemExchangeState) => price.value ?? gemDefaultPrice(side.value, state)

  const place = (state: GemExchangeState) => {
    const orderPrice = quotedPrice(state)
    const orderSide = side.value
    const gems = quantity.value
    return act('place', async () => {
      await apiPost('/api/gem-exchange/place', { side: orderSide, price: orderPrice, quantity: gems })
      lastAction.value = `${SIDES[orderSide]} offer for ${formatCellNumber(gems, 'int')} ${gems === 1 ? 'gem' : 'gems'} at ${formatCellNumber(orderPrice, 'number')}`
    })
  }

  const cancel = (order: GemOrder) => act(`cancel:${order.id}`, async () => {
    await apiPost('/api/gem-exchange/cancel', { orderId: order.id })
    lastAction.value = `Cancelled the ${order.side} offer at ${formatCellNumber(order.price, 'number')}`
  })

  return computed<SheetTab>(() => {
    const state = source.data.value
    const cells: SheetCells = { ...sourceHeader('Gem Exchange', source) }
    if (error.value) cells.C3 = { error: error.value }
    const tab: SheetTab = { id: 'gem-exchange', name: 'Gem Exchange', widths: GEM_WIDTHS, cells, activate: () => source.load() }
    if (!state) return tab

    const priceCell = (n: number | null): SheetCell => n === null ? { v: '—', align: 'right', color: SHEET_MUTED } : { v: n, fmt: 'number' }

    cells.A4 = { v: 'Coins' }
    cells.B4 = { v: balanceNum.value, fmt: 'number' }
    cells.C4 = lastAction.value ? { v: lastAction.value, italic: true, color: SHEET_MUTED } : {}
    cells.A5 = { v: 'Gems' }
    cells.B5 = { v: parseFloat(String(user.value?.gems ?? 0)), fmt: 'int' }

    // Market summary in A:B, the offer form in D:E
    sheetHeads(cells, 6, ['Market', 'Value'])
    const summary: [string, SheetCell][] = [
      ['Guide price', priceCell(state.guidePrice)],
      ['Last price', priceCell(state.lastPrice)],
      ['24h change', state.change24h === null ? priceCell(null) : { v: state.change24h, fmt: 'percent', color: netColor(state.change24h) }],
      ['Best bid', priceCell(state.bestBid)],
      ['Best ask', priceCell(state.bestAsk)],
      ['Gems for sale', { v: state.gemsForSale, fmt: 'int' }],
      ['Gems wanted', { v: state.gemsWanted, fmt: 'int' }],
      ['24h volume (gems)', { v: state.stats24h.volumeGems, fmt: 'int' }]
    ]
    summary.forEach(([label, cell], i) => {
      cells[cellKey(7 + i, 0)] = { v: label }
      cells[cellKey(7 + i, 1)] = cell
    })

    const orderPrice = quotedPrice(state)
    sheetHeads(cells, 6, ['New offer', 'Value'], 3)
    cells.D8 = { v: 'Side' }
    cells.E8 = { v: SIDES[side.value], type: 'dropdown', options: Object.values(SIDES), edit: choiceEditor(SIDES, key => side.value = key) }
    cells.D9 = { v: 'Price per gem', note: 'Starts at the best opposite offer (or the guide price) until you type one.' }
    cells.E9 = { v: orderPrice, fmt: 'number', bg: SHEET_INPUT_BG, edit: numberEditor(n => price.value = Math.round(n * 100) / 100, GEM_EXCHANGE_MIN_PRICE, 1e12) }
    cells.D10 = { v: 'Gems' }
    cells.E10 = { v: quantity.value, fmt: 'int', bg: SHEET_INPUT_BG, edit: numberEditor(n => quantity.value = Math.max(1, Math.round(n)), 1, GEM_EXCHANGE_MAX_QUANTITY) }
    cells.D11 = { v: side.value === 'buy' ? 'Coins to pay' : 'Coins to receive' }
    cells.E11 = { v: gemOrderTotal(orderPrice, quantity.value), fmt: 'number', f: '=E9*E10' }
    cells.D12 = { v: 'Place offer' }
    cells.E12 = checkbox('place', () => place(state))

    // Order book: bids in A:C, asks in E:G
    let r = 16
    cells[cellKey(r, 0)] = { v: 'Bids', bold: true }
    cells[cellKey(r, 4)] = { v: 'Asks', bold: true }
    r++
    sheetHeads(cells, r, ['Price', 'Gems', 'Offers'])
    sheetHeads(cells, r, ['Price', 'Gems', 'Offers'], 4)
    r++
    const depth = Math.max(state.book.bids.length, state.book.asks.length, 1)
    for (let i = 0; i < Math.min(depth, 20); i++) {
      const bid = state.book.bids[i]
      const ask = state.book.asks[i]
      if (bid) {
        cells[cellKey(r + i, 0)] = { v: bid.price, fmt: 'number', color: SHEET_GAIN }
        cells[cellKey(r + i, 1)] = { v: bid.quantity, fmt: 'int' }
        cells[cellKey(r + i, 2)] = { v: bid.orders, fmt: 'int' }
      }
      if (ask) {
        cells[cellKey(r + i, 4)] = { v: ask.price, fmt: 'number', color: SHEET_LOSS }
        cells[cellKey(r + i, 5)] = { v: ask.quantity, fmt: 'int' }
        cells[cellKey(r + i, 6)] = { v: ask.orders, fmt: 'int' }
      }
    }
    if (!state.book.bids.length) cells[cellKey(r, 0)] = { v: 'No bids', italic: true, color: SHEET_MUTED }
    if (!state.book.asks.length) cells[cellKey(r, 4)] = { v: 'No asks', italic: true, color: SHEET_MUTED }
    r += Math.min(depth, 20) + 1

    // Your open offers
    const mine = state.orders.filter(o => o.mine)
    cells[cellKey(r, 0)] = { v: `Your offers (${mine.length})`, bold: true }
    r++
    sheetHeads(cells, r, ['Side', 'Price', 'Gems', 'Filled', 'Placed', 'Cancel'])
    r++
    for (const order of mine) {
      cells[cellKey(r, 0)] = { v: SIDES[order.side], color: order.side === 'buy' ? SHEET_GAIN : SHEET_LOSS }
      cells[cellKey(r, 1)] = { v: order.price, fmt: 'number' }
      cells[cellKey(r, 2)] = { v: order.quantity, fmt: 'int' }
      cells[cellKey(r, 3)] = { v: order.filled, fmt: 'int' }
      cells[cellKey(r, 4)] = valueCell(order.createdAt)
      cells[cellKey(r, 5)] = checkbox(`cancel:${order.id}`, () => cancel(order))
      r++
    }
    if (!mine.length) {
      cells[cellKey(r, 0)] = { v: 'No open offers.', italic: true, color: SHEET_MUTED }
      r++
    }

    // Recent trades
    r++
    cells[cellKey(r, 0)] = { v: 'Recent trades', bold: true }
    r++
    sheetHeads(cells, r, ['Time', 'Price', 'Gems', 'Yours'])
    r++
    for (const trade of state.trades.slice(0, 50)) {
      cells[cellKey(r, 0)] = valueCell(trade.createdAt)
      cells[cellKey(r, 1)] = { v: trade.price, fmt: 'number' }
      cells[cellKey(r, 2)] = { v: trade.quantity, fmt: 'int' }
      cells[cellKey(r, 3)] = { v: trade.iBought ? 'Bought' : trade.iSold ? 'Sold' : '' }
      r++
    }
    if (!state.trades.length) cells[cellKey(r, 0)] = { v: 'No trades yet.', italic: true, color: SHEET_MUTED }

    return tab
  })
}
