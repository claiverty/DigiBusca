# DigiBusca na VPS HostGator

## Estado atual — 20/11/2026

- VPS Ubuntu 22.04.5, Docker 29.10.0, Dokploy 0.31.2; 2 vCPU, 4 GB RAM e 100 GB NVMe.
- O projeto DigiBusca no Dokploy está sem serviços registrados. Backend e Evolution seguem no Compose operacional em `/opt/digibusca/ops/hostgator/compose.yaml`; o deploy automático do backend é feito pelo GitHub Actions com SSH restrito, sem duplicar containers no Dokploy.
- OpenBot `digibot-ops` v0.73.0 está online, autenticado em `claiverty14@gmail.com`, com o agente DigiBot Ops e acesso ao MCP Dokploy. A listagem somente leitura confirmou o projeto DigiBusca sem consultar variáveis ou segredos.
- Foi criada uma chave Dokploy Member com validade de 90 dias. Ela está fora do Git em `/etc/digibusca/hostgator/dokploy-mcp.env`, `root:root`, modo `0600`; uma consulta de API somente leitura confirmou acesso ao projeto DigiBusca. Não copie a chave para o OpenBot nem para logs.
- O MCP standalone `dokploy-mcp` está ativo sem portas publicadas, em `172.30.0.3` na bridge `openbot` e `10.0.3.10` na overlay interna `digibusca-dokploy-mcp-control`. O OpenBot Ops (`172.30.0.2`) é a única origem autorizada; 51 tools expostos e listagem de projetos somente leitura validados.
- A instância `digibot-whatsapp` está online no OpenBot como **DigiBusca WhatsApp VPS**, v0.73.0, volume próprio, limite de 0,45 CPU/1.536 MiB e somente na bridge isolada `openbot`. O agente **Cristhian** foi criado em PT-BR. Não conecte essa instância ao MCP.
- O backend DigiBusca está ativo na VPS com a imagem imutável do commit mais recente publicado pela branch `main`; o container está saudável e `https://whatsapp-api.digiuptech.com.br/api/health` retorna HTTP 200. Evolution API e PostgreSQL continuam ativos com volumes persistentes dedicados.
- O túnel Cloudflare `ec5fc235-6aec-4f85-967c-16daca7b2507` está conectado em São Paulo e `whatsapp-api.digiuptech.com.br` já aponta para a VPS. O endpoint público `/api/health` retornou HTTP 200. O serviço antigo de túnel do Mac foi desativado; a definição local foi mantida para reversão.
- O timer diário de backup está ativo para 03:00 (`America/Sao_Paulo`), com retenção de 14 dias. Uma cópia extra foi criada após as migrations; os três arquivos passaram por checksum e o dump PostgreSQL foi descriptografado fora da VPS e validado com `pg_restore --list`. A chave privada de recuperação permanece fora da VPS.
- As migrations `016_whatsapp_openbot_replies.sql` a `021_whatsapp_ai_provider_connections.sql` foram aplicadas no Supabase de produção até 20/11/2026; a 021 cria as conexões protegidas de IA via Supabase Vault. A 018 restringe novos contatos a dias úteis, das 9h às 14h em `America/Sao_Paulo`, distribuindo os envios até o limite configurado e contando mensagens em envio, enviadas ou de resultado incerto.
- A instância da Evolution API na VPS está conectada (`open`). O runtime do Cristhian permanece na VPS. O provedor e modelo podem ser conectados no painel DigiBusca; credenciais novas ficam no Supabase Vault e são lidas pelo backend da VPS. A chave Gemini em `backend.env` continua como configuração global legada até a migração pelo painel; depois da conexão por usuário, essa conexão tem prioridade e alterações pausam o perfil e exigem nova aprovação.
- `Local scripts` está habilitado somente para Cristhian e a ponte privada do OpenBot está configurada. Os runtimes de resposta e prospecção estão habilitados; a fila de prospecção usa limite diário de 20 e a janela de dias úteis das 9h às 14h. O envio automático despacha itens já enfileirados; a seleção, a mensagem e a inclusão na fila ainda são feitas pela tela.
- O titular da conta autorizou o primeiro contato com leads retornados pela busca DigiBusca. O modelo preparado registra essa decisão em `whatsapp_outbound_authorization_*`, separada do consentimento declarado pelo destinatário. Descadastros continuam bloqueando o contato; a migration 022 converte o marcador legado sem tratá-lo como consentimento do destinatário.
- A rotina local do DigiBot Ops e a rotina remota do agente Ops estão ativas diariamente às 09:00 (`America/Sao_Paulo`). A rotina remota avisa 14, 7, 3 e 1 dia antes e no dia do vencimento previsto para 16/02/2027; se o OpenBot for interrompido no horário, roda uma vez quando reabrir. Ela não lê nem armazena a chave.

## Arquivos

- `compose.yaml`: backend, Evolution, Postgres Evolution e Cloudflared; serviços com perfis opcionais, volumes persistentes novos e rede de saída do backend para Supabase.
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
- `openclaw.compose.yaml`: serviço opcional do Gateway principal do Cristhian, sem porta pública e conectado ao backend pela rede privada. O arquivo ainda não foi aplicado na VPS.
- `openclaw.env.example`, `openclaw-workspace/AGENTS.md` e `openclaw-migration.md`: modelo sem credenciais, perfil de conversa PT-BR e plano da migração reversível.

## Segurança operacional

- Nunca adicionar `.env` preenchidos, tokens, senhas, QR codes, chaves Dokploy ou dados de clientes ao Git.
- Os dumps, sessões do WhatsApp, dados de OpenBot/OpenClaw e arquivos de configuração são sensíveis. O backup diário fica criptografado em `/var/backups/digibusca/evolution`, `root:root`, modo `0700`; a chave privada de recuperação fica fora da VPS. O backup diário local cobre falha de aplicativo/volume, mas não substitui uma cópia fora da VPS. O plano gratuito da HostGator aparece semanal no painel e pode ser configurado para guardar somente os arquivos `.age` criptografados; a retenção externa precisa ser verificada separadamente.
- Não colocar service-role Supabase, token Cloudflare ou API key Dokploy no OpenBot.
- A chave privada `HOSTGATOR_VPS_DEPLOY_KEY` e a chave pública pinada `HOSTGATOR_VPS_KNOWN_HOSTS` ficam somente nos secrets do GitHub. A chave autorizada na VPS usa `restrict` e `command=` para permitir apenas o script de deploy, sem shell ou encaminhamento SSH.
- O MCP não publica porta e não recebe rota pública. O endpoint HTTP do MCP não autentica o cliente, portanto o acesso é limitado por firewall a um contêiner OpenBot Ops dedicado.
- O agente Cristhian não recebe o MCP; Computer Use continua desligado e `Local scripts` fica habilitado somente nesse agente para a ponte privada, com aprovações de ferramenta mantidas. A instância segue isolada do endpoint de Dokploy.
- Manter os runtimes ativos, mas só validar envios depois de parear a instância da VPS e confirmar a conexão `open`.

## Migração para OpenClaw — em preparação

- O OpenClaw deve tornar-se o runtime principal do Cristhian, conectado ao WhatsApp Web por QR. O serviço, plugin de sincronização, MCP privado e registro da conexão no painel estão preparados no repositório; ainda não foram instalados na VPS.
- Em 24/11, o console da HostGator mostrou repetidos encerramentos por OOM de processos OpenBot e OpenCode. Antes de subir o OpenClaw, medir a memória no host e não manter os runtimes OpenBot/OpenCode pesados ativos ao mesmo tempo; preservar volumes e backup para rollback. Usar a imagem pré-compilada fixada em `compose.env` — não compilar OpenClaw na VPS de 4 GB.
- O DigiBusca backend continua responsável por dados, autorização do titular, consentimento declarado pelo destinatário, opt-out, estágios, limites de prospecção e fila. O plugin exige autorização do backend antes do envio; a integração ainda depende da migration 022, do QR e de validação no Gateway real.
- O Gateway permanece sem porta pública; o agente chega ao WhatsApp e ao backend pelas redes privada e de saída definidas no override opcional. O MCP administrativo do Dokploy não deve ser ligado ao atendimento.
- Seguir `openclaw-migration.md` para a ordem de backup, instalação, QR, troca do despachante e rollback. Não remover os volumes OpenBot antes da validação e da retenção do backup.

## Próximas etapas

1. Acompanhar a próxima conversa recebida para confirmar o ciclo completo do agente com a Evolution.
2. A busca do DigiBusca registra a autorização operacional do titular para primeiro contato. Isso não é consentimento declarado pelo destinatário; opt-outs e limites continuam bloqueando envios.
3. Configurar uma cópia externa para os arquivos `.age`. O backup diário atual fica criptografado na VPS; o plano gratuito cWatch aparece semanal e ainda precisa ser configurado/verificado para incluir essa pasta.
