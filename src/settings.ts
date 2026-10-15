export interface Settings {
  sfx: number; music: number; camera: number; units: 'kmh' | 'mph'; tilt: boolean; layout: 'standard' | 'swapped';
  car: string; colors: Record<string, number>; laps: number; difficulty: number; opponents: number; track: string; showFps: boolean;
}
const KEY = 'neonapex.settings';
const defaults: Settings = { sfx: 0.8, music: 0.5, camera: 0, units: 'kmh', tilt: false, layout: 'standard', car: 'stradale', colors: {}, laps: 3, difficulty: 0.95, opponents: 5, track: 'sunset', showFps: true };
export const settings: Settings = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...defaults }; }
})();
export const saveSettings = () => localStorage.setItem(KEY, JSON.stringify(settings));

/** Best lap per track+car, and ghost laps for time trial. */
export const bestKey = (track: string, car: string) => `neonapex.best.${track}.${car}`;
export const ghostKey = (track: string, car: string) => `neonapex.ghost.${track}.${car}`;
export const getBest = (track: string, car: string) => Number(localStorage.getItem(bestKey(track, car))) || Infinity;
export const bestAnyCar = (track: string, cars: string[]) => Math.min(...cars.map(c => getBest(track, c)));
