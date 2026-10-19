# Catálogo de modelos iniciais — Engine Prometheus / VEILBORNE

O Model Workspace tem um botão **Modelos iniciais**. Ele abre um catálogo embutido no editor, baixa modelos GLB públicos com animações ou gera protótipos de itens localmente e os carrega na prévia 3D.

## Personagem jogável e inimigos de demonstração

| Ativo | Uso inicial | Fonte e licença |
|---|---|---|
| Autômato Expressivo (RobotExpressive) | Personagem jogável ou inimigo corpo a corpo; inclui vários clipes de expressão e movimento. | [Three.js — README e créditos](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/RobotExpressive/README.md), Tomás Laulhé; modificações por Don McCurdy, CC0 1.0. |
| Raposa Errante (Fox) | Inimigo com IA flanqueadora; o arquivo contém Survey, Walk e Run. | [Khronos glTF Sample Assets — README](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Fox/README.md). Modelo de PixelMannen (CC0); rig/animação de tomkranis (CC BY 4.0); conversão por AsoboStudio e scurest (CC BY 4.0). Manter atribuição em redistribuições. |

Arquivos GLB usados para carregar os modelos:

- RobotExpressive: https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb
- Fox: https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb

O carregamento remoto requer internet. Se uma URL estiver temporariamente indisponível, use a página da fonte para baixar o modelo e importe o GLB pela opção **Abrir arquivo**. Os modelos são mantidos na biblioteca do projeto apenas depois que você os salva como componente ou aplica o modelo ao jogador e salva o projeto.

## Itens e objetos procedurais

Estes protótipos são gerados dentro do editor e exportados como GLB, sem depender de downloads externos:

- Frasco de Vitalidade — configurado como coletável **lesser_vitality_vial**.
- Frasco de Éter — **ether_vial**.
- Tônico de Vigor — **vigor_vial**.
- Fragmento de Ecos — **echo_fragment**.
- Bomba de Brasa — **ember_bomb**.
- Lâmina do Véu — objeto visual; armas equipadas ainda são selecionadas no Arsenal do Véu.
- Baú de Relíquias — objeto decorativo.

Os itens que representam consumíveis recebem automaticamente o pacote **veilborne_rpg**, com **entity_role=loot**, **faction=neutral**, IA desligada e o ID de inventário correspondente. Salve-os como componentes, coloque-os na cena e execute o mundo. A coleta de itens compatíveis acontece ao se aproximar e pressionar a tecla de interação configurada (E no mapa padrão). O item adicionado ao inventário é um consumível VEILBORNE; modelos de armas decorativas não são equipados automaticamente.

## Pacotes externos de fantasia

Para personagens e monstros em estilo RPG mais coerente, estes são downloads oficiais indicados dentro do catálogo:

- [Quaternius RPG Character Pack](https://quaternius.com/packs/rpgcharacters.html) — seis personagens de fantasia rigados, animados e texturizados, com glTF e licença CC0.
- [Quaternius Bestiary — Dungeon Monsters Kit](https://quaternius.itch.io/bestiary-dungeon-monsters-kit) — sete monstros de fantasia rigados; os modelos não vêm com clipes próprios, então podem exigir usar o Rig & Keyframes/retargeting para reaproveitar animações compatíveis. Consulte a licença da versão obtida.
- [Quaternius Universal Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) — biblioteca de mais de 120 animações reutilizáveis, CC0.
- [Quaternius Fantasy Props MegaKit](https://quaternius.com/packs/fantasypropsmegakit.html) — mais de 200 armas, poções, baús e outros objetos em glTF; CC0.

Depois de baixar um pacote, use **Importar pacote ZIP** no mesmo Workspace quando o pacote vier em ZIP, ou **Abrir arquivo** para um GLB. Em modelos humanoides que venham sem clipes, use a aba de rigging/retargeting para mapear os clipes ao rig do modelo de destino.

## Como usar

1. Abra o editor, selecione **Importar 3D** e clique em **Modelos iniciais**.
2. Escolha **Jogador**, **Inimigos** ou **Itens e objetos** e carregue um ativo.
3. Para o personagem, use o botão **Usar como jogador** no rodapé do Workspace. Depois salve o projeto.
4. Para um inimigo ou consumível, escolha **Salvar componente**. O pacote VEILBORNE e as configurações iniciais já estarão associados ao componente.
5. Coloque o componente na cena. Para inimigos, deixe **ai_enabled=true**, **faction=hostile** e selecione o perfil de IA no pacote VEILBORNE. Para coletáveis, confirme **entity_role=loot** e o **loot_item_id**.
6. Execute o mundo e teste. Modelos que não tenham uma animação para um papel específico usam os fallbacks disponíveis; não há garantia de que todo inimigo tenha animações exclusivas de ataque, morte ou magia.

O catálogo é um conjunto inicial de demonstração, não uma afirmação de que o combate possui sincronização de hitboxes com todos os clipes. A IA atual continua baseada em perseguição direta e distância de percepção.
