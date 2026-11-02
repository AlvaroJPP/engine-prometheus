import { test, expect } from '@playwright/test'

test.describe('Nova base do editor Prometheus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('editor-shell')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('engine-canvas')).toBeVisible({ timeout: 30000 })
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-testid="engine-canvas"]')
      return Boolean(canvas && (canvas as HTMLCanvasElement).width > 0 && (canvas as HTMLCanvasElement).height > 0)
    }, { timeout: 30000 })
  })

  test('carrega a nova estrutura e viewport 3D', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Cena' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Inspetor' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Executar projeto' })).toBeVisible()
    await expect(page.getByTestId('engine-canvas')).toBeVisible()
  })

  test('adiciona e seleciona um cubo na hierarquia', async ({ page }) => {
    const before = await page.locator('.scene-object').count()
    await page.getByRole('button', { name: 'Adicionar cubo' }).first().click()
    await expect(page.locator('.scene-object')).toHaveCount(before + 1)
    await page.locator('.scene-object').last().click()
    await expect(page.locator('.selected-object-card')).toBeVisible()
  })

  test('alterna entre edição e execução', async ({ page }) => {
    await page.getByRole('button', { name: 'Executar projeto' }).click()
    await expect(page.locator('.editor-shell.is-running')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Parar execução' }).click()
    await expect(page.locator('.editor-shell.is-running')).toHaveCount(0)
  })

  test('mantém a interface utilizável em 1280×720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const measurements = await page.evaluate(() => {
      const shell = document.querySelector('.editor-shell')!.getBoundingClientRect()
      const viewport = document.querySelector('.viewport-stage')!.getBoundingClientRect()
      return { shellWidth: shell.width, shellHeight: shell.height, viewportWidth: viewport.width, viewportHeight: viewport.height }
    })
    expect(measurements.shellWidth).toBe(1280)
    expect(measurements.shellHeight).toBe(720)
    expect(measurements.viewportWidth).toBeGreaterThan(500)
    expect(measurements.viewportHeight).toBeGreaterThan(350)
  })
})
