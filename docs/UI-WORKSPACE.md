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

Os botões de exemplo usam a ação genérica **Definir variável global** (por exemplo, `ui.action.start` ou `ui.action.resume`). Eles emitem valores que você pode conectar ao Visual Script ou a outro sistema do projeto; não iniciam ou pausam o jogo automaticamente. Os botões também podem usar **Disparar evento do Visual Script**, enviando um identificador de evento global ao runtime.

## Aparência dos elementos

O inspetor permite ajustar a **opacidade** de 0% a 100% em todos os elementos. Textos, painéis, botões e legendas de barras também podem ter alinhamento à esquerda, centralizado ou à direita, além de peso de fonte de 400 a 800. Essas configurações aparecem tanto na prévia do Workspace quanto na interface executada no jogo. Projetos antigos sem esses campos recebem valores padrão ao serem carregados.

## Ferramentas de edição

- **Grade:** mostra ou oculta a referência visual na tela de edição. **Encaixar** aproxima o elemento da grade de 2,5% enquanto você arrasta.
- **Duplicar:** cria uma cópia do elemento selecionado, com ID próprio e deslocamento inicial para facilitar a composição.
- **Camadas:** use **Frente** e **Atrás** para alterar a ordem de desenho; itens mais abaixo na lista interna de elementos são desenhados por cima.
- **Seleção múltipla:** segure `Shift`, `Ctrl` ou `Cmd` e clique nos elementos do canvas ou da hierarquia para adicionar/remover itens da seleção. Arrastar qualquer elemento selecionado move a seleção inteira.
- **Seleção por retângulo:** arraste em uma área vazia do canvas para selecionar todos os elementos que cruzarem o retângulo. Segure `Shift`, `Ctrl` ou `Cmd` durante o arraste para adicionar os novos elementos à seleção existente.
- **Redimensionar:** a moldura da seleção tem oito alças. Arraste uma borda para alterar um eixo ou um canto para redimensionar largura e altura simultaneamente. Em seleções múltiplas, os tamanhos e posições relativos são escalados em conjunto. Com **Encaixar** ativo, as bordas se ajustam à grade de 2,5%; mantenha `Shift` pressionado ao arrastar um canto para preservar a proporção do retângulo selecionado.
- **Agrupar:** selecione dois ou mais elementos e use **Agrupar**. O grupo continua junto depois de salvar e reabrir o projeto; selecione o grupo e use **Desagrupar** para liberar os elementos.
- **Alinhamento em lote:** com vários elementos selecionados, alinhe bordas esquerdas/direitas, topo/base, ou centralize a seleção pelos eixos X e Y. O alinhamento se baseia nos limites compartilhados da seleção; o restante da tela não é alterado.
- **Alinhamento pelo elemento-chave:** selecione vários itens e use o elemento em foco (o último clicado) como referência. Escolha borda esquerda/direita, topo/base ou centro X/Y no controle **Em relação a**, depois clique em **Alinhar à chave**. A referência não se move.
- **Espaçamento definido:** informe a distância em porcentagem em **Espaço %** e use **Espaçar X** ou **Espaçar Y** para aplicar esse intervalo entre os elementos selecionados, mantendo o primeiro item na posição atual. A operação não altera a seleção se o espaçamento não couber na tela.
- **Distribuição em grade:** defina a quantidade de **Colunas**, ajuste **Espaço %** e clique em **Grade**. Os elementos mantêm seus tamanhos e são centralizados nas células; uma grade que ultrapasse os limites do canvas não é aplicada.
- **Guias inteligentes:** durante o arraste, elementos selecionados se aproximam de bordas e centros dos outros elementos quando ficam a menos de 0,8% da tela. As guias âmbar mostram os alinhamentos ativos; ao soltar o ponteiro, elas desaparecem.
- **Geometria individual precisa:** no inspetor, X, Y, largura e altura aceitam incrementos de 0,25%. Os valores são limitados aos limites da tela para evitar que tamanho e posição deixem o elemento fora do canvas.
- **Distribuição uniforme:** com pelo menos três elementos selecionados, use **Distribuir X** ou **Distribuir Y** para distribuir os espaços entre eles mantendo as dimensões e os limites externos da seleção. Se não houver espaço suficiente para distribuir sem sobreposição, o editor não altera a seleção.
- **Transformação numérica da seleção:** com dois ou mais elementos selecionados, o inspetor mostra X, Y, largura e altura dos limites da seleção em porcentagem. Informe valores precisos para mover ou redimensionar o conjunto inteiro; as posições e dimensões relativas dos elementos são escaladas em conjunto.
- **Centralizar:** com um único elemento, os comandos **Centro X** e **Centro Y** alinham o elemento ao centro da tela no eixo escolhido.
- **Atalhos:** `Ctrl+D` duplica a seleção; `Ctrl+C` copia e `Ctrl+V` cola elementos, inclusive entre telas; `Delete` remove toda a seleção; as setas movem a seleção; `Shift` + setas move em passos maiores; `Esc` fecha a prévia ou limpa a seleção. Os atalhos de movimentação respeitam a opção Encaixar.

## Desfazer, refazer e copiar elementos

Os botões **Desfazer** e **Refazer** ficam no cabeçalho do Workspace. Atalhos: `Ctrl+Z` desfaz, `Ctrl+Y` refaz e `Ctrl+Shift+Z` também refaz. O histórico agrupa edições rápidas e mantém um limite de entradas e de memória estimada para evitar crescimento sem limite ao trabalhar com imagens.

Selecione um ou mais elementos e use **Copiar** ou `Ctrl+C`; troque para outra tela e use **Colar** ou `Ctrl+V`. A colagem cria IDs novos, desloca as cópias e preserva propriedades visuais e imagens incorporadas. Se os elementos copiados pertencem a grupos, a cópia recebe novos IDs de grupo para não alterar o grupo de origem. O clipboard permanece disponível enquanto o Workspace estiver aberto. Atalhos de edição não interceptam digitação nos campos do inspetor.

## Executar a UI no jogo

Marque **Ativa no jogo** nas telas que devem estar disponíveis durante a execução. A primeira tela navegável ativada é exibida inicialmente. Telas **Overlay persistente** também ativadas permanecem sobre a tela ou o jogo, permitindo manter a HUD de vida visível ao navegar pelos menus. Configure a ação de um botão como **Abrir outra tela** e selecione um destino navegável também ativado para fazer a navegação. A ação **Definir variável global** aceita valores booleanos (`true`/`false`), números ou texto; esses valores podem ser usados pelo Visual Script.

### Acionar scripts pela HUD

O botão **＋ Evento global** no topo do Visual Script cria esse tipo de fluxo sem exigir um objeto selecionado. A nova regra já vem com um script de exemplo que registra a origem e o nome do elemento em `ui.last_event_source` e `ui.last_event_element`; substitua a ação pelo comportamento do seu jogo. O identificador gerado fica no inspetor do nó **Evento** para copiar para o botão da HUD.

No próprio **Workspace de UI**, a ação **Disparar evento do Visual Script** também oferece sugestões de eventos existentes. Clique em **＋ Criar fluxo global e vincular automaticamente** para criar uma regra e preencher o identificador do botão em uma única operação. O fluxo aparece no Visual Script para você personalizar as condições e ações.

1. No **Visual Script**, crie um fluxo e, no nó **Evento**, selecione **Evento global · HUD / interface**. Defina um identificador, por exemplo `hud.inventory.open`, e configure as condições e ações desse fluxo.
2. No **Workspace de UI**, selecione um botão de uma tela ou overlay, escolha **Disparar evento do Visual Script** e informe exatamente o mesmo identificador no campo **Evento global do Visual Script**.
3. Marque a tela como **Ativa no jogo** e inicie o modo **Run**. Clicar no botão dispara o fluxo global correspondente. O evento recebe também `source`, `screenId`, `screenName`, `elementId` e `elementName` como dados de contexto, que podem ser lidos pelo script via `event.get('nome')`.

Esse caminho usa o sistema genérico de eventos da engine; não é necessário adicionar código específico para cada HUD ou jogo. Os botões continuam capazes de navegar entre telas e de definir variáveis globais.

Barras de progresso leem a variável global indicada e usam o valor máximo configurado. Se a variável não for numérica ou ainda não existir, a barra começa vazia.

### Visibilidade controlada por scripts

Telas e elementos podem ter a visibilidade ligada a uma variável global no inspetor. Deixe **Visibilidade condicionada por variável** vazio para manter o item sempre visível; ao informar um nome, ele só será mostrado quando a variável existir e `String(valor)` corresponder exatamente ao **Valor exigido para mostrar**. O valor inicial esperado é `true`, mas também pode ser `false`, um número como `1` ou uma string como `aberto`. Se a variável ainda não existir, a UI condicionada fica oculta.

Exemplo de inventário: configure a tela do inventário com variável `ui.inventory.open` e valor exigido `true`. No Visual Script, o botão de inventário define `ui.inventory.open = true` para abrir e outro botão define `ui.inventory.open = false` para fechar. O mesmo mecanismo serve para diálogos, dicas contextuais, barras de estado ou elementos individuais, sem código específico por jogo.

### Textos dinâmicos ligados a variáveis

O texto de painéis, rótulos, botões e legendas de barras aceita marcadores `{{nome_da_variavel}}`. Durante o modo **Run**, o runtime substitui cada marcador pelo valor global atual a cada atualização reativa da interface. Por exemplo, `Vida: {{vida}} / {{vida_maxima}}` mostra o valor atual da vida e o limite definido pelo jogo. Números, textos e booleanos são convertidos para texto; um marcador cuja variável ainda não existe é mantido visível para ajudar a encontrar erros de digitação. Os nomes podem usar letras, números, `_`, `.`, `-` e `:`.

## Salvamento

As telas ficam no próprio projeto, no arquivo `ui/screens.json`. Salve o projeto pelo comando normal **Arquivo → Salvar**. Ao abrir projetos antigos sem esse arquivo, o editor inicia com a lista de telas vazia e continua compatível com o formato anterior.

Imagens são incorporadas aos dados da tela. Para evitar arquivos grandes, cada imagem importada tem limite de 5 MB.

## Teste

Execute `npm run ui-workspace:self-test` para validar estrutura, histórico de desfazer/refazer, agrupamento persistente, seleção por retângulo, redimensionamento conjunto, alinhamento múltiplo e por elemento-chave, grade, guias inteligentes, distribuição uniforme, espaçamento definido e disparo de eventos globais pela HUD, cópia de snapshots, modelos prontos, IDs únicos, normalização das propriedades visuais, compatibilidade com telas antigas, dados de imagem, encaixe, duplicação e ordem das camadas. A build completa também valida os componentes Vue e TypeScript.
