import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** Everything loaded from /public. See CREDITS.md for sources and licenses. */
export interface Assets {
  asphalt: PBRSet;
}
export interface PBRSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; }

const BASE = import.meta.env.BASE_URL;

export async function loadAssets(renderer: THREE.WebGLRenderer, quality: number, onProgress: (f: number) => void): Promise<Assets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, loaded, total) => onProgress(loaded / total);
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
  const fonts = Promise.all(['50px "Pirata One"', '20px "Metal Mania"'].map(f => document.fonts.load(f).catch(() => []))); // banners are drawn with the gothic font
  const [asphalt] = await Promise.all([set('asphalt'), fonts]);
  void quality;
  return { asphalt };
}
