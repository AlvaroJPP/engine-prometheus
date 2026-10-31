import { World } from '../world/World.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';

export type BehaviorStatus = 'running' | 'success' | 'failure' | 'paused';

export interface AgentContext {
  entityId: string;
  world: World;
  physics: PhysicsWorld;
  blackboard: Map<string, unknown>;
  getComponent<T>(type: any): T | null;
}

export interface BehaviorConfig {
  [key: string]: unknown;
}

export interface BehaviorConfigSchema {
  properties: Record<string, { type: string; description: string; default?: unknown }>;
  required: string[];
}

export interface IAgentBehavior {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: string[];

  // Lifecycle
  initialize(agent: AgentContext): Promise<void>;
  update(agent: AgentContext, deltaTime: number): BehaviorStatus;
  terminate(agent: AgentContext): Promise<void>;

  // Configuration
  getConfigSchema(): BehaviorConfigSchema;
  validateConfig(config: unknown): config is BehaviorConfig;
}
