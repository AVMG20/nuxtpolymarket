<template>
  <div class="loading">
    <div class="sun" />
    <div class="title">
      <span class="display gold-text">AVIA</span>
      <span class="display two">MASTERS</span>
    </div>
    <div class="bar"><div class="fill" /></div>
    <div class="hint">Fuelling the plane…</div>
  </div>
</template>

<style scoped>
.loading {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  background: linear-gradient(180deg, #0d3f86 0%, #2f7fd0 55%, #79bdf0 80%, #ffd8a8 100%);
}
.sun {
  position: absolute;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 245, 200, 0.7), transparent 65%);
  top: 8%;
  right: 6%;
}
.title {
  display: flex;
  align-items: baseline;
  font-size: clamp(40px, 9cqw, 96px);
  animation: float 2.4s ease-in-out infinite;
}
.two {
  background: linear-gradient(180deg, #ff8a78, #e0242c 55%, #8a0e14);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 4px 0 #fff) drop-shadow(0 8px 14px rgba(0, 0, 0, 0.4));
}
.bar {
  width: min(360px, 70cqw);
  height: 14px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.3);
  overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4);
}
.fill {
  height: 100%;
  width: 40%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--gold-2), #fff6c2, var(--gold-2));
  animation: load 1.1s ease-in-out infinite;
}
.hint {
  font-weight: 800;
  opacity: 0.85;
}
@keyframes load {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(260%);
  }
}
@keyframes float {
  50% {
    transform: translateY(-8px);
  }
}
</style>
