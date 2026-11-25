# Runtime do agente Cristhian

> **Escopo legado:** este documento descreve o runtime DigiBusca/Gemini
> introduzido na migration 019. O Cristhian operacional foi migrado para o
> OpenClaw, que controla a sessão WhatsApp Web; respostas e prospecção estão
> pausadas até a validação controlada. Para a configuração vigente, consulte
> [openclaw-garimpo-implementation.md](openclaw-garimpo-implementation.md)
> e [../ops/hostgator/README.md](../ops/hostgator/README.md).

O runtime DigiBusca executa o Cristhian dentro do backend já hospedado na VPS. Ele processa mensagens recebidas quando o webhook ou o ciclo de recuperação as entrega; não mantém um agente OpenBot ou um processo de modelo rodando em segundo plano. Cada execução é limitada por tempo, número de etapas e ferramentas.

## Limites do agente

- Responde conversas recebidas usando o histórico recente e os fatos aprovados do perfil.
- Com Google selecionado, tenta `gemini-3.5-flash` quando o modelo principal falha por indisponibilidade, limite, timeout ou resposta inválida. Falhas de autenticação não geram repetição com a mesma chave.
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

As chaves nunca são enviadas ao navegador. Alterar o modo, provedor ou modelo invalida a aprovação de conteúdo e desativa respostas até que sejam aprovadas novamente. A seleção do runtime DigiBusca não ativa a fila de prospecção.

## Estado atual e histórico deste runtime

Este runtime permanece desligado por padrão e não é o caminho de mensagens publicado. A migration 019 permanece aplicada por compatibilidade com o runtime legado. Em 25/11/2026, as respostas e a prospecção de produção estão pausadas; o transporte de WhatsApp é exclusivamente OpenClaw Web e a Evolution está parada para mensagens. O deploy não ativa automações por conta própria. Veja o documento de implementação OpenClaw para os controles, migrations 024–027 e validação pendente.

O histórico abaixo é diagnóstico do runtime Gemini legado, não prova que ele esteja ativo atualmente. As chamadas desse runtime usam a chave Gemini API cadastrada no painel de conexões. Em 20/11/2026, foram observadas respostas `429 RESOURCE_EXHAUSTED` na cota Free Tier para Gemini 3.5 Flash e `503 UNAVAILABLE` para Gemini 3.8 Flash. A assinatura Gemini CLI usa autenticação separada e não altera a cota da chave API.

O agente usa saída estruturada validada por schema, tenta uma vez novamente quando o Gemini retorna `503`, e limita uma execução a 30 segundos somando o modelo principal e o fallback. Um `429` de cota esgotada não é mascarado por resposta pronta: a conversa fica pendente para nova tentativa quando a cota for liberada ou o projeto tiver o tier adequado.
