# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).

## Teste de API de IA

Para testar requisições de texto com um endpoint compatível com chat completions, consulte o guia [`TESTE-API-IA.md`](./TESTE-API-IA.md). Ele inclui a URI, exemplos para PowerShell e cURL e cuidados com a chave de API.

## Diagnóstico de similaridade entre rigs 3D

O script `scripts/analyze-rig-similarity.mjs` compara os ossos de um modelo de origem com os do modelo que receberá a animação. Ele analisa nomes/sinônimos, lado do corpo, hierarquia, posição relativa, profundidade e proporção dos segmentos. O relatório traz o mapeamento automático e as três melhores alternativas por osso.

Execute com Node.js 24 e as dependências instaladas:

```bash
npm ci
npm run rig:similarity -- "./modelos/origem.glb" "./modelos/destino.glb" --clip 0 --report "./relatorio-rig.md"
```

- `--clip 0`: analisa o primeiro clipe (o índice começa em zero).
- `--all-source-bones`: compara todos os ossos da origem, incluindo os que o clipe não anima.
- `--report ./relatorio-rig.md`: grava o diagnóstico em Markdown.
- `npm run rig:similarity:self-test`: testa o algoritmo com um rig sintético.

A análise funciona offline para arquivos `.glb` e `.gltf`; no `.gltf`, basta o arquivo JSON principal porque a ferramenta compara a hierarquia e os transforms dos nós. Os scores são heurísticos, não probabilidades. Revise os casos ambíguos e confirme o resultado no preview 3D antes de guardar a animação.

## Rigging adaptativo e transferência de animações

Na aba **Rig & keyframes** do importador 3D, o modo **Detectar automaticamente** analisa o nome do modelo, proporções e estrutura das malhas para sugerir um ponto de partida. Também é possível escolher manualmente:

- **Humanoide**: esqueleto inicial para personagens verticais.
- **Quadrúpede**: esqueleto inicial para cavalos e animais com membros dianteiros/traseiros.
- **Corrente genérica**: pivôs neutros em sequência, para objetos alongados ou formas sem anatomia reconhecível.
- **Por peças**: um pivô por malha estática, com pesos rígidos por peça; indicado para robôs, veículos, máquinas e modelos montados com partes separadas.

O modo por peças usa o centro aproximado de cada malha como pivô. A hierarquia original entre malhas é respeitada quando existe; quando ela não existe, o sistema tenta inferir relações pelo nome e pela proximidade. Revise e reposicione os pivôs em juntas, dobradiças ou eixos antes de criar animações.

A transferência de animações agora considera nomes e aliases anatômicos, lateralidade, ramos da hierarquia, profundidade, quantidade de filhos, posição/proporções normalizadas e orientação mundial do pai em repouso. Para nomes genéricos como `Bone.001`, usa critérios estruturais com um limiar mais conservador; em casos ambíguos, prefere não preencher automaticamente em vez de associar um osso aleatório. Assets antigos da biblioteca continuam compatíveis e usam o método anterior quando não armazenam orientação do pai.

Valide os testes locais:

```bash
npm run rig:similarity:self-test
npm run rigging:self-test
npm run build
```

**Limitação importante:** nenhum algoritmo baseado somente em heurísticas garante um rig correto para qualquer malha. O modo por peças é mais adequado a objetos realmente separados; em uma única malha orgânica sem esqueleto, a posição de juntas e os pesos são uma aproximação que exige inspeção. Rigging neural como SkinTokens/RigNet pode ser investigado futuramente como um backend opcional, mas requer distribuição de modelos/pesos e dependências próprias e não faz parte deste patch.
