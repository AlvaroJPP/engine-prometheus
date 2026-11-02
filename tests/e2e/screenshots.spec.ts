import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'screenshots')
fs.mkdirSync(directory, { recursive: true })

test('captures the fresh editor shell at desktop sizes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('editor-shell')).toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('engine-canvas')).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.screenshot({ path: path.join(directory, '01-new-editor-1280x720.png') })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.screenshot({ path: path.join(directory, '02-new-editor-1920x1080.png') })
})
