// Generates the Longbow mark (static/brand/longbow-mark.svg): a bow limb shaded with an ordered
// 4x4 Bayer dither, solid at the grip and sparse at the tips, a straight string, and an arrow
// pointing up and to the right. Run: node scripts/brand.mjs
import { writeFileSync } from "node:fs";

const BLUE = "#7FB2E5";
const GRAPHITE = "#1B1D22";
const OFFWHITE = "#E8EAEE";
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => (v + 0.5) / 16));

const CELL = 8;
const TIP = 162; // half chord
const APEX = 112;
const R = (TIP * TIP + APEX * APEX) / (2 * APEX);
const CX = APEX - R;
const BAND = 30;

const cells = [];
for (let gx = -20; gx <= 150; gx += 1) {
  for (let gy = -24; gy <= 24; gy += 1) {
    const x = gx * CELL + CELL / 2;
    const y = gy * CELL + CELL / 2;
    if (x < -6) continue;
    const d = Math.hypot(x - CX, y);
    const off = d - R;
    if (Math.abs(off) > BAND) continue;
    const f = Math.max(0, 1 - Math.abs(y) / (TIP + 6)); // 1 at the grip, 0 at the tips
    const core = 7 + 11 * f;
    const fringe = Math.max(0, 1 - Math.abs(off) / BAND);
    const intensity = Math.abs(off) <= core ? 1 : fringe * (0.25 + 0.75 * f);
    const t = BAYER[((gy % 4) + 4) % 4][((gx % 4) + 4) % 4];
    if (intensity > t) cells.push([gx * CELL, gy * CELL]);
  }
}
const dots = cells.map(([x, y]) => `M${x} ${y}h${CELL}v${CELL}h-${CELL}z`).join("");

// Local frame: arrow points +x. The group is rotated so it points up and to the right.
const body = `
  <g transform="translate(229 283) rotate(-45) scale(0.94)">
    <path d="${dots}" fill="${BLUE}"/>
    <line x1="0" y1="${-TIP}" x2="0" y2="${TIP}" stroke="${OFFWHITE}" stroke-width="3" stroke-linecap="round" opacity="0.9"/>
    <line x1="-150" y1="0" x2="196" y2="0" stroke="${OFFWHITE}" stroke-width="7" stroke-linecap="round"/>
    <path d="M232 0 L190 -20 L190 20 Z" fill="${BLUE}"/>
    <path d="M-150 0 L-176 -22 L-158 -22 L-132 0 L-158 22 L-176 22 Z" fill="${BLUE}"/>
  </g>`;

const mark = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${body}</svg>\n`;
const out = new URL("../static/brand/", import.meta.url);
const bgRect = `<rect width="512" height="512" rx="112" fill="${GRAPHITE}"/>`;
writeFileSync(new URL("longbow-mark.svg", out), mark(bgRect));
writeFileSync(new URL("longbow-mark-bare.svg", out), mark(""));
writeFileSync(
  new URL("longbow-lockup.svg", out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 512"><rect width="1400" height="512" fill="${GRAPHITE}"/><g>${body}</g><text x="520" y="318" font-family="'Plus Jakarta Sans', 'Liberation Sans', 'Helvetica Neue', Arial, sans-serif" font-size="190" font-weight="600" letter-spacing="-4" fill="${OFFWHITE}">Longbow</text></svg>\n`,
);
const white = (svg) => svg.replaceAll(BLUE, "#fff").replaceAll(OFFWHITE, "#fff");
const sized = (svg, box) => svg.replace('viewBox="0 0 512 512"', `viewBox="${box}"`);
const stat = new URL("../static/", import.meta.url);
writeFileSync(new URL("badge.svg", stat), white(mark("")));
writeFileSync(
  new URL("icon-maskable.svg", stat),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${GRAPHITE}"/><g transform="translate(256 256) scale(0.82) translate(-256 -256)">${body}</g></svg>\n`,
);
writeFileSync(new URL("icon.svg", stat), mark(bgRect));
writeFileSync(new URL("favicon.svg", stat), mark(bgRect));
console.log("cells", cells.length);
