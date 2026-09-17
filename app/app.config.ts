// Conditional utilities leave the original component variants intact when opted out.
const studioField = {
  variants: {
    variant: {
      outline: 'studio:bg-(--studio-field)'
    }
  }
}
const studioOverlay = 'studio:bg-(--studio-surface) studio:shadow-(--studio-overlay-shadow)'

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      secondary: 'blue',
      neutral: 'zinc'
    },
    card: {
      slots: {
        root: 'studio:shadow-(--studio-shadow)'
      },
      variants: {
        variant: {
          outline: { root: 'studio:bg-(--studio-surface)' }
        }
      }
    },
    button: {
      slots: {
        base: 'studio:font-semibold'
      },
      variants: {
        variant: {
          solid: 'studio:shadow-(--studio-shadow)',
          outline: 'studio:shadow-(--studio-shadow)'
        }
      }
    },
    input: studioField,
    inputNumber: studioField,
    textarea: studioField,
    select: {
      ...studioField,
      slots: { content: studioOverlay }
    },
    selectMenu: {
      ...studioField,
      slots: { content: studioOverlay }
    },
    popover: {
      slots: { content: studioOverlay }
    },
    dropdownMenu: {
      slots: { content: studioOverlay }
    },
    modal: {
      slots: { content: 'studio:bg-(--studio-surface)' },
      variants: {
        fullscreen: {
          false: { content: 'studio:shadow-(--studio-overlay-shadow)' }
        }
      }
    },
    slideover: {
      slots: { content: studioOverlay }
    }
  }
})
