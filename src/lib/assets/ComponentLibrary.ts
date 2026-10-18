export type SavedComponentCollider = 'box' | 'sphere' | 'capsule' | 'mesh' | 'none'

export interface SavedComponent {
  /** Tipo semântico da instância colocada na cena. */
  kind?: 'object' | 'entity'
  /** Categoria da biblioteca de importados; itens-fonte nunca são inseridos diretamente no mundo. */
  libraryType?: 'object' | 'animated-model' | 'animation-source'
  /** Grafo visual reutilizável que acompanha o modelo ao inseri-lo no mundo. */
  logic?: import('@engine').LogicRule[]
  id: string
  name: string
  /** Categoria opcional da biblioteca; componentes legados são categorizados automaticamente. */
  group?: string
  height: number
  colliderType: SavedComponentCollider
  colliderSize: [number, number, number]
  colliderOffset: [number, number, number]
  /** Pacotes de comportamento que serão instalados automaticamente quando o componente for colocado no mundo. */
  behaviorPackageIds?: string[]
  /** Valores iniciais de variáveis e configuração de cada pacote escolhido na importação. */
  behaviorPackageSettings?: Record<string, {
    variables: Record<string, import('@engine').PackageScalar>
    config: Record<string, import('@engine').PackageJsonValue>
  }>
  /** Papéis atribuídos aos clipes no preview, indexados pelo índice da animação. */
  animationRoles?: Record<string, import('@engine').AnimationRole>
  /** Miniatura visual gerada pela prévia 3D do modelo importado. */
  thumbnail?: string
  /** Teclas personalizadas que acompanham o modelo no catálogo de componentes. */
  controlBindings?: Partial<import('@engine').ModelControlBindings>
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

export async function saveComponentAssets(components: SavedComponent[]): Promise<void> {
  if (components.length === 0) return
  const ids = new Set<string>()
  for (const component of components) {
    if (!component.id.trim()) throw new Error('Cada componente precisa ter um identificador antes de ser salvo.')
    if (ids.has(component.id)) throw new Error('O lote contém identificadores duplicados.')
    ids.add(component.id)
    if (!(component.bytes instanceof ArrayBuffer) || component.bytes.byteLength === 0) {
      throw new Error(`O arquivo 3D de "${component.name}" está vazio ou não é um GLB válido.`)
    }
  }

  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      let requestError: DOMException | null = null

      for (const component of components) {
        const request = store.put(component)
        request.onerror = () => {
          requestError = request.error
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(
        transaction.error ?? requestError ?? new Error('A gravação em lote da biblioteca falhou.'),
      )
      transaction.onabort = () => reject(
        transaction.error ?? requestError ?? new Error('O lote de componentes foi cancelado pelo armazenamento local.'),
      )
    })
  } finally {
    db.close()
  }
}

export async function saveComponentAsset(component: SavedComponent): Promise<void> {
  await saveComponentAssets([component])
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
