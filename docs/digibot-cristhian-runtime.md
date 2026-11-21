# Runtime do agente Cristhian

O runtime DigiBusca executa o Cristhian dentro do backend já hospedado na VPS. Ele processa mensagens recebidas quando o webhook ou o ciclo de recuperação as entrega; não mantém um agente OpenBot ou um processo de modelo rodando em segundo plano. Cada execução é limitada por tempo, número de etapas e ferramentas.

## Limites do agente

- Responde conversas recebidas usando o histórico recente e os fatos aprovados do perfil.
- Com Google selecionado, usa raciocínio `low` para reduzir latência. Se Hydrogen falhar, tenta `gemini-3.8-flash` e depois `gemini-3.5-flash`. Falhas de autenticação não geram repetição com a mesma chave.
- Pode registrar tipo de projeto, objetivo, prioridade, prazo e interesse de serviço somente quando o valor aparece literalmente em uma citação de mensagem recebida do lead.
- Guarda essa qualificação por até 90 dias e a remove ao registrar descadastro.
- Pode sinalizar atendimento humano. A pausa, o estado da conversa, a janela de atendimento e o envio de mensagem continuam sob controle do backend.
- Não pesquisa nem seleciona leads, não inicia prospecção, não chama ferramentas externas e não envia mensagens por conta própria.

A prospecção continua usando a fila existente do DigiBusca e suas validações. OpenBot permanece opcional para a geração de respostas; não é necessário para o runtime DigiBusca.

O titular da conta confirmou que os leads retornados pela busca do DigiBusca são autorizados para contato. O backend grava essa origem quando salva resultados Google Maps e atualiza leads antigos dessa origem ainda marcados como `unknown`. Registros `opted_out` nunca são promovidos. A fila ainda precisa que um lead e sua mensagem sejam adicionados pela tela; o worker só despacha itens enfileirados.

## Configuração

1. A migration `supabase/migrations/019_digibot_agent_runtime.sql` já foi aplicada ao Supabase de produção em 19/11/2026. Ela adiciona o modo, a configuração do provedor e a tabela de qualificação com acesso de leitura limitado ao dono da conta.
2. Configure no ambiente privado do backend somente as credenciais do provedor escolhido:
   - Google: `GEMINI_API_KEY`.
   - Anthropic: `ANTHROPIC_API_KEY`.
   - Provedor compatível com OpenAI: `OPENAI_COMPATIBLE_API_KEY` e `OPENAI_COMPATIBLE_BASE_URL` HTTPS confiável.
3. No backend da VPS, habilite `WHATSAPP_DIGIBOT_AGENT_RUNTIME_ENABLED=true`. `WHATSAPP_AUTOMATION_RUNTIME_ENABLED` já está ativo em produção. O deploy reinicia o backend e carrega as variáveis privadas.
4. Na tela **WhatsApp → Conexão**, selecione **Agente Cristhian gerenciado pelo DigiBusca**, escolha provedor e modelo, confira os fatos comerciais e rota humana e salve as aprovações do canal e conteúdo antes de ativar respostas.

As chaves nunca são enviadas ao navegador. Alterar o modo, provedor ou modelo invalida a aprovação de conteúdo e desativa respostas até que sejam aprovadas novamente. A migration `022_whatsapp_gemini_4_hydrogen.sql` atualiza perfis Google do Cristhian para Hydrogen, limpa a aprovação anterior e pausa o envio para revisão no painel. A seleção do runtime DigiBusca não ativa a fila de prospecção.

## Estado deste código

O runtime permanece desligado por padrão no código. Após aplicar a migration `022_whatsapp_gemini_4_hydrogen.sql`, o perfil usa Gemini 4 Hydrogen com raciocínio baixo e fallback para 3.8 Flash e 3.5 Flash. A troca pausa respostas e invalida a aprovação anterior; revise o modelo no painel, aprove o conteúdo novamente e reative a automação. A sessão da Evolution está `open`. O deploy não ativa respostas por conta própria.

As chamadas do agente usam a chave da Gemini API cadastrada no painel de conexões; essa chave herda o tier do projeto do Google AI Studio. Uma assinatura usada pelo Gemini CLI com login Google pode seguir outra autenticação e não altera o tier da chave da API. Confirme o projeto e o tier em [Rate limits](https://aistudio.google.com/rate-limit) e [Billing](https://aistudio.google.com/billing). Em 20/11/2026, a API respondeu ao DigiBusca com `429 RESOURCE_EXHAUSTED` para a cota `GenerateRequestsPerDayPerProjectPerModel-FreeTier` do Gemini 3.5 Flash (limite diário de 20); o Gemini 3.8 Flash também retornou `503 UNAVAILABLE`. Para habilitar o tier pago da Gemini API, vincule uma conta de faturamento ao projeto da chave em AI Studio. Isso é uma configuração de cobrança separada e pode gerar custos.

O agente usa saída estruturada validada por schema, solicita raciocínio baixo ao Google, limita cada tentativa a 10 segundos e a execução a 24 segundos, e tenta os modelos de contingência quando há erro recuperável. Um `429` de cota esgotada não é mascarado por resposta pronta: a conversa fica pendente para nova tentativa quando a cota for liberada ou o projeto tiver o tier adequado.
