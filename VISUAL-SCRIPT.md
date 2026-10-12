# Visual Script — Engine Prometheus

O botão **⌘ Visual Script** abre o editor visual das regras. Cada regra aparece como um fluxo com três nós: evento, condição e ação.

## Como usar
1. Abra o painel **Motor de regras** no inspetor do editor.
2. Escolha o gatilho, a ação e se exige `has_key = true`.
3. Clique em **+ Adicionar regra ao objeto selecionado**.
4. Abra **⌘ Visual Script** na barra superior.
5. Arraste os nós para organizar o grafo.
6. Para criar uma conexão, clique na saída (círculo à direita) do nó de origem e depois na entrada (círculo à esquerda) do nó de destino. As conexões são armazenadas em `graphConnections`, junto com as posições `graphLayout` dentro de `logic/events.json`.
7. Selecione um nó para habilitar/desabilitar ou excluir a regra. Use **Restaurar conexões padrão** para voltar ao fluxo Evento → Condição → Ação.
8. Use **Salvar** para gravar o projeto.

## Limitação atual
As conexões podem ser editadas e persistidas visualmente, mas a execução do motor ainda usa a semântica de regra fixa: evento dispara, as condições são avaliadas e, se forem verdadeiras, as ações são executadas. As conexões customizadas ainda não alteram a ordem de execução do motor.
