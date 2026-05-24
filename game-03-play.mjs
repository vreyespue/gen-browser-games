import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gameUrl = 'file://' + path.join(__dirname, 'game-03.html');

// --- Platform geometry ---
// bottom: x=50-250, y=350, player standY=310
// middle: x=300-500, y=280, player standY=240
// top:    x=150-300, y=200, player standY=160
// ground: canvas floor,       player standY=360
//
// Fruit y per platform: bottom=318, middle=248, top=168
//
// Jump physics: jumpPower=-10, gravity=0.5
//   max height = 10^2/(2*0.5) = 100px, duration ≈ 40 game frames ≈ 667ms
//
// bottom→middle: launch from x≈205, jump right, hold right ~500ms → land x≈330
// middle→top:    launch from x≈315, jump left,  hold left  ~320ms → land x≈220

const TICK = 80; // ms per bot decision
const PLAY_DURATION = 20_000;

function detectLevel(py) {
  if (py <= 170) return 'top';
  if (py <= 255) return 'middle';
  if (py <= 330) return 'bottom';
  return 'ground';
}

function detectFruitLevel(fy) {
  if (fy < 190) return 'top';
  if (fy < 268) return 'middle';
  return 'bottom';
}

// --- Key state ---
const held = {};
async function setKey(page, key, down) {
  if (held[key] === down) return;
  held[key] = down;
  if (down) await page.keyboard.down(key);
  else       await page.keyboard.up(key);
}
async function releaseAll(page) {
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp'])
    await setKey(page, k, false);
}

// --- Launch ---
const browser = await chromium.launch({ headless: false });
const page    = await browser.newPage();
await page.goto(gameUrl);
await page.waitForTimeout(1000);
await page.locator('#gameCanvas').click();
await page.waitForTimeout(200);

console.log('Playing for 20 seconds...\n');

const startTime = Date.now();
let lastScore       = 0;
let lastGroundLevel = 'bottom'; // level last time onGround was true
let jumpUntil       = 0;        // timestamp until which to hold jump direction
let jumpDir         = null;     // 'left' | 'right' | null

while (Date.now() - startTime < PLAY_DURATION) {
  const now     = Date.now();
  const elapsed = now - startTime;

  const { px, py, onGround, fx, fy, score } = await page.evaluate(() => ({
    px: rewe.x, py: rewe.y, onGround: rewe.onGround,
    fx: fruit.x, fy: fruit.y, score: reweScore,
  }));

  if (score !== lastScore) {
    console.log(`[${Math.round(elapsed / 1000)}s] Score: ${score}`);
    lastScore = score;
  }

  if (onGround) lastGroundLevel = detectLevel(py);

  // ── Phase: mid-jump ──────────────────────────────────────────────────────
  if (now < jumpUntil) {
    if (jumpDir === 'right') {
      await setKey(page, 'ArrowRight', true);
      await setKey(page, 'ArrowLeft', false);
    } else if (jumpDir === 'left') {
      await setKey(page, 'ArrowLeft', true);
      await setKey(page, 'ArrowRight', false);
    }
    await page.waitForTimeout(TICK);
    continue;
  }

  // Jump phase ended — release horizontal key
  if (jumpDir !== null) {
    await setKey(page, 'ArrowLeft', false);
    await setKey(page, 'ArrowRight', false);
    jumpDir = null;
  }

  // ── Decision logic ───────────────────────────────────────────────────────
  const playerLevel = lastGroundLevel;
  const fruitLevel  = detectFruitLevel(fy);
  const playerCx    = px + 15;
  const fruitCx     = fx + 16;

  async function initiateJump(dir, holdMs) {
    if (!onGround) return;
    if (dir === 'right') await setKey(page, 'ArrowRight', true);
    if (dir === 'left')  await setKey(page, 'ArrowLeft', true);
    await setKey(page, 'ArrowUp', true);
    await page.waitForTimeout(50);
    await setKey(page, 'ArrowUp', false);
    jumpDir   = dir;
    jumpUntil = Date.now() + holdMs;
  }

  function distTo(targetX) {
    return targetX - playerCx;
  }

  async function moveToX(targetX) {
    const d = distTo(targetX);
    if (d > 8) {
      await setKey(page, 'ArrowRight', true);
      await setKey(page, 'ArrowLeft', false);
    } else if (d < -8) {
      await setKey(page, 'ArrowLeft', true);
      await setKey(page, 'ArrowRight', false);
    } else {
      await setKey(page, 'ArrowLeft', false);
      await setKey(page, 'ArrowRight', false);
    }
    return Math.abs(d);
  }

  // Same level → collect fruit
  if (playerLevel === fruitLevel ||
      (playerLevel === 'ground' && fruitLevel === 'bottom')) {
    if (playerLevel === 'ground') {
      // On canvas floor: move under bottom platform then jump up onto it
      const dist = await moveToX(150);
      if (dist < 20 && onGround) await initiateJump(null, 0);
    } else {
      await moveToX(fruitCx);
    }

  // Need to go UP ────────────────────────────────────────────────────────────
  } else if (fruitLevel === 'middle' || fruitLevel === 'top') {
    if (playerLevel === 'bottom' || playerLevel === 'ground') {
      // Step 1: reach middle platform — launch from x≈205, jump right
      const dist = await moveToX(205);
      if (dist < 15 && playerLevel === 'bottom') await initiateJump('right', 500);

    } else if (playerLevel === 'middle' && fruitLevel === 'top') {
      // Step 2: reach top platform — launch from x≈315, jump left
      const dist = await moveToX(315);
      if (dist < 15) await initiateJump('left', 320);
    }

  // Need to go DOWN ──────────────────────────────────────────────────────────
  } else if (playerLevel === 'top') {
    // Walk right off top → fall onto middle platform
    await setKey(page, 'ArrowRight', true);
    await setKey(page, 'ArrowLeft', false);

  } else if (playerLevel === 'middle' && fruitLevel === 'bottom') {
    // Walk left off middle → keep pressing left during fall → land on bottom
    await setKey(page, 'ArrowLeft', true);
    await setKey(page, 'ArrowRight', false);

  } else {
    // Fallback: head toward fruit
    await moveToX(fruitCx);
  }

  await page.waitForTimeout(TICK);
}

await releaseAll(page);
const { score: finalScore } = await page.evaluate(() => ({ score: reweScore }));
console.log(`\nDone! Final score: ${finalScore}`);
await page.waitForTimeout(3000);
await browser.close();
