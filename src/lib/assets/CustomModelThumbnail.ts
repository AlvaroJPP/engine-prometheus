/** Validates and converts a user-selected image into a square WebP thumbnail. */
export async function createCustomModelThumbnail(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo PNG, JPG, WEBP ou SVG.')
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('A imagem precisa ter menos de 12 MB.')
  }

  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem.'))
    reader.onerror = () => reject(reader.error ?? new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(file)
  })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('O arquivo escolhido não é uma imagem válida.'))
    element.src = source
  })

  const size = 256
  const thumbnailCanvas = document.createElement('canvas')
  thumbnailCanvas.width = size
  thumbnailCanvas.height = size
  const context = thumbnailCanvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar a miniatura.')
  context.fillStyle = '#20232a'
  context.fillRect(0, 0, size, size)

  const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight)
  const width = Math.max(1, Math.round(image.naturalWidth * ratio))
  const height = Math.max(1, Math.round(image.naturalHeight * ratio))
  context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height)
  return thumbnailCanvas.toDataURL('image/webp', 0.84)
}
