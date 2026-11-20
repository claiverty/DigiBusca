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
- `GET /api/whatsapp/prospecting`: retorna configurações, uso do limite diário, fila e chat da campanha do dia.
- `POST /api/whatsapp/prospecting/campaign`: pesquisa a cidade escolhida no chat, salva até três páginas de resultados e enfileira novos contatos elegíveis dentro da capacidade diária disponível.
- `POST /api/whatsapp/prospecting/settings`: ativa/pausa a fila e define o limite de 17 a 25 novos leads por dia.
- `POST /api/whatsapp/prospecting/queue`: agenda um primeiro contato de um lead salvo com consentimento registrado. No horário de envio, a fila confirma pela Evolution se o telefone está registrado no WhatsApp; telefones sem conta são ignorados e identificados no painel.
- `DELETE /api/whatsapp/prospecting/queue/:id`: cancela um item ainda não enviado.

Todas as rotas de negócio exigem um token Bearer do Supabase Auth. O backend valida o token e executa as consultas com o contexto do usuário; o PostgreSQL aplica RLS para impedir acesso cruzado entre contas.

## Evolution API: candidata local para pareamento QR

A release estável mais recente da Evolution é `v2.3.7`, mas ela fixa Baileys `7.0.0-rc.9`, afetado pelo [advisory crítico de mensagens falsificadas](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg). A `2.4.0` ainda está em pré-release e a linha `develop` usa Baileys `rc13`, que não reconhece a etapa `companion_reg_refresh` enviada pelo WhatsApp durante o pareamento. Por isso o QR pode ser exibido e ainda assim falhar depois da leitura.

O script prepara uma candidata baseada no branch aberto [Evolution PR #2759](https://github.com/evolution-foundation/evolution-api/pull/2759), fixado no commit `d0198733da3cb133bd0c64d24fc4d1e7720696b1`. Ele atualiza Baileys para `7.0.0-rc14` (corrigido para o advisory), inclui o patch de QR do [PR #2727](https://github.com/evolution-foundation/evolution-api/pull/2727) e uma proteção para ACKs antes do login do [Baileys PR #2749](https://github.com/WhiskeySockets/Baileys/pull/2749). Esses patches ainda não fazem parte de uma release oficial; a imagem permanece uma candidata local para validação.

Estas instruções descrevem apenas o ambiente local de desenvolvimento. O Compose só inicia com o perfil explícito `evolution-candidate`. A API publica apenas `127.0.0.1:8081`; o webhook não publica porta no host. Evolution e webhook compartilham uma rede de aplicação; o PostgreSQL fica em uma rede interna separada e não tem porta no host. Os volumes do candidato são isolados dos dados Evolution existentes. A coleta de histórico importado fica desligada.

Prepare os arquivos locais sem substituir segredos existentes:

```sh
[ -f backend/.env ] || cp backend/.env.example backend/.env
[ -f evolution/.env ] || cp evolution/.env.example evolution/.env
```

Preencha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` em `backend/.env`; defina `EVOLUTION_API_KEY` igual a `AUTHENTICATION_API_KEY` em `evolution/.env`. Use segredos fortes e diferentes para `AUTHENTICATION_API_KEY`, `POSTGRES_PASSWORD` e `EVOLUTION_WEBHOOK_SECRET`. Em `backend/.env`, habilite `WHATSAPP_INTEGRATION_ENABLED=true` para abrir as rotas de conexão. Neste ambiente local, o agendador roda no servidor de desenvolvimento; o serviço Docker `digibusca-webhook` recebe e persiste webhooks com os runtimes desligados, evitando dois processos concorrendo pela mesma mensagem. Respostas só saem com o perfil aprovado e ativo; novos contatos só saem quando a fila estiver ativa e cada lead elegível entrar nela com consentimento registrado. Os controles de perfil e fila começam desligados.

Compile a imagem fixada e valide a configuração:

```sh
sh scripts/build-evolution-candidate.sh
docker compose --project-name digibusca-evolution-candidate --env-file backend/.env --env-file evolution/.env -f docker-compose.evolution.yml --profile evolution-candidate config --quiet
docker compose --project-name digibusca-evolution-candidate --env-file backend/.env --env-file evolution/.env -f docker-compose.evolution.yml --profile evolution-candidate build digibusca-webhook
```

O healthcheck do webhook consulta o Supabase e exige as tabelas de conexão, conversa e mensagem das migrations `009_whatsapp_webhook.sql` e `010_whatsapp_coexistence.sql`; a Evolution só inicia depois dessa checagem passar. A rota `/api/whatsapp/status` também bloqueia a geração do QR se a persistência ainda não estiver pronta. No ambiente local, o backend usa `127.0.0.1:3001`. A configuração da VPS e do túnel fica em [ops/hostgator/README.md](../ops/hostgator/README.md); o Worker encaminha somente as rotas de WhatsApp e OpenBot para o hostname configurado. O webhook interno da Evolution continua na rede privada de serviços. A campanha diária usa a migration `020_whatsapp_daily_prospecting_chat.sql`.

Depois do pareamento, perfis de resposta e fila de prospecção começam desativados. O perfil começa em `handoff_only`; nesse modo, a conversa fica para atendimento humano. O modo `openbot` envia ao agente Cristhian o histórico recente sanitizado e uma instrução estruturada; o backend valida a resposta, aplica as regras de segurança e controla o envio pela Evolution. `Local scripts` precisa estar habilitado especificamente no agente Cristhian. O modo `gemini` é separado: não existe fallback automático entre Gemini e OpenBot. Preço, prazo, desconto, contrato e pagamento só podem ser informados se estiverem no conteúdo aprovado; caso contrário, o sistema sinaliza atendimento humano sem anunciar a transferência ao contato. Aplique as migrations de WhatsApp até `016_whatsapp_openbot_replies.sql`; a migration `015_whatsapp_automation_response_mode_safety_reset.sql` desativa perfis existentes e limpa a aprovação antiga do conteúdo. Antes de ativar qualquer perfil, revise conteúdo e canal na interface e valide o fluxo com números de teste.

As integrações ficam isoladas em adaptadores. A chave do Google Places e a chave do Gemini são lidas apenas do ambiente do backend. As migrations versionadas em `supabase/migrations/` definem tabelas, índices, permissões e políticas de acesso.

A API local escuta em `127.0.0.1` por padrão. Neste ambiente de desenvolvimento, mantenha o processo no loopback; o webhook usa o serviço interno do Compose, cuja porta não é publicada no host.
