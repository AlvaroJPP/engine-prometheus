# VEILBORNE — Dark Fantasy RPG Framework

Pacote de mecânicas de RPG medieval sombrio para o Engine Prometheus. O objetivo é combinar combate exigente, magos guerreiros, armas físicas, feitiços, sigilos preparados, progressão, inimigos e exploração.

## Conteúdo

- `veilborne.json`: manifesto geral de mecânicas e sistemas.
- `content.json`: conteúdo inicial de 4 armas, 6 feitiços, 5 sigilos, 4 arquétipos, 4 inimigos/chefes, efeitos de estado e regras de progressão.
- `engine/script/VeilborneCombat.ts`: funções puras reutilizáveis para atributos, dano de armas, dano mágico, gastos/restauração de recursos, resistências, postura, efeitos de estado, esquiva e janela de aparo.
- Registro em `engine/script/packages.ts`: disponibiliza **VEILBORNE — RPG Sombrio** no catálogo de pacotes de comportamento do editor.
- Variáveis iniciais por instância: vida, éter, vigor, postura, atributos e nível.

## Direção de design

- Combate deliberado: ataques rápidos/pesados, esquiva, aparo, postura, atordoamento e janelas de vulnerabilidade.
- Mago combatente: qualquer arquétipo pode combinar arma, catalisador, feitiços e sigilos.
- Sigilos preparados: equipar um conjunto antes da luta e ativar efeitos com custo, alcance, duração e recarga.
- Dados primeiro: armas, magias, sigilos, efeitos, inimigos e recompensas devem ser configuráveis, evitando lógica exclusiva para cada item.
- Integração com o motor: entidades e colisões do mundo, animações importadas, mapas de controle, variáveis globais/por objeto, regras visuais e HUD.
- Não depende de assets proprietários de Bloodborne ou The Witcher; usa apenas referências gerais de gênero e mecânicas.

## Estado da implementação

### Já conectado ao runtime

- O pacote é registrado em `engine/script/packages.ts` e pode ser adicionado a objetos importados ou da cena.
- Enquanto um projeto com o pacote ativo está em execução, `F` (ação primária por padrão) executa ataque rápido e `G` (ação secundária) executa ataque pesado; as teclas reais vêm do mapa de controles ativo.
- As quatro teclas de habilidade lançam os feitiços configurados em `magia_1` a `magia_4`; os padrões são Dardo do Véu, Explosão de Brasa, Corrente Glacial e Dreno Rubro.
- Armas e feitiços aplicam dano calculado por atributos, respeitam resistências elementais do alvo, consomem vigor/éter, acumulam postura e podem matar.
- Feitiços têm tempo de conjuração e recarga; Explosão de Brasa e outros feitiços de área podem acertar múltiplos alvos; estados de queimadura, sangramento e veneno causam dano periódico.
- Os sigilos podem ser selecionados por `T` (ciclar sigilo, por padrão) e ativados por `H` (usar item, por padrão). Selo de Ruptura explode quando inimigos entram no círculo; Lentidão e Silêncio aplicam seus estados; Marca do Caçador aumenta em 20% o dano recebido pelo alvo marcado.
- Selo Guardião cria uma proteção visual temporária e expõe `ward_remaining` e `ward_absorption`; o consumo real da absorção será conectado quando o sistema de ataques recebidos/IA estiver pronto.
- Dreno Rubro recupera vida a partir do dano causado; Passo Entre Véus faz um deslocamento curto com consulta de raio contra a geometria da cena.
- O personagem do jogador usa variáveis globais `vida`, `vida_max`, `eter`, `eter_max`, `vigor`, `vigor_max`, `postura`, atributos e `arma_equipada`. Isso permite usar os valores no Visual Script e na HUD já configurável.
- As esquivas, rolamentos e deslizes existentes agora podem cobrar vigor quando o VEILBORNE está ativo: esquiva 22, rolamento 30 e deslize 24. Sem o pacote, o callback de admissão libera o comportamento normal do avatar.
- Para se tornar alvo do combate inicial, um objeto precisa ter o componente VEILBORNE instalado. A variável do pacote `faction` usa `hostile` como padrão; `neutral` ou `player` exclui o objeto do alvo automático. Resistências podem ser ajustadas nas variáveis do componente.

### Ainda em implementação

A integração inicial já possui ataques físicos, conjuração e ativação básica de sigilos, mas ainda não equivale a um RPG completo. Faltam IA hostil ligada a movimento e ataques recebidos, consumo da absorção do Selo Guardião, colisores de armas/hitboxes ligados a animações, inventário/equipamento com interface, chefes em fases, checkpoints e persistência entre sessões. Os efeitos visuais atuais são protótipos geométricos e precisam ser trocados por VFX/SFX de produção.

## Próximas etapas de implementação

1. Adicionar aparo com janela de tempo real e ligar bloqueios à redução de dano.
2. Ligar hitboxes a clipes de animação, combos, atordoamento e execução.
3. Conectar feitiços a projéteis, colisão e VFX/SFX substituíveis.
4. Criar colocação e ativação de sigilos no terreno, em alvos e por gatilhos.
5. Inventário, equipamento e progressão persistente.
6. IA de inimigos, chefes por fases, checkpoints e recuperação de recursos.
7. HUD VEILBORNE com barra de vigor, estados e recargas.
8. Build, testes de integração e validação de desempenho.


1. Runtime de atributos, dano, resistência, postura e morte.
2. Controlador de combate: ataques, combos, esquiva, aparo e stamina.
3. Runtime de feitiços e projéteis com custos, recarga e efeitos.
4. Runtime de sigilos com colocação, detecção de alvos e disparo.
5. Equipamento/inventário e progressão persistente.
6. IA de inimigos, chefes por fases, checkpoints e recuperação de recursos.
7. HUD VEILBORNE e painel de configuração visual no editor.
8. Testes de integração e validação de desempenho.
