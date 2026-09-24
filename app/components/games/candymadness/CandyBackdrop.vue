<script setup lang="ts">
defineProps<{ bonus?: boolean }>()
</script>

<template>
  <div class="cm-backdrop" :class="{ 'is-bonus': bonus }" aria-hidden="true">
    <div class="cm-backdrop__glow" />
    <svg class="cm-backdrop__land" viewBox="0 0 1600 800" preserveAspectRatio="xMidYMax slice" fill="none">
      <defs>
        <linearGradient id="candy-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--cm-pink)" stop-opacity=".2" />
          <stop offset="1" stop-color="var(--candy-violet)" stop-opacity=".08" />
        </linearGradient>
        <radialGradient id="candy-lollipop">
          <stop offset="0" stop-color="var(--cm-pink)" stop-opacity=".36" />
          <stop offset="1" stop-color="var(--candy-violet)" stop-opacity=".13" />
        </radialGradient>
      </defs>

      <path d="M0 535Q150 450 325 540T730 548T1160 518T1600 542V800H0Z" fill="url(#candy-hill)" />
      <path d="M0 650Q180 560 400 635T840 645T1240 612T1600 665V800H0Z" fill="var(--candy-violet)" opacity=".15" />
      <path d="M0 736Q290 665 570 745T1170 722T1600 740V800H0Z" fill="var(--cm-pink)" opacity=".08" />

      <g class="cm-backdrop__lolly">
        <path d="m140 495 23 248m1280-290-24 260" stroke="var(--cm-gold)" stroke-width="10" stroke-linecap="round" opacity=".32" />
        <circle cx="132" cy="417" r="86" fill="url(#candy-lollipop)" stroke="var(--cm-pink)" stroke-width="4" stroke-opacity=".3" />
        <circle cx="1440" cy="365" r="93" fill="url(#candy-lollipop)" stroke="var(--cm-gold)" stroke-width="4" stroke-opacity=".32" />
        <path d="M132 417c-20-28 25-50 43-19 23 43-56 79-88 24-42-71 77-117 116-46" stroke="var(--cm-pink)" stroke-width="16" stroke-linecap="round" opacity=".38" />
        <path d="M1440 365c-20-29 28-52 47-18 24 48-63 85-96 25-45-78 86-124 127-43" stroke="var(--cm-gold)" stroke-width="17" stroke-linecap="round" opacity=".36" />
        <path d="M83 365c17-25 43-33 61-35m1239-12c20-30 44-40 68-42" stroke="var(--ui-text-highlighted)" stroke-width="7" stroke-linecap="round" opacity=".15" />
      </g>

      <g fill="var(--cm-gold)" opacity=".48">
        <path d="m279 204 5 14 14 5-14 5-5 14-5-14-14-5 14-5ZM1299 169l4 12 12 4-12 4-4 12-4-12-12-4 12-4Z" />
        <circle cx="354" cy="313" r="3" /><circle cx="1247" cy="272" r="3" />
        <circle cx="1513" cy="154" r="2" /><circle cx="63" cy="236" r="2" />
      </g>
      <g fill="var(--cm-pink)" opacity=".4">
        <path d="m339 139 3 9 9 3-9 3-3 9-3-9-9-3 9-3ZM1210 101l3 10 10 3-10 3-3 10-3-10-10-3 10-3Z" />
        <circle cx="196" cy="211" r="3" /><circle cx="1373" cy="185" r="3" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.cm-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(ellipse 48% 60% at 50% 36%, color-mix(in srgb, var(--cm-pink) 14%, transparent), transparent 78%),
    radial-gradient(ellipse 30% 40% at 12% 25%, color-mix(in srgb, var(--candy-violet) 28%, transparent), transparent 75%),
    radial-gradient(ellipse 32% 42% at 88% 48%, color-mix(in srgb, var(--cm-gold) 9%, transparent), transparent 78%),
    var(--cm-paper);
}

.cm-backdrop__glow {
  position: absolute;
  top: -34%;
  left: 50%;
  width: min(90vw, 1300px);
  aspect-ratio: 1;
  transform: translateX(-50%);
  border: 1px solid color-mix(in srgb, var(--cm-pink) 13%, transparent);
  border-radius: 50%;
  box-shadow: 0 0 0 120px color-mix(in srgb, var(--cm-pink) 2%, transparent), 0 0 120px color-mix(in srgb, var(--cm-pink) 12%, transparent);
}

.cm-backdrop__land {
  position: absolute;
  bottom: 0;
  width: 100%;
  height: min(85%, 800px);
}

.is-bonus {
  background:
    radial-gradient(ellipse at 50% 26%, color-mix(in srgb, var(--cm-gold) 18%, transparent), transparent 68%),
    var(--cm-paper);
}

@media (max-width: 700px) {
  .cm-backdrop__land { width: 180%; left: -40%; }
  .cm-backdrop__lolly { opacity: .55; }
}
</style>
