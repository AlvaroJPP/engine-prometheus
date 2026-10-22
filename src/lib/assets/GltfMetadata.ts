export type GltfMetadata = {
  images: Array<{ index: number; name: string; mimeType: string; uri: string; bufferView: number | null }>
  textures: Array<{ index: number; name: string; source: number | null }>
  materials: Array<{
    index: number
    name: string
    baseColorTexture: number | null
    normalTexture: number | null
    occlusionTexture: number | null
    emissiveTexture: number | null
    baseColorFactor: number[] | null
  }>
  animations: Array<{ index: number; name: string; channels: number }>
}

type GltfJsonMetadata = {
  images?: Array<{ name?: string; mimeType?: string; uri?: string; bufferView?: number }>
  textures?: Array<{ name?: string; source?: number }>
  materials?: Array<{
    name?: string
    pbrMetallicRoughness?: { baseColorTexture?: { index?: number }; baseColorFactor?: number[] }
    normalTexture?: { index?: number }
    occlusionTexture?: { index?: number }
    emissiveTexture?: { index?: number }
  }>
  animations?: Array<{ name?: string; channels?: unknown[] }>
}

/**
 * Normaliza os metadados do JSON glTF usados pelo painel técnico do importador.
 * O loader do Three fornece a cena pronta; este serviço mantém uma representação
 * leve do JSON original para diagnosticar texturas e canais sem reexportar o modelo.
 */
export function extractGltfMetadata(value: unknown): GltfMetadata {
  const json = (value && typeof value === 'object' ? value : {}) as GltfJsonMetadata
  return {
    images: (json.images ?? []).map((image, index) => ({
      index,
      name: image.name ?? '',
      mimeType: image.mimeType ?? '',
      uri: image.uri ?? '',
      bufferView: image.bufferView ?? null,
    })),
    textures: (json.textures ?? []).map((texture, index) => ({
      index,
      name: texture.name ?? '',
      source: texture.source ?? null,
    })),
    materials: (json.materials ?? []).map((material, index) => ({
      index,
      name: material.name ?? '',
      baseColorTexture: material.pbrMetallicRoughness?.baseColorTexture?.index ?? null,
      normalTexture: material.normalTexture?.index ?? null,
      occlusionTexture: material.occlusionTexture?.index ?? null,
      emissiveTexture: material.emissiveTexture?.index ?? null,
      baseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? null,
    })),
    animations: (json.animations ?? []).map((clip, index) => ({
      index,
      name: clip.name ?? '',
      channels: clip.channels?.length ?? 0,
    })),
  }
}
