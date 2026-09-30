// Drive the REAL app UI with a real file and meter the processed output.
// Usage: node dev/app-audio-test.mjs "C:\path\to\song.m4a"
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const FILE = process.argv[2];
if (!FILE || !existsSync(FILE)) {
	console.error('usage: node dev/app-audio-test.mjs <audio-file>');
	process.exit(2);
}

function resolveChromium() {
	const root = process.env.LOCALAPPDATA + '\\ms-playwright';
	for (const rev of ['chromium-1243', 'chromium-1234', 'chromium-1228']) {
		const exe = root + '\\' + rev + '\\chrome-win64\\chrome.exe';
		if (existsSync(exe)) return exe;
	}
}

const browser = await chromium.launch({
	executablePath: resolveChromium(),
	args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(process.env.SOUNDER_URL ?? 'http://localhost:5183', { waitUntil: 'load' });

// Install the meter BEFORE loading, hooking the engine's mix bus as soon as it exists.
await page.evaluate(() => {
	const w = window;
	w.__meter = { peak: 0, ctxRate: null, trackRate: null, hooked: false };
	w.__hook = setInterval(() => {
		const engine = w.__sounderEngine;
		if (!engine || !engine.outputNode || w.__meter.hooked) return;
		const ctx = engine.audioContext;
		if (!ctx) return;
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		engine.outputNode.connect(analyser);
		const buf = new Float32Array(analyser.fftSize);
		w.__meter.hooked = true;
		w.__meter.ctxRate = ctx.sampleRate;
		w.__meter.trackRate = engine.sampleRate;
		const tick = () => {
			analyser.getFloatTimeDomainData(buf);
			for (const v of buf) w.__meter.peak = Math.max(w.__meter.peak, Math.abs(v));
			requestAnimationFrame(tick);
		};
		tick();
	}, 100);
});

console.log('loading file through the real file input...');
await page.setInputFiles('#file-input', FILE);

// Wait for the app to finish decoding.
await page.waitForSelector('.transport', { timeout: 180000 });
console.log('app reached the ready state');

const results = [];
async function measure(label, ms) {
	await page.evaluate(() => (window.__meter.peak = 0));
	await new Promise((r) => setTimeout(r, ms));
	const peak = await page.evaluate(() => window.__meter.peak);
	results.push([label, peak]);
	return peak;
}

await measure('identity', 2000);

// Change pitch via the actual slider, as a user would.
await page.evaluate(() => {
	const el = document.getElementById('semitones');
	const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
	setter.call(el, 7);
	el.dispatchEvent(new Event('input', { bubbles: true }));
});
await measure('slider +7 semitones', 2000);

await page.evaluate(() => {
	const el = document.getElementById('speed');
	const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
	setter.call(el, 0.7);
	el.dispatchEvent(new Event('input', { bubbles: true }));
});
await measure('slider 70% speed', 2000);

// A/B toggle
await page.evaluate(() => {
	[...document.querySelectorAll('.transport button')]
		.find((b) => (b.textContent ?? '').includes('对比原声'))
		?.click();
});
await measure('A/B original', 1500);
await page.evaluate(() => {
	[...document.querySelectorAll('.transport button')]
		.find((b) => (b.textContent ?? '').includes('原声'))
		?.click();
});
await measure('back to processed', 1500);

const meta = await page.evaluate(() => ({
	ctxRate: window.__meter.ctxRate,
	trackRate: window.__meter.trackRate,
	hooked: window.__meter.hooked
}));

console.log(`\ncontext rate: ${meta.ctxRate} Hz | track rate: ${meta.trackRate} Hz | meter hooked: ${meta.hooked}`);
console.log('\n--- peak amplitude through the app ---');
for (const [label, peak] of results) {
	console.log(`${label.padEnd(22)}: ${peak.toFixed(4)}  ${peak > 0.005 ? 'OK' : '*** SILENT ***'}`);
}

// ---- 6. Loudness matching: changing speed/pitch must not move the level ----
const loudness = await page.evaluate(async () => {
	const engine = window.__sounderEngine;
	const measure = async (ms) => {
		await new Promise((r) => setTimeout(r, ms));
		const reading = engine.tick(0.016);
		return reading ? { rmsDb: reading.rmsDb, correctionDb: reading.correctionDb } : null;
	};

	const readings = {};
	engine.setParams({ semitones: 0, speed: 1, mode: 'independent' });
	readings.identity = await measure(1600);
	engine.setParams({ semitones: 0, speed: 0.6, mode: 'independent' });
	readings.slow60 = await measure(2000);
	engine.setParams({ semitones: 0, speed: 1, mode: 'independent' });
	readings.back = await measure(2000);

	return {
		readings,
		sourceRmsDb: engine.sourceRmsDb,
		hasMeter: !!engine.outputNode
	};
});

console.log('\n--- loudness matching ---');
const fmt = (d) => (Number.isFinite(d) ? `${d.toFixed(1)} dB` : '—');
console.log(`  source RMS        : ${fmt(loudness.sourceRmsDb)}`);
for (const [k, v] of Object.entries(loudness.readings)) {
	console.log(`  ${k.padEnd(17)}: output RMS ${fmt(v.rmsDb)}, correction ${fmt(v.correctionDb)}`);
}
const spread =
	Math.abs(loudness.readings.identity.rmsDb - loudness.readings.slow60.rmsDb) < 2.5;
console.log(`  level drift identity -> 60% speed: ${spread ? 'OK (compensated)' : '*** LOUDNESS SHIFT ***'}`);

// ---- 7. End of track: stop and rewind, or loop ------------------------
const endOfTrack = await page.evaluate(async () => {
	const engine = window.__sounderEngine;
	const seekNearEnd = async () => {
		engine.seek(Math.max(0, engine.audioDuration - 0.35));
		await new Promise((r) => setTimeout(r, 300));
	};

	engine.setLoopPlayback(false);
	let ended = 0;
	engine.onEnded = () => ended++;
	await seekNearEnd();
	await new Promise((r) => setTimeout(r, 2500));
	const afterStop = {
		position: engine.position,
		playing: engine.isPlaying,
		endedFired: ended > 0
	};

	engine.setLoopPlayback(true);
	await engine.play();
	await seekNearEnd();
	await new Promise((r) => setTimeout(r, 2500));
	const afterLoop = {
		position: engine.position,
		playing: engine.isPlaying
	};

	engine.setLoopPlayback(false);
	engine.pause();
	engine.onEnded = null;
	return { afterStop, afterLoop };
});

console.log('\n--- end of track ---');
console.log(
	`  loop off -> position ${endOfTrack.afterStop.position.toFixed(2)}s, playing=${endOfTrack.afterStop.playing}, onEnded=${endOfTrack.afterStop.endedFired}`
);
console.log(
	`  loop on  -> position ${endOfTrack.afterLoop.position.toFixed(2)}s, playing=${endOfTrack.afterLoop.playing}`
);
const stopOk =
	endOfTrack.afterStop.position < 0.6 &&
	!endOfTrack.afterStop.playing &&
	endOfTrack.afterStop.endedFired;
const loopOk = endOfTrack.afterLoop.playing && endOfTrack.afterLoop.position < 3.0;
console.log(`  stop + rewind: ${stopOk ? 'OK' : 'FAIL'}`);
console.log(`  loop wraps and keeps playing: ${loopOk ? 'OK' : 'FAIL'}`);

// ---- 8. Theme ----------------------------------------------------------
const theme = await page.evaluate(async () => {
	const root = document.documentElement;
	const read = () => ({
		theme: root.dataset.theme,
		bg: getComputedStyle(document.body).backgroundColor
	});
	const click = async (label) => {
		[...document.querySelectorAll('.theme-switch button')]
			.find((b) => b.textContent.trim() === label)
			?.click();
		await new Promise((r) => setTimeout(r, 150));
	};

	const initial = read();
	await click('浅色');
	const light = read();
	await click('深色');
	const dark = read();
	await click('自动');
	const system = read();
	return { initial, light, dark, system };
});

console.log('\n--- theme ---');
for (const [k, v] of Object.entries(theme)) {
	console.log(`  ${k.padEnd(8)}: ${String(v.theme).padEnd(6)} bg=${v.bg}`);
}
const themeOk =
	theme.initial.theme === 'dark' &&
	theme.light.theme === 'light' &&
	theme.dark.theme === 'dark' &&
	theme.light.bg !== theme.dark.bg;
console.log(`  switching: ${themeOk ? 'OK' : 'FAIL'}`);
await page.screenshot({ path: 'dev/screenshot-light.png', fullPage: true });

console.log('\nconsole errors:', errors.length ? '\n' + errors.join('\n') : '(none)');

await page.screenshot({ path: 'dev/screenshot.png', fullPage: true });
console.log('screenshot -> dev/screenshot.png');

const audioOk = results[0][1] > 0.005 && results[1][1] > 0.005 && results[2][1] > 0.005;
const failures = [];
if (!audioOk) failures.push('processed path silent');
if (!stopOk) failures.push('end-of-track stop/rewind');
if (!loopOk) failures.push('loop playback');
if (!themeOk) failures.push('theme switching');
console.log(`\n=== RESULT: ${failures.length ? 'FAILED: ' + failures.join(', ') : 'OK'} ===`);
await browser.close();
process.exit(failures.length ? 1 : 0);
