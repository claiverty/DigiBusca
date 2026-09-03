# DigiBusca — Direção de design

## Princípio

Uma ferramenta premium e simples para transformar pesquisa local em oportunidade comercial. A interface deve esconder a complexidade e destacar sempre o próximo passo.

## Referências

BrandMyMac e BrandMyLaptop são referências de clareza, espaço, personalidade e interação. O DigiBusca deve ter identidade própria e não reutilizar marca, textos ou elementos proprietários dessas referências.

## Interface

- Fundo claro e superfícies brancas.
- Tipografia sans-serif limpa e legível.
- Preto suave para títulos e cinzas para textos auxiliares.
- Uma cor de ação principal, usada com moderação.
- Bordas discretas, cantos suaves e sombras quase imperceptíveis.
- Espaçamento generoso e hierarquia visual evidente.
- Uma ação principal por tela.
- Estados claros para carregando, vazio, sucesso e erro.

## Componentes principais

- Barra lateral compacta para navegação.
- Campo de busca com cidade/região e segmento.
- Indicadores resumidos do funil.
- Lista de leads com etiquetas de oportunidade.
- Ficha lateral ou página de detalhes do lead.
- Botões de ação para salvar, abordar e abrir contato.
- Jornada guiada com passos curtos.
- Tabela financeira simples e legível.

## Organização no código

- `frontend/src/styles/tokens.css`: cores, tipografia, raios, sombras e dimensões compartilhadas.
- `frontend/src/styles/base.css`: reset, tipografia base, superfícies e controles reutilizáveis.
- `frontend/src/App.css`: somente o shell da aplicação e o layout geral.
- `frontend/src/pages/*.css`: composição visual de cada tela.
- `frontend/src/components/*.css`: estilos específicos do componente correspondente.

Novos valores visuais devem entrar primeiro nos tokens. Componentes não devem criar uma segunda paleta ou repetir sombras e raios sem necessidade.

## Tom de texto

Direto, humano e confiante. Evitar jargão técnico, excesso de texto e mensagens que prometam mais do que os dados comprovam.
