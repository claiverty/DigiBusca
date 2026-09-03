# Backend

Camada reservada para a API Node.js/TypeScript, regras de domínio, repositórios e integrações externas.

As regras de qualificação, acesso a dados e integração com Google Places devem permanecer aqui ou em módulos de domínio compartilhados, nunca dentro dos componentes React.

## Próximas responsabilidades

- API de busca e leads
- validação de entradas
- persistência no Supabase/PostgreSQL
- autenticação e autorização
- adaptador do Google Places

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
- `GET /api/saved-leads`: lista os leads salvos durante a sessão da API.
- `POST /api/leads/:id/save`: salva um lead encontrado.
- `DELETE /api/leads/:id/save`: remove um lead salvo.

O servidor usa apenas módulos nativos do Node neste momento. Isso mantém o MVP sem custo. Os leads salvos ficam temporariamente em memória até a integração com Supabase. A interface `LeadProvider` deixa a troca futura do mock pelo Google Places isolada, sem alterar o caso de uso ou o frontend.
