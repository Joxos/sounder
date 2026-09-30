/** Named flavour presets. Values are the ones the genre-tool consensus converged on. */

export interface Preset {
	id: string;
	label: string;
	speed: number;
	semitones: number;
	hint: string;
}

export const PRESETS: Preset[] = [
	{ id: 'tiktok', label: 'TikTok Slowed', speed: 0.8, semitones: 0, hint: '80% 速度' },
	{ id: 'slowed-reverb', label: 'Slowed + Reverb', speed: 0.85, semitones: 0, hint: '85% 速度' },
	{ id: 'vaporwave', label: 'Vaporwave', speed: 0.65, semitones: -2, hint: '65% 速度 · −2 半音' },
	{ id: 'nightcore-rev', label: 'Nightcore Reverse', speed: 0.75, semitones: 0, hint: '75% 速度' },
	{ id: 'lofi', label: 'Lo-fi', speed: 0.75, semitones: -2, hint: '75% 速度 · −2 半音' },
	{ id: 'nightcore', label: 'Nightcore', speed: 1.25, semitones: 0, hint: '125% 速度' }
];

export function findPreset(speed: number, semitones: number): Preset | undefined {
	return PRESETS.find(
		(p) => Math.abs(p.speed - speed) < 0.005 && Math.abs(p.semitones - semitones) < 0.5
	);
}
