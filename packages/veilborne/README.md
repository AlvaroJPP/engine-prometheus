# VEILBORNE — pacote de jogo

VEILBORNE é um jogo de fantasia sombria feito sobre o Engine Prometheus. As regras e o conteúdo do jogo permanecem em `packages/veilborne/`; o núcleo genérico (`engine/`) não importa nem inicializa este pacote automaticamente.

## Estrutura principal

- `runtime/VeilborneGameModule.ts`: integração do runtime com o contrato público `EngineGameModule`.
- `runtime/VeilborneCombatRuntime.ts`: atributos, recursos, ataques, feitiços, sigilos, aparo, bloqueio, dano, estados e progressão de combate.
- `runtime/VeilborneEnemyAISystem.ts`: perseguição, perfis de inimigos, ataques, reação a aparos e fases de chefes.
- `runtime/VeilborneInventorySystem.ts` e `VeilborneLootSystem.ts`: adaptadores finos para o inventário genérico, coleta, drops e retorno ao editor.
- `runtime/VeilborneProgressionSystem.ts` e `VeilborneDeathRespawnSystem.ts`: adaptadores de estado em memória para interação, efeitos e teleporte; as regras de santuários, itens, morte, Ecos e renascimento são scripts globais do pacote.
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

O módulo liga os serviços que realmente precisam de estado de runtime — combate, IA, efeitos, barras de vida, entrada e animações — ao ciclo da engine. A definição declara scripts globais para usar itens, calcular recompensas e experiência, criar drops, registrar morte, gerar/restaurar cache de Ecos e calcular o renascimento. Esses scripts ficam salvos como regras editáveis do Visual Script, enquanto o núcleo só expõe APIs genéricas para eventos, inventário, combate, animação e objetos próximos. A definição de comportamento é registrada quando o host da aplicação detecta instâncias de `veilborne_rpg` no projeto. O editor genérico continua sem importar ou inicializar regras de VEILBORNE automaticamente; projetos sem esse pacote não montam o host.

O host da aplicação monta a HUD e registra o runtime quando abre um projeto que contém o pacote. O runtime também ajusta os itens importados para que repousem sobre a superfície abaixo deles. A IA usa perseguição direta por distância e ainda não tem pathfinding nem teste de linha de visão. Também faltam hitboxes de animação para acerto preciso, persistência dedicada de personagem e conteúdo completo de missões/diálogos.

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
