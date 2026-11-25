# DigiBusca na VPS HostGator

## Estado atual — 25/11/2026

- VPS Ubuntu 22.04.5, Docker 29.10.0, Dokploy 0.31.2; 2 vCPU, 4 GB RAM e 100 GB NVMe.
- O projeto DigiBusca no Dokploy está sem serviços registrados. Backend, banco legado da Evolution e túnel seguem no Compose operacional em `/opt/digibusca/ops/hostgator/compose.yaml`; a API da Evolution está parada. O deploy do backend é feito pelo GitHub Actions com SSH restrito, sem duplicar containers no Dokploy.
- OpenBot `digibot-ops` v0.73.0 está online, autenticado em `claiverty14@gmail.com`, com o agente DigiBot Ops e acesso ao MCP Dokploy. A listagem somente leitura confirmou o projeto DigiBusca sem consultar variáveis ou segredos.
- Foi criada uma chave Dokploy Member com validade de 90 dias. Ela está fora do Git em `/etc/digibusca/hostgator/dokploy-mcp.env`, `root:root`, modo `0600`; uma consulta de API somente leitura confirmou acesso ao projeto DigiBusca. Não copie a chave para o OpenBot nem para logs.
- O MCP standalone `dokploy-mcp` está ativo sem portas publicadas, em `172.30.0.3` na bridge `openbot` e `10.0.3.10` na overlay interna `digibusca-dokploy-mcp-control`. O OpenBot Ops (`172.30.0.2`) é a única origem autorizada; 51 tools expostos e listagem de projetos somente leitura validados.
- A instância WhatsApp do OpenBot está desativada na VPS; nenhum container OpenBot está recebendo mensagens. O volume e os arquivos de recuperação antigos foram preservados.
- Backend, frontend e Worker estão publicados na revisão `3f80c9e`; o CI passou por build, segurança, 71 testes unitários e 42 testes E2E. Os endpoints públicos de saúde do backend e do Worker retornam HTTP 200. `WHATSAPP_OPENCLAW_RUNTIME_ENABLED=true` e `WHATSAPP_EVOLUTION_INTEGRATION_ENABLED=false`. O webhook antigo da Evolution retorna HTTP 410.
- O túnel Cloudflare `ec5fc235-6aec-4f85-967c-16daca7b2507` está conectado em São Paulo e `whatsapp-api.digiuptech.com.br` já aponta para a VPS. O endpoint público `/api/health` retornou HTTP 200. O serviço antigo de túnel do Mac foi desativado; a definição local foi mantida para reversão.
- O timer diário de backup está ativo para 03:00 (`America/Sao_Paulo`), com retenção de 14 dias. A cópia de 23/11 às 22:15 BRT inclui o snapshot OpenClaw verificado pelo CLI oficial e quatro arquivos `.age`; todos passaram por checksum e conferência do cabeçalho criptografado. A chave privada de recuperação permanece fora da VPS.
- As migrations `016_whatsapp_openbot_replies.sql` a `021_whatsapp_ai_provider_connections.sql` foram aplicadas no Supabase de produção até 20/11/2026; a 021 cria as conexões protegidas de IA via Supabase Vault. A 018 restringe novos contatos a dias úteis, das 9h às 14h em `America/Sao_Paulo`, distribuindo os envios até o limite configurado e contando mensagens em envio, enviadas ou de resultado incerto.
- As migrations 024 e 025 foram aplicadas em 25/11/2026. A 024 pausa respostas e prospecção no banco, exige revisão de identidade antes do envio e bloqueia a rota Evolution para prospecção. A verificação confirmou zero itens `queued` ou `sending`; as automações continuam pausadas até um teste controlado de ponta a ponta.
- O canal WhatsApp do OpenClaw está vinculado e saudável, sem reconexões; o Gateway está com zero reinícios desde a recuperação do lock obsoleto. O plugin `digibusca-sync` está carregado com `before_dispatch`, `message_sending` e `message_sent`; o gancho global de entrada aplica a autorização do backend antes de liberar a resposta do Cristhian.
- A Evolution API está parada com reinício automático desligado e não recebe nem envia mensagens. O PostgreSQL da Evolution permanece ligado somente porque `backup-evolution.sh` precisa dele para criar o dump criptografado diário; as instâncias e volumes antigos foram preservados para recuperação.
- O ambiente do backend mantém os runtimes OpenClaw habilitados, mas as configurações de respostas e prospecção no Supabase continuam desligadas. O backend, o frontend e o playbook já estão atualizados; não reativar antes de validar o fluxo manualmente.
- O titular da conta autorizou o primeiro contato com leads retornados pela busca DigiBusca. O modelo preparado registra essa decisão em `whatsapp_outbound_authorization_*`, separada do consentimento declarado pelo destinatário. Descadastros continuam bloqueando o contato; a migration 022 converte o marcador legado sem tratá-lo como consentimento do destinatário.
- A rotina local do DigiBot Ops e a rotina remota do agente Ops estão ativas diariamente às 09:00 (`America/Sao_Paulo`). A rotina remota avisa 14, 7, 3 e 1 dia antes e no dia do vencimento previsto para 16/02/2027; se o OpenBot for interrompido no horário, roda uma vez quando reabrir. Ela não lê nem armazena a chave.
- O Gateway OpenClaw `2026.11.6` está na VPS com estado persistente e sem porta publicada. O painel usa o túnel Cloudflare e Caddy Basic Auth, além do token já existente; `gateway.trustedProxies` só confia no IP fixo do Caddy (`10.0.12.2`), que remove cabeçalhos de identidade e tokens recebidos antes de encaminhar. O CNAME `openclaw.digiuptech.com.br` está ativo e com proxy Cloudflare. A validação pública sem credenciais retornou 401 e a rota autenticada até o painel retornou 200. Zero Trust não foi ativado e a autorização para cobranças excedentes continua desligada. O MCP DigiBusca respondeu com as dez ferramentas permitidas.
- O plugin oficial `@openclaw/whatsapp@2026.11.6` permanece instalado. O Gateway está saudável e possui estado persistente; a Evolution API está desligada. Preserve os volumes antigos até confirmar uma conversa real após a correção do hook.
- Notas de voz do WhatsApp são transcritas primeiro localmente na VPS pelo Whisper.cpp 1.9.6 com o modelo multilíngue base, em português. O OpenAI `gpt-4o-transcribe` via OAuth existente fica como fallback se a transcrição local falhar; não há `OPENAI_API_KEY` configurada para áudio. A transcrição não é enviada como mensagem separada ao cliente. A fila de transcrição fica limitada a uma execução por vez.
- O runtime do OpenClaw está limitado a 1,5 GiB/0,75 CPU e usa `/tmp` tmpfs de 512 MiB. Depois de habilitar o Whisper local, o Gateway ficou saudável com cerca de 729 MiB/1,5 GiB e 2,1 GiB disponíveis no host. Uma transcrição de áudio sintético em PT-BR pelo comando de inferência do OpenClaw selecionou o modelo local e não tentou o fallback OpenAI; a fila permanece limitada a uma execução.
- CI validou 71 testes unitários e 42 testes E2E desktop/mobile para as alterações atuais. Ainda falta uma validação controlada de entrega e histórico com um contato de teste indicado pelo titular; não reativar prospecção automática antes disso.

## Arquivos

- `compose.yaml`: backend, Evolution (perfil legado desligado), Postgres Evolution mantido para backup e Cloudflared; volumes persistentes e rede privada.
- O CI publica imagens privadas do backend e da Evolution no GitHub Container Registry usando o SHA do commit e guarda cópias compactadas como artefatos privados por 1 dia. Depois do CI verde, o job `Atualizar backend na VPS` transfere o artefato, valida o SHA-256 e a revisão da imagem e recria somente o backend; se o healthcheck falhar, restaura a referência anterior. A Evolution continua sendo atualizada separadamente após revisão.
- `deploy-backend-from-ci.sh`: comando forçado da chave SSH de deploy; aceita apenas imagem do backend com tag SHA e artefato com checksum válido, atualiza `compose.env` e executa rollback automático se o healthcheck falhar.
- `openbot-whatsapp.compose.yaml`: override exclusivo da instância OpenBot WhatsApp para executar a ponte privada ao lado do agente, compartilhando o loopback do OpenBot e expondo o serviço somente pela overlay privada.
- `openbot-ops.network.compose.yaml` e `openbot-whatsapp-network.compose.yaml`: reservam endereços estáveis para que a política do MCP não atinja outro contêiner quando um serviço for recriado.
- `pin-openbot-network.sh`: instala esses overrides e fixa os endereços das duas instâncias OpenBot.
- `enable-openbot-whatsapp-bridge.sh`: valida as permissões Local scripts de Cristhian, arquivos protegidos, imagem por digest e credenciais; só então cria/verifica a overlay e adiciona o override à instância WhatsApp, preservando um backup do gerenciador.
- `dokploy-mcp.compose.yaml`: Compose dedicado ao MCP standalone, sem porta publicada.
- `dokploy-mcp.Dockerfile`: imagem com `@dokploy/mcp@0.30.7` fixado.
- `dokploy-mcp-firewall.sh` e `.service`: política estreita e reaplicável após reinícios do Docker.
- `dokploy-mcp-access.md`: topologia, ativação, verificações e reversão.
- `dokploy-mcp-key-rotation.md`: processo dos avisos e troca de chave.
- `backup-evolution.sh`, timer e instalador: exportam o PostgreSQL, arquivam as sessões da Evolution, incluem os dados de OpenBot que ainda estiverem online e, quando instalado, criam o backup consistente do OpenClaw pelo CLI oficial. Os arquivos são criptografados com `age`, validados e mantidos por 14 dias. O timer executa diariamente às 03:00 (horário de São Paulo).
- `backend.env.example`, `evolution-api.env.example`, `evolution-db.env.example`, `dokploy-mcp.env.example` e `compose.env.example`: modelos sem credenciais.
- `openclaw.compose.yaml`: Gateway principal do Cristhian, sem porta pública e conectado ao backend pela rede privada. Ele constrói a imagem local com Whisper.cpp, ffmpeg e o modelo `base` multilíngue; o Compose usa imagem local com tag versionada e o upstream fica fixado por digest em `OPENCLAW_BASE_IMAGE`.
- `openclaw.env.example`, `openclaw-workspace/{AGENTS,SOUL,IDENTITY,USER}.md` e `openclaw-migration.md`: modelo sem credenciais, fluxo comercial, voz PT-BR do Cristhian, identidade e regras para não misturar dados de contatos.
- O Compose monta esses quatro arquivos como instruções somente leitura em cada sessão. Depois de configurar a identidade do agente, arquive o `BOOTSTRAP.md` padrão da workspace persistente para não injetar o roteiro de configuração inicial em conversas de clientes.
- `openclaw-audio.Dockerfile` e `openclaw-workspace/extensions/digibusca-sync/openclaw-whisper-transcribe.sh`: transcrição local de áudio OGG/Opus e outros formatos compatíveis com ffmpeg, limitada a cinco minutos e sem enviar o áudio a um serviço externo quando Whisper funciona.
- Para atualizar a imagem do Gateway, no diretório `/opt/digibusca/ops/hostgator`, rode `docker compose --env-file /etc/digibusca/hostgator/compose.env -f compose.yaml -f openclaw.compose.yaml -f /opt/digibusca/repository/ops/hostgator/openclaw.resources.compose.yaml build openclaw-gateway` e depois o mesmo comando com `up -d --no-deps openclaw-gateway`. A política `pull_policy: never` impede que essa imagem local seja substituída por uma imagem remota.

## Segurança operacional

- Nunca adicionar `.env` preenchidos, tokens, senhas, QR codes, chaves Dokploy ou dados de clientes ao Git.
- Os dumps, sessões do WhatsApp, dados de OpenBot/OpenClaw e arquivos de configuração são sensíveis. O backup diário fica criptografado em `/var/backups/digibusca/evolution`, `root:root`, modo `0700`; a chave privada de recuperação fica fora da VPS. O backup diário local cobre falha de aplicativo/volume, mas não substitui uma cópia fora da VPS. O plano gratuito da HostGator aparece semanal no painel e pode ser configurado para guardar somente os arquivos `.age` criptografados; a retenção externa precisa ser verificada separadamente.
- Não colocar service-role Supabase, token Cloudflare ou API key Dokploy no OpenBot.
- A chave privada `HOSTGATOR_VPS_DEPLOY_KEY` e a chave pública pinada `HOSTGATOR_VPS_KNOWN_HOSTS` ficam somente nos secrets do GitHub. A chave autorizada na VPS usa `restrict` e `command=` para permitir apenas o script de deploy, sem shell ou encaminhamento SSH.
- O MCP DigiBusca não publica porta e fica disponível ao Cristhian somente pela rede privada com as cinco ferramentas permitidas. O MCP administrativo Dokploy é uma conexão separada e não está disponível ao agente de WhatsApp.
- O backend permanece como política de segurança para conversas, opt-out, janela de atendimento e prospecção. Não reative a Evolution API junto ao canal WhatsApp do OpenClaw.

## Google Agenda e Meet

- O Client ID e o Client Secret OAuth podem ser configurados no cartão Google Agenda e Meet do DigiBusca; eles ficam no Supabase Vault. Se usar variáveis de ambiente como alternativa, configure-as somente em `/etc/digibusca/hostgator/backend.env`; nunca copie `GOOGLE_CALENDAR_CLIENT_SECRET` para o Gateway do OpenClaw, frontend ou Git.
- URI de callback do OAuth Client Web: `https://whatsapp-api.digiuptech.com.br/api/integrations/google-calendar/callback`.
- Para a conexão pessoal do proprietário, use um OAuth Client Web em Personal mode; ele só autoriza a conta Google que criou o cliente. A habilitação da API padrão do Calendar não exige mover o OAuth Supabase existente nem publicar um app para outros usuários.
- O refresh token fica em Supabase Vault via migration `023_google_calendar_meet_integration.sql`. O Gateway acessa agenda somente pelas ferramentas permitidas no MCP DigiBusca: `check_calendar_availability`, `create_confirmed_meeting` e `request_calendar_follow_up`.
- `openclaw-workspace/openclaw.config.example.json5` mantém a allowlist MCP; ao publicar estes arquivos na VPS, inclua os três nomes no `toolFilter.include` da configuração ativa e reinicie somente o Gateway para recarregar a lista.
- O Cristhian precisa verificar disponibilidade e obter confirmação expressa do cliente antes de criar o evento. Se a autorização Google falhar, ele pode sinalizar o pedido na caixa de entrada sem pausar o agente; se o horário estiver ocupado, deve pedir outra opção.

## OpenClaw — transporte ativo

- O Gateway e o canal WhatsApp estão ativos; a rota Evolution está bloqueada no backend e o serviço de envio Evolution está parado. A base PostgreSQL antiga permanece ligada exclusivamente para que o backup diário continue funcionando.
- A auditoria confirmou que `inbound_claim` não é um gancho global: o OpenClaw só o chama para o plugin dono do vínculo da conversa. O plugin foi corrigido para usar `before_dispatch`, que autoriza e persiste o inbound antes da chamada normal do modelo. Os envios continuam sujeitos a autorização do backend e ficam sincronizados no histórico.
- O MCP do DigiBusca continua privado e limitado às ferramentas permitidas. Não conectar o MCP administrativo Dokploy ao Cristhian. O backend continua aplicando aprovações, pausa, descadastro, janela de resposta e fila de prospecção.
- A conexão está saudável, mas a validação de entrega após a correção ainda precisa de uma mensagem de teste enviada por outro número. O teste anterior em uma conversa do próprio titular não comprova uma entrega externa.

## Verificações seguintes

1. Enviar uma mensagem curta de um segundo telefone para o WhatsApp vinculado ao OpenClaw e conferir que o Cristhian responde e que a conversa aparece no DigiBusca. As tentativas anteriores foram antes da correção do hook.
2. Fazer prospecção somente dentro da janela de dias úteis das 9h às 14h, com leads elegíveis e itens autorizados na fila.
3. Preservar os volumes antigos da Evolution e do OpenBot para recuperação enquanto a conexão OpenClaw estiver em observação.
