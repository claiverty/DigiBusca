# Migração OpenBot → OpenClaw na VPS

## Estado em 23/11/2026

- O Gateway OpenClaw `2026.11.6` está instalado na VPS, saudável, sem porta
  publicada e ligado ao DigiBusca por uma overlay interna. O backend também está
  saudável; o endpoint MCP respondeu e listou as cinco ferramentas permitidas.
- O estado e os perfis persistem em volumes Docker. O plugin oficial
  `@openclaw/whatsapp@2026.11.6` está instalado, mas `channels.whatsapp.enabled`
  permanece `false`: nenhum QR foi lido e não existe sessão WhatsApp no OpenClaw.
- `WHATSAPP_OPENCLAW_RUNTIME_ENABLED=false` no backend. O OpenBot e a Evolution
  continuam ativos; não houve corte nem envio pelo OpenClaw.
- O modelo configurado é `google/gemini-4-hydrogen`, sem credencial no ambiente
  do OpenClaw. Nenhuma chamada de modelo está habilitada. O plano pessoal AI Pro
  não foi autenticado nem os créditos de US$ 10 foram aplicados à conta Cloud.
- O Gateway tem limite de 1 GiB/0,75 CPU. As medições em repouso oscilaram de
  ~694 a 847 MiB e os logs registraram pico de ~954 MiB, com alerta crítico
  perto do limite. O host tinha ~937 MiB disponíveis e ~1 GiB de swap usado;
  não ligar o WhatsApp junto aos serviços OpenBot sem reduzir a carga e medir de
  novo.
- O timer de backup diário está ativo. O backup oficial do OpenClaw passou a
  verificação em um arquivo temporário; o próximo backup diário criptografado
  incluirá o estado OpenClaw. Nenhum dado OpenBot foi removido.

## Arquivos de implantação

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

## Próximas etapas do corte

1. **Concluir a autenticação do modelo.** O Hydrogen está selecionado, mas ainda
   não há credencial compatível no Gateway. O plano pessoal AI Pro não está
   conectado ao OpenClaw por CLI/OAuth; escolher uma autenticação suportada antes
   de habilitar respostas. Os créditos de desenvolvedor Google não foram
   resgatados nem vinculados à conta Cloud.
2. **Confirmar o backup diário criptografado com OpenClaw.** O comando oficial
   `openclaw backup create --verify` passou no teste no contêiner. O próximo
   ciclo do timer vai gerar o arquivo `.age` completo com OpenClaw e checksum;
   manter os volumes OpenBot intactos.
3. **Preparar o corte de tráfego.** Antes de ativar ou parear o WhatsApp no
   OpenClaw, pausar respostas e fila antigas para não operar dois agentes no
   mesmo número. Medir memória e preservar o rollback: parar OpenClaw e reativar
   OpenBot, sem apagar volumes.
4. **Parear o QR.** Quando o modelo e o backup estiverem prontos, executar
   `openclaw channels login --channel whatsapp` no terminal da VPS e ler o QR no
   WhatsApp da DigiUP. O QR é temporário: não enviar por chat, issue, log ou
   screenshot. A configuração permite mensagens diretas e bloqueia grupos.
5. **Registrar e validar sem tráfego de produção.** Depois do QR, registrar a
   conexão no painel DigiBusca e confirmar que a sessão continua ativa. Com um
   número de teste e consentimento explícito, validar inbound, resposta, pausa,
   opt-out e fila; conferir que uma saída sem reserva é bloqueada e que as
   mensagens aparecem no histórico.
6. **Migrar e observar.** Só depois desses passos ativar respostas e prospecção,
   respeitando as janelas e limites existentes. Observar estados de entrega,
   memória e backups por pelo menos um ciclo diário.
7. **Retirar OpenBot com retorno disponível.** Depois da estabilidade, desligar
   as instâncias OpenBot e manter seus volumes e backups criptografados pelo
   período de recuperação. Apagar volumes somente após backup confirmado e
   pedido explícito.

## Limite operacional da VPS

A HostGator informada tem 4 GB RAM e 2 vCPU. O OpenClaw está limitado a 1 GiB
e 0,75 CPU; medições em repouso oscilaram entre ~694 e 847 MiB, com pico de
~954 MiB e alertas críticos perto do limite. Com os serviços OpenBot, backend,
Evolution, Cloudflared e Dokploy ligados, o host tinha ~937 MiB disponíveis e
~1 GiB de swap usado. O limite de contêiner evita crescimento ilimitado, mas
não torna seguro ativar dois agentes de WhatsApp ao mesmo tempo.

O OpenClaw usa WhatsApp Web via Baileys e pareamento por QR, não a API oficial
da Meta. Essa diferença precisa ser aceita antes do corte. O Gateway já passou
no healthcheck; o plugin `digibusca-sync` carregou e o MCP listou cinco tools.
Ainda falta autenticar um modelo, parear o QR, testar o fluxo real e completar
um backup diário criptografado que inclua o novo estado.

## Backups

O Gateway oficial cria um arquivo consistente das sessões, configuração,
credenciais e dados dos agentes e verifica a cópia. O comando de backup passou
na verificação com o volume OpenClaw atual. O script diário criptografa esse
arquivo com `age`, inclui os dados OpenBot que ainda existirem e retém 14 dias.
O último arquivo diário completo antecede a instalação do OpenClaw; o próximo
ciclo incluirá o Gateway. O arquivo contém sessão WhatsApp e chaves de
provedor: mantê-lo restrito e criptografado; não colocá-lo no Git nem enviá-lo a
agentes.

## Ações no terminal interativo durante a implantação

Os comandos exatos dependem do digest da imagem e do volume já criado. Depois
de instalar os arquivos e validar as variáveis, o pareamento deve usar o CLI
oficial dentro do container. O login via QR é um passo manual visível no
WhatsApp do titular e precisa ocorrer somente após o backup e a pausa das
respostas antigas.
