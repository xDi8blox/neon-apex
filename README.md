# HELLDRIVE

**▶ [Play in your browser](https://xdi8blox.github.io/neon-apex/)**

**Race the damned through three hellscapes in demonic machines.** HELLDRIVE is an arcade circuit racer that runs entirely in the browser (Three.js, no backend). Every car, track prop, sky and sound is generated from code: horned and spiked demon cars with skull grilles and rune glow, obsidian terrain over rivers of flowing lava, burning braziers, bone gates, erupting volcanoes, falling ash, and an industrial infernal soundtrack. Under it sits a hand-written tire-model physics sim and AI rivals that follow a computed racing line.

<sub>The repository keeps its original name (`neon-apex`), and so does the URL. The game itself was rebranded from NEON APEX to HELLDRIVE.</sub>

![Lava Fields](screenshots/lava-fields.png)

| Main menu | The Forge (garage) |
|---|---|
| ![Menu](screenshots/menu.png) | ![Garage](screenshots/garage.png) |
| **Lava Fields** | **Bone Cathedral** |
| ![Lava Fields](screenshots/lava-fields.png) | ![Bone Cathedral](screenshots/bone-cathedral.png) |
| **Ashen Storm** | **Soul Burn** |
| ![Ashen Storm](screenshots/ashen-storm.png) | ![Soul Burn](screenshots/soul-burn.png) |
| **Throne of Ash (podium)** | **Mobile (iPhone landscape)** |
| ![Podium](screenshots/podium.png) | ![Mobile](screenshots/mobile.png) |

| | |
|---|---|
| ![Loading](screenshots/loading.png) | ![Modes](screenshots/modes.png) |
| ![Track select](screenshots/tracks.png) | ![Garage - Succubus](screenshots/garage-succubus.png) |
| ![Hellblast](screenshots/hellblast.png) | ![Banished](screenshots/banished.png) |
| ![Ember drift + near miss](screenshots/combo-nearmiss.png) | ![Replay](screenshots/replay.png) |
| ![Standings](screenshots/standings.png) | ![Options](screenshots/options.png) |
| ![Mobile garage](screenshots/mobile-garage.png) | ![Mobile track select](screenshots/mobile-tracks.png) |

<sub>The screenshots are captured in headless Chromium on SwiftShader (software GL) by `scripts/screens.mjs` and `npm run test:mobile`. A real GPU shows the same image and runs far faster.</sub>

## Identity

- **Logo and type.** The blackletter **Helldrive** logo is set in *Pirata One*, and the HUD numbers in *Metal Mania*. Both are SIL OFL fonts bundled locally in `public/fonts`. The logo glows with an animated ember gradient.
- **UI.**
  - Cracked-stone panels (an SVG turbulence texture with molten fissures) in a red, orange and black palette.
  - Ember and ash particles drift over every menu.
  - Screen changes use a **fire wipe** combined with a glowing **screen crack**, and screens rise out of the heat or burn away.
- **Modes.**
  - *Damned Sprint*: a quick race.
  - *Infernal Crown*: a 3-round championship.
  - *Soul Trial*: a time trial against your own **wraith** ghost.

## The demon machines (`src/carmodel.ts`)

All four cars are procedural geometry, with no external models. Each one has:
- a raked wedge body and an obsidian canopy
- tapered bone horns, iron spikes and a **skull grille** with burning eye sockets
- an **exposed engine** with a glowing core and intake stacks
- **emissive rune bands**
- spiked wheels with glowing rims
- **flame-breathing exhausts** that idle softly and roar during Soul Burn

Static parts are merged per material, so a car costs about 10 draw calls. The geometry is cached for each car, with one copy at player detail and one at AI detail.

| Car | Style | Lore |
|---|---|---|
| **Hellhound** | Balanced; ram horns, spine spikes | Forged from the ribcage of the first hound to escape the Ninth Circle. |
| **Baphomet GT** | Huge top speed; great horns frame an iron wing | The goat-king wanted a throne that could outrun prayers. |
| **Cerberus** | Launches hard and grips in ash; three skulls, bone plating, ribcage roll bar | Built to guard the gates. Ash storms only make it hungrier. |
| **Succubus** | Slides forever and drinks Soul Burn from drifts; bat-wing fins, tail spike, magenta underglow | Every slide draws a sliver of soul from the road. |

The garage (*The Forge*) shows each car's stats, lore, a hellish paint palette and a drag-to-spin turntable.

## The hellscapes (`src/scenery.ts`, `src/tracks.ts`)

**Shared by all three tracks:**
- **Sky:** a procedural ember sky shader with smoke clouds lit from below, a red sun or blood moon, and stars. The same sky is baked into PMREM, so the cars and the obsidian reflect the inferno.
- **Terrain and lava:**
  - Faceted **obsidian terrain** whose valleys fill with **flowing lava**. The lava is an emissive domain-warped fbm shader with a cooling crust and bright veins, which creates rivers and lakes wherever the rock dips.
  - The rock glows where it meets the lava.
- **Trackside:**
  - **Burning braziers** with animated fire and glow pools.
  - **Spiked iron barriers** with an ember stripe.
  - **Skull piles** on the corners and giant **horn gates** over the straights.
  - Gothic spires with burning windows, charred dead trees and obsidian shards.
  - The stands of the damned.
- **Atmosphere:**
  - **Erupting volcanoes** on the horizon that throw lava bombs.
  - **Falling ash** and **rising embers**.
  - Post-process **heat haze**.

**Each track:**
- **Lava Fields:** a dying red sun over lava seas, with lens flare and strong heat haze.
- **Bone Cathedral (night):** a blood moon, with a nave of giant **bone ribs** vaulting over the longest straight. The ossuary streets are blood-slick and get SSR reflections on High.
- **Ashen Storm:** choking ash, howling wind, heavy fog and reduced grip.

## Hellfire effects

- **Soul Burn** (formerly nitro):
  - hellfire exhaust trails
  - a red and orange grade, ember speed lines and chromatic fringe
  - a whoosh and roar
- **Hellblast:** firing Soul Burn with a full tank releases the demonic shockwave. It spawns a ring and a spinning **pentagram sigil**, sends out a fire burst and a screen ripple, and shoves nearby rivals aside.
- **Drifts:** drift sparks are **embers** and tire smoke is ash-dark. Drift combos are *Ember / Scorching / Infernal* drifts.
- **Banishing:** a takedown **banishes** the rival in fire, with a fire burst, a sigil and a car that keeps burning while it wrecks.
- **Podium:** it is now the **Throne of Ash**. It has obsidian altar steps, a horned throne, a burning floor sigil, flanking braziers and a shower of embers and ash.
- **Audio** (all procedural Web Audio):
  - *Music:* an industrial infernal soundtrack in D phrygian (Dm, E♭, B♭, C♯dim) with a distorted kick, metallic snare, anvil hits, galloping overdriven bass, a tolling bell and a choir pad.
  - *Engines:* they **growl**, using sub-harmonic AM flutter, detuned beating and a tanh drive.

## Gameplay systems (unchanged)

- **Physics:** a fixed 120 Hz bicycle-model tire sim with slip angles, a friction circle, load transfer, a 6-speed gearbox and a handbrake.
- **Racing:**
  - 0–7 AI rivals that follow a racing line, with three difficulties.
  - Lap timing, positions and records saved in `localStorage`.
  - Replay, four cameras and a gamepad.
- **Fun systems:** drift combos up to ×5, near-miss slow-mo, an unholy (perfect) start or a cursed jump start, takedowns and a finish slow-mo.
- **Mobile:**
  - Robust multi-touch controls: each finger is tracked by its identifier, with live hit-testing so sliding between ◀ and ▶ works.
  - Tilt steering and a landscape layout.
  - The Low preset is picked automatically.
- **Quality tiers:** Low, Medium and High scale:
  - pixel ratio, MSAA, shadows, GTAO and SSR
  - bloom, lens flare and shader octaves (sky, lava)
  - terrain resolution, car detail, prop densities and particle budgets

**Tests:**
- `npm run test:sim`: AI on every track × car, with no barrier contacts.
- `npm run test:touch`: multi-touch regression.
- `npm run test:mobile`
- `npm run test:flow`: menus, garage, perfect start, a 3-round championship and the time-trial ghost.

## Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Throttle | `W` / `↑` | RT |
| Brake / reverse | `S` / `↓` | LT |
| Steer | `A` `D` / `←` `→` | Left stick |
| Handbrake | `Space` | A / B |
| Soul Burn | `Shift` / `N` | X / RB |
| Skip intro | `Enter` / `Esc` | Start |
| Change camera | `C` | Y |
| Pause | `Esc` / `P` | Start |
| Mute | `M` | – |

On phones and tablets, use the on-screen buttons. TILT toggles steering by rolling the device.

## Running locally

```bash
npm install && npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

Other scripts:

```bash
npm run build      # type-check (tsc) + production build into dist/
npm run preview    # serve the production build
npm run test:sim   # headless physics/AI regression: 3 laps at 5 AI skill/nitro configs; fails on any barrier contact
npm run screenshots  # needs `npx playwright install chromium` and a running preview on :4173
```

Handy URL flags: `?quality=0|1|2` forces a graphics preset, `?gtao=0` disables ambient occlusion, and `?autopilot=1` lets the AI drive your car (used for screenshots).

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds on every push to `main` and publishes `dist/` with the official Pages actions. It sets `BASE_PATH=/<repo-name>/`, which `vite.config.ts` uses as `base`. Local builds use a relative base (`./`), so `dist/` also works from any static host. To turn it on: push the repo to GitHub, then under **Settings → Pages → Source**, choose **GitHub Actions**.

## Tech stack

- [Three.js](https://threejs.org/) r186: rendering, custom GLSL (sky, lava, hellfire), post-processing (`EffectComposer`, `UnrealBloomPass`, custom `ShaderPass`)
- TypeScript (strict) + [Vite](https://vitejs.dev/)
- Loaders: `KTX2Loader` (Basis Universal) for the road texture; everything else is procedural
- Post: `GTAOPass`, `SSRPass`, `UnrealBloomPass`, `Lensflare`, custom speed / Soul Burn / heat-haze `ShaderPass`, `OutputPass`
- Asset pipeline: Basis Universal `basisu` for KTX2
- Custom vehicle physics (no physics engine dependency: the planar tire model is both lighter and more tunable than a rigid-body engine for this game)
- Web Audio API, Canvas 2D (HUD and procedural textures), Gamepad API
- Playwright for automated screenshots

## Project structure

```
src/
  main.ts      game loop, state machine, AI controller, collisions, cameras, post-FX
  assets.ts    asset loading (KTX2 road texture, bundled fonts) with progress
  carmodel.ts  procedural demon cars (horns, spikes, skulls, engine, runes), hellfire exhausts
  car.ts       vehicle dynamics + Soul Burn
  track.ts     circuit spline, racing line, target speeds, road/curb/barrier geometry
  scenery.ts   ember sky, lava + obsidian terrain, braziers, bones, spires, volcanoes, ash
  effects.ts   skid marks, smoke/fire/embers, Soul Burn rings + sigils, ember confetti
  embers.ts    menu ember/ash overlay
  audio.ts     procedural growling engine/tire/impact audio
  music.ts     procedural industrial infernal soundtrack
  input.ts     keyboard + gamepad
  hud.ts       speedometer, minimap, timing
scripts/
  screenshots.mjs  headless capture
  sim-test.ts      headless AI lap regression
```

## Credits

Third-party assets and their licenses are listed in [CREDITS.md](CREDITS.md). They are the Pirata One and Metal Mania fonts (SIL OFL 1.1) and the ambientCG asphalt texture (CC0). Everything else, including the cars, is procedural.

## License

Code: [MIT](LICENSE) © 2026 Death. Bundled assets keep their own licenses (see CREDITS.md).

### Mobile (Low preset) per track
![Lava Fields](screenshots/mobile-lava-fields.png)
![Bone Cathedral](screenshots/mobile-bone-cathedral.png)
![Ashen Storm](screenshots/mobile-ashen-storm.png)

Regenerate with `node scripts/mobile-tracks.mjs` (iPhone 13 landscape) and `QUALITY=2 node scripts/screenshots.mjs`.
