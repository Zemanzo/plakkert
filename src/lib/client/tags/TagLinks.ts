import { resolve } from '$app/paths';

/**
 * Link to the notes with a tag, or to all notes for `null`. Tags are a query
 * parameter rather than part of the path, so the prerendered page (and with it
 * the offline app) works for every tag.
 */
export function tagHref(tag: string | null) {
	return tag === null
		? resolve('/(notes)')
		: `${resolve('/(notes)')}?${new URLSearchParams({ tag })}`;
}
