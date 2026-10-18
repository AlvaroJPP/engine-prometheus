# VEILBORNE — Dark Fantasy RPG Framework

Pacote de mecânicas modulares de RPG medieval sombrio para o Engine Prometheus: magos guerreiros que combinam armas físicas, feitiços, sigilos preparados e recursos de combate.

## Conteúdo

- `veilborne.json`: manifesto de sistemas e estado da integração.
- `content.json`: catálogo inicial com 4 armas, 6 feitiços, 5 sigilos, 4 arquétipos, 4 perfis de inimigos/chefes, efeitos de estado e progressão.
- `engine/script/packages.ts`: registro do componente **VEILBORNE — RPG Sombrio** no editor.
- `engine/script/VeilborneCombat.ts`: cálculos reutilizáveis de dano, escalamento por atributos, resistências, recursos, postura, efeitos de estado, esquiva, aparo e catálogos iniciais de combate.
- `engine/Engine.ts`: integração inicial dos comandos e dos efeitos de combate ao runtime.

## Controles padrão (perfil WASD)

| Tecla | Ação VEILBORNE |
|---|---|
| F | Ataque rápido |
| G | Ataque pesado |
| 1–4 | Lançar o feitiço configurado em `magia_1` até `magia_4` |
| T | Ciclar o sigilo preparado |
| H | Ativar o sigilo selecionado |
| R (segurar) | Bloquear / defender |
| Y | Aparo com janela de 0,2 s |
| V | Esquiva rápida (custo de vigor) |
| X | Deslizar (custo de vigor) |
| B | Rolamento (custo de vigor) |

As teclas são configuráveis em **Configurações → Mapas de controles**. O VEILBORNE usa o mapa ativo do jogador em vez de forçar um conjunto paralelo de teclas.

## Sistemas já conectados

- **Componente de personagem/alvo:** instale `VEILBORNE — RPG Sombrio` no objeto que deve participar do combate. Alvos recebem dano quando seu pacote está habilitado e `faction` é `hostile` (ou não definida). Use `neutral` ou `player` para excluí-los do alvo hostil automático.
- **Combate corpo a corpo:** ataques rápidos e pesados com custo de vigor, alcance aproximado, direção do personagem, escalamento por Força/Destreza/Intelecto/Vontade, dano de postura e crítico em alvo próximo da quebra de postura.
- **Magias:** slots 1–4, custo de éter, conjuração, recarga, dano único ou em área, resistências elementais, efeitos visuais provisórios; Dreno Rubro recupera parte da vida causada e Passo Entre Véus executa deslocamento curto com raycast.
- **Sigilos:** Selo Guardião, Selo de Ruptura, Marca do Caçador, Círculo de Lentidão e Selo do Silêncio. As armadilhas no terreno disparam quando alvos hostis entram no raio. Marca do Caçador aumenta em 20% o dano recebido.
- **Recursos:** vida, éter, vigor e postura são expostos em variáveis globais; o HUD existente pode ler `vida`, `vida_max`, `eter`, `eter_max`, `vigor` e `vigor_max`.
- **Manobras:** esquiva (22 vigor), rolamento (30) e deslize (24) consultam o sistema de recursos enquanto VEILBORNE está ativo.
- **Aparo, bloqueio e escudo:** bloqueio reduz o dano restante e consome vigor; o aparo tem janela de 0,2 s, custa vigor, nega o golpe bem-aparado e abre uma oportunidade de contra-ataque. O Selo Guardião absorve dano através da mesma entrada de dano.
- **Entrada para dano recebido:** `Engine.applyVeilborneIncomingDamage(amount, type, postureDamage, attackerObjectId?)` permite que futuros controladores de IA e ataques invoquem o pipeline de resistência, escudo, bloqueio, aparo e morte.

## Limitações atuais — importante

O fluxo de dano recebido está implementado como método público, mas **o motor ainda não possui uma IA hostil que se aproxime e ataque automaticamente o jogador** para acionar esse método no gameplay. Portanto, bloqueio, aparo e absorção do escudo precisam dessa integração para serem testados contra ataques reais de inimigos.

Os ataques do jogador selecionam alvos VEILBORNE próximos e à frente por distância/direção aproximadas; hitboxes alinhadas a clipes de animação ainda não estão conectadas. Os efeitos visuais são protótipos geométricos. Ainda faltam inventário/equipamento com interface, progressão persistente, checkpoints, chefes com fases em execução e testes de gameplay visual.

## Próximas etapas

1. Ligar hitboxes e janelas de dano a clipes de animação; completar combos, atordoamento e execução.
2. Criar IA hostil com patrulha, percepção, perseguição e ataques que chamem `applyVeilborneIncomingDamage`.
3. Trocar os efeitos geométricos por VFX/SFX substituíveis.
4. Criar inventário e equipamento persistentes, progressão, checkpoints e recuperação de recursos.
5. Criar HUD VEILBORNE para vigor, recargas, estados e sigilos; validar tudo com testes de execução.
