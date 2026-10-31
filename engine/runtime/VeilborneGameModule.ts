import type { EngineGameModule, GameModuleContext } from './GameModule.js';
import { MountController } from '../mount/MountController.js';
import { MountAnimationMapper, createDefaultAnimationMapping } from '../mount/MountAnimationMapper.js';
import { HumanoidAvatar } from '../world/HumanoidAvatar.js';
import { World } from '../world/World.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import * as THREE from 'three';
import { EngineEvents } from '../core/EngineEventBus.js';

/**
 * VeilborneGameModule - Game module for the Veilborne game
 *
 * This module composes the generic engine systems to create the Veilborne experience:
 * - Mount system for creature mounting
 * - Combat system for melee/ranged combat
 * - Behavior trees for AI
 * - Player controller with custom logic
 * - Animation system integration
 */
export class VeilborneGameModule implements EngineGameModule {
  readonly id = 'veilborne';

  private context: GameModuleContext | null = null;
  private mountController: MountController | null = null;
  private animationMapper: MountAnimationMapper | null = null;
  private isRuntimeActive = false;

  // Game-specific state
  private playerStats = {
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    mana: 50,
    maxMana: 50,
  };

  private playerInventory: Map<string, number> = new Map();
  private activeQuests: Set<string> = new Set();

  onAttach(context: GameModuleContext): void {
    this.context = context;
    this.log('Veilborne game module attached');
  }

  onRuntimeStart(context: GameModuleContext): void {
    this.context = context;
    this.isRuntimeActive = true;
    this.log('Veilborne runtime started');

    // Initialize player with Veilborne-specific settings
    this.initializePlayer();

    // Register Veilborne-specific script actions/conditions/triggers
    this.registerScriptExtensions();
  }

  onRuntimeStop(context: GameModuleContext): void {
    this.isRuntimeActive = false;
    this.log('Veilborne runtime stopped');

    // Clean up runtime state
    this.cleanupRuntime();
  }

  onKeyDown(event: KeyboardEvent, context: GameModuleContext): boolean | void {
    // Handle Veilborne-specific key bindings
    if (this.handleVeilborneKeyDown(event)) {
      return true; // Consumed
    }

    // Forward to mount controller if mounted
    if (this.mountController) {
      this.mountController.onKeyDown(event.code);
    }

    return false; // Not consumed
  }

  onKeyUp(event: KeyboardEvent, context: GameModuleContext): void {
    // Forward to mount controller if mounted
    if (this.mountController) {
      this.mountController.onKeyUp(event.code);
    }

    this.handleVeilborneKeyUp(event);
  }

  onInputBlur(context: GameModuleContext): void {
    // Clear input state on blur
    if (this.mountController) {
      this.mountController.onKeyUp('KeyW');
      this.mountController.onKeyUp('KeyS');
      this.mountController.onKeyUp('KeyA');
      this.mountController.onKeyUp('KeyD');
      this.mountController.onKeyUp('ShiftLeft');
    }
  }

  update(dt: number, context: GameModuleContext): void {
    if (!this.isRuntimeActive) return;

    this.context = context;

    // Update game systems
    this.updatePlayerStats(dt);
    this.updateMountSystem(dt);
    this.updateQuests(dt);
  }

  onDispose(context: GameModuleContext): void {
    this.log('Veilborne game module disposed');

    // Clean up resources
    if (this.mountController) {
      this.mountController.dispose();
      this.mountController = null;
    }
    if (this.animationMapper) {
      this.animationMapper.dispose();
      this.animationMapper = null;
    }

    this.context = null;
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  private initializePlayer(): void {
    if (!this.context) return;

    const avatar = this.context.avatar;

    // Configure avatar for Veilborne gameplay
    // Set player stats, abilities, etc.
    this.log('Player initialized for Veilborne');
  }

  private registerScriptExtensions(): void {
    // Register Veilborne-specific script actions, conditions, triggers
    // This would integrate with the visual script system
    this.log('Veilborne script extensions registered');
  }

  // =========================================================================
  // Update
  // =========================================================================

  private updatePlayerStats(dt: number): void {
    // Regenerate stamina/mana over time
    this.playerStats.stamina = Math.min(this.playerStats.maxStamina, this.playerStats.stamina + dt * 10);
    this.playerStats.mana = Math.min(this.playerStats.maxMana, this.playerStats.mana + dt * 5);
  }

  private updateMountSystem(dt: number): void {
    // Mount system updates are handled by MountSubsystem
    // This is just for game-specific mount logic
    if (this.mountController) {
      this.mountController.update(dt);
    }
  }

  private updateQuests(dt: number): void {
    // Update quest progress, check conditions
  }

  // =========================================================================
  // Input Handling
  // =========================================================================

  private handleVeilborneKeyDown(event: KeyboardEvent): boolean {
    // Handle Veilborne-specific keys
    switch (event.code) {
      case 'KeyI':
        // Toggle inventory
        this.toggleInventory();
        return true;
      case 'KeyJ':
        // Toggle journal/quests
        this.toggleJournal();
        return true;
      case 'KeyM':
        // Toggle map
        this.toggleMap();
        return true;
      case 'KeyC':
        // Toggle character sheet
        this.toggleCharacterSheet();
        return true;
    }
    return false;
  }

  private handleVeilborneKeyUp(event: KeyboardEvent): void {
    // Handle key release for Veilborne-specific keys
  }

  // =========================================================================
  // UI Actions
  // =========================================================================

  private toggleInventory(): void {
    this.log('Toggle inventory');
    // Emit event to UI
    this.emitUIEvent('veilborne:inventory:toggle');
  }

  private toggleJournal(): void {
    this.log('Toggle journal');
    this.emitUIEvent('veilborne:journal:toggle');
  }

  private toggleMap(): void {
    this.log('Toggle map');
    this.emitUIEvent('veilborne:map:toggle');
  }

  private toggleCharacterSheet(): void {
    this.log('Toggle character sheet');
    this.emitUIEvent('veilborne:character:toggle');
  }

  // =========================================================================
  // Game Logic
  // =========================================================================

  /**
   * Apply damage to player
   */
  applyDamage(amount: number, source?: string): void {
    this.playerStats.health = Math.max(0, this.playerStats.health - amount);
    this.log(`Player took ${amount} damage from ${source ?? 'unknown'}. Health: ${this.playerStats.health}`);

    if (this.playerStats.health <= 0) {
      this.onPlayerDeath();
    }

    this.emitUIEvent('veilborne:stats:update', { health: this.playerStats.health });
  }

  /**
   * Heal player
   */
  heal(amount: number): void {
    this.playerStats.health = Math.min(this.playerStats.maxHealth, this.playerStats.health + amount);
    this.log(`Player healed ${amount}. Health: ${this.playerStats.health}`);
    this.emitUIEvent('veilborne:stats:update', { health: this.playerStats.health });
  }

  /**
   * Use stamina
   */
  useStamina(amount: number): boolean {
    if (this.playerStats.stamina >= amount) {
      this.playerStats.stamina -= amount;
      this.emitUIEvent('veilborne:stats:update', { stamina: this.playerStats.stamina });
      return true;
    }
    return false;
  }

  /**
   * Use mana
   */
  useMana(amount: number): boolean {
    if (this.playerStats.mana >= amount) {
      this.playerStats.mana -= amount;
      this.emitUIEvent('veilborne:stats:update', { mana: this.playerStats.mana });
      return true;
    }
    return false;
  }

  private onPlayerDeath(): void {
    this.log('Player died!');
    this.emitUIEvent('veilborne:player:death');
    // Trigger respawn logic
  }

  /**
   * Add item to inventory
   */
  addItem(itemId: string, quantity = 1): void {
    const current = this.playerInventory.get(itemId) ?? 0;
    this.playerInventory.set(itemId, current + quantity);
    this.log(`Added ${quantity}x ${itemId} to inventory`);
    this.emitUIEvent('veilborne:inventory:update', { itemId, quantity: this.playerInventory.get(itemId) });
  }

  /**
   * Remove item from inventory
   */
  removeItem(itemId: string, quantity = 1): boolean {
    const current = this.playerInventory.get(itemId) ?? 0;
    if (current >= quantity) {
      this.playerInventory.set(itemId, current - quantity);
      this.emitUIEvent('veilborne:inventory:update', { itemId, quantity: this.playerInventory.get(itemId) });
      return true;
    }
    return false;
  }

  /**
   * Check if player has item
   */
  hasItem(itemId: string, quantity = 1): boolean {
    return (this.playerInventory.get(itemId) ?? 0) >= quantity;
  }

  /**
   * Start a quest
   */
  startQuest(questId: string): void {
    this.activeQuests.add(questId);
    this.log(`Started quest: ${questId}`);
    this.emitUIEvent('veilborne:quest:start', { questId });
  }

  /**
   * Complete a quest
   */
  completeQuest(questId: string): void {
    this.activeQuests.delete(questId);
    this.log(`Completed quest: ${questId}`);
    this.emitUIEvent('veilborne:quest:complete', { questId });
  }

  /**
   * Check if quest is active
   */
  isQuestActive(questId: string): boolean {
    return this.activeQuests.has(questId);
  }

  // =========================================================================
  // Mount System Integration
  // =========================================================================

  /**
   * Get mount controller
   */
  getMountController(): MountController | null {
    return this.mountController;
  }

  /**
   * Try to mount a creature
   */
  async tryMount(nearbyObjects: THREE.Mesh[]): Promise<{ success: boolean; error?: string }> {
    if (!this.mountController) {
      return { success: false, error: 'Mount controller not initialized' };
    }

    const result = await this.mountController.tryMount(nearbyObjects);
    if (result.success) {
      this.log(`Mounted: ${result.mountPointId}`);
      this.emitUIEvent('veilborne:mount:mounted', { mountPointId: result.mountPointId });
    } else {
      this.log(`Mount failed: ${result.error}`);
    }
    return { success: result.success, error: result.error };
  }

  /**
   * Mount on a specific object
   */
  async mount(targetObject: THREE.Mesh, mountPointId?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.mountController) {
      return { success: false, error: 'Mount controller not initialized' };
    }

    const result = await this.mountController.mount(targetObject, mountPointId);
    if (result.success) {
      this.log(`Mounted: ${result.mountPointId}`);
      this.emitUIEvent('veilborne:mount:mounted', { mountPointId: result.mountPointId });
    } else {
      this.log(`Mount failed: ${result.error}`);
    }
    return { success: result.success, error: result.error };
  }

  /**
   * Dismount from current mount
   */
  async dismount(): Promise<{ success: boolean; error?: string }> {
    if (!this.mountController) {
      return { success: false, error: 'Mount controller not initialized' };
    }

    const result = await this.mountController.dismount();
    if (result.success) {
      this.log('Dismounted successfully');
      this.emitUIEvent('veilborne:mount:dismounted', { dismountPosition: result.dismountPosition });
    } else {
      this.log(`Dismount failed: ${result.error}`);
    }
    return { success: result.success, error: result.error };
  }

  /**
   * Check if currently mounted
   */
  isMounted(): boolean {
    return this.mountController?.isMounted() ?? false;
  }

  // =========================================================================
  // Utility
  // =========================================================================

  private cleanupRuntime(): void {
    this.playerInventory.clear();
    this.activeQuests.clear();
    this.playerStats = {
      health: 100,
      maxHealth: 100,
      stamina: 100,
      maxStamina: 100,
      mana: 50,
      maxMana: 50,
    };
  }

  private emitUIEvent(eventName: string, data?: Record<string, unknown>): void {
    if (this.context) {
      // Use the context's invalidate or emit through engine events
      // The context doesn't have emitScriptEvent, so we'll log for now
      this.log(`UI Event: ${eventName}`, data);
    }
  }

  private log(message: string, data?: any): void {
    console.log(`[Veilborne] ${message}`, data ?? '');
  }

  // =========================================================================
  // Public API for external access
  // =========================================================================

  /**
   * Get current player stats
   */
  getPlayerStats(): Readonly<typeof this.playerStats> {
    return this.playerStats;
  }

  /**
   * Get current inventory
   */
  getInventory(): ReadonlyMap<string, number> {
    return this.playerInventory;
  }

  /**
   * Get active quests
   */
  getActiveQuests(): ReadonlySet<string> {
    return this.activeQuests;
  }

  /**
   * Check if runtime is active
   */
  getIsRuntimeActive(): boolean {
    return this.isRuntimeActive;
  }

  /**
   * Set mount controller (called by MountSubsystem when available)
   */
  setMountController(controller: MountController): void {
    this.mountController = controller;
  }

  /**
   * Set animation mapper
   */
  setAnimationMapper(mapper: MountAnimationMapper): void {
    this.animationMapper = mapper;
  }
}

/**
 * Create a Veilborne game module instance
 */
export function createVeilborneGameModule(): VeilborneGameModule {
  return new VeilborneGameModule();
}