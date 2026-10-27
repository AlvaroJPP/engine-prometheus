# VEILBORNE — pacote de jogo

VEILBORNE é um jogo de fantasia sombria feito sobre o Engine Prometheus. As regras e o conteúdo do jogo permanecem em `packages/veilborne/`; o núcleo genérico (`engine/`) não importa nem inicializa este pacote automaticamente.

## Estrutura principal

- `runtime/VeilborneGameModule.ts`: integração do runtime com o contrato público `EngineGameModule`.
- `runtime/VeilborneCombatRuntime.ts`: atributos, recursos, ataques, feitiços, sigilos, aparo, bloqueio, dano, estados e progressão de combate.
- `runtime/VeilborneEnemyAISystem.ts`: perseguição, perfis de inimigos, ataques, reação a aparos e fases de chefes.
- `runtime/VeilborneInventorySystem.ts`, `VeilborneItemUseSystem.ts` e `VeilborneLootSystem.ts`: inventário serializado, consumíveis, drops e coleta.
- `runtime/VeilborneProgressionSystem.ts` e `VeilborneDeathRespawnSystem.ts`: santuários, ecos perdidos e renascimento.
- `runtime/VeilborneTargetLockController.ts`: travamento visual de alvo.
- `runtime/VeilborneControls.ts`: resolução pura e testável dos atalhos defensivos, sem colisões com o mapa ativo.
- `runtime/VeilborneVisualEffects.ts` e `VeilborneHealthBarSystem.ts`: efeitos visuais temporários e barras de vida.
- `ui/VeilborneGameHost.vue`: host de UI que registra o módulo opcional e monta a HUD do jogo.
- A HUD mostra as teclas efetivamente resolvidas para bloquear, aparar e travar alvo, inclusive quando o mapa ativo exige alternativas.
- `ui/VeilborneHUD.vue` e `ui/VeilborneHUD.css`: interface própria de VEILBORNE.

## Integração preferida: host de jogo

Em uma aplicação que já criou a instância de `Engine`, monte o host do pacote e passe os dados reativos que a própria aplicação mantém:

```vue
<script setup lang="ts">
import { VeilborneGameHost } from './packages/veilborne'

// São referências do aplicativo que hospeda o jogo.
const engine = /* instância de Engine já criada */
const activeBindings = /* mapa de controles ativo */
const globalVariables = /* Ref<Record<string, boolean | number | string>> */
const markDirty = /* função que marca o projeto/save como alterado */

function handleGameVariable(name: string, value: string | number | boolean) {
  globalVariables.value = { ...globalVariables.value, [name]: value }
  markDirty()
}
</script>

<template>
  <VeilborneGameHost
    :engine="engine"
    :bindings="activeBindings"
    :game-variables="globalVariables"
    @set-global-variable="handleGameVariable"
  />
</template>
```

Ao montar esse componente, ele registra uma instância de `VeilborneGameModule` e monta a HUD; ao desmontar, desfaz o registro. Não registre uma segunda instância de `VeilborneGameModule` com o mesmo identificador no mesmo Engine.

O host também aceita controles defensivos personalizados, quando necessário:

```vue
<VeilborneGameHost
  :engine="engine"
  :bindings="activeBindings"
  :game-variables="globalVariables"
  :controls="{ block: 'KeyR', parry: 'KeyY', targetLock: 'KeyO' }"
/>
```

No mapa WASD padrão, os atalhos defensivos são R para bloquear (segurar), Y para aparar e O para travar o alvo. Para outros mapas, o módulo procura teclas livres quando um padrão conflita com um comando atribuído. O host pode pedir atalhos com a opção `controls`; chaves ocupadas ou repetidas são substituídas por alternativas livres. A HUD mostra os três atalhos selecionados.

### Registro manual, sem o host de UI

Um host que gerencia a HUD por conta própria pode registrar somente o módulo:

```ts
import { VeilborneGameModule } from './packages/veilborne'

const unregisterVeilborne = engine.registerGameModule(new VeilborneGameModule())
// Chame unregisterVeilborne() ao desmontar o host.
```

Nesse caso, o host é responsável por montar a HUD e encaminhar seu evento `set-global-variable` ao Engine.

## Estado atual

O adaptador liga os serviços de combate, IA, efeitos, barras de vida, itens, drops, progressão, pontos de controle e renascimento ao ciclo de runtime. A definição de comportamento é registrada apenas quando o host registra o módulo; nada é ativado automaticamente pelo editor genérico.

**A build de produção e os autotestes automatizados de runtime passaram no GitHub Actions.** Ainda não fiz uma sessão manual do jogo; por isso, a aprovação da build não substitui testes de combate dentro da aplicação. A HUD está disponível pelo host opt-in, mas não é montada automaticamente pelo editor genérico. A IA usa perseguição direta por distância e ainda não tem pathfinding nem teste de linha de visão. Também faltam hitboxes de animação para acerto preciso, persistência dedicada de personagem e conteúdo completo de missões/diálogos.

## Verificação local

Na cópia local, atualize a branch e execute:

```powershell
Set-Location C:\Projetos\engine-prometheus-1
git pull --ff-only origin main
npm run build
npm run game:modules:self-test
npm run veilborne:combat:self-test
npm run veilborne:controls:self-test
npm run behavior:autonomous:self-test
npm run behavior:packages:self-test
```

Os testes `veilborne:combat:self-test` e `veilborne:controls:self-test` verificam regras puras de combate, recursos, estados, aparo, registro opt-in e resolução de atalhos defensivos. A build e os cinco autotestes do workflow passaram no GitHub Actions; os testes manuais do jogo continuam pendentes.

## Princípios arquiteturais

- O núcleo não registra nem importa automaticamente o jogo.
- Sistemas específicos e interfaces específicas de VEILBORNE permanecem dentro de `packages/veilborne/`.
- Sistemas genéricos — mundo, colisões, animação, controles básicos e Visual Script — são reutilizados pelas dependências do módulo.
- A integração de UI e runtime pertence ao host do jogo, não ao editor genérico.
