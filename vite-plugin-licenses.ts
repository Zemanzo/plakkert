import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, Rolldown } from 'vite';

// Writes the licenses of the packages bundled into the app to a text file next to it, which the
// settings link to: MIT, BSD, ISC and Apache all ask for their notices to go along with the code.
// Like Vite's own `build.license`, but it includes NOTICE files, which Apache-2.0 asks for too, and
// licenses in the old `licenses` field of package.json.

const LICENSE_FILE = /^(licen[cs]e|copying)/i;
const NOTICE_FILE = /^notice/i;

interface PackageJson {
	name?: string;
	version?: string;
	license?: string | { type?: string };
	licenses?: { type?: string }[];
	homepage?: string;
	repository?: string | { url?: string };
}

interface Entry {
	name: string;
	version: string;
	license: string | undefined;
	texts: string[];
}

/** The package a file in node_modules belongs to: the nearest package.json with a name. */
function packageOf(file: string, cache: Map<string, string | null>): string | null {
	let dir = path.dirname(file);
	const visited: string[] = [];
	let found: string | null = null;
	while (dir.includes('node_modules')) {
		const cached = cache.get(dir);
		if (cached !== undefined) {
			found = cached;
			break;
		}
		visited.push(dir);
		const manifest = path.join(dir, 'package.json');
		if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, 'utf8')) as PackageJson).name) {
			found = dir;
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	for (const d of visited) cache.set(d, found);
	return found;
}

function licenseOf(manifest: PackageJson) {
	if (typeof manifest.license === 'string') return manifest.license.trim();
	if (manifest.license?.type) return manifest.license.type;
	const types = manifest.licenses?.flatMap((license) => license.type ?? []) ?? [];
	return types.length ? types.join(' OR ') : undefined;
}

/** Where to find out more about a package, for one that doesn't come with its license's text. */
function homeOf(manifest: PackageJson) {
	const repository =
		typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
	const url = repository
		?.replace(/^git\+/, '')
		.replace(/^git:\/\//, 'https://')
		.replace(/\.git$/, '');
	return url?.startsWith('https://') ? url : manifest.homepage;
}

function entryOf(dir: string): Entry {
	const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageJson;
	const files = readdirSync(dir).sort();
	const texts = [
		...files.filter((file) => LICENSE_FILE.test(file)),
		...files.filter((file) => NOTICE_FILE.test(file))
	].map((file) => readFileSync(path.join(dir, file), 'utf8').trim());
	const home = homeOf(manifest);
	if (texts.length === 0 && home)
		texts.push(`The package doesn't include its license's text; see ${home}`);
	return {
		name: manifest.name!,
		version: manifest.version ?? '',
		license: licenseOf(manifest),
		texts
	};
}

/** The folders of the packages in node_modules that a bundle contains. */
function packagesIn(bundle: Rolldown.OutputBundle) {
	const cache = new Map<string, string | null>();
	const dirs = new Set<string>();
	for (const chunk of Object.values(bundle)) {
		if (chunk.type !== 'chunk') continue;
		for (const id of chunk.moduleIds) {
			const file = id.split('?')[0];
			if (file.startsWith('\0') || !file.includes('node_modules')) continue;
			const dir = packageOf(file, cache);
			if (dir) dirs.add(dir);
		}
	}
	return dirs;
}

/** The licenses of the packages in these folders, by name. */
function licenseTexts(dirs: Iterable<string>) {
	const entries = new Map<string, Entry>();
	for (const dir of dirs) {
		const entry = entryOf(dir);
		entries.set(`${entry.name}@${entry.version}`, entry);
	}
	const rule = '-'.repeat(80);
	return [...entries.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) =>
			[
				rule,
				`${entry.name} ${entry.version}${entry.license ? ` (${entry.license})` : ''}`,
				rule,
				...entry.texts.map((text) => `\n${text}`)
			].join('\n')
		)
		.join('\n\n');
}

/**
 * The server is bundled too (adapter-node bundles everything but `dependencies`), so its packages
 * are listed as well. SvelteKit builds the server first, so the file is written with the app.
 */
export function licenses(fileName: string): Plugin {
	let serverPackages = new Set<string>();
	return {
		name: 'plakkert:licenses',
		// Not the service worker, which is built into the app's folder afterwards.
		applyToEnvironment: (environment) => ['ssr', 'client'].includes(environment.name),
		generateBundle(_, bundle) {
			if (this.environment.name === 'ssr') {
				serverPackages = packagesIn(bundle);
				return;
			}
			const appPackages = packagesIn(bundle);
			const serverOnly = [...serverPackages].filter((dir) => !appPackages.has(dir));
			let source = `This app includes the following open-source packages, under these licenses.\n\n${licenseTexts(appPackages)}\n`;
			if (serverOnly.length) {
				source += `\n\n${'='.repeat(80)}\n\nIts server also includes these.\n\n${licenseTexts(serverOnly)}\n`;
			}
			this.emitFile({ type: 'asset', fileName, source });
		}
	};
}
