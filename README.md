# DigiBusca

O DigiBusca é uma plataforma de prospecção digital para freelancers e agências que vendem sites e serviços de presença digital.

## Como funciona

1. O usuário pesquisa empresas por localização e segmento.
2. A aplicação organiza os dados públicos e identifica oportunidades de presença digital.
3. Leads podem ser salvos, classificados por status e acompanhados com observações, contatos e próximos passos.
4. Na aba de prospecção do WhatsApp, o DigiBot pergunta a cidade do dia e pesquisa no Google Places. A busca salva candidatos cujo perfil não informa um site, mas não os enfileira nem envia mensagens. O titular seleciona os leads, revisa o texto e registra uma evidência de identidade antes de liberar cada contato. O despacho aprovado usa exclusivamente o WhatsApp Web do OpenClaw e sincroniza o resultado com o CRM.
5. Vendas podem ser registradas, editadas e acompanhadas em um resumo financeiro.

## Arquitetura

- `frontend/`: interface React, Vite e TypeScript.
- `backend/`: API TypeScript, regras de negócio e integrações externas.
- `supabase/`: migrations do PostgreSQL e políticas de isolamento por usuário.
- `.github/workflows/`: automação de qualidade do código.

Em cada push validado para `main`, o CI publica as imagens do backend e da Evolution no GitHub Container Registry. O resumo da execução informa referências imutáveis por digest para configurar no Dokploy; as imagens não incluem arquivos `.env`.

O Supabase Auth gerencia as contas. O backend valida cada sessão e acessa os dados com o contexto do usuário; o PostgreSQL aplica Row Level Security para impedir acesso cruzado. As credenciais de serviços externos ficam somente no ambiente do backend.

## Integrações

- Google Places: pesquisa de empresas e dados públicos de localização.
- Gemini: geração de rascunhos de abordagem comercial.
- OpenClaw com WhatsApp Web: agente Cristhian, respostas e despacho de prospecção após revisão. O backend DigiBusca valida identidade, autorização, opt-out, limites, janela e estado da conversa. A Evolution API está desativada para o fluxo de mensagens.
- Supabase: autenticação e persistência de leads, conversas, interações e vendas.

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

O playbook do Cristhian orienta a conversa com uma pergunta por vez, sem presumir o serviço desejado nem inventar condições comerciais. O primeiro contato comercial só pode sair depois de seleção, revisão da mensagem e conferência de identidade no DigiBusca.

Para gerar rascunhos com o DigiProspector pelo OpenBot, consulte [docs/openbot-outreach.md](docs/openbot-outreach.md).

A carteira registra etapa da conversa, pessoa de contato e próximo passo. Permite pesquisar, ordenar por contato/nome/atualização, filtrar os contatos de hoje e exportar apenas a seleção atual com os dados de acompanhamento. Os filtros de telefone e leads salvos na busca são aplicados aos resultados de cada página; a ordenação também é por página.

## Prospecção pelo WhatsApp

A aba **WhatsApp → Conexão** pareia o OpenClaw por QR Code. Em **WhatsApp → Prospecção**, o chat diário pergunta qual cidade usar; o segmento é opcional e Brasília, DF pode ser a sugestão inicial. A busca retorna empresas cujo perfil do Google Places não informa um site — isso não garante que a empresa não tenha site fora do perfil — e salva candidatos sem criar envios. O titular escolhe os contatos, revisa a mensagem e registra uma referência independente do telefone que vincule o perfil à empresa. Só então o contato pode entrar na fila do OpenClaw. O backend agenda até 17–25 novos contatos entre 9h e 14h, de segunda a sexta, no fuso de São Paulo, quando a prospecção estiver habilitada. Em 25/11/2026, respostas e prospecção estão pausadas até a validação controlada; a Evolution está desativada para mensagens. O estado publicado e os requisitos de ativação estão em [docs/openclaw-garimpo-implementation.md](docs/openclaw-garimpo-implementation.md) e [ops/hostgator/README.md](ops/hostgator/README.md).

Para o estado de produção e implantação do OpenClaw, veja [ops/hostgator/README.md](ops/hostgator/README.md). [docs/digibot-cristhian-runtime.md](docs/digibot-cristhian-runtime.md) descreve o runtime legado gerenciado pelo backend e não substitui o fluxo OpenClaw atualmente publicado. Para banco novo, aplique todas as migrations em `supabase/migrations/` em ordem; em produção as migrations 024–026 foram aplicadas em 25/11/2026.

Antes de executar esta versão contra um banco existente, aplique as migrations necessárias pelo fluxo autorizado.

`npm run test:e2e -- tests/e2e/lead-upgrade.spec.ts` verifica os novos fluxos em desktop e celular com componentes reais e serviços isolados, sem conta nem chamadas externas. A geração real com Gemini e a persistência real no Supabase exigem validação no ambiente configurado.
