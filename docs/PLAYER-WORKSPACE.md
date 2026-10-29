# Player Workspace

O Player Workspace centraliza a configuração do personagem controlado durante a execução da cena. Abra-o pelo botão **Player** na barra superior do editor.

## Seções

- **Visão geral:** resumo do modelo, movimento, colisor, câmera e perfil de controles ativos.
- **Aparência:** importa ou troca o modelo pelo Importador 3D existente, restaura o personagem padrão e ajusta a altura final de modelos GLB personalizados.
- **Movimento:** velocidade de caminhada, multiplicador de corrida, impulso de salto e gravidade. Os perfis rápidos **Padrão**, **Ação** e **Pesado** são pontos de partida que podem ser personalizados.
- **Colisão:** raio base da cápsula física. O raio final acompanha proporcionalmente a altura do personagem.
- **Câmera:** alterna a visão em primeira pessoa e os enquadramentos externos disponíveis.
- **Controles:** mostra o mapa ativo e abre o editor de mapas já existente, incluindo captura de teclas e botões do mouse.

## Persistência e limites

Os parâmetros de movimento e colisão são aplicados imediatamente ao avatar. Eles são gravados em `project.json` em `settings.player`, com valores limitados para evitar configurações inválidas. Projetos antigos sem esse campo recebem os valores padrão.

O modelo GLB personalizado e sua altura continuam armazenados na configuração de modelo do jogador da cena. A altura visual só pode ser alterada quando há um modelo GLB personalizado; o personagem padrão usa a altura de reserva de 1,8 unidade.

Os mapas de teclas são preferências locais do editor, preservando o comportamento do sistema de mapas de controle existente. A execução do jogo bloqueia a edição de parâmetros físicos; pare o jogo para alterar e salvar a configuração.
