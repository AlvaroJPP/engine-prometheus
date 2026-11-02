import { test, expect } from '@playwright/test'

test.describe('Editor Prometheus — nova disposição', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('editor-shell')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('engine-canvas')).toBeVisible({ timeout: 30000 })
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-testid="engine-canvas"]')
      return Boolean(canvas && (canvas as HTMLCanvasElement).width > 0 && (canvas as HTMLCanvasElement).height > 0)
    }, { timeout: 30000 })
  })

  test('carrega trilho lateral, hierarquia, viewport e inspetor', async ({ page }) => {
    await expect(page.locator('.side-rail')).toBeVisible()
    await expect(page.locator('.hierarchy-panel')).toBeVisible()
    await expect(page.locator('.viewport-panel')).toBeVisible()
    await expect(page.locator('.inspector-panel')).toBeVisible()
    await expect(page.locator('.inspector-tabs button').first()).toHaveText('Cena')
    await expect(page.getByRole('button', { name: 'Jogar' })).toBeVisible()
  })

  test('adiciona, seleciona e inspeciona um cubo', async ({ page }) => {
    const before = await page.locator('.tree-object').count()
    await page.getByRole('button', { name: 'Adicionar cubo' }).first().click()
    await expect(page.locator('.tree-object')).toHaveCount(before + 1)
    await page.locator('.tree-object').last().click()
    await expect(page.locator('.inspector-summary')).toBeVisible()
    await expect(page.locator('.vector-grid')).toBeVisible()
  })

  test('alterna entre modo de edição e modo de jogo', async ({ page }) => {
    const playButton = page.locator('.topbar-mode .play-mode')
    await expect(playButton).toHaveText(/Jogar/)
    await playButton.click()
    await expect(page.locator('.editor-shell.is-running')).toBeVisible({ timeout: 15000 })
    await expect(playButton).toHaveText(/Parar/)
    await playButton.click()
    await expect(page.locator('.editor-shell.is-running')).toHaveCount(0)
  })

  test('alterna as abas do inspetor para Jogador e Céu', async ({ page }) => {
    await page.locator('.inspector-tabs button').nth(1).click()
    await expect(page.getByText('Velocidade de caminhada')).toBeVisible()
    await page.locator('.inspector-tabs button').nth(2).click()
    await expect(page.getByText('Horário do mundo')).toBeVisible()
  })

  test('mantém o menu de ferramentas compacto e rolável', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const dock = page.getByTestId('viewport-tool-dock')
    await expect(dock).toBeVisible()
    await expect(dock.locator('.viewport-tool-button')).toHaveCount(16)
    const initial = await dock.evaluate(element => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }))
    expect(initial.height).toBeLessThanOrEqual(180)
    expect(initial.scrollHeight).toBeGreaterThan(initial.height)
    expect(initial.overflowY).toBe('auto')

    await dock.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(dock.getByRole('button', { name: 'Alternar modo de desempenho' })).toBeInViewport()
    await expect(dock.getByRole('button', { name: 'Criar exemplo clicável' })).toBeInViewport()
    await dock.getByRole('button', { name: 'Pintar grama' }).click()
    await expect(dock.getByRole('button', { name: 'Pintar grama' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('mantém a viewport utilizável em 1280×720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const measurements = await page.evaluate(() => {
      const shell = document.querySelector('.editor-shell')!.getBoundingClientRect()
      const viewport = document.querySelector('.viewport-stage')!.getBoundingClientRect()
      const canvas = document.querySelector('[data-testid="engine-canvas"]')!.getBoundingClientRect()
      return { shellWidth: shell.width, shellHeight: shell.height, viewportWidth: viewport.width, viewportHeight: viewport.height, canvasWidth: canvas.width, canvasHeight: canvas.height }
    })
    expect(measurements.shellWidth).toBe(1280)
    expect(measurements.shellHeight).toBe(720)
    expect(measurements.viewportWidth).toBeGreaterThan(450)
    expect(measurements.viewportHeight).toBeGreaterThan(300)
    expect(Math.abs(measurements.canvasWidth - measurements.viewportWidth)).toBeLessThan(1)
    expect(Math.abs(measurements.canvasHeight - measurements.viewportHeight)).toBeLessThan(1)
  })
})
