type NoteContentData = {
	type: "text",
	variant?: number,
	content: string
} | {
	type: "header",
	variant: number,
	content: string
}

type NoteData = {
	key: string,
	contents: NoteContentData[],
};

export {
	NoteData,
	NoteContentData
};
