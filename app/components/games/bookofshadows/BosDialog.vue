<script setup lang="ts">
// Grimoire-styled dialog shell shared by the Book of Shadows info and
// autoplay panels. Esc or the backdrop closes it.
const open = defineModel<boolean>('open', { required: true })

defineProps<{
  title: string
  width?: string
}>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    open.value = false
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="bos-dialog">
      <div
        v-if="open"
        class="bos-dialog-backdrop"
        @click.self="open = false"
      >
        <section
          class="bos-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :style="{ maxWidth: width ?? '760px' }"
        >
          <header class="bos-dialog-head">
            <h2>{{ title }}</h2>
            <button
              type="button"
              class="bos-dialog-close"
              aria-label="Close"
              @click="open = false"
            >
              <UIcon
                name="i-lucide-x"
                class="size-5"
              />
            </button>
          </header>
          <slot name="tabs" />
          <div class="bos-dialog-body">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bos-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(4, 2, 1, 0.72);
  backdrop-filter: blur(4px);
}

.bos-dialog {
  display: flex;
  width: 100%;
  max-height: min(88dvh, 860px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(214, 170, 90, 0.55);
  border-radius: 16px;
  background:
    radial-gradient(ellipse 90% 50% at 50% 0%, rgba(120, 70, 20, 0.22), transparent 70%),
    linear-gradient(180deg, #1c130c, #0e0906);
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.55), 0 30px 80px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 220, 150, 0.12);
  color: #e8d9bd;
}

.bos-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(214, 170, 90, 0.25);
  padding: 14px 18px;
}

.bos-dialog-head h2 {
  font-family: Cinzel, Georgia, serif;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: linear-gradient(180deg, #fff3cf, #e0a93a);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.bos-dialog-close {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(214, 170, 90, 0.35);
  border-radius: 999px;
  color: #d9b77a;
  cursor: pointer;
  transition: background 140ms ease;
}

.bos-dialog-close:hover {
  background: rgba(214, 170, 90, 0.14);
}

.bos-dialog-body {
  overflow-y: auto;
  padding: 16px 18px 20px;
}

.bos-dialog-enter-active,
.bos-dialog-leave-active {
  transition: opacity 180ms ease;
}

.bos-dialog-enter-active .bos-dialog,
.bos-dialog-leave-active .bos-dialog {
  transition: transform 220ms cubic-bezier(0.2, 1.3, 0.4, 1);
}

.bos-dialog-enter-from,
.bos-dialog-leave-to {
  opacity: 0;
}

.bos-dialog-enter-from .bos-dialog,
.bos-dialog-leave-to .bos-dialog {
  transform: scale(0.94) translateY(8px);
}
</style>
