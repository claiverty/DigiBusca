# OpenClaw + Garimpo: implementação no DigiBusca

Este documento registra o fluxo aprovado para o Cristhian e o estado real da
implementação em produção em 25/11/2026. Backend, frontend, migrations e
playbook foram publicados; as respostas e a prospecção permanecem pausadas até
um teste controlado de ponta a ponta.

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

1. **Concluído em 25/11/2026:** aplicar as migrations 024, 025 e 026 no Supabase.
   A verificação confirmou que a rotina transacional
   `settle_openclaw_prospecting_delivery` existe como `SECURITY DEFINER`, só é
   executável por `service_role`, e rejeita chamadas sem item autorizado. As
   respostas e a prospecção continuam pausadas; não há itens `queued` ou
   `sending`.
2. **Concluído em 25/11/2026:** o CI publicou backend, frontend e Worker na
   revisão `3f80c9e`. Build, segurança, 71 testes unitários e 42 testes E2E
   passaram; os endpoints de saúde do backend e Worker retornaram HTTP 200.
   A revisão com a liquidação atômica será publicada pelo CI após os checks
   desta alteração.
3. **Concluído em 25/11/2026:** playbook, extensão `digibusca-sync` e allowlist
   foram sincronizados na VPS. O Gateway validou a configuração, carregou a
   extensão e conectou ao MCP; a sondagem listou as dez ferramentas permitidas
   pelo `openclaw.config.example.json5`, sem `queue_prospect`.
4. A confirmação do OpenClaw agora é preparada para gravar, numa única
   transação, o resultado da fila, a mensagem, a conversa, a etapa do lead e a
   interação do CRM. Eventos repetidos não duplicam o histórico. Confirmações
   atrasadas podem reconciliar um resultado incerto ou uma falha correspondente
   ao mesmo ID; ausência de confirmação continua como `unknown` e não dispara
   reenvio automático. O hook tenta reenviar ao backend apenas erros de rede,
   HTTP 429 ou 5xx, com três tentativas curtas.
5. **Pendente:** sincronizar a extensão atualizada na VPS e reiniciar somente o
   Gateway para carregá-la; depois confirmar saúde do backend/Gateway e que os
   interruptores permanecem pausados.
6. **Pendente:** fazer uma validação controlada da revisão de identidade, do
   registro no histórico, do status da fila e do lembrete CRM com um contato de
   teste indicado pelo titular. Não enviar para um lead real durante esse teste.
7. Reativar respostas e prospecção manualmente só depois da validação; revisar
   o primeiro envio antes de liberar novos contatos.

## Estado atual

As migrations 024/025/026 estão aplicadas; o commit `3f80c9e`, o backend, o
frontend, o Worker e o playbook/extensão do OpenClaw estão publicados. A
liquidação transacional e as tentativas curtas de sincronização fazem parte da
revisão que está passando pelo processo de publicação. A conexão WhatsApp do
Gateway e as dez ferramentas MCP foram verificadas. Respostas e prospecção
seguem pausadas, sem itens `queued` ou `sending`, até sincronizar essa revisão e
concluir o teste controlado.
