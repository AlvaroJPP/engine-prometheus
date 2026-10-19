# VEILBORNE — A Cidadela do Último Véu

Projeto inicial pronto para abrir no Engine Prometheus. A pasta inclui uma cena, modelos GLB locais com clipes de animação, inimigos, itens coletáveis, checkpoint e instâncias de comportamento VEILBORNE já configuradas.

## Como abrir
1. Atualize o repositório com `git pull origin main`.
2. Abra o Engine Prometheus e salve/feche o projeto atual.
3. Selecione **Projeto → Abrir projeto** e escolha a pasta `examples/veilborne-starter-world`.
4. Aguarde o carregamento e pressione **Executar**.

O mundo é um projeto independente. Ao salvar nele, os modelos serão guardados em `resources/models` dentro desta mesma pasta.

## Incluído
- Cavaleiro do Véu com Idle, Walk, Run, PrimaryAction, Jump e Death.
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
Os modelos deste pacote são assets low-poly gerados para o exemplo, sem chamadas a servidores externos. As animações usam trilhas glTF de nós; são protótipos visuais sem rig skinned. A IA ainda usa perseguição direta e o combate não sincroniza todas as hitboxes com os quadros das animações.
