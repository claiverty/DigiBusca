# DigiBusca

O DigiBusca é uma plataforma de prospecção digital para freelancers e agências que vendem sites e serviços de presença digital.

## Como funciona

1. O usuário pesquisa empresas por localização e segmento.
2. A aplicação organiza os dados públicos e identifica oportunidades de presença digital.
3. Leads podem ser salvos, classificados por status e acompanhados com observações, contatos e próximos passos.
4. Leads salvos com autorização registrada podem entrar numa fila de primeiro contato pela Evolution API (Baileys/WhatsApp Web); o backend local agenda os envios e registra o resultado no CRM.
5. Vendas podem ser registradas, editadas e acompanhadas em um resumo financeiro.

## Arquitetura

- `frontend/`: interface React, Vite e TypeScript.
- `backend/`: API TypeScript, regras de negócio e integrações externas.
- `supabase/`: migrations do PostgreSQL e políticas de isolamento por usuário.
- `.github/workflows/`: automação de qualidade do código.

O Supabase Auth gerencia as contas. O backend valida cada sessão e acessa os dados com o contexto do usuário; o PostgreSQL aplica Row Level Security para impedir acesso cruzado. As credenciais de serviços externos ficam somente no ambiente do backend.

## Integrações

- Google Places: pesquisa de empresas e dados públicos de localização.
- Gemini: geração de rascunhos de abordagem comercial.
- Evolution API com Baileys/WhatsApp Web: pareamento por QR Code, caixa de entrada, histórico, fila local e respostas Gemini configuráveis. Os runtimes de envio e resposta começam desligados.
- Supabase: autenticação e persistência de leads, interações e vendas.

## Desenvolvimento

```bash
npm install
```

Em um terminal, inicie a API local:

```bash
npm run backend:build
npm run backend:start
```

Em outro terminal, execute `npm run dev` para abrir a interface local.

As variáveis de ambiente necessárias estão exemplificadas em `frontend/.env.example` e `backend/.env.example`. Para verificar o projeto:

```bash
npm test
npm run build
```

As chaves e credenciais devem ser configuradas no ambiente de execução e nunca adicionadas aos arquivos versionados.

## Atualização do aplicativo

O build injeta um identificador de versão no frontend (`GITHUB_SHA` no CI; localmente, o commit Git, com fallback para a versão do pacote ou `dev`) e gera `app-version.json`. O Worker serve `/app-version.json` com `Cache-Control: no-store, max-age=0`. Quando a interface detecta que a versão publicada difere daquela carregada na aba, avisa o usuário; **Atualizar agora** recarrega a página para buscar a versão atual.

Após cada deploy, confira o identificador publicado e o cabeçalho de cache no endpoint público:

```bash
curl -fsS -D - 'https://SEU_DOMINIO/app-version.json'
```

Compare `version` com o commit do deploy e confirme `Cache-Control: no-store`. Para validar o aviso, mantenha uma aba anterior ao deploy aberta, aguarde a diferença ser detectada e clique em **Atualizar agora**. O endpoint não requer credenciais; não inclua cookies ou tokens no comando nem imprima variáveis de ambiente.

## Prospecção por conversa

A primeira mensagem tem somente uma saudação curta; aguarde a resposta. Depois, apresente-se quando o nome ou a forma de apresentação estiver informada e identifique quem cuida da presença digital. Conduza a conversa com uma pergunta por vez, passando por permissão, cenário, necessidade, ideia, qualificação de interesse e dúvidas. Para apresentar condições ou confirmar uma decisão, informe antes o escopo e as condições já acordadas; a IA não deve inventar preço, parcelas, prazo, desconto ou forma de pagamento. Recusas explícitas geram um encerramento respeitoso.

O assistente de prospecção gera somente a mensagem da etapa escolhida; a primeira saudação e o restante do contato são conduzidos manualmente. Registre necessidade, prazo, decisor e condições confirmadas em Observações, e use Próximo passo e Próximo contato para organizar a continuidade.

Para gerar rascunhos com o DigiProspector pelo OpenBot, consulte [docs/openbot-outreach.md](docs/openbot-outreach.md).

A carteira registra etapa da conversa, pessoa de contato e próximo passo. Permite pesquisar, ordenar por contato/nome/atualização, filtrar os contatos de hoje e exportar apenas a seleção atual com os dados de acompanhamento. Os filtros de telefone e leads salvos na busca são aplicados aos resultados de cada página; a ordenação também é por página.

## Prospecção pelo WhatsApp

A aba **WhatsApp → Conexão** pareia a Evolution API com um QR Code. A aba **WhatsApp → Prospecção** permite enfileirar leads salvos com autorização registrada. O limite diário configurável fica entre 17 e 25 novos leads; envios são espaçados entre 9h e 18h, de segunda a sexta, no fuso de São Paulo. O processamento acontece no backend local enquanto o Mac e a Evolution estiverem ativos. Respostas recebidas podem ser processadas pelo Gemini no mesmo backend quando a automação estiver ativada.

Para instalar e configurar a Evolution local, veja [backend/README.md](backend/README.md). A integração usa o webhook local autenticado; não usa a Cloud API nem o Worker para mensagens. Aplique as migrations `008_whatsapp_cloud_consent.sql` a `013_whatsapp_prospecting_queue.sql` antes de habilitar a fila.

Antes de executar esta versão contra um banco existente, aplique as migrations necessárias pelo fluxo autorizado.

`npm run test:e2e -- tests/e2e/lead-upgrade.spec.ts` verifica os novos fluxos em desktop e celular com componentes reais e serviços isolados, sem conta nem chamadas externas. A geração real com Gemini e a persistência real no Supabase exigem validação no ambiente configurado.
