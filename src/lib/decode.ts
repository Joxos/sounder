import {
	Input,
	BlobSource,
	AudioBufferSink,
	MP3,
	WAVE,
	MP4,
	FLAC,
	OGG,
	ADTS,
	MATROSKA,
	WEBM
} from 'mediabunny';

/**
 * Only the containers users actually hand us. Skipping ALL_FORMATS keeps the
 * bundled demuxer set (and therefore the download) small.
 */
const INPUT_FORMATS = [MP3, WAVE, MP4, FLAC, OGG, ADTS, MATROSKA, WEBM];

/** One channel of float PCM. */
export type PcmChannel = Float32Array<ArrayBuffer>;

export interface DecodedAudio {
	/** One Float32Array per channel, at the file's *native* sample rate. */
	channels: PcmChannel[];
	sampleRate: number;
	/** Total length in seconds, measured at the native sample rate. */
	duration: number;
	name: string;
}

export class DecodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DecodeError';
	}
}

function friendlyError(file: File, cause: unknown): DecodeError {
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	let hint = '请换一个音频文件试试';
	if (ext === 'wma') {
		hint = '不支持 .wma —— 没有任何浏览器能解码这个格式，请先转成 mp3 或 wav';
	} else if (ext === 'aiff' || ext === 'aif') {
		hint = '部分浏览器无法解码 .aiff，请转成 wav 或 mp3';
	}
	const reason = cause instanceof Error ? cause.message : String(cause);
	return new DecodeError(`${file.name}: ${hint}（${reason}）`);
}

/**
 * Decode a user-supplied file to raw float PCM.
 *
 * Deliberately goes through mediabunny rather than `decodeAudioData` for two
 * reasons: it keeps the file's *native* sample rate (decodeAudioData silently
 * resamples to the AudioContext rate, which destroys 48k masters), and it can
 * read containers the browser's own demuxer rejects.
 */
export async function decodeFile(
	file: File,
	onProgress?: (fraction: number) => void
): Promise<DecodedAudio> {
	const input = new Input({ formats: INPUT_FORMATS, source: new BlobSource(file) });

	try {
		if (!(await input.canRead())) {
			throw new DecodeError(`${file.name}: 无法识别的音频格式`);
		}

		const track = await input.getPrimaryAudioTrack();
		if (!track) {
			throw new DecodeError(`${file.name}: 文件里没有音频轨道`);
		}
		if (!(await track.canDecode())) {
			throw new DecodeError(`${file.name}: 当前浏览器无法解码这个文件的编码`);
		}

		const sampleRate = await track.getSampleRate();
		const duration = await input.computeDuration();

		// Decode into per-channel float arrays, concatenating the sink's chunks.
		const sink = new AudioBufferSink(track);
		const chunks: PcmChannel[][] = [];
		let frames = 0;
		let channels = 0;

		for await (const { buffer } of sink.buffers()) {
			const planes: PcmChannel[] = [];
			for (let c = 0; c < buffer.numberOfChannels; c++) {
				planes.push(new Float32Array(buffer.getChannelData(c)));
			}
			chunks.push(planes);
			frames += planes[0]?.length ?? 0;
			channels = Math.max(channels, planes.length);
			onProgress?.(Math.min(0.99, frames / (duration * sampleRate || 1)));
		}

		if (frames === 0) {
			throw new DecodeError(`${file.name}: 解码结果为空`);
		}

		// Flatten to one array per channel.
		const out: PcmChannel[] = [];
		for (let c = 0; c < channels; c++) {
			const merged = new Float32Array(frames);
			let offset = 0;
			for (const planes of chunks) {
				const plane = planes[Math.min(c, planes.length - 1)];
				merged.set(plane, offset);
				offset += plane.length;
			}
			out.push(merged);
		}

		onProgress?.(1);
		return {
			channels: out,
			sampleRate,
			duration: frames / sampleRate,
			name: file.name
		};
	} catch (err) {
		if (err instanceof DecodeError) throw err;
		throw friendlyError(file, err);
	} finally {
		input.dispose();
	}
}
