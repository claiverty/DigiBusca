# DigiBusca na VPS HostGator

## Estado atual — 23/11/2026

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
- O Gateway OpenClaw `2026.11.6` está na VPS com estado persistente e sem porta publicada. O painel usa o túnel Cloudflare e Caddy Basic Auth, além do token já existente; `gateway.trustedProxies` só confia no IP fixo do Caddy (`10.0.12.2`), que remove cabeçalhos de identidade e tokens recebidos antes de encaminhar. O CNAME `openclaw.digiuptech.com.br` está ativo e com proxy Cloudflare. A validação pública sem credenciais retornou 401 e a rota autenticada até o painel retornou 200. Zero Trust não foi ativado e a autorização para cobranças excedentes continua desligada. O MCP DigiBusca respondeu com as cinco ferramentas permitidas.
- O plugin oficial `@openclaw/whatsapp@2026.11.6` foi instalado e fixado. O canal WhatsApp continua desativado, sem QR ou sessão pareada; `WHATSAPP_OPENCLAW_RUNTIME_ENABLED=false`. OpenBot e Evolution continuam rodando como rollback e cobertura atual.
- O modelo `google/gemini-4-hydrogen` está configurado no OpenClaw, mas não há credencial de modelo no contêiner. Nenhuma resposta de IA é possível pelo Gateway até conectar um provedor suportado. A conta Cloud não recebeu os créditos de US$ 10.
- Com o Gateway saudável, o uso medido oscilou entre ~694 e 847 MiB em repouso; os logs registraram picos de ~954 MiB e alerta crítico perto do limite de 1 GiB. O host tinha ~937 MiB disponíveis e ~1 GiB de swap usado. O Gateway usa `/tmp` tmpfs de 512 MiB para que o backup oficial consiga verificar snapshots.

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

## Migração para OpenClaw — Gateway pronto, corte pendente

- Gateway instalado e saudável, ligado ao backend pela rede privada; sem rota pública. O plugin `digibusca-sync` passou a carregar e o MCP listou `get_runtime_status`, `search_leads_without_site`, `list_leads`, `update_lead` e `queue_prospect`.
- O WhatsApp Web do OpenClaw permanece desativado. Nenhum QR foi lido, a conexão não foi registrada no painel e o Cristhian não enviou mensagens pelo OpenClaw.
- O Hydrogen está escolhido, mas sem credencial. As instruções atuais do OpenClaw dizem que o runtime Gemini CLI também depende de uma chave Gemini API e não permite criar OAuth novo da conta pessoal AI Pro. [Documentação do provedor Google no OpenClaw](https://docs.openclaw.ai/providers/google). Os créditos de US$ 10 do AI Pro não foram resgatados nem vinculados à conta Cloud; nenhuma alteração de cobrança foi feita.
- O backup oficial `openclaw backup create --verify` passou em arquivo temporário. O timer diário está ativo e o script passou a incluir o arquivo OpenClaw criptografado com `age`; o último arquivo completo é anterior ao Gateway. Confirmar a próxima execução diária e o checksum antes do corte.
- Uso medido em repouso: ~694–847 MiB no Gateway, com pico de ~954 MiB; host com 4 GB RAM e 2 vCPU, além de OpenBot, Evolution, backend e Dokploy. Antes de ativar o canal, pausar o runtime antigo e reavaliar memória; preservar os volumes para rollback.
- O backend segue responsável por autorização, consentimento, opt-out, etapas, limites e fila. Não conectar o MCP administrativo Dokploy ao Cristhian e não remover os dados OpenBot.
- Seguir `openclaw-migration.md` para autenticação de modelo, backup criptografado, QR, teste de ponta a ponta, corte do despachante e rollback.

## Próximas etapas

1. Escolher uma autenticação de modelo suportada pelo OpenClaw. O AI Pro pessoal via CLI/OAuth não está conectado; a rota Gemini AI Studio usa credencial de API e cobrança/credit Cloud.
2. Confirmar que o backup diário criptografado com OpenClaw e checksum terminou antes de parear o QR.
3. Pausar o atendimento OpenBot/Evolution, parear o WhatsApp Web e testar o fluxo com um número consentido antes de ativar respostas ou prospecção.
4. Configurar uma cópia externa para os arquivos `.age`. O backup diário atual fica criptografado na VPS; o plano gratuito cWatch aparece semanal e ainda precisa ser configurado/verificado para incluir essa pasta.
