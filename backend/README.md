# Backend

API TypeScript responsável pela autenticação, regras de negócio, integrações e persistência do DigiBusca.

## Organização

- `src/contracts/`: contratos de entrada e saída.
- `src/application/`: casos de uso que coordenam as operações.
- `src/domain/`: regras de qualificação e geração de abordagem.
- `src/data/`: persistência no Supabase e armazenamento auxiliar.
- `src/integrations/`: adaptadores para serviços externos.
- `src/http/`: servidor local e Worker da API.

## Rotas principais

- `GET /api/health`: verifica se a API está disponível.
- `GET /api/leads?city={cidade}&segment={segmento}`: busca negócios pelo Google Places.
- `GET /api/saved-leads`: lista os leads salvos da conta autenticada.
- `GET /api/saved-leads/:id`: atualiza os dados de um lead salvo apenas quando ele é aberto.
- `POST /api/leads/:id/save`: salva um lead encontrado.
- `DELETE /api/leads/:id/save`: remove um lead salvo.
- `PATCH /api/leads/:id`: atualiza status, observações, follow-up e rascunho da abordagem.
- `GET /api/leads/:id/interactions`: lista o histórico de interações de um lead.
- `POST /api/leads/:id/interactions`: registra canal, data, observação e resultado de um contato.
- `GET /api/openbot/agents`: lista os agentes do OpenBot com `Local scripts` ativo no computador local.
- `POST /api/openbot/outreach`: solicita ao agente selecionado um rascunho de abordagem, sem enviar mensagens ao lead.
- `POST /api/openbot/agents/:agentId/deliveries/:deliveryId`: consulta e valida o resultado de um rascunho em andamento.
- `GET /api/sales`: lista o histórico de vendas.
- `POST /api/sales`: registra uma venda manual ou vinculada a um lead.
- `PATCH /api/sales/:id`: corrige comércio, serviço, valor ou data de uma venda do usuário.
- `DELETE /api/sales/:id`: exclui uma venda do usuário.
- `GET /api/whatsapp/prospecting`: retorna configurações, uso do limite diário e fila de novos contatos da conta autenticada.
- `POST /api/whatsapp/prospecting/settings`: ativa/pausa a fila e define o limite de 17 a 25 novos leads por dia.
- `POST /api/whatsapp/prospecting/queue`: agenda um primeiro contato de um lead salvo com consentimento registrado.
- `DELETE /api/whatsapp/prospecting/queue/:id`: cancela um item ainda não enviado.

Todas as rotas de negócio exigem um token Bearer do Supabase Auth. O backend valida o token e executa as consultas com o contexto do usuário; o PostgreSQL aplica RLS para impedir acesso cruzado entre contas.

## Evolution API: candidata local para pareamento QR

A release estável mais recente da Evolution é `v2.3.7`, mas ela fixa Baileys `7.0.0-rc.9`, afetado pelo [advisory crítico de mensagens falsificadas](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg). A `2.4.0` ainda está em pré-release e a linha `develop` usa Baileys `rc13`, que não reconhece a etapa `companion_reg_refresh` enviada pelo WhatsApp durante o pareamento. Por isso o QR pode ser exibido e ainda assim falhar depois da leitura.

O script prepara uma candidata baseada no branch aberto [Evolution PR #2759](https://github.com/evolution-foundation/evolution-api/pull/2759), fixado no commit `d0198733da3cb133bd0c64d24fc4d1e7720696b1`. Ele atualiza Baileys para `7.0.0-rc14` (corrigido para o advisory), inclui o patch de QR do [PR #2727](https://github.com/evolution-foundation/evolution-api/pull/2727) e uma proteção para ACKs antes do login do [Baileys PR #2749](https://github.com/WhiskeySockets/Baileys/pull/2749). Esses patches ainda não fazem parte de uma release oficial; a imagem permanece uma candidata local para validação.

O Compose só inicia com o perfil explícito `evolution-candidate`. A API publica apenas `127.0.0.1:8081`; o webhook não publica porta no Mac. Evolution e webhook compartilham uma rede de aplicação; o PostgreSQL fica em uma rede interna separada e não tem porta no host. Os volumes do candidato são isolados dos dados Evolution existentes. A coleta de histórico importado fica desligada.

Prepare os arquivos locais sem substituir segredos existentes:

```sh
[ -f backend/.env ] || cp backend/.env.example backend/.env
[ -f evolution/.env ] || cp evolution/.env.example evolution/.env
```

Preencha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` em `backend/.env`; defina `EVOLUTION_API_KEY` igual a `AUTHENTICATION_API_KEY` em `evolution/.env`. Use segredos fortes e diferentes para `AUTHENTICATION_API_KEY`, `POSTGRES_PASSWORD` e `EVOLUTION_WEBHOOK_SECRET`. Em `backend/.env`, habilite `WHATSAPP_INTEGRATION_ENABLED=true` para abrir as rotas de conexão. Os runtimes locais podem ficar ligados para liberar os controles na tela: respostas só saem com o perfil aprovado e ativo; novos contatos só saem quando a fila estiver ativa e cada lead elegível entrar nela com autorização registrada. Os controles de perfil e fila começam desligados.

Compile a imagem fixada e valide a configuração:

```sh
sh scripts/build-evolution-candidate.sh
docker compose --project-name digibusca-evolution-candidate --env-file backend/.env --env-file evolution/.env -f docker-compose.evolution.yml --profile evolution-candidate config --quiet
docker compose --project-name digibusca-evolution-candidate --env-file backend/.env --env-file evolution/.env -f docker-compose.evolution.yml --profile evolution-candidate build digibusca-webhook
```

O healthcheck do webhook consulta o Supabase e exige as tabelas de conexão, conversa e mensagem das migrations `009_whatsapp_webhook.sql` e `010_whatsapp_coexistence.sql`; a Evolution só inicia depois dessa checagem passar. A rota local `/api/whatsapp/status` também bloqueia a geração do QR se a persistência ainda não estiver pronta. O backend no Mac continua em `127.0.0.1:3001`; o webhook interno usa `0.0.0.0` somente dentro da rede Docker.

Depois do pareamento, perfis de resposta e fila de prospecção começam desativados. O perfil de atendimento começa em `handoff_only`: a mensagem recebida não é enviada ao Gemini, o contato recebe um aviso de recebimento e a conversa fica pausada para atendimento humano. O modo `gemini` só deve ser selecionado quando o conteúdo estiver revisado e aprovado; nessa opção, as mensagens recentes são enviadas ao Gemini para gerar respostas. O atendimento não tem tabela de preços configurada: pedidos sobre preço, prazo, desconto, contrato ou pagamento vão para encaminhamento humano. Aplique as migrations `011_whatsapp_reply_automation.sql`, `014_whatsapp_automation_response_mode.sql` e `015_whatsapp_automation_response_mode_safety_reset.sql`; a última desativa perfis existentes e limpa a aprovação antiga do conteúdo. Antes de ativar qualquer perfil, revise as aprovações na tela e valide o fluxo com números de teste.

As integrações ficam isoladas em adaptadores. A chave do Google Places e a chave do Gemini são lidas apenas do ambiente do backend. As migrations versionadas em `supabase/migrations/` definem tabelas, índices, permissões e políticas de acesso.

A API local escuta em `127.0.0.1` por padrão. Não configure `HOST=0.0.0.0` no processo do Mac: o webhook usa o serviço interno do Compose, cuja porta não é publicada no host.
