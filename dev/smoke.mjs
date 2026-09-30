// Browser smoke test: loads the app in Chromium, runs the in-page DSP self-test,
// and verifies the full file -> decode -> playback path produces no console errors.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const URL_BASE = process.env.SOUNDER_URL ?? 'http://localhost:5183';

// Reuse a cached Chromium build; Playwright's default revision may not be present.
function resolveChromium() {
	const roots = [
		process.env.LOCALAPPDATA + '\\ms-playwright',
		process.env.USERPROFILE + '\\AppData\\Local\\ms-playwright'
	];
	for (const root of roots) {
		if (!root || !existsSync(root)) continue;
		for (const rev of ['chromium-1243', 'chromium-1234', 'chromium-1228']) {
			const exe = root + '\\' + rev + '\\chrome-win64\\chrome.exe';
			if (existsSync(exe)) return exe;
		}
	}
	return undefined;
}

const browser = await chromium.launch({
	executablePath: resolveChromium(),
	args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream']
});

const page = await browser.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
page.on('response', (res) => {
	if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
});

await page.goto(URL_BASE, { waitUntil: 'load' });

console.log('=== app loaded ===');
console.log('title:', await page.title());

// ---- 1. DSP self-test, run inside the page --------------------------
const checks = await page.evaluate(async () => {
	const mod = await import('/src/lib/selftest.ts');
	return mod.runSelfTest();
});

console.log('\n=== DSP self-test ===');
let failed = 0;
for (const c of checks) {
	if (!c.pass) failed++;
	console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(34)} ${c.detail}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

// ---- 2. End-to-end: inject a real file and drive the UI -------------
console.log('\n=== end-to-end file load ===');
const e2e = await page.evaluate(async () => {
	// Build a stereo WAV in-page and feed it through the same File input the UI uses.
	const { encodeWav } = await import('/src/lib/wav.ts');
	const sr = 44100;
	// Long enough that the whole measurement sequence below cannot run past the
	// end of the track (playback now rewinds to 0 when it finishes).
	const seconds = 20;
	const frames = sr * seconds;
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		const t = i / sr;
		left[i] = (Math.sin(2 * Math.PI * 330 * t) + 0.3 * Math.sin(2 * Math.PI * 660 * t)) * 0.3;
		right[i] = left[i] * 0.85;
	}
	const blob = encodeWav([left, right], sr, 16);
	const file = new File([blob], 'e2e-test.wav', { type: 'audio/wav' });

	const input = document.getElementById('file-input');
	const dt = new DataTransfer();
	dt.items.add(file);
	input.files = dt.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));

	// Wait for the app to leave the decoding state.
	const started = performance.now();
	while (performance.now() - started < 20000) {
		const canvas = document.querySelector('.wave canvas');
		if (canvas && canvas.width > 0) break;
		await new Promise((r) => setTimeout(r, 100));
	}

	await new Promise((r) => setTimeout(r, 1200));

	const canvas = document.querySelector('.wave canvas');
	let painted = false;
	if (canvas) {
		const ctx = canvas.getContext('2d');
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i] > 0) { painted = true; break; }
		}
	}

	// Height must be real, not collapsed to the 1px borders.
	const box = document.querySelector('.wave')?.getBoundingClientRect();
	const waveHeight = Math.round(box?.height ?? 0);

	return {
		hasCanvas: !!canvas,
		canvasWidth: canvas?.width ?? 0,
		canvasHeight: canvas?.height ?? 0,
		waveHeight,
		painted,
		hasSpeedSlider: !!document.getElementById('speed'),
		hasSemitoneSlider: !!document.getElementById('semitones'),
		transportText: document.querySelector('.transport .time')?.textContent?.trim() ?? '',
		errorVisible: !!document.querySelector('.dz-title.error')
	};
});

console.log(JSON.stringify(e2e, null, 2));

// ---- 3. Move the sliders and confirm nothing throws ----------------
const interaction = await page.evaluate(async () => {
	const semitones = document.getElementById('semitones');
	const speed = document.getElementById('speed');
	const setRange = (el, value) => {
		const proto = Object.getPrototypeOf(el);
		const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
		setter.call(el, value);
		el.dispatchEvent(new Event('input', { bubbles: true }));
	};
	setRange(semitones, 7);
	await new Promise((r) => setTimeout(r, 400));
	setRange(speed, 0.85);
	await new Promise((r) => setTimeout(r, 400));

	return {
		derivedReadout: document.querySelectorAll('.slider-head output')[0]?.textContent?.trim(),
		speedReadout: document.querySelectorAll('.slider-head output')[1]?.textContent?.trim(),
		band: document.querySelectorAll('.scale .band')[0]?.textContent?.trim(),
		outputLabel: document.querySelector('.transport .time em')?.textContent?.trim()
	};
});

console.log('\n=== slider interaction ===');
console.log(JSON.stringify(interaction, null, 2));

// ---- 4. Click a preset and the loop button --------------------------
await page.click('text=TikTok Slowed');
await new Promise((r) => setTimeout(r, 300));
const afterPreset = await page.evaluate(() => ({
	derived: document.querySelectorAll('.slider-head output')[0]?.textContent?.trim(),
	speed: document.querySelectorAll('.slider-head output')[1]?.textContent?.trim()
}));
console.log('\n=== after preset ===');
console.log(JSON.stringify(afterPreset, null, 2));

// ---- 5. Playhead advances, A/B and loop behave ----------------------
const runtime = await page.evaluate(async () => {
	// The 3s test file has long finished by now, and playback now rewinds to
	// 0 at the end, so restart from the top before measuring the playhead.
	const engine = window.__sounderEngine;
	const snap = (tag) => ({
		tag,
		position: Number(engine.position.toFixed(2)),
		playing: engine.isPlaying,
		duration: Number(engine.audioDuration.toFixed(2)),
		loop: engine.getLoop(),
		loopPlayback: engine.isLoopingPlayback
	});
	const trace = [snap('before')];
	engine.seek(0);
	await engine.play();
	await new Promise((r) => setTimeout(r, 1000));
	trace.push(snap('+1.0s'));

	const readPosition = () => {
		const text = document.querySelector('.transport .time')?.textContent ?? '';
		const m = text.match(/(\d+):(\d+)/);
		return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
	};

	const p0 = readPosition();
	await new Promise((r) => setTimeout(r, 1000));
	const p1 = readPosition();
	const advancing = p1 > p0;

	// A/B compare toggle
	const abButton = [...document.querySelectorAll('.transport button')].find((b) =>
		(b.textContent ?? '').includes('对比原声')
	);
	abButton?.click();
	await new Promise((r) => setTimeout(r, 400));
	const abOn = (abButton?.textContent ?? '').includes('正在对比');
	abButton?.click();
	await new Promise((r) => setTimeout(r, 400));
	const abOff = (abButton?.textContent ?? '').includes('对比原声');

	// Loop region: shift-drag across the middle of the waveform
	const wave = document.querySelector('.wave');
	const box = wave.getBoundingClientRect();
	const y = box.top + box.height / 2;
	const down = new PointerEvent('pointerdown', {
		clientX: box.left + box.width * 0.3,
		clientY: y,
		shiftKey: true,
		bubbles: true,
		pointerId: 1
	});
	wave.dispatchEvent(down);
	wave.dispatchEvent(
		new PointerEvent('pointermove', {
			clientX: box.left + box.width * 0.7,
			clientY: y,
			shiftKey: true,
			bubbles: true,
			pointerId: 1
		})
	);
	wave.dispatchEvent(
		new PointerEvent('pointerup', {
			clientX: box.left + box.width * 0.7,
			clientY: y,
			shiftKey: true,
			bubbles: true,
			pointerId: 1
		})
	);
	await new Promise((r) => setTimeout(r, 300));
	const loopReadout = document.querySelector('.loop-readout')?.textContent?.trim() ?? '';

	// Reset
	window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
	await new Promise((r) => setTimeout(r, 300));
	const afterReset = {
		derived: document.querySelectorAll('.slider-head output')[0]?.textContent?.trim(),
		speed: document.querySelectorAll('.slider-head output')[1]?.textContent?.trim()
	};

	return { p0, p1, advancing, abOn, abOff, loopReadout, afterReset, trace };
});

console.log('\n=== runtime behaviour ===');
console.log(JSON.stringify(runtime, null, 2));

// ---- pause -> seek -> play must land where the seek asked --------------
const seekAfterPause = await page.evaluate(async () => {
	const engine = window.__sounderEngine;
	engine.seek(0);
	await engine.play();
	await new Promise((r) => setTimeout(r, 300));

	engine.pause();
	engine.seek(8);
	await new Promise((r) => setTimeout(r, 150));
	await engine.play();
	await new Promise((r) => setTimeout(r, 600));
	const after = engine.position;
	engine.pause();
	return after;
});
console.log(`\n=== seek while paused ===`);
console.log(`  requested 8s, got ${seekAfterPause.toFixed(2)}s`);
const seekOk = seekAfterPause > 7.0 && seekAfterPause < 10.0;
console.log(`  resume lands on the seek target: ${seekOk ? 'OK' : 'FAIL'}`);
await page.screenshot({ path: 'dev/screenshot.png', fullPage: true });
console.log('\nscreenshot -> dev/screenshot.png');

console.log('\n=== console errors ===');
console.log(consoleErrors.length === 0 ? '(none)' : consoleErrors.join('\n'));
console.log('=== failed requests ===');
console.log(failedRequests.length === 0 ? '(none)' : failedRequests.join('\n'));

await browser.close();

const conditions = {
	'dsp checks': failed === 0,
	'waveform painted': e2e.painted,
	'waveform height': e2e.waveHeight >= 60,
	'speed slider': e2e.hasSpeedSlider,
	'playhead advances': runtime.advancing,
	'A/B on': runtime.abOn,
	'A/B off': runtime.abOff,
	'loop region set': runtime.loopReadout.length > 0,
	'seek while paused': seekOk,
	'no console errors': consoleErrors.length === 0
};
const broken = Object.entries(conditions)
	.filter(([, v]) => !v)
	.map(([k]) => k);
if (broken.length) console.log('failing conditions:', broken.join(', '));
const ok = broken.length === 0;
console.log(`\n=== RESULT: ${ok ? 'OK' : 'PROBLEMS FOUND'} ===`);
process.exit(ok ? 0 : 1);
