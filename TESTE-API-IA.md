# Testar requisições para uma API de IA

Este guia registra um endpoint simples para experimentar requisições de texto no Engine Prometheus. Ele usa a API compatível com chat completions do OpenRouter e o roteador `openrouter/free`, que seleciona um modelo gratuito elegível quando houver disponibilidade.

## URI recomendada

- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions`
- **Método:** `POST`
- **Autenticação:** `Authorization: Bearer SUA_CHAVE`
- **Modelo de teste:** `openrouter/free`
- **Criar/consultar chave:** https://openrouter.ai/settings/keys
- **Documentação oficial:** https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- **Catálogo de modelos:** https://openrouter.ai/models

O roteador gratuito pode mudar o modelo usado e está sujeito a limites de uso e disponibilidade do serviço. Confira as condições atuais na documentação e no painel da sua conta.

## Teste rápido no PowerShell (Windows)

1. Crie uma chave no painel do OpenRouter.
2. No terminal, guarde-a apenas na sessão atual do PowerShell:

```powershell
$env:OPENROUTER_API_KEY = "COLE_SUA_CHAVE_AQUI"
```

3. Envie uma requisição:

```powershell
$headers = @{
  Authorization = "Bearer $env:OPENROUTER_API_KEY"
}

$body = @{
  model = "openrouter/free"
  messages = @(
    @{
      role = "system"
      content = "Responda em português de forma objetiva."
    },
    @{
      role = "user"
      content = "Sugira três melhorias de desempenho para um editor 3D feito com Three.js."
    }
  )
  max_tokens = 300
} | ConvertTo-Json -Depth 8

$response = Invoke-RestMethod `
  -Uri "https://openrouter.ai/api/v1/chat/completions" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body

$response.choices[0].message.content
```

Se a resposta aparecer no terminal, a requisição e a autenticação funcionaram. Para ver o objeto retornado inteiro, execute:

```powershell
$response | ConvertTo-Json -Depth 12
```

## Teste com cURL

No Bash, Git Bash ou terminal com cURL instalado:

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/free",
    "messages": [
      {
        "role": "system",
        "content": "Responda em português de forma objetiva."
      },
      {
        "role": "user",
        "content": "Responda apenas: API de IA funcionando."
      }
    ],
    "max_tokens": 100
  }'
```

Antes de executar o cURL, defina a variável `OPENROUTER_API_KEY` no terminal.

## Resposta esperada

O endpoint usa o formato Chat Completions. O texto gerado costuma estar em:

```text
choices[0].message.content
```

A resposta completa também traz metadados do modelo e do uso.

## Erros comuns

- **401 Unauthorized:** chave ausente, inválida ou revogada.
- **402 / limite de crédito:** confira saldo, condições da conta e do modelo selecionado.
- **429 Too Many Requests:** limite de requisições; aguarde ou confira os limites do roteador e da conta.
- **Erro 5xx:** falha temporária do provedor ou do roteamento; tente novamente mais tarde.

Os códigos e limites exatos dependem do estado atual do serviço.

## Cuidados com a chave

- Não grave chaves reais em arquivos Markdown, no Git, em `.env` versionado ou no código.
- Não coloque uma chave em variáveis `VITE_*`: elas são incorporadas ao código enviado ao frontend.
- Use o exemplo acima apenas para testes locais. Se a integração for adicionada ao Engine Prometheus, mantenha o segredo em um backend/proxy confiável ou em um armazenamento seguro apropriado ao aplicativo desktop.
- Não envie dados pessoais ou segredos nos prompts de teste.
