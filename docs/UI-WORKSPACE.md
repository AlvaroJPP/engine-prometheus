# Workspace de UI

O Workspace de UI é um editor visual genérico para criar menus, telas de pausa, diálogos e HUDs sem escrever HTML ou Vue.

## Abrir o editor

Na barra superior do Engine Prometheus, use **Workspace UI**. Crie uma tela e adicione os elementos pelo menu do topo. Arraste os elementos na prévia para posicioná-los ou selecione-os pela hierarquia para editar as propriedades.

## Elementos disponíveis

- **Texto:** rótulo, título ou informação visual.
- **Botão:** pode ficar sem ação, navegar para outra tela ou definir uma variável global durante o jogo.
- **Painel:** superfície visual para agrupar ou destacar conteúdo.
- **Imagem:** importa PNG, JPG ou WebP de até 5 MB.
- **Barra:** acompanha uma variável global numérica, como `vida` ou `mana`.

Cada tela usa a proporção 16:9 e coordenadas relativas, para que posições e tamanhos se adaptem a diferentes tamanhos de janela.

## Executar a UI no jogo

Marque **Ativa no jogo** nas telas que devem estar disponíveis durante a execução. A primeira tela ativada é exibida inicialmente. Configure a ação de um botão como **Abrir outra tela** e selecione uma tela de destino também ativada para fazer a navegação. A ação **Definir variável global** aceita valores booleanos (`true`/`false`), números ou texto; esses valores podem ser usados pelo Visual Script.

Barras de progresso leem a variável global indicada e usam o valor máximo configurado. Se a variável não for numérica ou ainda não existir, a barra começa vazia.

## Salvamento

As telas ficam no próprio projeto, no arquivo `ui/screens.json`. Salve o projeto pelo comando normal **Arquivo → Salvar**. Ao abrir projetos antigos sem esse arquivo, o editor inicia com a lista de telas vazia e continua compatível com o formato anterior.

Imagens são incorporadas aos dados da tela. Para evitar arquivos grandes, cada imagem importada tem limite de 5 MB.

## Teste

Execute `npm run ui-workspace:self-test` para validar a estrutura, normalização de cores, limites e dados de imagem das telas. A build completa também valida os componentes Vue e TypeScript.
