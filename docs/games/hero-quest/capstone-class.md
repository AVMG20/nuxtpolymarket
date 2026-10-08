# The ??? capstone class — ideas (open)

**Status: undecided, in discussion (2026-10-09).** Working notes for `open-items.md` #43, which
blocks the merge into `main`. Nothing here is locked; it is the starting point for the next
session. Once a direction is chosen, the decision moves into #43 and this doc becomes its record.

## What exists today

- The Classes scene ends the masters' row in a 17th node, joined to all six masters
  (`CAPSTONE_ID` in `classes-scene.ts`): a placeholder infinity medallion, the name `???`, and the
  hint "PLAY EVERY OTHER CLASS TO UNLOCK". There is no content entry, skill or unlock rule behind it.
- The tree has 16 classes: Beginner; 3 base (Warrior, Mage, Archer); 6 elite (Barbarian, Knight,
  Wizard, Shaman, Bowman, Hunter); 6 master (Berserker, Paladin, Sorcerer, Witch Doctor, Marksman,
  Beast Master). Each node adds one skill and a kit is cumulative down its path (`kitFor`), so a
  master fights with 4 class skills. Cooldowns sit on a rank ladder by tree depth (#36).
- A never-reached class costs a class token, and each prestige grants one (#42). Reaching all 15
  other nodes takes at least 15 prestiges, which is months of play at about a week for a first
  prestige with a party of three (#22).

## The starting idea: it has every Hero ability

The fantasy is right; taken literally (all 16 class skills auto-firing at once) it breaks three things:

1. **Power.** Four times a master's ability count, all auto-firing (no manual mode exists anywhere).
   It would beat every master, and since switching back to any reached class is free, nobody would
   play anything else once they had it.
2. **Pacing.** Abilities ride on top of the tuned curve (#22); a 16-skill kit would shrink every
   wall and need its own numbers, measured on the sim.
3. **The stage.** Every damaging Hero cast plays a cinematic that tints the scene and holds the
   other units (`art-style.md` §5). Sixteen skills would keep it in cinematics nearly all the time.

## Directions that keep "every ability" and stay sound

1. **Paragon — everything, in rotation.** Owns all 16 skills, but one cast slot cycles through them
   in order. It casts about as often as a master, so its power stays master-sized while every
   class's moves show up in turn. Closest to the original idea.
2. **Polymath — pick your own kit.** Choose any 4 skills from the nodes you've reached, across
   paths (Threatening Roar + Kill Shot + Meteor Shower). No master can mix paths, so the reward is
   build-crafting. Each skill keeps its place on the cooldown ladder, so it stays fair.
3. **A signature ultimate on top.** One long-cooldown skill of its own (working name
   "Convergence"): when it fires, every master's skill fires at once as one big cinematic. The whole
   roster as a moment, not constant noise. Pairs with 1 or 2.
4. **Growth through mastery.** Its stats or its ultimate grow with each class mastered or held, so
   the unlock starts a long track rather than ending one.

**Recommended in the session: 2 + 3** — free choice of 4 skills from everything reached, plus the
Convergence ultimate. Worth striving for because it opens combinations nothing else can field; it
doesn't obsolete the other classes, because it borrows their skills instead of outclassing them;
and it stays readable on the stage. If "owns everything" should stay literal, 1 + 3 is the safer
version of that.

## Still to decide, whichever direction

- **Unlock:** does "played every other class" mean reached all 15 nodes, or held each for some time
  or number of stages?
- **Token:** bought with a class token like any new node, or free once unlocked?
- **Stats and row:** an even spread, the spread of a mastered class the player picks, or best of each?
- **Name:** candidates Paragon, Ascendant, Archon, Polymath — checked against the naming rules (no
  Champion given name or title reused). The placeholder infinity medallion suits Paragon.
- **With prestige and class switches:** whether a Polymath kit is saved per account or per Loadout,
  and what happens to it on a switch.
- **Numbers:** any new constants (the ultimate's cooldown and multiplier, mastery growth) start as
  `UNTUNED ╧` placeholders and are measured on the campaign sim.
