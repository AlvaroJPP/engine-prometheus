# VEILBORNE — Dark Fantasy RPG Framework

Pacote modular de RPG medieval sombrio para o Engine Prometheus, onde magos guerreiros combinam armas físicas, feitiços, sigilos preparados, defesa ativa e combate contra criaturas hostis.

## Conteúdo inicial

- `veilborne.json`: manifesto das mecânicas e estado de integração.
- `content.json`: 4 armas, 6 feitiços, 5 sigilos, 4 arquétipos, 4 perfis iniciais de inimigos/chefes e regras de progressão.
- `engine/script/packages.ts`: registro do componente **VEILBORNE — RPG Sombrio** no editor.
- `engine/script/VeilborneCombat.ts`: regras puras de dano, recursos, resistências, postura, efeitos de estado e perfis de armas/magias/sigilos.
- `engine/Engine.ts`: combate, sigilos, aparo/bloqueio, pipeline de dano recebido e primeira IA hostil.
- `engine/input/ControlMaps.ts` e `src/components/ControlMapsDialog.vue`: teclas de bloqueio e aparo configuráveis.

## Controles padrão (perfil WASD)

| Tecla | Ação VEILBORNE |
|---|---|
| F | Ataque rápido |
| G | Ataque pesado |
| 1–4 | Feitiços configurados em `magia_1` até `magia_4` |
| T | Ciclar sigilo preparado |
| H | Ativar sigilo selecionado |
| R (segurar) | Bloquear / defender |
| Y | Aparo com janela de 0,2 s |
| V | Esquiva rápida (custo de vigor) |
| X | Deslizar (custo de vigor) |
| B | Rolamento (custo de vigor) |

As teclas são remapeáveis em **Configurações → Mapas de controles**. O runtime usa o mapa de controles ativo.

## Sistemas conectados

- **Personagem/alvo:** instale `VEILBORNE — RPG Sombrio` no objeto que deve participar do combate. Alvos com pacote ativo e `faction=hostile` (ou sem facção definida) recebem dano e podem executar IA. `neutral` e `player` excluem o objeto da lista de inimigos.
- **Combate físico:** ataques rápidos e pesados, custos de vigor, alcance/direção aproximados, escalamento por atributos, dano de postura e golpes críticos em inimigos próximos da quebra de postura.
- **Magias:** quatro slots, custo de éter, tempo de conjuração, recarga, dano único/área e resistências elementais. Dreno Rubro recupera parte do dano causado; Passo Entre Véus usa raycast para limitar o deslocamento.
- **Sigilos:** Selo Guardião, Selo de Ruptura, Marca do Caçador, Círculo de Lentidão e Selo do Silêncio. Armadilhas no terreno ativam quando um hostil entra no raio; Marca do Caçador aumenta em 20% o dano recebido pelo alvo marcado.
- **IA hostil inicial:** perfis `melee`, `ranged_caster`, `flanker`, `guard_breaker` e `boss_phases`. A IA detecta o jogador por distância, persegue ou mantém distância de conjurador, ataca com recarga e tipo de dano configuráveis, muda de estado, dispara eventos de pacote e toca `primary_action` ou `ability_1` quando há clipe mapeado. Chefes mudam o multiplicador de dano em 60% e 25% de vida.
- **Bloqueio e aparo:** segurar bloqueio reduz o dano restante e consome vigor. O aparo tem uma janela de 0,2 s, custa vigor, nega um ataque e gera um contra-ataque calculado pela arma equipada. O Selo Guardião absorve uma quantidade limitada de dano.
- **Manobras:** esquiva (22 vigor), rolamento (30) e deslize (24) consultam recursos enquanto o VEILBORNE está ativo.
- **Recursos e HUD:** variáveis globais incluem `vida`, `vida_max`, `eter`, `eter_max`, `vigor`, `vigor_max`, `postura`, atributos, resistências e estados de combate. Podem alimentar o HUD e o Visual Script.
- **Dano recebido:** `Engine.applyVeilborneIncomingDamage(amount, type, postureDamage, attackerObjectId?)` resolve resistência elemental, escudo, bloqueio, aparo e morte; a IA inicial já usa essa entrada.

## Limitações atuais

Esta é uma **primeira fatia jogável**, não um RPG completo. A IA ainda usa perseguição direta e percepção por distância: não tem pathfinding, navegação inteligente ao redor de obstáculos ou line-of-sight. Os ataques do jogador usam alcance e direção aproximados; hitboxes ainda não estão sincronizadas com janelas específicas das animações. Feitiços e sigilos usam efeitos geométricos provisórios.

Ainda faltam inventário/equipamento com interface, progressão e salvamento persistentes, checkpoints, respawn e recuperação de recursos, árvore de habilidades, diálogos/missões e chefes com padrões de ataque exclusivos. Essas partes devem ser adicionadas por subsistemas reutilizáveis, não por soluções específicas para cada modelo.

## Próximas etapas

1. Adicionar navegação e percepção com linha de visão à IA e melhorar a resposta a obstáculos.
2. Sincronizar dano com animações, colisões/hitboxes, combos, atordoamento e execução.
3. Construir inventário/equipamento e progressão persistente, checkpoints e morte/recuperação.
4. Criar HUD própria de combate com vigor, recargas, estados e sigilos equipados.
5. Trocar os efeitos geométricos por VFX/SFX configuráveis e validar o gameplay em execução.
