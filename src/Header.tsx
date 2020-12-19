import React from "react";
import styled from "styled-components";
import { FaGithub, FaPlus, FaSearch } from "react-icons/fa";
import logo from "./logo.svg";

const HeaderElement = styled.header`
	display: flex;
	align-items: center;
	margin-bottom: 10px;
`;

const Logo = styled.img`
	width: .75em;
	height: .75em;
`;

const Title = styled.h1`
	margin: 0 0 0 1em;
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
		margin-right: .5em;
	}
`;

const SearchBar = styled.div`
	background-color: #6666;
	border-bottom: #3339 2px solid;
	padding: 2px 16px;
	margin: 0 1em 0 2em;
	max-width: 70ch;
	flex: 1;
	white-space: nowrap;
`;

const SearchInput = styled.input`
	background: transparent;
	border: none;
	color: inherit;
	font-family: inherit;
	font-size: 1.2em;
	font-weight: 200;
	margin-left: .5em;
	min-width: 90%;

	&:active, &:focus {
		border: none;
		outline: none;
	}
`;

function Header() {
	return (
		<HeaderElement>
			<Title><Logo src={logo} alt="logo" /> Plakkert</Title>
			<NewPlakkert>
				<FaPlus/> New plakkert
			</NewPlakkert>
			<SearchBar>
				<FaSearch color="#999"/>
				<SearchInput type="text" placeholder="Search"/>
			</SearchBar>
		</HeaderElement>
	);
}

export default Header;
