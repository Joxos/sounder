/** Pitch/time unit conversions and note naming. */

export const NOTE_NAMES = [
	'C',
	'C♯',
	'D',
	'D♯',
	'E',
	'F',
	'F♯',
	'G',
	'G♯',
	'A',
	'A♯',
	'B'
] as const;

/** Slider ranges. Key is deliberately capped at an octave; speed follows the genre norms. */
export const SEMITONE_MIN = -12;
export const SEMITONE_MAX = 12;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;

export const semitonesToRatio = (semitones: number): number => Math.pow(2, semitones / 12);
export const ratioToSemitones = (ratio: number): number => 12 * Math.log2(ratio);
export const speedToTimeRatio = (speed: number): number => 1 / speed;

/** Semitones implied by a speed change when pitch is *not* compensated (the "vinyl" behaviour). */
export const speedToImpliedSemitones = (speed: number): number => 12 * Math.log2(speed);

/** Format a semitone delta as e.g. "+3" / "-5" / "0". */
export function formatSemitones(semitones: number): string {
	const rounded = Math.round(semitones);
	if (rounded === 0) return '0';
	return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** Format a speed multiplier as a percentage, e.g. 0.85 -> "85%". */
export function formatSpeed(speed: number): string {
	return `${Math.round(speed * 100)}%`;
}

/** How a given pitch shift is likely to sound, used for the quality bands on the slider. */
export function pitchQualityBand(semitones: number): string {
	const n = Math.abs(semitones);
	if (n <= 4) return '干净';
	if (n <= 6) return '有味道';
	return '风格化';
}

/** Human-readable note for a semitone offset from C, e.g. +3 -> "D". */
export function offsetToNoteName(semitones: number): string {
	const n = ((Math.round(semitones) % 12) + 12) % 12;
	return NOTE_NAMES[n];
}
