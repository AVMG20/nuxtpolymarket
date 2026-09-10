# Polytown model workshop

Run `bun run art:town` and open http://127.0.0.1:5176/.
Use `TOWN_ART_PORT=5177 bun run art:town` if that port is occupied.

This local artifact imports the actual game models and building registry. It needs
no login or database and automatically includes every building, production tier,
and playable upgrade level (currently 18 types and 305 variants including roads).
Refresh after editing models to rebuild the browser bundle.

- Filter by building, production tier, or level range. Level 1 and maximum-only
  views give a quick overview; every-level view catches intermediate upgrade issues.
- Click a card to orbit and zoom. Previous/next and the level selector compare upgrades.
- Save PNG captures the current close-up; Export contact sheet saves all filtered
  thumbnails with building names, levels and tiers.
- Compact view makes side-by-side comparisons easier.

The workshop uses consistent studio lighting and automatically frames each asset.
It reviews geometry and materials, not the in-game camera, economy, placement, or
crowd performance. Thumbnails share one WebGL renderer and are generated progressively.
