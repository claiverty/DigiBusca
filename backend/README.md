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

## WhatsApp pela Evolution API no Mac

O DigiBusca usa a Evolution API com a integração `WHATSAPP-BAILEYS` (WhatsApp Web). A conexão é pareada na tela **WhatsApp → Conexão** por QR Code. As mensagens e respostas recebidas chegam ao backend local pelo webhook autenticado; o Worker remoto não recebe nem envia mensagens do WhatsApp.

1. Inicie o Docker Desktop ou o Colima no Mac (`colima start`); a configuração deste projeto usa o Docker CLI.
2. Copie `evolution/.env.example` para `evolution/.env` e defina `AUTHENTICATION_API_KEY` com uma chave forte.
3. Use a mesma chave como `EVOLUTION_API_KEY` em `backend/.env`. Configure também `EVOLUTION_API_URL=http://127.0.0.1:8080`, `EVOLUTION_WEBHOOK_SECRET` com outro segredo aleatório de no mínimo 32 bytes (`openssl rand -hex 32`) e `EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3001/api/webhooks/evolution`. O backend só aceita HTTP para endereços de loopback; use HTTPS para uma Evolution remota.
4. Defina `HOST=0.0.0.0` e `PORT=3001` para o container alcançar o webhook local. Isso faz o backend escutar em todas as interfaces do Mac: mantenha o firewall do macOS ativo e não encaminhe a porta 3001 no roteador. As rotas de negócio exigem sessão autenticada; o webhook rejeita segredo abaixo de 32 bytes.
5. Inicie a Evolution com `docker compose -f docker-compose.evolution.yml up -d`.
6. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` em `backend/.env`; o service role é necessário para persistir mensagens recebidas.
7. Aplique as migrations `008_whatsapp_cloud_consent.sql` a `013_whatsapp_prospecting_queue.sql` no Supabase. Inicie o backend e o frontend, abra **WhatsApp → Conexão** e leia o QR pelo WhatsApp no celular em **Aparelhos conectados → Conectar aparelho**.

A configuração local deixa `WHATSAPP_AUTOMATION_RUNTIME_ENABLED=false` e `WHATSAPP_PROSPECTING_RUNTIME_ENABLED=false`. Depois de conectar, aprove as regras e o conteúdo na tela. Para respostas Gemini, habilite o primeiro interruptor; para novos contatos, habilite o segundo e a fila na interface. A fila aceita apenas leads salvos com consentimento explícito registrado, telefone válido e status `Novo`. O banco reserva o limite de 17–25 por dia de forma atômica e distribui novos contatos de segunda a sexta, das 9h às 18h, no fuso de São Paulo, com intervalos de 18 a 23 minutos. Respostas de conversas existentes não consomem esse limite. Falhas com resultado incerto não são reenviadas automaticamente; confira a conversa antes de tentar de novo.

A Evolution e o PostgreSQL local são iniciados pelo Compose em modo standalone conforme o [guia Docker oficial](https://docs.evolutionfoundation.com.br/evolution-api/install/docker). A chave do PostgreSQL fica em `evolution/.env` e os dados persistem no volume `evolution_database`. Se o backend local estiver ligado a outra origem, inclua a origem exata em `DIGIBUSCA_APP_ORIGINS`. O backend mantém `127.0.0.1` como host padrão; `HOST=0.0.0.0` é necessário para o webhook do container Docker no Mac.

As integrações ficam isoladas em adaptadores. A chave do Google Places e a chave do Gemini são lidas apenas do ambiente do backend. As migrations versionadas em `supabase/migrations/` definem tabelas, índices, permissões e políticas de acesso.

A API local escuta em `127.0.0.1` por padrão. Para receber o webhook enviado pelo container Evolution no Mac, configure `HOST=0.0.0.0`; inclua as origens exatas em `DIGIBUSCA_APP_ORIGINS` para permitir que o navegador alcance o backend local. O controle privado de rede do navegador pode pedir autorização para essa conexão.
