// Confirm the root cause: with a *running* AudioContext, does
// numberOfInputs: 0 kill the processor via the unguarded
// `inputs[c % inputs.length]` in the inactive branch?
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
	const SignalsmithStretch = (await import('/dev/browser-libs.ts')).SignalsmithStretch;

	async function trial(numberOfInputs) {
		const sr = 44100;
		const seconds = 2;
		const frames = sr * seconds;
		const tone = new Float32Array(frames);
		for (let i = 0; i < frames; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;

		const ctx = new AudioContext({ sampleRate: sr });
		await ctx.resume(); // <-- simulate a real user gesture: context RUNS

		const node = await SignalsmithStretch(ctx, {
			numberOfInputs,
			numberOfOutputs: 1,
			outputChannelCount: [1]
		});
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		node.connect(analyser);
		analyser.connect(ctx.destination);

		await node.addBuffers([tone]);

		// Leave the node connected and NOT started for a while: the processor
		// runs with active=false, which is exactly the dangerous window.
		await new Promise((r) => setTimeout(r, 1200));

		await node.start({ outputTime: ctx.currentTime + 0.05, input: 0, active: true, rate: 1, semitones: 0 });

		const buf = new Float32Array(analyser.fftSize);
		let peak = 0;
		const until = performance.now() + 2500;
		while (performance.now() < until) {
			await new Promise((r) => setTimeout(r, 20));
			analyser.getFloatTimeDomainData(buf);
			for (const v of buf) peak = Math.max(peak, Math.abs(v));
		}
		await ctx.close();
		return Number(peak.toFixed(4));
	}

	return { zeroInputs: await trial(0), oneInput: await trial(1) };
});

console.log(JSON.stringify(out, null, 2));
console.log('console errors:', errors.length ? '\n' + errors.join('\n') : '(none)');
console.log(
	`\nnumberOfInputs: 0 -> peak ${out.zeroInputs}  ${out.zeroInputs > 0.005 ? 'OK' : '*** SILENT (crashed) ***'}`
);
console.log(`numberOfInputs: 1 -> peak ${out.oneInput}  ${out.oneInput > 0.005 ? 'OK' : '*** SILENT ***'}`);
await browser.close();
