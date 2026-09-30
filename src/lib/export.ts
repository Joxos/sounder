/**
 * Offline export: render through the same engine the preview uses, then encode.
 *
 * Rendering and encoding are deliberately separate so the UI can show the two
 * phases, and so WAV (which needs no codec at all) never touches a WASM encoder.
 */
import {
	Output,
	BufferTarget,
	AudioBufferSource,
	Mp4OutputFormat,
	Mp3OutputFormat
} from 'mediabunny';
import { encodeWav } from './wav';

export type ExportFormat = 'wav' | 'mp3' | 'm4a';

export interface ExportResult {
	blob: Blob;
	filename: string;
	duration: number;
	sampleRate: number;
	channels: number;
}

/** MP3 tops out at 48 kHz; anything above has to be resampled first. */
const MP3_MAX_SAMPLE_RATE = 48000;

/** Feed the encoder in chunks so the writer's backpressure is respected. */
const ENCODE_CHUNK_FRAMES = 1 << 16;

export const FORMAT_LABELS: Record<ExportFormat, string> = {
	wav: 'WAV · 无损，体积最大',
	mp3: 'MP3 · 通用性最好',
	m4a: 'M4A / AAC · 通用，体积小'
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
	wav: 'wav',
	mp3: 'mp3',
	m4a: 'm4a'
};

const FORMAT_MIME: Record<ExportFormat, string> = {
	wav: 'audio/wav',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4'
};

/** Build a filename that records the settings used, e.g. `song_+3st_85pct.mp3`. */
export function buildFilename(
	baseName: string,
	format: ExportFormat,
	semitones: number,
	speed: number
): string {
	const stem = baseName.replace(/\.[^.]+$/, '') || 'audio';
	const parts = [stem];
	if (Math.abs(semitones) >= 0.5) {
		parts.push(`${semitones > 0 ? '+' : ''}${Math.round(semitones)}st`);
	}
	if (Math.abs(speed - 1) >= 0.005) {
		parts.push(`${Math.round(speed * 100)}pct`);
	}
	parts.push(FORMAT_EXTENSIONS[format]);
	return parts.join('_');
}

async function resampleTo(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
	if (buffer.sampleRate <= targetRate) return buffer;
	const frames = Math.ceil(buffer.duration * targetRate);
	const offline = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
	const source = offline.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
	for (let c = 0; c < buffer.numberOfChannels; c++) {
		source.copyToChannel(buffer.getChannelData(c), c);
	}
	const player = offline.createBufferSource();
	player.buffer = source;
	player.connect(offline.destination);
	player.start();
	return offline.startRendering();
}

export interface EncodeOptions {
	format: ExportFormat;
	/** Only used for the compressed formats, in kbit/s. */
	bitrateKbps?: number;
	/** WAV only. */
	bitDepth?: 16 | 24;
}

export async function encodeBuffer(
	buffer: AudioBuffer,
	{ format, bitrateKbps = 256, bitDepth = 16 }: EncodeOptions
): Promise<Blob> {
	if (format === 'wav') {
		const channels: Float32Array[] = [];
		for (let c = 0; c < buffer.numberOfChannels; c++) {
			channels.push(new Float32Array(buffer.getChannelData(c)));
		}
		return encodeWav(channels, buffer.sampleRate, bitDepth);
	}

	// MPEG audio cannot exceed 48 kHz; resample down if the render ran faster.
	const pcm = format === 'mp3' ? await resampleTo(buffer, MP3_MAX_SAMPLE_RATE) : buffer;

	const attempt = async (): Promise<Blob> => {
		const target = new BufferTarget();
		const output = new Output({
			format:
				format === 'mp3'
					? new Mp3OutputFormat({ xingHeader: true })
					: new Mp4OutputFormat({ fastStart: 'in-memory' }),
			target
		});

		const encoder = new AudioBufferSource({
			codec: format === 'mp3' ? 'mp3' : 'aac',
			bitrate: bitrateKbps * 1000
		});
		output.addAudioTrack(encoder);
		await output.start();

		for (let offset = 0; offset < pcm.length; offset += ENCODE_CHUNK_FRAMES) {
			const end = Math.min(pcm.length, offset + ENCODE_CHUNK_FRAMES);
			const part = new AudioBuffer({
				numberOfChannels: pcm.numberOfChannels,
				length: end - offset,
				sampleRate: pcm.sampleRate
			});
			for (let c = 0; c < pcm.numberOfChannels; c++) {
				part.copyToChannel(pcm.getChannelData(c).subarray(offset, end), c);
			}
			await encoder.add(part);
		}

		await output.finalize();
		const data = target.buffer;
		if (!data) throw new Error('编码失败：没有产生输出数据');
		return new Blob([data], { type: FORMAT_MIME[format] });
	};

	if (format === 'mp3') {
		// No browser anywhere can encode MP3 through WebCodecs.
		const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
		registerMp3Encoder();
		return attempt();
	}

	// AAC: prefer the browser's native encoder, but do not trust
	// canEncodeAudio() alone. Headless Chromium and some builds report AAC as
	// encodable and then reject the exact channel-count/rate combination, so
	// fall back to the WASM encoder on an actual failure rather than a probe.
	try {
		return await attempt();
	} catch (error) {
		const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
		registerAacEncoder();
		return attempt();
	}
}

export async function runExport(
	render: () => Promise<AudioBuffer>,
	options: EncodeOptions & { baseName: string; semitones: number; speed: number }
): Promise<ExportResult> {
	const buffer = await render();
	const blob = await encodeBuffer(buffer, options);
	return {
		blob,
		filename: buildFilename(options.baseName, options.format, options.semitones, options.speed),
		duration: buffer.duration,
		sampleRate: buffer.sampleRate,
		channels: buffer.numberOfChannels
	};
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	requestAnimationFrame(() => {
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	});
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

