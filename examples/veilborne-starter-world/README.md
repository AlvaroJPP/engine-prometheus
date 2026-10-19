# VEILBORNE — A Cidadela do Último Véu

Projeto inicial pronto para abrir no Engine Prometheus. Inclui uma cena de fantasia sombria com modelos 3D rigados, inimigos com silhuetas distintas, itens coletáveis, checkpoint e instâncias de comportamento VEILBORNE. Na primeira abertura com internet, os GLBs são baixados e guardados em `resources/models`; depois disso, os modelos ficam disponíveis localmente.

## Como abrir
1. Atualize o repositório com `git pull origin main`.
2. Abra o Engine Prometheus e salve/feche o projeto atual.
3. Selecione **Projeto → Abrir projeto** e escolha a pasta `examples/veilborne-starter-world`.
4. Aguarde o carregamento e pressione **Executar**.

O mundo é um projeto independente. Ao salvar nele, os modelos serão guardados em `resources/models` dentro desta mesma pasta.

## Incluído
- Cavaleiro do Véu: modelo 3D rigado e animado `Knight.glb`, do KayKit Character Pack: Adventures 1.0 (CC0 1.0). Fonte: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0.
- NPCs com modelos específicos: `Skeleton_Warrior.glb` para a Sentinela, `Skeleton_Rogue.glb` para o Espectro, `Skeleton_Mage.glb` para o Oráculo e `Barbarian.glb` para o chefe. Os três esqueletos vêm do KayKit Character Pack: Skeletons 1.0 (CC0 1.0): https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0.
- Se algum download falhar, o Engine mantém os GLBs locais de reserva e tenta novamente na próxima abertura quando o endereço de origem continuar registrado.
- Inventário inicial do jogador: 3 Frascos de Vitalidade, 2 Frascos de Éter, 2 Tônicos de Vigor, 2 Bombas de Brasa e 1 Fragmento de Ecos. Pressione Tab para abrir o Arsenal do Véu.
- Sentinela das Cinzas, Espectro Errante, Oráculo do Véu e chefe Vigia Sem-Rosto, com animações, colisão, facção, IA, vida, dano, recompensas e drops.
- Perfis melee, flanker, ranged_caster e boss_phases.
- Frascos de Vitalidade/Éter/Vigor, Fragmento de Ecos e Bomba de Brasa, todos coletáveis.
- Santuário do Último Véu configurado como checkpoint e restauração de recursos.
- Arena noturna ampliada: muralhas, portão monumental com estandartes, contrafortes, escadarias rituais, túmulos de pedra, obelisco do Véu, passarela, colunas arruinadas, círculo rúnico, braseiros, ruínas e neblina.
- Arsenal inicial, recursos, magias, sigilos e Ecos prontos para o HUD VEILBORNE.

## Controles padrão
| Tecla | Ação |
|---|---|
| WASD / Shift / Espaço | Mover / correr / pular |
| Clique esquerdo ou F / G (segurar) | Ataque rápido / ataque pesado carregado |
| 1–4 | Feitiços |
| T / H | Selecionar / ativar sigilo |
| O / R / Y | Travar alvo / bloquear / aparo |
| E | Interagir, coletar ou ativar o santuário |
| V / X / B | Esquiva / deslize / rolamento |
| Tab | Arsenal do Véu |
| Q / C | Primeira pessoa / alternar câmera |

## Nota técnica
Os personagens KayKit são assets low-poly rigados sob CC0 1.0. Os modelos externos são validados como GLB (assinatura e limite de 30 MB) antes de serem gravados no projeto. Os modelos de cenário e itens continuam sendo assets locais; a IA usa perseguição direta e o combate ainda não sincroniza todas as hitboxes com os quadros das animações.
