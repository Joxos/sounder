<script lang="ts">
	import { pickLevel, type PeakPyramidData } from '../lib/peaks';

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	interface Props {
		pyramid: PeakPyramidData | null;
		duration: number;
		position: number;
		loop: { enabled: boolean; start: number; end: number };
		height?: number;
		interactive?: boolean;
		onseek?: (seconds: number) => void;
		onsetloop?: (start: number, end: number, enabled: boolean) => void;
		/** Changing this forces a repaint with the new theme's colours. */
		theme?: 'light' | 'dark';
	}

	let {
		pyramid,
		duration,
		position,
		loop,
		height = 96,
		interactive = true,
		onseek,
		onsetloop,
		theme = 'dark'
	}: Props = $props();

	function cssVar(name: string, fallback: string): string {
		if (typeof getComputedStyle === 'undefined') return fallback;
		const value = getComputedStyle(document.documentElement).getPropertyValue(name);
		return value.trim() || fallback;
	}

	let canvas: HTMLCanvasElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let hoverTime = $state<number | null>(null);
	let dragMode: 'seek' | 'loop' | null = $state(null);
	let loopDragStart = $state(0);

	const toSeconds = (clientX: number): number => {
		if (!container || duration <= 0) return 0;
		const rect = container.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		return ratio * duration;
	};

	function draw() {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const cssWidth = canvas.clientWidth;
		const cssHeight = canvas.clientHeight;
		if (cssWidth === 0 || cssHeight === 0) return;

		if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
			canvas.width = Math.round(cssWidth * dpr);
			canvas.height = Math.round(cssHeight * dpr);
		}

		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cssWidth, cssHeight);

		const mid = cssHeight / 2;

		// Loop region backdrop
		if (loop.enabled && loop.end > loop.start) {
			const x0 = (loop.start / duration) * cssWidth;
			const x1 = (loop.end / duration) * cssWidth;
			ctx.fillStyle = cssVar('--loop-fill', 'rgba(76, 154, 255, 0.14)');
			ctx.fillRect(x0, 0, x1 - x0, cssHeight);
			ctx.strokeStyle = cssVar('--loop-edge', 'rgba(76, 154, 255, 0.75)');
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(x0 + 0.5, 0);
			ctx.lineTo(x0 + 0.5, cssHeight);
			ctx.moveTo(x1 - 0.5, 0);
			ctx.lineTo(x1 - 0.5, cssHeight);
			ctx.stroke();
		}

		// Waveform
		if (pyramid && pyramid.levels.length > 0 && duration > 0) {
			const level = pickLevel(pyramid, cssWidth);
			if (level) {
				const path = new Path2D();
				const buckets = level.bucketCount;
				for (let px = 0; px < cssWidth; px++) {
					const b0 = Math.floor((px / cssWidth) * buckets);
					const b1 = Math.min(buckets, Math.max(b0 + 1, Math.floor(((px + 1) / cssWidth) * buckets)));
					let lo = 0;
					let hi = 0;
					for (let b = b0; b < b1; b++) {
						const bLo = level.minMax[b * 2] / 127;
						const bHi = level.minMax[b * 2 + 1] / 127;
						if (b < b0 || bLo < lo) lo = bLo;
						if (b < b0 || bHi > hi) hi = bHi;
					}
					const yTop = mid - hi * (mid - 2);
					const yBottom = mid - lo * (mid - 2);
					path.rect(px, yTop, 1, Math.max(1, yBottom - yTop));
				}
				ctx.fillStyle = loop.enabled
					? cssVar('--wave-loop', '#79b8ff')
					: cssVar('--wave', '#6ea8fe');
				ctx.fill(path);
			}
		} else {
			ctx.strokeStyle = cssVar('--border', '#2a3240');
			ctx.beginPath();
			ctx.moveTo(0, mid + 0.5);
			ctx.lineTo(cssWidth, mid + 0.5);
			ctx.stroke();
		}

		// Playhead
		if (duration > 0 && position >= 0) {
			const x = (position / duration) * cssWidth;
			ctx.strokeStyle = cssVar('--playhead', '#f0883e');
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, cssHeight);
			ctx.stroke();
		}

		// Hover cursor
		if (hoverTime !== null && dragMode === null) {
			const x = (hoverTime / duration) * cssWidth;
			ctx.strokeStyle = cssVar('--hover-line', 'rgba(230, 237, 243, 0.25)');
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(x + 0.5, 0);
			ctx.lineTo(x + 0.5, cssHeight);
			ctx.stroke();
		}
	}

	$effect(() => {
		// Re-run whenever anything the drawing depends on changes.
		void pyramid;
		void position;
		void loop.enabled;
		void loop.start;
		void loop.end;
		void hoverTime;
		void theme;
		draw();
	});

	$effect(() => {
		if (!container) return;
		// Width only: the element's height comes from the `height` prop, so
		// feeding it back would collapse the box to its borders.
		const observer = new ResizeObserver((entries) => {
			const rect = entries[0]?.contentRect;
			if (rect) width = rect.width;
		});
		observer.observe(container);
		return () => observer.disconnect();
	});

	function onPointerDown(event: PointerEvent) {
		if (!interactive) return;
		const t = toSeconds(event.clientX);
		if (event.shiftKey) {
			dragMode = 'loop';
			loopDragStart = t;
			onsetloop?.(t, t, true);
		} else {
			dragMode = 'seek';
			onseek?.(t);
		}
		(event.target as Element).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		const t = toSeconds(event.clientX);
		hoverTime = t;
		if (dragMode === 'seek') {
			onseek?.(t);
		} else if (dragMode === 'loop') {
			onsetloop?.(Math.min(loopDragStart, t), Math.max(loopDragStart, t), true);
		}
	}

	function onPointerUp(event: PointerEvent) {
		if (dragMode === 'loop') {
			const t = toSeconds(event.clientX);
			if (Math.abs(t - loopDragStart) < 0.05) {
				onsetloop?.(0, 0, false);
			}
		}
		dragMode = null;
		(event.target as Element).releasePointerCapture?.(event.pointerId);
	}
</script>

<div
	class="wave"
	bind:this={container}
	style:height="{height}px"
	role="slider"
	aria-label="波形位置"
	aria-valuemin="0"
	aria-valuemax={duration}
	aria-valuenow={position}
	tabindex="0"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onpointerleave={() => {
		hoverTime = null;
	}}
>
	<canvas bind:this={canvas}></canvas>
	{#if hoverTime !== null && duration > 0}
		<div class="tooltip" style:left="{Math.min(Math.max(0, (hoverTime / duration) * width - 24), Math.max(0, width - 48))}px">
			{formatTime(hoverTime)}
		</div>
	{/if}
</div>

<style>
	.wave {
		position: relative;
		width: 100%;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		touch-action: none;
		cursor: crosshair;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.tooltip {
		position: absolute;
		top: 4px;
		padding: 1px 6px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		background: rgba(0, 0, 0, 0.72);
		border-radius: 4px;
		pointer-events: none;
	}
</style>
