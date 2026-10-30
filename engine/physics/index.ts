// Physics module exports for Engine Prometheus

export { PhysicsWorld, DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './PhysicsWorld'

export {
  RapierCharacterController,
  DEFAULT_CHARACTER_CONFIG,
  type CharacterControllerConfig,
  type CharacterInput,
  type CharacterState,
} from './RapierCharacterController'

export {
  RapierCollisionSystem,
  DEFAULT_PHYSICS_OBJECT_CONFIG,
  type PhysicsObjectConfig,
  type PhysicsObject,
  type CollisionEvent,
} from './RapierCollisionSystem'

export {
  NavMesh,
  NavMeshBuilder,
  DEFAULT_NAVMESH_CONFIG,
  type NavMeshConfig,
  type NavMeshNode,
  type NavMeshQueryResult,
} from './NavMesh'

export {
  PhysicsDebug,
  SimplePhysicsDebugDrawer,
  DEFAULT_DEBUG_CONFIG,
  type DebugConfig as PhysicsDebugConfig,
  type DebugContact,
  type DebugNavMeshPath,
} from './PhysicsDebug'