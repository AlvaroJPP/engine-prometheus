import * as THREE from 'three'
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js'
import type { SceneObjectData } from './project/format'
import { clamp } from './lib/math'
import { snap } from './lib/math'
import { AnimationController } from './world/AnimationController'
import { createAnimationActionMap } from './world/AnimationController'
import { getBehaviorPackageDefinition } from './script/packages'
import type { AnimationRole } from './script/packages'
import type { ModelControlBindings } from './script/packages'
import type { PackageJsonValue } from './script/packages'
import type { PackageScalar } from './script/packages'
import { markEntity } from './model/entity/Entity'

function isPackageJsonValue(value: unknown, depth = 0): value is PackageJsonValue {
  if (depth > 16) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => isPackageJsonValue(item, depth + 1))
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>)
    .every(item => isPackageJsonValue(item, depth + 1))
  return false
}

export interface EngineModelImportContext {
  [key: string]: any
}

export function createEngineModelImportMethods() {
  return {
    setBuildComponentPlacement(this: EngineModelImportContext, name: string, model: THREE.Object3D, height: number): void {
      model.userData.importPart = true
      this.pendingBuildComponent = { name, model, height }
    },
    placePendingBuildComponent(this: EngineModelImportContext, x: number, baseY: number, z: number): boolean {
      const pending = this.pendingBuildComponent
      if (!pending) return false
      try {
        const existingIds = new Set(this.world.list().map(object => object.id))
        const model = cloneSkinnedModel(pending.model)
        model.userData = { ...pending.model.userData, importPart: true }
        // Mantém o GLB como uma única instância editável na Hierarquia.
        this.addImportedModel(pending.name, model, pending.height)
        const created = this.world.list().find(object => !existingIds.has(object.id))
        if (!created) return false
        created.mesh.position.set(x, baseY + pending.height / 2, z)
        created.mesh.updateMatrixWorld(true)
        this.world.notifyChanged(created.id) 
        this.applyComponentLogic(created.id, pending.model.userData.componentLogic)
        // Instala no objeto recém-criado os pacotes escolhidos durante a importação.
        // Filtra IDs contra o catálogo do motor para não interromper a construção
        // se um componente salvo tiver metadados antigos ou inválidos.
        const rawPackageIds = pending.model.userData.importBehaviorPackageIds
        if (Array.isArray(rawPackageIds)) {
          const packageIds = new Set(rawPackageIds.filter((id): id is string =>
            typeof id === 'string' && !!getBehaviorPackageDefinition(id),
          ))
          const rawPackageSettings = pending.model.userData.importBehaviorPackageSettings
          const packageSettings = rawPackageSettings && typeof rawPackageSettings === 'object' && !Array.isArray(rawPackageSettings)
            ? rawPackageSettings as Record<string, { variables?: Record<string, unknown>; config?: Record<string, unknown> }>
            : {}
          for (const packageId of packageIds) {
            const installed = this.installBehaviorPackage(created.id, packageId)
            const definition = getBehaviorPackageDefinition(packageId)
            const savedSettings = packageSettings[packageId]
            if (!definition || !savedSettings) continue
    
            const variables: Record<string, PackageScalar> = {}
            for (const variable of definition.variables) {
              const value = savedSettings.variables?.[variable.name]
              if (variable.type === 'boolean' && typeof value === 'boolean') {
                variables[variable.name] = value
              } else if (variable.type === 'string' && typeof value === 'string') {
                variables[variable.name] = value.slice(0, 512)
              } else if (variable.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
                variables[variable.name] = Math.max(
                  variable.min ?? Number.NEGATIVE_INFINITY,
                  Math.min(variable.max ?? Number.POSITIVE_INFINITY, value),
                )
              }
            }
    
            const config: Record<string, PackageJsonValue> = {}
            for (const key of Object.keys(definition.defaultConfig)) {
              const value = savedSettings.config?.[key]
              if (isPackageJsonValue(value)) config[key] = value
            }
            if (Object.keys(variables).length || Object.keys(config).length) {
              this.updateBehaviorPackage(installed.id, { variables, config })
            }
          }
        }
        // Mantém a ferramenta Construir ativa para permitir colocar várias cópias
        // em sequência. O objeto recém-criado continua selecionado; o usuário pode
        // mudar para Selecionar quando quiser mover, girar ou redimensionar.
        this.world.select(created.id)
        this.transformControls.attach(created.mesh)
        this.emitTool()
        return true
      } catch (error) {
        console.error('[Engine] Não foi possível construir o componente:', error)
        // O clique foi consumido pela ferramenta de componente; não crie um cubo de fallback.
        return true
      }
    },
    addImportedModel(this: EngineModelImportContext, name: string, model: THREE.Object3D, targetHeight: number, restoreData?: SceneObjectData): void {
      // Evita congelamentos ao inserir assets acidentalmente gigantes no editor.
      // A contagem é feita antes da análise de agrupamento e antes de adicionar ao render loop.
      const MAX_IMPORTED_TRIANGLES = 5_000_000
      let preflightTriangles = 0
      let preflightMeshes = 0
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        preflightMeshes += 1
        const position = child.geometry.getAttribute('position')
        preflightTriangles += child.geometry.index
          ? child.geometry.index.count / 3
          : (position?.count ?? 0) / 3
      })
      if (preflightMeshes === 0 || preflightTriangles === 0) {
        throw new Error('O modelo não contém malhas trianguladas para inserir no mundo.')
      }
      if (preflightTriangles > MAX_IMPORTED_TRIANGLES) {
        throw new Error(`Este modelo contém ${Math.round(preflightTriangles).toLocaleString('pt-BR')} triângulos, acima do limite seguro de ${MAX_IMPORTED_TRIANGLES.toLocaleString('pt-BR')}. Reduza ou otimize o modelo antes de importá-lo.`)
      }
    
      // Alguns GLBs representam cada árvore como um grupo; outros exportam tronco,
      // copa e galhos como irmãos. Agrupamos irmãos pelo centro X/Z para separar
      // árvores sem transformar cada malha (tronco/folhas) em um objeto isolado.
      const importedAnimations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
      // Modelos animados e entidades precisam manter a hierarquia original: separar malhas
      // por proximidade espacial pode destacar partes do modelo da raiz que o gizmo move.
      // A divisão em componentes continua disponível para assets estáticos comuns, como árvores.
      if (model.userData.sceneKind !== 'entity' && model.userData.importPart !== true && importedAnimations.length === 0) {
        model.removeFromParent()
        model.updateMatrixWorld(true)
    
        type PartCluster = { center: THREE.Vector3; nodes: THREE.Object3D[]; span: number }
        const hasMesh = (node: THREE.Object3D): boolean => {
          let found = false
          node.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry.getAttribute('position')) found = true
          })
          return found
        }
        const boundsOf = (node: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(node)
        const clustersOf = (node: THREE.Object3D): PartCluster[] => {
          const candidates = node.children.filter(hasMesh)
          if (candidates.length < 2) return []
          const clusters: PartCluster[] = []
          for (const candidate of candidates) {
            const bounds = boundsOf(candidate)
            if (bounds.isEmpty()) continue
            const center = bounds.getCenter(new THREE.Vector3())
            const size = bounds.getSize(new THREE.Vector3())
            const span = Math.max(size.x, size.z, 0.001)
            // Componentes da mesma árvore tendem a compartilhar o centro X/Z.
            // A tolerância escala com o tamanho das próprias malhas.
            const existing = clusters.find((cluster) => {
              const distance = Math.hypot(center.x - cluster.center.x, center.z - cluster.center.z)
              const tolerance = Math.max(0.2, Math.min(span, cluster.span) * 0.28)
              return distance <= tolerance
            })
            if (existing) {
              existing.nodes.push(candidate)
              const count = existing.nodes.length
              existing.center.lerp(center, 1 / count)
              existing.span = Math.max(existing.span, span)
            } else {
              clusters.push({ center, nodes: [candidate], span })
            }
          }
          return clusters
        }
    
        let bestContainer: THREE.Object3D | null = null
        let bestClusters: PartCluster[] = []
        const findPartContainer = (node: THREE.Object3D): void => {
          const clusters = clustersOf(node)
          // Preferir o nível com mais exemplares separados, normalmente as três árvores.
          if (clusters.length >= 2 && clusters.length > bestClusters.length) {
            bestContainer = node
            bestClusters = clusters
          }
          for (const child of node.children) findPartContainer(child)
        }
        findPartContainer(model)
    
        if (bestContainer && bestClusters.length >= 2) {
          const animations = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
          console.info('[Engine] Componentes espaciais do GLB:', {
            name,
            clusters: bestClusters.map((cluster, index) => ({
              name: cluster.nodes.map((part) => part.name).filter(Boolean).join(' + ') || `Árvore ${index + 1}`,
              meshes: cluster.nodes.reduce((total, part) => {
                let count = 0
                part.traverse((child) => { if (child instanceof THREE.Mesh) count += 1 })
                return total + count
              }, 0),
              center: cluster.center.toArray(),
            })),
            animationClips: animations.map((clip) => clip.name),
          })
    
          bestClusters.forEach((cluster, index) => {
            const group = new THREE.Group()
            const label = cluster.nodes.map((part) => part.name.trim()).filter(Boolean)[0] || `Árvore ${index + 1}`
            group.name = label
            // Converta cada irmão para coordenadas do mundo antes de reagrupá-lo.
            // Isso mantém as transformações do GLB e os nomes usados pelas animações.
            for (const part of cluster.nodes) {
              part.updateWorldMatrix(true, false)
              const worldMatrix = part.matrixWorld.clone()
              part.removeFromParent()
              worldMatrix.decompose(part.position, part.quaternion, part.scale)
              part.updateMatrix()
              group.add(part)
            }
            const bounds = boundsOf(group)
            const center = bounds.getCenter(new THREE.Vector3())
            group.position.set(-center.x, -center.y, -center.z)
            group.userData.importOffset = [center.x, center.z]
            group.userData.importAnimations = animations
            group.userData.importPart = true
            this.addImportedModel(`${name} — ${label}`, group, targetHeight)
          })
          return
        }
      }
    
      // O modelo vem do preview, cuja cena não deve continuar sendo dona dele.
      // Removê-lo antes de calcular os limites evita misturar transformações de pais externos.
      model.removeFromParent()
      model.updateMatrixWorld(true)
      // A partição espacial e o BVH são preparados em segundo plano depois que
      // a raiz entra no mundo. Isso mantém a interface responsiva em malhas de 50k+
      // triângulos e usa o mesmo pipeline para os formatos de modelo aceitos pelo importador.
      const bounds = new THREE.Box3().setFromObject(model)
      if (bounds.isEmpty()) throw new Error('O modelo importado não possui geometria visível.')
    
      const originalSize = bounds.getSize(new THREE.Vector3())
      if (!Number.isFinite(originalSize.y) || originalSize.y <= 0) {
        throw new Error('Não foi possível calcular a altura do modelo importado.')
      }
    
      // Modelos de terceiros podem conter dezenas de malhas e sombras caras.
      // Desativa sombras por malha importada e prepara limites de geometria para
      // evitar trabalho desnecessário durante renderização e seleção.
      let meshCount = 0
      let triangleCount = 0
      let generatedNormalCount = 0
      let enhancedTextureCount = 0
      const preferredAnisotropy = Math.min(4, this.viewport.renderer.capabilities.getMaxAnisotropy())
      const importedMeshes: THREE.Mesh[] = []
      // Mantém materiais independentes entre modelos importados, mas evita criar
      // um clone de material por bloco da mesma geometria particionada.
      const clonedMaterials = new Map<THREE.Material, THREE.Material>()
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        importedMeshes.push(child)
        meshCount += 1
        // Não herdar estado de visibilidade de exporters/visualizadores externos.
        child.visible = true
        child.castShadow = false
        child.receiveShadow = false
        // Malhas GLB originais mantêm a proteção contra bounds incorretos do preview.
        // Só os blocos gerados habilitam frustum culling, pois seus bounds foram
        // recalculados sobre os vértices de cada região espacial.
        child.frustumCulled = child.userData.generatedOcclusionCluster === true
        const geometries = child.geometry
        const position = geometries.getAttribute('position')
        // Alguns OBJ/FBX/PLY exportados não incluem normais. Gere-as apenas quando
        // faltarem, preservando o sombreamento e a topologia dos modelos que já
        // possuem normais válidas no arquivo de origem.
        const normal = geometries.getAttribute('normal')
        if (position && position.count >= 3 && (!normal || normal.count !== position.count)) {
          geometries.computeVertexNormals()
          generatedNormalCount += 1
        }
        if (!geometries.boundingSphere) geometries.computeBoundingSphere()
        if (!geometries.boundingBox) geometries.computeBoundingBox()
        if (position) triangleCount += geometries.index
          ? geometries.index.count / 3
          : position.count / 3
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
        const materials: THREE.Material[] = sourceMaterials.map((material) => {
          // GLTFs válidos costumam definir material, mas meshes sem material podem
          // aparecer em arquivos exportados por ferramentas externas.
          if (!(material instanceof THREE.Material)) return new THREE.MeshStandardMaterial()
          let clone = clonedMaterials.get(material)
          if (!clone) {
            clone = material.clone()
            clonedMaterials.set(material, clone)
          }
          return clone
        })
        child.material = Array.isArray(child.material) ? materials : (materials[0] ?? child.material)
        for (const material of materials) {
          // Preserve os valores PBR da origem e trate mapas de cor como sRGB.
          // Mapas de normais, rugosidade, metalness e oclusão mantêm espaço linear.
          material.visible = true
          const texturedMaterial = material as THREE.Material & {
            colorWrite?: boolean
            [key: string]: unknown
          }
          if ('colorWrite' in texturedMaterial) texturedMaterial.colorWrite = true
          for (const [slot, value] of Object.entries(texturedMaterial)) {
            if (!(value instanceof THREE.Texture)) continue
            if ((slot === 'map' || slot === 'emissiveMap') && value.colorSpace !== THREE.SRGBColorSpace) {
              value.colorSpace = THREE.SRGBColorSpace
              value.needsUpdate = true
            }
            // Filtragem anisotrópica limitada a 4x deixa texturas oblíquas mais
            // nítidas sem escolher o custo máximo da GPU para todos os materiais.
            if (preferredAnisotropy > value.anisotropy) {
              value.anisotropy = preferredAnisotropy
              value.needsUpdate = true
              enhancedTextureCount += 1
            }
          }
          material.needsUpdate = true
        }
      })
      if (meshCount === 0 || triangleCount === 0) {
        throw new Error('O arquivo foi carregado, mas não contém malhas trianguladas para renderizar.')
      }
      // Evita manter uma hierarquia invisível herdada do preview.
      // A visibilidade de qualquer ancestral controla todos os descendentes.
      let ancestor: THREE.Object3D | null = model
      while (ancestor) {
        ancestor.visible = true
        ancestor = ancestor.parent
      }
      // A seleção usa uma caixa simples; o modelo real não precisa ser testado
      // face por face pelo raycaster a cada clique.
      model.userData.importStats = { meshCount, triangleCount }
      console.info('[Engine] Modelo importado preparado:', {
        name,
        meshCount,
        triangleCount,
        generatedNormalCount,
        enhancedTextureCount,
        textureAnisotropy: preferredAnisotropy,
        bounds: originalSize.toArray(),
        visibleMeshes: importedMeshes.filter((mesh) => mesh.visible).length,
      })
    
      const height = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : originalSize.y
      // Preserva o nó raiz original do glTF: os clips podem referenciar seu nome
      // e seus transforms. A centralização fica num pivô externo e estável.
      const scaleFactor = height / originalSize.y
      model.scale.multiplyScalar(scaleFactor)
      model.updateMatrixWorld(true)
      const scaledBounds = new THREE.Box3().setFromObject(model)
      const visualCenter = scaledBounds.getCenter(new THREE.Vector3())
      const finalSize = scaledBounds.getSize(new THREE.Vector3())
      const visualPivot = new THREE.Group()
      visualPivot.name = 'ImportedVisualPivot'
      visualPivot.position.copy(visualCenter).negate()
      visualPivot.add(model)
    
      // Os clipes são mapeados pela mesma regra central usada pelo avatar.
      // Só o controlador decide pesos, sincronização de ciclo e fim de ações pontuais.
      const animationClips = (model.userData.importAnimations as THREE.AnimationClip[] | undefined) ?? []
      const explicitRoles = model.userData.importAnimationRoles as Record<string, AnimationRole> | undefined
      let animationMixer: THREE.AnimationMixer | undefined
      let animationController: AnimationController | undefined
      let animationFallbackAction: THREE.AnimationAction | undefined
      let animationActions: Partial<Record<AnimationRole, THREE.AnimationAction>> = {}
      if (animationClips.length > 0) {
        animationMixer = new THREE.AnimationMixer(model)
        const actionMap = createAnimationActionMap(animationMixer, animationClips, explicitRoles, {
          genericFallback: !explicitRoles,
        })
        const startingRole = [
          'idle', 'walk', 'run',
          'walk_diagonal_left', 'walk_diagonal_right',
          'walk_left', 'walk_right',
          'walk_backward', 'run_backward',
          'walk_backward_diagonal_left', 'walk_backward_diagonal_right',
          'run_diagonal_left', 'run_diagonal_right',
          'run_left', 'run_right',
          'run_backward_diagonal_left', 'run_backward_diagonal_right',
          '__fallback__',
        ].find(role => actionMap.has(role))
        animationController = new AnimationController(animationMixer, actionMap, {
          genericFallback: actionMap.has('__fallback__'),
        })
        if (startingRole) animationController.setState(startingRole)
        animationActions = Object.fromEntries(actionMap) as Partial<Record<AnimationRole, THREE.AnimationAction>>
        animationFallbackAction = actionMap.get('__fallback__')
        console.info('[Engine] Animações do componente:', {
          name,
          initialClip: startingRole ? actionMap.get(startingRole)?.getClip().name : '(sem estado contínuo mapeado)',
          availableClips: animationClips.map((clip) => clip.name),
          mappedRoles: explicitRoles ?? 'automático por nome',
        })
      }
    
      // A caixa de seleção usa as dimensões do modelo e compartilha sua raiz editável.
      const proxyGeometry = new THREE.BoxGeometry(
        Math.max(finalSize.x, 0.05),
        Math.max(height, 0.05),
        Math.max(finalSize.z, 0.05),
      )
      const proxyMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
      })
      const root = new THREE.Mesh(proxyGeometry, proxyMaterial)
      root.name = name.trim() || 'Modelo importado'
      const x = clamp(snap(this.orbit.target.x, 0.5), -48, 48)
      const z = clamp(snap(this.orbit.target.z, 0.5), -48, 48)
      const importOffset = model.userData.importOffset as [number, number] | undefined
      root.position.set(
        restoreData?.position[0] ?? x + (importOffset?.[0] ?? 0) * scaleFactor,
        restoreData?.position[1] ?? this.world.terrain.heightAt(x, z) + height / 2,
        restoreData?.position[2] ?? z + (importOffset?.[1] ?? 0) * scaleFactor,
      )
      if (restoreData) {
        root.rotation.set(...restoreData.rotation)
        root.scale.set(...restoreData.scale)
        root.visible = restoreData.visible
      }
      if (animationMixer && animationController) {
        root.userData.importAnimationMixer = animationMixer
        root.userData.importAnimationActions = animationActions
        root.userData.importAnimationFallbackAction = animationFallbackAction
        root.userData.importAnimationController = animationController
        root.userData.importAnimationState = animationController.currentState
      }
      root.add(visualPivot)
      // Atualiza toda a hierarquia antes de entrar no loop de renderização.
      // Isso também garante bounds corretos para GLB com nós e transforms aninhados.
      root.updateMatrixWorld(true)
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.visible = true
          // Ativa o culling nativo para toda malha estática, não apenas para
          // regiões geradas pelo particionador. Malhas esqueléticas ficam fora
          // desse descarte para evitar popping causado pela deformação dos ossos.
          child.frustumCulled = !(child instanceof THREE.SkinnedMesh)
        }
      })
      root.frustumCulled = false
      root.updateMatrixWorld(true)
      const renderedBounds = new THREE.Box3().setFromObject(model)
      const renderedSize = renderedBounds.getSize(new THREE.Vector3())
      const hasAnimatedColliderGeometry = importedMeshes.some(mesh =>
        mesh instanceof THREE.SkinnedMesh || (mesh.geometry.morphAttributes.position?.length ?? 0) > 0,
      )
      // Migra cidades/cenários estáticos antigos que ainda tinham a caixa proxy
      // como colisor. A heurística corresponde ao padrão do importador 3D.
      const cityFootprint = Math.max(renderedSize.x, renderedSize.z)
      const cityAspectRatio = cityFootprint / Math.max(renderedSize.y, 0.1)
      const isStaticCityLike = importedAnimations.length === 0 &&
        !hasAnimatedColliderGeometry &&
        (
          (cityFootprint >= 18 && triangleCount >= 1_000) ||
          (meshCount >= 36 && cityFootprint >= 8) ||
          // A previously imported city may already have been normalized to a
          // small final height. Use its proportions as a migration signal too.
          (cityFootprint >= 8 && cityAspectRatio >= 3 && triangleCount >= 800)
        )
      console.info('[Engine] Modelo na cena:', {
        name: root.name,
        rootPosition: root.position.toArray(),
        modelPosition: model.position.toArray(),
        bounds: renderedBounds.isEmpty() ? 'empty' : {
          min: renderedBounds.min.toArray(),
          max: renderedBounds.max.toArray(),
        },
        meshesVisible: importedMeshes.filter(mesh => mesh.visible).length,
        meshCount: importedMeshes.length,
      })
    
      const id = `model_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`
      root.userData.id = id
      root.userData.locked = false
      root.userData.groupId = null
      root.userData.wireframeVisible = false
      root.userData.mass = 1
      // O colisor é configurado no importador e fica independente da malha visual.
      root.userData.colliderType = model.userData.importColliderType === 'box' || model.userData.importColliderType === 'sphere' || model.userData.importColliderType === 'capsule' || model.userData.importColliderType === 'mesh' || model.userData.importColliderType === 'none'
        ? model.userData.importColliderType
        : 'box'
      const importedColliderSize = model.userData.importColliderSize
      if (Array.isArray(importedColliderSize) && importedColliderSize.length === 3 && importedColliderSize.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
        root.userData.colliderSize = importedColliderSize.map((value: number) => clamp(value, 0.05, 100))
      }
      const importedColliderOffset = model.userData.importColliderOffset
      if (Array.isArray(importedColliderOffset) && importedColliderOffset.length === 3 && importedColliderOffset.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
        root.userData.colliderOffset = importedColliderOffset.map((value: number) => clamp(value, -100, 100))
      }
      root.userData.importedModel = true
      root.userData.importAnimationRoles = explicitRoles ? { ...explicitRoles } : undefined
      const importedControlBindings = model.userData.importControlBindings
        ?? restoreData?.importControlBindings
      root.userData.importControlBindings = importedControlBindings && typeof importedControlBindings === 'object'
        ? { ...importedControlBindings as Partial<ModelControlBindings> }
        : undefined
      const componentId = typeof model.userData.componentId === 'string' ? model.userData.componentId : null
      const componentLogic = Array.isArray(model.userData.componentLogic) ? model.userData.componentLogic : []
      if (model.userData.sceneKind === 'entity') {
        // A entidade usa a raiz editável do World; o GLB permanece como filho visual.
        // Entidades importadas compartilham o mesmo ID, gizmo, colisor e persistência.
        markEntity(root, { componentId, componentLogic })
      } else {
        root.userData.sceneKind = 'object'
        root.userData.componentId = componentId ?? undefined
        root.userData.componentLogic = componentLogic
      }
      root.userData.importedModelData = typeof model.userData.importedModelData === 'string' ? model.userData.importedModelData : restoreData?.importedModelData
      root.userData.importedModelHeight = height
      root.userData.sourceUrl = typeof model.userData.sourceUrl === 'string' ? model.userData.sourceUrl : restoreData?.sourceUrl
      if (restoreData) {
        root.userData.locked = restoreData.locked ?? false
        root.userData.groupId = restoreData.groupId ?? null
        root.userData.wireframeVisible = restoreData.wireframeVisible ?? false
        root.userData.mass = restoreData.mass ?? 1
        if (restoreData.colliderType) root.userData.colliderType = restoreData.colliderType
        if (restoreData.colliderSize) root.userData.colliderSize = [...restoreData.colliderSize]
        if (restoreData.colliderOffset) root.userData.colliderOffset = [...restoreData.colliderOffset]
      }
      // Projetos salvos antes de existir "Malha estática" guardavam cidades como
      // caixas sólidas. Corrige esses cenários ao abrir o mundo para que ruas,
      // rampas e vãos usem a geometria real sem exigir reimportação manual.
      if ((isStaticCityLike || model.userData.importColliderType === 'mesh') && root.userData.colliderType === 'box') {
        root.userData.colliderType = 'mesh'
        root.userData.colliderOffset = [0, 0, 0]
        console.info('[Engine] Colisor de cenário atualizado automaticamente para malha estática:', root.name)
      }
      const finalId = restoreData?.id ?? id
      root.userData.id = finalId
      this.world.add({ id: finalId, name: root.name, type: 'cube', mesh: root })
      // Particiona modelos densos e prepara BVH antes de gerar LOD. Assim o
      // simplificador trabalha nas regiões renderizáveis, não na malha já removida.
      void this.modelOcclusion.prepareRoot(root, importedAnimations.length > 0, this.world.scene)
        .then(() => this.modelLod.prepare(finalId, root, importedAnimations.length > 0))
        .then(() => this.viewport.invalidate())
        .catch((error) => {
          console.warn('[Engine] Não foi possível preparar otimizações do modelo:', root.name, error)
        })
      // Ao restaurar um projeto, o ID persistido é diferente do ID temporário.
      // Selecionar o temporário deixa a raiz sem seleção válida para o gizmo.
      this.world.select(finalId)
      this.state.tool = 'select'
      this.transformControls.setMode(this.state.transform === 'move' ? 'translate' : this.state.transform)
      this.transformControls.attach(root)
      this.emitTool()
    }
  }
}
