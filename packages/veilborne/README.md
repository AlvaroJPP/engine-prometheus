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

Esta primeira base registra o pacote no catálogo, cria suas variáveis, fornece um catálogo inicial de conteúdo e implementa regras puras de combate/recursos. O pacote já fica disponível no editor como componente de comportamento. Porém, os controles de combate, projéteis e VFX, detecção/ativação de sigilos, IA, inventário, chefes por fases e salvamento **ainda precisam ser ligados ao ciclo de jogo e à interface do Engine Prometheus**; a presença dos dados não os torna automaticamente jogáveis.

## Próximas etapas de implementação

1. Runtime de atributos, dano, resistência, postura e morte.
2. Controlador de combate: ataques, combos, esquiva, aparo e stamina.
3. Runtime de feitiços e projéteis com custos, recarga e efeitos.
4. Runtime de sigilos com colocação, detecção de alvos e disparo.
5. Equipamento/inventário e progressão persistente.
6. IA de inimigos, chefes por fases, checkpoints e recuperação de recursos.
7. HUD VEILBORNE e painel de configuração visual no editor.
8. Testes de integração e validação de desempenho.
