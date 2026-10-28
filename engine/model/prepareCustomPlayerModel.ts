import { encodeArrayBufferBase64 } from '../lib/BinaryEncoding'
import { clamp } from '../lib/math'
import type { PlayerModelData } from '../project/format'
import type { AnimationRole } from '../script/packages'
import type { HumanoidAvatar } from '../world/HumanoidAvatar'
import { MAX_PLAYER_MODEL_BYTES } from './playerModelLimits'

/** Validates a GLB player asset, applies it to the avatar and returns its persisted project data. */
export async function prepareCustomPlayerModel(
  avatar: HumanoidAvatar,
  data: ArrayBuffer,
  name: string,
  animationRoles?: Record<string, AnimationRole>,
  height = 1.8,
): Promise<PlayerModelData> {
  const cleanName = name.trim() || 'Jogador.glb'
  if (!cleanName.toLowerCase().endsWith('.glb')) {
    throw new Error('O modelo do jogador precisa estar no formato binário .glb.')
  }
  if (data.byteLength < 12) throw new Error('O arquivo GLB está vazio ou incompleto.')
  if (data.byteLength > MAX_PLAYER_MODEL_BYTES) {
    throw new Error('O modelo do jogador deve ter no máximo 30 MB.')
  }
  if (new DataView(data).getUint32(0, true) !== 0x46546c67) {
    throw new Error('O arquivo selecionado não tem o cabeçalho GLB esperado. Exporte o modelo como .glb.')
  }

  const targetHeight = clamp(Number.isFinite(height) ? height : 1.8, 0.1, 10000)
  await avatar.setCustomModel(data, animationRoles, targetHeight)
  return {
    name: cleanName,
    glbData: encodeArrayBufferBase64(data),
    height: targetHeight,
    ...(animationRoles ? { animationRoles: { ...animationRoles } } : {}),
  }
}
