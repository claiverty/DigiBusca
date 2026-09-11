# DigiBusca

Ferramenta de prospecção para freelancers e agências que vendem sites e serviços de presença digital.

## Proposta

Encontrar empresas locais com oportunidades digitais, explicar o problema identificado, gerar uma abordagem personalizada e organizar o acompanhamento comercial.

O DigiBusca não é um construtor de sites, uma plataforma de anúncios ou uma ferramenta de disparo automático.

## Documentação

- [Requisitos do MVP](REQUISITOS-MVP.md)
- [Direção de design](DESIGN-SYSTEM.md)

## Organização

- `frontend/src/components/`: componentes de interface e seus estilos locais.
- `frontend/src/pages/`: telas completas e suas regras de composição.
- `frontend/src/styles/`: tokens do design system e estilos globais mínimos.
- `backend/src/data/`: persistência e acesso aos dados do produto.
- `backend/`: API Node.js, domínio, persistência e integrações.
- `REQUISITOS-MVP.md` e `DESIGN-SYSTEM.md`: decisões do produto e da interface.

## Stack planejada

- React, Vite e TypeScript no frontend
- Node.js e TypeScript no backend
- PostgreSQL e Supabase Auth
- Supabase Auth para autenticação e e-mails de teste no MVP
- Busca real de negócios pelo Google Places API (New)

## Estado atual

Frontend e API estão publicados juntos em `https://digibusca.claiverty.workers.dev`. As fases de prospecção, acompanhamento comercial e controle financeiro simples estão disponíveis em produção. O Supabase Auth e a persistência por usuário estão ativos; os e-mails ainda usam o serviço padrão do Supabase durante a validação do MVP. A busca aceita qualquer cidade, região ou país informado pelo usuário. A chave do Google fica somente no ambiente do backend.

Durante o beta, o acesso é completo e não há quotas comerciais para os usuários. Google, Gemini e Cloudflare continuam sujeitos aos limites técnicos dos próprios serviços. A ficha de um lead com site faz uma verificação sob demanda para identificar disponibilidade, erros HTTP e ausência de HTTPS, sem criar novas chamadas ao Google Places.

## Testes

- `npm test`: executa os testes das regras de abordagem.
- `npm run test:e2e`: inicia frontend e backend e valida as rotas públicas e, quando configurada, a área autenticada em desktop e mobile.
- `npm run test:all`: executa as duas suítes locais.
- `PLAYWRIGHT_BASE_URL=https://seu-dominio npm run test:e2e`: executa o smoke test contra um ambiente publicado.

Os testes E2E usam o Google Chrome instalado na máquina e não criam contas nem alteram leads reais.

Para incluir a área autenticada, use uma conta exclusiva de teste:

```bash
E2E_USER_EMAIL=teste@exemplo.com E2E_USER_PASSWORD='senha-da-conta' npm run test:e2e
```

A suíte autenticada valida login, navegação, recarga direta das quatro áreas, ausência de rolagem horizontal e os fluxos de acompanhamento, interação, abordagem com IA, conversão, venda manual e exportação CSV. As mutações são interceptadas pelo navegador e usam dados isolados, portanto não alteram leads nem vendas reais. Sem essas variáveis, a suíte autenticada é ignorada e apenas os testes públicos são executados. Não salve as credenciais no repositório.

## Integração contínua

O workflow `.github/workflows/ci.yml` executa auditoria de dependências, TypeScript, testes unitários, build e testes E2E em desktop e mobile a cada push e pull request.

Os testes públicos não dependem de segredos. Para habilitar também os testes autenticados no GitHub Actions, configure estes Secrets no repositório:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`

Use uma conta exclusiva de teste. A chave anônima do Supabase pode ser usada no frontend; nunca configure a chave `service_role` nesse workflow.

### Deploy automático

Depois que o CI for aprovado, o workflow pode publicar a `main` automaticamente na Cloudflare. Configure:

- Secret `CLOUDFLARE_ACCOUNT_ID` com o ID da conta.
- Secret `CLOUDFLARE_API_TOKEN` com um token restrito à conta do DigiBusca e permissão para editar Workers.
- Variable `CLOUDFLARE_DEPLOY_ENABLED` com o valor `true` para ativar o deploy.
- Variable opcional `PRODUCTION_URL` caso o endereço publicado deixe de ser `https://digibusca.claiverty.workers.dev`.

O job de produção só roda em pushes na branch `main`, depois de todos os testes, e encerra validando o health check da API. Os segredos de runtime do Worker continuam configurados diretamente na Cloudflare e não devem ser colocados no repositório.
