# Credits & Third-Party Assets

The code is MIT-licensed (see `LICENSE`). Bundled third-party assets keep their own licenses, listed below.

Everything not listed here is generated procedurally at runtime and is part of this project. That covers:
- the four demon cars: bodies, horns, spikes, skull grilles, engines, rune decals and wheels
- the ember sky and lava shaders, and the obsidian terrain
- the braziers, bone, skull and horn ornaments, spires and volcanoes
- the ash, ember and fire particles, and the sigil and rune textures
- the barrier, curb and marking textures
- all music and sound effects

No 3D models, HDRIs or audio files are shipped.

| File(s) | Asset | Author | Source | License |
|---|---|---|---|---|
| `public/fonts/PirataOne-Regular.ttf` | "Pirata One" (logo, headings, buttons) | Rodrigo Fuenzalida, Nicolas Massi | [Google Fonts](https://fonts.google.com/specimen/Pirata+One) | [SIL OFL 1.1](public/fonts/OFL-PirataOne.txt) |
| `public/fonts/MetalMania-Regular.ttf` | "Metal Mania" (HUD numbers, body text) | Open Window | [Google Fonts](https://fonts.google.com/specimen/Metal+Mania) | [SIL OFL 1.1](public/fonts/OFL-MetalMania.txt) |
| `public/textures/asphalt_*.{ktx2,jpg}` | Asphalt025C (color, normal GL, roughness), tinted to basalt in-game | ambientCG (Lennart Demes) | [ambientCG](https://ambientcg.com/view?id=Asphalt025C) | [CC0 1.0](https://docs.ambientcg.com/license/) |
| `public/basis/*` | Basis Universal transcoder | Binomial LLC | three.js `examples/jsm/libs/basis` | Apache-2.0 |

The fonts are shipped unmodified, together with their OFL license texts.

The textures were re-encoded to KTX2 (Basis Universal ETC1S for color and roughness, UASTC for normals, with mipmaps) using the `basisu` CLI. JPG copies are kept as a fallback.

**Removed in the HELLDRIVE redesign:**
- the Ferrari 458 glTF model (CC BY 4.0) and its Draco decoder
- the Poly Haven HDRIs
- the ambientCG grass textures

None of these is used any more.
