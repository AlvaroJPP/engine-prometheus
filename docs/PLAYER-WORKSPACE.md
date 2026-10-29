# Player Workspace

O Player Workspace centraliza a configuração do personagem controlado durante a execução da cena. Abra-o pelo botão **Player** na barra superior do editor.

## Seções

- **Visão geral:** resumo do modelo, movimento, colisor, câmera e perfil de controles ativos.
- **Aparência:** importa ou troca o modelo pelo Importador 3D existente, restaura o personagem padrão e ajusta a altura final de modelos GLB personalizados.
- **Movimento:** velocidade de caminhada, multiplicador de corrida, impulso de salto e gravidade. Os perfis rápidos **Padrão**, **Ação** e **Pesado** são pontos de partida que podem ser personalizados.
- **Colisão:** raio base da cápsula física. O raio final acompanha proporcionalmente a altura do personagem.
- **Câmera:** alterna a visão em primeira pessoa e os enquadramentos externos disponíveis.
- **Controles:** mostra o mapa ativo e abre o editor de mapas já existente, incluindo captura de teclas e botões do mouse.
- **Scripts e variáveis:** cria variáveis isoladas do jogador (número, booleano e texto) e scripts JavaScript associados aos eventos Ao iniciar o jogo, Ao interagir e Ao pular. Cada script pode ser ligado/desligado, renomeado, editado ou removido.

## Persistência e limites

Os parâmetros de movimento e colisão são aplicados imediatamente ao avatar. Eles são gravados em `project.json` em `settings.player`, com valores limitados para evitar configurações inválidas. Projetos antigos sem esse campo recebem os valores padrão.

O modelo GLB personalizado e sua altura continuam armazenados na configuração de modelo do jogador da cena. A altura visual só pode ser alterada quando há um modelo GLB personalizado; o personagem padrão usa a altura de reserva de 1,8 unidade.

Os mapas de teclas são preferências locais do editor, preservando o comportamento do sistema de mapas de controle existente. A execução do jogo bloqueia a edição de parâmetros físicos; pare o jogo para alterar e salvar a configuração.

Os scripts e variáveis do jogador são salvos junto ao arquivo de lógica do projeto. As variáveis ficam em um escopo reservado próprio do jogador e não são lidas/escritas como variáveis globais por padrão. Para compartilhar estado global deliberadamente, use `api.global.get/set/add/toggle`.

Os eventos disponíveis são `started` (entrada no modo Jogar), `interact` (tecla ou botão de interação configurado), `jump` (início de um salto válido), `key_pressed` (pressionamento de tecla configurada) e `key_released` (soltura dessa tecla). Para os dois eventos de teclado, informe o valor de `KeyboardEvent.code` no campo Código da tecla, como `KeyE`, `Space` ou `Digit1`. Cada script é filtrado pela tecla configurada; pressionar `KeyE` não dispara um script configurado para `KeyQ`.

Dentro de um script:
- `api.get('health')` lê uma variável do jogador.
- `api.set('health', 100)` cria/atualiza uma variável do jogador.
- `api.add('score', 1)` soma a uma variável numérica existente.
- `api.toggle('doorOpen')` alterna uma variável booleana existente.
- `api.event.get('key')` lê o payload do evento, como a tecla ou posição do jogador.
- `api.global.set('round', 2)` altera explicitamente uma variável global.

Os scripts usam o executor JavaScript existente do projeto; execute apenas código confiável. Alterações de scripts/variáveis e parâmetros físicos devem ser feitas no modo Editar; durante Jogar as entradas ficam bloqueadas.

Os HUDs do Workspace de UI e os overlays de jogo podem ler as variáveis do jogador usando o namespace explícito `player.`: escreva `{{player.health}}` no texto de um elemento ou use `player.health` no nome da variável de uma barra de progresso. Os nomes sem esse prefixo continuam globais, então uma variável global `health` pode coexistir com `player.health`.

Os botões do HUD com ações Definir variável, Alternar variável booleana e Ajustar variável numérica também aceitam `player.health`, `player.stamina` etc. Essas ações escrevem no escopo do jogador, verificam se a variável existe e preservam seu tipo. Scripts executados pelo jogador notificam o editor para atualizar os bindings do HUD imediatamente.
