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
- `GET /api/whatsapp/connections`: lista metadados das conexões WhatsApp do usuário autenticado; não retorna tokens.
- `POST /api/whatsapp/connections/embedded-signup`: troca o código temporário do Meta Embedded Signup no servidor e associa o token cifrado e o número à conta autenticada.
- `GET /api/whatsapp/conversations` e `GET /api/whatsapp/conversations/:id/messages`: lista a caixa de entrada isolada por usuário.
- `GET|POST /api/webhooks/whatsapp`: valida o desafio/HMAC e persiste mensagens, status e eventos de coexistência.
- `GET /api/sales`: lista o histórico de vendas.
- `POST /api/sales`: registra uma venda manual ou vinculada a um lead.
- `PATCH /api/sales/:id`: corrige comércio, serviço, valor ou data de uma venda do usuário.
- `DELETE /api/sales/:id`: exclui uma venda do usuário.

Todas as rotas de negócio exigem um token Bearer do Supabase Auth. O backend valida o token e executa as consultas com o contexto do usuário; o PostgreSQL aplica RLS para impedir acesso cruzado entre contas.

As integrações ficam isoladas em adaptadores. A chave do Google Places e a chave do Gemini são lidas apenas do ambiente do backend. As migrations versionadas em `supabase/migrations/` definem tabelas, índices, permissões e políticas de acesso.

A ponte com OpenBot roda apenas no servidor local da máquina onde o OpenBot está aberto. Ela lê a URL e o token temporário do diretório de automação do próprio OpenBot, mantém esse token fora do navegador e escuta somente em `127.0.0.1`. Configure `DIGIBUSCA_APP_ORIGINS` para autorizar a origem publicada do DigiBusca, quando necessário.
