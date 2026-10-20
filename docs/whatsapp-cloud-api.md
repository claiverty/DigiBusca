# WhatsApp Cloud API

O DigiBusca envia um template pela Cloud API somente após uma ação manual na tela do lead. O lead precisa estar salvo e a autorização explícita para receber mensagens precisa estar registrada, com a origem informada. Leads marcados como “Pediu para não receber” ficam bloqueados. A integração não faz disparos em lote nem envia mensagens automaticamente.

Um telefone publicado no Google não comprova autorização. Registre “Autorizou receber mensagens” apenas quando a pessoa tiver concordado em receber mensagens pelo WhatsApp naquele número. A política do WhatsApp exige essa autorização e um template aprovado para iniciar uma conversa pela API.

## Configuração

1. Configure uma conta do WhatsApp Business Platform e um número remetente na Meta.
2. Crie e obtenha aprovação para um template de marketing em português (`pt_BR`) com um parâmetro de texto no corpo. O DigiBusca envia o conteúdo editado no campo de abordagem como esse parâmetro; o texto precisa se encaixar no template que foi aprovado.
3. Configure no backend os valores abaixo. Não coloque o token em variáveis `VITE_`, no frontend ou no Git.

```dotenv
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_GRAPH_API_VERSION=vXX.X
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
```

No deploy Cloudflare, cadastre `WHATSAPP_ACCESS_TOKEN` como secret e os demais valores como variáveis/secrets do Worker. No ambiente local, use `backend/.env` (arquivo ignorado pelo Git).

## Uso

No detalhe do lead, salve o lead, registre a origem do consentimento, ajuste a mensagem ao template aprovado e clique em **Enviar pela API oficial**. O envio é individual e autenticado; há um limitador básico contra cliques repetidos. A resposta confirma que a API aceitou a mensagem, mas não garante entrega. O DigiBusca tenta salvar o ID da mensagem no histórico de interações.

Para parar contatos futuros, marque **Pediu para não receber** e salve as alterações. Isso bloqueia envios pela Cloud API no DigiBusca.

Referências oficiais: [política do WhatsApp Business](https://business.whatsapp.com/policy/preview?lang=pt_BR) e [documentação da WhatsApp Cloud API da Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-6909d472-3637-41d8-a338-c2fc14485f26).
