import { CONTROL } from './track';

export type HdriName = 'venice_sunset' | 'shanghai_bund' | 'kloofendal_overcast_puresky';

export interface TrackDef {
  id: string; name: string; subtitle: string; tod: string;
  control: [number, number][]; scale: number;
  grip: number;              // tire grip multiplier (rain < 1)
  hdri: HdriName;
  exposure: number; bgIntensity: number; envIntensity: number;
  fog: number; fogNear: number; fogFar: number;
  sunColor: number; sunIntensity: number; hemi: number;
  wet: boolean; rain: boolean; night: boolean;
  lamp: number; windows: number; neon: boolean;
  grass: number; trees: number; // grass tint, tree density multiplier
  accent: string;            // UI accent color
}

export const TRACKS: TrackDef[] = [
  {
    id: 'sunset', name: 'Sunset Circuit', subtitle: 'Golden hour · dry', tod: 'SUNSET',
    control: CONTROL, scale: 1.4, grip: 1, hdri: 'venice_sunset',
    exposure: 0.55, bgIntensity: 0.9, envIntensity: 0.9, fog: 0xb7a594, fogNear: 500, fogFar: 2600,
    sunColor: 0xffc89a, sunIntensity: 3.2, hemi: 0.25, wet: false, rain: false, night: false,
    lamp: 6, windows: 0.9, neon: false, grass: 0x9fb46a, trees: 1, accent: '#ff7a2d',
  },
  {
    id: 'harbour', name: 'Neon Harbour', subtitle: 'Night city · wet streets', tod: 'NIGHT',
    control: [[0, 0], [0, -170], [25, -215], [90, -225], [210, -225], [255, -200], [262, -150], [228, -110], [238, -62], [305, -45], [345, 0], [340, 70], [285, 105], [200, 105], [150, 135], [140, 195], [95, 240], [15, 240], [-28, 195], [-25, 100]],
    scale: 1.3, grip: 0.95, hdri: 'shanghai_bund',
    exposure: 0.5, bgIntensity: 0.3, envIntensity: 0.45, fog: 0x0b0d1c, fogNear: 300, fogFar: 1700,
    sunColor: 0x8fa6ff, sunIntensity: 0.6, hemi: 0.12, wet: true, rain: false, night: true,
    lamp: 5, windows: 1.4, neon: true, grass: 0x3a4a3a, trees: 0.45, accent: '#ff2d75',
  },
  {
    id: 'highland', name: 'Highland Storm', subtitle: 'Overcast · heavy rain', tod: 'RAIN',
    control: [[0, 0], [0, -200], [40, -300], [140, -345], [260, -325], [335, -250], [325, -160], [255, -110], [245, -40], [305, 20], [325, 110], [275, 195], [170, 215], [95, 175], [65, 95], [-10, 60]],
    scale: 1.3, grip: 0.86, hdri: 'kloofendal_overcast_puresky',
    exposure: 0.6, bgIntensity: 0.65, envIntensity: 0.85, fog: 0x8a939c, fogNear: 120, fogFar: 1100,
    sunColor: 0xdfe6ee, sunIntensity: 1.1, hemi: 0.35, wet: true, rain: true, night: false,
    lamp: 3, windows: 0.4, neon: false, grass: 0x6f8a55, trees: 1.5, accent: '#7ff6ff',
  },
];
export const trackById = (id: string) => TRACKS.find(t => t.id === id) ?? TRACKS[0];
