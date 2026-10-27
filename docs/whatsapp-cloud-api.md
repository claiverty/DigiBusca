# WhatsApp Cloud API

O DigiBusca envia um template pela Cloud API somente após uma ação manual na tela do lead. O lead precisa estar salvo e a autorização explícita para receber mensagens precisa estar registrada, com a origem informada. Leads marcados como “Pediu para não receber” ficam bloqueados. A integração não faz disparos em lote nem envia mensagens automaticamente.

Um telefone publicado no Google não comprova autorização. Registre “Autorizou receber mensagens” apenas quando a pessoa tiver concordado em receber mensagens pelo WhatsApp naquele número. A política do WhatsApp exige essa autorização e um template aprovado para iniciar uma conversa pela API.

## Configuração

1. Para coexistência, use o fluxo **WhatsApp Business App onboarding** no Embedded Signup. Ele mantém o número ativo no app do telefone e também o conecta à Cloud API.
2. Crie e obtenha aprovação para um template de marketing em português (`pt_BR`) com um parâmetro de texto no corpo. O DigiBusca envia o conteúdo editado no campo de abordagem como esse parâmetro; o texto precisa se encaixar no template que foi aprovado.
3. Configure no backend os valores abaixo. Não coloque o token em variáveis `VITE_`, no frontend ou no Git.

```dotenv
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_GRAPH_API_VERSION=vXX.X
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
META_APP_ID=
WHATSAPP_TOKEN_ENCRYPTION_KEY=
```

Para o Embedded Signup, o `META_APP_ID` precisa corresponder ao `VITE_META_APP_ID`. `WHATSAPP_TOKEN_ENCRYPTION_KEY` é uma chave AES-256 em Base64 que decodifica para 32 bytes; ela fica apenas no servidor e cifra o token antes de gravá-lo no Supabase. No ambiente local, os nomes com prefixo `VITE_` ficam em `frontend/.env` e os valores privados ficam em `backend/.env` (ambos ignorados pelo Git). Esta alteração só adiciona exemplos vazios; não cria nem lê credenciais.

O frontend usa `VITE_META_APP_ID`, `VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` e `VITE_WHATSAPP_GRAPH_API_VERSION`. O App ID e o ID da configuração de login são identificadores públicos. Sem `VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, a página mostra que a configuração está pendente e mantém o botão desativado.

O backend troca o código temporário retornado pelo SDK da Meta, valida que o WABA informado contém um número marcado por Meta como ativo no WhatsApp Business App, cifra o token com AES-GCM e associa número, WABA e token ao usuário autenticado. Respostas para o navegador contêm somente os metadados públicos da conexão. A migration `010_whatsapp_coexistence.sql` remove o SELECT de `authenticated` da tabela de conexões e cria a tabela privada de contatos sincronizados. **Não aplique migrations sem a autorização para alterar o Supabase.**

## Uso

No detalhe do lead, salve o lead, registre a origem do consentimento, ajuste a mensagem ao template aprovado e clique em **Enviar pela API oficial**. O envio é individual e autenticado; há um limitador básico contra cliques repetidos. A resposta confirma que a API aceitou a mensagem, mas não garante entrega. O DigiBusca tenta salvar o ID da mensagem no histórico de interações.

Para parar contatos futuros, marque **Pediu para não receber** e salve as alterações. Isso bloqueia envios pela Cloud API no DigiBusca.

## Webhook de mensagens e status

O backend recebe eventos em `GET` e `POST /api/webhooks/whatsapp`. O `GET` responde ao desafio da Meta somente quando `hub.mode=subscribe` e `hub.verify_token` coincide com `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. No `POST`, o backend valida `X-Hub-Signature-256` com HMAC SHA-256 sobre os bytes originais do corpo e `WHATSAPP_APP_SECRET`, antes de interpretar o JSON. Corpos maiores que 1 MB são recusados.

Mensagens recebidas, ecos enviados pelo app (`smb_message_echoes`), mensagens incluídas nos chunks de histórico (`history`) e eventos `sent`, `delivered`, `read` e `failed` são gravados de forma idempotente pelo ID do provedor. Mensagens do app e do histórico mantêm a direção de saída; mensagens recebidas e status continuam usando as chaves únicas atuais. Mensagens de texto guardam o corpo; outros tipos guardam o tipo e os identificadores, sem baixar mídia. Um status pode criar um registro de mensagem de saída sem conteúdo até que o texto esteja disponível por outra integração. Contatos e ações `add`/`remove` de `smb_app_state_sync` são guardados no backend e usados para nomear conversas. Eventos de um `phone_number_id` sem vínculo configurado são aceitos sem persistência para evitar retries e associação automática a uma conta.

As rotas autenticadas `GET /api/whatsapp/conversations?limit=50&before=<cursor>` e `GET /api/whatsapp/conversations/:id/messages?limit=50&before=<cursor>` retornam `{ "data": [...], "nextCursor": "..." }` com páginas de até 100 registros. O cursor opaco da resposta pode ser enviado novamente no parâmetro `before`; quando não houver outra página, `nextCursor` não é incluído. Ambas as consultas aplicam o ID do usuário autenticado no backend e contam também com RLS no Supabase; uma conversa de outra conta responde como não encontrada.

`GET /api/whatsapp/connections` lista apenas as conexões do usuário autenticado. `POST /api/whatsapp/connections/embedded-signup` recebe o código temporário e os IDs do evento da Meta, troca o código no servidor e nunca retorna o token. A tabela `whatsapp_phone_number_connections` não concede SELECT a `anon` ou `authenticated`; a UI não consulta nem grava credenciais diretamente pelo Supabase.

### Preparar o ambiente

1. Aplique `supabase/migrations/009_whatsapp_webhook.sql` e depois `supabase/migrations/010_whatsapp_coexistence.sql` no projeto Supabase escolhido. A migration 010 não foi aplicada nesta alteração.
2. Configure o runtime backend com `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_GRAPH_API_VERSION` e `WHATSAPP_TOKEN_ENCRYPTION_KEY`. A chave service role e os segredos ficam exclusivamente no servidor.
3. Em `frontend/.env`, configure os três valores públicos `VITE_META_APP_ID`, `VITE_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` e `VITE_WHATSAPP_GRAPH_API_VERSION`; reinicie o Vite após alterações.
4. Na configuração Meta do app, finalize a verificação da empresa, o acesso de Tech Provider, a configuração do Facebook Login for Business e o Embedded Signup com o recurso **WhatsApp Business App onboarding**. Cadastre o domínio HTTPS real do DigiBusca como domínio permitido. Para produção, conclua App Review, Advanced Access/Access Verification e a liberação de integridade exigida pela Meta.
5. Após uma implantação HTTPS autorizada, configure o callback `/api/webhooks/whatsapp`, verifique-o com `WHATSAPP_WEBHOOK_VERIFY_TOKEN` e assine os campos `messages`, `smb_message_echoes`, `history` e `smb_app_state_sync`. O backend local escuta em `127.0.0.1` e não recebe callbacks da Meta pela Internet.
6. O código atual recebe e persiste eventos de histórico e contatos, mas não solicita a sincronização inicial à Meta. Após a conexão, falta iniciar a sincronização de `history` e `smb_app_state_sync` pelo endpoint `smb_app_data` da Graph API quando permitido pela configuração da conta. Nenhuma chamada de sincronização é feita durante esta alteração.

Nenhuma configuração da Meta ou do Cloudflare foi alterada, nenhum termo aceito, migration aplicada, número registrado ou mensagem enviada nesta etapa.

Sem a chave service role, o segredo do app e o token de verificação no runtime, a validação/persistência não fica ativa: o `GET` retorna `503` quando o token falta e o `POST` retorna `503` quando o segredo ou a persistência segura faltam. O backend não usa a chave anon para gravar eventos.

## Rascunhos com agentes do OpenBot

O DigiBusca pode pedir ao agente `DigiProspector` do OpenBot um rascunho de abordagem e importar o resultado para o campo de mensagem do lead. O agente não envia mensagens ao WhatsApp. Revise o rascunho e use **Enviar pela API oficial** separadamente; o envio ainda exige consentimento registrado e template aprovado.

### Ativar a conexão local

1. No OpenBot, abra as configurações do agente **DigiProspector**, entre em **Permissões** e ative **Local scripts**. A API local do OpenBot só lista agentes com essa permissão ativa. Ative-a apenas nos agentes que você quer disponibilizar ao DigiBusca.
2. No computador que mantém o OpenBot aberto, inicie a ponte local do DigiBusca com `npm run backend:build` e `npm run backend:start`. Ela escuta somente em `127.0.0.1:3001` e lê a URL e o token temporário criados pelo próprio OpenBot em `~/Library/Application Support/OpenBot/automation/`.
3. Para usar a versão publicada do DigiBusca, adicione a origem exata do site em `DIGIBUSCA_APP_ORIGINS` no `backend/.env` local. O exemplo inclui `https://digibusca.claiverty.workers.dev`; substitua ou acrescente a origem real se o domínio de produção for outro. Reinicie o backend depois de alterar essa variável.
4. No detalhe de um lead, escolha **Agente do OpenBot**, selecione `DigiProspector` e gere o rascunho. O DigiBusca consulta a conclusão da tarefa e valida o formato e regras comerciais antes de mostrar a mensagem.

O DigiProspector precisa estar no mesmo servidor OpenBot que está aberto neste computador. Agentes em outro servidor não aparecem pela ponte de loopback. O token do OpenBot nunca vai para o navegador. O DigiBusca envia apenas nome da empresa, segmento, sinais do perfil público, serviço oferecido e contexto da conversa.

**Local scripts** permite a programas locais interagir com o agente e também ler solicitações pendentes, enviar respostas a perguntas ou aprovações, alterar modelo/conta e iniciar uma nova conversa. O DigiBusca usa somente as rotas de mensagem e leitura do resultado. A permissão deve ser ativada no próprio OpenBot; a integração não a altera.

Referências oficiais: [Coexistence / onboarding de usuários do WhatsApp Business App](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), [Embedded Signup da Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup), [WhatsApp Cloud API da Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) e [política do WhatsApp Business](https://business.whatsapp.com/policy/preview?lang=pt_BR).
