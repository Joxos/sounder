/**
 * Peak-pyramid worker.
 *
 * Computes a multi-resolution min/max envelope so the waveform can be drawn at
 * any zoom level in O(visible buckets) instead of re-slicing one giant array.
 *
 * Values are stored as interleaved Int8 (min, max) pairs scaled to ±127, which
 * costs 2 bytes per bucket — a 60-minute stereo file needs ~3.3 MB total.
 */

export interface PeakLevelData {
	samplesPerBucket: number;
	bucketCount: number;
	/** Interleaved [min, max] pairs, each -127..127. */
	minMax: Int8Array;
}

export interface PeakPyramidData {
	levels: PeakLevelData[];
	frames: number;
	sampleRate: number;
	channels: number;
	/** Mean square per 100 ms of source time; used to match loudness to the track's dynamics. */
	rmsEnvelope: Float32Array;
	/** Seconds covered by one envelope entry. */
	rmsHopSeconds: number;
}

export interface PeakRequest {
	channels: Float32Array[];
	sampleRate: number;
}

const BASE_BUCKET = 256;
const LEVEL_COUNT = 5;
const RMS_HOP_SECONDS = 0.1;

function quantize(value: number): number {
	if (value >= 0) return Math.min(127, Math.round(value * 127));
	return Math.max(-128, Math.round(value * 127));
}

function computePeaks(request: PeakRequest): PeakPyramidData {
	const { channels, sampleRate } = request;
	const frames = channels[0]?.length ?? 0;
	const levels: PeakLevelData[] = [];

	if (frames === 0 || channels.length === 0) {
		return { levels, frames: 0, sampleRate, channels: channels.length, rmsEnvelope: new Float32Array(0), rmsHopSeconds: RMS_HOP_SECONDS };
	}

	// Loudness envelope, accumulated in the same pass as the level-0 peaks.
	const hopFrames = Math.max(1, Math.round(sampleRate * RMS_HOP_SECONDS));
	const rmsEnvelope = new Float32Array(Math.ceil(frames / hopFrames));
	{
		let bucket = 0;
		let sum = 0;
		let count = 0;
		for (let i = 0; i < frames; i++) {
			for (let c = 0; c < channels.length; c++) {
				const v = channels[c][i];
				sum += v * v;
			}
			count += channels.length;
			if ((i + 1) % hopFrames === 0 || i === frames - 1) {
				rmsEnvelope[bucket++] = sum / Math.max(1, count);
				sum = 0;
				count = 0;
			}
		}
	}

	// Level 0: scan every sample. Down-mix channels by absolute peak so the
	// envelope reflects loudness regardless of channel count.
	let minMax = new Int8Array(Math.ceil(frames / BASE_BUCKET) * 2);
	for (let b = 0; b < minMax.length / 2; b++) {
		const start = b * BASE_BUCKET;
		const end = Math.min(start + BASE_BUCKET, frames);
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = start; i < end; i++) {
			for (let c = 0; c < channels.length; c++) {
				const v = channels[c][i];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
		}
		minMax[b * 2] = quantize(Number.isFinite(lo) ? lo : 0);
		minMax[b * 2 + 1] = quantize(Number.isFinite(hi) ? hi : 0);
	}
	levels.push({
		samplesPerBucket: BASE_BUCKET,
		bucketCount: minMax.length / 2,
		minMax
	});

	// Higher levels: each bucket merges 2 of the level below it.
	for (let level = 1; level < LEVEL_COUNT; level++) {
		const prev = levels[level - 1];
		if (prev.bucketCount <= 1) break;
		const count = Math.ceil(prev.bucketCount / 2);
		const next = new Int8Array(count * 2);
		for (let b = 0; b < count; b++) {
			const a0 = b * 2;
			const a1 = Math.min(a0 + 1, prev.bucketCount - 1);
			next[b * 2] = Math.min(prev.minMax[a0 * 2], prev.minMax[a1 * 2]);
			next[b * 2 + 1] = Math.max(prev.minMax[a0 * 2 + 1], prev.minMax[a1 * 2 + 1]);
		}
		levels.push({
			samplesPerBucket: prev.samplesPerBucket * 2,
			bucketCount: count,
			minMax: next
		});
	}

	return { levels, frames, sampleRate, channels: channels.length, rmsEnvelope, rmsHopSeconds: RMS_HOP_SECONDS };
}

self.onmessage = (event: MessageEvent<PeakRequest>) => {
	const result = computePeaks(event.data);
	const transfer = result.levels.map((l) => l.minMax.buffer as Transferable);
	(self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(
		result,
		transfer
	);
};
