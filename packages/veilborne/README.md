# VEILBORNE — pacote de jogo

VEILBORNE é um jogo de fantasia sombria construído para o Engine Prometheus. Todo o conteúdo e as regras específicas do jogo devem permanecer neste pacote; o diretório `engine/` deve continuar reutilizável por outros projetos.

## Organização

- `veilborne.json`: manifesto do pacote.
- `content.json`: dados de armas, feitiços, sigilos, arquétipos e perfis de inimigos.
- `runtime/VeilborneCombat.ts`: regras de combate e dados de jogo.
- `runtime/`: sistemas específicos de efeitos visuais, barras de vida, inventário, uso de itens, progressão, loot, morte/renascimento, travamento de alvo e sigilos.
- `runtime/behaviorPackageDefinition.ts`: definição do pacote de comportamento, registrada explicitamente pelo módulo do jogo.
- `runtime/VeilborneGameModule.ts`: adaptador inicial para o contrato público `EngineGameModule`.
- `ui/VeilborneHUD.vue` e `ui/VeilborneHUD.css`: HUD própria do jogo, separada do HUD genérico do editor.

## Estado da integração

O adaptador `VeilborneGameModule` já existe e pode ser registrado pelo host usando a opção `gameModules` de `Engine` ou o método `registerGameModule`. Esta primeira etapa registra a definição do pacote, inicializa variáveis globais ausentes e conecta a atualização de efeitos visuais e barras de vida ao ciclo de runtime.

**A integração ainda é parcial.** Combate, ataques, feitiços, sigilos, inventário, progressão, loot e morte/renascimento ainda precisam ser ligados ao adaptador. A HUD do VEILBORNE também não é montada automaticamente pelo editor. Não considerar o jogo funcional até que esses sistemas sejam migrados e testados.

## Próximas etapas

1. Migrar o controle de combate para `VeilborneGameModule` usando o contexto genérico e os sistemas que já existem neste pacote.
2. Conectar inventário, uso de itens, progressão, loot e morte/renascimento.
3. Conectar os eventos de teclado e controles de ação sem recolocar ações específicas de combate no núcleo genérico.
4. Criar a integração de HUD no host do jogo, com montagem/desmontagem junto do ciclo de runtime.
5. Adicionar testes do adaptador e executar build TypeScript/Vite e testes manuais de combate, inventário, salvamento e retorno ao editor.

## Princípios de arquitetura

- Não adicionar controles, variáveis, recursos de HUD ou regras de combate exclusivos de VEILBORNE ao núcleo genérico.
- Não associar automaticamente inimigos, consumíveis ou outros modelos importados ao pacote VEILBORNE no catálogo genérico.
- Manter os sistemas do jogo em `packages/veilborne/` e expor ao host somente os pontos de integração necessários.
- Reutilizar os sistemas genéricos de mundo, objetos, colisões, animação, controles e Visual Script sempre que forem suficientes.
