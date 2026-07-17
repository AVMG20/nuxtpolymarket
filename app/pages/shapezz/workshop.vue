<script setup lang="ts">
import type { ShapezzPermanentUpgradeId, ShapezzWeaponType } from '#shared/utils/gamelogic/shapezz'

definePageMeta({ title: 'SHAPEZZ Workshop' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/shapezz/state')
const activeWeaponType = ref<ShapezzWeaponType>('blaster')
const buyingUpgrade = ref<ShapezzPermanentUpgradeId | null>(null)
const buyingWeaponId = ref<string | null>(null)

const balance = computed(() => parseFloat(state.value?.balance ?? '0'))

// A run left behind by closing the game tab mid-run blocks every purchase
// ("Cannot buy a weapon during a run") — settle it as abandoned, same as the
// game page does on mount.
onMounted(async () => {
    if (!state.value?.activeRun) return
    try {
        await $fetch('/api/shapezz/finish-run', {
            method: 'POST',
            body: { reason: 'abandoned', elapsedMs: 0, coins: 0, kills: 0 }
        })
    } catch {
        // A concurrent request may already have cleared it; refreshing is enough.
    }
    await refresh()
})
const weaponTabs = [
    { label: 'Pulse Carbine', value: 'blaster', icon: 'i-lucide-crosshair' },
    { label: 'Nova Mortar', value: 'launcher', icon: 'i-lucide-bomb' },
    { label: 'Scatter Array', value: 'shotgun', icon: 'i-lucide-chevrons-right' }
]
const visibleWeapons = computed(() => state.value?.weapons.filter(weapon => weapon.type === activeWeaponType.value) ?? [])

function affordabilityCost(netCost: number) {
    return Math.max(0, netCost)
}

async function buyPermanentUpgrade(upgradeId: ShapezzPermanentUpgradeId) {
    if (buyingUpgrade.value) return
    buyingUpgrade.value = upgradeId
    try {
        const response = await $fetch('/api/shapezz/upgrade', { method: 'POST', body: { upgradeId } })
        await Promise.all([refresh(), fetchSession()])
        toast.add({ title: `Workshop level ${response.level} installed`, color: 'success' })
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Workshop upgrade failed'), color: 'error' })
    } finally {
        buyingUpgrade.value = null
    }
}

async function buyWeapon(weapon: NonNullable<typeof state.value>['weapons'][number]) {
    if (buyingWeaponId.value || weapon.equipped) return
    buyingWeaponId.value = weapon.id
    try {
        if (weapon.owned) {
            const response = await $fetch('/api/shapezz/equip', { method: 'POST', body: { weaponType: weapon.type } })
            await refresh()
            toast.add({ title: `${response.weapon.name} equipped`, color: 'success' })
        } else {
            const response = await $fetch('/api/shapezz/weapon', {
                method: 'POST',
                body: { weaponType: weapon.type, weaponRarity: weapon.rarity }
            })
            await Promise.all([refresh(), fetchSession()])
            toast.add({
                title: `${response.weapon.name} equipped`,
                description: response.refund > 0 ? `${formatNumber(response.refund)} refunded from your previous ${response.weapon.type}.` : undefined,
                color: 'success'
            })
        }
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Weapon purchase failed'), color: 'error' })
    } finally {
        buyingWeaponId.value = null
    }
}
</script>

<template>
  <UContainer class="space-y-8 pb-12">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-black">THE WORKSHOP</h1>
        <p class="mt-1 text-sm text-muted">Permanent chassis upgrades and increasingly unreasonable weapons.</p>
      </div>
      <div v-if="state" class="flex items-center gap-2">
        <UBadge :label="`Power ${state.power}`" icon="i-lucide-zap" color="primary" variant="subtle" />
        <div class="flex items-center gap-1 text-sm font-bold text-warning"><UIcon name="i-lucide-coins" class="size-4" /> {{ formatNumber(balance) }}</div>
      </div>
    </div>

    <USkeleton v-if="!state" class="h-96 w-full rounded-xl" />

    <template v-else>
      <section>
        <div class="mb-3">
          <h2 class="text-lg font-black">CHASSIS</h2>
          <p class="text-sm text-muted">Always active. Specialized tracks may have shorter, more expensive level caps.</p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <UCard v-for="upgrade in state.upgrades" :key="upgrade.id" :ui="{ body: 'p-4 sm:p-4' }">
            <div class="flex items-start justify-between gap-2">
              <div class="flex size-9 items-center justify-center rounded-lg bg-elevated"><UIcon :name="upgrade.icon" class="size-5 text-primary" /></div>
              <div class="flex flex-col items-end gap-1">
                <UBadge :label="`${upgrade.level} / ${upgrade.maxLevel}`" color="neutral" variant="subtle" />
                <UBadge v-if="upgrade.valueLabel" :label="upgrade.valueLabel" color="success" variant="subtle" />
              </div>
            </div>
            <h3 class="mt-3 text-sm font-black">{{ upgrade.name }}</h3>
            <p class="mt-1 min-h-10 text-xs leading-relaxed text-muted">{{ upgrade.description }}</p>
            <UButton
              class="mt-4 w-full justify-center"
              color="neutral"
              variant="soft"
              size="sm"
              :disabled="upgrade.cost === null || balance < (upgrade.cost ?? 0)"
              :loading="buyingUpgrade === upgrade.id"
              @click="buyPermanentUpgrade(upgrade.id as ShapezzPermanentUpgradeId)"
            >
              <span v-if="upgrade.cost === null">MAXED</span>
              <span v-else class="flex items-center gap-1"><UIcon name="i-lucide-coins" class="size-3.5 text-warning" /> {{ formatNumber(upgrade.cost) }}</span>
            </UButton>
          </UCard>
        </div>
      </section>

      <section>
        <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-black">WEAPON FOUNDRY</h2>
            <p class="text-sm text-muted">Own one weapon of each type and switch freely. Upgrading within a type refunds 25% of what you paid for its previous tier.</p>
          </div>
          <div class="rounded-lg border border-default bg-elevated px-3 py-2 text-right">
            <p class="text-[10px] font-bold uppercase tracking-wide text-muted">Equipped</p>
            <p class="text-sm font-black" :style="{ color: state.currentWeapon.primaryColor }">{{ state.currentWeapon.name }}</p>
          </div>
        </div>

        <UTabs v-model="activeWeaponType" :items="weaponTabs" class="mb-4 w-full" />

        <div class="grid gap-3 md:grid-cols-5">
          <UCard
            v-for="weapon in visibleWeapons"
            :key="weapon.id"
            class="weapon-card relative overflow-hidden"
            :class="weapon.equipped ? 'ring-2 ring-primary' : ''"
            :style="{
              '--weapon-color': weapon.primaryColor,
              '--weapon-accent': weapon.accentColor,
              '--weapon-aura-opacity': 0.15 + weapon.visualIntensity * 0.11,
              '--weapon-glow': `${4 + weapon.visualIntensity * 5}px`
            }"
            :ui="{ body: 'p-4 sm:p-4' }"
          >
            <div class="weapon-aura absolute inset-x-0 top-0 h-20 opacity-60" />
            <div class="relative">
              <div class="flex items-start justify-between gap-2">
                <div class="weapon-icon flex size-11 items-center justify-center rounded-xl border border-white/10 bg-background/80">
                  <UIcon :name="weapon.icon" class="size-6" :style="{ color: weapon.primaryColor }" />
                </div>
                <div class="flex flex-col items-end gap-1">
                  <UBadge :label="weapon.rarityName" color="neutral" variant="subtle" />
                  <UBadge v-if="weapon.owned" label="Owned" color="success" variant="subtle" />
                </div>
              </div>
              <h3 class="mt-4 text-sm font-black">{{ weapon.name }}</h3>
              <p class="mt-1 min-h-14 text-xs leading-relaxed text-muted">{{ weapon.description }}</p>

              <div class="mt-3 space-y-1.5 text-[11px]">
                <div class="flex justify-between"><span class="text-muted">Damage</span><span class="font-bold">{{ weapon.damageMultiplier.toFixed(2) }}×</span></div>
                <div class="flex justify-between"><span class="text-muted">Fire speed</span><span class="font-bold">{{ weapon.fireRateMultiplier.toFixed(2) }}×</span></div>
                <div v-if="weapon.type === 'launcher'" class="flex justify-between"><span class="text-muted">Blast radius</span><span class="font-bold">{{ weapon.explosionRadius }}</span></div>
                <div v-if="weapon.type === 'shotgun'" class="flex justify-between"><span class="text-muted">Pellets</span><span class="font-bold">{{ weapon.pellets }}</span></div>
              </div>

              <div v-if="!weapon.owned && weapon.refund > 0" class="mt-3 rounded-md bg-success/8 px-2 py-1.5 text-[10px] text-success">
                Trade-in from your current {{ weapon.type }}: {{ formatNumber(weapon.refund) }}
              </div>

              <UButton
                class="mt-3 w-full justify-center"
                :color="weapon.equipped ? 'primary' : 'neutral'"
                :variant="weapon.equipped || weapon.owned ? 'soft' : 'solid'"
                size="sm"
                :disabled="weapon.equipped || (!weapon.owned && balance < affordabilityCost(weapon.netCost))"
                :loading="buyingWeaponId === weapon.id"
                @click="buyWeapon(weapon)"
              >
                <span v-if="weapon.equipped">EQUIPPED</span>
                <span v-else-if="weapon.owned">EQUIP</span>
                <span v-else-if="weapon.netCost < 0" class="flex items-center gap-1">Upgrade · receive {{ formatNumber(Math.abs(weapon.netCost)) }}</span>
                <span v-else class="flex items-center gap-1"><UIcon name="i-lucide-coins" class="size-3.5 text-warning" /> {{ formatNumber(weapon.netCost) }}</span>
              </UButton>
            </div>
          </UCard>
        </div>
      </section>
    </template>
  </UContainer>
</template>

<style scoped>
.weapon-card {
    border-color: color-mix(in srgb, var(--weapon-color) 24%, var(--ui-border));
}

.weapon-aura {
    opacity: var(--weapon-aura-opacity);
    background: radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--weapon-color) 38%, transparent), transparent 72%);
}

.weapon-icon {
    box-shadow: 0 0 var(--weapon-glow) color-mix(in srgb, var(--weapon-color) 55%, transparent);
}
</style>
