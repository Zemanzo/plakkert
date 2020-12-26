type NoteContentData =
  | {
      type: "text";
      variant?: number;
      content: string;
    }
  | {
      type: "header";
      variant: number;
      content: string;
    };

type NoteData = {
  key: string;
  contents: NoteContentData[];
  layout: {
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
  };
};

type NoteColors = {
  primary: string;
  primaryShade: string;
  secondary?: string;
  secondaryShade?: string;
};

export { NoteData, NoteContentData, NoteColors };
