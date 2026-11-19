# Runtime do agente Cristhian

O runtime DigiBusca executa o Cristhian dentro do backend já hospedado na VPS. Ele processa mensagens recebidas quando o webhook ou o ciclo de recuperação as entrega; não mantém um agente OpenBot ou um processo de modelo rodando em segundo plano. Cada execução é limitada por tempo, número de etapas e ferramentas.

## Limites do agente

- Responde conversas recebidas usando o histórico recente e os fatos aprovados do perfil.
- Com Google selecionado, tenta `gemini-3.5-flash` quando o modelo principal falha por indisponibilidade, limite, timeout ou resposta inválida. Falhas de autenticação não geram repetição com a mesma chave.
- Pode registrar tipo de projeto, objetivo, prioridade, prazo e interesse de serviço somente quando o valor aparece literalmente em uma citação de mensagem recebida do lead.
- Guarda essa qualificação por até 90 dias e a remove ao registrar descadastro.
- Pode sinalizar atendimento humano. A pausa, o estado da conversa, a janela de atendimento e o envio de mensagem continuam sob controle do backend.
- Não pesquisa nem seleciona leads, não inicia prospecção, não chama ferramentas externas e não envia mensagens por conta própria.

A prospecção continua usando a fila existente do DigiBusca e suas validações. OpenBot permanece opcional para a geração de respostas; não é necessário para o runtime DigiBusca.

## Configuração

1. A migration `supabase/migrations/019_digibot_agent_runtime.sql` já foi aplicada ao Supabase de produção em 19/11/2026. Ela adiciona o modo, a configuração do provedor e a tabela de qualificação com acesso de leitura limitado ao dono da conta.
2. Configure no ambiente privado do backend somente as credenciais do provedor escolhido:
   - Google: `GEMINI_API_KEY`.
   - Anthropic: `ANTHROPIC_API_KEY`.
   - Provedor compatível com OpenAI: `OPENAI_COMPATIBLE_API_KEY` e `OPENAI_COMPATIBLE_BASE_URL` HTTPS confiável.
3. No backend da VPS, habilite `WHATSAPP_DIGIBOT_AGENT_RUNTIME_ENABLED=true`. `WHATSAPP_AUTOMATION_RUNTIME_ENABLED` já está ativo em produção. O deploy reinicia o backend e carrega as variáveis privadas.
4. Na tela **WhatsApp → Conexão**, selecione **Agente Cristhian gerenciado pelo DigiBusca**, escolha provedor e modelo, confira os fatos comerciais e rota humana e salve as aprovações do canal e conteúdo antes de ativar respostas.

As chaves nunca são enviadas ao navegador. Alterar o modo, provedor ou modelo invalida a aprovação de conteúdo e desativa respostas até que sejam aprovadas novamente. A seleção do runtime DigiBusca não ativa a fila de prospecção.

## Estado deste código

O runtime permanece desligado por padrão no código. Em produção, a migration está aplicada, o perfil usa o agente Cristhian do DigiBusca com Google Gemini 3.8 Flash e fallback 3.5 Flash, e as respostas estão aprovadas e ativas. A sessão da Evolution está `open`. O deploy não troca o modo persistido nem ativa respostas por conta própria.
