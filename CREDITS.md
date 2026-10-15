# Credits & Third-Party Assets

The code is MIT-licensed (see `LICENSE`). Bundled third-party assets keep their own licenses, listed below.
Anything not listed here (barrier/curb/marking textures, flare sprites, metallic-flake map, scenery geometry,
nitro flame shader, all audio) is generated procedurally at runtime and is part of this project.

| File(s) | Asset | Author | Source | License |
|---|---|---|---|---|
| `public/models/ferrari.glb`, `public/models/ferrari_ao.png` | "Ferrari 458 Italia" | **vicent091036** | Sketchfab (model 57bf6cc56931426e87494f554df1dab6), redistributed in the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/models/ferrari_lod.glb` | Derivative of the above: normals/UVs stripped, simplified to ~15% with meshoptimizer, meshopt-compressed (EXT_meshopt_compression) | derived by this project | — | CC BY 4.0 (inherits) |
| `public/hdri/venice_sunset_{1k,2k}.hdr` | "Venice Sunset" HDRI | Greg Zaal | [Poly Haven](https://polyhaven.com/a/venice_sunset) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/textures/asphalt_*.{ktx2,jpg}` | Asphalt025C (color, normal GL, roughness) | ambientCG (Lennart Demes) | [ambientCG](https://ambientcg.com/view?id=Asphalt025C) | [CC0 1.0](https://docs.ambientcg.com/license/) |
| `public/textures/grass_*.{ktx2,jpg}` | Grass004 (color, normal GL, roughness) | ambientCG (Lennart Demes) | [ambientCG](https://ambientcg.com/view?id=Grass004) | [CC0 1.0](https://docs.ambientcg.com/license/) |
| `public/draco/*` | Draco glTF decoder | Google | three.js `examples/jsm/libs/draco` | Apache-2.0 |
| `public/basis/*` | Basis Universal transcoder | Binomial LLC | three.js `examples/jsm/libs/basis` | Apache-2.0 |

**Modifications:** the Ferrari is recolored per car and its materials are replaced at runtime: clearcoat car paint with a metallic-flake normal map, chrome, tinted glass, and emissive head-, tail- and brake lights. The textures were re-encoded to KTX2 (Basis Universal ETC1S for color and roughness, UASTC for normals, with mipmaps) using the `basisu` CLI (WASI build); JPG copies are kept as a fallback.

**Note on the car model:** the original Sketchfab page now reports the model as disabled. The CC BY 4.0 attribution above is the one used by three.js, which redistributes the file. If you need certainty before a commercial use, swap in a model whose license you can verify directly. `src/carmodel.ts` maps materials by name, so another glTF car only needs its material and wheel node names updated.

Sound: none. All audio is synthesized with the Web Audio API.
