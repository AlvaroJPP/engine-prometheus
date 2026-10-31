import type { IAgentBehavior } from './IAgentBehavior.ts';

class AgentBehaviorRegistry {
  private behaviors: Map<string, IAgentBehavior> = new Map();

  register(behavior: IAgentBehavior): void {
    this.behaviors.set(behavior.id, behavior);
  }

  unregister(id: string): void {
    this.behaviors.delete(id);
  }

  get(id: string): IAgentBehavior | undefined {
    return this.behaviors.get(id);
  }

  getAll(): IAgentBehavior[] {
    return Array.from(this.behaviors.values());
  }

  findByTag(tag: string): IAgentBehavior[] {
    return Array.from(this.behaviors.values()).filter(b => b.tags.includes(tag));
  }
}

export const agentBehaviorRegistry = new AgentBehaviorRegistry();
