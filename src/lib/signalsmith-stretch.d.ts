/**
 * Type declarations for signalsmith-stretch (the package ships JavaScript only).
 *
 * Field names are taken from the shipped source, not the README: the worklet
 * reads `outputTime`, while the README documents it as `output`. Passing
 * `output` is silently ignored, so we only type `outputTime`.
 */
declare module 'signalsmith-stretch' {
	export interface StretchSchedule {
		/** AudioContext time at which this segment takes effect. */
		outputTime: number;
		active?: boolean;
		/** Position within the source buffers, in seconds. */
		input?: number | null;
		/** Playback speed multiplier; 0.5 == half speed. */
		rate?: number;
		/** Pitch shift in semitones. */
		semitones?: number;
		tonalityHz?: number;
		formantSemitones?: number;
		formantCompensation?: boolean;
		formantBaseHz?: number;
		loopStart?: number;
		loopEnd?: number;
	}

	export interface StretchConfigure {
		preset?: 'default' | 'cheaper';
		blockMs?: number | null;
		intervalMs?: number;
		splitComputation?: boolean;
	}

	export interface StretchNode {
		readonly inputTime: number;
		schedule(obj: StretchSchedule): Promise<unknown>;
		start(
			when?: number | StretchSchedule,
			offset?: number,
			duration?: number,
			rate?: number,
			semitones?: number
		): Promise<unknown>;
		stop(when?: number): Promise<unknown>;
		addBuffers(buffers: Float32Array<ArrayBuffer>[]): Promise<number>;
		dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
		latency(): Promise<number>;
		configure(config: StretchConfigure): Promise<unknown>;
		setUpdateInterval(seconds: number): Promise<unknown>;
		connect(destination: AudioNode): AudioNode;
		disconnect(): void;
	}

	export default function SignalsmithStretch(
		audioContext: BaseAudioContext,
		options?: AudioWorkletNodeOptions
	): Promise<StretchNode>;
}
