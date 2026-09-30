/** Minimal RIFF/WAVE writer (16- or 24-bit PCM). */

export function encodeWav(
	channels: Float32Array[],
	sampleRate: number,
	bitDepth: 16 | 24 = 16
): Blob {
	const channelCount = channels.length;
	const frames = channels[0]?.length ?? 0;
	const bytesPerSample = bitDepth / 8;
	const blockAlign = channelCount * bytesPerSample;
	const dataSize = frames * blockAlign;

	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	const writeString = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};

	writeString(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // format 1 = PCM integer
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true); // byte rate
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitDepth, true);
	writeString(36, 'data');
	view.setUint32(40, dataSize, true);

	// Full-scale positive value: 32767 for 16-bit, 8388607 for 24-bit.
	const fullScale = 2 ** (bitDepth - 1) - 1;
	let offset = 44;
	for (let i = 0; i < frames; i++) {
		for (let c = 0; c < channelCount; c++) {
			const clamped = Math.max(-1, Math.min(1, channels[c][i]));
			// Scale so that +1.0 maps to fullScale and -1.0 maps to -(fullScale + 1).
			const value = Math.round(clamped * (clamped < 0 ? fullScale + 1 : fullScale));
			if (bitDepth === 16) {
				view.setInt16(offset, value, true);
				offset += 2;
			} else {
				// 24-bit little-endian
				view.setUint8(offset, value & 0xff);
				view.setUint8(offset + 1, (value >> 8) & 0xff);
				view.setUint8(offset + 2, (value >> 16) & 0xff);
				offset += 3;
			}
		}
	}

	return new Blob([buffer], { type: 'audio/wav' });
}
