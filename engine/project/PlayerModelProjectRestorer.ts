import { decodeBase64ArrayBuffer } from '../lib/BinaryEncoding'
import { clamp } from '../lib/math'
import type { PlayerModelData } from './format'
import type { HumanoidAvatar } from '../world/HumanoidAvatar'
import { ProjectFormatError } from './validate'

/** Restores the optional project-specific player model, or resets it for legacy projects. */
export async function restorePlayerModelFromProject(
  projectModel: PlayerModelData | undefined,
  currentModel: PlayerModelData | null,
  avatar: HumanoidAvatar,
  report: (message: string, percent: number) => void,
): Promise<PlayerModelData | null> {
  if (projectModel?.glbData) {
    report('Restaurando modelo personalizado do jogador…', 91)
    try {
      const playerBytes = decodeBase64ArrayBuffer(projectModel.glbData)
      const playerHeight = clamp(projectModel.height ?? 1.8, 0.1, 10000)
      await avatar.setCustomModel(playerBytes, projectModel.animationRoles, playerHeight)
      return {
        name: projectModel.name,
        glbData: projectModel.glbData,
        height: playerHeight,
        ...(projectModel.sourceUrl ? { sourceUrl: projectModel.sourceUrl } : {}),
        ...(projectModel.animationRoles ? { animationRoles: { ...projectModel.animationRoles } } : {}),
      }
    } catch (error) {
      console.error('[Engine] Não foi possível restaurar o modelo personalizado do jogador:', error)
      throw new ProjectFormatError('Não foi possível carregar o modelo personalizado do jogador salvo neste projeto.')
    }
  }

  if (currentModel) {
    report('Restaurando modelo padrão do jogador…', 91)
    try {
      await avatar.resetDefaultModel()
      return null
    } catch (error) {
      console.error('[Engine] Não foi possível restaurar o avatar padrão:', error)
      throw new ProjectFormatError('Não foi possível restaurar o modelo padrão do jogador.')
    }
  }

  return currentModel
}
