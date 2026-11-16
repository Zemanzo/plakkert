import type { Attachment } from 'svelte/attachments';

/**
 * Lets a file be dropped on an element, e.g. `{@attach fileDrop(onFile)}`.
 * While a file is dragged over it, the element has a `data-dropping`
 * attribute, to style it by.
 */
export function fileDrop(onFile: (file: File) => void, enabled = true): Attachment<HTMLElement> {
	return (element) => {
		if (!enabled) return;
		// Entering a child element leaves its parent, so count rather than toggle.
		let depth = 0;
		const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
		const setDropping = (dropping: boolean) => element.toggleAttribute('data-dropping', dropping);

		function ondragenter(event: DragEvent) {
			if (!hasFiles(event)) return;
			event.preventDefault();
			depth++;
			setDropping(true);
		}
		function ondragover(event: DragEvent) {
			if (!hasFiles(event)) return;
			// Allows dropping, rather than the browser opening the file.
			event.preventDefault();
			event.dataTransfer!.dropEffect = 'copy';
		}
		function ondragleave() {
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDropping(false);
		}
		function ondrop(event: DragEvent) {
			event.preventDefault();
			depth = 0;
			setDropping(false);
			const file = event.dataTransfer?.files[0];
			if (file) onFile(file);
		}

		element.addEventListener('dragenter', ondragenter);
		element.addEventListener('dragover', ondragover);
		element.addEventListener('dragleave', ondragleave);
		element.addEventListener('drop', ondrop);
		return () => {
			setDropping(false);
			element.removeEventListener('dragenter', ondragenter);
			element.removeEventListener('dragover', ondragover);
			element.removeEventListener('dragleave', ondragleave);
			element.removeEventListener('drop', ondrop);
		};
	};
}
