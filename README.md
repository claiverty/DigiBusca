# DigiBusca

O DigiBusca é uma plataforma de prospecção digital para freelancers e agências que vendem sites e serviços de presença digital.

## Como funciona

1. O usuário pesquisa empresas por localização e segmento.
2. A aplicação organiza os dados públicos e identifica oportunidades de presença digital.
3. Leads podem ser salvos, classificados por status e acompanhados com observações, contatos e próximos passos.
4. A IA gera uma sugestão de abordagem baseada nas informações encontradas. O usuário revisa o texto antes de abrir o canal de contato.
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
