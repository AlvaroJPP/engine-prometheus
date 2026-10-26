# VEILBORNE — pacote de jogo

VEILBORNE é um jogo de fantasia sombria construído para o Engine Prometheus. Todo o conteúdo e as regras específicas do jogo devem permanecer neste pacote; o diretório `engine/` deve continuar reutilizável por outros projetos.

## Organização

- `veilborne.json`: manifesto do pacote.
- `content.json`: dados de armas, feitiços, sigilos, arquétipos e perfis de inimigos.
- `runtime/VeilborneCombat.ts`: regras de combate e dados de jogo sem dependência direta da cena.
- `runtime/`: sistemas específicos de efeitos visuais, barras de vida, inventário, uso de itens, progressão, loot, morte/renascimento, travamento de alvo e sigilos.
- `runtime/behaviorPackageDefinition.ts`: definição do pacote de comportamento, registrada explicitamente pelo host.
- `ui/VeilborneHUD.vue` e `ui/VeilborneHUD.css`: HUD própria do jogo, separada do HUD genérico do editor.

## Estado da integração

O núcleo da engine disponibiliza o contrato genérico `EngineGameModule` e seu ciclo de vida. **O adaptador que conecta os sistemas de runtime do VEILBORNE a esse contrato ainda não foi implementado.** Portanto, os arquivos deste pacote são sistemas e regras separados, mas não devem ser considerados uma integração jogável completa neste momento.

A integração deverá ser feita por um módulo registrado pela aplicação hospedeira, sem importar classes ou regras de VEILBORNE dentro de `engine/`. O host também deverá optar explicitamente por registrar a definição do pacote de comportamento quando carregar o jogo.

## Próximas etapas

1. Implementar `VeilborneGameModule` dentro deste pacote usando o contrato público `EngineGameModule`.
2. Conectar os sistemas de runtime por meio de dependências explícitas e genéricas, sem acessar campos privados da engine.
3. Adicionar a seleção/carregamento do módulo no host e associar o pacote de comportamento apenas a projetos VEILBORNE.
4. Adaptar a HUD do jogo ao ciclo de runtime e garantir que seja desmontada ao retornar ao editor.
5. Executar os testes de módulo, a build TypeScript/Vite e testes manuais de combate, inventário, morte/renascimento e salvamento.

## Princípios de arquitetura

- Não adicionar controles, variáveis, recursos de HUD ou regras de combate exclusivos de VEILBORNE ao núcleo genérico.
- Não associar automaticamente inimigos, consumíveis ou outros modelos importados ao pacote VEILBORNE no catálogo genérico.
- Manter os sistemas do jogo em `packages/veilborne/` e expor ao host somente os pontos de integração necessários.
- Reutilizar os sistemas genéricos de mundo, objetos, colisões, animação, controles e Visual Script sempre que forem suficientes.
