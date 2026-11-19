# Acesso do OpenBot ao Dokploy MCP

**Estado em 18/11/2026:** MCP standalone ativo e validado. A chave Dokploy Member de 90 dias fica em `/etc/digibusca/hostgator/dokploy-mcp.env` (`root:root`, modo `0600`). O MCP não publica portas; firewall autoriza somente a instância OpenBot Ops. A listagem de projetos somente leitura confirmou DigiBusca sem consultar variáveis ou segredos. A instância WhatsApp fica isolada e não recebe o MCP.

## Topologia implantada

- O OpenBot Ops permanece apenas na bridge `openbot` (`172.30.0.0/16`, ICC desativado), com o firewall oficial ativo. Ele não recebe uma interface overlay adicional. A instância `digibot-whatsapp` também permanece somente na bridge `openbot` e não pode acessar o MCP.
- O MCP roda como contêiner Compose standalone, sem publicação de portas, com IP fixo `172.30.0.3` na bridge `openbot` e `10.0.3.10` na overlay interna `digibusca-dokploy-mcp-control`.
- A overlay interna conecta o MCP ao serviço `dokploy` na porta TCP 3000. Nenhum outro serviço DigiBusca, WhatsApp, Cloudflared ou Traefik entra nessa rede.
- Um chain de firewall próprio `DIGIBUSCA-MCP`, chamado pelo `DOCKER-USER`, libera somente `172.30.0.2` (OpenBot Ops) → `172.30.0.3:3000` e o retorno estabelecido. O IP do MCP não inicia conexões pela bridge. Pela rede de controle, pode iniciar conexões somente para a sub-rede `10.0.3.0/24` na porta 3000; respostas estabelecidas são permitidas e conexões novas para o MCP são bloqueadas.
- O firewall também descarta acesso do MCP aos serviços do host. As duas redes precisam permanecer sem IPv6. Não use `network_mode: host`, tarefa Swarm para o MCP, porta publicada, rota Cloudflare, Tunnel ou acesso público.
- A rede antiga `digibusca-mcp` (`internal=false`) continua ligada ao Dokploy por motivo legado; não conecte o MCP a ela. A overlay `digibusca-dokploy-mcp-client` não é usada e pode ser removida quando confirmado que está vazia.

O handler HTTP do pacote MCP não autentica clientes. Por isso, a porta 3000 só pode ser alcançada pelo OpenBot Ops autorizado; o firewall também impede o Dokploy e demais redes de iniciar chamadas ao endpoint. A interface MCP deve ser configurada apenas no agente Ops da instância remota. A instância de WhatsApp e qualquer outro agente não recebe essa URL nem essa rede.

## Preparação e ativação (concluída)

1. A chave permanece em `/etc/digibusca/hostgator/dokploy-mcp.env`, fora do Git e em modo `0600`; valide permissões sem imprimir o conteúdo.
2. As redes `openbot` e `digibusca-dokploy-mcp-control` e a política de firewall estão instaladas; ICC está desativado e IPv6 está desativado nas duas redes.
3. O serviço Dokploy foi conectado à rede interna de controle. O comando usado foi:

       docker service update --network-add digibusca-dokploy-mcp-control dokploy

4. `dokploy-mcp-firewall.sh` está instalado como `/usr/local/sbin/digibusca-dokploy-mcp-firewall` (modo `0750`) e sua unidade systemd reaplica a política após Docker e OpenBot firewall.
5. A matriz de rede foi testada sem segredos: Ops→MCP funciona; outras origens são bloqueadas; MCP→Dokploy funciona; egress público e acesso ao host são bloqueados.
6. A imagem foi construída e o Compose dedicado iniciado. O MCP está saudável e sem portas publicadas:

       docker compose -f /opt/digibusca/ops/hostgator/dokploy-mcp.compose.yaml up -d

7. Verificação concluída: MCP em `172.30.0.3`/`10.0.3.10`, 51 tools expostos e listagem somente leitura confirmada. O endpoint `http://172.30.0.3:3000/mcp` está configurado somente no OpenBot Ops. Não compartilhe com DigiBot WhatsApp.

Se algum teste de rede falhar, mantenha o MCP desligado. Para reverter, pare o Compose dedicado, remova somente o salto `DIGIBUSCA-MCP` de `DOCKER-USER` e os dois drops de `INPUT` criados para os IPs do MCP, apague o chain próprio e remova o Dokploy da rede de controle. Não altere regras dos chains Docker ou OpenBot. Não remova os volumes existentes.

## Rotação da chave

A rotina local e a rotina remota do DigiBot Ops estão ativas diariamente às 09:00 em `America/Sao_Paulo`. A emissão ocorreu em 18/11/2026 às 18:45:38 UTC; os avisos remotos são programados para 14, 7, 3 e 1 dia antes e no dia do vencimento. Se o OpenBot for fechado no horário, a rotina executa uma vez quando ele voltar. Ela não lê a chave; um responsável cria e grava a chave seguinte no painel e valida a conexão antes de revogar a anterior.
