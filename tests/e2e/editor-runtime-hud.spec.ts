import { test, expect } from '@playwright/test'

test.describe('Editor → Runtime → HUD Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for the app to fully load
    await page.waitForSelector('.app', { state: 'visible', timeout: 30000 })
    await page.waitForTimeout(1000) // Allow Vue to fully initialize
  })

  test('should load editor with all main panels visible', async ({ page }) => {
    // Verify main UI elements are present
    await expect(page.locator('.app')).toBeVisible()
    // Title appears in two places (startup + topbar), use first()
    await expect(page.locator('text=ENGINE PROMETHEUS').first()).toBeVisible({ timeout: 10000 })

    // Check editor toolbar is present (by role or text)
    await expect(page.locator('button:has-text("Editar"), button:has-text("Jogar")').first()).toBeVisible({ timeout: 10000 })

    // Check scene hierarchy panel - look for "Hierarquia" tab
    await expect(page.locator('text=Hierarquia').first()).toBeVisible()

    // Check viewport - look for canvas element
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('should open UI Workspace', async ({ page }) => {
    // Click the UI Workspace button in top bar (text: "Workspace UI")
    await page.click('button:has-text("Workspace UI")')

    // Wait for UI Workspace modal to open - look for "Workspace de UI" header
    await expect(page.locator('text=Workspace de UI').first()).toBeVisible({ timeout: 10000 })

    // Verify we can see the screens section
    await expect(page.locator('text=TELAS').first()).toBeVisible({ timeout: 5000 })
  })

  test('should open Player Workspace and verify player logic variables', async ({ page }) => {
    // Click the Player Workspace button in top bar (text: "Player")
    await page.click('button:has-text("Player")')

    // Wait for Player Workspace modal to open - look for "Configurar jogador"
    await expect(page.locator('text=Configurar jogador').first()).toBeVisible({ timeout: 10000 })

    // Click on "Scripts e variáveis" tab button (click the button element, not just text)
    await page.click('button:has-text("Scripts e variáveis")')

    // Wait for the scripts tab content to load
    await page.waitForSelector('text=Variáveis do jogador', { state: 'visible', timeout: 5000 })

    // Verify player logic variables section - the heading inside the tab content
    await expect(page.locator('text=Variáveis do jogador').first()).toBeVisible({ timeout: 5000 })
  })

  test('should start runtime session and show HUD overlay', async ({ page }) => {
    // First ensure we're in edit mode
    await expect(page.locator('button:has-text("Editar")').first()).toBeVisible()

    // Click Run World button (text: "Jogar")
    const runButton = page.locator('button:has-text("Jogar")').first()
    await expect(runButton).toBeVisible({ timeout: 10000 })
    await runButton.click()

    // Wait for execution mode to change to running
    await page.waitForSelector('.is-running', { state: 'visible', timeout: 15000 })

    // Verify HUD overlay appears - look for canvas still visible and HUD elements
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 })

    // Verify HUD elements appear - the HUD shows "JOGADOR", "EM JOGO", "RUN", "CONTROLES"
    await expect(page.locator('text=JOGADOR').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=EM JOGO').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=RUN').first()).toBeVisible({ timeout: 5000 })
  })

  test('should return to edit mode from runtime', async ({ page }) => {
    // Start runtime first
    const runButton = page.locator('button:has-text("Jogar")').first()
    await runButton.click()
    await page.waitForSelector('.is-running', { state: 'visible', timeout: 15000 })

    // Click Edit World / Return to Edit button (text: "Editar")
    const editButton = page.locator('button:has-text("Editar")').first()
    await expect(editButton).toBeVisible({ timeout: 5000 })
    await editButton.click()

    // Verify we're back in edit mode
    await page.waitForSelector('.app:not(.is-running)', { state: 'visible', timeout: 10000 })

    // Verify editor toolbar is back
    await expect(page.locator('button:has-text("Jogar")').first()).toBeVisible()
  })
})

test.describe('Visual Script Graph', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app', { state: 'visible', timeout: 30000 })
    await page.waitForTimeout(1000)
  })

  test('should open visual script graph panel', async ({ page }) => {
    // Click the Visual Script button in the toolbar (text: "Visual Script")
    const graphButton = page.locator('button:has-text("Visual Script")').first()
    await expect(graphButton).toBeVisible({ timeout: 10000 })
    await graphButton.click()

    // Look for graph-specific elements - the header shows "VISUAL SCRIPT"
    await expect(page.locator('text=VISUAL SCRIPT').first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Model Import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.app', { state: 'visible', timeout: 30000 })
    await page.waitForTimeout(1000)
  })

  test('should open model import dialog', async ({ page }) => {
    // Click the Model Import button in the toolbar (text: "Modelo 3D")
    const importButton = page.locator('button:has-text("Modelo 3D")').first()
    await expect(importButton).toBeVisible({ timeout: 10000 })
    await importButton.click()

    // Wait for dialog to open - shows "Configurar modelo 3D"
    await expect(page.locator('text=Configurar modelo 3D').first()).toBeVisible({ timeout: 10000 })
  })
})