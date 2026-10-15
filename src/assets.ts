import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Everything loaded from /public. See CREDITS.md for sources and licenses. */
export interface Assets {
  car: GLTF;          // full-detail Draco-compressed model (player / close-ups)
  carLod: GLTF;       // simplified meshopt-compressed model (AI cars, Low quality)
  carAO: THREE.Texture;
  asphalt: PBRSet;
  grass: PBRSet;
}
export interface PBRSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; }

const BASE = import.meta.env.BASE_URL;

export async function loadAssets(renderer: THREE.WebGLRenderer, quality: number, onProgress: (f: number) => void): Promise<Assets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, loaded, total) => onProgress(loaded / total);
  const draco = new DRACOLoader(manager).setDecoderPath(`${BASE}draco/`);
  const gltf = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const ktx2 = new KTX2Loader(manager).setTranscoderPath(`${BASE}basis/`).detectSupport(renderer);
  const tex = new THREE.TextureLoader(manager);

  // KTX2 (Basis Universal: ETC1S color/roughness, UASTC normals) with JPG fallback
  const pbrTex = async (name: string, srgb: boolean): Promise<THREE.Texture> => {
    let t: THREE.Texture;
    try { t = await ktx2.loadAsync(`${BASE}textures/${name}.ktx2`); }
    catch { t = await tex.loadAsync(`${BASE}textures/${name}.jpg`); }
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  const set = async (n: string): Promise<PBRSet> => ({
    map: await pbrTex(`${n}_color`, true), normalMap: await pbrTex(`${n}_normalgl`, false), roughnessMap: await pbrTex(`${n}_roughness`, false),
  });
  // textures are transcoded one at a time (keeps the Basis worker pool small and results unambiguous)
  const textures = (async () => { const a = await set('asphalt'); const g = await set('grass'); return [a, g] as const; })();
  const [car, carLod, carAO, [asphalt, grass]] = await Promise.all([
    gltf.loadAsync(`${BASE}models/ferrari.glb`),
    gltf.loadAsync(`${BASE}models/ferrari_lod.glb`),
    tex.loadAsync(`${BASE}models/ferrari_ao.png`),
    textures,
  ]);
  draco.dispose();
  void quality;
  return { car, carLod, carAO, asphalt, grass };
}

const hdriCache = new Map<string, Promise<THREE.DataTexture>>();
/** Load (and cache) an equirect HDRI. Phones/Low get the 1k version. */
export function loadHdri(name: string, quality: number, onProgress?: (f: number) => void): Promise<THREE.DataTexture> {
  const key = `${name}_${quality > 1 ? '2k' : '1k'}`;
  let p = hdriCache.get(key);
  if (!p) {
    p = new HDRLoader().loadAsync(`${BASE}hdri/${key}.hdr`, e => { if (e.total) onProgress?.(e.loaded / e.total); }).then(t => {
      t.mapping = THREE.EquirectangularReflectionMapping; return t;
    });
    hdriCache.set(key, p);
  }
  return p;
}
