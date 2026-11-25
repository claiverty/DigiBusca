# OpenClaw + Garimpo: implementação no DigiBusca

Este documento registra o fluxo aprovado para o Cristhian, a separação de
responsabilidades e o caminho de publicação. As alterações no repositório não
significam que a migration ou o deploy já foram aplicados.

## Fluxo de prospecção

1. A busca salva negócios cujo perfil do Google não informa um site e prepara
   uma prévia. Buscar nunca enfileira nem envia.
2. O titular escolhe os leads no DigiBusca, confere empresa, fonte, telefone e
   texto, e registra uma evidência de identidade independente do número. Nome
   exato não é obrigatório; uma referência coerente no perfil ou conversa do
   WhatsApp Web pode servir. Telefone sozinho não serve.
3. Só uma seleção revisada e liberada entra na fila. O backend valida de novo
   identidade, opt-out, conversa existente, elegibilidade sem site, status,
   limite, horário e transporte antes de autorizar o envio.
4. O OpenClaw WhatsApp Web é o único transporte de prospecção. Resultado
   incerto fica como não confirmado e nunca é reenviado automaticamente.

## Registro e CRM

- A fila separa autorização, envio confirmado, falha e resultado incerto.
- O OpenClaw confirma sucesso ou falha do envio. A integração atual não recebe
  recibos de entrega/leitura do destinatário; o DigiBusca não afirma esses
  estados.
- Após envio confirmado, a mensagem aparece no histórico da conversa; a
  conversa fica vinculada ao lead e a etapa passa a `Contatado`.
- A chave única em `lead_interactions.whatsapp_message_id` impede duplicar a
  interação CRM ao receber o mesmo evento novamente.
- Uma resposta recebida avança a etapa para `Respondeu`; não deduz etapa ou
  interesse a partir de mensagem que o lead não enviou.
- `schedule_lead_follow_up` cria um lembrete único por lead usando a coluna
  existente `saved_leads.next_follow_up`. Repetir a mesma data e ação é um
  no-op. É um lembrete para a equipe, sem envio automático de mensagem.
- `request_human_review` pausa apenas a conversa atual e registra o motivo no
  DigiBusca. O cliente não recebe aviso de transferência.

## Playbook do Cristhian

O playbook é mantido no repositório, versionado e publicado como conjunto:
`AGENTS.md`, `SOUL.md`, `PLAYBOOK_VERSION` e `PLAYBOOK_CHANGELOG.md`. A versão
em `PLAYBOOK_VERSION` precisa corresponder à indicada no cabeçalho de
`AGENTS.md`. O OpenClaw recebe somente ferramentas MCP explicitamente listadas
em `openclaw.config.example.json5`; o agente não ganha acesso a shell, arquivos,
administração do Gateway ou ferramentas de fila.

## Publicação e validação operacional

1. **Concluído em 25/11/2026:** aplicar as migrations 024 e 025 no Supabase.
   A verificação confirmou as colunas e restrições de revisão, as automações
   pausadas e nenhuma mensagem em `queued` ou `sending`. A função de follow-up
   está disponível como `SECURITY DEFINER`, executável por `service_role` e
   indisponível a `anon`.
2. Publicar backend e frontend DigiBusca pelo CI.
3. Copiar o playbook e a allowlist de ferramentas atualizados para o workspace
   do Cristhian no OpenClaw.
4. Confirmar no status MCP que respostas e prospecção estão pausadas, que o
   transporte é `OPENCLAW_WEB`, e que a migration e o Gateway estão disponíveis.
5. Fazer uma validação controlada da revisão de identidade, do registro de
   envio no histórico, do status da fila e do lembrete CRM. Não habilitar o
   envio automático antes dessas conferências.
6. Reativar respostas e prospecção manualmente só depois da validação; observar
   o primeiro envio e confirmar no WhatsApp que empresa e destinatário
   correspondem.

## Estado atual

As migrations já foram aplicadas em produção, mas as alterações de backend,
frontend e playbook ainda aguardam commit e publicação. As respostas e a
prospecção permanecem pausadas até concluir a validação controlada.
