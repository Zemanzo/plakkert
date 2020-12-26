import React, { useLayoutEffect } from "react";
import styled, { StyledComponent } from "styled-components";
import TextareaAutosize from "react-textarea-autosize";
import { NoteContentData } from "../noteTypes";

const editableTextAreas: {
  [key: string]: StyledComponent<any, any, {}, never>;
} = {
  header1: styled(TextareaAutosize)`
    font-size: 2em;
    font-weight: bold;
    margin-bottom: 0.5em;
  `,
  text: styled(TextareaAutosize)``,
};

const Container = styled.div.attrs({
  className: "not-draggable",
})`
  height: 100%;
  width: 100%;
  overflow-y: auto;

  h1:first-child {
    margin-top: 0;
  }

  textarea {
    background: transparent;
    border: none;
    color: inherit;
    font-family: inherit;
    width: 100%;
    resize: none;
    height: fit-content;

    &:last-child {
      flex: 1;
    }

    &:active,
    &:focus {
      border: none;
      outline: none;
    }
  }
`;

const NoteContents: React.FC<{
  contents: NoteContentData[];
}> = ({ contents }) => {
  const elements = contents.map((part, index) => {
    const TextAreaType = _getTextAreaElement(part);
    return <TextAreaType defaultValue={part.content} key={index} />;
  });

  return <Container>{elements}</Container>;
};

const _getTextAreaElement = (part: NoteContentData) => {
  const type = `${part.type}${part.variant || ""}`;
  const element = editableTextAreas[type];
  if (!element) {
    throw new Error(`"${type}" is not a valid textarea element type!`);
  }
  return element;
};

export default NoteContents;
