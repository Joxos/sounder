// Regression: decode → peaks worker → export ownership chain.
//
// App.handleFiles() hands the SAME Float32Arrays to engine.load() and to
// buildPeakPyramid(), which TRANSFERS (detaches) their buffers. When the
// file's sample rate equals the AudioContext's, resampleToContextRate()
// returns the decoded arrays as-is, so the engine used to alias them — and
// exporting then threw:
//   Failed to execute 'postMessage' on 'MessagePort':
//   An ArrayBuffer is detached and could not be cloned.
//
// This reproduces the exact App order: load → buildPeakPyramid (transfer)
// → renderOffline, and requires the export to succeed afterwards.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

function resolveChromium() {
	const root = process.env.LOCALAPPDATA + '\\ms-playwright';
	for (const rev of ['chromium-1243', 'chromium-1234', 'chromium-1228']) {
		const exe = root + '\\' + rev + '\\chrome-win64\\chrome.exe';
		if (existsSync(exe)) return exe;
	}
	return undefined;
}

const browser = await chromium.launch({
	executablePath: resolveChromium(),
	args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
	if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(process.env.SOUNDER_URL ?? 'http://localhost:5183', { waitUntil: 'load' });

const result = await page.evaluate(async () => {
	const { AudioEngine } = await import('/src/lib/engine.ts');
	const { decodeFile } = await import('/src/lib/decode.ts');
	const { buildPeakPyramid } = await import('/src/lib/peaks.ts');
	const { encodeWav } = await import('/src/lib/wav.ts');

	// Use the AudioContext's OWN rate so resampleToContextRate() takes the
	// same-rate branch and returns the decoded arrays unchanged — the
	// aliasing path the bug requires.
	const probeCtx = new AudioContext();
	const SR = probeCtx.sampleRate;
	await probeCtx.close();

	const seconds = 4;
	const frames = Math.round(SR * seconds);
	const mono = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		mono[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.35;
	}
	const file = new File([encodeWav([mono], SR, 16)], 'same-rate.wav', { type: 'audio/wav' });
	const audio = await decodeFile(file);

	const engine = new AudioEngine();
	await engine.load(audio);

	// The exact App.svelte order — this TRANSFERS audio.channels' buffers.
	const pyramid = await buildPeakPyramid(audio.channels, audio.sampleRate);

	// Prove the hazard was actually hit: the decode's arrays must now be
	// detached (byteLength 0). If this is false the test proved nothing.
	const detached = audio.channels[0].byteLength === 0;

	let exportError = null;
	let outLength = null;
	let peak = 0;
	try {
		const out = await engine.renderOffline({ normalizeToPeakDb: -1 });
		outLength = out.length;
		const data = out.getChannelData(0);
		for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
	} catch (err) {
		exportError = err instanceof Error ? err.message : String(err);
	}

	// Second export must also work (the worklet copy must survive the first).
	let secondExportError = null;
	try {
		await engine.renderOffline({});
	} catch (err) {
		secondExportError = err instanceof Error ? err.message : String(err);
	}

	return {
		ctxRate: SR,
		decodedRate: audio.sampleRate,
		pyramidLevels: pyramid.levels.length,
		channelsDetached: detached,
		exportError,
		outLength,
		peak: Number(peak.toFixed(4)),
		secondExportError
	};
});

await browser.close();

console.log(JSON.stringify({ ...result, consoleErrors }, null, 2));

const pass =
	result.ctxRate === result.decodedRate &&
	result.channelsDetached &&
	result.pyramidLevels >= 4 &&
	result.exportError === null &&
	result.outLength > 0 &&
	result.peak > 0.1 &&
	result.secondExportError === null &&
	consoleErrors.length === 0;

console.log(pass ? '\nPASS: export survived the peak-worker transfer' : '\nFAIL');
process.exit(pass ? 0 : 1);
