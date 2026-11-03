# DigiBusca

O DigiBusca é uma plataforma de prospecção digital para freelancers e agências que vendem sites e serviços de presença digital.

## Como funciona

1. O usuário pesquisa empresas por localização e segmento.
2. A aplicação organiza os dados públicos e identifica oportunidades de presença digital.
3. Leads podem ser salvos, classificados por status e acompanhados com observações, contatos e próximos passos.
4. A IA gera uma sugestão de abordagem baseada nas informações encontradas. O usuário revisa o texto antes de abrir manualmente o canal de contato.
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
- WhatsApp: abertura manual da conversa pelo detalhe do lead. A integração com a API está desativada.
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

A primeira mensagem tem somente uma saudação curta; aguarde a resposta. Depois, apresente-se quando o nome ou a forma de apresentação estiver informada e identifique quem cuida da presença digital. Conduza a conversa com uma pergunta por vez, passando por permissão, cenário, necessidade, ideia, qualificação de interesse e dúvidas. Para apresentar condições ou confirmar uma decisão, informe antes o escopo e as condições já acordadas; a IA não deve inventar preço, parcelas, prazo, desconto ou forma de pagamento. Recusas explícitas geram um encerramento respeitoso.

O assistente de prospecção gera somente a mensagem da etapa escolhida; a primeira saudação e o restante do contato são conduzidos manualmente. Registre necessidade, prazo, decisor e condições confirmadas em Observações, e use Próximo passo e Próximo contato para organizar a continuidade.

Para gerar rascunhos com o DigiProspector pelo OpenBot, consulte [docs/openbot-outreach.md](docs/openbot-outreach.md).

A carteira registra etapa da conversa, pessoa de contato e próximo passo. Permite pesquisar, ordenar por contato/nome/atualização, filtrar os contatos de hoje e exportar apenas a seleção atual com os dados de acompanhamento. Os filtros de telefone e leads salvos na busca são aplicados aos resultados de cada página; a ordenação também é por página.

Antes de executar esta versão contra um banco existente, aplique as migrations necessárias pelo fluxo autorizado.

`npm run test:e2e -- tests/e2e/lead-upgrade.spec.ts` verifica os novos fluxos em desktop e celular com componentes reais e serviços isolados, sem conta nem chamadas externas. A geração real com Gemini e a persistência real no Supabase exigem validação no ambiente configurado.
