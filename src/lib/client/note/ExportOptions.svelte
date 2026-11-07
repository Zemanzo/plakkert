<script lang="ts">
	import FileTextIcon from '@iconify-svelte/lucide/file-text';
	import FileMarkdownIcon from '@iconify-svelte/lucide/file-type';
	import FileCodeIcon from '@iconify-svelte/lucide/file-code';
	import CopyIcon from '@iconify-svelte/lucide/copy';
	import DownloadIcon from '@iconify-svelte/lucide/download';
	import Button from '../components/Button.svelte';
	import {
		copyToClipboard,
		downloadFile,
		htmlToFormat,
		type ExportFormat
	} from '../serialization/TextAndMarkdown';

	let {
		noteId,
		htmlContent
	}: {
		noteId: string;
		/** The HTML content of the note */
		htmlContent: string;
	} = $props();

	let format = $state<ExportFormat>('markdown');
	let exportInProgress = $state(false);
	let errorMessage = $state<string | null>(null);

	async function exportNote(action: 'copy' | 'download') {
		if (!htmlContent) {
			errorMessage = 'No content to export';
			return;
		}

		try {
			exportInProgress = true;
			errorMessage = null;

			const content = htmlToFormat(htmlContent, format);
			const filename = `note-${noteId}.${format === 'markdown' ? 'md' : 'txt'}`;

			if (action === 'copy') {
				await copyToClipboard(content);
			} else {
				downloadFile(content, filename, format);
			}
		} catch (error) {
			console.error('Export failed:', error);
			errorMessage = error instanceof Error ? error.message : 'Export failed';
		} finally {
			exportInProgress = false;
		}
	}
</script>

<section>
	<h3>Export contents</h3>

	<fieldset>
		<div class="format-options">
			<label class="format-option" class:selected={format === 'markdown'}>
				<input
					type="radio"
					name="exportFormat"
					value="markdown"
					checked={format === 'markdown'}
					onchange={() => (format = 'markdown')}
				/>
				<FileMarkdownIcon width="40px" />
				<span>Markdown</span>
			</label>
			<label class="format-option" class:selected={format === 'text'}>
				<input
					type="radio"
					name="exportFormat"
					value="text"
					checked={format === 'text'}
					onchange={() => (format = 'text')}
				/>
				<FileTextIcon width="40px" />
				<span>Plain text</span>
			</label>
			<label class="format-option" class:selected={format === 'html'}>
				<input
					type="radio"
					name="exportFormat"
					value="html"
					checked={format === 'html'}
					onchange={() => (format = 'html')}
				/>
				<FileCodeIcon width="40px" />
				<span>HTML</span>
			</label>
		</div>
	</fieldset>

	<div class="buttons">
		<Button class="md" onclick={() => exportNote('copy')} disabled={exportInProgress}>
			<CopyIcon width="20px" />Copy to clipboard
		</Button>
		<Button class="md" onclick={() => exportNote('download')} disabled={exportInProgress}>
			<DownloadIcon width="20px" />Download file
		</Button>
	</div>

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
		padding: var(--spacing-sm);
	}

	h3 {
		margin: 0;
		font-family: var(--font-family-display);
		font-size: 1.2rem;
	}

	fieldset {
		border: none;
		padding: 0;
		margin: 0;
	}
	.format-options {
		display: flex;
		gap: var(--spacing-sm);
	}

	.format-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1;
		gap: var(--spacing-xs, 0.25rem);
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;

		&:hover {
			background-color: #00000005;
		}

		&.selected {
			background-color: var(--color-blue-light) 10;
		}

		&:not(.selected) {
			color: #fff8;

			&:hover {
				color: var(--text-color);
			}
		}

		input {
			display: none;
		}

		span {
			font-size: 0.9rem;
		}
	}

	p {
		margin: 0;
		font-size: 0.9rem;
		opacity: 0.8;

		&.error {
			color: var(--color-red);
			opacity: 1;
		}
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
	}
</style>
