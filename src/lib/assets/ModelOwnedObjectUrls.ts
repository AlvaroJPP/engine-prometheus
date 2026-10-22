import * as THREE from 'three'

/** Reúne URLs temporárias pertencentes ao modelo e aos recursos do pacote importado. */
export function collectModelOwnedObjectUrls(root: THREE.Object3D): string[] {
  const urls = new Set<string>()
  root.traverse(node => {
    const url = node.userData.importOwnedObjectUrl
    if (typeof url === 'string' && url.trim()) urls.add(url)

    const packageUrls = node.userData.importOwnedObjectUrls
    if (Array.isArray(packageUrls)) {
      for (const packageUrl of packageUrls) {
        if (typeof packageUrl === 'string' && packageUrl.trim()) urls.add(packageUrl)
      }
    }
  })
  return [...urls]
}

/**
 * Revoga uma coleção de URLs próprias uma única vez. O callback opcional permite
 * testar a política sem depender do ciclo de vida do navegador.
 */
export function revokeOwnedObjectUrls(
  urls: Iterable<unknown>,
  revoke: (url: string) => void = url => URL.revokeObjectURL(url),
): void {
  const uniqueUrls = new Set<string>()
  for (const url of urls) {
    if (typeof url === 'string' && url.trim()) uniqueUrls.add(url)
  }
  uniqueUrls.forEach(revoke)
}
