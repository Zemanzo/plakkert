import React from "react";
import styled from "styled-components";
import { MdDragHandle, MdDelete, MdArchive } from "react-icons/md";
import NoteContents from "./NoteContents";
import { NoteContentData } from "./noteTypes";

const NoteOptions = styled.div.attrs({
	className: "not-draggable"
})`
	display: flex;
	font-size: 1.6em;
	align-self: flex-end;
	visibility: hidden;
	opacity: 0;
	transition: opacity .18s;

	& > * {
		opacity: .5;
		margin-right: 12px;
		cursor: pointer;

		&:hover {
			opacity: 1;
		}
	}
`;

const NoteElement = styled.div`
	color: #eee;
	background-color: #12418b;
	box-shadow: #0c2d63 2px 2px 0px;
	padding: 4px 16px 8px 16px;
	display: flex;
	flex-direction: column;
	align-items: center;

	&:hover ${NoteOptions} {
		visibility: visible;
		opacity: 1;
	}
`;

const DragHandle = styled(MdDragHandle)`
	opacity: .5;
	color: #000;
	font-size: 1.3em;
	cursor: grab;
	margin-bottom: 8px;
`;


const Note: React.FC<{
	contents: NoteContentData[]
}> = ({children, contents, ...props}) => {
	return (
		<NoteElement {...props}>
			<DragHandle/>
			<NoteContents contents={contents}/>
			<NoteOptions>
				<MdArchive />
				<MdDelete />
			</NoteOptions>
			{children}
		</NoteElement>
	);
};

export default Note;
