# Plano de Migração do Editor

Este documento detalha o plano de migração dos componentes e lógica de interface do editor para a nova estrutura organizada em `editor/`.

## Objetivos
- Desacoplar a lógica do editor do restante da aplicação.
- Organizar componentes e funcionalidades por responsabilidade.
- Melhorar a manutenibilidade e escalabilidade da UI do editor.

## Estrutura de Destino
```
editor/
├── components/          # Vue components genéricos reutilizáveis
├── workspaces/          # UI Workspace, Player Workspace, etc.
├── hud/                 # HUD runtime, overlays
├── viewport/            # Viewport, camera controls, gizmos
├── tools/               # Inspectors, node editors, property grids
├── dialogs/             # Modals, import/export dialogs
├── composables/         # Vue composables do editor
├── themes/              # Sistema de temas e estilização
└── index.ts             # Barrel exports
```

## Mapa de Migração (Fase 1)

| Origem (`src/`) | Destino (`editor/`) | Prioridade |
|---|---|---|
| `components/EditorToolbar.vue` | `components/EditorToolbar.vue` | Alta |
| `components/EditorTopBar.vue` | `components/EditorTopBar.vue` | Alta |
| `components/EditorViewport.vue` | `viewport/EditorViewport.vue` | Alta |
| `components/SceneHierarchy.vue` | `components/SceneHierarchy.vue` | Alta |
| `composables/useEditor.ts` | `composables/useEditor.ts` | Alta |
| `composables/useBehaviorPackageEditor.ts` | `composables/useBehaviorPackageEditor.ts` | Alta |
| `composables/usePlayerLogicEditor.ts` | `composables/usePlayerLogicEditor.ts` | Alta |
| `lib/hud/HudImageStorage.ts` | `hud/HudImageStorage.ts` | Alta |

---
*Nota: A implementação desta migração ocorrerá em etapas futuras, respeitando a integridade do build.*
