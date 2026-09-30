<script lang="ts">
	interface Props {
		id: string;
		label: string;
		min: number;
		max: number;
		step: number;
		value: number;
		/** Format the current value for the readout. */
		format: (value: number) => string;
		/** Tick positions and their captions, drawn under the track. */
		ticks: { at: number; label: string; emphasis?: boolean }[];
		/** Caption under the current value, e.g. a quality band. */
		hint?: string;
		disabled?: boolean;
		oninput?: (value: number) => void;
	}

	let {
		id,
		label,
		min,
		max,
		step,
		value,
		format,
		ticks,
		hint,
		disabled = false,
		oninput
	}: Props = $props();

	/** Where the handle currently sits, 0..1 — used to place the readout. */
	const fraction = $derived((value - min) / (max - min));
	const percent = (at: number) => `${((at - min) / (max - min)) * 100}%`;

	function handleInput(event: Event) {
		const next = Number((event.currentTarget as HTMLInputElement).value);
		oninput?.(next);
	}
</script>

<div class="slider-block" class:disabled>
	<div class="slider-head">
		<label for={id}>{label}</label>
		<output>{format(value)}</output>
	</div>

	<div class="track-wrap">
		<div class="ticks" aria-hidden="true">
			{#each ticks as tick (tick.at)}
				<span
					class="tick"
					class:emphasis={tick.emphasis}
					style:left={percent(tick.at)}
				>
					<i></i>
					<em>{tick.label}</em>
				</span>
			{/each}
		</div>
		<input
			{id}
			type="range"
			{min}
			{max}
			{step}
			{disabled}
			{value}
			oninput={handleInput}
			style:--fill="{fraction * 100}%"
		/>
	</div>

	{#if hint}
		<div class="hint">{hint}</div>
	{/if}
</div>

<style>
	.slider-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.slider-block.disabled {
		opacity: 0.5;
	}

	.slider-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.slider-head output {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--accent);
	}

	.track-wrap {
		position: relative;
		padding-top: 14px;
	}

	.ticks {
		position: absolute;
		inset: 0 0 auto 0;
		height: 14px;
	}

	.tick {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		white-space: nowrap;
	}

	.tick i {
		display: block;
		width: 1px;
		height: 4px;
		background: var(--border);
	}

	.tick em {
		font-style: normal;
		font-size: 10px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	/* The reference the handle position is measured against. */
	.tick.emphasis i {
		background: var(--accent);
	}

	.tick.emphasis em {
		color: var(--text);
	}

	input[type='range'] {
		background: linear-gradient(
			to right,
			var(--accent) 0%,
			var(--accent) var(--fill),
			var(--border) var(--fill),
			var(--border) 100%
		);
	}
	.hint {
		font-size: 11px;
		color: var(--muted);
		min-height: 16px;
	}
</style>
