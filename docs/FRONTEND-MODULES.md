# Arquitetura do front-end

O front-end está organizado por responsabilidade. A ordem dos estilos é explícita para preservar a cascata enquanto os módulos são separados.

## Entrada e composição

- `src/main.ts`: monta o Vue e instala ferramentas globais.
- `src/App.vue`: ponto de entrada visual; carrega a folha agregadora e o workspace.
- `src/components/AppWorkspace.vue`: compõe barra superior, hierarquia, viewport, inspetor, Visual Script, importador e diagnóstico.
- `src/components/EditorViewport.vue`: marca o elemento `.viewport` e o canvas Three.js; os refs são ligados ao controlador.

## Composables

- `src/composables/useAppController.ts`: coordena estado e ações que conectam os painéis ao motor.
- `src/composables/useEditor.ts`: integra a interface ao motor, aos projetos e às ações de edição.
- `src/composables/useWorldFullscreen.ts`: transição da janela Tauri/Fullscreen API, tecla Esc e re-medição após a troca.
- `src/composables/useViewportLayout.ts`: mede e posiciona controles sobre a viewport.
- `src/composables/useVisualScriptController.ts`: regras, nós, conexões e seleção do Visual Script.
- `src/composables/useComponentLibraryController.ts`: biblioteca, importação e colocação de componentes salvos.
- `src/composables/useFullscreenDiagnostics.ts`: coleta as medidas e estados exibidos pelo diagnóstico.

## Motor de renderização

- `engine/Engine.ts`: simulação e orquestração do mundo.
- `engine/view/Viewport.ts`: renderer Three.js, atualização da câmera e loop de renderização.
- `engine/view/ViewportDiagnostics.ts`: telemetria do canvas, inicialização WebGL, redimensionamento, quadros desenhados e erros. Não decide o layout.

## Estilos

- `src/style.css`: agregador dos estilos base, com imports em ordem.
- `src/styles/base/`: reset, shell/hierarquia, viewport/status, inspetor/toolbar, responsividade e substituições finais da barra de status.
- `src/styles/app.css`: agregador dos estilos refinados em `src/styles/parts/`.
- `src/styles/parts/08-fullscreen.css`: somente geometria do modo tela cheia.
- `src/styles/parts/08-fullscreen-theme.css`: acabamento visual/tema que antes estava misturado às regras estruturais de tela cheia.
- Estilos locais de `ModelImportDialog`, `PlayerHUD`, `SceneHierarchy` e `ControlMapsDialog` ficam em folhas CSS próprias ao lado dos componentes.

## Serviços e lógica de domínio

- `engine/lib/BinaryEncoding.ts`: codificação e decodificação Base64 de buffers binários compartilhada entre runtime, projetos, importação de modelos e biblioteca de componentes.
- `src/lib/animation/AnimationRetargeting.ts`: criação e transferência de clipes de animação, poses de repouso e conversão de trilhas entre rigs.
- `src/lib/animation/BoneMapping.ts`: análise de nomes anatômicos, hierarquia e posição dos ossos; pontuação de candidatos e mapeamento autônomo. Mantém reexportações públicas em `AnimationRetargeting.ts` para compatibilidade.
- `src/lib/assets/ZipModelImport.ts`: converte o retorno do importador nativo de ZIP em arquivos de navegador, preserva caminhos relativos e resolve referências a texturas/buffers com um `THREE.LoadingManager`. O chamador deve revogar as URLs de `context.objectUrls` após concluir ou cancelar a importação.
- `src/lib/assets/GltfModelParser.ts`: concentra a chamada ao `GLTFLoader` e anexa animações/metadados normalizados à raiz, compartilhado pelos fluxos de arquivo, buffer e ZIP.
- `src/lib/assets/GltfMetadata.ts`: normaliza metadados do JSON glTF de forma reutilizável nos fluxos GLB, glTF e importação por ZIP.
- `src/lib/assets/ModelDiagnostics.ts`: calcula a hierarquia técnica de um modelo, as contagens de geometria/materiais/texturas/animações e as verificações de skinning, independentemente do estado reativo do diálogo.
- `src/lib/assets/ModelPreviewParts.ts`: monta a hierarquia selecionável do preview e agrega a quantidade de malhas de baixo para cima, separada da seleção visual.
- `src/lib/assets/ThreeObjectResources.ts`: libera geometrias, materiais e texturas únicos, com modos explícitos para preservar as regras de propriedade do importador, da biblioteca de componentes e das miniaturas.
- `src/lib/hud/HudImageStorage.ts`: concentra leitura, gravação e remoção dos blobs de imagens personalizadas do HUD no IndexedDB. O componente mantém somente o estado visual e as URLs temporárias.

## Diagnóstico da tela preta

No app de desenvolvimento, pressione **Ctrl+Shift+F** para abrir/fechar o painel de diagnóstico mesmo quando o modo de tela cheia estiver desligado. O painel compara o estado nativo da janela, a classe CSS, dimensões de `.app`, `.main`, `.viewport` e canvas, tamanho do buffer WebGL, último resize, quadros desenhados e perda/erro do contexto.

- `canvas CSS = 0 × 0` ou `Resize bloqueado = zero-size`: investigar geometria CSS/layout.
- `Tela cheia nativa Tauri = false`, mas a classe CSS está ativa: investigar chamada/estado da janela.
- `Contexto perdido = true` ou erro de inicialização/renderização: investigar WebGL/GPU.
- Dimensões positivas, contexto válido e contador de quadros avançando: o canvas está recebendo renderizações; investigar cena, composição visual e sobreposição.

A instrumentação é diagnóstica: não presume a causa antes de medir os valores em execução.
