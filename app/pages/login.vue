<script setup lang="ts">
definePageMeta({ layout: 'auth', auth: false })
const { signIn: authSignIn, client } = useAuth()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const devLoginLoading = ref(false)
const showDevLogin = import.meta.dev

async function signInDiscord() {
  await client.signIn.social({ provider: 'discord', callbackURL: '/' })
}
async function signIn() {
  error.value = ''
  loading.value = true
  const { error: err } = await authSignIn.email({
    email: email.value,
    password: password.value,
    callbackURL: '/'
  })
  loading.value = false
  if (err) {
    error.value = err.message ?? 'Sign in failed'
    return
  }
  // Hard navigation so the session cookie rides a fresh SSR request and the
  // middleware resolves the session cleanly (avoids the client-side fetch race).
  window.location.href = '/'
}
async function signInDev() {
  error.value = ''
  devLoginLoading.value = true
  try {
    await $fetch('/api/dev-login', {method: 'POST'})
    window.location.href = '/'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Development login failed'
    devLoginLoading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-xl font-semibold text-center">Sign in</h1>
      </template>

      <UForm class="space-y-4" @submit.prevent="signIn">
        <UFormField label="Email">
          <UInput v-model="email" type="email" placeholder="you@example.com" required class="w-full" />
        </UFormField>
        <UFormField label="Password">
          <UInput v-model="password" type="password" placeholder="••••••••" required class="w-full" />
        </UFormField>
        <UAlert v-if="error" color="error" :description="error" />
        <UButton type="submit" class="w-full justify-center" :loading="loading">
          Sign in
        </UButton>
        <UButton
          v-if="showDevLogin"
          type="button"
          color="warning"
          variant="soft"
          class="w-full justify-center"
          :loading="devLoginLoading"
          @click="signInDev"
        >
          Sign in as development user
        </UButton>
        <USeparator label="or" />
        <UButton class="w-full justify-center" color="neutral" variant="outline" icon="i-simple-icons-discord" @click="signInDiscord">
          Sign in with Discord
        </UButton>
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-muted">
          No account?
          <ULink to="/register" class="font-medium">Register</ULink>
        </p>
      </template>
  </UCard>
</template>
