<script setup lang="ts">
// Rail Tycoon — the game page (W121): the world chooser, or the game view for ?world=<id>.
//
// Opening a world puts its id in the query with router.replace, so a reload reopens it; leaving
// clears it. The page hosts every game window (AR-38): each useRtWindows entry renders through the
// kind-to-component map below. A query click on the map opens the vehicle, station or depot buy
// window for that tile (rtQueryTarget). The orders editor's pick mode is run by the vehicle window
// itself through the game's RtTools (AR-54), so nothing passes through here for it.
//
// Invites (AR-32): /rail-tycoon/invite/<code> parks the code in the rt-invite cookie and sends the
// player here, through the login redirect if need be. The chooser sends it as a join; on the hub's
// answer, either way, the cookie is cleared, so a reload never joins twice.
import type { Component } from 'vue'
import { isRtInviteCode } from '#shared/utils/rail-tycoon/limits'
import { RT_PROTOCOL_BOUNDS, type RtRole } from '#shared/utils/rail-tycoon/protocol'
import RtBuyVehicleWindow from '~/components/rail-tycoon/RtBuyVehicleWindow.vue'
import RtFinancesWindow from '~/components/rail-tycoon/RtFinancesWindow.vue'
import RtGameView from '~/components/rail-tycoon/RtGameView.client.vue'
import RtMinimap from '~/components/rail-tycoon/RtMinimap.vue'
import RtBuildPicker from '~/components/rail-tycoon/RtBuildPicker.vue'
import RtStationWindow from '~/components/rail-tycoon/RtStationWindow.vue'
import RtStatusBar from '~/components/rail-tycoon/RtStatusBar.vue'
import RtToolbar from '~/components/rail-tycoon/RtToolbar.vue'
import RtVehicleListWindow from '~/components/rail-tycoon/RtVehicleListWindow.vue'
import RtVehicleWindow from '~/components/rail-tycoon/RtVehicleWindow.vue'
import RtWorldChooser from '~/components/rail-tycoon/RtWorldChooser.vue'
import { rtServerErrorText, useRtWindows, type RtLeaveReason, type RtWindowEntry, type RtWindowKind } from '~/utils/rail-tycoon/windows'
import { rtQueryTarget } from '~/utils/rail-tycoon/world-windows'

definePageMeta({ layout: false })

useSeoMeta({
  title: 'Rail Tycoon',
  description: 'Build railways and roads between towns and industries with friends in persistent multiplayer worlds.'
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const windows = useRtWindows()

const WINDOWS: Record<RtWindowKind, Component> = {
  finances: RtFinancesWindow,
  buyVehicle: RtBuyVehicleWindow,
  vehicleList: RtVehicleListWindow,
  vehicle: RtVehicleWindow,
  station: RtStationWindow,
  minimap: RtMinimap,
  buildPicker: RtBuildPicker
}

/** The world in the URL, when it is shaped like a world id. */
const worldId = computed(() => {
  const value = route.query.world
  if (typeof value !== 'string' || !value) return null
  return new TextEncoder().encode(value).length <= RT_PROTOCOL_BOUNDS.worldIdBytes ? value : null
})
/** The role the chooser opened the world as; a reload starts as player and the server corrects it. */
const role = ref<RtRole>('player')
const view = ref<InstanceType<typeof RtGameView> | null>(null)

// ─── Invite pick-up ──────────────────────────────────────────────────────

// raw text: the default decoder would turn an all-digit code into a number
const inviteCookie = useCookie<string | null>('rt-invite', {
  path: '/',
  sameSite: 'lax',
  decode: value => value ?? null,
  encode: value => value ?? ''
})
// read once here (the site is client-rendered), so a reload in a world with an invite waiting shows
// the chooser straight away instead of opening the world first
const invite = ref<string | null>(isRtInviteCode(inviteCookie.value) ? inviteCookie.value : null)
if (inviteCookie.value && !invite.value) inviteCookie.value = null

onMounted(() => {
  // the join answers with the world to open; the chooser has the socket, so it shows meanwhile
  if (invite.value && worldId.value) void setWorld(null)
})

function onInvited() {
  inviteCookie.value = null
  invite.value = null
}

// ─── Opening and leaving ─────────────────────────────────────────────────

async function setWorld(id: string | null) {
  const query = { ...route.query }
  if (id) query.world = id
  else delete query.world
  await router.replace({ query })
}

function onOpen(id: string, next: RtRole) {
  role.value = next
  void setWorld(id)
}

const LEAVE_TEXT: Record<Exclude<RtLeaveReason, 'user'>, string> = {
  deleted: 'That world was deleted by its owner',
  broken: rtServerErrorText('worldBroken'),
  noAccess: rtServerErrorText('noAccess')
}

function onLeave(reason: RtLeaveReason) {
  if (reason !== 'user') toast.add({ title: LEAVE_TEXT[reason], color: reason === 'deleted' ? 'warning' : 'error' })
  role.value = 'player'
  void setWorld(null)
}

// ─── Windows ─────────────────────────────────────────────────────────────

function windowProps(entry: RtWindowEntry): Record<string, unknown> {
  return entry.id === null ? { ...entry.props } : { id: entry.id, ...entry.props }
}

/** A query click: a vehicle on the tile, else its station, else the player's own depot. */
function onQuery(tile: number) {
  const ls = view.value?.game.lockstep.value
  if (!ls) return
  const target = rtQueryTarget(ls.world, ls.company, tile)
  if (target) windows.open(target.kind, target.id)
}

const showGame = computed(() => worldId.value !== null && invite.value === null)
</script>

<template>
  <div class="rt-page">
    <RtGameView
      v-if="showGame && worldId"
      ref="view"
      :key="worldId"
      :world-id="worldId"
      :role="role"
      @leave="onLeave"
      @query="onQuery"
    >
      <template #toolbar>
        <RtToolbar />
      </template>
      <template #status>
        <RtStatusBar />
      </template>
      <template #windows>
        <component
          :is="WINDOWS[entry.kind]"
          v-for="entry in windows.list"
          :key="entry.key"
          :window-key="entry.key"
          v-bind="windowProps(entry)"
        />
      </template>
    </RtGameView>

    <RtWorldChooser v-else :invite="invite" @open="onOpen" @invited="onInvited">
      <template #footer>
        <p class="rt-credits">
          Graphics from
          <a href="https://github.com/OpenTTD/OpenGFX" target="_blank" rel="noopener">OpenGFX</a>
          by the OpenGFX team, licensed
          <a href="/rail-tycoon/opengfx/README.md" target="_blank" rel="noopener">GPL-2.0</a>.
        </p>
      </template>
    </RtWorldChooser>
  </div>
</template>

<style scoped>
.rt-page {
  min-height: 100dvh;
  background: #1b1914;
}
.rt-credits {
  margin: 24px 0 0;
  color: #8a8270;
  font-size: 12px;
  text-align: center;
}
.rt-credits a {
  color: #cfc8b6;
  text-decoration: underline;
}
</style>
