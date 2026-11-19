# DigiBusca na VPS HostGator

## Estado atual — 19/11/2026

- VPS Ubuntu 22.04.5, Docker 29.10.0, Dokploy 0.31.2; 2 vCPU, 4 GB RAM e 100 GB NVMe.
- OpenBot `digibot-ops` v0.73.0 está online, autenticado em `claiverty14@gmail.com`, com o agente DigiBot Ops e acesso ao MCP Dokploy. A listagem somente leitura confirmou o projeto DigiBusca sem consultar variáveis ou segredos.
- Foi criada uma chave Dokploy Member com validade de 90 dias. Ela está fora do Git em `/etc/digibusca/hostgator/dokploy-mcp.env`, `root:root`, modo `0600`; uma consulta de API somente leitura confirmou acesso ao projeto DigiBusca. Não copie a chave para o OpenBot nem para logs.
- O MCP standalone `dokploy-mcp` está ativo sem portas publicadas, em `172.30.0.3` na bridge `openbot` e `10.0.3.10` na overlay interna `digibusca-dokploy-mcp-control`. O OpenBot Ops (`172.30.0.2`) é a única origem autorizada; 51 tools expostos e listagem de projetos somente leitura validados.
- A instância `digibot-whatsapp` está online no OpenBot como **DigiBusca WhatsApp VPS**, v0.73.0, volume próprio, limite de 0,45 CPU/1.536 MiB e somente na bridge isolada `openbot`. O agente **Cristhian** foi criado em PT-BR. Não conecte essa instância ao MCP.
- O backend DigiBusca, a Evolution API e o PostgreSQL estão ativos na VPS, com volumes persistentes dedicados. A verificação interna do backend e da Evolution retornou HTTP 200.
- O túnel Cloudflare `ec5fc235-6aec-4f85-967c-16daca7b2507` está conectado em São Paulo e `whatsapp-api.digiuptech.com.br` já aponta para a VPS. O endpoint público `/api/health` retornou HTTP 200. O serviço antigo de túnel do Mac foi desativado; a definição local foi mantida para reversão.
- O timer diário de backup está ativo para 03:00 (`America/Sao_Paulo`), com retenção de 14 dias. Uma cópia extra foi criada após as migrations; os três arquivos passaram por checksum e o dump PostgreSQL foi descriptografado fora da VPS e validado com `pg_restore --list`. A chave privada de recuperação permanece fora da VPS.
- As migrations `016_whatsapp_openbot_replies.sql`, `017_whatsapp_contact_opt_out_dedupe.sql` e `018_whatsapp_prospecting_schedule_9_to_14.sql` foram aplicadas no Supabase de produção em 19/11/2026. A 018 restringe novos contatos a dias úteis, das 9h às 14h em `America/Sao_Paulo`, distribuindo os envios até o limite configurado e contando mensagens em envio, enviadas ou de resultado incerto.
- A Evolution API está online na VPS, mas ainda não há instância do WhatsApp pareada: o estado reportado é `connecting`. A sessão que estava no Mac não foi migrada; é necessário gerar o QR da VPS e vinculá-la pelo celular.
- `Local scripts` está habilitado somente para Cristhian e a ponte privada do OpenBot está configurada. Os runtimes de resposta e prospecção estão habilitados; a fila está ligada com limite diário de 20, mas sem itens elegíveis enfileirados. O envio e as respostas dependem de a sessão da Evolution chegar ao estado `open`.
- Os resultados atuais da busca vêm do Google Places e não incluem um sinal de autorização para WhatsApp. A fila valida autorização explícita registrada e mantém bloqueados os contatos com pedido de descadastro; não marcar resultados públicos automaticamente como opt-in.
- A rotina local do DigiBot Ops e a rotina remota do agente Ops estão ativas diariamente às 09:00 (`America/Sao_Paulo`). A rotina remota avisa 14, 7, 3 e 1 dia antes e no dia do vencimento previsto para 16/02/2027; se o OpenBot for interrompido no horário, roda uma vez quando reabrir. Ela não lê nem armazena a chave.

## Arquivos

- `compose.yaml`: backend, Evolution, Postgres Evolution e Cloudflared; serviços com perfis opcionais, volumes persistentes novos e rede de saída do backend para Supabase.
- O CI publica imagens privadas do backend e da Evolution no GitHub Container Registry usando o SHA do commit e guarda cópias compactadas como artefatos privados por 1 dia. A instalação carrega esses artefatos diretamente no Docker da VPS; os serviços não precisam de credencial do GHCR. Use as referências com SHA no `compose.env` e confira o SHA-256 antes de transferir cada arquivo.
- `openbot-whatsapp.compose.yaml`: override exclusivo da instância OpenBot WhatsApp para executar a ponte privada ao lado do agente, compartilhando o loopback do OpenBot e expondo o serviço somente pela overlay privada.
- `openbot-ops.network.compose.yaml` e `openbot-whatsapp-network.compose.yaml`: reservam endereços estáveis para que a política do MCP não atinja outro contêiner quando um serviço for recriado.
- `pin-openbot-network.sh`: instala esses overrides e fixa os endereços das duas instâncias OpenBot.
- `enable-openbot-whatsapp-bridge.sh`: valida as permissões Local scripts de Cristhian, arquivos protegidos, imagem por digest e credenciais; só então cria/verifica a overlay e adiciona o override à instância WhatsApp, preservando um backup do gerenciador.
- `dokploy-mcp.compose.yaml`: Compose dedicado ao MCP standalone, sem porta publicada.
- `dokploy-mcp.Dockerfile`: imagem com `@dokploy/mcp@0.30.7` fixado.
- `dokploy-mcp-firewall.sh` e `.service`: política estreita e reaplicável após reinícios do Docker.
- `dokploy-mcp-access.md`: topologia, ativação, verificações e reversão.
- `dokploy-mcp-key-rotation.md`: processo dos avisos e troca de chave.
- `backup-evolution.sh`, timer e instalador: exportam o PostgreSQL, arquivam as sessões da Evolution, os dados dos agentes OpenBot Ops e Cristhian e as configurações privadas de recuperação, criptografam tudo com `age`, validam os artefatos e mantêm 14 dias de cópias locais. O timer executa diariamente às 03:00 (horário de São Paulo).
- `backend.env.example`, `evolution-api.env.example`, `evolution-db.env.example`, `dokploy-mcp.env.example` e `compose.env.example`: modelos sem credenciais.

## Segurança operacional

- Nunca adicionar `.env` preenchidos, tokens, senhas, QR codes, chaves Dokploy ou dados de clientes ao Git.
- Os dumps, sessões do WhatsApp, dados do OpenBot e arquivos de configuração são sensíveis. O backup diário fica criptografado em `/var/backups/digibusca/evolution`, `root:root`, modo `0700`; a chave privada de recuperação fica fora da VPS. O backup diário local cobre falha de aplicativo/volume, mas não substitui uma cópia fora da VPS. O plano gratuito da HostGator aparece semanal no painel e pode ser configurado para guardar somente os arquivos `.age` criptografados; a retenção externa precisa ser verificada separadamente.
- Não colocar service-role Supabase, token Cloudflare ou API key Dokploy no OpenBot.
- O MCP não publica porta e não recebe rota pública. O endpoint HTTP do MCP não autentica o cliente, portanto o acesso é limitado por firewall a um contêiner OpenBot Ops dedicado.
- O agente Cristhian não recebe o MCP; Computer Use continua desligado e `Local scripts` fica habilitado somente nesse agente para a ponte privada, com aprovações de ferramenta mantidas. A instância segue isolada do endpoint de Dokploy.
- Manter os runtimes ativos, mas só validar envios depois de parear a instância da VPS e confirmar a conexão `open`.

## Próximas etapas

1. Gerar o QR da Evolution na VPS, parear o WhatsApp pelo celular e validar ida/volta com um número de teste.
2. Confirmar a publicação do backend contendo o limite de horário e testar a fila depois que a sessão estiver `open`.
3. Enfileirar apenas leads com autorização explícita registrada; resultados do Google Places não indicam consentimento para WhatsApp.
4. Configurar uma cópia externa para os arquivos `.age`. O backup diário atual fica criptografado na VPS; o plano gratuito cWatch aparece semanal e ainda precisa ser configurado/verificado para incluir essa pasta.
