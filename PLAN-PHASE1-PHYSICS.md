# Phase 1: Engine Prometheus Physics System Implementation Plan

## 🎯 Goal
Integrate @dimforge/rapier3d-compat as the authoritative physics engine for Engine Prometheus, providing a PhysicsWorld wrapper, kinematic character controller, dynamic rigid-body collision system, navmesh-based pathfinding, and debug visualization — all exported via engine/index.ts with self-test coverage.

## 🧨 Now
- @dimforge/rapier3d-compat@0.12.0 installed (package.json specifies ^0.14.0 — version mismatch)
- PhysicsWorld.ts and RapierCharacterController.ts already exist in engine/physics/
- RapierCollisionSystem.ts, NavMesh.ts, PhysicsDebug.ts do NOT exist
- engine/index.ts does NOT export physics modules
- No self-test scripts for physics modules exist
- Existing SAT-based CollisionSystem.ts and HumanoidAvatar.ts still used in Engine.ts

## 🧠 Idea
Complete the physics module by implementing the three missing files (RapierCollisionSystem, NavMesh, PhysicsDebug), wire exports through engine/index.ts, add self-tests for all five physics modules, and update package.json to resolve the version mismatch.

## 🛠️ Steps
- 1️⃣ **Phase 0: Documentation Discovery & Version Fix** → Audit Rapier 0.14.0 API for collision events, debug rendering, and navmesh alternatives; run `npm install` to fix version mismatch
- 2️⃣ **Phase 1: RapierCollisionSystem** → Create engine/physics/RapierCollisionSystem.ts managing dynamic rigid bodies, colliders, collision events, and query API
- 3️⃣ **Phase 2: NavMesh** → Create engine/physics/NavMesh.ts using three-mesh-bvh + custom A* on voxel/recast-style grid (Rapier 0.14 lacks built-in navmesh)
- 4️⃣ **Phase 3: PhysicsDebug** → Create engine/physics/PhysicsDebug.ts using Rapier's DebugRenderPipeline + Three.js LineSegments for collider wireframes, contacts, and navmesh
- 5️⃣ **Phase 4: Engine Integration** → Update engine/index.ts to export all five physics modules; extend GameModuleContext with physics accessors
- 6️⃣ **Phase 5: Self-Test Scripts** → Create 5 scripts in scripts/ following existing patterns: physics-world-self-test.mjs, character-controller-self-test.mjs, collision-system-self-test.mjs, navmesh-self-test.mjs, physics-debug-self-test.mjs
- 7️⃣ **Phase 6: Verification** → Run all self-tests; grep for anti-patterns (hardcoded Rapier internals, missing dispose); confirm engine/index.ts exports

## 🚫 Not now
- Full replacement of CollisionSystem/HumanoidAvatar (incremental migration in Phase 2+)
- Soft-body physics, fluid simulation, or vehicle systems
- Networked physics synchronization
- Physics-based animation blending (handled by AnimationController)
- Recast/Detour native navmesh (use three-mesh-bvh grid fallback for now)