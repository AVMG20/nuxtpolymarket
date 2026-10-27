<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'

// Title bar, menu bar and toolbar of spreadsheet mode. Everything here is
// set dressing: menus open and close, buttons do nothing. The logo leaves.

const title = defineModel<string>('title', { required: true })
defineProps<{ initial: string, avatarColor: string }>()
const emit = defineEmits<{ home: [] }>()

type MenuItem = { label: string, shortcut?: string, icon?: string, more?: boolean } | '-'

const MENUS: Record<string, MenuItem[]> = {
  File: [
    { label: 'New', icon: 'i-material-symbols-add-box-outline-rounded', more: true },
    { label: 'Open', icon: 'i-material-symbols-folder-open-outline-rounded', shortcut: '⌘O' },
    { label: 'Import', icon: 'i-material-symbols-upload-rounded' },
    { label: 'Make a copy', icon: 'i-material-symbols-content-copy-outline-rounded' },
    '-',
    { label: 'Share', icon: 'i-material-symbols-person-add-outline-rounded', more: true },
    { label: 'Email', icon: 'i-material-symbols-mail-outline-rounded', more: true },
    { label: 'Download', icon: 'i-material-symbols-download-rounded', more: true },
    '-',
    { label: 'Rename', icon: 'i-material-symbols-edit-outline-rounded' },
    { label: 'Move', icon: 'i-material-symbols-drive-file-move-outline-rounded' },
    { label: 'Add shortcut to Drive', icon: 'i-material-symbols-add-to-drive-rounded' },
    { label: 'Move to trash', icon: 'i-material-symbols-delete-outline-rounded' },
    '-',
    { label: 'Version history', icon: 'i-material-symbols-history-rounded', more: true },
    { label: 'Make available offline', icon: 'i-material-symbols-offline-pin-outline-rounded' },
    '-',
    { label: 'Details', icon: 'i-material-symbols-info-outline-rounded' },
    { label: 'Settings', icon: 'i-material-symbols-settings-outline-rounded' },
    '-',
    { label: 'Print', icon: 'i-material-symbols-print-outline-rounded', shortcut: '⌘P' }
  ],
  Edit: [
    { label: 'Undo', icon: 'i-material-symbols-undo-rounded', shortcut: '⌘Z' },
    { label: 'Redo', icon: 'i-material-symbols-redo-rounded', shortcut: '⌘Y' },
    '-',
    { label: 'Cut', icon: 'i-material-symbols-content-cut-rounded', shortcut: '⌘X' },
    { label: 'Copy', icon: 'i-material-symbols-content-copy-outline-rounded', shortcut: '⌘C' },
    { label: 'Paste', icon: 'i-material-symbols-content-paste-rounded', shortcut: '⌘V' },
    { label: 'Paste special', icon: 'i-material-symbols-content-paste-go-rounded', more: true },
    '-',
    { label: 'Move', icon: 'i-material-symbols-open-with-rounded', more: true },
    { label: 'Delete', icon: 'i-material-symbols-delete-outline-rounded', more: true },
    '-',
    { label: 'Find and replace', icon: 'i-material-symbols-find-replace-rounded', shortcut: '⌘⇧H' }
  ],
  View: [
    { label: 'Show', icon: 'i-material-symbols-visibility-outline-rounded', more: true },
    { label: 'Freeze', icon: 'i-material-symbols-ac-unit-rounded', more: true },
    { label: 'Group', icon: 'i-material-symbols-add-box-outline-rounded', more: true },
    '-',
    { label: 'Comments', icon: 'i-material-symbols-comment-outline-rounded', more: true },
    { label: 'Hidden sheets', icon: 'i-material-symbols-visibility-off-outline-rounded', more: true },
    '-',
    { label: 'Zoom', icon: 'i-material-symbols-zoom-in-rounded', more: true },
    { label: 'Full screen', icon: 'i-material-symbols-fullscreen-rounded' }
  ],
  Insert: [
    { label: 'Cells', more: true },
    { label: 'Rows', more: true },
    { label: 'Columns', more: true },
    { label: 'Sheet', shortcut: '⇧F11' },
    '-',
    { label: 'Timeline', icon: 'i-material-symbols-view-timeline-outline-rounded' },
    { label: 'Chart', icon: 'i-material-symbols-insert-chart-outline-rounded' },
    { label: 'Pivot table', icon: 'i-material-symbols-pivot-table-chart-rounded' },
    { label: 'Image', icon: 'i-material-symbols-image-outline-rounded', more: true },
    { label: 'Drawing', icon: 'i-material-symbols-draw-outline-rounded' },
    '-',
    { label: 'Function', icon: 'i-material-symbols-functions-rounded', more: true },
    { label: 'Link', icon: 'i-material-symbols-link-rounded', shortcut: '⌘K' },
    '-',
    { label: 'Checkbox', icon: 'i-material-symbols-check-box-outline-rounded' },
    { label: 'Dropdown', icon: 'i-material-symbols-arrow-drop-down-circle-outline-rounded' },
    { label: 'Emoji', icon: 'i-material-symbols-mood-outline-rounded' },
    { label: 'Smart chips', icon: 'i-material-symbols-alternate-email-rounded', more: true },
    '-',
    { label: 'Comment', icon: 'i-material-symbols-add-comment-outline-rounded', shortcut: '⌘⌥M' },
    { label: 'Note', icon: 'i-material-symbols-sticky-note-2-outline-rounded', shortcut: '⇧F2' }
  ],
  Format: [
    { label: 'Theme', icon: 'i-material-symbols-palette-outline-rounded' },
    '-',
    { label: 'Number', icon: 'i-material-symbols-123-rounded', more: true },
    { label: 'Text', icon: 'i-material-symbols-format-bold-rounded', more: true },
    { label: 'Alignment', icon: 'i-material-symbols-format-align-left-rounded', more: true },
    { label: 'Wrapping', icon: 'i-material-symbols-wrap-text-rounded', more: true },
    { label: 'Rotation', icon: 'i-material-symbols-text-rotation-angleup-rounded', more: true },
    '-',
    { label: 'Font size', icon: 'i-material-symbols-format-size-rounded', more: true },
    { label: 'Merge cells', icon: 'i-material-symbols-cell-merge-rounded', more: true },
    '-',
    { label: 'Convert to table', icon: 'i-material-symbols-table-outline-rounded', shortcut: '⌥⌘T' },
    { label: 'Conditional formatting', icon: 'i-material-symbols-format-paint-outline-rounded' },
    { label: 'Alternating colors', icon: 'i-material-symbols-format-color-fill-rounded' },
    '-',
    { label: 'Clear formatting', icon: 'i-material-symbols-format-clear-rounded', shortcut: '⌘\\' }
  ],
  Data: [
    { label: 'Sort sheet', icon: 'i-material-symbols-sort-rounded', more: true },
    { label: 'Sort range', icon: 'i-material-symbols-sort-rounded', more: true },
    '-',
    { label: 'Create a filter', icon: 'i-material-symbols-filter-alt-outline-rounded' },
    { label: 'Create group by view', icon: 'i-material-symbols-table-rows-outline-rounded' },
    { label: 'Create filter view', icon: 'i-material-symbols-filter-list-rounded' },
    { label: 'Add a slicer', icon: 'i-material-symbols-tune-rounded' },
    '-',
    { label: 'Protect sheets and ranges', icon: 'i-material-symbols-lock-outline-rounded' },
    { label: 'Named ranges', icon: 'i-material-symbols-bookmark-outline-rounded' },
    { label: 'Named functions', icon: 'i-material-symbols-function' },
    { label: 'Randomize range', icon: 'i-material-symbols-shuffle-rounded' },
    '-',
    { label: 'Column stats', icon: 'i-material-symbols-lightbulb-outline-rounded' },
    { label: 'Data validation', icon: 'i-material-symbols-rule-rounded' },
    { label: 'Data cleanup', icon: 'i-material-symbols-mop-outline-rounded', more: true },
    { label: 'Split text to columns', icon: 'i-material-symbols-view-column-outline-rounded' },
    '-',
    { label: 'Data connectors', icon: 'i-material-symbols-database-outline', more: true }
  ],
  Tools: [
    { label: 'Create a new form', icon: 'i-material-symbols-list-alt-outline-rounded' },
    '-',
    { label: 'Spelling', icon: 'i-material-symbols-spellcheck-rounded', more: true },
    { label: 'Suggestion controls', icon: 'i-material-symbols-auto-awesome-outline-rounded', more: true },
    '-',
    { label: 'Notification settings', icon: 'i-material-symbols-notifications-outline-rounded', more: true },
    { label: 'Accessibility', icon: 'i-material-symbols-accessibility-new-rounded' },
    { label: 'Activity dashboard', icon: 'i-material-symbols-trending-up-rounded' }
  ],
  Extensions: [
    { label: 'Add-ons', icon: 'i-material-symbols-extension-outline', more: true },
    { label: 'Macros', icon: 'i-material-symbols-play-circle-outline-rounded', more: true },
    { label: 'Apps Script', icon: 'i-material-symbols-code-rounded' },
    { label: 'AppSheet', icon: 'i-material-symbols-apps-rounded', more: true }
  ],
  Help: [
    { label: 'Search the menus', icon: 'i-material-symbols-search-rounded', shortcut: '⌥/' },
    '-',
    { label: 'Help', icon: 'i-material-symbols-help-outline-rounded' },
    { label: 'Training', icon: 'i-material-symbols-school-outline-rounded' },
    { label: 'Updates', icon: 'i-material-symbols-campaign-outline-rounded' },
    '-',
    { label: 'Help Sheets improve', icon: 'i-material-symbols-feedback-outline-rounded' },
    '-',
    { label: 'Privacy Policy' },
    { label: 'Terms of Service' },
    '-',
    { label: 'Function list', icon: 'i-material-symbols-functions-rounded' },
    { label: 'Keyboard shortcuts', icon: 'i-material-symbols-keyboard-outline-rounded', shortcut: '⌘/' }
  ]
}

const openMenu = ref<string | null>(null)
const menuBar = useTemplateRef<HTMLElement>('menuBar')
onClickOutside(menuBar, () => openMenu.value = null)

const titleInput = useTemplateRef<HTMLInputElement>('titleInput')
function onTitleKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === 'Escape') titleInput.value?.blur()
}
function onTitleBlur() {
  if (!title.value.trim()) title.value = 'Untitled spreadsheet'
}

const fontSize = ref(10)
</script>

<template>
  <header class="shrink-0 bg-[#f9fbfd] font-[Google_Sans,Roboto,Arial,sans-serif] text-[#1f1f1f]">
    <!-- Title bar -->
    <div class="flex h-[64px] items-center pl-4 pr-4">
      <button class="mr-2 shrink-0 p-1" aria-label="Sheets home" @click="emit('home')">
        <img :src="SHEET_LOGO_URL" alt="" class="h-[40px] w-[30px]">
      </button>
      <div class="flex min-w-0 flex-1 flex-col justify-center">
        <div class="flex h-[26px] items-center gap-0.5">
          <span class="relative inline-grid min-w-0 items-center">
            <span class="invisible col-start-1 row-start-1 whitespace-pre px-1.5 text-[18px]">{{ title || ' ' }}</span>
            <input
              ref="titleInput"
              v-model="title"
              class="col-start-1 row-start-1 w-full min-w-0 rounded-[4px] border border-transparent bg-transparent px-1.5 text-[18px] outline-none hover:border-[#747775] focus:border-2 focus:border-[#0b57d0] focus:px-[5px]"
              spellcheck="false"
              @keydown="onTitleKey"
              @blur="onTitleBlur"
            >
          </span>
          <button class="grid size-[26px] shrink-0 place-items-center rounded-full text-[#444746] hover:bg-[#e1e3e1]" aria-label="Star">
            <UIcon name="i-material-symbols-star-outline-rounded" class="size-[18px]" />
          </button>
          <button class="grid size-[26px] shrink-0 place-items-center rounded-full text-[#444746] hover:bg-[#e1e3e1]" aria-label="Move">
            <UIcon name="i-material-symbols-drive-file-move-outline-rounded" class="size-[18px]" />
          </button>
          <button class="grid size-[26px] shrink-0 place-items-center rounded-full text-[#444746] hover:bg-[#e1e3e1]" aria-label="See document status">
            <UIcon name="i-material-symbols-cloud-done-outline-rounded" class="size-[18px]" />
          </button>
        </div>
        <nav ref="menuBar" class="-ml-0.5 flex h-[24px] items-center text-[14px]">
          <div v-for="(items, name) in MENUS" :key="name" class="relative">
            <button
              class="rounded-[4px] px-[7px] leading-[22px] hover:bg-[#e1e3e1]"
              :class="openMenu === name ? 'bg-[#e1e3e1]' : ''"
              @click="openMenu = openMenu === name ? null : name"
              @mouseenter="openMenu && (openMenu = name)"
            >
              {{ name }}
            </button>
            <div
              v-if="openMenu === name"
              class="absolute left-0 top-[26px] z-[60] min-w-[300px] rounded-[4px] bg-white py-1.5 text-[14px] shadow-[0_2px_6px_2px_rgba(60,64,67,0.15),0_1px_2px_rgba(60,64,67,0.3)]"
            >
              <template v-for="(item, i) in items" :key="i">
                <div v-if="item === '-'" class="my-1.5 h-px bg-[#e1e3e1]" />
                <button
                  v-else
                  class="flex h-[32px] w-full items-center gap-3 pl-4 pr-3 text-left hover:bg-[#f1f3f4]"
                  @click="openMenu = null"
                >
                  <UIcon v-if="item.icon" :name="item.icon" class="size-[20px] shrink-0 text-[#444746]" />
                  <span v-else class="size-[20px] shrink-0" />
                  <span class="flex-1 whitespace-nowrap tracking-[0.1px]">{{ item.label }}</span>
                  <span v-if="item.shortcut" class="whitespace-nowrap text-[13px] text-[#5f6368]">{{ item.shortcut }}</span>
                  <UIcon v-if="item.more" name="i-material-symbols-arrow-right-rounded" class="size-5 text-[#444746]" />
                </button>
              </template>
            </div>
          </div>
        </nav>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button class="grid size-10 place-items-center rounded-full text-[#444746] hover:bg-[#e1e3e1]" aria-label="Last edit was seconds ago">
          <UIcon name="i-material-symbols-history-rounded" class="size-6" />
        </button>
        <button class="grid size-10 place-items-center rounded-full text-[#444746] hover:bg-[#e1e3e1]" aria-label="Open comment history">
          <UIcon name="i-material-symbols-comment-outline-rounded" class="size-6" />
        </button>
        <button class="flex h-10 items-center rounded-full pl-2.5 pr-1 text-[#444746] hover:bg-[#e1e3e1]" aria-label="Join a call here or present this tab to the call">
          <UIcon name="i-material-symbols-videocam-outline-rounded" class="size-6" />
          <UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-5" />
        </button>
        <button class="ml-1 flex h-10 items-center gap-2 rounded-full bg-[#c2e7ff] pl-4 pr-5 text-[14px] font-medium text-[#001d35] hover:shadow-[0_1px_2px_rgba(60,64,67,0.3),0_1px_3px_1px_rgba(60,64,67,0.15)]">
          <UIcon name="i-material-symbols-lock-outline-rounded" class="size-[18px]" />
          Share
        </button>
        <span
          class="ml-2 grid size-8 place-items-center rounded-full text-[15px] font-medium text-white"
          :style="{ background: avatarColor }"
        >{{ initial }}</span>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="px-2 pb-2">
      <div class="flex h-[40px] items-center gap-px overflow-hidden rounded-full bg-[#edf2fa] px-1.5 text-[#444746]">
        <button class="tb-btn !px-2"><UIcon name="i-material-symbols-search-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-undo-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-redo-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-print-outline-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-format-paint-outline-rounded" class="size-5" /></button>
        <button class="tb-btn !px-1.5 text-[14px]">
          100%<UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-5" />
        </button>
        <span class="tb-sep" />
        <button class="tb-btn"><UIcon name="i-material-symbols-attach-money-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-percent-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-decimal-decrease" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-decimal-increase" class="size-5" /></button>
        <button class="tb-btn !px-1.5 text-[13px] font-medium">
          123<UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-5" />
        </button>
        <span class="tb-sep" />
        <button class="tb-btn w-[88px] !justify-between !px-1.5 text-[14px]">
          Defaul...<UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-5" />
        </button>
        <span class="tb-sep" />
        <button class="tb-btn" @click="fontSize = Math.max(1, fontSize - 1)"><UIcon name="i-material-symbols-remove-rounded" class="size-5" /></button>
        <span class="mx-0.5 grid h-[26px] w-[34px] place-items-center rounded-[4px] border border-[#747775] text-[14px] text-[#1f1f1f]">{{ fontSize }}</span>
        <button class="tb-btn" @click="fontSize = Math.min(400, fontSize + 1)"><UIcon name="i-material-symbols-add-rounded" class="size-5" /></button>
        <span class="tb-sep" />
        <button class="tb-btn"><UIcon name="i-material-symbols-format-bold-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-format-italic-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-strikethrough-s-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-format-color-text-rounded" class="size-5" /></button>
        <span class="tb-sep" />
        <button class="tb-btn"><UIcon name="i-material-symbols-format-color-fill-outline" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-border-all-outline-rounded" class="size-5" /></button>
        <button class="tb-btn !px-1"><UIcon name="i-material-symbols-cell-merge-rounded" class="size-5" /><UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-4" /></button>
        <span class="tb-sep" />
        <button class="tb-btn !px-1"><UIcon name="i-material-symbols-format-align-left-rounded" class="size-5" /><UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-4" /></button>
        <button class="tb-btn !px-1"><UIcon name="i-material-symbols-vertical-align-bottom-rounded" class="size-5" /><UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-4" /></button>
        <button class="tb-btn !px-1"><UIcon name="i-material-symbols-wrap-text-rounded" class="size-5" /><UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-4" /></button>
        <button class="tb-btn !px-1"><UIcon name="i-material-symbols-text-rotation-none-rounded" class="size-5" /><UIcon name="i-material-symbols-arrow-drop-down-rounded" class="size-4" /></button>
        <span class="tb-sep" />
        <button class="tb-btn"><UIcon name="i-material-symbols-link-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-add-comment-outline-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-insert-chart-outline-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-filter-alt-outline-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-table-chart-view-outline-rounded" class="size-5" /></button>
        <button class="tb-btn"><UIcon name="i-material-symbols-functions-rounded" class="size-5" /></button>
        <span class="flex-1" />
        <button class="tb-btn"><UIcon name="i-material-symbols-keyboard-arrow-up-rounded" class="size-5" /></button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.tb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  min-width: 28px;
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 4px;
}
.tb-btn:hover {
  background: #dde3ea;
}
.tb-sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  flex-shrink: 0;
  background: #c7c7c7;
}
</style>
