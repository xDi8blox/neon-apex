import { CONTROL } from './track';

export interface TrackDef {
  id: string; name: string; subtitle: string; tod: string;
  control: [number, number][]; scale: number;
  grip: number;              // tire grip multiplier (ash storm < 1)
  exposure: number; envIntensity: number;
  fog: number; fogNear: number; fogFar: number;
  sky: { top: number; mid: number; horizon: number; sun: [number, number, number]; sunColor: number; sunSize: number; clouds: number; stars: number };
  sunColor: number; sunIntensity: number; hemi: number; hemiSky: number; hemiGround: number;
  wet: boolean; rain: boolean; night: boolean;   // rain = ash storm (falling ash, wind, lower grip)
  lava: number; lavaColor: number; terrain: number; // lava level (higher = more lava), terrain relief
  rock: number; ashRock: number; scorch: number; // terrain vertex palette: base rock, high slopes, near-lava
  braziers: number; spires: number; trees: number; volcanoes: number; ash: number; heat: number;
  accent: string;            // UI accent color
}

export const TRACKS: TrackDef[] = [
  {
    id: 'sunset', name: 'Lava Fields', subtitle: 'Dying red sun · rivers of fire', tod: 'DUSK',
    control: CONTROL, scale: 1.4, grip: 1,
    exposure: 0.6, envIntensity: 0.7, fog: 0x2a0a06, fogNear: 420, fogFar: 2600,
    sky: { top: 0x1a0306, mid: 0x7a1608, horizon: 0xe0501a, sun: [0.55, 0.12, -0.83], sunColor: 0xffa040, sunSize: 0.06, clouds: 0.75, stars: 0 },
    sunColor: 0xffa070, sunIntensity: 2.6, hemi: 0.32, hemiSky: 0x9a5038, hemiGround: 0x5a1404,
    wet: false, rain: false, night: false, lava: 0.3, lavaColor: 0xff4a08, terrain: 1, rock: 0x17100e, ashRock: 0x3a2a24, scorch: 0x4a1004,
    braziers: 1, spires: 0.3, trees: 0.8, volcanoes: 3, ash: 0.35, heat: 1, accent: '#ff5a1a',
  },
  {
    id: 'harbour', name: 'Bone Cathedral', subtitle: 'Blood moon · slick ossuary streets', tod: 'NIGHT',
    control: [[0, 0], [0, -170], [25, -215], [90, -225], [210, -225], [255, -200], [262, -150], [228, -110], [238, -62], [305, -45], [345, 0], [340, 70], [285, 105], [200, 105], [150, 135], [140, 195], [95, 240], [15, 240], [-28, 195], [-25, 100]],
    scale: 1.3, grip: 0.95,
    exposure: 0.7, envIntensity: 0.55, fog: 0x0a0614, fogNear: 260, fogFar: 1700,
    sky: { top: 0x030108, mid: 0x120a26, horizon: 0x2c0c34, sun: [-0.35, 0.42, -0.84], sunColor: 0xff3020, sunSize: 0.035, clouds: 0.45, stars: 1 },
    sunColor: 0xc0b8e8, sunIntensity: 1.1, hemi: 0.45, hemiSky: 0x6a64a8, hemiGround: 0x2a0a10,
    wet: true, rain: false, night: true, lava: -0.15, lavaColor: 0xd8102a, terrain: 0.8, rock: 0x12101a, ashRock: 0x34303e, scorch: 0x3a0612,
    braziers: 1.6, spires: 1.6, trees: 0.35, volcanoes: 1, ash: 0.25, heat: 0.4, accent: '#e8233a',
  },
  {
    id: 'highland', name: 'Ashen Storm', subtitle: 'Choking ash · howling wind', tod: 'ASHFALL',
    control: [[0, 0], [0, -200], [40, -300], [140, -345], [260, -325], [335, -250], [325, -160], [255, -110], [245, -40], [305, 20], [325, 110], [275, 195], [170, 215], [95, 175], [65, 95], [-10, 60]],
    scale: 1.3, grip: 0.86,
    exposure: 0.72, envIntensity: 0.75, fog: 0x4a4744, fogNear: 140, fogFar: 1100,
    sky: { top: 0x1e1d1c, mid: 0x46423e, horizon: 0x7a6656, sun: [0.2, 0.3, 0.93], sunColor: 0xff9050, sunSize: 0.0, clouds: 1, stars: 0 },
    sunColor: 0xd8d2ca, sunIntensity: 1.5, hemi: 0.55, hemiSky: 0xa8a6a2, hemiGround: 0x3a3430,
    wet: false, rain: true, night: false, lava: -0.32, lavaColor: 0xff6a10, terrain: 1.4, rock: 0x2a2826, ashRock: 0x6a6662, scorch: 0x3a1a0a,
    braziers: 0.8, spires: 0.5, trees: 1.4, volcanoes: 2, ash: 1, heat: 0.5, accent: '#ffb02e',
  },
];
export const trackById = (id: string) => TRACKS.find(t => t.id === id) ?? TRACKS[0];
