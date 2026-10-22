import type { RigAnimationKeyframe } from './RigAnimationClip.ts'

/**
 * Insere uma pose ordenada na linha do tempo ou substitui a pose existente
 * quando seus tempos diferem por menos de um milissegundo.
 */
export function upsertRigAnimationKeyframe(
  frames: readonly RigAnimationKeyframe[],
  frame: RigAnimationKeyframe,
): RigAnimationKeyframe[] {
  const existing = frames.findIndex(item => Math.abs(item.time - frame.time) < 0.001)
  if (existing >= 0) {
    return frames.map((item, index) => index === existing ? frame : item)
  }
  return [...frames, frame].sort((a, b) => a.time - b.time)
}

/**
 * Ordena os quadros e prepara a animação. Um clipe precisa de ao menos dois
 * tempos distintos; se a primeira pose ocorrer após zero, ela também vira a
 * pose inicial em 0 s sem alterar o quadro original.
 */
export function prepareRigAnimationFrames(
  frames: readonly RigAnimationKeyframe[],
): RigAnimationKeyframe[] | null {
  const ordered = [...frames].sort((a, b) => a.time - b.time)
  if (ordered.length < 2 || ordered[0]!.time === ordered[ordered.length - 1]!.time) return null
  return ordered[0]!.time > 0
    ? [{ ...ordered[0]!, time: 0 }, ...ordered]
    : ordered
}
