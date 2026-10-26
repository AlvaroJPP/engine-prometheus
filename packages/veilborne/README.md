# VEILBORNE — Dark Fantasy RPG Framework

Pacote modular de RPG medieval sombrio para o Engine Prometheus, onde magos guerreiros combinam armas físicas, feitiços, sigilos preparados, defesa ativa e combate contra criaturas hostis.

## Conteúdo inicial

- `veilborne.json`: manifesto das mecânicas e estado de integração.
- `content.json`: 4 armas, 6 feitiços, 5 sigilos, 4 arquétipos, 4 perfis iniciais de inimigos/chefes e regras de progressão.
- `runtime/behaviorPackageDefinition.ts`: definição do pacote de comportamento, registrada explicitamente pelo host que decidir carregar VEILBORNE.
- `runtime/VeilborneCombat.ts`: regras puras de dano, recursos, resistências, postura, efeitos de estado e perfis de armas/magias/sigilos.
- `runtime/`: sistemas específicos do jogo para efeitos visuais, barras de vida, inventário, uso de itens, progressão, loot, morte/renascimento, travamento de alvo e sigilos.
- `ui/VeilborneHUD.vue`: overlay opcional de Arsenal, inventário e progressão, separado do HUD genérico do editor.
- O núcleo do Engine Prometheus não contém as regras de combate, progressão ou morte de VEILBORNE; o jogo deve conectá-las pela interface genérica de módulos.
- `engine/input/ControlMaps.ts` e `src/components/ControlMapsDialog.vue`: teclas de bloqueio e aparo configuráveis.

## Catálogo de modelos iniciais

No importador 3D, clique em **Modelos iniciais** para carregar o Autômato Expressivo animado, a Raposa Errante (com IA de flanqueamento) ou itens protótipos gerados pelo próprio editor. Os inimigos e consumíveis recebem o pacote VEILBORNE com os valores iniciais adequados; salve-os como componente, coloque-os na cena e execute o mundo.

O catálogo também possui links oficiais para pacotes de personagens de fantasia, monstros e props. Os modelos externos baixados do pacote podem ser importados por **Importar pacote ZIP** ou **Abrir arquivo**. Veja fontes, licenças, créditos e instruções em [docs/STARTER_ASSETS.md](../../docs/STARTER_ASSETS.md).

## Controles padrão (perfil WASD)

| Tecla | Ação VEILBORNE |
|---|---|
| F | Ataque rápido |
| G (segurar e soltar) | Carregar e executar ataque pesado |
| 1–4 | Feitiços configurados em `magia_1` até `magia_4` |
| T | Ciclar sigilo preparado |
| H | Ativar sigilo selecionado |
| TAB | Abrir/fechar Arsenal do Véu |
| O | Travar / destravar alvo hostil |
| R (segurar) | Bloquear / defender |
| Y | Aparo com janela de 0,2 s |
| V | Esquiva rápida (custo de vigor) |
| X | Deslizar (custo de vigor) |
| B | Rolamento (custo de vigor) |

As teclas são remapeáveis em **Configurações → Mapas de controles**. O runtime usa o mapa de controles ativo.

## Sistemas conectados

- **Personagem/alvo:** instale `VEILBORNE — RPG Sombrio` no objeto que deve participar do combate. Alvos com pacote ativo e `faction=hostile` (ou sem facção definida) recebem dano e podem executar IA. `neutral` e `player` excluem o objeto da lista de inimigos.
- **Combate físico:** ataques rápidos e pesados, custos de vigor, alcance/direção aproximados, escalamento por atributos, dano de postura e golpes críticos em inimigos próximos da quebra de postura. Segurar G acumula carga por até 2 segundos; soltar executa o golpe com bônus de dano/postura e maior custo/recarga.
- **Magias:** quatro slots, custo de éter, tempo de conjuração, recarga, dano único/área e resistências elementais. Dreno Rubro recupera parte do dano causado; Passo Entre Véus usa raycast para limitar o deslocamento.
- **Sigilos:** Selo Guardião, Selo de Ruptura, Marca do Caçador, Círculo de Lentidão e Selo do Silêncio. Armadilhas no terreno ativam quando um hostil entra no raio; Marca do Caçador aumenta em 20% o dano recebido pelo alvo marcado.
- **Travamento de alvo:** O seleciona o inimigo hostil à frente mais adequado e mantém um marcador visual. Ataques e magias priorizam esse inimigo enquanto estiver ao alcance; O novamente destrava. O personagem vira para o alvo enquanto o travamento estiver ativo.
- **IA hostil inicial:** perfis `melee`, `ranged_caster`, `flanker`, `guard_breaker` e `boss_phases`. A IA detecta o jogador por distância, persegue ou mantém distância de conjurador, ataca com recarga e tipo de dano configuráveis, muda de estado, dispara eventos de pacote e toca `primary_action` ou `ability_1` quando há clipe mapeado. Chefes mudam o multiplicador de dano em 60% e 25% de vida. `ai_enabled` liga/desliga a IA; `ai_profile` escolhe o perfil; ative `ai_custom_stats` para usar os campos editáveis de alcance, velocidade, dano e recarga.
- **Bloqueio e aparo:** segurar bloqueio reduz o dano restante e consome vigor. O aparo tem uma janela de 0,2 s, custa vigor, nega um ataque e gera um contra-ataque calculado pela arma equipada. O Selo Guardião absorve uma quantidade limitada de dano.
- **Quebra de postura:** ataques podem encher a postura. Ao quebrar a postura de inimigos, eles ficam atordoados por 1,15 s e a postura é reiniciada; quando a postura do jogador quebra, o movimento e as ações são bloqueados por 0,85 s.
- **Manobras:** esquiva (22 vigor), rolamento (30) e deslize (24) consultam recursos enquanto o VEILBORNE está ativo.
- **Arsenal do Véu:** HUD de sessão aberto por Tab ou pelo botão VEILBORNE. Permite trocar a arma equipada, configurar os quatro espaços de feitiço e preparar quatro sigilos. As alterações são aplicadas às variáveis globais do runtime, então o combate usa imediatamente o novo armamento/mapeamento. O painel também mostra nível, barra de experiência, Ecos, pontos de atributo e permite investir pontos em Força, Destreza, Intelecto, Vontade e Resistência. Inclui quatro presets aplicáveis: Duelista do Véu, Erudito Rúnico, Adepto Rubro e Quebrajuramentos.
- **Progressão por derrota:** inimigos derrotados concedem Ecos e experiência. A cada nível o jogador recebe um ponto de atributo; a curva aumenta com o nível. Recompensas automáticas dependem do perfil de IA, mas podem ser sobrescritas por inimigo usando `eco_reward` e `xp_reward` (`-1` = automático; `0` = nenhuma recompensa). A transição de nível dispara o evento de pacote `level_up` no objeto que concedeu a recompensa.
- **Loot e consumíveis:** inimigos podem ter `drop_item_id`, `drop_chance` e `drop_quantity` definidos no componente VEILBORNE; o drop aparece como cristal no mundo, pode ser coletado próximo com a tecla de interação e adicionado a `inventario_json`. Objetos da cena também podem virar coletáveis configurando `entity_role=loot`, `loot_item_id` e `loot_quantity`. O inventário permite usar Frasco de Vitalidade, Frasco de Éter, Tônico de Vigor, Bomba de Brasa e Fragmento de Ecos.
- **Santuários e morte:** configure um objeto com o componente VEILBORNE e `entity_role=checkpoint`. Interagir perto dele registra o último santuário e restaura recursos (se `checkpoint_restore_resources` estiver ativo). Se o jogador morrer, ele renasce após uma breve pausa no santuário ou na posição inicial; os Ecos carregados caem em um cristal recuperável no local da morte. Uma segunda morte antes da recuperação elimina os Ecos antigos. O progresso de checkpoints/Ecos é mantido em variáveis do projeto, mas ainda não existe um arquivo de save independente.
- **Recursos e HUD:** variáveis globais incluem `vida`, `vida_max`, `eter`, `eter_max`, `vigor`, `vigor_max`, `postura`, atributos, resistências, `alvo_travado`, `carregando_ataque` e `carga_ataque`, além dos estados de combate. Podem alimentar o HUD e o Visual Script.
- **Dano recebido:** o contrato público do jogo ainda precisa ser conectado ao adaptador `EngineGameModule`; o núcleo genérico não fornece uma API de dano específica para VEILBORNE.

## Limitações atuais

Esta é uma **primeira fatia jogável**, não um RPG completo. A IA ainda usa perseguição direta e percepção por distância: não tem pathfinding, navegação inteligente ao redor de obstáculos ou line-of-sight. Os ataques do jogador usam alcance e direção aproximados; hitboxes ainda não estão sincronizadas com janelas específicas das animações. Feitiços e sigilos usam efeitos geométricos provisórios.

Ainda faltam loot/equipamentos mais avançados (armas e armaduras coletáveis), um arquivo de save de personagem independente do projeto, árvore de habilidades, diálogos/missões e chefes com padrões de ataque exclusivos. O sistema de drops atual é um primeiro inventário de consumíveis; ele não implementa ainda um sistema geral de itens com raridade/modificadores. A progressão por XP/Ecos funciona na sessão atual, mas não foi ligada a um arquivo de save. O Arsenal do Véu atual configura o loadout, mas não é ainda um inventário de itens. Essas partes devem ser adicionadas por subsistemas reutilizáveis, não por soluções específicas para cada modelo.

## Próximas etapas

1. Adicionar navegação e percepção com linha de visão à IA e melhorar a resposta a obstáculos.
2. Sincronizar dano com animações, colisões/hitboxes, combos, atordoamento e execução.
3. Construir inventário/equipamento e progressão persistente, checkpoints e morte/recuperação.
4. Criar HUD própria de combate com vigor, recargas, estados e sigilos equipados.
5. Trocar os efeitos geométricos por VFX/SFX configuráveis e validar o gameplay em execução.
