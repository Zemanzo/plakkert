import React from "react";
import styled, { css } from "styled-components";
import Color from "color";
import { MdColorLens } from "react-icons/md";
import { NoteColors } from "../noteTypes";

const tooltipWidth = 160;
const tooltipVisibleProperties = css`
  visibility: visible;
  pointer-events: inherit;
  transform: scale(1, 1) translateY(0);
  opacity: 1;
`;
const tooltipBackground = css`rgba(220, 220, 220, 0.6)`;
const Tooltip = styled.div`
  visibility: hidden;
  pointer-events: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  background: ${tooltipBackground};
  width: ${tooltipWidth}px;
  height: 150px;
  position: absolute;
  bottom: calc(100% + 8px);
  left: calc(50% - ${tooltipWidth * 0.5}px);
  padding: 4px 10px 10px 10px;
  border-radius: 2px;
  transition: transform 0.2s ease, opacity 0.25s ease;
  transform: scale(0.1, 0.1) translateY(1em);
  transform-origin: bottom center;
  opacity: 0;
  backdrop-filter: blur(10px);

  &:hover {
    ${tooltipVisibleProperties}
  }

  &::before {
    content: "";
    position: absolute;
    bottom: -10px;
    left: calc(50% - 12px);
    width: 0;
    height: 0;
    border-left: 12px solid transparent;
    border-right: 12px solid transparent;
    border-top: 10px solid rgba(220, 220, 220, 0.6);
    backdrop-filter: blur(10px);
  }

  &::after {
    content: "";
    position: absolute;
    bottom: -20px;
    width: 0;
    height: 0;
    border-left: ${tooltipWidth * 0.5}px solid transparent;
    border-right: ${tooltipWidth * 0.5}px solid transparent;
    border-top: 20px solid rgba(0, 0, 0, 0);
  }
`;

const ColorVariant = styled.div`
  border: 2px solid rgba(0, 0, 0, 0.6);
  border-radius: 8px;
  box-shadow: rgba(0, 0, 0, 0.2) 1px 2px 0px,
    ${(props) => props.color}66 1px 2px 2px;
  background: ${(props) => props.color};
  width: 23%;
  height: 20%;
  margin: 0 1% 6px 1%;

  &:hover {
    border: none;
  }
`;

const OptionContainer = styled.div`
  position: relative;

  svg:hover ~ ${Tooltip} {
    ${tooltipVisibleProperties}
  }
`;

const OptionHeader = styled.div`
  font-size: 1.2rem;
  text-shadow: #1119 1px 1px 0px, #1119 1px 1px 3px;
  font-weight: 100;
  width: 100%;
  margin-bottom: 8px;
  text-align: center;
`;

const ColorPicker: React.FC<{
  setNoteColor: React.Dispatch<
    React.SetStateAction<{
      primary: string;
      primaryShade: string;
    }>
  >;
}> = ({ setNoteColor }) => {
  const defaultColors = [
    "#12418b",
    "#4d1fb9",
    "#009494",
    "#268b12",
    "#9d8500",
    "#8b4c12",
    "#8b1212",
    "#97008d",
    "#505050",
  ];

  return (
    <OptionContainer>
      <MdColorLens />
      <Tooltip>
        <OptionHeader>Color</OptionHeader>
        {defaultColors.map((color) => {
          const noteColor: NoteColors = {
            primary: color,
            primaryShade: Color(color).darken(0.3).hex(),
          };
          return (
            <ColorVariant
              role="button"
              color={color}
              key={color}
              onClick={(e) => {
                setNoteColor(noteColor);
              }}
            />
          );
        })}
      </Tooltip>
    </OptionContainer>
  );
};

export default ColorPicker;
