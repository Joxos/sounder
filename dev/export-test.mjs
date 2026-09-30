// Export round-trip: does the downloaded file match what the preview showed?
//
// Renders offline, encodes to each format, then DECODES THE RESULT BACK and
// measures its pitch and duration. That closes the loop — a file that "looks
// fine" but is truncated or mis-pitched will fail here.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

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

const out = await page.evaluate(async () => {
	const { AudioEngine } = await import('/src/lib/engine.ts');
	const { encodeBuffer, buildFilename } = await import('/src/lib/export.ts');
	const { encodeWav } = await import('/src/lib/wav.ts');
	const { decodeFile } = await import('/src/lib/decode.ts');
	const { measurePitch } = await import('/src/lib/selftest.ts');

	const SR = 44100;
	const SECONDS = 6;
	const BASE = 440;

	// Source: 440 Hz with a bit of 2nd harmonic so pitch detection is honest.
	const frames = SR * SECONDS;
	const mono = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		const t = i / SR;
		mono[i] = (Math.sin(2 * Math.PI * BASE * t) + 0.25 * Math.sin(4 * Math.PI * BASE * t)) * 0.35;
	}
	const sourceFile = new File([encodeWav([mono], SR, 16)], 'src.wav', { type: 'audio/wav' });
	const decoded = await decodeFile(sourceFile);

	const engine = new AudioEngine();
	await engine.load(decoded);

	const SEMITONES = 7;
	const SPEED = 0.8;

	const measureBuffer = (buf) => {
		const ch = buf.getChannelData(0);
		const start = Math.floor(buf.length * 0.2);
		const len = Math.floor(buf.length * 0.5);
		return {
			pitch: measurePitch(ch, buf.sampleRate, start, len),
			duration: buf.duration
		};
	};

	const peakOf = (buf) => {
		let p = 0;
		for (let c = 0; c < buf.numberOfChannels; c++) {
			const d = buf.getChannelData(c);
			for (let i = 0; i < d.length; i++) {
				const a = Math.abs(d[i]);
				if (a > p) p = a;
			}
		}
		return p;
	};

	const results = [];

	// --- 1. Offline render matches the requested settings ---------------
	engine.setParams({ semitones: SEMITONES, speed: SPEED, mode: 'independent' });
	engine.setVolume(1);
	const rendered = await engine.renderOffline();
	const m = measureBuffer(rendered);
	const gotSemitones = 12 * Math.log2(m.pitch / BASE);
	const wantDuration = SECONDS / SPEED;
	results.push({
		stage: 'renderOffline',
		ok: Math.abs(gotSemitones - SEMITONES) < 0.8 && Math.abs(m.duration - wantDuration) < 0.4,
		detail:
			`pitch ${gotSemitones >= 0 ? '+' : ''}${gotSemitones.toFixed(2)}st (want ${SEMITONES}), ` +
			`dur ${m.duration.toFixed(2)}s (want ${wantDuration.toFixed(2)}s)`
	});

	// --- 2. Each encoded format decodes back to the same audio -----------
	for (const format of ['wav', 'mp3', 'm4a']) {
		try {
			const t0 = performance.now();
			const blob = await encodeBuffer(rendered, { format, bitrateKbps: 256 });
			const encodeMs = performance.now() - t0;

			const back = await decodeFile(new File([blob], `out.${format}`, { type: blob.type }));
			const bm = {
				pitch: measurePitch(back.channels[0], back.sampleRate, Math.floor(back.channels[0].length * 0.2), Math.floor(back.channels[0].length * 0.5)),
				duration: back.duration
			};
			const bs = 12 * Math.log2(bm.pitch / BASE);
			// Lossy formats can drift a little; allow ~0.8 semitones and 0.8 s.
			results.push({
				stage: `encode+decode ${format}`,
				ok:
					Math.abs(bs - gotSemitones) < 0.8 &&
					Math.abs(back.duration - m.duration) < 0.8 &&
					blob.size > 2000,
				detail:
					`${(blob.size / 1024).toFixed(0)} KB, enc ${(encodeMs / 1000).toFixed(1)}s, ` +
					`decoded ${bs >= 0 ? '+' : ''}${bs.toFixed(2)}st / ${back.duration.toFixed(2)}s ` +
					`(src +${gotSemitones.toFixed(2)}st / ${m.duration.toFixed(2)}s), ` +
					`name=${buildFilename('src', format, SEMITONES, SPEED)}`
			});
		} catch (e) {
			results.push({ stage: `encode+decode ${format}`, ok: false, detail: e.message });
		}
	}

	// --- 5. Loudness compensation must NOT touch the export ---------------
	// It is a monitoring aid only, so the rendered file must be identical
	// whether it is on or off.
	engine.setVolume(1);
	engine.setLoudnessMatch(false);
	const matchOff = await engine.renderOffline();
	engine.setLoudnessMatch(true);
	const matchOn = await engine.renderOffline();
	let maxDiff = 0;
	for (let c = 0; c < matchOff.numberOfChannels; c++) {
		const a = matchOff.getChannelData(c);
		const b = matchOn.getChannelData(c);
		for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
	}
	results.push({
		stage: 'loudness match excluded from export',
		ok: maxDiff < 1e-6,
		detail: `max sample difference ${maxDiff.toExponential(2)} between match on/off`
	});

	// --- 6. Volume must reach the file ----------------------------------
	engine.setVolume(1);
	const full = await engine.renderOffline();
	const fullPeak = peakOf(full);
	engine.setVolume(0.25);
	const quiet = await engine.renderOffline();
	const quietPeak = peakOf(quiet);
	results.push({
		stage: 'volume written to export',
		ok: quietPeak < fullPeak * 0.45,
		detail: `peak ${fullPeak.toFixed(3)} -> ${quietPeak.toFixed(3)} at 25% volume`
	});

	// --- 7. Peak normalisation -------------------------------------------
	engine.setVolume(1);
	const normalized = await engine.renderOffline({ normalizeToPeakDb: -1 });
	const normPeakDb = 20 * Math.log10(peakOf(normalized));
	results.push({
		stage: 'peak normalization',
		ok: Math.abs(normPeakDb - -1) < 0.15,
		detail: `peak ${normPeakDb.toFixed(2)} dBFS (want -1)`
	});

	// --- 7. Loop region exports just that region -------------------------
	engine.setLoop(true, 1.0, 3.0);
	const looped = await engine.renderOffline();
	results.push({
		stage: 'loop region export',
		ok: Math.abs(looped.duration - 2.0 / SPEED) < 0.5,
		detail: `${looped.duration.toFixed(2)}s (want ${(2.0 / SPEED).toFixed(2)}s for 1.0–3.0s at ${SPEED}x)`
	});
	engine.setLoop(false, 0, 0);

	// --- 5. Optional: export a real file end to end ----------------------
	results.push({
		stage: 'real file',
		ok: true,
		detail: 'skipped (pass a file path to include)'
	});

	engine.dispose();
	return results;
});

const REAL_FILE = process.argv[2];
if (REAL_FILE && existsSync(REAL_FILE)) {
	console.log(`\n--- real file: ${REAL_FILE} ---`);
	const real = await page.evaluate(async (bytes) => {
		const { AudioEngine } = await import('/src/lib/engine.ts');
		const { encodeBuffer, buildFilename } = await import('/src/lib/export.ts');
		const { decodeFile } = await import('/src/lib/decode.ts');

		const file = new File([new Uint8Array(bytes)], 'real.m4a', { type: 'audio/mp4' });
		const t0 = performance.now();
		const decoded = await decodeFile(file);
		const decodeMs = performance.now() - t0;

		const engine = new AudioEngine();
		await engine.load(decoded);
		engine.setParams({ semitones: 3, speed: 0.85, mode: 'independent' });

		const r0 = performance.now();
		const rendered = await engine.renderOffline();
		const renderMs = performance.now() - r0;

		const e0 = performance.now();
		const mp3 = await encodeBuffer(rendered, { format: 'mp3', bitrateKbps: 256 });
		const encodeMs = performance.now() - e0;

		// Confirm the result is real, decodable audio of the right length.
		const back = await decodeFile(new File([mp3], 'out.mp3', { type: 'audio/mpeg' }));
		engine.dispose();
		return {
			srcSeconds: decoded.duration,
			channels: decoded.channels.length,
			decodeMs: Math.round(decodeMs),
			renderSeconds: rendered.duration,
			renderMs: Math.round(renderMs),
			mp3Kb: Math.round(mp3.size / 1024),
			encodeMs: Math.round(encodeMs),
			decodedSeconds: back.duration,
			filename: buildFilename('Void', 'mp3', 3, 0.85)
		};
	}, Array.from(new Uint8Array((await import('node:fs')).readFileSync(REAL_FILE))));

	console.log(`  source        : ${real.srcSeconds.toFixed(1)}s, ${real.channels}ch, decoded in ${real.decodeMs}ms`);
	console.log(`  render @3st/85%: ${real.renderSeconds.toFixed(1)}s audio in ${real.renderMs}ms (${(real.renderSeconds / (real.renderMs / 1000)).toFixed(0)}x realtime)`);
	console.log(`  mp3 encode    : ${real.mp3Kb} KB in ${real.encodeMs}ms`);
	console.log(`  decoded back  : ${real.decodedSeconds.toFixed(1)}s  (${real.filename})`);
	const realOk = Math.abs(real.decodedSeconds - real.renderSeconds) < 1.0 && real.mp3Kb > 100;
	console.log(`  -> ${realOk ? 'OK' : 'PROBLEM'}`);
}

console.log('--- export round-trip ---');
let failed = 0;
for (const r of out) {
	if (!r.ok) failed++;
	console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.stage.padEnd(26)} ${r.detail}`);
}
console.log('\nconsole errors:', errors.length ? '\n' + errors.join('\n') : '(none)');
console.log(`\n=== RESULT: ${failed === 0 ? 'OK' : failed + ' FAILURES'} ===`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
