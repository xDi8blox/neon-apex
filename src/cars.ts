import type { CarPhysics } from './car';

export type Kit = 'stock' | 'gt' | 'rally' | 'drift';
export interface CarDef {
  id: string; name: string; tagline: string; lore: string; kit: Kit; color: number;
  stats: { speed: number; accel: number; handling: number; nitro: number }; // 1..10 (display)
  phys: Partial<Pick<CarPhysics, 'engineForce' | 'drag' | 'mu' | 'cornering' | 'nitroForce' | 'stability' | 'mass'>> & { nitroRegen?: number; offroadGrip?: number; rideHeight?: number };
}

export const CARS: CarDef[] = [
  { id: 'stradale', name: 'Hellhound', tagline: 'Balanced hunter of the pit', kit: 'stock', color: 0x8a0d0d,
    lore: 'Forged from the ribcage of the first hound to escape the Ninth Circle. It still remembers the scent of every soul it dragged back.',
    stats: { speed: 7, accel: 7, handling: 7, nitro: 6 }, phys: {} },
  { id: 'gtr', name: 'Baphomet GT', tagline: 'Great horns, terrible top speed', kit: 'gt', color: 0x1b1b22,
    lore: 'The goat-king wanted a throne that could outrun prayers. Its wing is a pair of horns torn from a fallen archangel.',
    stats: { speed: 9, accel: 6, handling: 7, nitro: 8 }, phys: { drag: 0.355, engineForce: 11000, nitroForce: 7600, cornering: 100000, rideHeight: -0.03 } },
  { id: 'rally', name: 'Cerberus', tagline: 'Three skulls, launches hard, grips in ash', kit: 'rally', color: 0xb9a68a,
    lore: 'Bone-plated and triple-skulled, built to guard the gates. Ash storms that blind other drivers only make it hungrier.',
    stats: { speed: 6, accel: 9, handling: 8, nitro: 6 }, phys: { drag: 0.47, engineForce: 13600, mu: 1.62, offroadGrip: 0.9, rideHeight: 0.1 } },
  { id: 'drift', name: 'Succubus', tagline: 'Slides forever, drinks Soul Burn from drifts', kit: 'drift', color: 0x5a0f4a,
    lore: 'Sleek, cruel and seductive. Every slide draws a sliver of soul from the road, and her runes burn brighter for it.',
    stats: { speed: 7, accel: 8, handling: 6, nitro: 9 }, phys: { engineForce: 12400, stability: 0.3, nitroRegen: 2.2, nitroForce: 7000, rideHeight: -0.04 } },
];
export const carById = (id: string) => CARS.find(c => c.id === id) ?? CARS[0];

/** Apply a car definition to a physics body. `isPlayer` keeps a lighter stability assist for the human. */
export function applyCar(p: CarPhysics, def: CarDef, isPlayer: boolean) {
  const d = def.phys;
  if (d.engineForce) p.engineForce = d.engineForce;
  if (d.drag) p.drag = d.drag;
  if (d.mu) p.mu = d.mu;
  if (d.cornering) p.cornering = d.cornering;
  if (d.nitroForce) p.nitroForce = d.nitroForce;
  if (d.mass) p.mass = d.mass;
  p.nitroRegen = d.nitroRegen ?? 1;
  p.offroadGrip = d.offroadGrip ?? 0.7;
  p.stability = isPlayer ? (d.stability ?? 0.6) : 1;
}
