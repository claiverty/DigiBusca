# DigiBusca — Requisitos do MVP

## Objetivo

Ajudar freelancers e agências que vendem sites a encontrar empresas locais com oportunidades de melhoria digital e organizar a prospecção.

O DigiBusca não é um construtor de sites, uma plataforma de anúncios ou uma ferramenta de disparo automático.

## Direção visual

- Seguir uma estética minimalista, clara e consistente com a identidade do DigiBusca.
- Usar tipografia limpa, hierarquia objetiva e uma ação principal por tela.
- Usar cards, tabelas, etiquetas e indicadores de forma leve e consistente.
- Priorizar clareza, acessibilidade e responsividade em todas as telas.

## Stack

- Frontend: React, Vite e TypeScript.
- Backend: Node.js e TypeScript.
- Persistência: PostgreSQL pelo Supabase, com migrations versionadas.
- Contas: Supabase Auth, com isolamento dos dados por usuário.
- Integrações: Google Places e Gemini.

## Funcionalidades

- Busca por cidade, região, país e segmento.
- Lista de empresas com dados públicos, contatos e sinais de oportunidade.
- Filtros por tipo de oportunidade e qualidade do lead.
- Ficha individual com diagnóstico, serviço recomendado, contatos e observações.
- Leads salvos com status, anotações, follow-ups e histórico de interações.
- Geração de abordagem personalizada como rascunho editável.
- Abertura do WhatsApp com mensagem preenchida, sem envio automático.
- Conversão de lead em venda e lançamento manual de vendas.
- Edição e exclusão de vendas com confirmação.
- Dashboard com indicadores de leads, follow-ups e vendas.
- Exportação de leads salvos para CSV.

## Privacidade e segurança

- Exibir a fonte e a data de consulta dos dados.
- Não coletar dados pessoais além dos contatos comerciais necessários.
- Não enviar mensagens sem aprovação explícita do usuário.
- Manter chaves e credenciais fora do código-fonte e do frontend.
- Validar o usuário no backend e aplicar Row Level Security no PostgreSQL.

## Organização técnica

- **Frontend:** interface, navegação, formulários, filtros e apresentação dos dados.
- **Backend/API:** autenticação, validação, busca, persistência e respostas para o frontend.
- **Domínio:** qualificação, pontuação, status, follow-ups e cálculos financeiros.
- **Integrações:** adaptadores isolados para serviços externos.

Cada módulo deve ter contratos claros de entrada e saída, mantendo a interface independente das integrações externas.
