<script lang="ts">
	import {
		Composer,
		ContentEditable,
		Toolbar,
		RichTextPlugin,
		HistoryPlugin,
		ListPlugin,
		CheckListPlugin,
		HorizontalRulePlugin,

		// Tools
		BoldButton,
		Divider,
		ItalicButton,
		UnderlineButton,
		StrikethroughButton,
		FormatCodeButton,
		BlockFormatDropDown,
		ParagraphDropDownItem,
		HeadingDropDownItem,
		NumberDropDrownItem,
		BulletDropDrownItem,
		CheckDropDrownItem,
		QuoteDropDrownItem,
		CodeDropDrownItem,

		// Nodes
		HeadingNode,
		QuoteNode,
		ListNode,
		ListItemNode,
		HorizontalRuleNode,
		CodeNode,

		// Helpers
		$getRoot as getRoot,
		$createTextNode as createTextNode,
		$createHeadingNode as createHeadingNode,
		$createParagraphNode as createParagraphNode
	} from 'svelte-lexical';
	import PlakkertTheme from './themes/PlakkertTheme';

	const initialConfig = {
		theme: PlakkertTheme,
		nodes: [HeadingNode, ListNode, ListItemNode, QuoteNode, HorizontalRuleNode, CodeNode],
		onError: (error: Error) => {
			throw error;
		},
		editorState: () => {
			const root = getRoot();
			if (root.getFirstChild() === null) {
				// Title (H1) with placeholder text
				const title = createHeadingNode('h1').append(createTextNode('Title (click to edit)'));
				// Paragraph with placeholder text
				const paragraph = createParagraphNode().append(
					createTextNode('Serialize your thoughts...')
				);
				root.append(title, paragraph);
			}
		}
	};
</script>

<Composer {initialConfig}>
	<div class="editor-shell svelte-lexical">
		<Toolbar>
			{#snippet children({ editor, activeEditor, blockType })}
				<BoldButton />
				<ItalicButton />
				<UnderlineButton />
				<StrikethroughButton />
				<FormatCodeButton />
				<Divider />
				{#if activeEditor === editor}
					<BlockFormatDropDown>
						<ParagraphDropDownItem />
						<HeadingDropDownItem headingSize="h1" />
						<HeadingDropDownItem headingSize="h2" />
						<HeadingDropDownItem headingSize="h3" />
						<NumberDropDrownItem />
						<BulletDropDrownItem />
						<CheckDropDrownItem />
						<QuoteDropDrownItem />
						<CodeDropDrownItem />
					</BlockFormatDropDown>
					<Divider />
				{/if}
			{/snippet}
		</Toolbar>
		<div class="editor-container">
			<div class="editor-scroller">
				<div class="editor">
					<ContentEditable />
				</div>
			</div>
			<RichTextPlugin />
			<HistoryPlugin />
			<ListPlugin />
			<CheckListPlugin />
			<HorizontalRulePlugin />
		</div>
	</div>
</Composer>

<style>
	.editor-shell {
		margin: 0;
	}

	:global(.svelte-lexical) {
		.toolbar {
			flex-wrap: wrap;
			overflow: hidden;
		}

		.editor-paragraph {
			font-family: sans-serif;
		}
	}
</style>
