# Migração OpenBot → OpenClaw na VPS

## Estado deste preparo

Preparação local apenas. Nenhum serviço da VPS foi parado ou instalado, nenhum
QR foi lido e nenhum dado do OpenBot foi removido. O acesso SSH guardado no CI
é restrito ao deploy da imagem do backend; não permite instalar um serviço novo
nem administrar volumes. O corte depende de uma sessão interativa no painel da
HostGator/Dokploy.

## Arquivos preparados

- `openclaw.compose.yaml`: Gateway principal do Cristhian, imagem oficial
  fixada por digest, estado persistente, sem porta pública e ligado ao backend
  DigiBusca pela rede privada. O entrypoint oficial do container é preservado.
- `openclaw-workspace/extensions/digibusca-sync`: plugin do OpenClaw que passa
  mensagens recebidas pela política do DigiBusca, bloqueia saídas sem uma
  resposta ativa ou reserva da fila e sincroniza o histórico após o envio.
- `openclaw-workspace/openclaw.config.example.json5`: configuração do MCP,
  permissões do plugin, política de ferramentas limitada e webhook privado que
  acorda o Cristhian para cada item autorizado da fila.
- `openclaw.env.example` e `openclaw-backend.env.example`: modelos separados
  para credenciais do Gateway e do backend.
- `openclaw-workspace/AGENTS.md`: perfil inicial do Cristhian em PT-BR.
- `backup-evolution.sh`: manterá os backups existentes e acrescentará um
  arquivo OpenClaw criado e verificado pelo backup oficial antes de criptografar
  com `age`.

## O que a troca resolve — e o que precisa ser integrado

O OpenClaw pode possuir a sessão WhatsApp Web e receber/enviar mensagens por QR.
Isso remove a Evolution como transportadora da sessão do WhatsApp. Ainda será
uma sessão WhatsApp Web que pode desconectar, precisar de novo pareamento ou
ficar sujeita às regras do WhatsApp.

O Cristhian no OpenClaw será o agente principal, ligado ao WhatsApp pelo QR.
O servidor MCP privado do DigiBusca e o plugin de sincronização já foram
preparados no código. O OpenClaw poderá consultar e atualizar a carteira,
buscar empresas sem site e preparar contatos pela fila. Para responder ou
iniciar um contato, o plugin pede autorização ao backend: resposta exige uma
conversa ativa, aprovações vigentes e ausência de pausa/descadastro; primeiro
contato exige um item reservado na fila e autorização do titular ou consentimento
explícito registrado pelo contato. Os dois estados ficam separados; opt-out
sempre bloqueia o envio.
O backend continua como camada de dados e regras, sem criar um segundo agente.

Quando a prospecção estiver ativa e a conexão for `OPENCLAW_WEB`, o backend
processará um único contato elegível por ciclo. Ele reserva o item e envia uma
execução isolada ao webhook interno do Gateway; o Cristhian usa a ferramenta
nativa do WhatsApp para mandar exatamente a mensagem preparada. O plugin autoriza
o destinatário/texto e conclui a fila somente após a confirmação do WhatsApp.
Resultados incertos viram `unknown` e não são reenviados automaticamente, para
evitar duplicidade. O webhook usa token próprio e só fica acessível pela rede
privada entre backend e Gateway.

O MCP atual do Dokploy é administrativo e não deve ser conectado ao Cristhian.
Isso não o separa do WhatsApp ou do DigiBusca: o único agente Cristhian recebe
as ferramentas de CRM e prospecção necessárias por uma conexão privada. O
Gateway e a VPS não ficam expostos na internet. O backend valida conta, fila,
opt-out, janela e limites; uma mensagem de cliente não pode ampliar esses
limites nem iniciar uma campanha em massa.

## Corte planejado

1. **Preservar o estado atual.** Confirmar o backup diário mais recente, criar
   uma cópia extra criptografada com o backup atual e confirmar checksum e
   restauração. Manter a Evolution e os dados OpenBot intactos.
2. **Preparar configuração.** Criar `/etc/digibusca/hostgator/openclaw.env`
   como `root:root`, modo `0600`; escolher o provedor/modelo no Gateway; copiar
   o workspace de Cristhian para o volume persistente. Fixar `OPENCLAW_IMAGE`
   em `/etc/digibusca/hostgator/compose.env`, pois o Compose resolve a imagem
   antes de carregar o `env_file` do serviço. O exemplo fixa a release oficial
   `2026.11.6` pelo digest do registry; não use `latest`.
3. **Abrir memória para o novo runtime.** O console da VPS mostrou OOM
   encerrando processos OpenBot e OpenCode. Fazer backup primeiro, medir a
   memória e parar os runtimes pesados antigos mantendo volumes intactos antes
   de iniciar o OpenClaw. Não rodar os dois agentes de WhatsApp simultaneamente;
   rollback consiste em parar o OpenClaw e reativar o OpenBot. Usar a imagem
   pré-compilada em vez de compilar na VPS.
4. **Adicionar o serviço sem tráfego.** Implantar `openclaw-gateway` com o
   perfil `openclaw`, sem portas publicadas. Confirmar healthcheck, memória,
   logs sem segredos e persistência dos volumes antes do pareamento.
5. **Parear o QR.** Executar `openclaw channels login --channel whatsapp` no
   terminal interativo da VPS e ler o QR no WhatsApp do número da DigiUP. O QR
   é temporário e não deve ser enviado por chat, issue, log ou screenshot
   compartilhado. A configuração aceita mensagens diretas de novos clientes e
   bloqueia grupos; cada remetente tem um contexto isolado. O hook do DigiBusca
   ainda controla todas as mensagens de saída.
6. **Evitar resposta duplicada.** Pausar automações e a fila da Evolution
   durante a validação. Só um sistema pode responder ao mesmo número. Validar
   primeiro o inbound e uma resposta controlada; conferir a conversa no
   DigiBusca e conferir que opt-out e pausa humana continuam respeitados.
7. **Conectar o MCP, webhook e plugin privado.** Aplicar a migration 022,
   configurar os tokens separados de MCP, bridge e webhook nos containers,
   mesclar `openclaw.config.example.json5` à configuração existente e restringir as
   ferramentas MCP ao número pessoal do titular. Validar o MCP com
   `openclaw mcp doctor digibusca --probe` e o plugin com
   `openclaw plugins inspect digibusca-sync --runtime --json`.
8. **Registrar e validar sem tráfego de produção.** Depois de parear o QR,
   clicar em “Já pareei o QR · registrar sessão” na configuração do WhatsApp do
   DigiBusca. Isso associa a conta à configuração, mas não comprova que a sessão
   continua ativa; confirmar isso no terminal do OpenClaw. Manter a Evolution
   pausada e testar inbound, pausa, opt-out, resposta e fila com um número de teste com consentimento
   explícito. Confirmar que o hook bloqueia uma saída sem reserva, que um item
   de fila acorda automaticamente o Cristhian e que a mensagem enviada aparece
   no histórico do DigiBusca. O botão de busca prepara itens; a fila e o
   scheduler fazem o despacho respeitando intervalo e limite configurados.
9. **Migrar e observar.** Somente após o QR e as ferramentas estarem estáveis,
   ativar o Cristhian e a prospecção sob os limites existentes. Observar logs,
   estados de entrega, uso de memória e backups por pelo menos um ciclo diário.
10. **Retirar OpenBot com retorno disponível.** Quando o Cristhian principal e
   os backups estiverem estáveis, desligar as instâncias OpenBot da VPS, manter
   seus volumes e o backup criptografado por um período de recuperação e mover
   a rotina operacional do DigiBot Ops. Só apagar volumes após backup
   confirmado e pedido explícito de descarte.

## Limite operacional da VPS

A HostGator informada tem 4 GB RAM e 2 vCPU. O OpenClaw foi limitado neste
rascunho a 1 GB e 0,75 CPU, mas o limite não substitui medição real. O backend,
PostgreSQL/Evolution, Cloudflared e o DigiBot Ops também ocupam memória. Não
iniciar todos os serviços simultaneamente sem medir o uso; durante a troca,
reduzir a carga antiga somente depois de um backup recuperável.

O OpenClaw usa WhatsApp Web via Baileys e pareamento por QR, não a API oficial
da Meta. Essa diferença precisa ser aceita antes do corte. O DigiBot WhatsApp
recomendou não remover o runtime atual até haver prova de restauração, validação
do plugin no Gateway real e um caminho de rollback também para sessão/config do
OpenClaw. Os arquivos preparados ainda não estão aplicados na VPS.

## Backups

O Gateway oficial cria um arquivo consistente das sessões, configuração,
credenciais e dados dos agentes e verifica a cópia. O script diário mantém
`age` no host, inclui o arquivo verificado e os dados OpenBot que ainda
existirem. A retenção continua em 14 dias. O arquivo contém a sessão WhatsApp e
chaves de provedor: mantê-lo restrito e criptografado; não colocá-lo no Git nem
enviá-lo a agentes.

## Ações no terminal interativo durante a implantação

Os comandos exatos dependem do digest da imagem e do volume já criado. Depois
de instalar os arquivos e validar as variáveis, o pareamento deve usar o CLI
oficial dentro do container. O login via QR é um passo manual visível no
WhatsApp do titular e precisa ocorrer somente após o backup e a pausa das
respostas antigas.
