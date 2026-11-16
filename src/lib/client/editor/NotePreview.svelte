<script lang="ts">
	import { renderNotePreview } from './NotePreview';

	let { html }: { html: string } = $props();
</script>

<!-- The same structure and classes as the editor, so it looks the same, and opening the note
     doesn't make anything move. -->
<div class="tipex-editor focal isDisabled w-full flex-1">
	<div class="tipex-editor-wrap">
		<div class="tipex-editor-section">
			<div
				class="tiptap ProseMirror"
				translate="no"
				{@attach (element) => element.replaceChildren(renderNotePreview(html))}
			></div>
		</div>
	</div>
</div>
