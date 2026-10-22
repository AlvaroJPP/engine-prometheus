import * as THREE from 'three'
import type { AssetImportPackageContext, AssetPackageFile } from '@/lib/assets/AssetImporter'

/** Formato devolvido pelo comando nativo que extrai um ZIP de modelo. */
export type ZipModelBundle = {
  primary_path: string
  files: Array<{ path: string; base64: string }>
}

/** Contexto mantido durante a importação para revogar todas as URLs temporárias depois. */
export type ZipImportContext = AssetImportPackageContext & {
  objectUrls: string[]
}

export function encodeArrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

export function decodeBase64ArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/** Normaliza caminhos tanto para comparação quanto para resolver referências dentro do pacote. */
function normalizeZipPath(value: string): string {
  let decoded = value.replace(/\\/g, '/')
  try { decoded = decodeURIComponent(decoded) } catch { /* Mantém o caminho original se houver escapes inválidos. */ }
  const parts: string[] = []
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/').toLocaleLowerCase()
}

function zipDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index + 1) : ''
}

function zipMimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'gltf': case 'json': return 'model/gltf+json'
    case 'glb': return 'model/gltf-binary'
    case 'fbx': return 'application/octet-stream'
    case 'obj': return 'text/plain'
    case 'mtl': return 'text/plain'
    case 'dae': return 'model/vnd.collada+xml'
    case 'bin': return 'application/octet-stream'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}

/**
 * Transforma os arquivos do ZIP em arquivos virtuais de navegador e mapeia
 * referências relativas (texturas, MTL e buffers) para URLs Blob temporárias.
 * O chamador é responsável por revogar context.objectUrls quando terminar.
 */
export function createZipImportContext(bundle: ZipModelBundle): {
  primaryFile: File
  context: ZipImportContext
} {
  const files: AssetPackageFile[] = bundle.files.map(entry => {
    const bytes = decodeBase64ArrayBuffer(entry.base64)
    const fileName = entry.path.replace(/\\/g, '/').split('/').pop() || 'recurso.bin'
    return {
      path: entry.path.replace(/\\/g, '/'),
      file: new File([bytes], fileName, { type: zipMimeType(entry.path) }),
    }
  })

  const primaryKey = normalizeZipPath(bundle.primary_path)
  const primaryEntry = files.find(entry => normalizeZipPath(entry.path) === primaryKey)
  if (!primaryEntry) {
    throw new Error('O pacote ZIP não contém os dados do modelo principal indicado pelo importador.')
  }

  const urls: string[] = []
  const urlsByPath = new Map<string, string>()
  const urlsByBasename = new Map<string, string[]>()
  for (const entry of files) {
    const url = URL.createObjectURL(entry.file)
    urls.push(url)
    urlsByPath.set(normalizeZipPath(entry.path), url)
    const basename = normalizeZipPath(entry.path.split('/').pop() || entry.path)
    const matching = urlsByBasename.get(basename) ?? []
    matching.push(url)
    urlsByBasename.set(basename, matching)
  }

  const baseDirectory = zipDirectory(bundle.primary_path)
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((rawUrl: string) => {
    if (/^(data:|blob:|https?:|file:)/i.test(rawUrl)) return rawUrl
    const withoutQuery = rawUrl.split(/[?#]/, 1)[0] ?? rawUrl
    const candidates = [
      normalizeZipPath(withoutQuery),
      normalizeZipPath(baseDirectory + withoutQuery),
    ]
    for (const candidate of candidates) {
      const match = urlsByPath.get(candidate)
      if (match) return match
    }
    const basename = normalizeZipPath(withoutQuery.split(/[\\/]/).pop() || withoutQuery)
    const byName = urlsByBasename.get(basename)
    if (byName?.length === 1) return byName[0]!
    return rawUrl
  })

  return {
    primaryFile: primaryEntry.file,
    context: { primaryPath: bundle.primary_path, files, manager, objectUrls: urls },
  }
}
