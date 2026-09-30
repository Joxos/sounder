import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// Relative asset URLs so one build works both at a domain root and from a
	// GitHub Pages project sub-path (https://user.github.io/sounder/), without
	// the build needing to know the repo name.
	base: './',
	plugins: [svelte()],
	worker: { format: 'es' },
	optimizeDeps: {
		// signalsmith-stretch ships a pre-bundled emscripten blob; let Vite handle it as-is
		exclude: ['signalsmith-stretch']
	},
	server: {
		headers: {
			// Not required today (verified: the WASM needs no SharedArrayBuffer),
			// but useful locally if a multi-threaded encoder is ever added.
			// GitHub Pages cannot set custom headers, so production runs without
			// them — which is fine, but keep that in mind before adding one.
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		}
	},
	preview: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		}
	}
});
