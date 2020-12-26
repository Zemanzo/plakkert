import React, { useState } from "react";
import styled from "styled-components";
import { MdDragHandle, MdDelete, MdArchive } from "react-icons/md";
import { NoteContentData, NoteColors } from "../noteTypes";
import NoteContents from "./NoteContents";
import ColorPicker from "./ColorPicker";
import paperTexture from "./paper-texture.jpg";
const NoteOptions = styled.div.attrs({
  className: "not-draggable",
})`
  display: flex;
  font-size: 1.6em;
  align-self: flex-end;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.18s;

  & > * {
    opacity: 0.5;
    margin-right: 12px;
    cursor: pointer;

    &:hover {
      opacity: 1;
    }
  }
`;

const NoteElement = styled.div`
  color: #eee;
  background-image: url("${paperTexture}");
  background-repeat: repeat;
  background-blend-mode: multiply;
  background-color: ${(props: { noteColor: NoteColors }) =>
    props.noteColor.primary};
  box-shadow: ${(props: { noteColor: NoteColors }) =>
      props.noteColor.primaryShade}
    2px 2px 0px;
  padding: 4px 16px 8px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: 4px;

  &:hover ${NoteOptions} {
    visibility: visible;
    opacity: 1;
  }
`;

const DragHandle = styled(MdDragHandle)`
  opacity: 0.5;
  color: #000;
  font-size: 1.3em;
  cursor: grab;
  margin-bottom: 8px;
`;

const Note: React.FC<{
  contents: NoteContentData[];
}> = ({ children, contents, ...props }) => {
  const [noteColor, setNoteColor] = useState({
    primary: "#505050",
    primaryShade: "#303030",
  });
  return (
    <NoteElement {...props} noteColor={noteColor}>
      <DragHandle />
      <NoteContents contents={contents} />
      <NoteOptions>
        <ColorPicker setNoteColor={setNoteColor} />
        <MdArchive />
        <MdDelete />
      </NoteOptions>
      {children}
    </NoteElement>
  );
};

export default Note;
