<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ layout: 'auth', auth: false })

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function signIn() {
  error.value = ''
  loading.value = true
  const { error: err } = await authClient.signIn.email({
    email: email.value,
    password: password.value,
    callbackURL: '/'
  })
  if (err) error.value = err.message ?? 'Sign in failed'
  loading.value = false
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
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-muted">
          No account?
          <ULink to="/register" class="font-medium">Register</ULink>
        </p>
      </template>
  </UCard>
</template>
