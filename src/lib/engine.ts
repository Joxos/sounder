import SignalsmithStretch from 'signalsmith-stretch';
import type { DecodedAudio } from './decode';
import { speedToImpliedSemitones } from './format';

export type ShiftMode = 'vinyl' | 'independent';

export interface EngineParams {
	/** Additive key offset chosen by the user, in semitones. */
	semitones: number;
	/** Playback speed multiplier, 0.5 – 2.0. */
	speed: number;
	mode: ShiftMode;
	/**
	 * Off by default on purpose: formant preservation exists to *prevent* the
	 * chipmunk effect, and the chipmunk effect is the point of this tool.
	 */
	formantCompensation: boolean;
}

export const DEFAULT_PARAMS: EngineParams = {
	semitones: 0,
	speed: 1,
	mode: 'independent',
	formantCompensation: false
};

/** How far ahead of `currentTime` parameter changes are scheduled, to avoid zipper noise. */
const SCHEDULE_AHEAD = 0.05;
/** Crossfade length when swapping between processed and original signal. */
const CROSSFADE = 0.03;
/** How often the worklet reports its playhead back to the main thread. */
const TIME_UPDATE_INTERVAL = 0.01;

interface StretchNodeInstance {
	schedule(obj: Record<string, unknown>): Promise<unknown>;
	start(when?: number | Record<string, unknown>, offset?: number, duration?: number, rate?: number, semitones?: number): Promise<unknown>;
	stop(when?: number): Promise<unknown>;
	addBuffers(buffers: Float32Array<ArrayBuffer>[]): Promise<number>;
	dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
	latency(): Promise<number>;
	configure(config: Record<string, unknown>): Promise<unknown>;
	setUpdateInterval(seconds: number): Promise<unknown>;
	inputTime: number;
	connect(dest: AudioNode): AudioNode;
	disconnect(): void;
}

export class EngineUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EngineUnavailableError';
	}
}

/**
 * Render a short known tone through the real engine stack and confirm it comes
 * out audible.
 *
 * This exists because the engine can fail *silently*: if the AudioWorklet's
 * WASM never instantiates, `process()` keeps returning zeros while the node
 * still answers port messages — so `load()` resolves, the A/B path keeps
 * working, and the user just hears nothing with no error anywhere.
 */
export async function probeEngine(channels: number): Promise<{ ok: boolean; reason: string }> {
	if (typeof AudioWorklet === 'undefined') {
		return { ok: false, reason: '此浏览器不支持 AudioWorklet' };
	}
	try {
		// An OfflineAudioContext renders faster than realtime and is silent by
		// definition, so the node can be connected straight to the destination.
		const off = new OfflineAudioContext(channels, 1, 44100);
		const sr = off.sampleRate;
		const seconds = 1.0;
		const frames = Math.floor(sr * seconds);
		const tone = new Float32Array(frames);
		for (let i = 0; i < frames; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;

		// Leave generous room for the node's input+output latency.
		const rendered_ctx = new OfflineAudioContext(channels, Math.ceil(sr * (seconds + 1.5)), sr);
		const node = (await SignalsmithStretch(rendered_ctx, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [channels]
		})) as unknown as StretchNodeInstance;
		node.connect(rendered_ctx.destination);

		await node.addBuffers([tone]);
		await node.start({ outputTime: 0, input: 0, active: true, rate: 1, semitones: 0 } as never);

		const rendered = await rendered_ctx.startRendering();
		const data = rendered.getChannelData(0);
		let peak = 0;
		for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));

		if (peak < 0.01) {
			return { ok: false, reason: `变调引擎输出为静音（峰值 ${peak.toFixed(4)}）` };
		}
		return { ok: true, reason: '' };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** Ceiling for the safety limiter, in dBFS. */
const LIMITER_THRESHOLD_DB = -1.5;
/** Clamp on the loudness-match correction, so it can never run away. */
const MAX_MATCH_GAIN_DB = 12;
/** Smoothing time constant for the loudness correction, in seconds. */
const MATCH_SMOOTHING = 0.6;
/** Averaging window for the loudness meters, in seconds. */
const METER_TAU = 1.0;

/** Analysis window for offline renders; latency is free when rendering offline. */
const OFFLINE_BLOCK_MS = 240;

export interface MeterReading {
	/** dBFS of the loudest sample in the last frame, at the destination. */
	peakDb: number;
	/** dBFS of the recent RMS, at the destination. */
	rmsDb: number;
	/** dB of loudness correction currently being applied. */
	correctionDb: number;
	/** dBFS the processed signal is being steered towards at this moment. */
	referenceDb: number;
	/** True when the limiter is actually reducing gain. */
	limiting: boolean;
}

const toDb = (linear: number): number =>
	linear > 0 ? 20 * Math.log10(linear) : -Infinity;

function rmsDb(channels: Float32Array<ArrayBuffer>[]): number {
	let sum = 0;
	let count = 0;
	for (const channel of channels) {
		for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
		count += channel.length;
	}
	return toDb(Math.sqrt(sum / Math.max(1, count)));
}

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private node: StretchNodeInstance | null = null;

	private processedGain: GainNode | null = null;
	private originalGain: GainNode | null = null;
	private volumeGain: GainNode | null = null;
	private master: GainNode | null = null;
	private originalSource: AudioBufferSourceNode | null = null;

	/** Compensates the loudness shift caused by pitch/tempo changes. */
	private loudnessGain: GainNode | null = null;
	/** Safety net so nothing can ever exceed the ceiling. */
	private limiter: DynamicsCompressorNode | null = null;
	private processedAnalyser: AnalyserNode | null = null;
	private outputAnalyser: AnalyserNode | null = null;
	private meterBuffer: Float32Array<ArrayBuffer> | null = null;
	private originalRmsDb = -Infinity;
	private smoothGainDb = 0;
	private loudnessMatch = true;
	private lastExportGainDb = 0;
	private processedPower = 0;
	private outputPower = 0;
	private rmsEnvelope: Float32Array = new Float32Array(0);
	private rmsHopSeconds = 0.1;

	private originalBuffer: AudioBuffer | null = null;
	private channels: DecodedAudio['channels'] = [];
	private volumeValue = 1;
	private trackSampleRate = 0;
	private duration = 0;
	private name = '';

	private params: EngineParams = { ...DEFAULT_PARAMS };
	private playing = false;
	private abActive = false;
	private loopEnabled = false;
	private loopPlayback = false;
	private loopStart = 0;
	private loopEnd = 0;
	private disposed = false;
	private endedFired = false;

	/** Fired once when playback reaches the end and does not loop. */
	onEnded: (() => void) | null = null;

	/** Fired ~100x/sec with the playhead position, in *input* seconds. */
	onTick: ((position: number) => void) | null = null;

	get loaded(): boolean {
		return this.node !== null;
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	get audioDuration(): number {
		return this.duration;
	}

	get trackName(): string {
		return this.name;
	}

	get sampleRate(): number {
		return this.trackSampleRate;
	}

	get position(): number {
		return this.node?.inputTime ?? 0;
	}

	/** The mix bus, before it reaches the destination. Useful for tap metering. */
	get outputNode(): GainNode | null {
		return this.master;
	}

	get audioContext(): AudioContext | null {
		return this.ctx;
	}

	/** The AudioContext must be created from a user gesture; call this lazily. */
	async ensureContext(): Promise<AudioContext> {
		if (!this.ctx) {
			this.ctx = new AudioContext();
		}
		if (this.ctx.state === 'suspended') {
			await this.ctx.resume();
		}
		return this.ctx;
	}

	async load(audio: DecodedAudio): Promise<void> {
		const ctx = await this.ensureContext();
		await this.teardown();

		// Fail loudly rather than silently: see probeEngine().
		const probe = await probeEngine(audio.channels.length);
		if (!probe.ok) {
			throw new EngineUnavailableError(
				`当前浏览器无法运行变调引擎（${probe.reason}）。请更新浏览器或换用 Chrome / Edge。`
			);
		}

		// The stretch node runs at the AudioContext rate, so resample if needed.
		const prepared = await this.resampleToContextRate(ctx, audio);
		this.trackSampleRate = prepared.sampleRate;
		this.duration = prepared.duration;
		this.name = audio.name;

		const buffer = ctx.createBuffer(prepared.channels.length, prepared.channels[0].length, prepared.sampleRate);
		prepared.channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
		this.originalBuffer = buffer;

		const node = (await SignalsmithStretch(ctx, {
			// `numberOfInputs` must stay at 1. With 0, `inputList[0]` is
			// undefined and the processor's inactive branch dereferences
			// `inputs[c % inputs.length]`, throwing on the very first render
			// quantum (before start()) and killing the processed path.
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [prepared.channels.length]
		})) as unknown as StretchNodeInstance;

		this.master = ctx.createGain();
		this.loudnessGain = ctx.createGain();
		this.loudnessGain.gain.value = 1;
		this.volumeGain = ctx.createGain();
		this.volumeGain.gain.value = this.volume;
		this.processedGain = ctx.createGain();
		this.originalGain = ctx.createGain();
		this.originalGain.gain.value = 0;

		// Safety limiter. Only bites above the ceiling, so quiet material passes
		// through untouched.
		this.limiter = ctx.createDynamicsCompressor();
		this.limiter.threshold.value = LIMITER_THRESHOLD_DB;
		this.limiter.knee.value = 0;
		this.limiter.ratio.value = 20;
		this.limiter.attack.value = 0.003;
		this.limiter.release.value = 0.25;

		this.processedAnalyser = ctx.createAnalyser();
		this.processedAnalyser.fftSize = 2048;
		this.outputAnalyser = ctx.createAnalyser();
		this.outputAnalyser.fftSize = 2048;
		this.meterBuffer = new Float32Array(2048);

		node.connect(this.processedGain);
		this.processedGain.connect(this.loudnessGain);
		this.loudnessGain.connect(this.master);
		this.originalGain.connect(this.master);
		// Metered *before* compensation, so the correction cannot feed back.
		this.processedGain.connect(this.processedAnalyser);
		this.master.connect(this.volumeGain);
		this.volumeGain.connect(this.limiter);
		this.limiter.connect(this.outputAnalyser);
		this.limiter.connect(ctx.destination);

		// Keep the prepared PCM for offline export. It is the same data the
		// worklet holds, so this costs no extra memory.
		this.channels = prepared.channels;
		this.originalRmsDb = rmsDb(prepared.channels);
		this.smoothGainDb = 0;
		this.processedPower = 0;
		this.outputPower = 0;

		await node.addBuffers(prepared.channels);
		await node.setUpdateInterval(TIME_UPDATE_INTERVAL);
		this.node = node;

		this.playing = false;
		this.abActive = false;
		this.loopEnabled = false;
		this.applyParams();
	}

	private async resampleToContextRate(ctx: AudioContext, audio: DecodedAudio): Promise<DecodedAudio> {
		if (audio.sampleRate === ctx.sampleRate) return audio;

		const frames = Math.ceil(audio.duration * ctx.sampleRate);
		const offline = new OfflineAudioContext(audio.channels.length, frames, ctx.sampleRate);
		const source = offline.createBuffer(
			audio.channels.length,
			audio.channels[0].length,
			audio.sampleRate
		);
		audio.channels.forEach((channel, i) => source.copyToChannel(channel, i));

		const player = offline.createBufferSource();
		player.buffer = source;
		player.connect(offline.destination);
		player.start();

		const rendered = await offline.startRendering();
		const channels: DecodedAudio['channels'] = [];
		for (let c = 0; c < rendered.numberOfChannels; c++) {
			channels.push(new Float32Array(rendered.getChannelData(c)));
		}
		return {
			channels,
			sampleRate: ctx.sampleRate,
			duration: rendered.duration,
			name: audio.name
		};
	}

	/** Effective semitones actually sent to the engine, given the current mode. */
	private effectiveSemitones(): number {
		return this.params.mode === 'vinyl'
			? speedToImpliedSemitones(this.params.speed) + this.params.semitones
			: this.params.semitones;
	}

	/** Pitch the listener will actually hear, including vinyl-mode coupling. */
	get derivedSemitones(): number {
		return this.effectiveSemitones();
	}

	/** Push the current parameters into the node. Never restarts playback. */
	applyParams(): void {
		if (!this.node || !this.ctx || this.disposed) return;
		this.node.schedule(this.segment(this.ctx.currentTime + SCHEDULE_AHEAD));
	}

	/** Build one time-map segment carrying the current transport + effect state. */
	private segment(outputTime: number, overrides: Record<string, unknown> = {}) {
		return {
			outputTime,
			active: this.playing,
			rate: this.abActive ? 1 : this.params.speed,
			semitones: this.abActive ? 0 : this.effectiveSemitones(),
			formantCompensation: this.abActive ? false : this.params.formantCompensation,
			loopStart: this.loopEnabled ? this.loopStart : 0,
			loopEnd: this.loopEnabled ? this.loopEnd : 0,
			...overrides
		};
	}

	setParams(patch: Partial<EngineParams>): void {
		this.params = { ...this.params, ...patch };
		this.applyParams();
	}

	get volume(): number {
		return this.volumeValue;
	}

	/** Output gain. Ramps rather than jumps so dragging the slider is click-free. */
	setVolume(value: number): void {
		this.volumeValue = Math.max(0, Math.min(2, value));
		if (!this.volumeGain || !this.ctx) return;
		const now = this.ctx.currentTime;
		const param = this.volumeGain.gain;
		param.cancelScheduledValues(now);
		param.setValueAtTime(param.value, now);
		param.linearRampToValueAtTime(this.volumeValue, now + 0.03);
	}

	getParams(): EngineParams {
		return { ...this.params };
	}

	async play(): Promise<void> {
		if (!this.node || !this.ctx) return;
		if (this.playing) return;
		await this.ctx.resume();
		this.playing = true;

		// Start and configure in a *single* schedule call. Calling start() and
		// then applyParams() issues two segments, and since the node's own
		// latency is larger than SCHEDULE_AHEAD the second one evicts the
		// first, leaving a negative input position (a burst of silence).
		//
		// `input` is deliberately omitted: the worklet then derives it from the
		// most recent segment, which is what makes a seek issued just before
		// play actually take effect. Passing the live inputTime instead would
		// reschedule later and clobber that pending seek.
		const latency = await this.node.latency().catch(() => 0);
		const when = this.ctx.currentTime + Math.max(SCHEDULE_AHEAD, latency + 0.01);
		await this.node.start(this.segment(when) as never);
	}

	pause(): void {
		if (!this.node || !this.playing) return;
		this.playing = false;
		void this.node.stop();
		this.stopOriginal();
	}

	togglePlay(): void {
		if (this.playing) this.pause();
		else void this.play();
	}

	/** Jump the playhead. `inputTime` is expressed in source (pre-stretch) seconds. */
	seek(seconds: number): void {
		if (!this.node || !this.ctx) return;
		const target = Math.max(0, Math.min(seconds, this.duration));
		this.node.schedule(
			this.segment(this.ctx.currentTime + SCHEDULE_AHEAD, { input: target })
		);
		if (this.abActive) this.startOriginal(target);
	}

	setLoop(enabled: boolean, start?: number, end?: number): void {
		this.loopEnabled = enabled;
		if (start !== undefined) this.loopStart = start;
		if (end !== undefined) this.loopEnd = end;
		this.applyParams();
	}

	getLoop(): { enabled: boolean; start: number; end: number } {
		return { enabled: this.loopEnabled, start: this.loopStart, end: this.loopEnd };
	}

	/** Repeat the whole track (or the loop region, when one is set). */
	setLoopPlayback(enabled: boolean): void {
		this.loopPlayback = enabled;
	}

	get isLoopingPlayback(): boolean {
		return this.loopPlayback;
	}

	/**
	 * A/B against the untouched original.
	 *
	 * The stretch node stays running (muted) in forced-identity mode so its
	 * playhead advances at 1x in lockstep with the original source; that keeps
	 * the round trip back to the processed signal free of any seek or jump.
	 */
	setABCompare(active: boolean): void {
		if (!this.node || !this.ctx || !this.processedGain || !this.originalGain) return;
		if (this.abActive === active) return;

		if (active) {
			const position = this.node.inputTime;
			this.abActive = true;
			this.applyParams();
			this.startOriginal(position);
			this.fade(this.originalGain.gain, 1);
			this.fade(this.processedGain.gain, 0);
		} else {
			this.abActive = false;
			this.fade(this.originalGain.gain, 0);
			this.fade(this.processedGain.gain, 1);
			this.applyParams();
			this.stopOriginal();
		}
	}

	get isABComparing(): boolean {
		return this.abActive;
	}

	private startOriginal(offset: number): void {
		if (!this.ctx || !this.originalBuffer || !this.originalGain) return;
		this.stopOriginal();
		const source = this.ctx.createBufferSource();
		source.buffer = this.originalBuffer;
		source.connect(this.originalGain);
		const when = this.ctx.currentTime + CROSSFADE;
		source.start(when, Math.max(0, Math.min(offset, this.originalBuffer.duration)));
		this.originalSource = source;
	}

	private stopOriginal(): void {
		if (!this.originalSource) return;
		try {
			this.originalSource.stop();
		} catch {
			// already stopped
		}
		this.originalSource.disconnect();
		this.originalSource = null;
	}

	private fade(param: AudioParam, value: number): void {
		const now = this.ctx?.currentTime ?? 0;
		param.cancelScheduledValues(now);
		param.setValueAtTime(param.value, now);
		param.linearRampToValueAtTime(value, now + CROSSFADE);
	}

	/**
	 * Supply the source loudness envelope so loudness matching follows the
	 * track's dynamics (a quiet intro stays quiet) instead of comparing against
	 * one whole-file average.
	 */
	setRmsEnvelope(envelope: Float32Array, hopSeconds: number): void {
		this.rmsEnvelope = envelope;
		this.rmsHopSeconds = hopSeconds;
	}

	private referenceRmsDb(inputSeconds: number): number {
		if (this.rmsEnvelope.length === 0 || this.rmsHopSeconds <= 0) return this.originalRmsDb;
		const index = Math.min(
			this.rmsEnvelope.length - 1,
			Math.max(0, Math.floor(inputSeconds / this.rmsHopSeconds))
		);
		const power = this.rmsEnvelope[index];
		if (power > 1e-9) return 10 * Math.log10(power);
		// Silent passage: fall back to the whole-file average rather than
		// chasing a -Infinity target and ramping the gain up.
		return this.originalRmsDb;
	}

	/** Call from a rAF/interval loop to drive the UI. */
	tick(deltaSeconds = 1 / 60): MeterReading | null {
		if (!this.node) return null;
		this.onTick?.(this.node.inputTime);

		const reading: MeterReading = {
			peakDb: -Infinity,
			rmsDb: -Infinity,
			correctionDb: this.smoothGainDb,
			referenceDb: this.originalRmsDb,
			limiting: false
		};
		if (!this.meterBuffer || !this.outputAnalyser || !this.processedAnalyser) return reading;

		// Peak is instantaneous — that is what "will it clip" depends on.
		this.outputAnalyser.getFloatTimeDomainData(this.meterBuffer);
		let peak = 0;
		let outPower = 0;
		for (let i = 0; i < this.meterBuffer.length; i++) {
			const v = Math.abs(this.meterBuffer[i]);
			if (v > peak) peak = v;
			outPower += this.meterBuffer[i] * this.meterBuffer[i];
		}
		reading.peakDb = toDb(peak);
		reading.limiting = this.limiter ? this.limiter.reduction > 0.1 : false;

		// Loudness must NOT be read from a single ~42 ms block: that just
		// tracks whichever note happens to be sounding and swings by several dB.
		// Average the power over ~1 s instead.
		const meterAlpha = 1 - Math.exp(-deltaSeconds / METER_TAU);
		this.outputPower += (outPower / this.meterBuffer.length - this.outputPower) * meterAlpha;
		reading.rmsDb = 10 * Math.log10(Math.max(this.outputPower, 1e-20));

		// Loudness matching: compare the processed signal (pre-compensation) to
		// the untouched original. Pitch and speed changes genuinely move
		// perceived level, which is what makes dragging a slider feel like it
		// blasts your ears. Metered before the correction, so it cannot feed back.
		if (this.loudnessMatch && !this.abActive && Number.isFinite(this.originalRmsDb)) {
			this.processedAnalyser.getFloatTimeDomainData(this.meterBuffer);
			let sum = 0;
			for (let i = 0; i < this.meterBuffer.length; i++) sum += this.meterBuffer[i] * this.meterBuffer[i];
			const instant = sum / this.meterBuffer.length;
			this.processedPower += (instant - this.processedPower) * meterAlpha;
			const processedDb = 10 * Math.log10(Math.max(this.processedPower, 1e-20));
			const referenceDb = this.referenceRmsDb(this.node.inputTime);
			reading.referenceDb = referenceDb;
			const target = Math.max(
				-MAX_MATCH_GAIN_DB,
				Math.min(MAX_MATCH_GAIN_DB, referenceDb - processedDb)
			);
			// Two-stage: the measurement is already smoothed, so this only needs
			// to take the edge off parameter jumps.
			const alpha = 1 - Math.exp(-deltaSeconds / MATCH_SMOOTHING);
			this.smoothGainDb += (target - this.smoothGainDb) * alpha;
		} else {
			const alpha = 1 - Math.exp(-deltaSeconds / MATCH_SMOOTHING);
			this.smoothGainDb += (0 - this.smoothGainDb) * alpha;
		}

		if (this.loudnessGain && this.ctx) {
			const gain = Math.pow(10, this.smoothGainDb / 20);
			this.loudnessGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
		}
		reading.correctionDb = this.smoothGainDb;

		// End-of-track handling. The worklet keeps advancing the playhead past
		// the end of the source (emitting silence), so this is where we stop or
		// wrap — rather than leaving the transport stranded past the end.
		//
		// Note this keys off the *full* track length: when a loop region is set,
		// the worklet wraps inside the region itself, so the playhead never
		// reaches the end and the region simply repeats, which is what "循环区间"
		// is for. 循环播放 only governs what happens at the end of the track.
		if (this.playing) {
			if (this.node.inputTime >= this.duration - 0.02) {
				if (this.loopPlayback) {
					this.seek(0);
					this.endedFired = false;
				} else if (!this.endedFired) {
					this.endedFired = true;
					this.playing = false;
					this.stopOriginal();
					this.seek(0);
					this.onEnded?.();
				}
			} else {
				this.endedFired = false;
			}
		}

		return reading;
	}

	setLoudnessMatch(enabled: boolean): void {
		this.loudnessMatch = enabled;
	}

	get isLoudnessMatching(): boolean {
		return this.loudnessMatch;
	}

	/** dBFS loudness of the untouched source, for display. */
	get sourceRmsDb(): number {
		return this.originalRmsDb;
	}

	/** Total gain, in dB, applied by the most recent offline render. */
	get exportGainDb(): number {
		return this.lastExportGainDb;
	}

	/**
	 * Render the current settings offline, through the *same* engine the
	 * preview uses, so an export is sample-for-sample what the user heard.
	 *
	 * The node's own latency is trimmed from the head and the tail is cut to
	 * the expected length, so the file starts and ends on the music rather
	 * than on silence.
	 */
	async renderOffline(
		options: {
			semitones?: number;
			speed?: number;
			formantCompensation?: boolean;
			volume?: number;
			/** Export only this region (one pass, not looped). Defaults to the whole track. */
			loop?: { enabled: boolean; start: number; end: number };
			/** Scale the result so its peak lands here (dBFS), or null to skip. */
			normalizeToPeakDb?: number | null;
		} = {}
	): Promise<AudioBuffer> {
		if (this.channels.length === 0) {
			throw new Error('没有可导出的音频');
		}

		const semitones = options.semitones ?? this.params.semitones;
		const speed = options.speed ?? this.params.speed;
		const formant = options.formantCompensation ?? this.params.formantCompensation;
		const volume = options.volume ?? this.volumeValue;
		const loop = options.loop ?? this.getLoop();

		const effective =
			this.params.mode === 'vinyl' ? speedToImpliedSemitones(speed) + semitones : semitones;
		const normalizeToPeakDb = options.normalizeToPeakDb ?? null;

		const regionStart = loop.enabled ? loop.start : 0;
		const regionEnd = loop.enabled ? loop.end : this.duration;
		const contentSeconds = Math.max(0.05, regionEnd - regionStart);
		const outSeconds = contentSeconds / speed;

		const sr = this.trackSampleRate;
		const channelCount = this.channels.length;
		const probe = new OfflineAudioContext(channelCount, 1, sr);
		const latencyProbe = probe.sampleRate;

		const off = new OfflineAudioContext(
			channelCount,
			Math.ceil((outSeconds + 2) * sr),
			latencyProbe
		);
		const node = (await SignalsmithStretch(off, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [channelCount]
		})) as unknown as StretchNodeInstance;

		// Offline we can afford a much longer analysis window: measurements
		// showed the high-frequency tilt at 0.65x improves from -0.41 dB
		// (default) to roughly -0.2 dB here, and latency costs nothing offline.
		await node.configure({ blockMs: OFFLINE_BLOCK_MS, intervalMs: OFFLINE_BLOCK_MS / 4 });

		const gain = off.createGain();
		// Render raw. The volume, the loudness correction and the peak
		// normalisation are all applied to the samples below, in that order,
		// so the volume slider stays the user's final say — exactly like the
		// realtime signal flow (loudness -> volume).
		gain.gain.value = 1;
		node.connect(gain);
		gain.connect(off.destination);

		await node.addBuffers(this.channels);
		const latency = await node.latency();
		await node.start({
			outputTime: 0,
			input: regionStart,
			active: true,
			rate: speed,
			semitones: effective,
			formantCompensation: formant,
			loopStart: 0,
			loopEnd: 0
		});

		const rendered = await off.startRendering();

		// Drop the algorithm's lead-in silence and any trailing tail.
		const trim = Math.min(Math.max(0, Math.round(latency * sr)), rendered.length - 1);
		const length = Math.max(1, Math.min(rendered.length - trim, Math.ceil(outSeconds * sr)));
		const out = new AudioBuffer({ numberOfChannels: channelCount, length, sampleRate: sr });
		for (let c = 0; c < channelCount; c++) {
			const src = rendered.getChannelData(c);
			out.copyToChannel(src.subarray(trim, trim + length), c);
		}

		// Apply the same loudness correction the preview is using, plus optional
		// peak normalisation, so the file matches what was on screen and can
		// never startle anyone.
		let peak = 0;
		for (let c = 0; c < channelCount; c++) {
			const data = out.getChannelData(c);
			for (let i = 0; i < data.length; i++) {
				const a = Math.abs(data[i]);
				if (a > peak) peak = a;
			}
		}

		// Loudness compensation is a *monitoring* aid only: it exists so that
		// dragging the sliders does not blast your ears. It is deliberately
		// NOT written into the exported file, so what you download is exactly
		// the level the engine produced.
		// Order: user's volume, then optional peak normalisation. The user's
		// volume is applied first so it stays the final say.
		const volumeDb = toDb(volume);
		let normalizeDb = 0;
		if (normalizeToPeakDb !== null && peak > 0) {
			normalizeDb = normalizeToPeakDb - (toDb(peak) + volumeDb);
		}

		const totalGain = Math.pow(10, (volumeDb + normalizeDb) / 20);
		if (Math.abs(totalGain - 1) > 0.001) {
			for (let c = 0; c < channelCount; c++) {
				const data = out.getChannelData(c);
				for (let i = 0; i < data.length; i++) data[i] *= totalGain;
			}
		}

		this.lastExportGainDb = normalizeDb;
		return out;
	}

	private async teardown(): Promise<void> {
		this.stopOriginal();
		if (this.node) {
			this.node.disconnect();
			this.node = null;
		}
		this.processedGain?.disconnect();
		this.originalGain?.disconnect();
		this.loudnessGain?.disconnect();
		this.volumeGain?.disconnect();
		this.limiter?.disconnect();
		this.master?.disconnect();
		this.processedGain = null;
		this.originalGain = null;
		this.loudnessGain = null;
		this.volumeGain = null;
		this.limiter = null;
		this.processedAnalyser = null;
		this.outputAnalyser = null;
		this.meterBuffer = null;
		this.master = null;
		this.originalBuffer = null;
		this.channels = [];
	}

	dispose(): void {
		this.disposed = true;
		void this.teardown();
		void this.ctx?.close();
		this.ctx = null;
	}
}
