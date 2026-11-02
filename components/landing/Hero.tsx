"use client";

import type { ReactNode } from "react";
import NextLink from "next/link";
import styled, { keyframes } from "styled-components";
import { LogoMark } from "@/components/brand/Logo";

/*
 * The landing page. One job: explain FlowLens in a sentence and send people
 * to the setup form (/new). The header is deliberately just the brand.
 */

const BLUE = "#2142B5";
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

const rise = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
`;

const riseArt = keyframes`
  from { opacity: 0; transform: translateY(28px); }
  to { opacity: 1; transform: none; }
`;

const ping = keyframes`
  0% { opacity: 0.7; transform: scale(1); }
  70%, 100% { opacity: 0; transform: scale(2.6); }
`;

// Static film grain over the whole hero, for the printed, tactile feel.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const Page = styled.div`
  position: relative;
  min-height: 100vh;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  background: radial-gradient(120% 85% at 50% 0%, #2e57da 0%, ${BLUE} 58%, #1c3a9e 100%);
  isolation: isolate;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: ${GRAIN};
    opacity: 0.07;
    mix-blend-mode: overlay;
    pointer-events: none;
    z-index: -1;
  }
`;

const Header = styled.header`
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  height: 72px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  @media (min-width: 768px) {
    padding: 0 32px;
  }
`;

const Brand = styled(NextLink)`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  text-decoration: none;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.02em;
  border-radius: 10px;
  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 4px;
  }
`;

const Content = styled.main`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: clamp(28px, 6vh, 64px) 20px 28px;

  & > * {
    animation: ${rise} 700ms ${EASE_OUT} both;
  }
  & > :nth-child(2) {
    animation-delay: 70ms;
  }
  & > :nth-child(3) {
    animation-delay: 140ms;
  }
  & > :nth-child(4) {
    animation-delay: 210ms;
  }
`;

const Eyebrow = styled.p`
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  &::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.75);
  }
`;

const Title = styled.h1`
  margin: 22px 0 0;
  max-width: 12em;
  font-size: clamp(38px, 5.6vw, 76px);
  line-height: 1.02;
  letter-spacing: -0.035em;
  font-weight: 600;
  text-wrap: balance;
  & > span {
    display: inline;
  }
  & > span + span::before {
    content: " ";
  }
  @media (min-width: 640px) {
    & > span {
      display: block;
    }
    & > span + span::before {
      content: none;
    }
  }
`;

const Lede = styled.p`
  margin: 20px 0 0;
  max-width: 36em;
  font-size: clamp(16px, 1.3vw, 18px);
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.86);
  text-wrap: balance;
`;

const Actions = styled.div`
  margin-top: 32px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
`;

const Action = styled(NextLink)<{ $primary?: boolean }>`
  height: 48px;
  padding: 0 22px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  color: ${({ $primary }) => ($primary ? BLUE : "#fff")};
  background: ${({ $primary }) => ($primary ? "#fff" : "rgba(255, 255, 255, 0.06)")};
  border: 1px solid ${({ $primary }) => ($primary ? "#fff" : "rgba(255, 255, 255, 0.34)")};
  box-shadow: ${({ $primary }) => ($primary ? "0 1px 2px rgba(10, 26, 92, 0.25), 0 8px 24px -8px rgba(10, 26, 92, 0.5)" : "none")};
  transition:
    transform 160ms ease-out,
    background-color 160ms ease;
  -webkit-tap-highlight-color: transparent;

  svg {
    transition: transform 200ms ${EASE_OUT};
  }
  @media (hover: hover) and (pointer: fine) {
    &:hover {
      background: ${({ $primary }) => ($primary ? "#EEF2FF" : "rgba(255, 255, 255, 0.14)")};
    }
    &:hover svg {
      transform: translateX(3px);
    }
  }
  &:active {
    transform: scale(0.97);
  }
  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 3px;
  }
`;

const Stage = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: clamp(200px, 30vh, 260px);
  animation: ${riseArt} 1000ms ${EASE_OUT} 200ms both;

  .fl-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .fl-ping {
    transform-box: fill-box;
    transform-origin: center;
    animation: ${ping} 2.4s ${EASE_OUT} 1.4s infinite;
  }
`;

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Hero({ art }: { art: ReactNode }) {
  return (
    <Page>
      <Header>
        <Brand href="/" aria-label="FlowLens home">
          <LogoMark size={30} tone="inverse" />
          FlowLens
        </Brand>
      </Header>

      <Content>
        <Eyebrow>Usability testing for product and UX designers</Eyebrow>
        <Title>
          <span>Find the friction</span>
          <span>before your users do</span>
        </Title>
        <Lede>
          Add a website, a persona and a task. Watch an AI agent try the journey live, then get a clear report of where
          it struggled and what to fix.
        </Lede>
        <Actions>
          <Action href="/new" $primary>
            Start a test
            <ArrowRight />
          </Action>
          <Action href="/recents">See past tests</Action>
        </Actions>
      </Content>

      <Stage aria-hidden="true">{art}</Stage>
    </Page>
  );
}
