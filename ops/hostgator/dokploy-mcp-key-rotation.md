# Rotação da chave Dokploy MCP

**Prazo:** 90 dias. **Emitida em:** 18/11/2026 às 18:45:38 UTC. **Vencimento previsto:** 16/02/2027 às 18:45:38 UTC.

## Lembretes

O agente local `DigiBot Ops` e o agente remoto têm rotinas diárias ativas às 09:00 (`America/Sao_Paulo`). A rotina remota avisa 14, 7, 3 e 1 dia antes do vencimento e no próprio dia. Ela usa somente a data e o intervalo; nunca lê nem armazena a API key. Se o OpenBot for fechado no horário, executa uma vez quando voltar.

A instância remota `digibot-ops` está online, tem acesso restrito ao MCP do Dokploy e possui a rotina ativa. A instância `digibot-whatsapp` não recebe a chave nem o endpoint MCP.

## Processo de troca

1. Um responsável cria no painel uma nova chave de 90 dias para o Member do projeto/ambiente DigiBusca.
2. Grava a chave diretamente em `/etc/digibusca/hostgator/dokploy-mcp.env`, dono `root:root`, modo `0600`. Nunca passe a chave por chat, argumentos, histórico de shell, Git ou logs.
3. Atualiza `issued_at` no arquivo de metadados privado, sem gravar valor, prefixo ou trecho da chave.
4. Valida a consulta de API e o MCP com a chave nova.
5. Revoga a chave antiga somente depois de validar a nova.

O agente pode alertar e orientar, mas não deve criar ou revogar chaves de Owner. A troca exige ação de um responsável. Nunca envie a chave para um modelo, conversa do OpenBot, arquivo compartilhado ou log.

## Metadados seguros

O arquivo privado `dokploy-mcp-rotation-metadata.json` contém somente valores de data/prazo, por exemplo:

```json
{
  "schema_version": 1,
  "rotation_interval_days": 90,
  "issued_at": "2026-11-18T18:45:38.153605+00:00"
}
```

O exemplo versionado fica em `dokploy-mcp-rotation-metadata.example.json`; nunca adicione a cópia privada ao Git.
