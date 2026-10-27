import type { Component } from 'vue'

export interface GameOverlayRegistration {
  id: string
  packageId: string
  component: Component
}

const registrations = new Map<string, GameOverlayRegistration>()

/** Registra um overlay de jogo externo no ponto de composição da aplicação. */
export function registerGameOverlay(registration: GameOverlayRegistration): () => void {
  const id = registration.id.trim()
  const packageId = registration.packageId.trim()
  if (!id || !packageId) throw new Error('O overlay de jogo precisa de identificadores não vazios.')
  if (registrations.has(id)) throw new Error(`Já existe um overlay de jogo com o identificador "${id}".`)

  const entry = { ...registration, id, packageId }
  registrations.set(id, entry)
  let released = false
  return () => {
    if (released) return
    released = true
    if (registrations.get(id) === entry) registrations.delete(id)
  }
}

export function getGameOverlays(): readonly GameOverlayRegistration[] {
  return [...registrations.values()]
}
