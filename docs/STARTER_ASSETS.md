# Catálogo de modelos iniciais — Engine Prometheus

O Workspace de importação 3D oferece **Modelos iniciais** para experimentar importação de GLB, reprodução de animações, rigging, retargeting e criação de componentes. O catálogo é independente de qualquer jogo e não instala automaticamente pacotes de comportamento.

## Personagens animados de demonstração

| Ativo | Uso inicial | Fonte e licença |
|---|---|---|
| Autômato Expressivo (RobotExpressive) | Personagem de exemplo com clipes de expressão e movimento. | [Three.js — README e créditos](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/RobotExpressive/README.md), Tomás Laulhé; modificações por Don McCurdy, CC0 1.0. |
| Raposa Animada (Fox) | Modelo para testar clips Survey, Walk e Run, hierarquia de rig e retargeting. | [Khronos glTF Sample Assets — README](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Fox/README.md). Modelo de PixelMannen (CC0); rig/animação de tomkranis (CC BY 4.0); conversão por AsoboStudio e scurest (CC BY 4.0). Mantenha os créditos em redistribuições. |

Arquivos GLB usados pelo catálogo:

- RobotExpressive: https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb
- Fox: https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb

A primeira carga remota precisa de internet. Se uma URL estiver indisponível, abra a página da fonte, baixe o modelo e importe-o pela opção **Abrir arquivo**. O modelo só passa a fazer parte do projeto depois que for aplicado ao jogador e salvo, ou salvo como componente.

## Props procedurais

Estes objetos de demonstração são gerados localmente e exportados como GLB:

- **Lâmina Decorativa** — prop para testar escala, materiais, transformações e colisores.
- **Baú Decorativo** — prop para testar posicionamento e criação de componentes.

São objetos visuais comuns: não têm item, inventário, facção, IA ou comportamento de jogo predefinidos. Configure as regras desejadas no inspetor ou através dos módulos de jogo do seu projeto.

## Pacotes externos de modelos e animações

- [Quaternius RPG Character Pack](https://quaternius.com/packs/rpgcharacters.html) — personagens de fantasia rigados, animados e texturizados, com glTF e licença CC0.
- [Quaternius Bestiary — Dungeon Monsters Kit](https://quaternius.itch.io/bestiary-dungeon-monsters-kit) — monstros de fantasia rigados; consulte a licença da versão obtida.
- [Quaternius Universal Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) — biblioteca de animações reutilizáveis, CC0.
- [Quaternius Fantasy Props MegaKit](https://quaternius.com/packs/fantasypropsmegakit.html) — armas, poções, baús e outros props em glTF; CC0.

Depois de baixar um pacote, use **Importar pacote ZIP** quando vier em ZIP, ou **Abrir arquivo** para um GLB. Em modelos humanoides sem clipes adequados, use as ferramentas de rigging/retargeting para mapear animações compatíveis ao rig de destino.

## Como usar

1. Abra **Importar 3D** e clique em **Modelos iniciais**.
2. Escolha **Personagens** ou **Objetos** e carregue o ativo.
3. Para usar um personagem como jogador, escolha **Usar como jogador** no Workspace. Para reutilizá-lo na biblioteca, salve-o como componente.
4. Configure manualmente os componentes, regras e comportamentos que o seu projeto precisar.
5. Execute o mundo para verificar movimento, animações, colisões e renderização.

O catálogo é apenas um ponto de partida para testar a engine. Os papéis de animação disponíveis dependem dos clipes de cada modelo; revise o mapeamento no preview 3D antes de guardar o resultado.
