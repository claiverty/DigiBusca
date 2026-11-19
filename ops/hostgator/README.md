# DigiBusca na VPS HostGator

## Estado atual — 19/11/2026

- VPS Ubuntu 22.04.5, Docker 29.10.0, Dokploy 0.31.2; 2 vCPU, 4 GB RAM e 100 GB NVMe.
- OpenBot `digibot-ops` v0.73.0 está online, autenticado em `claiverty14@gmail.com`, com o agente DigiBot Ops e acesso ao MCP Dokploy. A listagem somente leitura confirmou o projeto DigiBusca sem consultar variáveis ou segredos.
- Foi criada uma chave Dokploy Member com validade de 90 dias. Ela está fora do Git em `/etc/digibusca/hostgator/dokploy-mcp.env`, `root:root`, modo `0600`; uma consulta de API somente leitura confirmou acesso ao projeto DigiBusca. Não copie a chave para o OpenBot nem para logs.
- O MCP standalone `dokploy-mcp` está ativo sem portas publicadas, em `172.30.0.3` na bridge `openbot` e `10.0.3.10` na overlay interna `digibusca-dokploy-mcp-control`. O OpenBot Ops (`172.30.0.2`) é a única origem autorizada; 51 tools expostos e listagem de projetos somente leitura validados.
- A instância `digibot-whatsapp` está online no OpenBot como **DigiBusca WhatsApp VPS**, v0.73.0, volume próprio, limite de 0,45 CPU/1.200 MiB e somente na bridge isolada `openbot`. O agente **Cristhian** foi criado em PT-BR. Não conecte essa instância ao MCP.
- O backend DigiBusca, a Evolution API e o PostgreSQL estão ativos na VPS, com volumes persistentes dedicados. A verificação interna do backend e da Evolution retornou HTTP 200.
- O túnel Cloudflare `ec5fc235-6aec-4f85-967c-16daca7b2507` está conectado em São Paulo e `whatsapp-api.digiuptech.com.br` já aponta para a VPS. O endpoint público `/api/health` retornou HTTP 200. O serviço antigo de túnel do Mac foi desativado; a definição local foi mantida para reversão.
- O timer diário de backup está ativo para 03:00 (`America/Sao_Paulo`), com retenção de 14 dias. A primeira cópia criptografada foi criada e os três arquivos passaram por checksum e validação de descriptografia/restauração. A chave privada de recuperação permanece fora da VPS.
- Ainda falta autenticar no Supabase e aplicar as migrations `016_whatsapp_openbot_replies.sql` e `017_whatsapp_contact_opt_out_dedupe.sql` antes de habilitar o atendimento automatizado. A Evolution ainda precisa de um novo pareamento QR na VPS.
- O agente Cristhian está criado, mas `Local scripts` ainda está desligado. A ponte OpenBot não foi habilitada; a automação de resposta e a fila de prospecção continuam desligadas.
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
- O agente Cristhian não recebe o MCP; Computer Use e scripts locais estão desligados e as ações de ferramenta usam aprovação. A instância segue isolada do endpoint de Dokploy.
- Não habilitar backend/Evolution até confirmar imagens, segredos, domínio/webhook e armazenamento.

## Próximas etapas

1. Aplicar as duas migrations pendentes no Supabase depois da autenticação do proprietário.
2. Parear o WhatsApp com o QR da Evolution na VPS e validar ida/volta usando um número de teste.
3. Concluir a ponte do agente Cristhian; `Local scripts` continua exigindo habilitação no agente específico.
4. Validar o atendimento sem ativar a fila de prospecção. Os três runtimes seguem desligados até revisão explícita do fluxo.
5. Configurar uma cópia externa para os arquivos `.age`. O backup diário atual fica criptografado na VPS; o plano gratuito cWatch aparece semanal e ainda precisa ser configurado/verificado para incluir essa pasta.
