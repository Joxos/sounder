<script lang="ts">
	import { AudioEngine, DEFAULT_PARAMS, type ShiftMode } from './lib/engine';
	import { buildPeakPyramid, type PeakPyramidData } from './lib/peaks';
	import { decodeFile, type DecodedAudio } from './lib/decode';
	import { PRESETS, findPreset } from './lib/presets';
	import { initTheme, type ThemePreference } from './lib/theme';
	import type { ExportFormat } from './lib/export';
	import {
		SEMITONE_MIN,
		SEMITONE_MAX,
		SPEED_MIN,
		SPEED_MAX,
		formatSemitones,
		formatSpeed,
		pitchQualityBand,
		speedToImpliedSemitones
	} from './lib/format';
	import Waveform from './components/Waveform.svelte';
	import TickedSlider from './components/TickedSlider.svelte';
	import LevelMeter from './components/LevelMeter.svelte';

	// Reference scales for the sliders. Values are absolute slider positions.
	const SEMITONE_TICKS = [
		{ at: -12, label: '-12' },
		{ at: -6, label: '-6' },
		{ at: 0, label: '0', emphasis: true },
		{ at: 6, label: '+6' },
		{ at: 12, label: '+12' }
	];
	const SPEED_TICKS = [
		{ at: 0.5, label: '50%' },
		{ at: 0.75, label: '75%' },
		{ at: 1, label: '100%', emphasis: true },
		{ at: 1.25, label: '125%' },
		{ at: 1.5, label: '150%' },
		{ at: 2, label: '200%' }
	];
	const VOLUME_TICKS = [
		{ at: 0, label: '0' },
		{ at: 0.5, label: '50%' },
		{ at: 1, label: '100%', emphasis: true },
		{ at: 1.5, label: '150%' }
	];

	const engine = new AudioEngine();

	// Theme: dark by default, follows the OS when set to "system".
	const theme = initTheme();
	let themePreference = $state<ThemePreference>(theme.preference);
	let resolvedTheme = $state<'light' | 'dark'>(theme.apply(theme.preference));

	function setTheme(next: ThemePreference) {
		themePreference = next;
		resolvedTheme = theme.apply(next);
	}

	// Kept local so the (large) mediabunny muxer + WASM encoders stay in lazy
	// chunks instead of inflating the first load.
	const FORMAT_LABELS: Record<ExportFormat, string> = {
		wav: 'WAV · 无损，体积最大',
		mp3: 'MP3 · 通用性最好',
		m4a: 'M4A / AAC · 通用，体积小'
	};

	// Dev-only handle for the browser test harness; stripped from production builds.
	if (import.meta.env.DEV) {
		(window as unknown as { __sounderEngine?: AudioEngine }).__sounderEngine = engine;
	}

	let status = $state<'idle' | 'decoding' | 'ready' | 'error'>('idle');
	let errorMessage = $state('');
	let progress = $state(0);
	let dragging = $state(false);

	let pyramid = $state<PeakPyramidData | null>(null);
	let duration = $state(0);
	let position = $state(0);
	let playing = $state(false);
	let trackName = $state('');

	let semitones = $state(DEFAULT_PARAMS.semitones);
	let speed = $state(DEFAULT_PARAMS.speed);
	let mode = $state<ShiftMode>(DEFAULT_PARAMS.mode);
	let formantCompensation = $state(DEFAULT_PARAMS.formantCompensation);
	let volume = $state(1);
	let abActive = $state(false);

	let exportFormat = $state<ExportFormat>('mp3');
	let exporting = $state(false);
	let exportPhase = $state<'render' | 'encode' | 'done' | null>(null);
	let exportSeconds = $state(0);
	let exportError = $state('');
	let lastExport = $state<{ name: string; size: string; seconds: number } | null>(null);

	let loudnessMatch = $state(true);
	let normalizeExport = $state(true);
	let peakDb = $state(-Infinity);
	let rmsDb = $state(-Infinity);
	let correctionDb = $state(0);
	let referenceDb = $state(-Infinity);
	let limiting = $state(false);
	let peakHoldDb = $state(-Infinity);
	let lastFrame = performance.now();
	let exportGainNote = $state('');

	/** Peak ceiling used when exporting with normalisation enabled. */
	const EXPORT_PEAK_DB = -1;

	let loop = $state({ enabled: false, start: 0, end: 0 });
	let loopPlayback = $state(false);

	/** Pitch the listener actually hears, including vinyl-mode coupling. */
	const derivedSemitones = $derived(
		mode === 'vinyl' ? speedToImpliedSemitones(speed) + semitones : semitones
	);
	const derivedNote = $derived.by(() => {
		const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
		return names[((Math.round(derivedSemitones) % 12) + 12) % 12];
	});
	const activePreset = $derived(findPreset(speed, mode === 'vinyl' ? derivedSemitones : semitones));
	const outputDuration = $derived(duration > 0 ? duration / speed : 0);

	const speedHint = $derived.by(() => {
		if (mode === 'vinyl') {
			return `黑胶联动 · 会带来 ${formatSemitones(speedToImpliedSemitones(speed))} 半音`;
		}
		if (speed < 0.75) return '慢速区间，音色会明显变暗';
		if (speed > 1.5) return '快速区间';
		return '自然区间';
	});

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function pushParams() {
		engine.setParams({ semitones, speed, mode, formantCompensation });
	}

	function pushVolume() {
		engine.setVolume(volume);
	}

	async function doExport() {
		if (exporting) return;
		exporting = true;
		exportError = '';
		exportSeconds = 0;
		exportPhase = 'render';
		const started = performance.now();
		const timer = setInterval(() => {
			exportSeconds = (performance.now() - started) / 1000;
		}, 100);

		try {
			const { runExport, downloadBlob, formatBytes } = await import('./lib/export');

			// A/B is a monitoring aid; export the processed signal, always.
			if (abActive) setAB(false);

			// The engine already holds the live params, so rendering with no
			// overrides guarantees the file matches what was on screen.
			const result = await runExport(
				() =>
					engine.renderOffline({
						normalizeToPeakDb: normalizeExport ? EXPORT_PEAK_DB : null
					}),
				{
					format: exportFormat,
					bitrateKbps: 256,
					baseName: trackName,
					semitones: derivedSemitones,
					speed
				}
			);
			downloadBlob(result.blob, result.filename);
			const gainDb = engine.exportGainDb;
			lastExport = {
				name: result.filename,
				size: formatBytes(result.blob.size),
				seconds: (performance.now() - started) / 1000
			};
			exportGainNote =
				Math.abs(gainDb) < 0.1
					? ''
					: `已写入 ${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB 增益（响度对齐${normalizeExport ? ' + 峰值归一化' : ''}）`;

			exportPhase = 'done';
			exportSeconds = (performance.now() - started) / 1000;
		} catch (err) {
			exportError = err instanceof Error ? err.message : String(err);
			exportPhase = null;
		} finally {
			clearInterval(timer);
			exporting = false;
		}
	}

	async function handleFiles(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;

		status = 'decoding';
		errorMessage = '';
		progress = 0;
		position = 0;
		abActive = false;
		loop = { enabled: false, start: 0, end: 0 };

		try {
			// decodeFile keeps the native sample rate; the engine resamples for playback.
			const audio: DecodedAudio = await decodeFile(file, (f) => (progress = f));
			trackName = audio.name;
			duration = audio.duration;
			await engine.load(audio);
			pyramid = await buildPeakPyramid(audio.channels, audio.sampleRate);
			// Let loudness matching follow the track's own dynamics.
			engine.setRmsEnvelope(pyramid.rmsEnvelope, pyramid.rmsHopSeconds);
			status = 'ready';
			await engine.play();
			playing = true;
		} catch (err) {
			status = 'error';
			errorMessage = err instanceof Error ? err.message : String(err);
			pyramid = null;
			duration = 0;
		}
	}

	// Drive the playhead and the output meter.
	$effect(() => {
		let frame = 0;
		const loopTick = (now: number) => {
			const delta = Math.min(0.25, (now - lastFrame) / 1000);
			lastFrame = now;
			if (status === 'ready') {
				const reading = engine.tick(delta);
				if (reading) {
					position = engine.position;
					peakDb = reading.peakDb;
					rmsDb = reading.rmsDb;
					correctionDb = reading.correctionDb;
					referenceDb = reading.referenceDb;
					limiting = reading.limiting;
					// Decaying peak hold reads much better than a raw jump.
					peakHoldDb =
						reading.peakDb >= peakHoldDb ? reading.peakDb : peakHoldDb - delta * 12;
				}
			}
			frame = requestAnimationFrame(loopTick);
		};
		lastFrame = performance.now();
		frame = requestAnimationFrame(loopTick);
		return () => cancelAnimationFrame(frame);
	});

	// Keyboard shortcuts.
	$effect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
			if (status !== 'ready') return;

			const step = event.shiftKey ? 12 : 1;
			switch (event.key) {
				case ' ':
					event.preventDefault();
					togglePlay();
					break;
				case 'ArrowLeft':
					event.preventDefault();
					semitones = clamp(semitones - step, SEMITONE_MIN, SEMITONE_MAX);
					pushParams();
					break;
				case 'ArrowRight':
					event.preventDefault();
					semitones = clamp(semitones + step, SEMITONE_MIN, SEMITONE_MAX);
					pushParams();
					break;
				case 'ArrowUp':
					event.preventDefault();
					speed = clamp(speed + 0.01, SPEED_MIN, SPEED_MAX);
					pushParams();
					break;
				case 'ArrowDown':
					event.preventDefault();
					speed = clamp(speed - 0.01, SPEED_MIN, SPEED_MAX);
					pushParams();
					break;
				case 'Tab':
					event.preventDefault();
					setAB(!abActive);
					break;
				case '0':
					reset();
					break;
				case 'l':
				case 'L':
					setLoopPlayback(!loopPlayback);
					break;
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function togglePlay() {
		engine.togglePlay();
		playing = engine.isPlaying;
	}

	function seek(seconds: number) {
		engine.seek(seconds);
		position = seconds;
	}

	function setLoop(start: number, end: number, enabled: boolean) {
		loop = { enabled, start, end };
		engine.setLoop(enabled, start, end);
	}

	function setLoopPlayback(on: boolean) {
		loopPlayback = on;
		engine.setLoopPlayback(on);
	}

	function setAB(active: boolean) {
		engine.setABCompare(active);
		abActive = active;
	}

	function reset() {
		semitones = 0;
		speed = 1;
		formantCompensation = false;
		loop = { enabled: false, start: 0, end: 0 };
		engine.setLoop(false, 0, 0);
		pushParams();
	}
	function applyPreset(id: string) {
		const preset = PRESETS.find((p) => p.id === id);
		if (!preset) return;
		semitones = preset.semitones;
		speed = preset.speed;
		if (mode === 'vinyl') mode = 'independent';
		pushParams();
	}
</script>

<main>
	<header>
		<div class="title-row">
			<h1>Sounder</h1>
			<div class="theme-switch" role="group" aria-label="主题">
				<button
					class:active={themePreference === 'system'}
					onclick={() => setTheme('system')}
					title="跟随系统"
				>
					自动
				</button>
				<button
					class:active={themePreference === 'light'}
					onclick={() => setTheme('light')}
					title="浅色"
				>
					浅色
				</button>
				<button
					class:active={themePreference === 'dark'}
					onclick={() => setTheme('dark')}
					title="深色"
				>
					深色
				</button>
			</div>
		</div>
		<p class="tagline">变调与变速互相独立 · 全部在浏览器内完成，音频不上传</p>
	</header>

	<section
		class="dropzone"
		class:dragging
		role="button"
		tabindex="0"
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragging = false;
			void handleFiles(e.dataTransfer?.files ?? null);
		}}
		onclick={() => document.getElementById('file-input')?.click()}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') document.getElementById('file-input')?.click();
		}}
	>
		<input
			id="file-input"
			type="file"
			accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.m4b,.mkv,.webm"
			hidden
			onchange={(e) => void handleFiles((e.currentTarget as HTMLInputElement).files)}
		/>
		{#if status === 'idle'}
			<p class="dz-title">拖入一首歌，或点击选择文件</p>
			<p class="dz-sub">支持 mp3 / wav / flac / m4a / aac / ogg / opus / mkv / webm</p>
		{:else if status === 'decoding'}
			<p class="dz-title">正在解码… {Math.round(progress * 100)}%</p>
			<div class="bar"><div class="bar-fill" style:width="{progress * 100}%"></div></div>
		{:else if status === 'error'}
			<p class="dz-title error">{errorMessage}</p>
			<p class="dz-sub">点击重新选择文件</p>
		{:else}
			<p class="dz-title">{trackName}</p>
		{/if}
	</section>

	{#if status === 'ready'}
		<Waveform
			{pyramid}
			{duration}
			{position}
			{loop}
			theme={resolvedTheme}
			onseek={seek}
			onsetloop={setLoop}
		/>

		<div class="transport">
			<button class="primary" onclick={togglePlay}>{playing ? '⏸ 暂停' : '▶ 播放'}</button>
			<button
				class:active={loopPlayback}
				onclick={() => setLoopPlayback(!loopPlayback)}
				title="播完整首后自动从头开始（快捷键 L）"
			>
				{loopPlayback ? '循环播放：开' : '循环播放：关'}
			</button>
			<span class="time">
				{formatTime(position)} / {formatTime(duration)}
				<em>输出约 {formatTime(outputDuration)}</em>
			</span>
			<button class:active={abActive} onclick={() => setAB(!abActive)} title="按住 Tab 也可切换">
				{abActive ? '正在对比原声' : '对比原声 (Tab)'}
			</button>
			<button
				class:active={loop.enabled}
				onclick={() => setLoop(0, 0, !loop.enabled)}
				title="框选一段让它反复循环，用于试听某个乐句；也会限定导出范围"
			>
				{loop.enabled ? '循环区间：开' : '循环区间：关'}
			</button>
			{#if loop.enabled}
				<span class="loop-readout">
					区间 {formatTime(loop.start)} – {formatTime(loop.end)}
					<button class="link" onclick={() => setLoop(0, 0, false)}>清除</button>
				</span>
			{/if}
		</div>

			<p class="waveform-hint">
			在波形上点击或拖动 = 定位播放头　·　<kbd>Shift</kbd> + 拖动 = 框选循环区间（该区间会一直重复，并限定导出范围）　·
			循环播放开启时，播完整首自动回到开头
		</p>

	<div class="controls">
			<div class="mode-row">
				<span class="label">模式</span>
				<div class="segmented">
					<button class:active={mode === 'independent'} onclick={() => { mode = 'independent'; pushParams(); }}>
						独立
					</button>
					<button class:active={mode === 'vinyl'} onclick={() => { mode = 'vinyl'; pushParams(); }}>
						黑胶
					</button>
				</div>
				<p class="mode-hint">
					{mode === 'independent'
						? '变速只改速度，音高完全由右侧调性滑块决定。'
						: '像黑胶机一样变速会带掉音高，调性滑块在此基础上继续叠加。'}
				</p>
			</div>

			<TickedSlider
				id="semitones"
				label="调性"
				min={SEMITONE_MIN}
				max={SEMITONE_MAX}
				step={1}
				value={semitones}
				format={(v) => `${formatSemitones(v)} 半音`}
				ticks={SEMITONE_TICKS}
				hint={mode === 'vinyl'
					? `叠加在变速之上 · 实际音高 ${formatSemitones(derivedSemitones)}`
					: `${pitchQualityBand(derivedSemitones)} · 音高 ${derivedNote}`}
				oninput={(v) => {
					semitones = v;
					pushParams();
				}}
			/>

			<TickedSlider
				id="speed"
				label="速度"
				min={SPEED_MIN}
				max={SPEED_MAX}
				step={0.01}
				value={speed}
				format={formatSpeed}
				ticks={SPEED_TICKS}
				hint={speedHint}
				oninput={(v) => {
					speed = v;
					pushParams();
				}}
			/>

			<TickedSlider
				id="volume"
				label="音量"
				min={0}
				max={1.5}
				step={0.01}
				value={volume}
				format={(v) => `${Math.round(v * 100)}%`}
				ticks={VOLUME_TICKS}
				hint="导出时会一并写入文件"
				oninput={(v) => {
					volume = v;
					pushVolume();
				}}
			/>

			<LevelMeter {peakDb} {rmsDb} {correctionDb} {referenceDb} {limiting} />

			<div class="toggles">
				<label class="switch">
					<input type="checkbox" bind:checked={formantCompensation} onchange={pushParams} />
					<span>自然人声（保持共振峰）</span>
				</label>
				<label class="switch">
					<input
						type="checkbox"
						bind:checked={loudnessMatch}
						onchange={() => engine.setLoudnessMatch(loudnessMatch)}
					/>
					<span>响度对齐原声</span>
				</label>
				<button onclick={reset}>复位 (0)</button>
			</div>
		</div>

		<div class="export">
			<div class="export-head">
				<span class="label">导出</span>
				<select bind:value={exportFormat}>
					{#each Object.entries(FORMAT_LABELS) as [key, label] (key)}
						<option value={key}>{label}</option>
					{/each}
				</select>
				<label class="switch">
					<input type="checkbox" bind:checked={normalizeExport} />
					<span>导出归一化到 −1 dBFS</span>
				</label>
				<button class="primary" onclick={doExport} disabled={exporting}>
					{exporting ? (exportPhase === 'encode' ? '正在编码…' : '正在渲染…') : '导出文件'}
				</button>
			</div>
			<p class="export-note">
				{#if exporting}
					{exportPhase === 'encode' ? '正在编码…' : '正在离线渲染…'} · 已用 {exportSeconds.toFixed(1)}s ·
					{loop.enabled
						? `将导出循环区间 ${formatTime(loop.start)} – ${formatTime(loop.end)}`
						: `将导出整首 · 时长约 ${formatTime(outputDuration)}`}
				{:else if exportError}
					<span class="export-error">{exportError}</span>
				{:else if lastExport}
					已导出 <strong>{lastExport.name}</strong> · {lastExport.size} · 用时
					{lastExport.seconds.toFixed(1)}s
					{#if exportGainNote}
						· {exportGainNote}
					{/if}
				{:else}
					使用与试听完全相同的引擎渲染，所听即所得。
					{#if loop.enabled}
						当前只导出循环区间的一遍。
					{/if}
				{/if}
			</p>
		</div>

		<div class="presets">
			<span class="label">预设</span>
			{#each PRESETS as preset (preset.id)}
				<button
					class:active={activePreset?.id === preset.id}
					onclick={() => applyPreset(preset.id)}
					title={preset.hint}
				>
					{preset.label}
					<em>{formatSpeed(preset.speed)} · {formatSemitones(preset.semitones)}</em>
				</button>
			{/each}
		</div>

		<p class="shortcuts">
			<kbd>空格</kbd> 播放/暂停　<kbd>←</kbd><kbd>→</kbd> 半音（配合
			<kbd>Shift</kbd> 为八度）　<kbd>↑</kbd><kbd>↓</kbd> 速度　<kbd>Tab</kbd>
			对比原声　<kbd>L</kbd> 循环播放　<kbd>0</kbd> 复位　<kbd>Shift</kbd>+拖动
			框选循环区间
		</p>
	{/if}
</main>

<style>
	main {
		max-width: 980px;
		margin: 0 auto;
		padding: 28px 20px 64px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.theme-switch {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}

	.theme-switch button {
		border: none;
		border-radius: 0;
		padding: 4px 10px;
		font-size: 12px;
		background: transparent;
	}

	.theme-switch button + button {
		border-left: 1px solid var(--border);
	}

	header h1 {
		margin: 0;
		font-size: 24px;
		letter-spacing: -0.01em;
	}

	.waveform-hint {
		color: var(--muted);
		font-size: 12px;
	}

	.link {
		background: none;
		border: none;
		padding: 0 0 0 8px;
		color: var(--accent);
		font-size: 12px;
		text-decoration: underline;
	}

	.link:hover {
		background: none;
	}

	.tagline {
		margin: 4px 0 0;
		color: var(--muted);
		font-size: 13px;
	}

	.dropzone {
		border: 1.5px dashed var(--border);
		border-radius: var(--radius);
		background: var(--panel);
		padding: 28px 20px;
		text-align: center;
		cursor: pointer;
		transition: border-color 0.15s ease, background 0.15s ease;
	}

	.dropzone:hover,
	.dropzone.dragging {
		border-color: var(--accent);
		background: var(--panel-2);
	}

	.dz-title {
		margin: 0;
		font-size: 15px;
	}

	.dz-title.error,
	.export-error {
		color: var(--danger);
	}

	.dz-sub {
		margin: 6px 0 0;
		color: var(--muted);
		font-size: 12px;
	}

	.bar {
		margin-top: 12px;
		height: 4px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.15s ease;
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.time {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}

	.time em {
		margin-left: 10px;
		font-style: normal;
		font-size: 12px;
	}

	.loop-readout {
		color: var(--muted);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 18px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 18px;
	}

	.mode-row {
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: 12px;
	}

	.label {
		color: var(--muted);
		font-size: 12px;
		white-space: nowrap;
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}

	.segmented button {
		border: none;
		border-radius: 0;
		padding: 5px 16px;
	}

	.segmented button + button {
		border-left: 1px solid var(--border);
	}

	.mode-hint {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
	}

	.toggles {
		display: flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
		padding-top: 4px;
		border-top: 1px solid var(--border);
	}

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}

	.export {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 14px 18px;
	}

	.export-head {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.export-head select {
		font: inherit;
		color: var(--text);
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
	}

	.export-note {
		margin: 8px 0 0;
		color: var(--muted);
		font-size: 12px;
	}

	.export-error {
		color: #f85149;
	}

	.presets {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.presets button {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		line-height: 1.3;
	}

	.presets button em {
		font-style: normal;
		font-size: 11px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.shortcuts {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
		line-height: 2;
	}

	kbd {
		display: inline-block;
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-bottom-width: 2px;
		border-radius: 4px;
		background: var(--panel-2);
		font-family: inherit;
		font-size: 11px;
	}

	@media (max-width: 640px) {
		.mode-row {
			grid-template-columns: 1fr;
			gap: 8px;
		}
	}
</style>
