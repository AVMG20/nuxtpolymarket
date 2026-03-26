<script setup lang="ts">
const { user, client, fetchSession, signOut: authSignOut } = useAuth()

type Account = { providerId: string, accountId: string }
const accounts = ref<Account[]>([])
const accountsLoaded = ref(false)

onMounted(async () => {
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
const nameSuccess = ref(false)

async function saveName() {
  nameError.value = ''
  nameSuccess.value = false
  const trimmed = name.value.trim()
  if (!trimmed) { nameError.value = 'Name is required'; return }
  if (trimmed.length > 30) { nameError.value = 'Max 30 characters'; return }
  nameLoading.value = true
  const { error } = await client.updateUser({ name: trimmed })
  if (error) nameError.value = error.message ?? 'Failed to update'
  else { nameSuccess.value = true; await fetchSession() }
  nameLoading.value = false
}

// ---- Email ----
const email = ref('')
watch(() => user.value?.email, v => { email.value = v ?? '' }, { immediate: true })
const emailLoading = ref(false)
const emailError = ref('')
const emailSuccess = ref(false)

async function saveEmail() {
  emailError.value = ''
  emailSuccess.value = false
  emailLoading.value = true
  const { error } = await client.changeEmail({ newEmail: email.value.trim() })
  if (error) emailError.value = error.message ?? 'Failed to update email'
  else { emailSuccess.value = true; await fetchSession() }
  emailLoading.value = false
}

// ---- Password ----
const currentPw = ref('')
const newPw = ref('')
const confirmPw = ref('')
const pwLoading = ref(false)
const pwError = ref('')
const pwSuccess = ref(false)

async function savePassword() {
  pwError.value = ''
  pwSuccess.value = false
  if (newPw.value.length < 8) { pwError.value = 'At least 8 characters required'; return }
  if (newPw.value !== confirmPw.value) { pwError.value = 'Passwords do not match'; return }
  pwLoading.value = true
  if (hasCredentialAccount.value) {
    const { error } = await client.changePassword({ currentPassword: currentPw.value, newPassword: newPw.value })
    if (error) pwError.value = error.message ?? 'Failed to change password'
    else {
      pwSuccess.value = true
      currentPw.value = ''
      newPw.value = ''
      confirmPw.value = ''
    }
  } else {
    try {
      await $fetch('/api/user/set-password', { method: 'POST', body: { password: newPw.value } })
      pwSuccess.value = true
      newPw.value = ''
      confirmPw.value = ''
      const { data } = await client.listAccounts()
      accounts.value = (data as Account[]) ?? []
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
          <UAlert v-if="nameSuccess" color="success" variant="soft" description="Name updated successfully" />
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
          <UAlert
            v-if="pwSuccess"
            color="success"
            variant="soft"
            :description="hasCredentialAccount ? 'Password changed successfully' : 'Password set successfully'"
          />
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
        <UAlert v-if="emailSuccess" color="success" variant="soft" description="Email updated successfully" />
        <UButton type="submit" :loading="emailLoading" :disabled="!email.trim()">
          Save
        </UButton>
      </UForm>
    </UCard>
  </UContainer>
</template>
