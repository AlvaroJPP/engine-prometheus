# VEILBORNE — pacote de jogo

VEILBORNE é um jogo de fantasia sombria feito sobre o Engine Prometheus. As regras e o conteúdo do jogo permanecem em `packages/veilborne/`; o núcleo genérico (`engine/`) não importa nem inicializa este pacote automaticamente.

## Estrutura principal

- `runtime/VeilborneGameModule.ts`: ponto de integração com o contrato público `EngineGameModule`.
- `runtime/VeilborneCombatRuntime.ts`: atributos, recursos, ataques, feitiços, sigilos, aparo, bloqueio, dano, estados e progressão de combate.
- `runtime/VeilborneEnemyAISystem.ts`: perseguição, perfis de inimigos, ataques, reação a aparos e fases de chefes.
- `runtime/VeilborneInventorySystem.ts`, `VeilborneItemUseSystem.ts` e `VeilborneLootSystem.ts`: inventário serializado, consumíveis, drops e coleta.
- `runtime/VeilborneProgressionSystem.ts` e `VeilborneDeathRespawnSystem.ts`: santuários, ecos perdidos e renascimento.
- `runtime/VeilborneTargetLockController.ts`: travamento visual de alvo.
- `runtime/VeilborneVisualEffects.ts` e `VeilborneHealthBarSystem.ts`: efeitos visuais temporários e barras de vida.
- `ui/VeilborneHUD.vue` e `ui/VeilborneHUD.css`: interface própria do jogo, a ser montada pelo host de VEILBORNE.

## Como registrar o módulo

O host deve optar explicitamente por VEILBORNE. Com uma instância existente de `Engine`:

```ts
import { VeilborneGameModule } from './packages/veilborne/runtime'

const unregisterVeilborne = engine.registerGameModule(new VeilborneGameModule())
// Ao desmontar o host do jogo, chamar unregisterVeilborne().
```

O módulo aceita controles defensivos opcionais:

```ts
new VeilborneGameModule({
  controls: {
    block: 'KeyR',
    parry: 'KeyY',
    targetLock: 'KeyO',
  },
})
```

No mapa WASD padrão, os atalhos defensivos são R para bloquear (segurar), Y para aparar e O para travar o alvo. Para outros mapas, o módulo procura teclas livres quando o padrão conflita com um comando já atribuído. O host pode fixar os atalhos com a opção `controls`.

## Estado atual

O adaptador liga os serviços de combate, IA, efeitos, barras de vida, itens, drops, progressão, pontos de controle e renascimento ao ciclo de runtime. A definição de comportamento é registrada apenas quando o host registra o módulo; nada é ativado automaticamente pelo editor genérico.

**A integração ainda não está completa nem validada por build nesta sessão.** A HUD de VEILBORNE não é montada automaticamente, portanto o painel de inventário/arsenal ainda depende do host. A IA usa perseguição direta por distância e ainda não tem pathfinding nem teste de linha de visão. Também faltam hitboxes de animação para acerto preciso, persistência dedicada de personagem e conteúdo completo de missões/diálogos.

## Verificação local

Na cópia local, atualize a branch e execute:

```powershell
Set-Location C:\Projetos\engine-prometheus-1
git pull --ff-only origin main
npm run build
npm run game:modules:self-test
npm run veilborne:combat:self-test
npm run behavior:autonomous:self-test
npm run behavior:packages:self-test
```

O novo `veilborne:combat:self-test` verifica regras puras de dano, recursos, estados, aparo e registro opt-in do pacote. Esses comandos são instruções para executar localmente; não foram executados nesta alteração.

## Princípios arquiteturais

- O núcleo não registra nem importa automaticamente o jogo.
- Sistemas específicos e interfaces específicas de VEILBORNE permanecem dentro de `packages/veilborne/`.
- Sistemas genéricos — mundo, colisões, animação, controles básicos e Visual Script — são reutilizados pelas dependências do módulo.
- A integração de UI e runtime pertence ao host do jogo, não ao editor genérico.
