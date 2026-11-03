# Rascunhos com agentes do OpenBot

O DigiBusca pode pedir ao agente `DigiProspector` um rascunho de abordagem e importar o resultado para o campo de mensagem do lead. O agente não envia mensagens; revise o rascunho e use o canal de contato manualmente, se decidir prosseguir.

## Ativar a conexão local

1. No OpenBot, abra as configurações do agente `DigiProspector`, entre em **Permissões** e ative **Local scripts**. A API local do OpenBot só lista agentes com essa permissão ativa.
2. No computador que mantém o OpenBot aberto, inicie a ponte local do DigiBusca com `npm run backend:build` e `npm run backend:start`. Ela escuta somente em `127.0.0.1:3001` e lê a URL e o token temporário criados pelo próprio OpenBot em `~/Library/Application Support/OpenBot/automation/`.
3. Para usar a versão publicada do DigiBusca, adicione a origem exata do site em `DIGIBUSCA_APP_ORIGINS` no `backend/.env`. O exemplo inclui `https://digibusca.claiverty.workers.dev`; substitua ou acrescente a origem de produção correta. Reinicie o backend depois de alterar essa variável.
4. No detalhe de um lead, escolha **Agente do OpenBot**, selecione `DigiProspector` e gere o rascunho. O DigiBusca consulta a conclusão da tarefa e valida o formato e as regras comerciais antes de mostrar a mensagem.

O DigiProspector precisa estar no mesmo servidor OpenBot que está aberto neste computador. Agentes em outro servidor OpenBot não aparecem pela ponte de loopback. O token do OpenBot nunca vai para o navegador. O DigiBusca envia apenas nome da empresa, segmento, sinais do perfil público, serviço oferecido e contexto da conversa.

**Local scripts** permite que programas locais interajam com o agente e também leiam solicitações pendentes, enviem respostas a perguntas ou aprovações, alterem modelo/conta e iniciem uma nova conversa. O DigiBusca usa somente as rotas de mensagem e leitura do resultado. A permissão deve ser ativada no próprio OpenBot; a integração não a altera.
