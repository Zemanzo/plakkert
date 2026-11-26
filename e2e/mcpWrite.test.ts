import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
	addTag,
	expect,
	goTo,
	newNote,
	note,
	syncNow,
	test,
	uniqueName,
	url,
	waitSynced
} from './helpers';
import {
	callTool,
	choosePermissions,
	connect,
	FULL_ACCESS,
	titles,
	toolNames,
	type ToolResult
} from './mcpClient';

// What MCP clients can change in a user's notes, and that the user decides what, for each app:
// which tools it gets, and which notes it can see and so change.

const READ_TOOLS = ['get_note', 'list_colors', 'list_tags', 'search_notes'];

type ChangeResult = {
	id: string;
	in_reach: boolean;
	note?: { title: string; tags: string[]; color: string; archived: boolean; trashed: boolean };
};

function changed(result: ToolResult) {
	expect(result.isError, result.content[0]?.text).toBeFalsy();
	return result.structuredContent as ChangeResult;
}

function refused(result: ToolResult, message: RegExp) {
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toMatch(message);
}

/** Pulls what the client changed into the app. Connecting leaves the page at the client. */
async function pull(page: Page) {
	if (!page.url().startsWith(url('/'))) await page.goto(url('/'));
	await syncNow(page);
}

test('with every permission, an MCP client can create, edit, organize, delete and share notes', async ({
	app,
	request
}) => {
	const bobName = uniqueName('bob');
	const bob = await app.register(bobName);
	const alice = await app.register(uniqueName('alice'));
	const { access_token } = await connect(alice.page, request, FULL_ACCESS);
	const call = (name: string, args: Record<string, unknown> = {}) =>
		callTool(request, access_token, name, args);
	let id = '';

	await test.step('it has every tool', async () => {
		expect(await toolNames(request, access_token)).toEqual(
			[
				...READ_TOOLS,
				'create_note',
				'delete_note',
				'edit_note',
				'list_shares',
				'organize_note',
				'restore_note',
				'share_note',
				'unshare_note'
			].sort()
		);
	});

	await test.step('it creates notes from Markdown, which the app shows', async () => {
		const created = changed(
			await call('create_note', {
				markdown: '# Weekend plan\n\n- [ ] Hike\n- [x] Book the hut',
				color: 'green',
				tags: ['Trips']
			})
		);
		expect(created).toMatchObject({
			in_reach: true,
			note: { title: 'Weekend plan', tags: ['Trips'], color: 'green', archived: false }
		});
		id = created.id;

		await pull(alice.page);
		const shown = note(alice.page, 'Weekend plan');
		await expect(shown).toBeVisible();
		await expect(shown.locator('.tag')).toHaveText(['Trips']);
		await expect(shown.getByRole('checkbox')).toHaveCount(2);
		await expect(shown.getByRole('checkbox').nth(1)).toBeChecked();

		const read = await call('get_note', { id });
		expect(read.structuredContent.markdown).toBe(
			'# Weekend plan\n\n- [ ] Hike\n- [x] Book the hut'
		);
	});

	await test.step('it adds to notes, and replaces their text', async () => {
		changed(await call('edit_note', { id, markdown: 'Bring **snacks**', append: true }));
		await pull(alice.page);
		await expect(note(alice.page, 'Weekend plan')).toContainText('Bring snacks');
		await expect(note(alice.page, 'Weekend plan').locator('strong')).toHaveText('snacks');

		changed(await call('edit_note', { id, markdown: '# Weekend plan\n\nRain, so stay in' }));
		await pull(alice.page);
		await expect(note(alice.page, 'Weekend plan')).toContainText('Rain, so stay in');
		await expect(note(alice.page, 'Weekend plan')).not.toContainText('Hike');
	});

	await test.step('it tags, colors and archives notes, and undoes that', async () => {
		const organized = changed(
			await call('organize_note', {
				id,
				add_tags: ['Outdoors', 'trips'],
				color: 'red',
				archived: true
			})
		);
		// "trips" is the tag the note has already.
		expect(organized.note).toMatchObject({
			tags: ['Outdoors', 'Trips'],
			color: 'red',
			archived: true
		});
		await pull(alice.page);
		await expect(note(alice.page, 'Weekend plan')).toHaveCount(0);
		await goTo(alice.page, 'Archive');
		await expect(note(alice.page, 'Weekend plan').locator('.tag')).toHaveText([
			'Outdoors',
			'Trips'
		]);

		changed(await call('organize_note', { id, remove_tags: ['OUTDOORS'], archived: false }));
		await goTo(alice.page, 'Notes');
		await pull(alice.page);
		await expect(note(alice.page, 'Weekend plan').locator('.tag')).toHaveText(['Trips']);
		refused(await call('organize_note', { id }), /Nothing to change/);
	});

	await test.step('changing only the color leaves the tags, so other devices keep their changes', async () => {
		const tagsUpdatedAt = async () => {
			const response = await alice.page.request.get(url('/api/notes/changes'));
			const { notes } = (await response.json()) as {
				notes: { id: string; tagsUpdatedAt: string | null }[];
			};
			return notes.find((n) => n.id === id)!.tagsUpdatedAt;
		};
		const before = await tagsUpdatedAt();
		expect(before).not.toBeNull();
		expect(changed(await call('organize_note', { id, color: 'blue' })).note?.color).toBe('blue');
		expect(await tagsUpdatedAt()).toBe(before);
		// Adding a tag the note has already changes nothing either.
		changed(await call('organize_note', { id, add_tags: ['trips'] }));
		expect(await tagsUpdatedAt()).toBe(before);
	});

	await test.step('it can’t keep adding to a note without end', async () => {
		const long = changed(await call('create_note', { markdown: 'a'.repeat(100_000) }));
		let added = 0;
		let result: ToolResult | undefined;
		while (added < 20) {
			result = await call('edit_note', {
				id: long.id,
				markdown: 'b'.repeat(100_000),
				append: true
			});
			if (result.isError) break;
			added++;
		}
		refused(result!, /too long to add more/);
		// About a million characters, of 100,000 each.
		expect(added).toBe(8);
		changed(await call('edit_note', { id: long.id, markdown: 'Short again' }));
		changed(await call('edit_note', { id: long.id, markdown: ' and longer', append: true }));
		changed(await call('delete_note', { id: long.id }));
	});

	await test.step('it moves notes to the trash, and restores them', async () => {
		expect(changed(await call('delete_note', { id })).note?.trashed).toBe(true);
		await pull(alice.page);
		await expect(note(alice.page, 'Weekend plan')).toHaveCount(0);
		await goTo(alice.page, 'Trash');
		await expect(note(alice.page, 'Weekend plan')).toBeVisible();
		refused(await call('edit_note', { id, markdown: 'No' }), /in the trash/);

		expect(changed(await call('restore_note', { id })).note?.trashed).toBe(false);
		await goTo(alice.page, 'Notes');
		await pull(alice.page);
		await expect(note(alice.page, 'Weekend plan')).toBeVisible();
	});

	await test.step('it shares the user’s notes, and stops sharing them', async () => {
		const shared = await call('share_note', { id, username: bobName, permission: 'view' });
		expect(shared.structuredContent).toEqual({
			shares: [{ username: bobName, permission: 'view' }]
		});
		await pull(bob.page);
		await expect(note(bob.page, 'Weekend plan')).toBeVisible();
		expect((await call('list_shares', { id })).structuredContent.shares).toHaveLength(1);
		refused(await call('share_note', { id, username: 'nobody-at-all' }), /no user called/);

		const unshared = await call('unshare_note', { id, username: bobName });
		expect(unshared.structuredContent).toEqual({ shares: [] });
		await pull(bob.page);
		await expect(note(bob.page, 'Weekend plan')).toHaveCount(0);
	});

	await test.step('it hides notes, which it can still see when allowed', async () => {
		const hidden = changed(await call('organize_note', { id, hidden: true }));
		expect(hidden).toMatchObject({ in_reach: true, note: { hidden: true } });
		await pull(alice.page);
		await expect(note(alice.page, 'Trips').locator('.hiddenContent')).toBeVisible();
	});
});

test('what an MCP client may do is up to the user, for each app', async ({ app, request }) => {
	const { page } = await app.register(uniqueName('permissions'));
	await newNote(page, 'Work plan');
	await addTag(page, 'Work plan', 'Work');
	await newNote(page, 'Diary entry');
	await addTag(page, 'Diary entry', 'Private');
	await newNote(page, 'Loose idea');
	await waitSynced(page);

	// Sees everything, to find the ids, and hides one of the notes.
	const full = await connect(page, request, FULL_ACCESS, 'Full app');
	const all = (await callTool(request, full.access_token, 'search_notes')).structuredContent
		.notes as { id: string; title: string }[];
	const idOf = (title: string) => all.find((n) => n.title === title)!.id;
	changed(
		await callTool(request, full.access_token, 'organize_note', {
			id: idOf('Loose idea'),
			hidden: true,
			add_tags: ['Someday']
		})
	);

	await test.step('by default, it can only read, and not hidden notes', async () => {
		const reader = await connect(page, request, {}, 'Reader');
		expect(await toolNames(request, reader.access_token)).toEqual(READ_TOOLS);
		const found = await callTool(request, reader.access_token, 'search_notes');
		expect(titles(found)).toEqual(['Diary entry', 'Work plan']);
		const hidden = await callTool(request, reader.access_token, 'get_note', {
			id: idOf('Loose idea')
		});
		refused(hidden, /There's no note/);
	});

	await test.step('notes with excluded tags are out of its reach, and so are those tags', async () => {
		const excluding = await connect(
			page,
			request,
			{ tagMode: 'exclude', tags: ['Private'], create: true, organize: true },
			'Excluding'
		);
		expect(await toolNames(request, excluding.access_token)).toEqual(
			[...READ_TOOLS, 'create_note', 'organize_note'].sort()
		);
		const call = (name: string, args: Record<string, unknown> = {}) =>
			callTool(request, excluding.access_token, name, args);
		expect(titles(await call('search_notes'))).toEqual(['Work plan']);
		// It's not told what the excluded tags are.
		const tags = (await call('list_tags')).structuredContent.tags as { name: string }[];
		expect(tags.map((tag) => tag.name)).toEqual(['Work']);
		refused(await call('get_note', { id: idOf('Diary entry') }), /There's no note/);
		refused(
			await call('organize_note', { id: idOf('Diary entry'), archived: true }),
			/There's no note/
		);
		refused(await call('create_note', { markdown: 'Mine', tags: ['private'] }), /may not use/);
		refused(
			await call('organize_note', { id: idOf('Work plan'), add_tags: ['Private'] }),
			/may not use/
		);
		// "Someday" is only on a hidden note, which it can't see, but it's the user's tag still.
		const someday = changed(
			await call('create_note', { markdown: 'Someday list', tags: ['someday'] })
		);
		expect(someday.note?.tags).toEqual(['Someday']);
	});

	await test.step('with included tags, only notes with those, until untagged', async () => {
		const including = await connect(
			page,
			request,
			{ tagMode: 'include', tags: ['Work'], organize: true },
			'Including'
		);
		const call = (name: string, args: Record<string, unknown> = {}) =>
			callTool(request, including.access_token, name, args);
		expect(titles(await call('search_notes'))).toEqual(['Work plan']);
		const untagged = changed(
			await call('organize_note', { id: idOf('Work plan'), remove_tags: ['Work'] })
		);
		expect(untagged).toEqual({
			id: idOf('Work plan'),
			in_reach: false,
			message: expect.any(String)
		});
		refused(await call('get_note', { id: idOf('Work plan') }), /There's no note/);
		changed(
			await callTool(request, full.access_token, 'organize_note', {
				id: idOf('Work plan'),
				add_tags: ['Work']
			})
		);
	});

	await test.step('the database has no tag of a filter', async () => {
		const database = await readFile('e2e/.data/test.db');
		expect(database.includes('Private')).toBe(false);
	});

	await test.step('the settings change what an app may do', async () => {
		await page.goto(url('/settings'));
		const reader = page.getByRole('listitem', { name: 'Reader' });
		await expect(reader.locator('.access')).toHaveText('Read');
		await reader.getByRole('button', { name: 'Permissions' }).click();
		await choosePermissions(reader, { hidden: true, delete: true });
		await reader.getByRole('button', { name: 'Save' }).click();
		await expect(reader.locator('.access')).toHaveText('Read, also hidden notes · write: delete');

		// Without read, nothing that needs it.
		const excluding = page.getByRole('listitem', { name: 'Excluding' });
		await excluding.getByRole('button', { name: 'Permissions' }).click();
		await expect(excluding.locator('details.tagPicker summary')).toHaveText('Private');
		await choosePermissions(excluding, { read: false });
		await expect(excluding.getByRole('checkbox', { name: /^Tag, color/ })).toBeDisabled();
		await expect(excluding.getByRole('checkbox', { name: /^Create notes/ })).toBeEnabled();
		await excluding.getByRole('button', { name: 'Cancel' }).click();
	});

	await test.step('renaming a tag waits for the filters, which need a connection', async () => {
		await page.goto(url('/'));
		await page.route('**/api/mcp/access', (route) => route.abort('internetdisconnected'));
		await page.getByRole('button', { name: 'Edit tags' }).click();
		const dialog = page.getByRole('dialog', { name: 'Edit tags' });
		await dialog.getByRole('textbox', { name: 'Name of Private' }).fill('Secret');
		await dialog.getByRole('button', { name: 'Save' }).click();
		const confirm = page.getByRole('dialog', { name: 'Rename the tags anyway?' });
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirm).toHaveCount(0);
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(note(page, 'Diary entry').locator('.tag')).toHaveText(['Private']);
		await page.unroute('**/api/mcp/access');
	});

	await test.step('renaming a tag keeps the filters meaning the same notes', async () => {
		await page.goto(url('/'));
		await page.getByRole('button', { name: 'Edit tags' }).click();
		const dialog = page.locator('dialog[open]');
		await dialog.getByRole('textbox', { name: 'Name of Private' }).fill('Secret');
		await dialog.getByRole('button', { name: 'Save' }).click();
		await expect(dialog).toHaveCount(0);
		await waitSynced(page);

		await page.goto(url('/settings'));
		const excluding = page.getByRole('listitem', { name: 'Excluding' });
		await excluding.getByRole('button', { name: 'Permissions' }).click();
		await expect(excluding.locator('details.tagPicker summary')).toHaveText('Secret');
	});

	await test.step('without read, it can only create notes, which it then can’t see', async () => {
		const writer = await connect(page, request, { read: false, create: true }, 'Writer');
		expect(await toolNames(request, writer.access_token)).toEqual(['create_note']);
		const created = changed(
			await callTool(request, writer.access_token, 'create_note', { markdown: 'Written blind' })
		);
		expect(created).toEqual({ id: created.id, in_reach: false, message: expect.any(String) });
		await page.goto(url('/'));
		await syncNow(page);
		await expect(note(page, 'Written blind')).toBeVisible();
	});
});

test('an MCP client can’t change notes shared to view only, but can organize them', async ({
	app,
	request
}) => {
	const owner = await app.register(uniqueName('owner'));
	const viewerName = uniqueName('viewer');
	const viewer = await app.register(viewerName);
	const ownerClient = await connect(owner.page, request, FULL_ACCESS, 'Owner app');
	const { id } = changed(
		await callTool(request, ownerClient.access_token, 'create_note', { markdown: 'Shared plan' })
	);
	await callTool(request, ownerClient.access_token, 'share_note', {
		id,
		username: viewerName,
		permission: 'view'
	});

	const viewerClient = await connect(viewer.page, request, FULL_ACCESS, 'Viewer app');
	const call = (name: string, args: Record<string, unknown> = {}) =>
		callTool(request, viewerClient.access_token, name, args);
	const read = await call('get_note', { id });
	expect(read.structuredContent).toMatchObject({ can_edit: false, owned: false });
	refused(await call('edit_note', { id, markdown: 'Mine now' }), /view only/);
	refused(await call('organize_note', { id, color: 'red' }), /view only/);
	refused(await call('share_note', { id, username: 'someone' }), /Only the note’s owner/);
	// Tags and the trash are the viewer's own.
	expect(changed(await call('organize_note', { id, add_tags: ['Later'] })).note?.tags).toEqual([
		'Later'
	]);
	expect(changed(await call('delete_note', { id })).note?.trashed).toBe(true);
	// The owner's note is as it was.
	const own = await callTool(request, ownerClient.access_token, 'get_note', { id });
	expect(own.structuredContent).toMatchObject({
		markdown: 'Shared plan',
		tags: [],
		trashed: false
	});
});
