import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gameUrl = 'file://' + path.join(__dirname, 'game-03.html');

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(gameUrl);
await page.waitForTimeout(1000);

await page.locator('#gameCanvas').click();
await page.waitForTimeout(200);

console.log('Playing for 20 seconds...\n');

const startTime = Date.now();
const PLAY_DURATION = 20_000;

// Current held keys
const held = { ArrowLeft: false, ArrowRight: false, ArrowUp: false };

async function setKey(key, down) {
  if (held[key] === down) return;
  held[key] = down;
  if (down) await page.keyboard.down(key);
  else       await page.keyboard.up(key);
}

// Read game state from the page
function gameState() {
  return page.evaluate(() => ({
    px: player.x,
    py: player.y,
    onGround: player.onGround,
    fx: fruit.x,
    fy: fruit.y,
    score,
  }));
}

let lastScore = -1;
let jumpCooldown = 0;

const TICK = 80; // ms per control tick

while (Date.now() - startTime < PLAY_DURATION) {
  const elapsed = Date.now() - startTime;
  const state = await gameState();
  const { px, py, onGround, fx, fy, score } = state;

  if (score !== lastScore) {
    console.log(`[${Math.round(elapsed / 1000)}s] Score: ${score}  (fruit was at y=${Math.round(fy)})`);
    lastScore = score;
  }

  // Fruit center vs player center
  const playerCx = px + 15;
  const fruitCx  = fx + 16;
  const dx = fruitCx - playerCx;
  const dy = fy - py; // negative means fruit is above player

  const DEADZONE = 8;
  const JUMP_THRESH = -30; // fruit is more than 30px above player

  // Horizontal movement: head toward fruit
  if (dx > DEADZONE) {
    await setKey('ArrowRight', true);
    await setKey('ArrowLeft', false);
  } else if (dx < -DEADZONE) {
    await setKey('ArrowLeft', true);
    await setKey('ArrowRight', false);
  } else {
    await setKey('ArrowLeft', false);
    await setKey('ArrowRight', false);
  }

  // Jump when:
  // - fruit is above us and we're roughly aligned horizontally, or
  // - we need to cross a gap (jump periodically when moving)
  jumpCooldown = Math.max(0, jumpCooldown - TICK);
  const shouldJump =
    onGround &&
    jumpCooldown === 0 &&
    (dy < JUMP_THRESH || (Math.abs(dx) < 120 && dy < -10));

  if (shouldJump) {
    await setKey('ArrowUp', true);
    await page.waitForTimeout(50);
    await setKey('ArrowUp', false);
    jumpCooldown = 400;
  }

  // If we're near a canvas edge, reverse direction with a jump
  if (onGround && jumpCooldown === 0) {
    if (px < 10) {
      await setKey('ArrowLeft', false);
      await setKey('ArrowRight', true);
      await setKey('ArrowUp', true);
      await page.waitForTimeout(50);
      await setKey('ArrowUp', false);
      jumpCooldown = 500;
    } else if (px > 560) {
      await setKey('ArrowRight', false);
      await setKey('ArrowLeft', true);
      await setKey('ArrowUp', true);
      await page.waitForTimeout(50);
      await setKey('ArrowUp', false);
      jumpCooldown = 500;
    }
  }

  await page.waitForTimeout(TICK);
}

// Release all keys
await setKey('ArrowLeft', false);
await setKey('ArrowRight', false);
await setKey('ArrowUp', false);

const final = await gameState();
console.log(`\nDone! Final score: ${final.score}`);
await page.waitForTimeout(3000);
await browser.close();
