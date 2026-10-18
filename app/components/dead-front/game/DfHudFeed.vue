<template>
    <TransitionGroup tag="ul" name="df-feed" class="df-feed" aria-live="polite">
        <li v-for="f in feed" :key="f.id" class="line" :class="f.tone" :style="{ '--life': `${DF_HUD_FEED_MS}ms` }">
            <span class="mark" aria-hidden="true" />
            <b v-if="f.who" class="who" :style="{ color: tint(f.whoColor) }">{{ f.who }}</b>
            <span class="text">{{ f.text }}</span>
            <b v-if="f.target" class="who" :style="{ color: tint(f.targetColor) }">{{ f.target }}</b>
        </li>
    </TransitionGroup>
</template>

<script setup lang="ts">
// Squad event feed, top right: one short line per event (a mate down,
// revived, a door opened, the power on), each with a block in its tone.
import { DF_HUD_FEED_MS } from '~/utils/dead-front/engine/hud'
import type { DfHudFeedItem } from '~/utils/dead-front/engine/hud'

defineProps<{ feed: DfHudFeedItem[] }>()

/** Player colours lifted toward white so names read on the dark panel. */
function tint(c: string | null): string {
    return c ? `color-mix(in srgb, ${c} 65%, #fff)` : '#f1e8cf'
}
</script>

<style scoped>
.df-feed {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    max-width: min(22rem, 40vw);
}

.line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.22rem 0.55rem 0.18rem 0.4rem;
    font-family: var(--df-font-type);
    font-size: 0.8rem;
    line-height: 1.2;
    color: #e8dfc4;
    background: var(--df-hud-bg);
    box-shadow: 0 -2px 0 #000, 0 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000;
    animation: df-feed-life var(--life) linear forwards;
}

.mark {
    align-self: stretch;
    width: 5px;
    flex-shrink: 0;
    background: #f1e8cf;
}

.red .mark { background: #ff3b24; }
.green .mark { background: #8ab052; }
.gold .mark { background: #ffd23f; }
.blue .mark { background: #7f93ff; }

.who {
    font-family: var(--df-font-stencil);
    font-weight: 400;
    font-size: 0.86rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
}

.text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.df-feed-enter-active {
    animation: df-feed-in 0.22s steps(4, end);
}

.df-feed-leave-active {
    transition: opacity 0.3s;
}

.df-feed-leave-to {
    opacity: 0;
}

@keyframes df-feed-in {
    0% { opacity: 0; transform: translateX(24px); }
    100% { opacity: 1; transform: none; }
}

@keyframes df-feed-life {
    0%, 85% { opacity: 1; }
    100% { opacity: 0; }
}
</style>
