import React, { useEffect, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import Color from "color";
import {
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdFastForward,
} from "react-icons/md";
import { FaDiscord, FaFacebookF, FaGoogle, FaTwitch } from "react-icons/fa";
import RestUtil from "./RestUtil";

const iconLookup: {
  [key: string]: {
    icon: JSX.Element;
    background: string;
    foreground: string;
  };
} = {
  discord: {
    icon: <FaDiscord />,
    background: "#7289DA",
    foreground: "#fff",
  },
  facebook: {
    icon: <FaFacebookF />,
    background: "#3b5998",
    foreground: "#fff",
  },
  google: {
    icon: <FaGoogle />,
    background: "#ccc",
    foreground: "#111",
  },
  twitch: {
    icon: <FaTwitch />,
    background: "#9146FF",
    foreground: "#fff",
  },
};

const fadeIn = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const backgroundPulse = keyframes`
  0%   {
    background-position: 0% 0%;
    background-color: #111;
  }
  25%  {
    background-position: 100% 50%;
    background-color: #1b1864;
  }
  50%  {
    background-position: 50% 100%;
    background-color: #411c1c;
  }
  100% {
    background-position: 100% 100%;
    background-color: #3c2a50;
  }
`;

const AuthContainer = styled.div`
  opacity: 0;
  margin-bottom: 10px;
  background-color: #111;
  background-image: radial-gradient(circle at left top, #00aeff44, transparent),
    radial-gradient(circle at center top, #8200fc44, transparent),
    radial-gradient(circle at right top, #00d9ff44, transparent),
    radial-gradient(circle at left center, #1900ff44, transparent),
    radial-gradient(circle at center center, #ff000044, transparent),
    radial-gradient(circle at right center, #583a1844, transparent),
    radial-gradient(circle at left bottom, #d3d3d344, transparent),
    radial-gradient(circle at center bottom, #ffaff844, transparent),
    radial-gradient(circle at right bottom, #583a1844, transparent);
  background-size: 200% 200%;
  border-radius: 4px;
  width: 60ch;
  padding: 1em;
  text-shadow: #111 1px 1px 3px;

  animation: ${backgroundPulse} 120s ease infinite alternate,
    ${fadeIn} 0.15s 0.05s ease-in 1 forwards;
`;

const Title = styled.h2`
  margin: 0 0 0.5rem 0;
  font-weight: 100;
  text-transform: uppercase;
  color: #d1bfbf;
  text-align: center;
`;

const Description = styled.p`
  font-weight: 100;
  color: #eee;
`;
const CheckboxLabel = styled.label`
  color: #ddd;
  display: flex;
  align-items: flex-end;
  user-select: none;
  font-size: 0.9rem;

  svg {
    font-size: 1rem;
    margin: 0 0.5em 0.1em 0;
  }

  &:hover {
    color: #fff;
  }
`;

const Checkbox = styled.input`
  opacity: 0;
  position: absolute;

  &:checked + ${CheckboxLabel} svg:first-child {
    display: none;
  }
  &:not(:checked) + ${CheckboxLabel} svg:not(:first-child) {
    display: none;
  }
`;

const AuthMethods = styled.div`
  display: flex;
  flex-wrap: wrap;
  background: #1115;
  box-shadow: #1115 2px 2px 5px;
  border-radius: 4px;
`;

const AuthMethodStatus = styled.div`
  display: flex;
  width: 100%;
  justify-content: center;
  align-items: center;
  margin: 16px;
  font-style: italic;
`;

const SkipAuth = styled.div`
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 8px;
  margin-top: 6px;
  background: #1115;
  color: #999;
  font-size: 0.8rem;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  svg {
    font-size: 1rem;
  }

  &:hover {
    background: #2145;
    color: #ddd;
  }
`;

const AuthMethodButton = styled.button`
  align-self: end;
  display: flex;
  align-items: center;
  ${(props: { background: string; foreground: string; index: number }) => css`
    background: ${props.background};
    box-shadow: ${Color(props.background).darken(0.1).hex()} 2px 2px 0;
    color: ${props.foreground};
    animation: ${fadeIn} 0.15s ${0.05 * props.index}s ease-in 1 forwards;
  `}
  border: none;
  font-family: inherit;
  font-size: 1.5em;
  font-weight: 200;
  padding: 8px;
  margin: 6px;
  cursor: pointer;
  border-radius: 2px;
  opacity: 0;

  &:first-child {
    margin: 12px 6px 6px 12px;
  }

  &:hover {
    ${(props: { background: string; foreground: string }) => css`
      background: ${Color(props.background).lighten(0.1).hex()};
      box-shadow: ${Color(props.background).darken(0.1).hex()} 2px 2px 0;
    `}
  }

  &:active {
    ${(props: { background: string; foreground: string }) => css`
      background: ${Color(props.background).darken(0.1).hex()};
      box-shadow: ${Color(props.background).darken(0.3).hex()} 1px 1px 0;
    `}
    transform: translate(1px, 1px);
  }
`;

const AuthWindow: React.FC<{
  setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ setIsAuthenticated }) => {
  const [authMethods, setAuthMethods] = useState<string[] | null>(null);

  useEffect(() => {
    RestUtil.getAuthenticationMethods().then((methods) => {
      if (methods.error) {
        setAuthMethods([]);
        return console.error(methods.error);
      }
      setAuthMethods(methods);
    });
  }, []);

  return (
    <AuthContainer>
      <Title>Authentication</Title>
      <Description>
        To retain your notes, select your preferred method of authentication.
      </Description>
      <AuthMethods>
        {Array.isArray(authMethods) && authMethods.length > 0 ? (
          authMethods.map((method, index) => (
            <AuthMethodButton
              background={iconLookup[method]?.background}
              foreground={iconLookup[method]?.foreground}
              index={index}
              key={method}
            >
              {iconLookup[method]?.icon || method}
            </AuthMethodButton>
          ))
        ) : (
          <AuthMethodStatus>
            {authMethods === null
              ? "Loading..."
              : "Only local storage is available."}
          </AuthMethodStatus>
        )}
        <SkipAuth
          onClick={() => {
            setIsAuthenticated(true);
          }}
        >
          skip authentication (local storage only) <MdFastForward />
        </SkipAuth>
      </AuthMethods>
      <Description>
        <Checkbox type="checkbox" id="rememberDecision" />
        <CheckboxLabel htmlFor="rememberDecision">
          <MdCheckBoxOutlineBlank />
          <MdCheckBox />
          Remember my decision
        </CheckboxLabel>
      </Description>
    </AuthContainer>
  );
};

export default AuthWindow;
