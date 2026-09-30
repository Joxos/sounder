/** Theme preference: 'system' | 'light' | 'dark'. Dark is the fallback. */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'sounder:theme';

function readStored(): ThemePreference {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		if (value === 'light' || value === 'dark' || value === 'system') return value;
	} catch {
		// Private mode / storage disabled — fall through to the default.
	}
	// Dark is the product default; "system" is opt-in, so a machine set to
	// light does not silently change the app's appearance on first load.
	return 'dark';
}

function systemPrefersDark(): boolean {
	return !window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function applyTheme(preference: ThemePreference): 'light' | 'dark' {
	const dark = preference === 'system' ? systemPrefersDark() : preference === 'dark';
	const resolved = dark ? 'dark' : 'light';
	document.documentElement.dataset.theme = resolved;
	return resolved;
}

export function storeTheme(preference: ThemePreference): void {
	try {
		localStorage.setItem(STORAGE_KEY, preference);
	} catch {
		// Ignore: not being able to remember the choice is not fatal.
	}
}

export function initTheme(): {
	preference: ThemePreference;
	apply: (next: ThemePreference) => 'light' | 'dark';
} {
	const preference = readStored();
	applyTheme(preference);

	// Follow the OS while the preference is "system".
	const query = window.matchMedia('(prefers-color-scheme: light)');
	const onChange = () => {
		if (readStored() === 'system') applyTheme('system');
	};
	query.addEventListener('change', onChange);

	return {
		preference,
		apply: (next: ThemePreference) => {
			storeTheme(next);
			return applyTheme(next);
		}
	};
}
