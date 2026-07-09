# Mission Briefings — RELAY's script for every op template

For the `ops-briefing.html` mockup (§6.3 of `PLAN.md`). One entry per
`OpTemplate` in `shared/utils/hack-config.ts` — **19 total**, grouped by the
same 5 informal tiers used in the source file's comments. Mechanics
(power/duration/cash/etc.) are quoted here only for briefing-writing context
— they are not new data, they already exist in `hack-config.ts` and must be
read from there at runtime, never hardcoded into UI copy.

**Format per entry:**
- **Briefing** — RELAY's voice line. Plays on opening the briefing player;
  this exact text is also the caption/subtitle track (teletype-reveal in
  sync with audio, per §5.2/5.3 of the plan). Written to be spoken in
  15–25 seconds.
- **Thumbnail prompt** — for `content/image-prompts.md` cross-reference and
  for direct use with an image generator. 16:9.
- **Ambient audio cue** — a low background bed that plays under the
  briefing (separate stem from the VO, per the `useAudio` "music" channel)
  and continues (looping, quieter) while that mission's card is expanded on
  the select screen.
- **Asset filenames** — the exact intended path, matching the placeholder
  labels used in the mockups.

Voice direction default for all: RELAY, unhurried, dry. Where a line calls
for something different (tension, dark humor, awe) it's called out.

---

## Tier 1 — Beginner (solo agent, 2–4h, no gem chance)

### Port Scan (`port_scan`)
- **Briefing:** "Nice and easy for a first run. Some strip-mall business is sitting on a network nobody's patched since 2019. Poke around, see what ports answer back, don't touch anything that isn't yours yet. Consider it a warm-up."
- **Thumbnail prompt:** Dim office server closet at night, a single blinking router LED, cables in a tangle, cool blue-teal monitor glow reflected on a wall, no people, moody low-key lighting, cyberpunk-adjacent but grounded/mundane, 16:9, cinematic.
- **Ambient audio cue:** low HVAC hum + distant traffic through a window.
- **Assets:** `voice/brief-port-scan.mp3`, `img/mission/port-scan.jpg`

### Wi-Fi Crack (`wifi_crack`)
- **Briefing:** "Coffee chain, one router, WPA2 that should've been retired years ago. Crack it, sit on their bandwidth a while, see what's floating across it. Barely counts as work."
- **Thumbnail prompt:** Interior of a chain coffee shop shot from a corner booth, laptop screen glow on a face kept out of focus/cropped, router visible on a shelf behind the counter blinking, warm shop lighting against cool laptop light, candid photojournalistic style, 16:9.
- **Ambient audio cue:** espresso machine hiss, murmured cafe chatter, low.
- **Assets:** `voice/brief-wifi-crack.mp3`, `img/mission/wifi-crack.jpg`

### Phishing Run (`phishing_run`)
- **Briefing:** "Fifty inboxes at a logistics company, one convincing email, and we own their credentials by lunch. People still click links, Handler. Every time."
- **Thumbnail prompt:** Split-composition graphic: a generic corporate email inbox UI with one highlighted urgent-looking message, rendered as a stylized HUD overlay, red flag/alert iconography, dark UI theme, minimal, high-contrast, 16:9.
- **Ambient audio cue:** keyboard clatter, notification chimes, office undertone.
- **Assets:** `voice/brief-phishing-run.mp3`, `img/mission/phishing-run.jpg`

### Corporate Breach (`corp_breach`)
- **Briefing:** "Fortune 500 HR database — social security numbers, salaries, the works. Get in, get the credentials, get out clean. First real target on the board. Don't get comfortable."
- **Thumbnail prompt:** Glass-tower corporate lobby at night shot from outside looking in, security desk unattended, badge reader glowing amber near an elevator bank, reflections of city lights on glass, moody thriller lighting, 16:9.
- **Ambient audio cue:** building ambience, distant elevator ding, muffled silence.
- **Assets:** `voice/brief-corp-breach.mp3`, `img/mission/corp-breach.jpg`

---

## Tier 2 — Early mid (1–2 agents, 5–7h, small gem chance)

### Bank Skim (`bank_skim`)
- **Briefing:** "Wire traffic between two regional banks, running mostly unencrypted where it shouldn't be. Sit on the line, skim what moves, and nobody notices a thing — assuming your people are as good as you say they are."
- **Thumbnail prompt:** Abstract visualization of financial wire data as glowing amber/gold particle streams flowing between two dark server-rack silhouettes, data-flow diagram aesthetic, dark background, cinematic depth of field, 16:9.
- **Ambient audio cue:** server room fan drone, subtle data-tick clicks.
- **Assets:** `voice/brief-bank-skim.mp3`, `img/mission/bank-skim.jpg`

### Ransomware Drop (`ransomware_drop`)
- **Briefing:** "Regional hospital network, lousy backups, worse security. Drop the payload, lock what needs locking, and let me handle the ransom call. This one's going to test somebody's stomach." *(delivery note: slightly graver than usual — RELAY doesn't love this one either)*
- **Thumbnail prompt:** Hospital IT/server room corridor, fluorescent lights flickering, a wall-mounted monitor showing a red lock icon and scrolling encrypted-file list, sterile clinical color palette broken by red alert glow, tense, 16:9.
- **Ambient audio cue:** fluorescent light hum/flicker buzz, distant hospital PA murmur.
- **Assets:** `voice/brief-ransomware-drop.mp3`, `img/mission/ransomware-drop.jpg`

### Dark Web Contract (`dark_web`)
- **Briefing:** "Anonymous buyer, anonymous drop point, credentials nobody asks where you got. Deliver clean, get paid in something that doesn't trace. Standard dead-drop rules apply — don't be curious about the client."
- **Thumbnail prompt:** Onion-routing network visualization, layered glowing concentric nodes in purple/violet on black, a single highlighted "dead drop" node pulsing, abstract data-art style, 16:9.
- **Ambient audio cue:** modem-era data static, sparse and irregular.
- **Assets:** `voice/brief-dark-web.mp3`, `img/mission/dark-web.jpg`

### Crypto Heist (`crypto_heist`)
- **Briefing:** "Found a race condition in a decentralized exchange's contract — window's maybe ninety seconds before someone patches it. Drain the hot wallet, get out before the block confirms. Small window, big payday." *(delivery note: faster pace, real urgency)*
- **Thumbnail prompt:** Stylized glowing wallet/vault icon cracking open with digital coin particles spilling out, countdown-timer HUD overlay, orange/gold crypto-branding-adjacent glow on black, high energy, 16:9.
- **Ambient audio cue:** rising digital tension pulse, subtle countdown tick.
- **Assets:** `voice/brief-crypto-heist.mp3`, `img/mission/crypto-heist.jpg`

---

## Tier 3 — Mid (2–3 agents, 9–12h, item floor rises to Operative)

### Telecom Tap (`telecom_tap`)
- **Briefing:** "We're splicing into backbone fibre between two national exchanges. This is real infrastructure, real stakes — carrier-grade security on the other end. I need a full team on this, not a solo run."
- **Thumbnail prompt:** Underground fiber-optic cable duct, technician gloved hands (cropped, faceless) splicing a glowing cable junction, sparks of light traveling down fiber strands, industrial-thriller lighting, teal accent glow, 16:9.
- **Ambient audio cue:** low industrial hum, dripping water echo, distant machinery.
- **Assets:** `voice/brief-telecom-tap.mp3`, `img/mission/telecom-tap.jpg`

### Supply Chain Inject (`supply_chain`)
- **Briefing:** "A popular npm package, millions of downloads, and a CI/CD pipeline held together with an expired API key. Slip a backdoor into the next release and half the internet ships it for us. Elegant, if it works."
- **Thumbnail prompt:** Abstract dependency-graph network diagram, one node glowing red/infected spreading outward through connected nodes, dark terminal-green background, code-rain texture in the negative space, 16:9.
- **Ambient audio cue:** rapid quiet keyboard typing, terminal beep accents.
- **Assets:** `voice/brief-supply-chain.mp3`, `img/mission/supply-chain.jpg`

### Military Intel Leak (`mil_intel`)
- **Briefing:** "Defense subcontractor, procurement documents, the kind of paperwork that tells you what the government's buying before anyone else knows. High value, high heat. Move fast, leave nothing behind."
- **Thumbnail prompt:** Redacted document close-up with black bar censoring, a classified stamp in red, document resting on a dark tactical table beside a laptop's glow, shallow depth of field, dossier photography style, 16:9.
- **Ambient audio cue:** paper shuffle, distant HVAC, single clock tick.
- **Assets:** `voice/brief-mil-intel.mp3`, `img/mission/mil-intel.jpg`

### Government Heist (`gov_heist`)
- **Briefing:** "A federal server farm, classified documents, and a security team that actually knows what they're doing. This is the real thing now. I don't send a squad in light on this one."
- **Thumbnail prompt:** Massive government data-center hall at night, endless rows of server racks with status LEDs, a single security camera glowing red in the foreground, cold institutional lighting, wide symmetrical composition, 16:9.
- **Ambient audio cue:** deep server-farm cooling roar, distant footsteps/echo.
- **Assets:** `voice/brief-gov-heist.mp3`, `img/mission/gov-heist.jpg`

---

## Tier 4 — Late mid (2–4 agents, 14–18h, item floor rises to Specialist)

### AI Model Theft (`ai_theft`)
- **Briefing:** "Two hundred gigs of proprietary model weights sitting in a misconfigured storage bucket at a company that should know better. Whoever trained that model spent millions. We take it for the price of a data transfer."
- **Thumbnail prompt:** Abstract neural network visualization, glowing interconnected nodes forming a brain-like structure, a "download" progress stream siphoning data out of it into darkness, violet/electric-blue palette, high-tech, 16:9.
- **Ambient audio cue:** low synth drone, data-transfer whoosh loops.
- **Assets:** `voice/brief-ai-theft.mp3`, `img/mission/ai-theft.jpg`

### Central Bank Tap (`central_bank`)
- **Briefing:** "Ten hours sitting quietly on SWIFT traffic out of a central bank. No smash and grab here — just patience, and the kind of intelligence that's worth more than the cash we'll skim off it." *(delivery note: slower, patient pacing)*
- **Thumbnail prompt:** Grand neoclassical central-bank building exterior at night, illuminated columns, a single lit high-floor window, ominous scale, desaturated cold palette with one warm window glow, 16:9.
- **Ambient audio cue:** distant city night ambience, slow ticking clock.
- **Assets:** `voice/brief-central-bank.mp3`, `img/mission/central-bank.jpg`

### Black Site Raid (`black_site`)
- **Briefing:** "There's a facility that doesn't officially exist, running AI research that officially doesn't happen either. We're going in anyway. If this goes sideways, nobody's coming to explain it to the press." *(delivery note: grim, no dark humor here)*
- **Thumbnail prompt:** Unmarked concrete bunker facility entrance in a desert at night, floodlights, chain-link fence, a single unmarked black vehicle parked outside, ominous wide shot, desaturated with cold spotlight highlights, 16:9.
- **Ambient audio cue:** desert wind, distant generator hum, occasional metallic clank.
- **Assets:** `voice/brief-black-site.mp3`, `img/mission/black-site.jpg`

---

## Tier 5 — Endgame (3–4 agents, 22–56h, item floor rises to Elite)

### NSA Breach (`nsa_breach`)
- **Briefing:** "Fort Meade. I'm going to say that again so it sinks in — Fort Meade. We're not hacking a company anymore, we're hacking the people who taught everyone else how to hack. If your squad isn't ready, don't send them." *(delivery note: weight, a beat of hesitation before "Fort Meade" repeats)*
- **Thumbnail prompt:** Imposing black-glass government intelligence campus at dawn, satellite dishes and antenna arrays on the roofline, fog rolling across a manicured lawn, epic wide establishing shot, cold blue dawn light, 16:9.
- **Ambient audio cue:** low ominous drone, distant electronic warble.
- **Assets:** `voice/brief-nsa-breach.mp3`, `img/mission/nsa-breach.jpg`

### Ghost Protocol (`ghost_protocol`)
- **Briefing:** "Sovereign-level cyber fortress — that's diplomatic language for 'a nation-state built this to be unbreakable.' Ghost Protocol means exactly what it sounds like: you're not there, you were never there, and if this goes wrong, I never heard of you."
- **Thumbnail prompt:** Vast underground data fortress interior, cathedral-scale server architecture bathed in cold cyan light, tiny human silhouette for scale far below, awe-inspiring and intimidating, symmetrical, 16:9.
- **Ambient audio cue:** cavernous reverb hum, single distant alarm-adjacent tone (non-repeating).
- **Assets:** `voice/brief-ghost-protocol.mp3`, `img/mission/ghost-protocol.jpg`

### Quantum Heist (`quantum_heist`)
- **Briefing:** "Somebody's quantum processor, hijacked for about six hours, cracking encryption that's supposed to be unbreakable for the next fifty years. We might be looking at the last heist of its kind before this stuff becomes standard. Make it count."
- **Thumbnail prompt:** A glowing cryogenic quantum-computing chandelier rig lit from within with electric blue/violet light, clean-room environment, condensation mist, otherworldly and beautiful, macro-lens cinematic shot, 16:9.
- **Ambient audio cue:** high-frequency crystalline hum, faint cryo-cooling hiss.
- **Assets:** `voice/brief-quantum-heist.mp3`, `img/mission/quantum-heist.jpg`

### Project Zero (`project_zero`) — mythic-tier, requires full squad of 4
- **Briefing:** "Project Zero. I've been doing this a long time, and I've never sent a full squad after something like this — a nation-state AI system, zero-day access, persistent. Whatever happens after tonight, the board looks different. Everyone goes. No exceptions." *(delivery note: the one moment RELAY sounds genuinely affected — slow down on the last two sentences)*
- **Thumbnail prompt:** A colossal glowing red "0-day" digital eye/sigil forming out of converging data-streams above a dark city skyline silhouette, apocalyptic-epic scale, dominant red/black palette breaking from the game's usual cyan, signaling "this one is different," 16:9.
- **Ambient audio cue:** deep sub-bass swell, building tension, no percussion — dread rather than action.
- **Assets:** `voice/brief-project-zero.mp3`, `img/mission/project-zero.jpg`

---

## Reused end-of-briefing lines (not per-mission — see `voice-lines.md` for full list)

After any briefing finishes and the squad-select panel becomes interactive,
one short generic RELAY line plays once per session (not every time, to
avoid fatigue): *"Your call, Handler. Pick your people."* This is a single
shared asset (`voice/brief-outro-generic.mp3`), not duplicated per mission.
