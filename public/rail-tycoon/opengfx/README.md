# OpenGFX graphics for Rail Tycoon

The files in this directory (`atlas.png`, `mask.png`, `atlas.json`) are graphics from
[OpenGFX](https://github.com/OpenTTD/OpenGFX), the free base graphics set for OpenTTD, by the OpenGFX team.

## License

These files are licensed under the GNU General Public License version 2 (GPL-2.0); the
full text is in `COPYING`, taken from OpenGFX. The rest of Polynux is MIT licensed; the
GPL covers only the files in this directory, the script that produces them, and the
derived files listed below.

## Derived files

`public/images/games/rail-tycoon.jpg`, the game's cover image, is drawn from `atlas.png` by
`scripts/rail-tycoon/cover-image.ts` and is GPL-2.0 as well.

## Modification notice

These files are modified from OpenGFX: sprites were cut from its 8-bit PNGs using its own
pnml sprite definitions, recombined (grounds and buildings composited, station and depot
parts placed in their tile, water frames made by rotating the water palette colours) and
converted to RGBA, with the company-colour pixels written to `mask.png`, by
`scripts/rail-tycoon/extract-opengfx.ts`.

Corresponding source: that script, in this repository, together with OpenGFX at
commit `bdea55136ab72c9acd69c8fc761bd8088398bef1` (committed 2026-10-24T15:43:50Z) from https://github.com/OpenTTD/OpenGFX.
Run `bun scripts/rail-tycoon/extract-opengfx.ts` to rebuild these files; the same commit gives
byte-identical output.

## OpenGFX credits

From the OpenGFX README:

OpenGFX is created by the following people (in reverse alphabetical order):

| Name              | Realname              |
| ----------------- | --------------------- |
| Zuu               | Leif Linse            |
| Zephyris          | Richard Wheeler       |
| Varivar           | N/A                   |
| V453000           | Vaclav Benc           |
| uzurpator         | N/A                   |
| supermop          | N/A                   |
| Spaz O Mataz      | N/A                   |
| Soeb              | Stanislaw Gackowski   |
| Snail             | Jacopo Coletto        |
| skidd13           | Benedikt Brüggemeier  |
| Rubidium          | Remko Bijker          |
| Roujin            | Manuel Wolf           |
| Red*Star          | David Krebs           |
| Raumkraut         | Mel Collins           |
| Purno             | Mark Leppen           |
| planetmaker       | Ingo von Borstel      |
| PikkaBird         | David Dallaston       |
| PaulC             | Paul Charlesworth     |
| orudge            | Owen Rudge            |
| oberheumer        | N/A                   |
| northstar2        | N/A                   |
| Mr. X             | N/A                   |
| mph               | Matthew Haines        |
| molace            | Zoltán Molnár         |
| michi_cc          | Michael Lutz          |
| mb                | Michael Blunck        |
| mart3p            | N/A                   |
| LordAzamath       | Johannes Maids Aasmäe |
| lead@inbox        | Serge Saphronov       |
| Lawton27          | Jack Lawton           |
| Jonha             | N/A                   |
| Irwe              | Alexander Irwe        |
| Gwyd              | N/A                   |
| George            | N/A                   |
| Gen.Sniper        | N/A                   |
| frosch            | Christoph Elsenhans   |
| Froix             | N/A                   |
| Foobar            | Jasper Vries          |
| erikjanp          | N/A                   |
| EdorFaus          | Frode Austvik         |
| drginaldee        | N/A                   |
| DJ Nekkid         | Thomas Mjelva         |
| DanMacK           | Dan MacKellar         |
| buttercup         | N/A                   |
| bubersson         | Petr Mikota           |
| Born Acorn        | Chris Jones           |
| Brumi             | N/A                   |
| Bilbo             | N/A                   |
| BenK              | N/A                   |
| Ben_Robbins_      | Ben Robbins           |
| athanasios        | Athanasios Palaiologos|
| andythenorth      | Andrew Parkhouse      |
| AndersI           | Anders Isaksson       |
| Ammler            | Marcel Gmür           |
| 2006TTD           | Anthony Lam           |

- The monospaced characters are generated from the font Liberation Mono: https://www.redhat.com/promo/fonts/ created by Pravin Satpute and Caius Chance, released under GPL v2.
