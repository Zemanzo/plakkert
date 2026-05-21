/**
 * Copyright (c) Syed Umar Anis
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import './PlakkertTheme.css';

const theme = {
	autocomplete: 'PlakkertTheme__autocomplete',
	blockCursor: 'PlakkertTheme__blockCursor',
	characterLimit: 'PlakkertTheme__characterLimit',
	code: 'PlakkertTheme__code',
	codeHighlight: {
		atrule: 'PlakkertTheme__tokenAttr',
		attr: 'PlakkertTheme__tokenAttr',
		boolean: 'PlakkertTheme__tokenProperty',
		builtin: 'PlakkertTheme__tokenSelector',
		cdata: 'PlakkertTheme__tokenComment',
		char: 'PlakkertTheme__tokenSelector',
		class: 'PlakkertTheme__tokenFunction',
		'class-name': 'PlakkertTheme__tokenFunction',
		comment: 'PlakkertTheme__tokenComment',
		constant: 'PlakkertTheme__tokenProperty',
		deleted: 'PlakkertTheme__tokenDeleted',
		doctype: 'PlakkertTheme__tokenComment',
		entity: 'PlakkertTheme__tokenOperator',
		function: 'PlakkertTheme__tokenFunction',
		important: 'PlakkertTheme__tokenVariable',
		inserted: 'PlakkertTheme__tokenInserted',
		keyword: 'PlakkertTheme__tokenAttr',
		namespace: 'PlakkertTheme__tokenVariable',
		number: 'PlakkertTheme__tokenProperty',
		operator: 'PlakkertTheme__tokenOperator',
		prolog: 'PlakkertTheme__tokenComment',
		property: 'PlakkertTheme__tokenProperty',
		punctuation: 'PlakkertTheme__tokenPunctuation',
		regex: 'PlakkertTheme__tokenVariable',
		selector: 'PlakkertTheme__tokenSelector',
		string: 'PlakkertTheme__tokenSelector',
		symbol: 'PlakkertTheme__tokenProperty',
		tag: 'PlakkertTheme__tokenProperty',
		unchanged: 'PlakkertTheme__tokenUnchanged',
		url: 'PlakkertTheme__tokenOperator',
		variable: 'PlakkertTheme__tokenVariable'
	},
	embedBlock: {
		base: 'PlakkertTheme__embedBlock',
		focus: 'PlakkertTheme__embedBlockFocus'
	},
	hashtag: 'PlakkertTheme__hashtag',
	heading: {
		h1: 'PlakkertTheme__h1',
		h2: 'PlakkertTheme__h2',
		h3: 'PlakkertTheme__h3',
		h4: 'PlakkertTheme__h4',
		h5: 'PlakkertTheme__h5',
		h6: 'PlakkertTheme__h6'
	},
	hr: 'PlakkertTheme__hr',
	hrSelected: 'PlakkertTheme__hrSelected',
	image: 'editor-image',
	indent: 'PlakkertTheme__indent',
	inlineImage: 'inline-editor-image',
	layoutContainer: 'PlakkertTheme__layoutContainer',
	layoutItem: 'PlakkertTheme__layoutItem',
	link: 'PlakkertTheme__link',
	list: {
		checklist: 'PlakkertTheme__checklist',
		listitem: 'PlakkertTheme__listItem',
		listitemChecked: 'PlakkertTheme__listItemChecked',
		listitemUnchecked: 'PlakkertTheme__listItemUnchecked',
		nested: {
			listitem: 'PlakkertTheme__nestedListItem'
		},
		olDepth: [
			'PlakkertTheme__ol1',
			'PlakkertTheme__ol2',
			'PlakkertTheme__ol3',
			'PlakkertTheme__ol4',
			'PlakkertTheme__ol5'
		],
		ul: 'PlakkertTheme__ul'
	},
	ltr: 'PlakkertTheme__ltr',
	mark: 'PlakkertTheme__mark',
	markOverlap: 'PlakkertTheme__markOverlap',
	paragraph: 'PlakkertTheme__paragraph',
	quote: 'PlakkertTheme__quote',
	rtl: 'PlakkertTheme__rtl',
	specialText: 'PlakkertTheme__specialText',
	tab: 'PlakkertTheme__tabNode',
	table: 'PlakkertTheme__table',
	tableAddColumns: 'PlakkertTheme__tableAddColumns',
	tableAddRows: 'PlakkertTheme__tableAddRows',
	tableAlignment: {
		center: 'PlakkertTheme__tableAlignmentCenter',
		right: 'PlakkertTheme__tableAlignmentRight'
	},
	tableCell: 'PlakkertTheme__tableCell',
	tableCellActionButton: 'PlakkertTheme__tableCellActionButton',
	tableCellActionButtonContainer: 'PlakkertTheme__tableCellActionButtonContainer',
	tableCellHeader: 'PlakkertTheme__tableCellHeader',
	tableCellResizer: 'PlakkertTheme__tableCellResizer',
	tableCellSelected: 'PlakkertTheme__tableCellSelected',
	tableFrozenColumn: 'PlakkertTheme__tableFrozenColumn',
	tableFrozenRow: 'PlakkertTheme__tableFrozenRow',
	tableRowStriping: 'PlakkertTheme__tableRowStriping',
	tableScrollableWrapper: 'PlakkertTheme__tableScrollableWrapper',
	tableSelected: 'PlakkertTheme__tableSelected',
	tableSelection: 'PlakkertTheme__tableSelection',
	text: {
		bold: 'PlakkertTheme__textBold',
		capitalize: 'PlakkertTheme__textCapitalize',
		code: 'PlakkertTheme__textCode',
		highlight: 'PlakkertTheme__textHighlight',
		italic: 'PlakkertTheme__textItalic',
		lowercase: 'PlakkertTheme__textLowercase',
		strikethrough: 'PlakkertTheme__textStrikethrough',
		subscript: 'PlakkertTheme__textSubscript',
		superscript: 'PlakkertTheme__textSuperscript',
		underline: 'PlakkertTheme__textUnderline',
		underlineStrikethrough: 'PlakkertTheme__textUnderlineStrikethrough',
		uppercase: 'PlakkertTheme__textUppercase'
	}
};

export default theme;
