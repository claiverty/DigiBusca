# DigiBusca — Requisitos do MVP

## Objetivo

Ajudar freelancers e agências que vendem sites a encontrar empresas locais com oportunidades de melhoria digital e organizar a prospecção.

O DigiBusca não é um construtor de sites, uma plataforma de anúncios ou uma ferramenta de disparo automático.

## Direção visual

- Seguir uma estética minimalista inspirada em produtos Apple e na referência BrandMyMac.
- Usar fundo claro, tipografia limpa, bastante respiro e hierarquia visual objetiva.
- Manter uma aparência premium, simples e agradável, sem excesso de elementos ou informações simultâneas.
- Destacar uma ação principal por tela.
- Usar cards, tabelas, etiquetas e indicadores de forma leve e consistente.
- Permitir pequenas interações que tornem a experiência mais fluida, sem transformar o produto em uma interface carregada.
- Não adicionar estilos, efeitos ou componentes visuais que não contribuam para clareza ou personalidade do produto.

## Referências de produto e experiência

- **Aivio:** referência para a proposta de valor, landing page e fluxo inicial de busca por cidade e segmento.
- **BrandMyMac e BrandMyLaptop:** referências para interação, organização de listagens, indicadores, atividade e personalidade visual.
- As referências orientam decisões de experiência, mas o DigiBusca deve manter marca, textos, identidade e regras próprias.

## Stack inicial

- Frontend: React, Vite e TypeScript.
- Backend: Node.js e TypeScript.
- Persistência inicial: PostgreSQL pelo Supabase, com migrations para facilitar manutenção e eventual migração.
- Desenvolvimento inicial: dados mockados com o mesmo contrato previsto para a integração Google Places.
- Contas desde o início: login social, logout e isolamento dos dados por usuário usando Supabase Auth. O cadastro por e-mail e senha não é obrigatório no MVP.

## Escopo do MVP completo

- Busca por cidade/região e segmento.
- Primeiro cenário de teste: Formosa-GO.
- Integração futura com Google Places; enquanto não houver credencial, usar dados de demonstração.
- Lista de empresas com nome, categoria, endereço, telefone, avaliações, horário e site quando disponível.
- Sinais de oportunidade: sem site, site antigo/fraco ou presença digital incompleta.
- Filtros por tipo de oportunidade e qualidade do lead.
- Ficha individual com diagnóstico, serviço recomendado, contatos e observações.
- Salvar lead e acompanhar status: novo, contatado, respondeu, proposta, ganhou e perdeu.
- Registrar próximo follow-up e histórico de interações.
- Gerar automaticamente uma abordagem personalizada com base nos dados e no diagnóstico do lead.
- Permitir editar a mensagem antes do envio e exigir aprovação explícita do usuário para qualquer envio.
- Oferecer um botão para abrir o WhatsApp com o número comercial e a mensagem preenchida por link nativo, sem integração com a API no MVP.
- Controle financeiro inspirado diretamente na aba Financeiro da Aivio, mantendo apenas os registros e indicadores que ela oferece até explorarmos essa tela por completo.
- Conversão integrada: ao converter um lead em cliente/venda dentro da ficha, criar o registro financeiro automaticamente com os dados já conhecidos, permitindo apenas completar ou ajustar o necessário.
- Lançamento manual: permitir registrar uma venda externa diretamente no Financeiro, mesmo sem lead associado.
- Jornada guiada: buscar, qualificar, abordar, acompanhar e registrar resultado.
- Dashboard com total de leads, leads por status, follow-ups próximos, vendas, custos e lucro estimado.
- Exportação dos leads salvos para CSV.
- Identificação da origem e da data da última atualização de cada dado.

## Fora do MVP

- Geração ou hospedagem de sites.
- Campanhas de anúncios.
- Integrações oficiais e disparos automáticos por WhatsApp, Instagram ou e-mail.
- Internacionalização completa.
- Recursos avançados de equipe e permissões.

## Fases de implementação do MVP

### Fase 1 — Prospecção

Busca, filtros, lista de leads, diagnóstico básico, ficha individual, dados de contato e salvamento.

### Fase 2 — Processo comercial

Status do funil, anotações, histórico, follow-ups e rascunhos de abordagem personalizados.

### Fase 3 — Controle financeiro

Replicar o fluxo e os campos essenciais observados na aba Financeiro da Aivio, sem acrescentar complexidade antes da validação. A venda pode ser criada a partir de um lead convertido ou lançada manualmente sem lead associado.

### Fase 4 — Escala SaaS

Equipes, permissões, planos, créditos, cobrança, métricas avançadas e expansão internacional. A autenticação e o isolamento por conta já existem desde o MVP.

## Modelo de dados inicial

- **Empresa:** nome, categoria, endereço, telefone, links, avaliações, horário e origem dos dados.
- **Lead:** empresa, tipo de oportunidade, pontuação, diagnóstico, serviço recomendado, status e data de criação.
- **Interação:** lead, canal, data, observação e resultado.
- **Tarefa:** lead, descrição, prazo, prioridade e conclusão.
- **Venda:** estrutura a confirmar a partir da aba Financeiro da Aivio; não adicionar campos além dos necessários para reproduzir seu fluxo.

## Regras de qualificação

- Não possui site: maior prioridade inicial.
- Possui site: analisar presença do endereço, compatibilidade com celular, atualização aparente e clareza das informações, quando possível.
- Perfil incompleto: considerar ausência de telefone, horário, descrição, fotos ou categoria, sem afirmar que o dado inexistente foi verificado fora da fonte.
- A pontuação deve ser explicável, exibindo os sinais que contribuíram para o resultado.
- Leads com o mesmo identificador ou combinação de nome, endereço e telefone devem ser agrupados para evitar duplicação.

## Privacidade e uso responsável

- Exibir a fonte e a data de consulta dos dados.
- Não coletar dados pessoais além dos contatos comerciais necessários.
- Não enviar mensagens sem aprovação explícita; toda mensagem gerada começa como rascunho.
- Permitir que o usuário corrija, arquive ou remova um lead salvo.
- Respeitar os termos das fontes de dados e as regras aplicáveis aos canais de contato.

## System design

O projeto deve manter responsabilidades separadas desde a primeira implementação:

- **Frontend:** telas, navegação, formulários, filtros, estados de carregamento e apresentação dos dados.
- **Backend/API:** autenticação futura, validação, busca, paginação, filtros, persistência e respostas para o frontend.
- **Domínio:** regras de qualificação, pontuação, status do funil, follow-ups e cálculos financeiros, sem depender da interface.
- **Integrações:** adaptadores isolados para Google Places e, futuramente, canais de contato. Nenhuma credencial deve ficar no frontend.
- **Canais no MVP:** links nativos para abrir WhatsApp/e-mail com dados preenchidos; o envio final acontece no aplicativo do usuário.
- **Persistência:** modelos e repositórios para empresas, leads, interações, tarefas e vendas.
- **Contas e segurança:** Supabase Auth desde o início; registros de negócio devem possuir vínculo com a conta proprietária e políticas de acesso devem impedir que um usuário veja dados de outro.
- **Configuração:** variáveis de ambiente, URLs e chaves mantidas fora do código-fonte.
- **Observabilidade:** erros, buscas e falhas de integração devem ser registráveis sem expor dados sensíveis.

Cada módulo deve ter contratos claros de entrada e saída. Dados mockados devem usar a mesma estrutura esperada pela integração real, para permitir a troca sem reescrever as telas.

## Critérios de aceite

1. O usuário consegue escolher uma cidade e um segmento e executar uma busca.
2. A lista apresenta leads sem duplicação visível e permite abrir uma ficha.
3. Cada lead informa claramente quais dados foram encontrados e quais são desconhecidos.
4. O usuário consegue salvar, anotar, alterar status e definir follow-up.
5. O diagnóstico explica por que o lead pode ser uma oportunidade.
6. A abordagem é gerada automaticamente, exibida como rascunho editável e só pode ser enviada após aprovação explícita.
7. O fluxo pode ser testado com dados mockados antes da integração ativa.
8. O dashboard resume a operação sem exigir cálculos manuais.
9. O usuário consegue exportar os leads salvos.
10. A pontuação mostra os motivos do diagnóstico e não apresenta suposições como fatos.
11. O usuário consegue converter um lead em venda e abrir o registro financeiro já preenchido.
12. O usuário consegue lançar manualmente uma venda externa no Financeiro.

## Evolução para SaaS

Depois da validação no uso próprio: equipes, permissões, planos, créditos, cobrança, integração oficial com Google Places, métricas de conversão e suporte a outros países.
