/// <reference types="vite/client" />

declare module '*.glb?url' {
  const url: string
  export default url
}

declare module '*.glb' {
  const url: string
  export default url
}

declare module '*.gltf?url' {
  const url: string
  export default url
}

declare module '*.gltf' {
  const url: string
  export default url
}

// three-mesh-bvh worker types (not exported from main module)
declare module 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js' {
  import { BufferGeometry } from 'three'
  import { MeshBVH, MeshBVHOptions } from 'three-mesh-bvh'

  export class GenerateMeshBVHWorker {
    running: boolean
    generate(geometry: BufferGeometry, options?: MeshBVHOptions): Promise<MeshBVH>
    terminate(): boolean
  }
}