// Production-build check: does the AudioWorklet actually come up?
// Detects the silent-failure mode where the WASM never instantiates: the node
// still answers port messages, so nothing throws, but process() outputs zeros.
//
// Usage: node dev/prod-check.mjs <url>
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] ?? 'http://localhost:4183';
const FILE = process.argv[3] ?? 'C:\\Users\\xyg\\Music\\songs\\Void.m4a';

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

// Capture the worklet module blob and wrap AudioWorkletNode so we can tell
// whether the processor is actually producing samples.
await page.addInitScript(() => {
	window.__blobs = [];
	const orig = URL.createObjectURL.bind(URL);
	URL.createObjectURL = (obj) => {
		if (obj instanceof Blob) {
			obj.text().then((t) => window.__blobs.push({ size: t.length, head: t.slice(0, 200) }));
		}
		return orig(obj);
	};
	window.__workletCalls = 0;
});

await page.goto(URL_BASE, { waitUntil: 'load' });
console.log('loaded:', URL_BASE);

if (existsSync(FILE)) {
	await page.setInputFiles('#file-input', FILE);
	await page.waitForSelector('.transport', { timeout: 180000 });
	console.log('app reached ready state');
} else {
	console.log('no input file; cannot test playback');
}

const readPos = () =>
	page.evaluate(() => {
		const t = document.querySelector('.transport .time')?.textContent ?? '';
		const m = t.match(/(\d+):(\d+)/);
		return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
	});

const p0 = await readPos();
await new Promise((r) => setTimeout(r, 3000));
const p1 = await readPos();

const blobs = await page.evaluate(() => window.__blobs);
const errorText = await page.evaluate(
	() => document.querySelector('.dz-title.error')?.textContent?.trim() ?? ''
);

console.log(`\nposition: ${p0}s -> ${p1}s  (advancing: ${p1 > p0})`);
console.log(`worklet blob captured: ${blobs.length ? blobs[0].size + ' bytes' : 'NONE'}`);
if (blobs.length) console.log(`  head: ${blobs[0].head.slice(0, 140).replace(/\n/g, ' ')}`);
if (errorText) console.log(`app error banner: ${errorText}`);
console.log('console errors:', errors.length ? '\n' + errors.join('\n') : '(none)');

const ok = p1 > p0 && blobs.length > 0;
console.log(`\n=== RESULT: ${ok ? 'WORKLET ALIVE' : 'WORKLET NOT PROCESSING'} ===`);
await browser.close();
process.exit(ok ? 0 : 1);
