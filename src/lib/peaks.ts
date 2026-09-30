import type { PeakPyramidData, PeakLevelData } from './peaks.worker';

export type { PeakPyramidData, PeakLevelData };

/**
 * Build the peak pyramid in a worker. The channel arrays are transferred, not
 * copied — callers must not touch them afterwards.
 */
export function buildPeakPyramid(
	channels: Float32Array[],
	sampleRate: number
): Promise<PeakPyramidData> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./peaks.worker.ts', import.meta.url), {
			type: 'module'
		});
		worker.onmessage = (event: MessageEvent<PeakPyramidData>) => {
			worker.terminate();
			resolve(event.data);
		};
		worker.onerror = (event) => {
			worker.terminate();
			reject(new Error(`波形计算失败: ${event.message}`));
		};
		const transfer = channels.map((c) => c.buffer as Transferable);
		worker.postMessage({ channels, sampleRate }, transfer);
	});
}

/**
 * Pick the coarsest level that still has at least one bucket per device pixel,
 * so we never draw more rectangles than the canvas can show.
 */
export function pickLevel(pyramid: PeakPyramidData, pixelWidth: number): PeakLevelData | null {
	if (pyramid.levels.length === 0) return null;
	let chosen = pyramid.levels[0];
	for (const level of pyramid.levels) {
		if (level.bucketCount <= pixelWidth) chosen = level;
		else break;
	}
	return chosen;
}
