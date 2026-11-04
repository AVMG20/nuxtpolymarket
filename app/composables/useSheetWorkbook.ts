// Every tab of spreadsheet mode, in order. Casino games, the Bank, Hack Ops,
// Polytown upgrades, Xeno, Colony and the Gem Exchange are playable; the other games are read-only views
// of their state.

const INSPECTED: InspectorDef[] = [
  { id: 'hero-quest', name: 'Hero Quest', url: '/api/hero-quest/state' },
  { id: 'void', name: 'Void Runner', url: '/api/void/state' },
  { id: 'pirates', name: 'Pirate Raid', url: '/api/pirates/state' },
  { id: 'pathwarden', name: 'Pathwarden', url: '/api/pathwarden/state' },
  { id: 'shapezz', name: 'SHAPEZZ', url: '/api/shapezz/state' },
  { id: 'call-of-xeno', name: 'Call of Xeno', url: '/api/call-of-xeno/state' },
  { id: 'firewall', name: 'Firewall', url: '/api/firewall/state' },
  { id: 'hackerz', name: 'Hackerz', url: '/api/hackerz/state' },
  { id: 'meadowbrawl', name: 'Meadowbrawl', url: '/api/meadowbrawl/state' },
  { id: 'riftborn', name: 'Riftborn', url: '/api/riftborn/state' },
  { id: 'gold-miner', name: 'Gold Miner', url: '/api/gold-miner/state' },
  { id: 'tcg', name: 'TCG', url: '/api/tcg/state' },
  { id: 'battler', name: 'TCG Battler', url: '/api/battler/state' }
]

const PLAYABLE: Record<string, string> = {
  dice: 'Set a bet and win chance, tick Roll.',
  limbo: 'Set a bet and target, tick Play.',
  wheel: 'Pick a difficulty, tick Spin.',
  slots: 'Pick a slot, tick Spin. Bonuses play out in the same spin.',
  bank: 'Deposit and withdraw coins.',
  hack: 'Dispatch your best squad and collect finished ops.',
  polytown: 'Start the recommended upgrades.',
  xeno: 'Plant, harvest, sell, buy seeds and upgrades, and breed.',
  colony: 'Feed, collect loot, buy and place bugs, sell items, upgrade and research.',
  'gem-exchange': 'Place and cancel buy or sell offers for gems.'
}

export function useSheetWorkbook() {
  const { user, balanceNum } = useAuth()
  const casino = useSheetCasino()
  const bank = useSheetBank()
  const hack = useSheetHackOps()
  const polytown = useSheetPolytown()
  const xeno = useSheetXeno()
  const colony = useSheetColony()
  const gemExchange = useSheetGemExchange()
  const inspected = INSPECTED.map(def => useSheetInspector(def))

  const leaders = useSheetSource('/api/leaderboard')
  const leaderboard = computed<SheetTab>(() => {
    const cells: SheetCells = sourceHeader('Leaderboard', leaders)
    sheetHeads(cells, 4, ['#', 'Player', 'Total wealth', 'Coins', 'Gems', 'Bank'])
    leaders.data.value?.slice(0, 200).forEach((row, i) => {
      const r = i + 5
      const bold = row.isCurrentUser || undefined
      cells[cellKey(r, 0)] = { v: i + 1, bold }
      cells[cellKey(r, 1)] = { v: row.name, bold }
      cells[cellKey(r, 2)] = { v: row.totalWealth, fmt: 'number', bold }
      cells[cellKey(r, 3)] = { v: parseFloat(row.balance), fmt: 'number', bold }
      cells[cellKey(r, 4)] = { v: row.gems, fmt: 'int', bold }
      cells[cellKey(r, 5)] = { v: row.bankBalance, fmt: 'number', bold, color: row.bankBalance < 0 ? SHEET_LOSS : undefined }
    })
    return { id: 'leaderboard', name: 'Leaderboard', widths: { 0: 50, 1: 180, 2: 130, 3: 130, 4: 110, 5: 130 }, cells, activate: () => leaders.load() }
  })

  const games = computed(() => [
    casino.dice.value, casino.limbo.value, casino.wheel.value, casino.slots.value,
    bank.value, hack.value, polytown.value, xeno.value, colony.value, gemExchange.value,
    ...inspected.map(tab => tab.value),
    leaderboard.value
  ])

  const overview = computed<SheetTab>(() => {
    const cells: SheetCells = {
      A1: { v: 'Overview', bold: true, size: 15 },
      A3: { v: 'Coins' },
      B3: { v: balanceNum.value, fmt: 'number' },
      A4: { v: 'Gems' },
      B4: { v: parseFloat(String(user.value?.gems ?? 0)), fmt: 'int' },
    }
    sheetHeads(cells, 5, ['Sheet', 'Mode', 'How'])
    games.value.forEach((tab, i) => {
      const r = 7 + i
      const how = PLAYABLE[tab.id]
      cells[`A${r}`] = { v: tab.name, link: { label: tab.name, tabId: tab.id } }
      cells[`B${r}`] = how ? { v: 'Play', color: SHEET_GAIN } : { v: 'View', color: SHEET_MUTED }
      if (how) cells[`C${r}`] = { v: how }
    })
    return { id: 'overview', name: 'Overview', widths: { 0: 160, 1: 130 }, cells }
  })

  const tabs = computed(() => [overview.value, ...games.value])

  return { tabs }
}
