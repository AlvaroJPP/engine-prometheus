/**
 * Persistência IndexedDB das imagens personalizadas do Player HUD.
 * Blob continua no armazenamento binário; apenas o metadado/URL fica no estado Vue.
 */
const DATABASE_NAME = 'engine-prometheus-hud-images'
const DATABASE_VERSION = 1
const IMAGE_STORE_NAME = 'images'

function openHudImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('O armazenamento de imagens não está disponível neste ambiente.'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        db.createObjectStore(IMAGE_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento de imagens.'))
  })
}

export async function storeHudImage(id: string, blob: Blob): Promise<void> {
  const db = await openHudImageDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE_NAME, 'readwrite')
      transaction.objectStore(IMAGE_STORE_NAME).put(blob, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar a imagem.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('O salvamento da imagem foi cancelado.'))
    })
  } finally {
    db.close()
  }
}

export async function readHudImage(id: string): Promise<Blob | null> {
  const db = await openHudImageDatabase()
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction(IMAGE_STORE_NAME, 'readonly').objectStore(IMAGE_STORE_NAME).get(id)
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null)
      request.onerror = () => reject(request.error ?? new Error('Não foi possível carregar a imagem.'))
    })
  } finally {
    db.close()
  }
}

export async function deleteHudImage(id: string): Promise<void> {
  const db = await openHudImageDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE_NAME, 'readwrite')
      transaction.objectStore(IMAGE_STORE_NAME).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível remover a imagem.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('A remoção da imagem foi cancelada.'))
    })
  } finally {
    db.close()
  }
}
