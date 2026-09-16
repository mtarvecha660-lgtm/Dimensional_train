# THE DIMENSIONAL TRAIN

Prepared for Moksh Tarvecha.

A lightweight, static-hostable browser game MVP built with vanilla HTML/CSS/JavaScript + Canvas. No backend, no paid APIs, and no runtime services.

## MVP Overview

You live in a train safe zone and run timed expeditions into a seeded overgrown forest. Gather resources, avoid/fight Time Slimes, recover time with apples, and physically return to the train before departure.

Core loop implemented:
1. Spawn in the train safe zone
2. Interact at train door (`E`) to start expedition (45s timer)
3. Gather resources with tools and fight slimes
4. Return physically to train safe zone and extract
5. Craft/upgrade tools at workbench
6. Purchase train floor expansion
7. Start next expedition with a new deterministic seed

## Features

- Main menu:
  - START GAME
  - CONTINUE
  - SETTINGS
  - HOW TO PLAY
  - RESET SAVE
  - Footer: `Prepared for Moksh Tarvecha`
- Train safe zone world area (spawn, workbench, storage, door, expansion marker)
- Controls:
  - Movement: WASD / Arrow keys
  - Aim: Mouse
  - Left click: attack/use equipped tool
  - `E`: interact
  - `1/2/3`: Axe/Pickaxe/Sword
  - `ESC`: pause
  - `F1`: debug panel
- Smooth movement with acceleration/deceleration, collision, and camera follow
- Tools and gathering:
  - Axe: trees + bushes
  - Pickaxe: rocks
  - Sword: slimes
- Inventory capacity (20 slots total), with centralized update flow
- Seeded procedural forest per expedition with deterministic seed display
- 45s readable expedition timer, 10s + 5s urgency tiers
- Time Slimes with IDLE/CHASE/ATTACK/COOLDOWN behavior
- Slime hit effect: ~3 seconds stolen, knockback, flash, floating text
- Apples recover +3 seconds (capped at 45)
- Time streak bonus improves gathering tempo, resets on time damage
- Extraction success/failure:
  - Success in safe zone after leaving train secures run
  - Failure at timer zero outside train loses 50% of unrefined run gains
- Workbench crafting/upgrade recipes:
  - Axe = Wood + Fiber
  - Pickaxe = Wood + Stone
  - Sword = Stone + Wood
- Physical train expansion purchase (Wood + Stone) with walkable area expansion
- Save/load/reset using localStorage
- Pause and settings overlay (mute, volume, fullscreen)
- Debug panel (`F1`): resources/time/slimes/seed/regen/expand/reset/FPS toggle and telemetry
- Generated Web Audio SFX (degrades gracefully if blocked)
- Pooled particles/floating texts to avoid unbounded effect churn

## Project Structure

- `/index.html` - game shell and overlays
- `/styles.css` - responsive pixel-art-inspired UI + canvas scaling
- `/src/core.js` - deterministic pure helpers (RNG, inventory, generation, loss rules)
- `/src/main.js` - game systems and rendering loop
- `/tests/core.test.js` - deterministic smoke tests
- `/.github/workflows/pages.yml` - optional GitHub Pages deployment workflow

## Run Locally

Option A: open `index.html` directly in a browser.

Option B (recommended local server):

```bash
npm install
npm run start
# open http://localhost:8080
```

## Test

```bash
npm test
```

## Deploy to GitHub Pages

1. In repo settings, enable GitHub Pages source: **GitHub Actions**.
2. Merge to `main` (or run workflow manually).
3. Workflow `Deploy static game to Pages` uploads and deploys the static root.

All paths are relative and compatible with repository-subpath hosting.

## Performance Notes

- Single canvas loop with lightweight entity updates
- Basic collision and AI suitable for low-end hardware
- Effect pools for frequently spawned particles/text
- No external image/audio assets required

## Current MVP Limitations

- Combat/gathering effects are intentionally lightweight
- Single biome type for expeditions (seeded layout variance)
- No multiplayer, backend economy, or cloud save

## Roadmap Ideas

- More enemy types and dimensional events
- Additional train rooms and upgrades
- Tool-specific skill trees
- More biomes and rare timed encounters

## Credits

Designed and implemented as a vanilla JS Canvas MVP in this repository.
