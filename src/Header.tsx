import React from "react";
import styled from "styled-components";
import { MdAddBox, MdSearch } from "react-icons/md";
import logo from "./logo.svg";

const HeaderElement = styled.header`
  display: flex;
  align-items: center;
  margin-bottom: 10px;
`;

const Logo = styled.img`
  width: 0.75em;
  height: 0.75em;
`;

const Title = styled.h1`
  margin: 0 0 0 2rem;
  font-weight: 100;
  text-transform: uppercase;
  color: #918888;
`;

const NewPlakkert = styled.button`
  display: flex;
  align-items: center;
  background: #999;
  color: #111;
  border: none;
  font-family: inherit;
  font-size: 1.2em;
  font-weight: 200;
  padding: 4px 16px;
  margin-left: 2em;
  cursor: pointer;

  &:hover {
    background: #eee;
  }

  svg {
    margin-right: 0.5em;
  }
`;

const SearchBar = styled.div`
  background-color: #6666;
  box-shadow: #3339 2px 2px 0px;
  padding: 2px 16px;
  margin: 0 1em 0 2em;
  max-width: 70ch;
  flex: 1;
  white-space: nowrap;
  border-radius: 2px;
`;

const SearchInput = styled.input`
  background: transparent;
  border: none;
  color: inherit;
  font-family: inherit;
  font-size: 1.2em;
  font-weight: 200;
  margin-left: 0.5em;
  min-width: 90%;

  &:active,
  &:focus {
    border: none;
    outline: none;
  }
`;

const Header: React.FC<{
  createNote: () => void;
}> = ({ createNote }) => {
  return (
    <HeaderElement>
      <Title>
        <Logo src={logo} alt="logo" /> Plakkert
      </Title>
      <NewPlakkert onClick={createNote}>
        <MdAddBox /> New plakkert
      </NewPlakkert>
      <SearchBar>
        <MdSearch color="#999" />
        <SearchInput type="text" placeholder="Search" />
      </SearchBar>
    </HeaderElement>
  );
};

export default Header;
