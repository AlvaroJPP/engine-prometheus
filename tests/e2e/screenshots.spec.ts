import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '..', '..', 'screenshots');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page: any, name: string) {
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`✓ Saved: ${name}.png`);
}

test.describe('Screenshot Capture - All Screens', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app', { state: 'visible', timeout: 30000 });
    await wait(2000);
  });

  test('should capture all main screens', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes for all screenshots
    ensureDir(SCREENSHOTS_DIR);

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
    await wait(1500);
    await takeScreenshot(page, '02-ui-workspace');
    // Close UI Workspace using the close button (aria-label)
    await page.click('button[aria-label="Fechar Workspace de UI"]');
    await page.waitForSelector('text=Workspace de UI', { state: 'hidden', timeout: 5000 });
    await wait(1500);

    // =============================================
    // 3. PLAYER WORKSPACE - Main tab
    // =============================================
    console.log('\n📸 3. Player Workspace (main tab)');
    await page.click('button:has-text("Player")');
    await page.waitForSelector('text=Configurar jogador', { state: 'visible', timeout: 10000 });
    await wait(1500);
    await takeScreenshot(page, '03-player-workspace-main');

    // =============================================
    // 4. PLAYER WORKSPACE - Scripts e variáveis tab
    // =============================================
    console.log('\n📸 4. Player Workspace (Scripts e variáveis tab)');
    await page.click('button:has-text("Scripts e variáveis")');
    await page.waitForSelector('text=Variáveis do jogador', { state: 'visible', timeout: 5000 });
    await wait(1500);
    await takeScreenshot(page, '04-player-workspace-scripts');
    // Close Player Workspace using the close button (aria-label)
    await page.click('button[aria-label="Fechar Workspace do Player"]');
    await page.waitForSelector('text=Configurar jogador', { state: 'hidden', timeout: 5000 });
    await wait(1500);

    // =============================================
    // 5. VISUAL SCRIPT GRAPH
    // =============================================
    console.log('\n📸 5. Visual Script Graph');
    const graphButton = page.locator('button:has-text("Visual Script")').first();
    await expect(graphButton).toBeVisible({ timeout: 10000 });
    await graphButton.click();
    await page.waitForSelector('text=VISUAL SCRIPT', { state: 'visible', timeout: 10000 });
    await wait(1500);
    await takeScreenshot(page, '05-visual-script-graph');
    // Close Visual Script panel - use the close button INSIDE the panel (toolbar button click is blocked by overlay)
    await page.click('button:has-text("Voltar ao mundo")');
    await page.waitForSelector('text=Diagrama por objeto', { state: 'hidden', timeout: 15000 });
    await wait(1500);

    // =============================================
    // 6. MODEL IMPORT DIALOG
    // =============================================
    console.log('\n📸 6. Model Import Dialog');
    const importButton = page.locator('button:has-text("Modelo 3D")').first();
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();
    await page.waitForSelector('text=Configurar modelo 3D', { state: 'visible', timeout: 10000 });
    await wait(1500);
    await takeScreenshot(page, '06-model-import-dialog');
    // Close Model Import dialog (aria-label)
    await page.click('button[aria-label*="Fechar"]');
    await page.waitForSelector('text=Configurar modelo 3D', { state: 'hidden', timeout: 5000 });
    await wait(1500);

    // =============================================
    // 7. CONTROL MAPS DIALOG
    // =============================================
    console.log('\n📸 7. Control Maps Dialog');
    await page.click('button:has-text("Controles")');
    await page.waitForSelector('text=Mapas de Controle', { state: 'visible', timeout: 10000 });
    await wait(1500);
    await takeScreenshot(page, '07-control-maps-dialog');
    // Close Control Maps dialog (aria-label)
    await page.click('button[aria-label*="Fechar"]');
    await page.waitForSelector('text=Mapas de Controle', { state: 'hidden', timeout: 5000 });
    await wait(1500);

    // =============================================
    // 8. RUNTIME / PLAY MODE (with HUD)
    // =============================================
    console.log('\n📸 8. Runtime / Play Mode (with HUD)');
    const runButton = page.locator('button:has-text("Jogar")').first();
    await expect(runButton).toBeVisible({ timeout: 10000 });
    await runButton.click();
    await page.waitForSelector('.is-running', { state: 'visible', timeout: 15000 });
    await wait(3000);
    await takeScreenshot(page, '08-runtime-play-mode');

    // =============================================
    // 9. BACK TO EDIT MODE
    // =============================================
    console.log('\n📸 9. Back to Edit Mode');
    const editButton = page.locator('button:has-text("Editar")').first();
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();
    await page.waitForSelector('.app:not(.is-running)', { state: 'visible', timeout: 10000 });
    await wait(1500);
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
    await page.waitForSelector('text=DIAGNÓSTICO DA VIEWPORT', { state: 'visible', timeout: 5000 });
    await wait(1500);
    await takeScreenshot(page, '10-fullscreen-diagnostics');
    await page.click('button:has-text("Sair")');
    await wait(1500);

    // =============================================
    // 11. WORLD FULLSCREEN (if available)
    // =============================================
    console.log('\n📸 11. World Fullscreen (if available)');
    const fullscreenBtn = page.locator('button[aria-label*="tela cheia" i], button:has-text("Tela cheia")').first();
    if (await fullscreenBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fullscreenBtn.click();
      await page.waitForSelector('.world-fullscreen', { state: 'visible', timeout: 5000 });
      await wait(1500);
      await takeScreenshot(page, '11-world-fullscreen');
      await page.keyboard.press('Escape');
      await wait(1500);
    } else {
      console.log('  ⚠ World fullscreen button not found, skipping');
    }

    // =============================================
    // 12. FIRST PERSON MODE (if toggle available)
    // =============================================
    console.log('\n📸 12. First Person Mode (if available)');
    const fpBtn = page.locator('button:has-text("1ª Pessoa"), button[aria-label*="primeira pessoa" i]').first();
    if (await fpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fpBtn.click();
      await wait(1500);
      await takeScreenshot(page, '12-first-person-mode');
      await fpBtn.click();
      await wait(1500);
    } else {
      console.log('  ⚠ First person toggle not found, skipping');
    }

    // =============================================
    // 13. VIEWPORT LAYOUT CONFIG (if available)
    // =============================================
    console.log('\n📸 13. Viewport Layout Config (if available)');
    const layoutBtn = page.locator('button:has-text("Layout"), button[aria-label*="layout" i]').first();
    if (await layoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await layoutBtn.click();
      await page.waitForSelector('text=Layout do Viewport', { state: 'visible', timeout: 5000 });
      await wait(1500);
      await takeScreenshot(page, '13-viewport-layout-config');
      await page.keyboard.press('Escape');
      await wait(1500);
    } else {
      console.log('  ⚠ Viewport layout button not found, skipping');
    }

    // =============================================
    // 14. COLLAPSED SIDEBAR VIEW
    // =============================================
    console.log('\n📸 14. Collapsed Sidebar View (if available)');
    const collapseBtn = page.locator('button:has-text("Colapsar"), button[aria-label*="colapsar" i]').first();
    if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await collapseBtn.click();
      await page.waitForSelector('.sidebar-collapsed', { state: 'visible', timeout: 5000 });
      await wait(1500);
      await takeScreenshot(page, '14-collapsed-sidebar');
      await page.click('button:has-text("Abrir painel")');
      await wait(1500);
    } else {
      console.log('  ⚠ Collapse sidebar button not found, skipping');
    }

    // =============================================
    // 15. INSPECTOR PANEL (with object selected)
    // =============================================
    console.log('\n📸 15. Inspector Panel with object selected');
    // Try to select an object from hierarchy if any
    const firstObject = page.locator('.scene-hierarchy-item, [data-testid*="object"]').first();
    if (await firstObject.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstObject.click();
      await wait(1000);
      await takeScreenshot(page, '15-inspector-with-object');
    } else {
      console.log('  ⚠ No selectable object found in hierarchy, skipping');
    }

    console.log('\n✅ All screenshots captured!');
    console.log(`📁 Saved to: ${SCREENSHOTS_DIR}`);
  });
});