/**
 * Dependency Injection Container
 *
 * Lightweight IoC container for managing service lifecycles and dependencies.
 * Supports singleton, transient, and scoped lifetimes.
 */

export type Lifetime = 'singleton' | 'transient' | 'scoped';

export interface ServiceRegistration<T = any> {
  token: ServiceToken<T>;
  factory: (container: DIContainer) => T;
  lifetime: Lifetime;
  instance?: T;
}

export type ServiceToken<T = any> = string | symbol | (new (...args: any[]) => T);

export interface ResolveOptions {
  /** Throw if service not found (default: true) */
  required?: boolean;

  /** Create new scope for scoped services */
  newScope?: boolean;
}

/**
 * DI Container implementation
 */
export class DIContainer {
  private registrations = new Map<ServiceToken, ServiceRegistration>();
  private singletons = new Map<ServiceToken, any>();
  private scopedInstances = new Map<ServiceToken, any>();
  private currentScope: Map<ServiceToken, any> | null = null;
  private parentContainer: DIContainer | null = null;

  constructor(parent?: DIContainer) {
    this.parentContainer = parent || null;
  }

  /**
   * Register a service with singleton lifetime
   */
  registerSingleton<T>(token: ServiceToken<T>, factory: (container: DIContainer) => T): this {
    this.registrations.set(token, { token, factory, lifetime: 'singleton' });
    return this;
  }

  /**
   * Register a service with transient lifetime (new instance each resolve)
   */
  registerTransient<T>(token: ServiceToken<T>, factory: (container: DIContainer) => T): this {
    this.registrations.set(token, { token, factory, lifetime: 'transient' });
    return this;
  }

  /**
   * Register a service with scoped lifetime (one instance per scope)
   */
  registerScoped<T>(token: ServiceToken<T>, factory: (container: DIContainer) => T): this {
    this.registrations.set(token, { token, factory, lifetime: 'scoped' });
    return this;
  }

  /**
   * Register an existing instance as singleton
   */
  registerInstance<T>(token: ServiceToken<T>, instance: T): this {
    this.registrations.set(token, {
      token,
      factory: () => instance,
      lifetime: 'singleton',
      instance
    });
    this.singletons.set(token, instance);
    return this;
  }

  /**
   * Register a constant value
   */
  registerValue<T>(token: ServiceToken<T>, value: T): this {
    return this.registerInstance(token, value);
  }

  /**
   * Check if a service is registered
   */
  isRegistered<T>(token: ServiceToken<T>): boolean {
    if (this.registrations.has(token)) return true;
    return this.parentContainer?.isRegistered(token) ?? false;
  }

  /**
   * Resolve a service
   */
  resolve<T>(token: ServiceToken<T>, options: ResolveOptions = {}): T | undefined {
    const { required = true, newScope = false } = options;

    // Handle scoped lifetime with new scope
    if (newScope) {
      const previousScope = this.currentScope;
      this.currentScope = new Map();
      try {
        return this.resolveInternal<T>(token, required);
      } finally {
        this.currentScope = previousScope;
      }
    }

    return this.resolveInternal<T>(token, required);
  }

  private resolveInternal<T>(token: ServiceToken<T>, required: boolean): T | undefined {
    // Check current scope first
    if (this.currentScope?.has(token)) {
      return this.currentScope.get(token);
    }

    // Check singletons
    if (this.singletons.has(token)) {
      return this.singletons.get(token);
    }

    // Check registrations
    const registration = this.registrations.get(token);
    if (registration) {
      const instance = registration.factory(this);

      switch (registration.lifetime) {
        case 'singleton':
          this.singletons.set(token, instance);
          break;
        case 'scoped':
          if (this.currentScope) {
            this.currentScope.set(token, instance);
          } else {
            // No active scope - create new instance each time (like transient)
            // Don't cache in singletons to avoid polluting parent container
          }
          break;
        case 'transient':
          // No caching
          break;
      }

      return instance;
    }

    // Check parent container
    if (this.parentContainer) {
      // If we have a currentScope, check if parent has a scoped registration
      // If so, we should create the instance ourselves and store in our scope
      if (this.currentScope) {
        const parentRegistration = this.parentContainer.getRegistration(token);
        if (parentRegistration && parentRegistration.lifetime === 'scoped') {
          // Create instance with this container as context and store in our scope
          const instance = parentRegistration.factory(this);
          this.currentScope.set(token, instance);
          return instance;
        }
      }
      // Otherwise delegate normally
      return this.parentContainer.resolve(token, { required: false });
    }

    if (required) {
      const tokenName = typeof token === 'symbol' ? String(token) :
                       typeof token === 'function' ? token.name : token;
      throw new Error(`Service not registered: ${tokenName}`);
    }

    return undefined;
  }

  /**
   * Resolve a service or throw
   */
  resolveRequired<T>(token: ServiceToken<T>): T {
    const result = this.resolve(token, { required: true });
    if (result === undefined) {
      throw new Error(`Required service not found: ${String(token)}`);
    }
    return result;
  }

  /**
   * Create a child container with inherited registrations
   */
  createChild(): DIContainer {
    return new DIContainer(this);
  }

  /**
   * Create a new scope for scoped services
   */
  createScope(): DIContainer {
    const scope = new DIContainer(this);
    scope.currentScope = new Map();
    return scope;
  }

  /**
   * Dispose all singletons that implement Disposable
   */
  async dispose(): Promise<void> {
    for (const [, instance] of this.singletons) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          await instance.dispose();
        } catch (error) {
          console.error(`Error disposing singleton:`, error);
        }
      }
    }
    this.singletons.clear();
    this.registrations.clear();
  }

  /**
   * Get a registration by token
   */
  getRegistration(token: ServiceToken): ServiceRegistration | undefined {
    return this.registrations.get(token);
  }

  /**
   * Get all registered tokens (for debugging)
   */
  getRegistrations(): ServiceToken[] {
    return Array.from(this.registrations.keys());
  }
}

/**
 * Metadata storage for decorators (without reflect-metadata dependency)
 * Uses a simple Map-based approach
 */
const metadataStore = new WeakMap<Object, Map<string, any>>();

function getMetadataStore(target: Object): Map<string, any> {
  let store = metadataStore.get(target);
  if (!store) {
    store = new Map();
    metadataStore.set(target, store);
  }
  return store;
}

/**
 * Decorator for injectable classes
 */
export function Injectable(token?: ServiceToken): ClassDecorator {
  return (target: Object) => {
    const store = getMetadataStore(target);
    store.set('di:token', token || target);
    store.set('di:injectable', true);
  };
}

/**
 * Decorator for injecting dependencies
 */
export function Inject(token: ServiceToken): ParameterDecorator {
  return (target: Object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const store = getMetadataStore(target);
    const existing = store.get('di:inject') || [];
    existing.push({ parameterIndex, token });
    store.set('di:inject', existing);
  };
}

/**
 * Helper to get metadata (internal use)
 */
function getMetadata(key: string, target: Object): any {
  return getMetadataStore(target).get(key);
}

/**
 * Helper to resolve constructor dependencies automatically
 */
export function resolveDependencies<T>(container: DIContainer, target: new (...args: any[]) => T): T {
  const injections = getMetadata('di:inject', target) || [];
  const args = injections.map(({ parameterIndex, token }: { parameterIndex: number; token: ServiceToken }) =>
    container.resolveRequired(token)
  );

  // Sort by parameter index
  args.sort((a: { parameterIndex: number }, b: { parameterIndex: number }) => a.parameterIndex - b.parameterIndex);

  return new target(...args.map((a: any) => a));
}