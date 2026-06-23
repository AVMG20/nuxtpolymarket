<script setup lang="ts">
import { RAKEBACK_RATE, RAKEBACK_UNLOCK_COST } from '#shared/utils/profile'

const { user, client, fetchSession, signOut: authSignOut } = useAuth()

const rake = computed(() => parseFloat(user.value?.rake ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)
const rakebackUnlocked = computed(() => !!user.value?.rakebackUnlocked)

const rakeInfoOpen = ref(false)

const unlockModalOpen = ref(false)
const unlockLoading = ref(false)
async function unlockRakeback() {
  unlockLoading.value = true
  try {
    await $fetch('/api/user/unlock-rakeback', { method: 'POST' })
    await fetchSession()
    unlockModalOpen.value = false
    toast.add({ title: 'Rakeback unlocked!', color: 'success', icon: 'i-lucide-check' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage ?? 'Unlock failed', color: 'error' })
  } finally {
    unlockLoading.value = false
  }
}

const claimModalOpen = ref(false)
const claimLoading = ref(false)
async function claimRake() {
  claimLoading.value = true
  try {
    await $fetch('/api/user/claim-rake', { method: 'POST' })
    await fetchSession()
    claimModalOpen.value = false
    toast.add({ title: 'Rakeback claimed!', color: 'success', icon: 'i-lucide-check' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage ?? 'Claim failed', color: 'error' })
  } finally {
    claimLoading.value = false
  }
}
const toast = useToast()

type Account = { providerId: string, accountId: string }
const accounts = ref<Account[]>([])
const accountsLoaded = ref(false)

onMounted(async () => {
  fetchSession();
  const { data } = await client.listAccounts()
  accounts.value = (data as Account[]) ?? []
  accountsLoaded.value = true
})

const hasCredentialAccount = computed(() =>
  accounts.value.some(a => a.providerId === 'credential')
)

// ---- Name ----
const name = ref('')
watch(() => user.value?.name, v => { name.value = v ?? '' }, { immediate: true })
const nameLoading = ref(false)
const nameError = ref('')

async function saveName() {
  nameError.value = ''
  const trimmed = name.value.trim()
  if (!trimmed) { nameError.value = 'Name is required'; return }
  if (trimmed.length > 30) { nameError.value = 'Max 30 characters'; return }
  nameLoading.value = true
  const { error } = await client.updateUser({ name: trimmed })
  if (error) nameError.value = error.message ?? 'Failed to update'
  else { await fetchSession(); toast.add({ title: 'Name updated', color: 'success', icon: 'i-lucide-check' }) }
  nameLoading.value = false
}

// ---- Email ----
const email = ref('')
watch(() => user.value?.email, v => { email.value = v ?? '' }, { immediate: true })
const emailLoading = ref(false)
const emailError = ref('')

async function saveEmail() {
  emailError.value = ''
  emailLoading.value = true
  const { error } = await client.changeEmail({ newEmail: email.value.trim() })
  if (error) emailError.value = error.message ?? 'Failed to update email'
  else { await fetchSession(); toast.add({ title: 'Email updated', color: 'success', icon: 'i-lucide-check' }) }
  emailLoading.value = false
}

// ---- Password ----
const currentPw = ref('')
const newPw = ref('')
const confirmPw = ref('')
const pwLoading = ref(false)
const pwError = ref('')

async function savePassword() {
  pwError.value = ''
  if (newPw.value.length < 8) { pwError.value = 'At least 8 characters required'; return }
  if (newPw.value !== confirmPw.value) { pwError.value = 'Passwords do not match'; return }
  pwLoading.value = true
  if (hasCredentialAccount.value) {
    const { error } = await client.changePassword({ currentPassword: currentPw.value, newPassword: newPw.value })
    if (error) pwError.value = error.message ?? 'Failed to change password'
    else {
      currentPw.value = ''
      newPw.value = ''
      confirmPw.value = ''
      toast.add({ title: 'Password changed', color: 'success', icon: 'i-lucide-check' })
    }
  } else {
    try {
      await $fetch('/api/user/set-password', { method: 'POST', body: { password: newPw.value } })
      newPw.value = ''
      confirmPw.value = ''
      const { data } = await client.listAccounts()
      accounts.value = (data as Account[]) ?? []
      toast.add({ title: 'Password set', color: 'success', icon: 'i-lucide-check' })
    } catch (e: any) {
      pwError.value = e?.data?.statusMessage ?? e?.data?.message ?? 'Failed to set password'
    }
  }
  pwLoading.value = false
}

async function handleSignOut() {
  await authSignOut({ redirectTo: '/login' })
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Profile</h1>
        <p class="text-sm text-muted mt-0.5">Manage your account settings</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <UButton
          to="/analytics"
          color="neutral"
          variant="outline"
          icon="i-lucide-bar-chart-3"
          label="Analytics"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-log-out"
          label="Sign out"
          @click="handleSignOut"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Avatar card -->
      <UCard>
        <div class="flex items-center gap-5">
          <div class="size-16 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span class="text-2xl font-bold text-primary">{{ (user?.name ?? 'A')[0].toUpperCase() }}</span>
          </div>
          <div class="min-w-0">
            <p class="font-semibold text-xl truncate">{{ user?.name }}</p>
            <p class="text-sm text-muted truncate mt-0.5">{{ user?.email }}</p>
          </div>
        </div>
      </UCard>

      <!-- Rakeback -->
      <UCard>
        <template #header>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h2 class="font-semibold">Rakeback</h2>
              <p class="text-xs text-muted mt-0.5">{{ RAKEBACK_RATE * 100 }}% of every wager accumulates as locked balance</p>
            </div>
            <UButton icon="i-lucide-circle-help" color="neutral" variant="ghost" size="xs" @click="rakeInfoOpen = true" />
          </div>
        </template>
        <div class="flex items-start justify-between gap-4">
          <div class="flex gap-8">
            <div class="space-y-1">
              <p class="text-xs text-muted">Locked balance</p>
              <CoinBalance class="font-semibold text-highlighted" :value="rake" :compact="false" />
            </div>
            <div class="space-y-1">
              <p class="text-xs text-muted">Status</p>
              <UBadge
                :color="rakebackUnlocked ? 'success' : 'neutral'"
                variant="subtle"
                :label="rakebackUnlocked ? 'Unlocked' : 'Locked'"
                :icon="rakebackUnlocked ? 'i-lucide-lock-open' : 'i-lucide-lock'"
              />
            </div>
          </div>
          <UButton
            v-if="rakebackUnlocked"
            label="Claim"
            icon="i-lucide-gift"
            :disabled="rake <= 0"
            @click="claimModalOpen = true"
          />
          <UButton
            v-else
            label="Unlock"
            icon="i-lucide-lock-open"
            :disabled="gems < RAKEBACK_UNLOCK_COST"
            @click="unlockModalOpen = true"
          >
            <template #trailing>
              <span class="flex items-center gap-1 text-xs opacity-80">
                {{ RAKEBACK_UNLOCK_COST }}
                <UIcon name="i-lucide-gem" class="size-3.5 text-cyan-400" />
              </span>
            </template>
          </UButton>
        </div>
      </UCard>
    </div>

    <!-- Unlock rakeback modal -->
    <UModal v-model:open="unlockModalOpen" title="Unlock Rakeback">
      <template #body>
        <p class="text-sm text-muted">
          Spend
          <GemBalance :value="RAKEBACK_UNLOCK_COST" :compact="false" class="inline-block space-x-1 mx-1 font-semibold text-highlighted" />
          once to permanently unlock rakeback claiming. After that, you can claim your locked balance back to your wallet any time — for free.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="outline" @click="unlockModalOpen = false" />
          <UButton label="Unlock" icon="i-lucide-lock-open" :loading="unlockLoading" @click="unlockRakeback" />
        </div>
      </template>
    </UModal>

    <!-- Claim rakeback modal -->
    <UModal v-model:open="claimModalOpen" title="Claim Rakeback">
      <template #body>
        <div class="flex flex-col gap-4">
          <CoinBalance :value="rake" :compact="false" :show-icon="true" class="font-semibold text-highlighted text-lg" />
          <p class="text-sm text-muted">
            Claim your locked rakeback balance back to your wallet.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="outline" @click="claimModalOpen = false" />
          <UButton label="Claim" icon="i-lucide-gift" :loading="claimLoading" @click="claimRake" />
        </div>
      </template>
    </UModal>

    <!-- Rakeback info modal -->
    <UModal v-model:open="rakeInfoOpen" title="How Rakeback Works">
      <template #body>
        <div class="space-y-4 text-sm">
          <p class="text-muted">
            Every time you place a wager, <span class="font-semibold text-default">{{ RAKEBACK_RATE * 100 }}%</span> of the amount is added to your locked rakeback balance.
          </p>
          <div class="space-y-1">
            <p class="font-semibold">Unlocking</p>
            <p class="text-muted">
              Claiming is gated behind a one-time
              <span class="font-semibold text-default"><GemBalance class="inline-block space-x-1 mx-1" :value="RAKEBACK_UNLOCK_COST" /></span>
              purchase. Once unlocked, you can claim your full locked balance back to your wallet at any time, for free — there is no per-claim cost.
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton label="Got it" @click="rakeInfoOpen = false" />
        </div>
      </template>
    </UModal>

    <!-- Linked accounts -->
    <UCard>
      <template #header>
        <h2 class="font-semibold">Linked Accounts</h2>
      </template>
      <div v-if="!accountsLoaded" class="space-y-3">
        <USkeleton v-for="i in 2" :key="i" class="h-12 rounded-lg" />
      </div>
      <div v-else class="divide-y divide-default -my-1">
        <div
          v-for="account in accounts"
          :key="account.providerId"
          class="flex items-center gap-3 py-3"
        >
          <div class="size-9 rounded-lg bg-elevated flex items-center justify-center shrink-0">
            <UIcon
              :name="account.providerId === 'discord' ? 'i-simple-icons-discord' : 'i-lucide-key-round'"
              class="size-4"
              :class="account.providerId === 'discord' ? 'text-[#5865F2]' : 'text-primary'"
            />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium capitalize">
              {{ account.providerId === 'credential' ? 'Email & Password' : account.providerId }}
            </p>
            <p class="text-xs text-muted truncate">
              {{ account.providerId === 'credential' ? user?.email : `Connected as ${user?.name}` }}
            </p>
          </div>
          <UBadge color="success" variant="subtle" label="Active" class="ml-auto shrink-0" />
        </div>
      </div>
    </UCard>

    <!-- Name + Password side by side on large screens -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <!-- Name -->
      <UCard class="h-full">
        <template #header>
          <h2 class="font-semibold">Display Name</h2>
        </template>
        <UForm class="space-y-4" @submit.prevent="saveName">
          <UFormField label="Name">
            <template #hint>
              <span :class="name.length > 30 ? 'text-error' : 'text-muted'">{{ name.length }}/30</span>
            </template>
            <UInput v-model="name" placeholder="Your name" class="w-full" maxlength="31" />
          </UFormField>
          <UAlert v-if="nameError" color="error" variant="soft" :description="nameError" />
          <UButton type="submit" :loading="nameLoading" :disabled="!name.trim() || name.length > 30">
            Save
          </UButton>
        </UForm>
      </UCard>

      <!-- Password -->
      <UCard v-if="accountsLoaded" class="h-full">
        <template #header>
          <div>
            <h2 class="font-semibold">{{ hasCredentialAccount ? 'Change Password' : 'Set Password' }}</h2>
            <p v-if="!hasCredentialAccount" class="text-xs text-muted mt-0.5">
              Add a password alongside your OAuth sign-in
            </p>
          </div>
        </template>
        <UForm class="space-y-4" @submit.prevent="savePassword">
          <UFormField v-if="hasCredentialAccount" label="Current password">
            <UInput v-model="currentPw" type="password" placeholder="••••••••" class="w-full" />
          </UFormField>
          <UFormField label="New password">
            <UInput v-model="newPw" type="password" placeholder="••••••••" class="w-full" />
          </UFormField>
          <UFormField label="Confirm new password">
            <UInput v-model="confirmPw" type="password" placeholder="••••••••" class="w-full" />
          </UFormField>
          <UAlert v-if="pwError" color="error" variant="soft" :description="pwError" />
          <UButton type="submit" :loading="pwLoading">
            {{ hasCredentialAccount ? 'Change Password' : 'Set Password' }}
          </UButton>
        </UForm>
      </UCard>
      <USkeleton v-else class="h-48 rounded-xl" />
    </div>

    <!-- Email (only for credential accounts, full width) -->
    <UCard v-if="accountsLoaded && hasCredentialAccount">
      <template #header>
        <h2 class="font-semibold">Email</h2>
      </template>
      <UForm class="space-y-4 max-w-md" @submit.prevent="saveEmail">
        <UFormField label="Email">
          <UInput v-model="email" type="email" placeholder="you@example.com" class="w-full" />
        </UFormField>
        <UAlert v-if="emailError" color="error" variant="soft" :description="emailError" />
        <UButton type="submit" :loading="emailLoading" :disabled="!email.trim()">
          Save
        </UButton>
      </UForm>
    </UCard>
  </UContainer>
</template>
