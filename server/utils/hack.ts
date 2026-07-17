import { agentPower, type AgentClass, type AgentTrait, type ItemMod } from '#shared/utils/hack-config'

export interface EquippedAgentRow {
  level: number
  class: string
  equippedTool: string | null
  equippedSoftware: string | null
  equippedHardware: string | null
  traits: unknown
}

export interface EquippableItemRow {
  itemLevel: number
  mods: unknown
}

/** An agent's power from level/class plus whatever gear it has equipped, resolved from `itemsById`. */
export function equippedAgentPower(agent: EquippedAgentRow, itemsById: Map<string, EquippableItemRow>): number {
  const equippedItems = [agent.equippedTool, agent.equippedSoftware, agent.equippedHardware]
    .filter(Boolean)
    .map(id => itemsById.get(id!))
    .filter((item): item is EquippableItemRow => !!item)
  const traits = (agent.traits ?? []) as AgentTrait[]
  return agentPower(
    { level: agent.level, class: agent.class as AgentClass },
    equippedItems.map(item => ({ itemLevel: item.itemLevel, mods: item.mods as ItemMod[] })),
    traits,
  )
}
