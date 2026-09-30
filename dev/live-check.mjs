// End-to-end check against the LIVE GitHub Pages deployment.
// Loading the real URL is the only way to be sure routing, relative assets and
// the AudioWorklet all work on Pages (which cannot set COOP/COEP headers).
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const URL_BASE = process.env.SOUNDER_URL ?? 'https://joxos.github.io/sounder/';

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
page.on('response', (r) => {
	if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
});

await page.goto(URL_BASE, { waitUntil: 'load' });
await page.waitForSelector('#file-input', { state: 'attached', timeout: 20000 });

const result = await page.evaluate(async () => {
	// Build a 4 s stereo WAV in-page and push it through the real file input.
	const sr = 44100;
	const seconds = 4;
	const frames = sr * seconds;
	const l = new Float32Array(frames);
	const r = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		const t = i / sr;
		const env = Math.min(1, i / 2000, (frames - i) / 2000);
		l[i] = (Math.sin(2 * Math.PI * 330 * t) + 0.3 * Math.sin(2 * Math.PI * 660 * t)) * 0.3 * env;
		r[i] = l[i] * 0.9;
	}
	const bytes = 44 + frames * 4;
	const buf = new ArrayBuffer(bytes);
	const v = new DataView(buf);
	const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	str(0, 'RIFF');
	v.setUint32(4, bytes - 8, true);
	str(8, 'WAVE');
	str(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 2, true);
	v.setUint32(24, sr, true);
	v.setUint32(28, sr * 4, true);
	v.setUint16(32, 4, true);
	v.setUint16(34, 16, true);
	str(36, 'data');
	v.setUint32(40, frames * 4, true);
	let o = 44;
	for (let i = 0; i < frames; i++) {
		v.setInt16(o, Math.max(-32768, Math.min(32767, l[i] * 32767)), true);
		o += 2;
		v.setInt16(o, Math.max(-32768, Math.min(32767, r[i] * 32767)), true);
		o += 2;
	}

	const file = new File([buf], 'live-test.wav', { type: 'audio/wav' });
	const dt = new DataTransfer();
	dt.items.add(file);
	const input = document.getElementById('file-input');
	input.files = dt.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));

	const started = performance.now();
	while (performance.now() - started < 30000) {
		if (document.querySelector('.transport')) break;
		await new Promise((x) => setTimeout(x, 100));
	}
	await new Promise((x) => setTimeout(x, 2000));

	const canvas = document.querySelector('.wave canvas');
	let painted = false;
	if (canvas && canvas.width > 0) {
		const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { painted = true; break; }
	}

	// Nudge a slider and make sure the engine survives on the live origin.
	const speed = document.getElementById('speed');
	const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(speed), 'value').set;
	setter.call(speed, 0.7);
	speed.dispatchEvent(new Event('input', { bubbles: true }));
	await new Promise((x) => setTimeout(x, 800));

	return {
		ready: !!document.querySelector('.transport'),
		painted,
		speedReadout: document.querySelectorAll('.slider-head output')[1]?.textContent?.trim(),
		hasExport: [...document.querySelectorAll('button')].some((b) =>
			(b.textContent ?? '').includes('导出文件')
		),
		hasMeter: !!document.querySelector('.meter'),
		hasLoopButton: [...document.querySelectorAll('.transport button')].some((b) =>
			(b.textContent ?? '').includes('循环播放')
		),
		theme: document.documentElement.dataset.theme,
		crossOriginIsolated: window.crossOriginIsolated
	};
});

await page.screenshot({ path: 'D:/source/dsh/sounder/dev/screenshot-live.png', fullPage: true });

console.log('url:', URL_BASE);
console.log(JSON.stringify(result, null, 2));
console.log('console/network errors:', errors.length ? '\n' + errors.join('\n') : '(none)');

const ok =
	result.ready &&
	result.painted &&
	result.speedReadout?.includes('70%') &&
	result.hasExport &&
	result.hasMeter &&
	result.hasLoopButton &&
	errors.length === 0;
console.log(`\n=== RESULT: ${ok ? 'LIVE SITE OK' : 'LIVE SITE BROKEN'} ===`);
await browser.close();
process.exit(ok ? 0 : 1);
