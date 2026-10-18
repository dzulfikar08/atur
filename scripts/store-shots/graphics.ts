#!/usr/bin/env bun
// Play icon (512x512, opaque) and feature graphic (1024x500) from the app's own assets.
//
//   bun scripts/store-shots/graphics.ts [--out /tmp/atur-store-shots]
//
// Needs `sharp` (resolved from JoyoRogo's checkout like render.ts) and the Manrope font
// (the app's wordmark font) installed for fontconfig.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(
  process.env.PLAYWRIGHT_FROM ?? "/home/dzul/Documents/JoyoDigitama/joyorogo/package.json",
);
const sharp = require("sharp");

const i = process.argv.indexOf("--out");
const OUT = i > 0 ? process.argv[i + 1] : "/tmp/atur-store-shots";
mkdirSync(OUT, { recursive: true });
const ICON = resolve(import.meta.dir, "../../apps/native/assets/images/icon.png");

// Opaque 512x512: flatten onto white in case the source ever gains an alpha channel.
await sharp(ICON)
  .resize(512, 512)
  .flatten({ background: "#ffffff" })
  .removeAlpha()
  .png()
  .toFile(join(OUT, "play-icon-512.png"));

// Feature graphic: graphite field, the Atur roof mark, wordmark and the store tagline.
const W = 1024;
const H = 500;
// Mark path extents are x 212..812, y 225..736; scaled 0.55 and placed at x=80, vertically centred.
const mark = `<g transform="translate(-36.6 -14.3) scale(0.55)" fill="#F5F5F5">
  <path d="M212 736 512 225 812 736H706L512 406 318 736Z"/>
  <path d="M458 590 512 498 566 590V736H458Z"/>
</g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#171717"/>
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="#F5F5F5" fill-opacity=".08"/>
  ${mark}
  <text x="470" y="246" font-family="Manrope" font-weight="800" font-size="132" letter-spacing="-3" fill="#F5F5F5">Atur</text>
  <text x="474" y="312" font-family="Manrope" font-weight="500" font-size="30" fill="#BDBDBD">Your team's issues, projects</text>
  <text x="474" y="352" font-family="Manrope" font-weight="500" font-size="30" fill="#BDBDBD">and inbox, in your pocket.</text>
  <g transform="translate(474 392)">
    <circle cx="8" cy="8" r="8" fill="#F59E0B"/><circle cx="36" cy="8" r="8" fill="#BE185D"/>
    <circle cx="64" cy="8" r="8" fill="#7C3AED"/><circle cx="92" cy="8" r="8" fill="#22C55E"/>
  </g>
</svg>`;
await sharp(Buffer.from(svg))
  .flatten({ background: "#171717" })
  .removeAlpha()
  .png()
  .toFile(join(OUT, "play-feature-1024x500.png"));
console.log(join(OUT, "play-icon-512.png"), join(OUT, "play-feature-1024x500.png"));
