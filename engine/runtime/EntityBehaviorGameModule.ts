import type { EngineGameModule } from './GameModule.ts'
import { EntityBehaviorRuntime } from './EntityBehaviorRuntime.ts'

/** Adapts generic entity behavior lifecycle to the engine's Run/Stop module lifecycle. */
export function createEntityBehaviorGameModule<TComponents extends object, TContext>(
  id: string,
  behaviors: EntityBehaviorRuntime<TComponents, TContext>,
): EngineGameModule {
  const moduleId = id.trim()
  if (!moduleId) throw new Error('Entity behavior game modules require a non-empty identifier.')

  return {
    id: moduleId,
    onRuntimeStart: () => behaviors.start(),
    update: deltaSeconds => behaviors.update(deltaSeconds),
    onRuntimeStop: () => behaviors.stop(),
    onDispose: () => behaviors.dispose(),
  }
}
