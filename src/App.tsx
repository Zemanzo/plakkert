import React from "react";
import styled from "styled-components";
import { Responsive as ResponsiveGridLayout, WidthProvider } from "react-grid-layout";
import Header from "./Header";
import Note from "./Note";
import { NoteData } from "./noteTypes";

const Root = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
`;

const NotesContainer = WidthProvider(
  styled(ResponsiveGridLayout)`
    overflow-x: hidden;
    flex: 1;
  `
);

const notes: NoteData[] = [
  {
    key: "a",
    contents: [
      { type: "header", variant: 1, content: "Yo" },
      {
        type: "text", content: `this note is dope
        bro
      `}
    ]
  },
  {
    key: "b",
    contents: [
      { type: "header", variant: 1, content: "Groceries are totally the best but why would you need more than two lines to do this shit bro it's really uncool" },
      { type: "text", content: `Apples
        Grapes
        Monkey
      `}
    ]
  },
  {
    key: "c",
    contents: [
      { type: "header", variant: 1, content: "This is my title" },
      { type: "text", content: "This is my title" }
    ],
  }
];

const App = () => {
  const layouts = {
    lg: [
      { i: "a", x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 1 },
      { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, minH: 1 },
      { i: "c", x: 4, y: 0, w: 2, h: 2, minW: 2, minH: 1 }
    ]
  };

  return (
    <Root>
      <Header/>
      {/* <h1>Create a note!</h1> */}
      <NotesContainer
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 10, md: 8, sm: 4, xs: 2, xxs: 1 }}
        margin={[20, 20]}
        containerPadding={[80, 0]}
        compactType="horizontal"
        draggableCancel=".not-draggable"
      >
        {notes.map(note => <Note key={note.key} contents={note.contents}/>)}
      </NotesContainer>
    </Root>
  );
};

export default App;
