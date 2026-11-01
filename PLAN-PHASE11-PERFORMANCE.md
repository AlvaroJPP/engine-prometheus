# Phase 11 Performance Optimizations - Implementation Plan

## 🎯 Goal
Optimize the Prometheus Engine for production performance with grass occlusion culling enhancements, memory profiling utilities, Vite bundle chunking, and frame budget tracking with adaptive quality.

## 🧨 Now
The engine has solid foundations (grass occlusion, LOD systems, fixed timestep physics) but lacks:
- Depth-based occlusion queries for grass
- Memory profiling and automatic THREE.js resource cleanup
- Optimized Vite chunk configuration for code splitting
- Frame time budget tracking with automatic quality adaptation

## 🧠 Idea
Layer incremental performance improvements on existing systems: enhance grass culling with GPU occlusion queries, add comprehensive memory profiling with weak-ref caches, configure Vite manual chunks for optimal loading, and implement frame budget monitoring with dynamic quality scaling.

## 🛠️ Steps

### Phase 1: Grass Occlusion Culling Enhancements
- Add WebGL occlusion query support for grass instanced meshes
- Optimize `GRASS_REBUILD_COALESCE_MS` based on frame time budget
- Implement smooth LOD transitions between near/middle/far bands using distance hysteresis

### Phase 2: Memory Optimizations
- Extend `MemoryProfiler` with automatic THREE.js resource tracking
- Add `ResourcePool` automatic cleanup on subsystem dispose
- Implement `WeakRefCache` for geometry/material/texture caches
- Add heap snapshot and allocation tracking utilities

### Phase 3: Vite Chunk Optimization
- Configure `manualChunks` in vite.config for: three+addons, @dimforge/rapier3d-compat, vue runtime, engine core
- Enable CSS code splitting
- Add dynamic imports for heavy editor features (model import, animation preview)

### Phase 4: Frame Budget Improvements
- Add `FrameBudgetTracker` with rolling statistics
- Separate fixedUpdate (physics) from update (render) with clear phase boundaries
- Implement adaptive quality system that adjusts grass density, LOD distances, resolution scale based on frame time

### Phase 5: Verification
- Verify all THREE.js resources are properly disposed
- Test Vite build output chunk sizes
- Validate frame budget tracking with synthetic load
- Confirm grass occlusion query integration works

## 🚫 Not now
- GPU-driven rendering (mesh shaders)
- WebGPU compute-based culling
- Multi-threaded physics (Rapier workers)
- Streaming world loading