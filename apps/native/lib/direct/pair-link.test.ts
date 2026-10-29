import { expect, test } from "bun:test";

import { pairRouteFor, pairingLinkOf } from "@/lib/direct/pair-link";

const HEX64 = "ab".repeat(32);
const QUERY = `v=1&h=100.64.0.1&h=desk.local&p=7600&f=${HEX64}&s=${"cd".repeat(16)}`;
const LINK = `atur://pair?${QUERY}`;
const ROUTE = `/pair?link=${encodeURIComponent(LINK)}`;

test("a pairing link opened by the OS routes to /pair with the whole link encoded", () => {
  expect(pairRouteFor(LINK)).toBe(ROUTE);
  expect(pairRouteFor(`  ${LINK}\n`)).toBe(ROUTE);
  expect(pairRouteFor(`ATUR://pair?${QUERY}`)).toBe(ROUTE);
  expect(pairRouteFor(`atur://pair/?${QUERY}`)).toBe(ROUTE);
});

test("a bare path is rebuilt as the full link", () => {
  expect(pairRouteFor(`/pair?${QUERY}`)).toBe(ROUTE);
});

test("the encoded link survives the round trip", () => {
  const route = pairRouteFor(LINK) ?? "";
  const encoded = route.slice("/pair?link=".length);
  expect(decodeURIComponent(encoded)).toBe(LINK);
  expect(encoded).not.toContain("&");
});

test("our own route is kept, not wrapped twice", () => {
  expect(pairRouteFor(ROUTE)).toBe(ROUTE);
  expect(pairRouteFor(`atur://pair?link=${encodeURIComponent(LINK)}`)).toBe(ROUTE);
});

test("a link with nothing after pair still routes, so the screen can reject it", () => {
  expect(pairRouteFor("atur://pair")).toBe(`/pair?link=${encodeURIComponent("atur://pair")}`);
  expect(pairRouteFor("/pair")).toBe(`/pair?link=${encodeURIComponent("atur://pair")}`);
});

test("everything else is not a pairing link", () => {
  expect(pairRouteFor("atur://auth/callback?code=1")).toBeNull();
  expect(pairRouteFor("/panes")).toBeNull();
  expect(pairRouteFor("/pairing?x=1")).toBeNull();
  expect(pairRouteFor("atur://pairs?x=1")).toBeNull();
  expect(pairRouteFor("https://example.com/pair?x=1")).toBeNull();
  expect(pairRouteFor("")).toBeNull();
});

test("a malformed wrapper is treated as a link of its own and left to the core", () => {
  const route = pairRouteFor("atur://pair?link=%E0%A4%A") ?? "";
  expect(route.startsWith("/pair?link=")).toBe(true);
  expect(decodeURIComponent(route.slice("/pair?link=".length))).toBe("atur://pair?link=%E0%A4%A");
});

test("pasted text: the link itself, a wrapped link, or anything else untouched", () => {
  expect(pairingLinkOf(`  ${LINK}  `)).toBe(LINK);
  expect(pairingLinkOf(ROUTE)).toBe(LINK);
  expect(pairingLinkOf(`atur://pair?link=${encodeURIComponent(LINK)}`)).toBe(LINK);
  expect(pairingLinkOf(`other://pair?${QUERY}`)).toBe(`other://pair?${QUERY}`);
  expect(pairingLinkOf("hello")).toBe("hello");
});
