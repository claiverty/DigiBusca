# Acesso ao painel OpenClaw no navegador

O painel usa o túnel Cloudflare já existente, sem abrir porta da VPS e sem
ativar cobrança de Zero Trust. O Caddy pede autenticação HTTP Basic antes de
encaminhar a página e o WebSocket do painel. A senha é o token de Gateway
existente; o Gateway continua validando esse mesmo token. Assim, não há uma
segunda credencial a manter.

## Preparar a credencial

1. Copie `openclaw-panel.env.example` para
   `/etc/digibusca/hostgator/openclaw-panel.env` na VPS e aplique `root:root`
   com modo `0600`.
2. Gere `OPENCLAW_UI_PASSWORD_HASH` como bcrypt do valor atual de
   `OPENCLAW_GATEWAY_TOKEN` em `/etc/digibusca/hostgator/openclaw.env`. Não
   imprima nem registre o token ou o hash em logs.
3. Mantenha o Gateway token em um gerenciador de senhas. O nome de usuário HTTP
   é `claiverty14@gmail.com`; a senha HTTP e a senha do Gateway são o mesmo
   token.

## Ativar rota e verificar

1. Mescle `compose.yaml` com `openclaw.compose.yaml` e inicie os perfis
   `openclaw` e `tunnel`. A rede `digibusca-openclaw-ui` é interna, sem portas
   publicadas; apenas o Cloudflared e o proxy de autenticação alcançam esse
   painel.
2. O registro CNAME `openclaw` aponta para o mesmo túnel de
   `whatsapp-api.digiuptech.com.br`, com proxy ativado e TTL automático. A rota
   está publicada; o Gateway continua sem porta pública e exige as duas
   autenticações.
3. Confirme que `https://openclaw.digiuptech.com.br` exige a autenticação Basic
   antes de mostrar o painel. O painel também valida o token de Gateway e a
   origem HTTPS permitida. O proxy remove `Authorization`, `Proxy-Authorization`
   e cabeçalhos de identidade recebidos antes de encaminhar o acesso.
4. O link aparece no menu do perfil DigiBusca somente para
   `claiverty14@gmail.com`. Essa checagem de interface é conveniência; a
   autenticação real fica no proxy e no Gateway.

## Reversão

Remova o registro DNS `openclaw`, retire a rota de `cloudflared.config.yml` e
recrie apenas o contêiner Cloudflared. Depois remova o serviço de proxy e a rede
`digibusca-openclaw-ui`; não altere o token ou a sessão do WhatsApp.
