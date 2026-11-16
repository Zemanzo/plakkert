import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { convertKeepNote, parseKeepTakeout } from './KeepImport';

// Based on real exports, without the HTML versions of the text, which aren't used.
const textNote = {
	color: 'YELLOW',
	isTrashed: false,
	isPinned: false,
	isArchived: true,
	textContent: 'Ketjap manis, kerriepoeder en knoflook.\nPaar uurtjes in de koelkast. 🌶️',
	title: 'LEKKERE KIP',
	userEditedTimestampUsec: 1697810051695000,
	createdTimestampUsec: 1697810051695000,
	labels: [{ name: 'Recipes' }]
};

const listNote = {
	color: 'RED',
	isTrashed: false,
	isPinned: false,
	isArchived: false,
	listContent: [
		{ textHtml: '<p><span>Conditioner</span></p>', text: 'Conditioner', isChecked: true },
		{ textHtml: '', text: '', isChecked: true },
		{ textHtml: '<p><span>Appels</span></p>', text: 'Appels', isChecked: false }
	],
	title: '(Briam) | Curry | 🥙',
	userEditedTimestampUsec: 1783319048333000,
	createdTimestampUsec: 1783110222066000
};

const json = (value: unknown) => strToU8(JSON.stringify(value));

describe('convertKeepNote', () => {
	it('converts a text note, keeping its colour, labels, dates and whether it is archived', () => {
		expect(convertKeepNote(textNote)).toEqual({
			content:
				'<h1>LEKKERE KIP</h1><p>Ketjap manis, kerriepoeder en knoflook.</p>' +
				'<p>Paar uurtjes in de koelkast. 🌶️</p>',
			color: 'yellow',
			archived: true,
			labels: ['Recipes'],
			createdAt: 1697810051695,
			updatedAt: 1697810051695
		});
	});

	it('turns a list into a checklist, without formatting', () => {
		expect(convertKeepNote(listNote)).toEqual({
			content:
				'<h1>(Briam) | Curry | 🥙</h1><ul data-type="taskList">' +
				'<li data-type="taskItem" data-checked="true"><p>Conditioner</p></li>' +
				'<li data-type="taskItem" data-checked="false"><p>Appels</p></li></ul>',
			color: 'red',
			archived: false,
			labels: [],
			createdAt: 1783110222066,
			updatedAt: 1783319048333
		});
	});

	it('maps every Keep colour, and the default (white) one to the default colour', () => {
		const colorOf = (color?: string) => convertKeepNote({ ...textNote, color })!.color;
		expect(colorOf('DEFAULT')).toBe('yellow');
		expect(colorOf(undefined)).toBe('yellow');
		expect(colorOf('SOMETHING_NEW')).toBe('yellow');
		expect(colorOf('TEAL')).toBe('blue');
		expect(colorOf('BLUE')).toBe('sky');
		expect(colorOf('BROWN')).toBe('sand');
		expect(colorOf('GRAY')).toBe('gray');
	});

	it('leaves out notes in the trash', () => {
		expect(convertKeepNote({ ...textNote, isTrashed: true })).toBeNull();
	});

	it('uses the creation date when the note was never edited', () => {
		const note = convertKeepNote({ ...textNote, userEditedTimestampUsec: undefined })!;
		expect(note.updatedAt).toBe(note.createdAt);
	});

	it('rounds dates down to whole milliseconds, as they are stored', () => {
		const note = convertKeepNote({ ...textNote, createdTimestampUsec: 1697810051695999 })!;
		expect(note.createdAt).toBe(1697810051695);
	});

	it('refuses anything that is not a Keep note', () => {
		expect(() => convertKeepNote({ name: 'Something else' })).toThrow();
		expect(() => convertKeepNote(null)).toThrow();
	});
});

describe('parseKeepTakeout', () => {
	it('reads the notes in the Keep folder, and only those', () => {
		const zip = zipSync({
			'Takeout/Keep/LEKKERE KIP.json': json(textNote),
			'Takeout/Keep/LEKKERE KIP.html': strToU8('<html></html>'),
			'Takeout/Keep/Boodschappen.json': json(listNote),
			'Takeout/Keep/Weg.json': json({ ...textNote, isTrashed: true }),
			'Takeout/Keep/Kapot.json': strToU8('{ not json'),
			'Takeout/Fit/activity.json': json(textNote),
			'Takeout/archive_browser.html': strToU8('<html></html>')
		});
		const onProgress = vi.fn();

		const result = parseKeepTakeout(zip, onProgress);

		expect(result.notes.map((note) => note.color).sort()).toEqual(['red', 'yellow']);
		expect(result.trashed).toBe(1);
		expect(result.failed).toEqual(['Kapot.json']);
		expect(onProgress).toHaveBeenCalledTimes(4);
		expect(onProgress).toHaveBeenLastCalledWith(4, 4);
	});

	it('also reads a zip of just the notes, without the Keep folder', () => {
		const zip = zipSync({ 'LEKKERE KIP.json': json(textNote) });
		expect(parseKeepTakeout(zip, () => {}).notes).toHaveLength(1);
	});

	it('explains when there are no notes in the zip', () => {
		const zip = zipSync({ 'Takeout/archive_browser.html': strToU8('<html></html>') });
		expect(() => parseKeepTakeout(zip, () => {})).toThrow(/no Google Keep notes/);
	});

	it('explains when the file is not a zip', () => {
		expect(() => parseKeepTakeout(strToU8('not a zip'), () => {})).toThrow(/isn’t a \.zip/);
	});
});
