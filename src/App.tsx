import React from "react";
import styled from "styled-components";
import {
  Responsive as ResponsiveGridLayout,
  WidthProvider,
} from "react-grid-layout";
import { v4 as uuid } from "uuid";
import Header from "./Header";
import Note from "./note/Note";
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
    margin: 0 calc(2rem - 20px);
    box-sizing: border-box;
  `
);

const initialNotes: NoteData[] = [
  {
    key: uuid(),
    contents: [
      { type: "header", variant: 1, content: "Yo" },
      {
        type: "text",
        content: `this note is dope
        bro
      `,
      },
    ],
    layout: { x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 1 },
  },
  {
    key: uuid(),
    contents: [
      {
        type: "header",
        variant: 1,
        content:
          "Groceries are totally the best but why would you need more than two lines to do this shit bro it's really uncool",
      },
      {
        type: "text",
        content: `Apples
        Grapes
        Monkey
      `,
      },
    ],
    layout: { x: 1, y: 0, w: 3, h: 2, minW: 2, minH: 1 },
  },
  {
    key: uuid(),
    contents: [
      { type: "header", variant: 1, content: "This is my title" },
      { type: "text", content: "This is my title" },
    ],
    layout: { x: 4, y: 0, w: 2, h: 2, minW: 2, minH: 1 },
  },
];

let currentNotesLayout: ReactGridLayout.Layout[] | undefined;

const App = () => {
  const [notes, setNotes] = React.useState(initialNotes);

  const createNote = (): void => {
    const updatedNotes = _updateNotesLayout(notes);
    setNotes([
      {
        key: uuid(),
        contents: [
          { type: "header", variant: 1, content: "Placeholder" },
          { type: "text", content: "Placeholder text" },
        ],
        layout: { x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 1 },
      },
      ...updatedNotes,
    ]);
  };

  const layoutChange = (
    currentLayout: ReactGridLayout.Layout[],
    allLayouts: ReactGridLayout.Layouts
  ): void => {
    console.log(currentLayout);
    currentNotesLayout = currentLayout;
  };

  /**
   * Update the given notes state to match the current layout and return the updated notes
   */
  const _updateNotesLayout = (currentNotes: NoteData[]) => {
    return currentNotes.map((note) => {
      const currentNoteLayout = currentNotesLayout?.find(
        (item) => item.i === note.key
      );
      if (!currentNoteLayout) {
        return note;
      }
      const { i: omit, ...updatedLayout } = currentNoteLayout;
      note.layout = updatedLayout;
      return note;
    });
  };

  const layouts = {
    lg: notes.map((note) => {
      return Object.assign(note.layout, { i: note.key });
    }),
  };

  return (
    <Root>
      <Header createNote={createNote} />
      {/* <h1>Create a note!</h1> */}
      <NotesContainer
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 10, md: 8, sm: 4, xs: 2, xxs: 2 }}
        margin={[20, 20]}
        compactType="horizontal"
        draggableCancel=".not-draggable"
        onLayoutChange={layoutChange}
      >
        {notes.map((note) => (
          <Note key={note.key} contents={note.contents} />
        ))}
      </NotesContainer>
    </Root>
  );
};

export default App;
