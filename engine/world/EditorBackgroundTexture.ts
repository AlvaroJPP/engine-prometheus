import * as THREE from 'three'

/**
 * Screen-space background used only by the editor viewport.
 * It mirrors the supplied HTML reference without DOM overlays or browser canvas APIs.
 */
export function createEditorBackgroundTexture(): THREE.DataTexture {
  const width = 2
  const height = 1024
  const stops = [
    { at: 0, color: [0x17, 0x1b, 0x2b] },
    { at: 0.4, color: [0x26, 0x2d, 0x43] },
    { at: 0.44, color: [0x3a, 0x42, 0x58] },
    { at: 0.441, color: [0x14, 0x15, 0x1a] },
    { at: 1, color: [0x10, 0x10, 0x13] },
  ] as const
  const data = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    // DataTexture row zero maps to the bottom of the screen.
    const position = 1 - y / (height - 1)
    let stopIndex = 0
    while (stopIndex < stops.length - 2 && position > stops[stopIndex + 1]!.at) {
      stopIndex += 1
    }
    const from = stops[stopIndex]!
    const to = stops[stopIndex + 1]!
    const span = to.at - from.at
    const amount = span > 0 ? Math.max(0, Math.min(1, (position - from.at) / span)) : 0

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      data[offset] = Math.round(from.color[0] + (to.color[0] - from.color[0]) * amount)
      data[offset + 1] = Math.round(from.color[1] + (to.color[1] - from.color[1]) * amount)
      data[offset + 2] = Math.round(from.color[2] + (to.color[2] - from.color[2]) * amount)
      data[offset + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.name = 'EditorReferenceBackground'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
