<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ layout: 'auth', auth: false })

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function signUp() {
  error.value = ''
  loading.value = true
  const { error: err } = await authClient.signUp.email({
    name: name.value,
    email: email.value,
    password: password.value,
    callbackURL: '/'
  })
  if (err) error.value = err.message ?? 'Registration failed'
  loading.value = false
}
</script>

<template>
  <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-xl font-semibold text-center">Create account</h1>
      </template>

      <UForm class="space-y-4" @submit.prevent="signUp">
        <UFormField label="Name">
          <UInput v-model="name" placeholder="Your name" required class="w-full" />
        </UFormField>
        <UFormField label="Email">
          <UInput v-model="email" type="email" placeholder="you@example.com" required class="w-full" />
        </UFormField>
        <UFormField label="Password">
          <UInput v-model="password" type="password" placeholder="••••••••" required class="w-full" />
        </UFormField>
        <UAlert v-if="error" color="error" :description="error" />
        <UButton type="submit" class="w-full justify-center" :loading="loading">
          Create account
        </UButton>
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-muted">
          Already have an account?
          <ULink to="/login" class="font-medium">Sign in</ULink>
        </p>
      </template>
  </UCard>
</template>
