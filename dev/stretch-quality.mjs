// How much does the stretch engine smear at slow speeds, and does a larger
// `blockMs` help?
//
// Ground truth: a *tempo-only* stretch (semitones = 0) should not change the
// spectrum, only warp time. So compare the output's average spectrum against
// the input's. High-frequency loss is exactly what "变糊" means perceptually.
//
// Usage: node dev/stretch-quality.mjs
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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(process.env.SOUNDER_URL ?? 'http://localhost:5183', { waitUntil: 'load' });

const out = await page.evaluate(async () => {
	const SignalsmithStretch = (await import('/dev/browser-libs.ts')).SignalsmithStretch;

	// ---- minimal radix-2 FFT -------------------------------------------
	function fft(re, im) {
		const n = re.length;
		for (let i = 1, j = 0; i < n; i++) {
			let bit = n >> 1;
			for (; j & bit; bit >>= 1) j ^= bit;
			j ^= bit;
			if (i < j) {
				[re[i], re[j]] = [re[j], re[i]];
				[im[i], im[j]] = [im[j], im[i]];
			}
		}
		for (let len = 2; len <= n; len <<= 1) {
			const ang = (-2 * Math.PI) / len;
			const wr = Math.cos(ang);
			const wi = Math.sin(ang);
			for (let i = 0; i < n; i += len) {
				let cr = 1;
				let ci = 0;
				for (let k = 0; k < len / 2; k++) {
					const ur = re[i + k];
					const ui = im[i + k];
					const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
					const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
					re[i + k] = ur + vr;
					im[i + k] = ui + vi;
					re[i + k + len / 2] = ur - vr;
					im[i + k + len / 2] = ui - vi;
					const ncr = cr * wr - ci * wi;
					ci = cr * wi + ci * wr;
					cr = ncr;
				}
			}
		}
	}

	/** Average magnitude spectrum (Hann window, 50% overlap). */
	function avgSpectrum(data, sampleRate, fftSize = 4096) {
		const win = new Float32Array(fftSize);
		for (let i = 0; i < fftSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
		const acc = new Float64Array(fftSize / 2);
		let frames = 0;
		for (let offset = 0; offset + fftSize <= data.length; offset += fftSize / 2) {
			const re = new Float32Array(fftSize);
			const im = new Float32Array(fftSize);
			for (let i = 0; i < fftSize; i++) re[i] = data[offset + i] * win[i];
			fft(re, im);
			for (let b = 0; b < fftSize / 2; b++) acc[b] += Math.hypot(re[b], im[b]);
			frames++;
		}
		for (let b = 0; b < acc.length; b++) acc[b] /= Math.max(1, frames);
		return { spec: acc, binHz: sampleRate / fftSize };
	}

	/** Energy ratio between two spectra over a frequency band, in dB. */
	function bandRatioDb(input, output, loHz, hiHz) {
		const { spec: sIn, binHz } = input;
		const sOut = output.spec;
		const b0 = Math.max(1, Math.round(loHz / binHz));
		const b1 = Math.min(sIn.length - 1, Math.round(hiHz / binHz));
		let ein = 0;
		let eout = 0;
		for (let b = b0; b <= b1; b++) {
			ein += sIn[b] ** 2;
			eout += sOut[b] ** 2;
		}
		return 10 * Math.log10(eout / (ein || 1e-30));
	}

	// ---- music-like test signal: full-band, with transients -------------
	const SR = 44100;
	const SECONDS = 4;
	const frames = SR * SECONDS;
	const sig = new Float32Array(frames);
	let seed = 12345;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
	for (let i = 0; i < frames; i++) {
		const t = i / SR;
		const beat = t * 2;                       // 120 bpm
		const env = Math.exp(-((beat % 1) * 12)); // sharp attacks
		// full-band noise burst (cymbal-ish) + a few partials
		sig[i] =
			env * (0.5 * rnd() + 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 3300 * t)) * 0.6;
	}

		async function render(config, rate, semitones) {
		const outSeconds = SECONDS / rate;
		const off = new OfflineAudioContext(1, Math.ceil((outSeconds + 2) * SR), SR);
		const node = await SignalsmithStretch(off, {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [1]
		});
		node.connect(off.destination);
		await node.addBuffers([sig]);
		if (config) await node.configure(config);
		await node.start({ outputTime: 0, input: 0, active: true, rate, semitones });
		const rendered = await off.startRendering();
		const d = rendered.getChannelData(0);
		// skip the lead-in
		return d.subarray(Math.floor(SR * 0.2), d.length);
	}

	// Reference = the engine's own identity output. Comparing against the raw
	// input carries a constant offset (window/lead-in effects) that swamps the
	// differences we actually care about.
	const identity = await render(null, 1.0, 0);
	const identitySpec = avgSpectrum(identity, SR);

	// Sanity: identity should be a faithful copy of the input.
	let maxErr = 0;
	let sumSqr = 0;
	for (let i = 0; i < Math.min(identity.length, sig.length); i++) {
		const e = Math.abs(identity[i] - sig[i]);
		if (e > maxErr) maxErr = e;
		sumSqr += sig[i] * sig[i];
	}
	const identityRmsError = Math.sqrt(
		sumSqr / Math.max(1, Math.min(identity.length, sig.length))
	);

	const CONFIGS = [
		{ label: 'preset:cheaper', config: { preset: 'cheaper' } },
		{ label: 'default preset', config: null },
		{ label: 'blockMs 40', config: { blockMs: 40 } },
		{ label: 'blockMs 80', config: { blockMs: 80 } },
		{ label: 'blockMs 120', config: { blockMs: 120 } },
		{ label: 'blockMs 200', config: { blockMs: 200 } },
		{ label: 'blockMs 320', config: { blockMs: 320 } }
	];

	const results = [];
	for (const rate of [0.65, 0.8, 1.0]) {
		for (const c of CONFIGS) {
			if (rate === 1.0 && c.config?.preset) continue;
			const t0 = performance.now();
			const rendered = await render(c.config, rate, 0);
			const ms = performance.now() - t0;
			const outSpec = avgSpectrum(rendered, SR);
			results.push({
				rate,
				label: c.label,
				// Broadband level change, then HF loss *relative to that*, which
				// is the part that reads as "muddy".
				gain: bandRatioDb(identitySpec, outSpec, 50, 16000),
				high: bandRatioDb(identitySpec, outSpec, 4000, 16000),
				mid: bandRatioDb(identitySpec, outSpec, 500, 4000),
				rms: (() => {
					let s = 0;
					for (let i = 0; i < rendered.length; i++) s += rendered[i] * rendered[i];
					return Math.sqrt(s / rendered.length);
				})(),
				rtf: (SECONDS / rate / (ms / 1000)).toFixed(0)
			});
		}
	}
	return { results, identityRmsError, maxErr };
});

console.log(
	`identity sanity: rms(input)=${out.identityRmsError.toFixed(5)}  maxSampleErr=${out.maxErr.toFixed(5)}`
);
console.log('(dB values are vs the engine\'s own identity output; "hf-tilt" = high minus broadband)\n');
console.log('rate  config            broadband  hf(4-16k)  mid(0.5-4k)  hf-tilt   speed');
console.log('------------------------------------------------------------------------------');
let prev = null;
for (const r of out.results) {
	if (prev !== null && prev !== r.rate) console.log('');
	prev = r.rate;
	const tilt = r.high - r.gain;
	console.log(
		`${r.rate.toFixed(2)}  ${r.label.padEnd(16)} ${r.gain.toFixed(2).padStart(8)} dB  ` +
		`${r.high.toFixed(2).padStart(8)} dB  ${r.mid.toFixed(2).padStart(9)} dB  ` +
		`${tilt.toFixed(2).padStart(6)} dB  ${r.rtf}x`
	);
}
await browser.close();
