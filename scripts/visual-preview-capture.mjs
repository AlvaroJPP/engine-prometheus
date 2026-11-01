import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const baseUrl = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173'
const outputDir = 'artifacts'
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
})

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const browserErrors = []
page.on('pageerror', error => browserErrors.push({ type: 'pageerror', message: error.message }))
page.on('console', message => {
  if (message.type() === 'error') browserErrors.push({ type: 'console', message: message.text() })
})

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(7000)

  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return { canvasFound: false }
    const rect = canvas.getBoundingClientRect()
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    return {
      canvasFound: true,
      cssRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      drawingBuffer: { width: canvas.width, height: canvas.height },
      webglAvailable: Boolean(gl),
      webglVersion: gl ? gl.getParameter(gl.VERSION) : null,
      shadingLanguageVersion: gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : null,
      engineWebglReady: canvas.dataset.engineWebglReady ?? null,
    }
  })

  await page.screenshot({ path: `${outputDir}/engine-prometheus-1920x1080.png` })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${outputDir}/engine-prometheus-1280x720.png` })
  writeFileSync(`${outputDir}/webgl-diagnostics.json`, JSON.stringify({ diagnostics, browserErrors }, null, 2) + '\\n')

  console.log('Visual preview captured.')
  console.log(JSON.stringify({ diagnostics, browserErrors }, null, 2))
} finally {
  await browser.close()
}
