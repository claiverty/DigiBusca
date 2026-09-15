# Backend

API TypeScript responsável pela autenticação, regras de negócio, integrações e persistência do DigiBusca.

## Organização

- `src/contracts/`: contratos de entrada e saída.
- `src/application/`: casos de uso que coordenam as operações.
- `src/domain/`: regras de qualificação e geração de abordagem.
- `src/data/`: persistência no Supabase e armazenamento auxiliar.
- `src/integrations/`: adaptadores para serviços externos.
- `src/http/`: servidor local e Worker da API.

## Rotas principais

- `GET /api/health`: verifica se a API está disponível.
- `GET /api/leads?city={cidade}&segment={segmento}`: busca negócios pelo Google Places.
- `GET /api/saved-leads`: lista os leads salvos da conta autenticada.
- `GET /api/saved-leads/:id`: atualiza os dados de um lead salvo apenas quando ele é aberto.
- `POST /api/leads/:id/save`: salva um lead encontrado.
- `DELETE /api/leads/:id/save`: remove um lead salvo.
- `PATCH /api/leads/:id`: atualiza status, observações, follow-up e rascunho da abordagem.
- `GET /api/leads/:id/interactions`: lista o histórico de interações de um lead.
- `POST /api/leads/:id/interactions`: registra canal, data, observação e resultado de um contato.
- `GET /api/sales`: lista o histórico de vendas.
- `POST /api/sales`: registra uma venda manual ou vinculada a um lead.
- `PATCH /api/sales/:id`: corrige comércio, serviço, valor ou data de uma venda do usuário.
- `DELETE /api/sales/:id`: exclui uma venda do usuário.

Todas as rotas de negócio exigem um token Bearer do Supabase Auth. O backend valida o token e executa as consultas com o contexto do usuário; o PostgreSQL aplica RLS para impedir acesso cruzado entre contas.

As integrações ficam isoladas em adaptadores. A chave do Google Places e a chave do Gemini são lidas apenas do ambiente do backend. As migrations versionadas em `supabase/migrations/` definem tabelas, índices, permissões e políticas de acesso.
