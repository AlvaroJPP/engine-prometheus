# VEILBORNE — pacote de jogo

VEILBORNE é um jogo de fantasia sombria feito sobre o Engine Prometheus. As regras e o conteúdo do jogo permanecem em `packages/veilborne/`; o núcleo genérico (`engine/`) não deve importar nem inicializar este pacote automaticamente.

## Estrutura principal

- `runtime/VeilborneGameModule.ts`: ponto de integração com o contrato público `EngineGameModule`.
- `runtime/VeilborneCombatRuntime.ts`: atributos, recursos, ataques, feitiços, sigilos, aparo, bloqueio, dano, estados e progressão de combate.
- `runtime/VeilborneEnemyAISystem.ts`: perseguição, perfis de inimigos, ataques e fases de chefes.
- `runtime/VeilborneInventorySystem.ts`, `VeilborneItemUseSystem.ts` e `VeilborneLootSystem.ts`: inventário serializado, consumíveis, drops e coleta.
- `runtime/VeilborneProgressionSystem.ts` e `VeilborneDeathRespawnSystem.ts`: santuários, ecos perdidos e renascimento.
- `runtime/VeilborneTargetLockController.ts`: travamento visual de alvo.
- `runtime/VeilborneVisualEffects.ts` e `VeilborneHealthBarSystem.ts`: efeitos visuais temporários e barras de vida.
- `ui/VeilborneHUD.vue` e `ui/VeilborneHUD.css`: interface própria do jogo; precisa ser montada pelo host de jogo.

## Como registrar o módulo

O host deve optar explicitamente por VEILBORNE. Com uma instância existente de `Engine`:

```ts
import { VeilborneGameModule } from './packages/veilborne/runtime'

const unregisterVeilborne = engine.registerGameModule(new VeilborneGameModule())
// Ao desmontar o host do jogo, chamar unregisterVeilborne().
```

O módulo também aceita controles defensivos próprios sem alterar os controles do núcleo:

```ts
new VeilborneGameModule({
  controls: {
    block: 'KeyR',
    parry: 'KeyY',
    targetLock: 'KeyO',
  },
})
```

Os controles adicionais padrão são bloquear com R, aparar com Y e travar alvo com O (M no perfil IJKL). As demais ações de combate usam o mapa genérico ativo.

## Estado atual

O adaptador liga os serviços de combate, IA, efeitos, barras de vida, itens, drops, progressão, pontos de controle e renascimento ao ciclo de runtime. O módulo continua opcional; nenhuma dessas regras deve voltar para `engine/Engine.ts`.

**A integração ainda não está completa nem validada por build nesta sessão.** A HUD de VEILBORNE ainda não é montada automaticamente, portanto o painel de inventário/arsenal e os controles que dependem diretamente dele ainda precisam ser ligados pelo host. A IA usa perseguição direta por distância e ainda não tem pathfinding nem teste de linha de visão. Também faltam animações de acerto com hitboxes, persistência dedicada de personagem e conteúdo completo de missões/diálogos.

## Verificação local

Após atualizar a branch principal:

```powershell
Set-Location C:\Projetos\engine-prometheus-1
git pull --ff-only origin main
npm run build
npm run game:modules:self-test
npm run behavior:autonomous:self-test
npm run behavior:packages:self-test
```

Esses comandos são instruções para executar localmente; não foram executados nesta alteração.

## Princípios arquiteturais

- O núcleo não registra nem importa automaticamente o jogo.
- Sistemas específicos e interfaces específicas de VEILBORNE permanecem dentro de `packages/veilborne/`.
- Sistemas genéricos — mundo, colisões, animação, controles básicos e Visual Script — são reutilizados pelas dependências do módulo.
- A integração de UI e runtime pertence ao host do jogo, não ao editor genérico.
