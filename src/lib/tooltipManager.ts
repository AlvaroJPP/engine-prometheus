type TooltipTarget = HTMLElement

const SELECTOR = '[data-tooltip], [title], [data-ep-tooltip]'
const TOOLTIP_ID = 'engine-prometheus-tooltip'
const SHOW_DELAY_MS = 420

let tooltip: HTMLDivElement | null = null
let activeTarget: TooltipTarget | null = null
let pendingTarget: TooltipTarget | null = null
let pendingTimer: number | null = null
let previousDescribedBy: string | null = null

function getTarget(node: EventTarget | null): TooltipTarget | null {
  if (!(node instanceof Element)) return null
  const match = node.closest(SELECTOR)
  if (!(match instanceof HTMLElement) || match === tooltip) return null
  if (match.dataset.tooltipDisabled === 'true') return null
  return match
}

function readTooltipText(target: TooltipTarget): string {
  // title continua sendo uma fonte válida, mas é removido no primeiro hover
  // para impedir que o tooltip nativo do navegador apareça junto do customizado.
  const nativeTitle = target.getAttribute('title')?.trim()
  if (nativeTitle) {
    target.dataset.epTooltip = nativeTitle
    target.removeAttribute('title')
  }
  return target.dataset.tooltip?.trim() || target.dataset.epTooltip?.trim() || ''
}

function ensureTooltip(): HTMLDivElement {
  if (tooltip?.isConnected) return tooltip
  const existing = document.getElementById(TOOLTIP_ID)
  if (existing instanceof HTMLDivElement) {
    tooltip = existing
    return existing
  }
  tooltip = document.createElement('div')
  tooltip.id = TOOLTIP_ID
  tooltip.className = 'ep-tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.hidden = true
  document.body.append(tooltip)
  return tooltip
}

function addShortcut(container: HTMLElement, shortcut: string): void {
  const keys = document.createElement('span')
  keys.className = 'ep-tooltip__keys'
  for (const rawKey of shortcut.split('+').map(part => part.trim()).filter(Boolean)) {
    const kbd = document.createElement('kbd')
    kbd.textContent = /^control$/i.test(rawKey) ? 'Ctrl' : rawKey
    keys.append(kbd)
  }
  container.append(keys)
}

function placeTooltip(target: TooltipTarget, tip: HTMLDivElement): void {
  const rect = target.getBoundingClientRect()
  const tipRect = tip.getBoundingClientRect()
  const margin = 8
  const arrowGap = 10
  const desiredLeft = rect.left + rect.width / 2 - tipRect.width / 2
  const left = Math.min(
    Math.max(margin, desiredLeft),
    Math.max(margin, window.innerWidth - tipRect.width - margin),
  )
  const canShowAbove = rect.top >= tipRect.height + arrowGap + margin
  const top = canShowAbove
    ? rect.top - tipRect.height - arrowGap
    : Math.min(
      window.innerHeight - tipRect.height - margin,
      rect.bottom + arrowGap,
    )

  tip.classList.toggle('ep-tooltip--top', canShowAbove)
  tip.classList.toggle('ep-tooltip--bottom', !canShowAbove)
  tip.style.left = `${Math.round(left)}px`
  tip.style.top = `${Math.max(margin, Math.round(top))}px`
  const targetCenter = rect.left + rect.width / 2
  const arrowX = Math.min(tipRect.width - 14, Math.max(14, targetCenter - left))
  tip.style.setProperty('--ep-tooltip-arrow-x', `${Math.round(arrowX)}px`)
}

function showTooltip(target: TooltipTarget): void {
  const label = readTooltipText(target)
  if (!label || !target.isConnected) return
  hideTooltip()

  const tip = ensureTooltip()
  const shortcutMatch = label.match(/\s+\(((?:Ctrl|Control|Shift|Alt|Meta)(?:\+[\w]+)+)\)$/i)
  const text = shortcutMatch ? label.slice(0, shortcutMatch.index).trim() : label
  const content = document.createElement('span')
  content.className = 'ep-tooltip__text'
  content.textContent = text
  tip.replaceChildren(content)
  if (shortcutMatch?.[1]) addShortcut(tip, shortcutMatch[1].replace(/^Control$/i, 'Ctrl'))

  tip.hidden = false
  tip.classList.remove('ep-tooltip--visible')
  tip.style.left = '-10000px'
  tip.style.top = '-10000px'
  tip.classList.add('ep-tooltip--measuring')
  placeTooltip(target, tip)
  tip.classList.remove('ep-tooltip--measuring')
  requestAnimationFrame(() => {
    if (activeTarget === target && tip.isConnected) tip.classList.add('ep-tooltip--visible')
  })

  activeTarget = target
  previousDescribedBy = target.getAttribute('aria-describedby')
  const describedBy = new Set((previousDescribedBy ?? '').split(' ').filter(Boolean))
  describedBy.add(TOOLTIP_ID)
  target.setAttribute('aria-describedby', [...describedBy].join(' '))
}

function cancelPending(): void {
  if (pendingTimer !== null) window.clearTimeout(pendingTimer)
  pendingTimer = null
  pendingTarget = null
}

function scheduleTooltip(target: TooltipTarget, immediate = false): void {
  if (activeTarget === target) return
  if (pendingTarget === target && !immediate) return
  cancelPending()
  pendingTarget = target
  const delay = immediate ? 0 : SHOW_DELAY_MS
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null
    if (pendingTarget !== target) return
    pendingTarget = null
    showTooltip(target)
  }, delay)
}

function hideTooltip(preservePending = false): void {
  if (!preservePending) cancelPending()
  if (activeTarget && activeTarget.isConnected) {
    if (previousDescribedBy) activeTarget.setAttribute('aria-describedby', previousDescribedBy)
    else activeTarget.removeAttribute('aria-describedby')
  }
  previousDescribedBy = null
  activeTarget = null
  if (tooltip) {
    tooltip.classList.remove('ep-tooltip--visible')
    tooltip.hidden = true
    tooltip.replaceChildren()
  }
}

export function installTooltipManager(): void {
  if (typeof document === 'undefined' || document.documentElement.dataset.epTooltipManager === 'installed') return
  document.documentElement.dataset.epTooltipManager = 'installed'

  document.addEventListener('pointerover', (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    const target = getTarget(event.target)
    if (target) scheduleTooltip(target)
  }, true)

  document.addEventListener('pointerout', (event: PointerEvent) => {
    const related = event.relatedTarget
    const fromActive = activeTarget && (
      event.target === activeTarget || activeTarget.contains(event.target as Node)
    )
    if (
      fromActive
      && !(related instanceof Node && activeTarget?.contains(related))
    ) {
      // Ao passar de um alvo com tooltip para outro, fecha o atual sem cancelar
      // o temporizador que já foi agendado para o novo alvo.
      hideTooltip(!!pendingTarget)
    }

    const fromPending = pendingTarget && (
      event.target === pendingTarget || pendingTarget.contains(event.target as Node)
    )
    if (
      fromPending
      && !(related instanceof Node && pendingTarget?.contains(related))
    ) {
      cancelPending()
    }
  }, true)

  document.addEventListener('focusin', (event: FocusEvent) => {
    const target = getTarget(event.target)
    if (target) scheduleTooltip(target, true)
  }, true)

  document.addEventListener('focusout', (event: FocusEvent) => {
    const target = activeTarget ?? pendingTarget
    const related = event.relatedTarget
    if (target && (!(related instanceof Node) || !target.contains(related))) hideTooltip()
  }, true)

  document.addEventListener('pointerdown', () => hideTooltip(), true)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTooltip()
  }, true)
  window.addEventListener('resize', () => hideTooltip(), { passive: true })
  window.addEventListener('scroll', () => hideTooltip(), { capture: true, passive: true })
}
