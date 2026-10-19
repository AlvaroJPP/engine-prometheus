# VEILBORNE — A Cidadela do Último Véu

Projeto inicial pronto para abrir no Engine Prometheus. Inclui a cena, inimigos, itens coletáveis, checkpoint e instâncias de comportamento VEILBORNE. O personagem principal usa um cavaleiro 3D rigado e animado; no primeiro carregamento com internet, o GLB é baixado e armazenado na pasta do projeto.

## Como abrir
1. Atualize o repositório com `git pull origin main`.
2. Abra o Engine Prometheus e salve/feche o projeto atual.
3. Selecione **Projeto → Abrir projeto** e escolha a pasta `examples/veilborne-starter-world`.
4. Aguarde o carregamento e pressione **Executar**.

O mundo é um projeto independente. Ao salvar nele, os modelos serão guardados em `resources/models` dentro desta mesma pasta.

## Incluído
- Cavaleiro do Véu: modelo 3D rigado/animado do pacote KayKit Character Pack — Adventures (Knight.glb, licença CC0 1.0). Fonte pública usada para baixar/cachear o modelo: https://github.com/euuuuuuan/hollowmere-public/blob/main/public/models/char/Knight.glb. O GLB é armazenado em `resources/models/player-knight.glb`; depois do primeiro download bem-sucedido, o modelo fica disponível localmente.
- Inventário inicial do jogador: 3 Frascos de Vitalidade, 2 Frascos de Éter, 2 Tônicos de Vigor, 2 Bombas de Brasa e 1 Fragmento de Ecos. Pressione Tab para abrir o Arsenal do Véu.
- Sentinela das Cinzas, Espectro Errante, Oráculo do Véu e chefe Vigia Sem-Rosto, com animações, colisão, facção, IA, vida, dano, recompensas e drops.
- Perfis melee, flanker, ranged_caster e boss_phases.
- Frascos de Vitalidade/Éter/Vigor, Fragmento de Ecos e Bomba de Brasa, todos coletáveis.
- Santuário do Último Véu configurado como checkpoint e restauração de recursos.
- Arena noturna: muralhas, passarela, colunas arruinadas, círculo rúnico, braseiros, ruínas e neblina.
- Arsenal inicial, recursos, magias, sigilos e Ecos prontos para o HUD VEILBORNE.

## Controles padrão
| Tecla | Ação |
|---|---|
| WASD / Shift / Espaço | Mover / correr / pular |
| F / G | Ataque rápido / ataque pesado carregado |
| 1–4 | Feitiços |
| T / H | Selecionar / ativar sigilo |
| O / R / Y | Travar alvo / bloquear / aparo |
| E | Interagir, coletar ou ativar o santuário |
| V / X / B | Esquiva / deslize / rolamento |
| Tab | Arsenal do Véu |
| Q / C | Primeira pessoa / alternar câmera |

## Nota técnica
O Knight.glb do jogador é um personagem rigado de terceiros sob CC0 1.0 e requer internet somente no primeiro download. Se a conexão falhar, a cena mantém o GLB local de reserva para continuar abrindo. Os modelos de cenário, inimigos e itens deste exemplo continuam sendo assets low-poly locais; a IA usa perseguição direta e o combate ainda não sincroniza todas as hitboxes com os quadros das animações.
