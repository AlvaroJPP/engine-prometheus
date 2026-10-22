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
- `src/lib/PackageJson.ts`: clonagem profunda de valores e registros de configuração de pacotes sem `structuredClone`, compatível com objetos Proxy reativos do Vue; reutilizado pelo importador de modelos e pela biblioteca de componentes.
- `src/lib/animation/AnimationRetargeting.ts`: criação e transferência de clipes de animação, poses de repouso e conversão de trilhas entre rigs.
- `src/lib/animation/RigAnimationClip.ts`: converte os quadros-chave gravados no editor em trilhas de posição, rotação e escala do Three.js, fora do componente de importação.
- `src/lib/animation/RigPreviewHelper.ts`: cria e descarta o auxiliar visual de ossos do rig, mantendo a gestão de geometria/material fora do diálogo.
- `src/lib/animation/AnimationRoleOptions.ts`: mantém os papéis de animação disponíveis e o mapeamento de cada papel para a tecla do mapa de controles, fora do diálogo de importação.
- `src/lib/animation/RetargetRestPose.ts`: memoriza poses de repouso por instância de modelo, restaura transformações dos ossos e atualiza os esqueletos durante a transferência de animações.
- `src/lib/animation/ModelRenderableMeshes.ts`: restaura a visibilidade das malhas e materiais antes da prévia de animação e desativa o frustum culling apenas para malhas esqueléticas.
- `src/lib/animation/ModelPreviewAnimationRuntime.ts`: gerencia mixer, ações e controlador da prévia por modelo; registra clipes novos sem reiniciar a animação e descarta o runtime ao trocar modelo ou fechar o importador.
- `src/lib/animation/RetargetPreviewObjects.ts`: cria clones isolados para prévias de retargeting e libera suas geometrias/materiais sem descartar texturas compartilhadas com o modelo principal.
- `src/lib/animation/RetargetPreviewStage.ts`: configura, enquadra, anima, redimensiona e libera as cenas Three.js das prévias de retargeting; o diálogo mantém apenas estado e decisões de origem/destino.
- `src/lib/animation/BoneMapping.ts`: análise de nomes anatômicos, hierarquia e posição dos ossos; pontuação de candidatos e mapeamento autônomo. Mantém reexportações públicas em `AnimationRetargeting.ts` para compatibilidade.
- `src/lib/animation/RetargetAnimationLibrary.ts`: valida e persiste na biblioteca local os assets de animação reutilizáveis, sem acoplar o acesso ao armazenamento ao componente.
- `src/lib/assets/ZipModelImport.ts`: converte o retorno do importador nativo de ZIP em arquivos de navegador, preserva caminhos relativos e resolve referências a texturas/buffers com um `THREE.LoadingManager`. O chamador deve revogar as URLs de `context.objectUrls` após concluir ou cancelar a importação.
- `src/lib/assets/GltfModelParser.ts`: concentra a chamada ao `GLTFLoader` e anexa animações/metadados normalizados à raiz, compartilhado pelos fluxos de arquivo, buffer e ZIP.
- `src/lib/assets/GltfMetadata.ts`: normaliza metadados do JSON glTF de forma reutilizável nos fluxos GLB, glTF e importação por ZIP.
- `src/lib/assets/ModelDiagnostics.ts`: calcula a hierarquia técnica de um modelo, as contagens de geometria/materiais/texturas/animações e as verificações de skinning, independentemente do estado reativo do diálogo.
- `src/lib/assets/ModelColorTextureRepair.ts`: aplica texturas base-color recuperadas apenas em materiais com mapa ausente ou instalado previamente pela ferramenta, preservando texturas originais e demais mapas.
- `src/lib/assets/ColliderPreviewGeometry.ts`: gera a geometria de contorno amostrada para visualizar colisores de malha sem substituir a geometria completa usada pela colisão em runtime.
- `src/lib/assets/ModelColliderDefaults.ts`: decide, usando a geometria e as dimensões medidas, quando um cenário estático grande deve iniciar com colisor de malha; evita habilitar essa escolha automaticamente para modelos animados.
- `src/lib/assets/ModelColliderSizing.ts`: calcula dimensões finais dos colisores a partir do tamanho do modelo, da escala e do formato selecionado; centraliza o tamanho mínimo e o diâmetro dos colisores esféricos.
- `src/lib/assets/ModelPreviewParts.ts`: monta a hierarquia selecionável do preview, agrega a quantidade de malhas de baixo para cima e cria caminhos estáveis para partes com nomes repetidos.
- `src/lib/assets/ModelControlBindings.ts`: normaliza teclas persistidas e converte códigos de teclado em rótulos legíveis, fora do componente.
- `src/lib/assets/ImportModelStates.ts`: valida estados visuais persistidos de partes do modelo, cria novos estados e serializa/normaliza seus valores sem acoplar a transformação ao diálogo.
- `src/lib/assets/ImportBehaviorPackageDrafts.ts`: cria, mescla e clona rascunhos de configuração dos pacotes de comportamento, sincronizando as teclas do pacote Montaria sem manter essa lógica dentro do diálogo.
- `src/lib/assets/ThreeObjectResources.ts`: libera geometrias, materiais e texturas únicos, com modos explícitos para preservar as regras de propriedade do importador, da biblioteca de componentes e das miniaturas.
- `src/lib/hud/HudImageStorage.ts`: concentra leitura, gravação e remoção dos blobs de imagens personalizadas do HUD no IndexedDB. O componente mantém somente o estado visual e as URLs temporárias.

## Diagnóstico da tela preta

No app de desenvolvimento, pressione **Ctrl+Shift+F** para abrir/fechar o painel de diagnóstico mesmo quando o modo de tela cheia estiver desligado. O painel compara o estado nativo da janela, a classe CSS, dimensões de `.app`, `.main`, `.viewport` e canvas, tamanho do buffer WebGL, último resize, quadros desenhados e perda/erro do contexto.

- `canvas CSS = 0 × 0` ou `Resize bloqueado = zero-size`: investigar geometria CSS/layout.
- `Tela cheia nativa Tauri = false`, mas a classe CSS está ativa: investigar chamada/estado da janela.
- `Contexto perdido = true` ou erro de inicialização/renderização: investigar WebGL/GPU.
- Dimensões positivas, contexto válido e contador de quadros avançando: o canvas está recebendo renderizações; investigar cena, composição visual e sobreposição.

A instrumentação é diagnóstica: não presume a causa antes de medir os valores em execução.
