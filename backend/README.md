# Backend

Camada reservada para a API Node.js/TypeScript, regras de domínio, repositórios e integrações externas.

As regras de qualificação, acesso a dados e integração com Google Places devem permanecer aqui ou em módulos de domínio compartilhados, nunca dentro dos componentes React.

## Próximas responsabilidades

- API de busca e leads
- validação de entradas
- persistência no Supabase/PostgreSQL
- autenticação e autorização
- adaptador do Google Places
- configuração de e-mail transacional mantida no Supabase Auth, usando Resend como SMTP

## Estrutura atual

- `src/contracts/`: contratos de entrada e saída da API.
- `src/data/`: dados temporários para desenvolvimento.
- `src/application/`: casos de uso que coordenam domínio e integrações.
- `src/domain/`: regras de negócio independentes do transporte HTTP.
- `src/integrations/`: fontes externas ou temporárias de leads.
- `src/http/`: servidor e rotas HTTP.

## API local

- `GET /api/health`: verifica se a API está disponível.
- `GET /api/leads?city=Formosa%2C%20Goi%C3%A1s&segment=Todos%20os%20segmentos`: busca leads mockados.
- `GET /api/saved-leads`: lista os leads salvos da conta autenticada.
- `POST /api/leads/:id/save`: salva um lead encontrado.
- `DELETE /api/leads/:id/save`: remove um lead salvo.
- `PATCH /api/leads/:id`: atualiza status, observações, follow-up e rascunho da abordagem.
- `GET /api/sales`: lista o histórico de vendas.
- `POST /api/sales`: registra uma venda manual ou vinculada a um lead.

Todas as rotas de negócio exigem um token Bearer do Supabase Auth. O backend valida o token e executa as consultas com o JWT do usuário, enquanto o PostgreSQL aplica RLS para impedir acesso cruzado entre contas. A migration está em `supabase/migrations/001_initial_persistence.sql`.

A busca ainda usa o `MockLeadProvider`, mas leads salvos e vendas já são persistidos no Supabase. A interface `LeadProvider` deixa a troca futura do mock pelo Google Places isolada, sem alterar o caso de uso ou o frontend.
