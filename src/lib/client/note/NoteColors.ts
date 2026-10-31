/**
 * Colours a note can have. The id is stored in the note and maps to the
 * `--color-<id>` CSS variable, so ids must never change. All of them keep the
 * dark note text readable (contrast of at least 5:1).
 */
export const NOTE_COLORS = [
	{ id: 'yellow', label: 'Yellow' },
	{ id: 'orange', label: 'Orange' },
	{ id: 'red', label: 'Red' },
	{ id: 'pink', label: 'Pink' },
	{ id: 'purple', label: 'Purple' },
	{ id: 'sky', label: 'Blue' },
	// Stored as "blue" by earlier versions, which only had this one.
	{ id: 'blue', label: 'Teal' },
	{ id: 'green', label: 'Green' },
	{ id: 'sand', label: 'Sand' },
	{ id: 'gray', label: 'Gray' }
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number]['id'];

export const DEFAULT_NOTE_COLOR: NoteColor = 'yellow';

export function isNoteColor(value: string): value is NoteColor {
	return NOTE_COLORS.some((color) => color.id === value);
}
