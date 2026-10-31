import { chromium, Browser, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = __dirname;
const DELAY = 1500; // ms to wait between actions for UI to settle

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page: Page, name: string) {
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`✓ Saved: ${name}.png`);
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('🚀 Starting screenshot capture...');
  console.log('📱 Navigating to http://localhost:5173');

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 60000 });

  // Wait for app to load
  await page.waitForSelector('.app', { state: 'visible', timeout: 30000 });
  await wait(2000);

  // =============================================
  // 1. MAIN EDITOR - Default view
  // =============================================
  console.log('\n📸 1. Main Editor (default view)');
  await takeScreenshot(page, '01-main-editor');

  // =============================================
  // 2. UI WORKSPACE
  // =============================================
  console.log('\n📸 2. UI Workspace');
  await page.click('button:has-text("Workspace UI")');
  await page.waitForSelector('text=Workspace de UI', { state: 'visible', timeout: 10000 });
  await wait(DELAY);
  await takeScreenshot(page, '02-ui-workspace');

  // Close UI Workspace (click close or outside)
  await page.keyboard.press('Escape');
  await wait(DELAY);

  // =============================================
  // 3. PLAYER WORKSPACE - Main tab
  // =============================================
  console.log('\n📸 3. Player Workspace (main tab)');
  await page.click('button:has-text("Player")');
  await page.waitForSelector('text=Configurar jogador', { state: 'visible', timeout: 10000 });
  await wait(DELAY);
  await takeScreenshot(page, '03-player-workspace-main');

  // =============================================
  // 4. PLAYER WORKSPACE - Scripts e variáveis tab
  // =============================================
  console.log('\n📸 4. Player Workspace (Scripts e variáveis tab)');
  await page.click('button:has-text("Scripts e variáveis")');
  await page.waitForSelector('text=Variáveis do jogador', { state: 'visible', timeout: 5000 });
  await wait(DELAY);
  await takeScreenshot(page, '04-player-workspace-scripts');

  // Close Player Workspace
  await page.keyboard.press('Escape');
  await wait(DELAY);

  // =============================================
  // 5. VISUAL SCRIPT GRAPH
  // =============================================
  console.log('\n📸 5. Visual Script Graph');
  const graphButton = page.locator('button:has-text("Visual Script")').first();
  await expect(graphButton).toBeVisible({ timeout: 10000 });
  await graphButton.click();
  await page.waitForSelector('text=VISUAL SCRIPT', { state: 'visible', timeout: 10000 });
  await wait(DELAY);
  await takeScreenshot(page, '05-visual-script-graph');

  // Close Visual Script (might be a panel, try Escape)
  await page.keyboard.press('Escape');
  await wait(DELAY);

  // =============================================
  // 6. MODEL IMPORT DIALOG
  // =============================================
  console.log('\n📸 6. Model Import Dialog');
  const importButton = page.locator('button:has-text("Modelo 3D")').first();
  await expect(importButton).toBeVisible({ timeout: 10000 });
  await importButton.click();
  await page.waitForSelector('text=Configurar modelo 3D', { state: 'visible', timeout: 10000 });
  await wait(DELAY);
  await takeScreenshot(page, '06-model-import-dialog');

  // Close Model Import
  await page.keyboard.press('Escape');
  await wait(DELAY);

  // =============================================
  // 7. CONTROL MAPS DIALOG
  // =============================================
  console.log('\n📸 7. Control Maps Dialog');
  await page.click('button:has-text("Controles")');
  await page.waitForSelector('text=Mapas de Controle', { state: 'visible', timeout: 10000 });
  await wait(DELAY);
  await takeScreenshot(page, '07-control-maps-dialog');

  // Close Control Maps
  await page.keyboard.press('Escape');
  await wait(DELAY);

  // =============================================
  // 8. RUNTIME / PLAY MODE (with HUD)
  // =============================================
  console.log('\n📸 8. Runtime / Play Mode (with HUD)');
  const runButton = page.locator('button:has-text("Jogar")').first();
  await expect(runButton).toBeVisible({ timeout: 10000 });
  await runButton.click();
  await page.waitForSelector('.is-running', { state: 'visible', timeout: 15000 });
  await wait(3000); // Extra time for runtime to initialize
  await takeScreenshot(page, '08-runtime-play-mode');

  // =============================================
  // 9. BACK TO EDIT MODE
  // =============================================
  console.log('\n📸 9. Back to Edit Mode');
  const editButton = page.locator('button:has-text("Editar")').first();
  await expect(editButton).toBeVisible({ timeout: 5000 });
  await editButton.click();
  await page.waitForSelector('.app:not(.is-running)', { state: 'visible', timeout: 10000 });
  await wait(DELAY);
  await takeScreenshot(page, '09-back-to-edit-mode');

  // =============================================
  // 10. FULLSCREEN DIAGNOSTICS (Ctrl+Shift+F)
  // =============================================
  console.log('\n📸 10. Fullscreen Diagnostics');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyF');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('text=DIAGNÓSTICOS', { state: 'visible', timeout: 5000 });
  await wait(DELAY);
  await takeScreenshot(page, '10-fullscreen-diagnostics');

  // Exit diagnostics
  await page.keyboard.press('Escape');
  await wait(DELAY);

  // =============================================
  // 11. WORLD FULLSCREEN (if available via topbar)
  // =============================================
  console.log('\n📸 11. World Fullscreen');
  // Check if there's a fullscreen button in topbar
  const fullscreenBtn = page.locator('button[aria-label*="tela cheia" i], button:has-text("Tela cheia")').first();
  if (await fullscreenBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fullscreenBtn.click();
    await page.waitForSelector('.world-fullscreen', { state: 'visible', timeout: 5000 });
    await wait(DELAY);
    await takeScreenshot(page, '11-world-fullscreen');
    // Exit fullscreen
    await page.keyboard.press('Escape');
    await wait(DELAY);
  } else {
    console.log('  ⚠ World fullscreen button not found, skipping');
  }

  // =============================================
  // 12. FIRST PERSON MODE (if toggle available)
  // =============================================
  console.log('\n📸 12. First Person Mode');
  const fpBtn = page.locator('button:has-text("1ª Pessoa"), button[aria-label*="primeira pessoa" i]').first();
  if (await fpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fpBtn.click();
    await wait(DELAY);
    await takeScreenshot(page, '12-first-person-mode');
    // Toggle back
    await fpBtn.click();
    await wait(DELAY);
  } else {
    console.log('  ⚠ First person toggle not found, skipping');
  }

  // =============================================
  // 13. VIEWPORT LAYOUT CONFIG (if available)
  // =============================================
  console.log('\n📸 13. Viewport Layout Config');
  const layoutBtn = page.locator('button:has-text("Layout"), button[aria-label*="layout" i]').first();
  if (await layoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await layoutBtn.click();
    await page.waitForSelector('text=Layout do Viewport', { state: 'visible', timeout: 5000 });
    await wait(DELAY);
    await takeScreenshot(page, '13-viewport-layout-config');
    await page.keyboard.press('Escape');
    await wait(DELAY);
  } else {
    console.log('  ⚠ Viewport layout button not found, skipping');
  }

  // =============================================
  // 14. COLLAPSED SIDEBAR VIEW
  // =============================================
  console.log('\n📸 14. Collapsed Sidebar View');
  const collapseBtn = page.locator('button:has-text("Colapsar"), button[aria-label*="colapsar" i]').first();
  if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await collapseBtn.click();
    await page.waitForSelector('.sidebar-collapsed', { state: 'visible', timeout: 5000 });
    await wait(DELAY);
    await takeScreenshot(page, '14-collapsed-sidebar');
    // Expand back
    await page.click('button:has-text("Abrir painel")');
    await wait(DELAY);
  } else {
    console.log('  ⚠ Collapse sidebar button not found, skipping');
  }

  await browser.close();
  console.log('\n✅ All screenshots captured!');
  console.log(`📁 Saved to: ${SCREENSHOTS_DIR}`);
}

main().catch(console.error);