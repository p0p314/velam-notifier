// Exporte les icônes PNG de l'app depuis les SVG sources de frontend/public (logo Mox).
// À relancer après toute retouche du logo :  node scripts/export-icons.cjs
// Nécessite Playwright (Chromium), hors des dépendances du projet : NODE_PATH=$(npm root -g).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const EXPORTS = [
  // [source SVG, fichier PNG, taille]
  ['mox-icon.svg', 'icon-192.png', 192],          // icône « any » (plaque arrondie)
  ['mox-icon.svg', 'icon-512.png', 512],
  ['mox-icon-maskable.svg', 'icon-maskable-192.png', 192], // plein cadre, rogné par Android
  ['mox-icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['mox-icon-maskable.svg', 'apple-touch-icon.png', 180],  // iOS arrondit lui-même
  ['mox-badge.svg', 'badge-72.png', 72],          // badge de notification monochrome
  ['favicon.svg', 'favicon-32.png', 32],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [src, out, size] of EXPORTS) {
    const svg = fs.readFileSync(path.join(PUB, src), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="display:block;width:${size}px;height:${size}px" `)}</body></html>`);
    await page.screenshot({ path: path.join(PUB, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`${out} (${size} px) ← ${src}`);
  }
  await browser.close();
})();
