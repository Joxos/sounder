/**
 * In-browser self-test for the DSP and I/O assumptions this app depends on.
 *
 * These are the things that cannot be checked by the type system and that a
 * headless Node run cannot cover, because Signalsmith Stretch is an
 * AudioWorklet and only exists inside a real browser:
 *
 *  1. `decodeFile` (mediabunny) decodes a real file through Vite.
 *  2. The peak pyramid matches the source signal.
 *  3. Signalsmith Stretch bundles, instantiates, and renders.
 *  4. Pitch and time are genuinely independent, and `schedule({outputTime})`
 *     is the field the worklet actually reads.
 *
 * `runSelfTest()` is pure and safe to call from a devtools console.
 */

import { decodeFile } from './decode';
import { buildPeakPyramid, pickLevel } from './peaks';
import { encodeWav } from './wav';
import SignalsmithStretch from 'signalsmith-stretch';

export interface Check {
	name: string;
	pass: boolean;
	detail: string;
}

/**
 * Pitch by normalised autocorrelation with parabolic interpolation.
 *
 * Zero-crossing counting is far too fragile here: the worklet's leading
 * transient and any harmonic content corrupt it badly.
 */
export function measurePitch(
	data: Float32Array,
	sampleRate: number,
	start: number,
	length: number
): number {
	const n = Math.min(length, 16384);
	if (n < 1024) return 0;

	// Pick the loudest 16384-sample window inside [start, start+length).
	let bestEnergy = -1;
	let bestOffset = start;
	const step = 1024;
	for (let s = start; s + n <= start + length; s += step) {
		let energy = 0;
		for (let i = s; i < s + n; i++) energy += data[i] * data[i];
		if (energy > bestEnergy) {
			bestEnergy = energy;
			bestOffset = s;
		}
	}

	// Mean-remove into a scratch buffer.
	const buf = new Float32Array(n);
	let mean = 0;
	for (let i = 0; i < n; i++) mean += data[bestOffset + i];
	mean /= n;
	for (let i = 0; i < n; i++) buf[i] = data[bestOffset + i] - mean;

	const minLag = Math.floor(sampleRate / 1000); // 1000 Hz
	const maxLag = Math.min(n - 1, Math.floor(sampleRate / 60)); // 60 Hz

	// Proper normalised cross-correlation. Dividing only by the leading
	// window's energy biases the peak toward long lags, which reads as a
	// wildly subsonic pitch.
	const correlation = (lag: number) => {
		const count = n - lag;
		let num = 0;
		let energyA = 0;
		let energyB = 0;
		for (let i = 0; i < count; i++) {
			const a = buf[i];
			const b = buf[i + lag];
			num += a * b;
			energyA += a * a;
			energyB += b * b;
		}
		const den = Math.sqrt(energyA * energyB);
		return den > 0 ? num / den : 0;
	};

	let bestLag = -1;
	let bestScore = 0;
	const scores = new Float64Array(maxLag + 1);
	for (let lag = minLag; lag <= maxLag; lag++) {
		const score = correlation(lag);
		scores[lag] = score;
		if (score > bestScore) {
			bestScore = score;
			bestLag = lag;
		}
	}
	if (bestLag <= 0) return 0;

	// A pure tone is perfectly periodic, so every integer multiple of its
	// period correlates just as well as the period itself. Taking the global
	// maximum lands on a random multiple and reads as a subsonic pitch.
	// Take the *earliest strong local maximum* instead.
	let chosen = bestLag;
	for (let lag = minLag + 1; lag < bestLag; lag++) {
		const isLocalMax = scores[lag] > scores[lag - 1] && scores[lag] >= scores[lag + 1];
		if (isLocalMax && scores[lag] >= bestScore * 0.9) {
			chosen = lag;
			break;
		}
	}
	bestLag = chosen;

	// Parabolic refinement around the peak.
	const y0 = scores[Math.max(minLag, bestLag - 1)];
	const y1 = scores[bestLag];
	const y2 = scores[Math.min(maxLag, bestLag + 1)];
	const denom = y0 - 2 * y1 + y2;
	const shift = denom !== 0 && y0 > y1 && y1 > y2 ? (0.5 * (y0 - y2)) / denom : 0;

	return sampleRate / (bestLag + shift);
}

function tone(seconds: number, sampleRate: number, hz: number): Float32Array {
	const frames = Math.round(seconds * sampleRate);
	const out = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		// Fade the ends so the time-stretch has clean boundaries to work with.
		const fade = Math.min(1, i / (sampleRate * 0.05), (frames - i) / (sampleRate * 0.05));
		out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.4 * fade;
	}
	return out;
}

async function renderCase(
	channels: Float32Array<ArrayBuffer>[],
	sampleRate: number,
	seconds: number,
	opts: { rate: number; semitones: number; formantCompensation?: boolean }
): Promise<{ duration: number; pitch: number }> {
	// Generous tail so the node's internal latency does not truncate the render.
	const expected = seconds / opts.rate;
	const frames = Math.ceil((expected + 3) * sampleRate);
	const ctx = new OfflineAudioContext(channels.length, frames, sampleRate);

	const node = await SignalsmithStretch(ctx, {
		// Must be 1: with 0 the processor's inactive branch dereferences
		// `inputs[c % inputs.length]` and throws.
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [channels.length]
	});
	node.connect(ctx.destination);
	await node.addBuffers(channels);

	// `start()` with no args anchors at input 0, active, with the current rate.
	await node.start();
	if (opts.rate !== 1 || opts.semitones !== 0) {
		await node.schedule({
			outputTime: 0,
			input: 0,
			active: true,
			rate: opts.rate,
			semitones: opts.semitones,
			formantCompensation: opts.formantCompensation ?? false
		});
	}

	const rendered = await ctx.startRendering();
	const data = rendered.getChannelData(0);

	// Output duration: the last sample above the noise floor anywhere in the
	// render. The whole buffer must be scanned — a mid-window scan silently
	// caps the measurement at the window edge.
	const threshold = 0.01;
	let lastLoud = data.length - 1;
	while (lastLoud > 0 && Math.abs(data[lastLoud]) < threshold) lastLoud--;

	// Pitch: from a window safely inside the audible region.
	const pitchStart = Math.floor(frames * 0.2);
	const pitchLength = Math.floor(frames * 0.3);

	return {
		duration: lastLoud / sampleRate,
		pitch: measurePitch(data, sampleRate, pitchStart, pitchLength)
	};
}

export async function runSelfTest(): Promise<Check[]> {
	const checks: Check[] = [];
	const sampleRate = 44100;
	const seconds = 8;
	const baseHz = 440;

	// ---- 1. decode path -------------------------------------------------
	let channels: Float32Array<ArrayBuffer>[] = [];
	try {
		const wav = encodeWav([tone(seconds, sampleRate, baseHz)], sampleRate, 16);
		const file = new File([wav], 'selftest.wav', { type: 'audio/wav' });
		const decoded = await decodeFile(file);
		channels = decoded.channels;
		const ok =
			decoded.sampleRate === sampleRate &&
			decoded.channels.length === 1 &&
			Math.abs(decoded.duration - seconds) < 0.1;
		checks.push({
			name: 'decode: wav via mediabunny',
			pass: ok,
			detail: `sr=${decoded.sampleRate} ch=${decoded.channels.length} dur=${decoded.duration.toFixed(3)}s`
		});
	} catch (error) {
		checks.push({
			name: 'decode: wav via mediabunny',
			pass: false,
			detail: error instanceof Error ? error.message : String(error)
		});
		return checks;
	}

	// ---- 2. peak pyramid ------------------------------------------------
	try {
		const pyramid = await buildPeakPyramid(
			channels.map((c) => new Float32Array(c)),
			sampleRate
		);
		const level = pickLevel(pyramid, 900);
		// The test tone peaks at 0.4 amplitude, which quantises to 0.4 * 127 = 50.8.
		let maxAbs = 0;
		if (level) {
			for (const v of level.minMax) maxAbs = Math.max(maxAbs, Math.abs(v));
		}
		checks.push({
			name: 'peaks: pyramid levels + amplitude',
			pass: pyramid.levels.length >= 4 && maxAbs >= 45 && maxAbs <= 60,
			detail: `levels=${pyramid.levels.length} maxAbs=${maxAbs} (expect ~51)`
		});
	} catch (error) {
		checks.push({
			name: 'peaks: pyramid levels + amplitude',
			pass: false,
			detail: error instanceof Error ? error.message : String(error)
		});
	}

	// ---- 3 & 4. engine behaviour ---------------------------------------
	const cases: Array<{ label: string; rate: number; semitones: number; wantPitch: number; wantDuration: number }> = [
		{ label: 'identity', rate: 1, semitones: 0, wantPitch: 0, wantDuration: seconds },
		{ label: 'speed 80%', rate: 0.8, semitones: 0, wantPitch: 0, wantDuration: seconds / 0.8 },
		{ label: 'speed 125%', rate: 1.25, semitones: 0, wantPitch: 0, wantDuration: seconds / 1.25 },
		{ label: '+7 semitones', rate: 1, semitones: 7, wantPitch: 7, wantDuration: seconds },
		{ label: '-5 semitones', rate: 1, semitones: -5, wantPitch: -5, wantDuration: seconds },
		{ label: '-3 st @ 85%', rate: 0.85, semitones: -3, wantPitch: -3, wantDuration: seconds / 0.85 }
	];

	for (const testCase of cases) {
		try {
			const result = await renderCase(channels, sampleRate, seconds, testCase);
			const gotSemitones = 12 * Math.log2(result.pitch / baseHz);
			const pitchOk = Math.abs(gotSemitones - testCase.wantPitch) < 0.6;
			// Allow a generous slack for the node's internal latency/flush.
			const durationOk =
				Math.abs(result.duration - testCase.wantDuration) < Math.max(0.6, seconds * 0.12);
			checks.push({
				name: `engine: ${testCase.label}`,
				pass: pitchOk && durationOk,
				detail:
					`pitch ${gotSemitones >= 0 ? '+' : ''}${gotSemitones.toFixed(2)}st ` +
					`(want ${testCase.wantPitch}), dur ${result.duration.toFixed(2)}s (want ${testCase.wantDuration.toFixed(2)}s)`
			});
		} catch (error) {
			checks.push({
				name: `engine: ${testCase.label}`,
				pass: false,
				detail: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return checks;
}
