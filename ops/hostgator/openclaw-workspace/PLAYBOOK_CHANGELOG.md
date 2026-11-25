# Histórico do playbook do Cristhian

## 2026.11.25.1 — Revisão segura de prospecção e follow-up

- Exige referência de identidade independente do telefone antes de qualquer
  primeiro contato prospectado.
- Usa somente o WhatsApp Web do OpenClaw para prospectar e responder. Não
  reenvia quando o resultado de entrega for incerto.
- Registra sucesso/falha confirmados pelo OpenClaw e estado incerto sem tratar
  tentativa como mensagem enviada ou presumir entrega/leitura pelo destinatário.
- Vincula a conversa ao lead após o primeiro envio confirmado e evita duplicar
  interações no CRM.
- Sinaliza pedido humano sem contar ao cliente que houve transferência e pausa
  somente a conversa correspondente.
- Reconhece confirmações naturais de reunião sem exigir frase exata.
- Registra próximos contatos como lembretes idempotentes no CRM; o lembrete não
  envia mensagem automaticamente.

## Checklist de publicação

1. Publique juntos `AGENTS.md`, `SOUL.md`, `PLAYBOOK_VERSION` e este histórico
   no workspace do agente Cristhian no OpenClaw.
2. Confira que `PLAYBOOK_VERSION` contém a mesma versão do cabeçalho de
   `AGENTS.md`.
3. Confira no MCP do DigiBusca que `schedule_lead_follow_up` e
   `request_human_review` estão permitidas.
4. Confirme que respostas e prospecção seguem pausadas até concluir a validação
   operacional de envio, identidade e persistência no CRM.
