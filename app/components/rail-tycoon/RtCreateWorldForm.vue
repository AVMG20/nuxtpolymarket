<script setup lang="ts">
// Rail Tycoon — the chooser's New world form: name, map size, company cap, sharing and public.
// It checks the name against the protocol's byte cap; the chooser sends the create.
import { RT_MAP_SIDES } from '#shared/utils/rail-tycoon/map'
import { RT_PROTOCOL_BOUNDS, type RtClientMsg } from '#shared/utils/rail-tycoon/protocol'

type RtNewWorld = Omit<Extract<RtClientMsg, { type: 'create' }>, 'type'>

const props = defineProps<{
  connected: boolean
  busy: boolean
  /** A create is waiting on the server. */
  creating: boolean
}>()

const emit = defineEmits<{
  create: [world: RtNewWorld]
}>()

const NAME_MAX_BYTES = RT_PROTOCOL_BOUNDS.nameBytes
const MIN_COMPANIES = RT_PROTOCOL_BOUNDS.minCompanies
const MAX_COMPANIES = RT_PROTOCOL_BOUNDS.companies

const form = reactive({
  name: '',
  side: 128,
  maxCompanies: 4,
  sharing: true,
  isPublic: false
})

const encoder = new TextEncoder()
const nameBytes = computed(() => encoder.encode(form.name.trim()).length)
const nameTooLong = computed(() => nameBytes.value > NAME_MAX_BYTES)
const canCreate = computed(() => props.connected && !props.busy && form.name.trim().length > 0 && !nameTooLong.value)

function create() {
  if (canCreate.value) emit('create', { ...form, name: form.name.trim() })
}
</script>

<template>
  <form class="rtc-panel" aria-labelledby="rtc-create-h" @submit.prevent="create">
    <h2 id="rtc-create-h">New world</h2>
    <label class="rtc-field">
      <span>Name</span>
      <input v-model="form.name" type="text" class="rtc-input" data-field="world-name" placeholder="My railway" autocomplete="off">
    </label>
    <p v-if="nameTooLong" class="rtc-hint rtc-hint-bad">That name is too long ({{ nameBytes }} of {{ NAME_MAX_BYTES }} bytes; accents and emoji count extra).</p>

    <div class="rtc-field">
      <span>Map size</span>
      <div class="rtc-seg" role="radiogroup" aria-label="Map size">
        <button
          v-for="side in RT_MAP_SIDES"
          :key="side"
          type="button"
          role="radio"
          class="rtc-seg-btn"
          :class="{ 'rtc-seg-on': form.side === side }"
          :aria-checked="form.side === side"
          :data-side="side"
          @click="form.side = side"
        >
          {{ side }}×{{ side }}
        </button>
      </div>
    </div>

    <label class="rtc-field">
      <span>Companies (most)</span>
      <select v-model.number="form.maxCompanies" class="rtc-input" data-field="max-companies">
        <option v-for="n in MAX_COMPANIES - MIN_COMPANIES + 1" :key="n" :value="n + MIN_COMPANIES - 1">{{ n + MIN_COMPANIES - 1 }}</option>
      </select>
    </label>

    <label class="rtc-check">
      <input v-model="form.sharing" type="checkbox" data-field="sharing">
      <span>
        <b>Share track and stations</b>
        <small>Other companies' trains and buses may use your track and stations and pay you for it.</small>
      </span>
    </label>

    <label class="rtc-check">
      <input v-model="form.isPublic" type="checkbox" data-field="public">
      <span>
        <b>Public</b>
        <small>List it in the public lobby, so anyone can join without an invite.</small>
      </span>
    </label>

    <button type="submit" class="rtc-btn rtc-btn-main rtc-btn-wide" data-action="create" :disabled="!canCreate">
      <UIcon :name="creating ? 'i-lucide-loader-circle' : 'i-lucide-plus'" class="size-4" :class="{ 'animate-spin': creating }" />
      Create world
    </button>
  </form>
</template>
