# Migração OpenBot → OpenClaw na VPS

## Estado em 23/11/2026

- OpenClaw `2026.11.6` e backend DigiBusca estão saudáveis na VPS; o backend
  publicado e o Worker informam a mesma revisão ativa.
- O WhatsApp Web do OpenClaw está pareado, conectado e saudável, sem erro nem
  tentativas de reconexão. O Gateway continua sem porta pública e mantém seus
  dados em volumes persistentes.
- O runtime OpenClaw está habilitado no backend. `digibusca-sync` está carregado
  com os hooks `before_dispatch`, `message_sending` e `message_sent`, sem
  diagnósticos. O hook de entrada usa o ponto global anterior à execução do
  modelo para registrar e autorizar a conversa no backend.
- A API da Evolution está parada, com reinício automático desligado. Seu
  endpoint retorna HTTP 410. O PostgreSQL legado da Evolution permanece ligado
  somente porque o backup diário o usa para criar o dump criptografado; volumes
  antigos foram preservados.
- CI validou 65 testes unitários e 42 testes E2E desktop/mobile. As tentativas
  anteriores falharam antes da correção do hook. Ainda é preciso confirmar uma
  resposta real depois dela, usando uma conversa de WhatsApp de um segundo número.
- A fila de prospecção não foi acionada por esta implantação. Ela respeita os
  dias úteis, a janela das 9h às 14h (`America/Sao_Paulo`), os limites e os
  consentimentos já registrados.
- O timer diário de backup permanece ativo. A execução manual de 23/11 às 22:15
  BRT incluiu o snapshot OpenClaw verificado pelo CLI oficial; os quatro arquivos
  `.age` passaram por checksum e conferência do cabeçalho criptografado.

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
- `backup-evolution.sh`: mantém os backups existentes, cria e verifica o
  snapshot oficial do OpenClaw, transmite-o diretamente para criptografia com
  `age` e conserva 14 dias.

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

## Verificação pendente

1. Enviar uma mensagem de teste de um segundo telefone ao WhatsApp pareado e
   confirmar a resposta do Cristhian e a sincronização de entrada/saída no
   histórico DigiBusca. As tentativas anteriores foram antes da correção.
2. Em uma prospecção futura, dentro da janela configurada e com leads elegíveis,
   conferir um envio autorizado. Esta implantação não enviou mensagem comercial.
3. Manter a API Evolution parada e os volumes antigos preservados para rollback.

## Limite operacional da VPS

O plano da VPS tem 4 GB RAM e 2 vCPU. O Gateway OpenClaw está limitado a 1,5 GiB
e 0,75 CPU. Após a execução do backup, uma amostra mostrou ~863 MiB no Gateway,
1,9 GiB disponíveis no host e 738 MiB de swap em uso. O host não está no limite,
mas acompanhe memória e swap; o aviso de pressão registrado durante o backup
merece nova observação sob tráfego real.

O OpenClaw usa WhatsApp Web via Baileys e pareamento por QR, não a API oficial
da Meta. Essa é a sessão ativa da conta DigiBusca. O Gateway está saudável, o
WhatsApp aparece conectado sem reconexões e `digibusca-sync` está carregado.
Falta comprovar uma resposta real recebida após a correção do hook.

## Backups

O arquivo `/var/backups/digibusca/evolution/20261124T011541Z` foi criado em
23/11 às 22:15 BRT. O CLI oficial verificou o snapshot OpenClaw antes da
criptografia. Os quatro arquivos `.age` passaram por SHA-256 e pelo cabeçalho
`age-encryption.org/v1`; todos estão `root:root`, modo `0600`. A rotina diária
retém 14 dias, e o timer segue ativo às 03:00 BRT. O snapshot contém a sessão
WhatsApp e credenciais: mantenha a chave privada fora da VPS e os arquivos
restritos; não os coloque no Git nem os envie a agentes.

## Transporte ativo

O OpenClaw é o único transporte WhatsApp em produção. A Evolution API está
parada e seu webhook antigo retorna HTTP 410. O Postgres da Evolution fica ativo
somente para preservar e copiar os dados legados no backup diário.
