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
- `backend/src/data/`: dados mockados compatíveis com os contratos da API.
- `backend/`: API Node.js, domínio, persistência e integrações.
- `REQUISITOS-MVP.md` e `DESIGN-SYSTEM.md`: decisões do produto e da interface.

## Stack planejada

- React, Vite e TypeScript no frontend
- Node.js e TypeScript no backend
- PostgreSQL e Supabase Auth
- Dados mockados antes da integração com Google Places

## Estado atual

Frontend inicial e API local de busca com dados mockados. As fases de prospecção, acompanhamento comercial e controle financeiro simples já estão disponíveis no preview local. O primeiro teste será realizado em Formosa-GO.

# DigiBusca
