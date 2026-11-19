# DigiBusca na VPS HostGator

## Estado atual — 19/11/2026

- VPS Ubuntu 22.04.5, Docker 29.10.0, Dokploy 0.31.2; 2 vCPU, 4 GB RAM e 100 GB NVMe.
- OpenBot `digibot-ops` v0.73.0 está online, autenticado em `claiverty14@gmail.com`, com o agente DigiBot Ops e acesso ao MCP Dokploy. A listagem somente leitura confirmou o projeto DigiBusca sem consultar variáveis ou segredos.
- Foi criada uma chave Dokploy Member com validade de 90 dias. Ela está fora do Git em `/etc/digibusca/hostgator/dokploy-mcp.env`, `root:root`, modo `0600`; uma consulta de API somente leitura confirmou acesso ao projeto DigiBusca. Não copie a chave para o OpenBot nem para logs.
- O MCP standalone `dokploy-mcp` está ativo sem portas publicadas, em `172.30.0.3` na bridge `openbot` e `10.0.3.10` na overlay interna `digibusca-dokploy-mcp-control`. O OpenBot Ops (`172.30.0.2`) é a única origem autorizada; 51 tools expostos e listagem de projetos somente leitura validados.
- A instância `digibot-whatsapp` está online no OpenBot como **DigiBusca WhatsApp VPS**, v0.73.0, volume próprio, limite de 0,45 CPU/1.200 MiB e somente na bridge isolada `openbot`. O agente **Cristhian** foi criado em PT-BR. Não conecte essa instância ao MCP.
- O backend DigiBusca, a Evolution API e seus volumes persistentes ainda não foram instalados na VPS. A Evolution local antiga não está disponível no Mac; a produção precisará de um novo pareamento QR depois que os serviços e o túnel estiverem prontos.
- O agente Cristhian está criado, mas ainda falta habilitar `Local scripts` nele pelo OpenBot. Sem essa permissão, o backend não consegue enviar mensagens ao agente. O instalador da ponte agora falha sem alterar o gerenciador se essa permissão, os arquivos protegidos, o digest da imagem e as credenciais correspondentes não estiverem prontos.
- A ponte OpenBot, o backend e a Evolution ainda não foram aplicados. A automação de resposta e a fila de prospecção permanecem desligadas. A implantação inicial usará volumes dedicados da HostGator, sem reaproveitar volumes locais inexistentes.
- A rotina local do DigiBot Ops e a rotina remota do agente Ops estão ativas diariamente às 09:00 (`America/Sao_Paulo`). A rotina remota avisa 14, 7, 3 e 1 dia antes e no dia do vencimento previsto para 16/02/2027; se o OpenBot for interrompido no horário, roda uma vez quando reabrir. Ela não lê nem armazena a chave.

## Arquivos

- `compose.yaml`: backend, Evolution, Postgres Evolution e Cloudflared; serviços com perfis opcionais, volumes persistentes novos e rede de saída do backend para Supabase.
- O CI publica imagens do backend e da Evolution no GitHub Container Registry usando o SHA do commit. Use a referência `@sha256` impressa no resumo do workflow; configure o acesso do Dokploy ao GHCR antes de implantar os pacotes privados.
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

1. Publicar as imagens do backend e da Evolution pelo workflow do GitHub, aplicar as migrations de WhatsApp até `017_whatsapp_contact_opt_out_dedupe.sql` e criar os arquivos privados de configuração.
2. Criar os serviços do backend e da Evolution na VPS, com os runtimes de resposta, prospecção e OpenBot desligados.
3. Instalar `install-evolution-backup.sh` quando o banco, os arquivos de serviço e os dados dos dois agentes OpenBot estiverem ativos. O timer roda diariamente às 03:00 (horário de São Paulo), mantém 14 dias locais, inclui as sessões e as configurações essenciais em arquivos criptografados e valida os artefatos.
4. O Portal do Cliente HostGator mostra **Backup VPS Free — Protegido**, frequência semanal, com primeira cópia prevista para 25/11/2026 às 05:00. Para incluir os dumps, configure `/var/backups/digibusca/evolution` como diretório SFTP do backup; o plano informa limite de 3 GB e não faz dump de PostgreSQL em execução. O dump criptografado criado pelo timer é o que permite copiar o banco como arquivo.
5. Criar a rota do novo túnel Cloudflare, testar status/webhook sem enviar para leads e só então trocar o hostname de produção.
6. Parear o WhatsApp por QR na Evolution da VPS e validar ida/volta em número de teste.
7. Antes de habilitar o envio via Cristhian, aprovar a permissão `Local scripts` somente para o agente Cristhian e validar a ponte. Ativar primeiro respostas; manter prospecção desligada até confirmar consentimento explícito em cada lead da fila.
