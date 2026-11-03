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


  test('recolhe o painel esquerdo para a barra lateral e expande a viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const hierarchy = page.locator('.hierarchy-panel')
    const viewport = page.locator('.viewport-panel')
    const before = await viewport.evaluate(element => element.getBoundingClientRect().width)

    const collapseButton = page.getByRole('button', { name: 'Recolher painel esquerdo' })
    await expect(collapseButton).toBeVisible()
    await collapseButton.click()

    await expect(hierarchy).toBeHidden()
    await expect(page.getByRole('button', { name: 'Expandir painel esquerdo' })).toBeVisible()
    const after = await viewport.evaluate(element => element.getBoundingClientRect().width)
    expect(after).toBeGreaterThan(before + 180)

    await page.getByRole('button', { name: 'Expandir painel esquerdo' }).click()
    await expect(hierarchy).toBeVisible()
    await expect(page.getByRole('button', { name: 'Recolher painel esquerdo' })).toBeVisible()
  })

  test('exibe a nova logo Prometeu em desktop e o símbolo em telas estreitas', async ({ page }) => {
    const logo = page.locator('.brand-logo-picture img')
    await expect(logo).toHaveAttribute('alt', 'Prometeu Engine')
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('.brand-logo-picture img')
      return Boolean(image?.complete && image.naturalWidth > 0 && image.currentSrc.endsWith('logo-prometeu-header.svg'))
    })
    expect(await logo.evaluate(image => image.naturalWidth)).toBeGreaterThan(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('.brand-logo-picture img')
      return Boolean(image?.complete && image.naturalWidth > 0 && image.currentSrc.endsWith('logo-prometeu-mark.svg'))
    })
  })


  test('cria pastas reais, subpastas e move objetos por arrastar e soltar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('button', { name: 'Criar pasta na raiz' }).click()
    const renameInput = page.getByRole('textbox', { name: 'Nome da pasta' })
    await expect(renameInput).toBeVisible()
    await renameInput.fill('Cenário')
    await renameInput.press('Enter')

    const sceneFolder = page.locator('.tree-folder-row').filter({ hasText: 'Cenário' })
    await expect(sceneFolder).toBeVisible()
    await sceneFolder.hover()
    await sceneFolder.getByRole('button', { name: 'Criar subpasta em Cenário' }).click()
    await expect(renameInput).toBeVisible()
    await renameInput.fill('Floresta')
    await renameInput.press('Enter')

    const forestFolder = page.locator('.tree-folder-row').filter({ hasText: 'Floresta' })
    await expect(forestFolder).toBeVisible()
    await page.getByRole('button', { name: 'Adicionar cubo' }).first().click()
    const objectRow = page.locator('.tree-object').first()
    await expect(objectRow).toBeVisible()
    await objectRow.dragTo(forestFolder)
    const folderId = await forestFolder.getAttribute('data-folder-id')
    await expect(objectRow).toHaveAttribute('data-folder-id', folderId!)
    await forestFolder.hover()
    await forestFolder.getByRole('button', { name: 'Renomear pasta Floresta' }).click()
    await expect(renameInput).toBeVisible()
    await renameInput.fill('Árvores')
    await renameInput.press('Enter')
    await expect(page.locator('.tree-folder-row').filter({ hasText: 'Árvores' })).toBeVisible()
  })

  test('adiciona, seleciona e inspeciona um cubo', async ({ page }) => {
    const before = await page.locator('.tree-object').count()
    await page.getByRole('button', { name: 'Adicionar cubo' }).first().click()
    await expect(page.locator('.tree-object')).toHaveCount(before + 1)
    await page.locator('.tree-object').last().click()
    await expect(page.locator('.inspector-summary')).toBeVisible()
    await expect(page.locator('.inspector-axis-grid')).toBeVisible()
  })

  test('expõe controles reais de objeto, jogador, ambiente e renderização', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('button', { name: 'Adicionar cubo' }).first().click()
    await page.locator('.tree-object').last().click()

    await expect(page.getByTestId('inspector-object-name')).toBeVisible()
    await expect(page.getByTestId('inspector-object-folder')).toBeVisible()
    await expect(page.getByTestId('inspector-object-color')).toBeVisible()
    await expect(page.getByTestId('inspector-texture-preset')).toBeVisible()
    await expect(page.getByTestId('inspector-collider-type')).toBeVisible()
    await expect(page.getByTestId('inspector-object-mass')).toBeVisible()

    const physicsGroup = page.locator('.inspector-group').filter({ hasText: 'Física e colisor' })
    await physicsGroup.locator('summary').click()
    await page.getByTestId('inspector-collider-type').selectOption('box')
    await expect(page.getByTestId('inspector-collider-type')).toHaveValue('box')

    await page.getByRole('tab', { name: 'Jogador' }).click()
    await expect(page.getByText('Velocidade de caminhada')).toBeVisible()
    await expect(page.getByText('Importar modelo GLB')).toBeVisible()

    await page.getByRole('tab', { name: 'Ambiente' }).click()
    await expect(page.getByText('Horário e ciclo dia/noite')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Névoa ativada' })).toBeVisible()

    await page.getByRole('tab', { name: 'Render' }).click()
    await expect(page.getByText('Resolução dinâmica')).toBeVisible()
    await page.getByRole('switch', { name: 'Resolução dinâmica' }).click()
    await expect(page.getByLabel('FPS desejado')).toBeVisible()
    await expect(page.getByLabel('Resolução mínima')).toBeVisible()
    await expect(page.getByText('Grama e vegetação')).toBeVisible()
    await expect(page.getByText('Oclusão da grama')).toBeVisible()
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

  test('mantém o inspetor direito rolável sem scrollbar visível', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('button', { name: 'Adicionar cubo' }).first().click()
    await page.locator('.tree-object').last().click()

    const inspector = page.locator('.inspector-panel .inspector-scroll')
    await expect(inspector).toBeVisible()
    await inspector.locator('details.inspector-group').evaluateAll(nodes => {
      nodes.forEach(node => { (node as HTMLDetailsElement).open = true })
    })

    const initial = await inspector.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollbarWidth: getComputedStyle(element).scrollbarWidth,
      webkitScrollbarDisplay: getComputedStyle(element, '::-webkit-scrollbar').display,
    }))
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight)
    expect(initial.overflowY).toBe('auto')
    expect(initial.scrollbarWidth).toBe('none')
    expect(initial.webkitScrollbarDisplay).toBe('none')

    const previousScroll = await inspector.evaluate(element => element.scrollTop)
    await inspector.evaluate(element => { element.scrollTop = element.scrollHeight })
    const nextScroll = await inspector.evaluate(element => element.scrollTop)
    expect(nextScroll).toBeGreaterThan(previousScroll)
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
      scrollbarWidth: getComputedStyle(element).scrollbarWidth,
      webkitScrollbarDisplay: getComputedStyle(element, '::-webkit-scrollbar').display,
    }))
    expect(initial.height).toBeLessThanOrEqual(180)
    expect(initial.scrollHeight).toBeGreaterThan(initial.height)
    expect(initial.overflowY).toBe('auto')
    expect(initial.scrollbarWidth).toBe('none')
    expect(initial.webkitScrollbarDisplay).toBe('none')

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
