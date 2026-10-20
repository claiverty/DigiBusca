# DigiBusca

O DigiBusca é uma plataforma de prospecção digital para freelancers e agências que vendem sites e serviços de presença digital.

## Como funciona

1. O usuário pesquisa empresas por localização e segmento.
2. A aplicação organiza os dados públicos e identifica oportunidades de presença digital.
3. Leads podem ser salvos, classificados por status e acompanhados com observações, contatos e próximos passos.
4. A IA gera uma sugestão de abordagem baseada nas informações encontradas. O usuário revisa o texto antes de abrir o canal de contato; o envio pela Cloud API exige autorização registrada e template aprovado.
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
- WhatsApp Business Cloud API: envio individual de templates aprovados para contatos com autorização explícita registrada.
- Supabase: autenticação e persistência de leads, interações e vendas.

## Desenvolvimento

```bash
npm install
npm run dev
```

As variáveis de ambiente necessárias estão exemplificadas em `frontend/.env.example` e `backend/.env.example`. Para verificar o projeto:

```bash
npm test
npm run build
```

As chaves e credenciais devem ser configuradas no ambiente de execução e nunca adicionadas aos arquivos versionados.

## Prospecção por conversa

A mensagem padrão abre com um cumprimento curto. O assistente gera somente a mensagem da etapa escolhida: abertura, identificação do responsável, permissão, entendimento do cenário, necessidade, ideia, retorno ou encerramento. O contexto da resposta é informado pelo usuário; o aplicativo não lê respostas do WhatsApp. A IA e os modelos locais usam a mesma regra de etapas. Recusas explícitas detectadas geram um encerramento respeitoso.

A carteira registra etapa da conversa, pessoa de contato e próximo passo. Permite pesquisar, ordenar por contato/nome/atualização, filtrar os contatos de hoje e exportar apenas a seleção atual com os dados de acompanhamento. Os filtros de telefone e leads salvos na busca são aplicados aos resultados de cada página; a ordenação também é por página.

Antes de executar esta versão contra um banco existente, aplique `supabase/migrations/007_conversation_tracking.sql` e `supabase/migrations/008_whatsapp_cloud_consent.sql` pelo fluxo de migrations do ambiente. Elas acrescentam campos de acompanhamento e consentimento, preservando as políticas RLS existentes. Faça isso antes de publicar a API, pois as consultas passam a selecionar essas colunas. A configuração da Cloud API está em [docs/whatsapp-cloud-api.md](docs/whatsapp-cloud-api.md).

`npm run test:e2e -- tests/e2e/lead-upgrade.spec.ts` verifica os novos fluxos em desktop e celular com componentes reais e serviços isolados, sem conta nem chamadas externas. A geração real com Gemini e a persistência real no Supabase exigem validação no ambiente configurado.
