<script lang="ts">
	interface Props {
		/** dBFS of the loudest sample in the last frame. */
		peakDb: number;
		/** dBFS of recent RMS. */
		rmsDb: number;
		/** dB of loudness correction being applied. */
		correctionDb: number;
		/** dBFS loudness the output is being steered towards right now. */
		referenceDb: number;
		limiting: boolean;
	}

	let { peakDb, rmsDb, correctionDb, referenceDb, limiting }: Props = $props();

	// Meter scale: -48 dBFS .. 0 dBFS.
	const FLOOR = -48;
	const toFraction = (db: number) => {
		if (!Number.isFinite(db)) return 0;
		return Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR));
	};

	// Ticks worth looking at when judging "is this loud".
	const TICKS = [
		{ db: -48, label: '-48' },
		{ db: -36, label: '-36' },
		{ db: -24, label: '-24' },
		{ db: -18, label: '-18' },
		{ db: -12, label: '-12' },
		{ db: -6, label: '-6' },
		{ db: -3, label: '-3' },
		{ db: 0, label: '0' }
	];

	const peakFraction = $derived(toFraction(peakDb));
	const rmsFraction = $derived(toFraction(rmsDb));
	const referenceFraction = $derived(toFraction(referenceDb));

	function formatDb(db: number): string {
		if (!Number.isFinite(db)) return '—';
		return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
	}
</script>

<div class="meter" class:limiting>
	<div class="scale-strip" aria-hidden="true">
		{#each TICKS as tick (tick.db)}
			<span class="tick" class:hot={tick.db >= -3} style:left="{toFraction(tick.db) * 100}%">
				{tick.label}
			</span>
		{/each}
	</div>

	<div class="track">
		<div class="rms" style:width="{rmsFraction * 100}%"></div>
		<div class="peak" style:left="{peakFraction * 100}%"></div>
		{#if Number.isFinite(referenceDb)}
			<div class="source" style:left="{referenceFraction * 100}%" title="当前目标响度（原声此刻的响度）"></div>
		{/if}
	</div>

	<div class="readout">
		<span class="peak-val">{formatDb(peakDb)} dBFS</span>
		<span class="sep">·</span>
		<span class="rms-val">RMS {formatDb(rmsDb)}</span>
		{#if Number.isFinite(referenceDb)}
			<span class="sep">·</span>
			<span class="src-val">目标 {formatDb(referenceDb)}</span>
		{/if}
		<span class="sep">·</span>
		<span class="corr-val" class:positive={correctionDb > 0.1} class:negative={correctionDb < -0.1}>
			补偿 {formatDb(correctionDb)} dB
		</span>
		{#if limiting}
			<span class="sep">·</span>
			<span class="limit-flag">限幅中</span>
		{/if}
	</div>
</div>

<style>
	.meter {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.scale-strip {
		position: relative;
		height: 13px;
	}

	.tick {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		font-size: 9px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.tick.hot {
		color: var(--scale-hot);
	}

	.track {
		position: relative;
		height: 14px;
		border-radius: 4px;
		background: var(--meter-bg);
		border: 1px solid var(--meter-border);
		overflow: hidden;
	}

	.rms {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--meter-bar);
		transition: width 0.05s linear;
	}

	.peak {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--text);
		transition: left 0.08s ease-out;
	}

	/* Marker for the loudness the output is being steered towards. */
	.source {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--target-mark);
	}

	.meter.limiting .peak {
		background: var(--danger);
	}

	.readout {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		font-size: 11px;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.peak-val {
		color: var(--text);
	}

	.corr-val.positive {
		color: var(--positive);
	}

	.corr-val.negative {
		color: var(--warning);
	}

	.limit-flag {
		color: var(--danger);
	}
</style>
