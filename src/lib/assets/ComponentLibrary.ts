export type SavedComponentCollider = 'box' | 'sphere' | 'capsule' | 'none'

export interface SavedComponent {
  /** Grafo visual reutilizável que acompanha o modelo ao inseri-lo no mundo. */
  logic?: import('@engine').LogicRule[]
  id: string
  name: string
  height: number
  colliderType: SavedComponentCollider
  colliderSize: [number, number, number]
  colliderOffset: [number, number, number]
  bytes: ArrayBuffer
  createdAt: number
}

const DATABASE_NAME = 'engine-prometheus-component-library'
const DATABASE_VERSION = 1
const STORE_NAME = 'components'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('O armazenamento local de componentes não está disponível neste ambiente.'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir a biblioteca de componentes.'))
  })
}

export async function listSavedComponents(): Promise<Array<Omit<SavedComponent, 'bytes'>>> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve((request.result as SavedComponent[])
        .map(({ bytes: _bytes, ...metadata }) => metadata)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
      request.onerror = () => reject(request.error ?? new Error('Não foi possível listar os componentes.'))
    })
  } finally {
    db.close()
  }
}

export async function saveComponentAsset(component: SavedComponent): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(component)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Não foi possível salvar o componente.'))
    })
  } finally {
    db.close()
  }
}

export async function getSavedComponent(id: string): Promise<SavedComponent | null> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
      request.onsuccess = () => resolve((request.result as SavedComponent | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o componente.'))
    })
  } finally {
    db.close()
  }
}

export async function deleteSavedComponent(id: string): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Não foi possível excluir o componente.'))
    })
  } finally {
    db.close()
  }
}
