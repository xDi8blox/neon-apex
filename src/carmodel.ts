import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Assets } from './assets';

export interface CarVisual {
  group: THREE.Group;
  wheels: THREE.Object3D[];          // fl, fr, rl, rr
  brakeMat: THREE.MeshStandardMaterial;
  flames: THREE.Mesh[];
  paint: THREE.MeshPhysicalMaterial;
}

/** Procedural metallic-flake normal map: random micro-normals, tiled densely over the body. */
function flakeTexture(): THREE.Texture {
  const s = 256, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const c = cv.getContext('2d')!, img = c.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = 2.5;
    const l = Math.hypot(x, y, z);
    img.data[i * 4] = (x / l * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (y / l * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = (z / l * 0.5 + 0.5) * 255; img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30);
  return t;
}

let shared: {
  flakes: THREE.Texture; chrome: THREE.MeshStandardMaterial; glass: THREE.MeshPhysicalMaterial; head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial; led: THREE.MeshStandardMaterial; tire: THREE.MeshStandardMaterial; carbon: THREE.MeshPhysicalMaterial;
  flame: THREE.ShaderMaterial; aoMat: THREE.MeshBasicMaterial; lodPrepared: boolean;
} | null = null;

export const flameUniforms = { uTime: { value: 0 } };

function getShared(assets: Assets) {
  if (shared) return shared;
  shared = {
    flakes: flakeTexture(),
    chrome: new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 1, roughness: 0.08, envMapIntensity: 1.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.55, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 4 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x400006, emissive: 0xff1428, emissiveIntensity: 1.6 }),
    led: new THREE.MeshStandardMaterial({ color: 0x402000, emissive: 0xffa21a, emissiveIntensity: 2 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92, metalness: 0 }),
    carbon: new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    // additive animated nitro flame
    flame: new THREE.ShaderMaterial({
      uniforms: flameUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float h(float n){return fract(sin(n)*43758.5453);}
        void main(){ float t=1.0-vUv.y; float flick=0.75+0.25*h(floor(uTime*40.0)+vUv.x*3.0);
          vec3 core=vec3(0.55,0.75,1.6)*3.0, outer=vec3(1.6,0.45,0.1)*2.0;
          vec3 col=mix(outer,core,smoothstep(0.35,1.0,t));
          float a=smoothstep(0.0,0.6,t)*flick; gl_FragColor=vec4(col*a,a); }`,
    }),
    aoMat: new THREE.MeshBasicMaterial({ map: assets.carAO, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true, depthWrite: false }),
    lodPrepared: false,
  };
  return shared;
}

/** Build one car instance from the shared glTF. Each car gets its own paint and brake-light material. */
export function buildCar(assets: Assets, color: number, quality: number, detailed: boolean): CarVisual {
  const S = getShared(assets);
  const src = detailed ? assets.car : assets.carLod;
  if (!detailed && !S.lodPrepared) {
    // the LOD was stripped of normals/UVs for size; rebuild crisp normals once
    src.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry = toCreasedNormals(m.geometry, THREE.MathUtils.degToRad(35)); });
    S.lodPrepared = true;
  }
  const model = src.scene.clone(true);
  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.85, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.25,
  });
  const brakeMat = S.tail.clone();
  model.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const name = (m.material as THREE.Material).name;
    const hasUv = !!m.geometry.getAttribute('uv');
    switch (name) {
      case 'Body_Color':
        if (hasUv && quality > 0) { paint.normalMap = S.flakes; paint.normalScale.set(0.12, 0.12); }
        m.material = paint; break;
      case 'metal_chrome': case 'metal_gray': m.material = S.chrome; break;
      case 'Glass_Gray': m.material = S.glass; break;
      case 'Projector_Glass': m.material = S.head; break;
      case 'Taillight_Glass': m.material = o.name === 'brakes' ? brakeMat : S.tail; break;
      case 'Turn_Signal_LED': m.material = S.led; break;
      case 'Tires': m.material = S.tire; break;
      case 'Carbon_Fiber': m.material = S.carbon; break;
    }
    m.castShadow = quality > 0; m.receiveShadow = quality > 1;
  });
  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(n => { const w = model.getObjectByName(n)!; w.rotation.order = 'YXZ'; return w; });

  const group = new THREE.Group();
  group.add(model);
  // baked contact-shadow (ambient occlusion) under the car
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4), S.aoMat);
  ao.rotation.x = -Math.PI / 2; ao.position.y = 0.02; ao.renderOrder = 2; group.add(ao);

  // nitro flames from twin exhausts
  const flames: THREE.Mesh[] = [];
  const fg = new THREE.ConeGeometry(0.11, 1.1, 10, 1, true); fg.translate(0, 0.55, 0); fg.rotateX(Math.PI / 2); // base at the nozzle, tip points +Z (backwards)
  for (const x of [-0.42, 0.42]) {
    const f = new THREE.Mesh(fg, S.flame); f.position.set(x, 0.38, 2.22); f.visible = false; f.renderOrder = 3;
    group.add(f); flames.push(f);
  }
  return { group, wheels, brakeMat, flames, paint };
}
