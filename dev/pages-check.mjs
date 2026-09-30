// Verify the built app works from a SUBDIRECTORY, the way GitHub Pages serves a
// project page (https://user.github.io/<repo>/). Serving dist/ from a nested
// folder catches absolute-path assumptions that a root-served preview misses.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

// Resolve to native separators up front: path.join() returns backslashes on
// Windows, so a forward-slash ROOT would fail the startsWith() guard below.
const ROOT = path.resolve('C:/Users/xyg/AppData/Local/Temp/sounder-pages-test');
const SUB = path.join(ROOT, 'sounder');
const DIST = path.resolve('D:/source/dsh/sounder/dist');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.png': 'image/png',
	'.map': 'application/json'
};

// Rebuild the nested layout from dist.
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(SUB, { recursive: true });
fs.cpSync(DIST, SUB, { recursive: true });

const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost');
	let filePath = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
	if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
		res.writeHead(403).end('forbidden');
		return;
	}
	if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
		filePath = path.join(filePath, 'index.html');
	}
	if (!fs.existsSync(filePath)) {
		res.writeHead(404).end('not found');
		return;
	}
	res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
	fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(4199, r));

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

const base = 'http://localhost:4199/sounder/';
await page.goto(base, { waitUntil: 'load' });

// Report what actually rendered before asserting on it.
const probe = await page.evaluate(() => ({
	readyState: document.readyState,
	bodyHtmlLength: document.body.innerHTML.length,
	bodyPreview: document.body.innerHTML.slice(0, 300),
	scripts: [...document.querySelectorAll('script')].map((s) => s.getAttribute('src'))
}));
console.log('page probe:', JSON.stringify(probe, null, 2));
console.log('console errors so far:', errors.length ? errors.join('\n') : '(none)');

await page.waitForSelector('#file-input', { state: 'attached', timeout: 15000 });

// Load a real file through the app and confirm the whole UI comes up.
const audio = await page.evaluate(async () => {
	// Generate a WAV in-page using a minimal inline encoder.
	const sr = 44100;
	const seconds = 4;
	const frames = sr * seconds;
	const l = new Float32Array(frames);
	const r = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		const t = i / sr;
		const env = Math.min(1, i / 2000, (frames - i) / 2000);
		l[i] = (Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 880 * t)) * 0.3 * env;
		r[i] = l[i] * 0.9;
	}
	const bytes = 44 + frames * 2 * 2;
	const buf = new ArrayBuffer(bytes);
	const v = new DataView(buf);
	const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
	str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
	v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
	str(36, 'data'); v.setUint32(40, frames * 4, true);
	let o = 44;
	for (let i = 0; i < frames; i++) {
		v.setInt16(o, Math.max(-32768, Math.min(32767, l[i] * 32767)), true); o += 2;
		v.setInt16(o, Math.max(-32768, Math.min(32767, r[i] * 32767)), true); o += 2;
	}
	const file = new File([buf], 'tone.wav', { type: 'audio/wav' });
	const dt = new DataTransfer();
	dt.items.add(file);
	const input = document.getElementById('file-input');
	input.files = dt.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));

	const started = performance.now();
	while (performance.now() - started < 25000) {
		if (document.querySelector('.transport')) break;
		await new Promise((r2) => setTimeout(r2, 100));
	}
	await new Promise((r2) => setTimeout(r2, 1500));

	const canvas = document.querySelector('.wave canvas');
	let painted = false;
	if (canvas && canvas.width > 0) {
		const ctx = canvas.getContext('2d');
		const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { painted = true; break; }
	}
	return {
		ready: !!document.querySelector('.transport'),
		painted,
		hasSliders: !!document.getElementById('speed') && !!document.getElementById('semitones'),
		hasExport: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('导出文件')),
		hasMeter: !!document.querySelector('.meter'),
		theme: document.documentElement.dataset.theme
	};
});

await page.screenshot({ path: 'D:/source/dsh/sounder/dev/screenshot-pages.png', fullPage: true });

console.log('served from:', base);
console.log(JSON.stringify(audio, null, 2));
console.log('console errors:', errors.length ? '\n' + errors.join('\n') : '(none)');

const ok =
	audio.ready && audio.painted && audio.hasSliders && audio.hasExport && audio.hasMeter && errors.length === 0;
console.log(`\n=== RESULT: ${ok ? 'SUB-PATH DEPLOY OK' : 'BROKEN ON SUB-PATH'} ===`);

await browser.close();
server.close();
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
