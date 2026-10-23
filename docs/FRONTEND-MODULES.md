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
- `src/lib/animation/SkinTokensRigCompatibility.ts`: verifica se a operação Skin Tokens pode gerar rig ou reparar skinning conforme as malhas presentes, sem depender do estado reativo do diálogo.
- `src/lib/animation/RigKeyframeTimeline.ts`: insere/substitui quadros-chave na linha do tempo e prepara os quadros ordenados para exportação de animações, incluindo a pose inicial em 0 s.
- `src/lib/animation/AnimationRoleOptions.ts`: mantém os papéis e vínculos de controle, e resolve papéis persistidos de clipes importados com fallback por inferência e compatibilidade para classificações diagonais antigas.
- `src/lib/animation/RetargetRestPose.ts`: memoriza poses de repouso por instância de modelo, restaura transformações dos ossos e atualiza os esqueletos durante a transferência de animações.
- `src/lib/animation/ModelRenderableMeshes.ts`: restaura a visibilidade das malhas e materiais antes da prévia de animação e desativa o frustum culling apenas para malhas esqueléticas.
- `src/lib/animation/ModelPreviewAnimationRuntime.ts`: gerencia mixer, ações e controlador da prévia por modelo; registra clipes novos sem reiniciar a animação e descarta o runtime ao trocar modelo ou fechar o importador.
- `src/lib/animation/RetargetPreviewObjects.ts`: cria clones isolados para prévias de retargeting e libera suas geometrias/materiais sem descartar texturas compartilhadas com o modelo principal.
- `src/lib/animation/RetargetPreviewStage.ts`: configura, enquadra, anima, redimensiona e libera as cenas Three.js das prévias de retargeting; o diálogo mantém apenas estado e decisões de origem/destino.
- `src/lib/animation/BoneMapping.ts`: análise de nomes anatômicos, hierarquia e posição dos ossos; pontuação de candidatos e mapeamento autônomo. Mantém reexportações públicas em `AnimationRetargeting.ts` para compatibilidade.
- `src/lib/animation/RetargetAnimationLibrary.ts`: valida e persiste na biblioteca local os assets de animação reutilizáveis, sem acoplar o acesso ao armazenamento ao componente.
- `src/lib/animation/RetargetSourceBones.ts`: seleciona apenas os ossos reais envolvidos no clipe de origem do retargeting, mantendo compatibilidade com entradas antigas da biblioteca de animações.
- `src/lib/animation/RetargetAutonomousReport.ts`: transforma os resultados numéricos do retargeting autônomo em um relatório de cobertura, capacidade do rig e juntas recolhidas, sem acoplar as mensagens ao estado reativo do diálogo.
- `src/lib/animation/RetargetAssetFactory.ts`: monta o asset de retargeting a partir de um item salvo na biblioteca ou do clipe e modelo de origem ativos, mantendo nome e papel da animação consistentes.
- `src/lib/assets/SkinTokensExportPreparation.ts`: clona o modelo esquelético para exportação ao SkinTokens e remove apenas os metadados internos do importador, preservando a árvore e as animações para o exportador GLB.
- `src/lib/assets/SkinTokensModelProcessor.ts`: prepara o GLB de entrada para o SkinTokens, reutiliza bytes originais quando seguros, aplica o limite de tamanho, executa o backend Tauri local e interpreta o GLB retornado; o diálogo fica responsável pelo estado da interface e pela aplicação do resultado.
- `src/lib/assets/SkinTokensRiggingResult.ts`: prepara o GLB retornado pelo SkinTokens, identifica os ossos, marca metadados apenas para rig recém-gerado e recupera papéis das animações por nome, sem acoplar essas regras ao estado do diálogo.
- `src/lib/assets/ModelPreviewThumbnail.ts`: captura uma miniatura WebP da prévia 3D, ocultando temporariamente os auxiliares de colisor e rig e restaurando sua visibilidade após a captura.
- `src/lib/assets/CustomModelThumbnail.ts`: valida imagens fornecidas pelo usuário e converte-as em miniaturas WebP quadradas, mantendo mensagens de validação independentes do componente.
- `src/lib/assets/ZipModelImport.ts`: converte o retorno do importador nativo de ZIP em arquivos de navegador, preserva caminhos relativos e resolve referências a texturas/buffers com um `THREE.LoadingManager`. O chamador deve revogar as URLs de `context.objectUrls` após concluir ou cancelar a importação.
- `src/lib/assets/GltfModelParser.ts`: concentra a chamada ao `GLTFLoader` e anexa animações/metadados normalizados à raiz, compartilhado pelos fluxos de arquivo, buffer e ZIP.
- `src/lib/assets/GltfMetadata.ts`: normaliza metadados do JSON glTF de forma reutilizável nos fluxos GLB, glTF e importação por ZIP.
- `src/lib/assets/ModelDiagnostics.ts`: calcula a hierarquia técnica de um modelo, as contagens de geometria/materiais/texturas/animações e as verificações de skinning, independentemente do estado reativo do diálogo.
- `src/lib/assets/ModelColorTextureRepair.ts`: aplica texturas base-color recuperadas apenas em materiais com mapa ausente ou instalado previamente pela ferramenta, preservando texturas originais e demais mapas.
- `src/lib/assets/ModelColorTextureRecovery.ts`: valida a imagem incorporada escolhida, carrega a textura com as configurações corretas para glTF e delega a aplicação segura ao reparador de base-color.
- `src/lib/assets/ColliderPreviewGeometry.ts`: gera a geometria de contorno amostrada para visualizar colisores de malha sem substituir a geometria completa usada pela colisão em runtime.
- `src/lib/assets/ModelColliderDefaults.ts`: decide, usando a geometria e as dimensões medidas, quando um cenário estático grande deve iniciar com colisor de malha; evita habilitar essa escolha automaticamente para modelos animados.
- `src/lib/assets/ModelColliderSizing.ts`: calcula dimensões finais e a partir dos limites globais de uma parte Three.js, normaliza tamanho/offset ao trocar o formato e atualiza eixos respeitando limites, diâmetros esféricos e offset zero para colisores de malha.
- `src/lib/assets/ModelColliderPreview.ts`: gera e libera o contorno visual de caixas, esferas, cápsulas e colisores de malha, sem alterar o colisor efetivo usado na simulação.
- `src/lib/assets/ModelSpatialMeasurements.ts`: mede as dimensões e o centro de modelos Three.js em coordenadas globais, validando geometrias vazias ou inválidas antes da normalização de escala.
- `src/lib/assets/ModelImportNormalization.ts`: normaliza alturas escolhidas no importador e calcula escala/posição centralizada a partir do centro e altura medidos do modelo.
- `src/lib/assets/ModelPreviewParts.ts`: monta a hierarquia selecionável do preview, agrega a quantidade de malhas de baixo para cima e cria caminhos estáveis para partes com nomes repetidos.
- `src/lib/assets/ModelPreviewPartState.ts`: reconstrói as partes selecionáveis da prévia e reconcilia seleção individual, modo isolado e lotes salvos/selecionados com os IDs ainda existentes após alterações na hierarquia.
- `src/lib/assets/ModelPreviewSelection.ts`: centraliza ancestrais da hierarquia Three.js, visibilidade isolada e seleção de grupos para exportação em lote, mantendo pais/filhos mutuamente exclusivos.
- `src/lib/assets/ModelControlBindings.ts`: normaliza teclas persistidas e converte códigos de teclado em rótulos legíveis, fora do componente.
- `src/lib/assets/ImportModelStates.ts`: valida estados visuais persistidos de partes do modelo, cria novos estados e serializa/normaliza seus valores sem acoplar a transformação ao diálogo.
- `src/lib/assets/ImportBehaviorPackageDrafts.ts`: cria, mescla e clona rascunhos de configuração dos pacotes de comportamento, sincronizando as teclas do pacote Montaria sem manter essa lógica dentro do diálogo.
- `src/lib/assets/ThreeObjectResources.ts`: libera geometrias, materiais e texturas únicos, com modos explícitos para preservar as regras de propriedade do importador, da biblioteca de componentes e das miniaturas.
- `src/lib/assets/ModelOwnedObjectUrls.ts`: recolhe URLs Blob temporárias marcadas na árvore do modelo e revoga URLs únicas de forma centralizada ao limpar modelos ou cancelar importações ZIP.
- `src/lib/assets/ModelImportResourceCleanup.ts`: organiza a liberação do modelo importado na ordem correta: remoção da cena, liberação do colisor estático, texturas recuperadas, URLs próprias e recursos Three.js.
- `src/lib/assets/ImportBehaviorPackageConfig.ts`: reúne as regras puras para rótulos, valores escalares, vetores e teclas de controle da configuração de pacotes de comportamento no importador.
- `src/lib/hud/HudImageStorage.ts`: concentra leitura, gravação e remoção dos blobs de imagens personalizadas do HUD no IndexedDB. O componente mantém somente o estado visual e as URLs temporárias.

## Diagnóstico da tela preta

No app de desenvolvimento, pressione **Ctrl+Shift+F** para abrir/fechar o painel de diagnóstico mesmo quando o modo de tela cheia estiver desligado. O painel compara o estado nativo da janela, a classe CSS, dimensões de `.app`, `.main`, `.viewport` e canvas, tamanho do buffer WebGL, último resize, quadros desenhados e perda/erro do contexto.

- `canvas CSS = 0 × 0` ou `Resize bloqueado = zero-size`: investigar geometria CSS/layout.
- `Tela cheia nativa Tauri = false`, mas a classe CSS está ativa: investigar chamada/estado da janela.
- `Contexto perdido = true` ou erro de inicialização/renderização: investigar WebGL/GPU.
- Dimensões positivas, contexto válido e contador de quadros avançando: o canvas está recebendo renderizações; investigar cena, composição visual e sobreposição.

A instrumentação é diagnóstica: não presume a causa antes de medir os valores em execução.
