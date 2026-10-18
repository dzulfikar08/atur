#!/usr/bin/env bun
// Store screenshots from the Expo web build, signed in as the store-review account.
//
//   (cd apps/native && EXPO_PUBLIC_SERVER_URL=https://app.diatur.com bunx expo start --web --port 8081)
//   bun scripts/store-shots/capture-web.ts [--out /tmp/atur-store-shots] [--url http://localhost:8081] [--only today,inbox]
//
// Headless Chromium (Playwright from JoyoRogo's checkout, same as render.ts) renders the app at a phone
// viewport with deviceScaleFactor 3. Expo web has no system chrome, so the capture is placed under a
// plain status bar (time, signal, Wi-Fi, battery) drawn here; no other UI is added or altered.
//
// Sizes (device pixels): Play 1080x1920, iPhone 6.9" 1320x2868, iPhone 6.5" 1242x2688.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(
  process.env.PLAYWRIGHT_FROM ?? "/home/dzul/Documents/JoyoDigitama/joyorogo/package.json",
);
const { chromium } = require("playwright");
const sharp = require("sharp");

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out", "/tmp/atur-store-shots");
const URL = arg("url", "http://localhost:8081");
const ONLY = arg("only", "").split(",").filter(Boolean);
const API = process.env.EXPO_PUBLIC_SERVER_URL ?? "https://app.diatur.com";

const SIZES = [
  { dir: "play", w: 360, h: 640 },
  { dir: "ios-6.9", w: 440, h: 956 },
  { dir: "ios-6.5", w: 414, h: 896 },
];
const SCALE = 3;

const creds: Record<string, string> = {};
for (const l of readFileSync(join(homedir(), ".config/atur/review-login.txt"), "utf8").split(
  "\n",
)) {
  const i = l.indexOf("=");
  if (i > 0) creds[l.slice(0, i)] = l.slice(i + 1);
}
const signIn = await fetch(`${API}/auth/sign-in`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status}`);
const token = ((await signIn.json()) as { session_token: string }).session_token;

function statusBar(width: number, height: number, ink: string): Buffer {
  const s = SCALE;
  const w = width * s;
  const h = height * s;
  const cy = h / 2;
  const bars = [0.35, 0.55, 0.75, 1].map((f, i) => {
    const bh = 10 * s * f;
    return `<rect x="${w - 76 * s + i * 4.2 * s}" y="${cy + 5 * s - bh}" width="${2.6 * s}" height="${bh}" rx="${0.8 * s}" fill="${ink}"/>`;
  });
  const wifi = `<path d="M${w - 54 * s} ${cy - 1 * s}a${8 * s} ${8 * s} 0 0 1 ${12 * s} 0M${w - 52 * s} ${cy + 2 * s}a${5 * s} ${5 * s} 0 0 1 ${8 * s} 0" stroke="${ink}" stroke-width="${1.7 * s}" fill="none" stroke-linecap="round"/><circle cx="${w - 48 * s}" cy="${cy + 5 * s}" r="${1.5 * s}" fill="${ink}"/>`;
  const batt = `<rect x="${w - 36 * s}" y="${cy - 5 * s}" width="${22 * s}" height="${11 * s}" rx="${3 * s}" fill="none" stroke="${ink}" stroke-opacity=".45" stroke-width="${1 * s}"/><rect x="${w - 34 * s}" y="${cy - 3 * s}" width="${18 * s}" height="${7 * s}" rx="${1.8 * s}" fill="${ink}"/><rect x="${w - 13 * s}" y="${cy - 1.5 * s}" width="${1.6 * s}" height="${4 * s}" rx="${0.8 * s}" fill="${ink}" fill-opacity=".45"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${22 * s}" y="${cy + 5.5 * s}" font-family="Plus Jakarta Sans, Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="${16 * s}" fill="${ink}">9:41</text>${bars.join("")}${wifi}${batt}</svg>`,
  );
}

const STATUS_H = 30; // css px

type Step = (page: import("playwright").Page) => Promise<void>;
const scrollMain = (page: import("playwright").Page, top: number) =>
  page.evaluate((to) => {
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (el.scrollHeight > el.clientHeight + 200 && getComputedStyle(el).overflowY !== "visible") {
        el.scrollTo({ top: to });
      }
    }
  }, top);
const settle = (page: import("playwright").Page, ms = 900) => page.waitForTimeout(ms);

const ISSUE = "Crash when opening a notification";
const shots: { name: string; run: Step }[] = [
  {
    name: "01-today",
    run: async (page) => {
      await page.goto(URL + "/", { waitUntil: "networkidle" });
      await page.getByText(ISSUE).first().waitFor();
      await settle(page);
    },
  },
  {
    name: "02-today-list",
    run: async (page) => {
      await page.goto(URL + "/", { waitUntil: "networkidle" });
      await page.getByText(ISSUE).first().waitFor();
      await scrollMain(page, 360);
      await settle(page);
    },
  },
  {
    name: "03-projects",
    run: async (page) => {
      await page.goto(URL + "/projects", { waitUntil: "networkidle" });
      await page.getByText("Mobile App").first().waitFor();
      await settle(page);
    },
  },
  {
    name: "03b-my-issues",
    run: async (page) => {
      await page.goto(URL + "/my-issues", { waitUntil: "networkidle" });
      await page.getByText(ISSUE).first().waitFor();
      await settle(page, 1500);
    },
  },
  {
    name: "04-project-issues",
    run: async (page) => {
      await page.goto(URL + "/projects", { waitUntil: "networkidle" });
      await page.getByText("Mobile App").first().click();
      await page.getByText(ISSUE).first().waitFor();
      await page.getByText("Mine, by due date").first().click();
      await settle(page, 1500);
    },
  },
  {
    name: "05-filters",
    run: async (page) => {
      await page.goto(URL + "/projects", { waitUntil: "networkidle" });
      await page.getByText("Mobile App").first().click();
      await page.getByText(ISSUE).first().waitFor();
      await page.getByLabel("Filters, sort and grouping").first().click();
      await page
        .getByText(/^High\s*\d/)
        .first()
        .waitFor();
      await page
        .getByText(/^High\s*\d/)
        .first()
        .click();
      await page
        .getByText(/^Urgent\s*\d/)
        .first()
        .click();
      await settle(page);
    },
  },
  {
    name: "06-issue",
    run: async (page) => {
      await page.goto(URL + "/projects", { waitUntil: "networkidle" });
      await page.getByText("Mobile App").first().click();
      await page.getByText(ISSUE).first().click();
      await page.getByText("Found it: the link is handled").first().waitFor();
      await settle(page);
    },
  },
  {
    name: "06b-issue-comments",
    run: async (page) => {
      await page.goto(URL + "/projects", { waitUntil: "networkidle" });
      await page.getByText("Mobile App").first().click();
      await page.getByText(ISSUE).first().click();
      await page.getByText("Found it: the link is handled").first().waitFor();
      await page
        .getByText("Found it: the link is handled")
        .first()
        .evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.mouse.wheel(0, 1);
      await settle(page, 1800);
    },
  },
  {
    name: "07-search",
    run: async (page) => {
      await page.goto(URL + "/search", { waitUntil: "networkidle" });
      await page.getByPlaceholder("Search issues and projects").fill("notification");
      await page.getByText(ISSUE).first().waitFor();
      await settle(page);
    },
  },
  {
    name: "08-inbox",
    run: async (page) => {
      await page.goto(URL + "/inbox", { waitUntil: "networkidle" });
      await page.getByText("Maya Chen").first().waitFor();
      await settle(page);
    },
  },
  {
    name: "09-today-dark",
    run: async (page) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(URL + "/", { waitUntil: "networkidle" });
      await page.getByText(ISSUE).first().waitFor();
      await settle(page, 1500);
    },
  },
];

const wanted = shots.filter((s) => !ONLY.length || ONLY.some((o) => s.name.includes(o)));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
for (const size of SIZES) {
  mkdirSync(join(OUT, size.dir), { recursive: true });
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h - STATUS_H },
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
  await context.addInitScript((t: string) => localStorage.setItem("atur.session_token", t), token);
  const page = await context.newPage();
  for (const shot of wanted) {
    await page.emulateMedia({ colorScheme: "light" });
    await shot.run(page);
    // Expo web paints the document background white below the first screenful; match the app's.
    await page.evaluate(() => {
      for (const el of document.elementsFromPoint(8, 120)) {
        const c = getComputedStyle(el).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
          document.documentElement.style.background = c;
          document.body.style.background = c;
          return;
        }
      }
    });
    const raw = await page.screenshot({ type: "png" });
    const bg = await sharp(raw).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer();
    const background = { r: bg[0], g: bg[1], b: bg[2] };
    const ink = background.r + background.g + background.b < 300 ? "#F5F5F5" : "#111111";
    const out = join(OUT, size.dir, `${shot.name}.png`);
    await sharp({
      create: { width: size.w * SCALE, height: size.h * SCALE, channels: 3, background },
    })
      .composite([
        { input: raw, top: STATUS_H * SCALE, left: 0 },
        { input: statusBar(size.w, STATUS_H, ink), top: 0, left: 0 },
      ])
      .removeAlpha() // App Store and Play reject screenshots with an alpha channel
      .png()
      .toFile(out);
    console.log(out);
  }
  await context.close();
}
await browser.close();
