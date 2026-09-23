<script setup lang="ts">
// Small themed dialog used by the slot control bar (autoplay, buy bonus).
// Teleported to <body>, so the theme's CSS variables are bound here too.
import { slotThemeVars, type SlotTheme } from '~/utils/slots/slot-controls'

const props = defineProps<{
  theme: SlotTheme
  title: string
}>()

const open = defineModel<boolean>('open', { default: false })
const panel = ref<HTMLElement>()
const titleId = useId()
let returnFocus: HTMLElement | null = null

function close() {
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    returnFocus = document.activeElement as HTMLElement | null
    await nextTick()
    const target = panel.value?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.value
    target?.focus()
  } else {
    returnFocus?.focus?.()
    returnFocus = null
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sd">
      <div
        v-if="open"
        class="sd-scrim"
        :style="slotThemeVars(props.theme)"
        @click.self="close"
        @keydown="onKeydown"
      >
        <div
          ref="panel"
          class="sd-panel"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          tabindex="-1"
        >
          <header class="sd-head">
            <h2
              :id="titleId"
              class="sd-title"
            >
              {{ title }}
            </h2>
            <button
              type="button"
              class="sd-close"
              aria-label="Close"
              @click="close"
            >
              <UIcon
                name="i-lucide-x"
                class="size-5"
              />
            </button>
          </header>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sd-scrim {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(4px);
}

.sd-panel {
  width: min(100%, 400px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 18px 20px 20px;
  border-radius: 20px;
  color: var(--sc-text);
  font-family: var(--sc-font);
  background: var(--sc-panel);
  box-shadow: 0 0 0 1px var(--sc-line), 0 24px 60px rgba(0, 0, 0, 0.55);
  outline: none;
}

.sd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.sd-title {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.sd-close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-right: -6px;
  border-radius: 10px;
  color: var(--sc-muted);
  transition: color 0.15s, background-color 0.15s;
}

.sd-close:hover { color: var(--sc-text); background: var(--sc-control); }
.sd-close:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

.sd-enter-active, .sd-leave-active { transition: opacity 0.18s ease; }
.sd-enter-active .sd-panel, .sd-leave-active .sd-panel { transition: transform 0.22s cubic-bezier(0.2, 1.2, 0.4, 1); }
.sd-enter-from, .sd-leave-to { opacity: 0; }
.sd-enter-from .sd-panel { transform: translateY(12px) scale(0.97); }
.sd-leave-to .sd-panel { transform: scale(0.98); }
</style>
