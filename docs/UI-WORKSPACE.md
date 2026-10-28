# Workspace de UI

O Workspace de UI é um editor visual genérico para criar menus, telas de pausa, diálogos e HUDs sem escrever HTML ou Vue.

## Abrir o editor

Na barra superior do Engine Prometheus, use **Workspace UI**. Crie uma tela e adicione os elementos pelo menu do topo. Arraste os elementos na prévia para posicioná-los ou selecione-os pela hierarquia para editar as propriedades.

## Elementos disponíveis

- **Texto:** rótulo, título ou informação visual.
- **Botão:** pode ficar sem ação, navegar para outra tela ou definir uma variável global durante o jogo.
- **Painel:** superfície visual para agrupar ou destacar conteúdo.
- **Imagem:** importa PNG, JPG ou WebP de até 5 MB.
  - Ajuste **Conter** preserva a imagem inteira, **Cobrir** preenche o quadro com cortes nas bordas quando necessário e **Esticar** ocupa toda a área.
- **Barra:** acompanha uma variável global numérica, como `vida` ou `mana`.

Cada tela usa a proporção 16:9 e coordenadas relativas, para que posições e tamanhos se adaptem a diferentes tamanhos de janela. O tipo pode ser **Tela navegável** (menu, pausa e diálogos) ou **Overlay persistente** (HUD).

## Modelos prontos

Na lateral esquerda, em **Modelos prontos**, você pode criar uma nova tela a partir de três bases genéricas:

- **Menu principal:** título, subtítulo e botões de iniciar, opções e sair.
- **Menu de pausa:** painel com ações de continuar, abrir opções ou solicitar retorno ao menu.
- **HUD de aventura:** overlay com barras de vida e mana conectadas às variáveis globais `vida` e `mana`.

Os modelos são cópias independentes e criam IDs novos para a tela e cada elemento. Eles começam desativados no jogo para não cobrir a cena ou alterar uma interface existente sem intenção. Revise o modelo, ajuste os elementos e marque **Ativa no jogo** quando estiver pronto.

Os botões de exemplo usam a ação genérica **Definir variável global** (por exemplo, `ui.action.start` ou `ui.action.resume`). Eles emitem valores que você pode conectar ao Visual Script ou a outro sistema do projeto; não iniciam ou pausam o jogo automaticamente.

## Aparência dos elementos

O inspetor permite ajustar a **opacidade** de 0% a 100% em todos os elementos. Textos, painéis, botões e legendas de barras também podem ter alinhamento à esquerda, centralizado ou à direita, além de peso de fonte de 400 a 800. Essas configurações aparecem tanto na prévia do Workspace quanto na interface executada no jogo. Projetos antigos sem esses campos recebem valores padrão ao serem carregados.

## Ferramentas de edição

- **Grade:** mostra ou oculta a referência visual na tela de edição. **Encaixar** aproxima o elemento da grade de 2,5% enquanto você arrasta.
- **Duplicar:** cria uma cópia do elemento selecionado, com ID próprio e deslocamento inicial para facilitar a composição.
- **Camadas:** use **Frente** e **Atrás** para alterar a ordem de desenho; itens mais abaixo na lista interna de elementos são desenhados por cima.
- **Seleção múltipla:** segure `Shift`, `Ctrl` ou `Cmd` e clique nos elementos do canvas ou da hierarquia para adicionar/remover itens da seleção. Arrastar qualquer elemento selecionado move a seleção inteira.
- **Seleção por retângulo:** arraste em uma área vazia do canvas para selecionar todos os elementos que cruzarem o retângulo. Segure `Shift`, `Ctrl` ou `Cmd` durante o arraste para adicionar os novos elementos à seleção existente.
- **Redimensionar:** a moldura da seleção tem oito alças. Arraste uma borda para alterar um eixo ou um canto para redimensionar largura e altura simultaneamente. Em seleções múltiplas, os tamanhos e posições relativos são escalados em conjunto.
- **Agrupar:** selecione dois ou mais elementos e use **Agrupar**. O grupo continua junto depois de salvar e reabrir o projeto; selecione o grupo e use **Desagrupar** para liberar os elementos.
- **Alinhamento em lote:** com vários elementos selecionados, alinhe bordas esquerdas/direitas, topo/base, ou centralize a seleção pelos eixos X e Y. O alinhamento se baseia nos limites compartilhados da seleção; o restante da tela não é alterado.
- **Centralizar:** com um único elemento, os comandos **Centro X** e **Centro Y** alinham o elemento ao centro da tela no eixo escolhido.
- **Atalhos:** `Ctrl+D` duplica a seleção; `Ctrl+C` copia e `Ctrl+V` cola elementos, inclusive entre telas; `Delete` remove toda a seleção; as setas movem a seleção; `Shift` + setas move em passos maiores; `Esc` fecha a prévia ou limpa a seleção. Os atalhos de movimentação respeitam a opção Encaixar.

## Desfazer, refazer e copiar elementos

Os botões **Desfazer** e **Refazer** ficam no cabeçalho do Workspace. Atalhos: `Ctrl+Z` desfaz, `Ctrl+Y` refaz e `Ctrl+Shift+Z` também refaz. O histórico agrupa edições rápidas e mantém um limite de entradas e de memória estimada para evitar crescimento sem limite ao trabalhar com imagens.

Selecione um ou mais elementos e use **Copiar** ou `Ctrl+C`; troque para outra tela e use **Colar** ou `Ctrl+V`. A colagem cria IDs novos, desloca as cópias e preserva propriedades visuais e imagens incorporadas. Se os elementos copiados pertencem a grupos, a cópia recebe novos IDs de grupo para não alterar o grupo de origem. O clipboard permanece disponível enquanto o Workspace estiver aberto. Atalhos de edição não interceptam digitação nos campos do inspetor.

## Executar a UI no jogo

Marque **Ativa no jogo** nas telas que devem estar disponíveis durante a execução. A primeira tela navegável ativada é exibida inicialmente. Telas **Overlay persistente** também ativadas permanecem sobre a tela ou o jogo, permitindo manter a HUD de vida visível ao navegar pelos menus. Configure a ação de um botão como **Abrir outra tela** e selecione um destino navegável também ativado para fazer a navegação. A ação **Definir variável global** aceita valores booleanos (`true`/`false`), números ou texto; esses valores podem ser usados pelo Visual Script.

Barras de progresso leem a variável global indicada e usam o valor máximo configurado. Se a variável não for numérica ou ainda não existir, a barra começa vazia.

## Salvamento

As telas ficam no próprio projeto, no arquivo `ui/screens.json`. Salve o projeto pelo comando normal **Arquivo → Salvar**. Ao abrir projetos antigos sem esse arquivo, o editor inicia com a lista de telas vazia e continua compatível com o formato anterior.

Imagens são incorporadas aos dados da tela. Para evitar arquivos grandes, cada imagem importada tem limite de 5 MB.

## Teste

Execute `npm run ui-workspace:self-test` para validar estrutura, histórico de desfazer/refazer, agrupamento persistente, seleção por retângulo, redimensionamento conjunto, alinhamento múltiplo, cópia de snapshots, modelos prontos, IDs únicos, normalização das propriedades visuais, compatibilidade com telas antigas, dados de imagem, encaixe, duplicação e ordem das camadas. A build completa também valida os componentes Vue e TypeScript.
