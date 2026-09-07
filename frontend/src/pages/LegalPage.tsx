import { ArrowLeft } from 'lucide-react'
import './LegalPage.css'

type LegalPageProps = {
  page: 'privacy' | 'terms'
  onBack: () => void
}

const pageContent = {
  privacy: {
    eyebrow: 'PRIVACIDADE',
    title: 'Como cuidamos dos seus dados.',
    intro:
      'O DigiBusca usa sua conta para separar seus leads, acompanhamentos e registros financeiros dos demais usuários.',
    sections: [
      {
        title: 'Dados da sua conta',
        content:
          'Usamos os dados de autenticação fornecidos pelo Google ou pelo seu e-mail para identificar sua conta e proteger o acesso ao seu espaço.',
      },
      {
        title: 'Leads e anotações',
        content:
          'Nos leads salvos, guardamos o identificador do lugar, o status, suas anotações, lembretes de retorno e rascunhos. Os detalhes públicos do negócio são consultados no Google quando você abre o lead.',
      },
      {
        title: 'Dados do Google Maps',
        content:
          'As buscas usam o Google Maps Platform. O conteúdo exibido segue as políticas do Google, e não é usado para montar um banco permanente de dados de empresas.',
      },
      {
        title: 'Vendas',
        content:
          'Os registros financeiros informados por você ficam associados somente à sua conta para mostrar os totais do seu trabalho.',
      },
    ],
  },
  terms: {
    eyebrow: 'TERMOS DE USO',
    title: 'Regras simples para usar o DigiBusca.',
    intro:
      'O DigiBusca é uma ferramenta de apoio à prospecção. Você continua responsável pelas decisões comerciais e pelos contatos que fizer.',
    sections: [
      {
        title: 'Uso responsável',
        content:
          'Use os dados para uma abordagem profissional e respeite as leis, os canais de contato e as preferências de cada negócio.',
      },
      {
        title: 'Informações dos lugares',
        content:
          'Os resultados de busca vêm do Google Maps Platform e podem mudar. Confira as informações antes de tomar decisões ou entrar em contato.',
      },
      {
        title: 'Sua conta',
        content:
          'Você é responsável por manter seu acesso seguro e pelas informações que registrar em leads, acompanhamentos e vendas.',
      },
      {
        title: 'Serviços de terceiros',
        content:
          'O DigiBusca se integra ao Google Maps Platform para busca de lugares. Ao usar esse recurso, você também está sujeito aos termos e à política de privacidade do Google.',
      },
    ],
  },
} as const

export function LegalPage({ page, onBack }: LegalPageProps) {
  const content = pageContent[page]

  return (
    <main className="legal-page">
      <article className="legal-card panel" aria-labelledby="legal-title">
        <button className="legal-brand" type="button" onClick={onBack} aria-label="Voltar ao início">
          <span className="legal-brand-mark" aria-hidden="true" />
          <span>DigiBusca</span>
        </button>
        <button className="legal-back" type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Voltar
        </button>
        <span className="eyebrow">{content.eyebrow}</span>
        <h1 id="legal-title">{content.title}</h1>
        <p className="legal-intro">{content.intro}</p>
        <div className="legal-content">
          {content.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.content}</p>
            </section>
          ))}
        </div>
        <p className="legal-google-links">
          Consulte também os{' '}
          <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">
            Termos do Google Maps
          </a>{' '}
          e a{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Política de Privacidade do Google
          </a>
          .
        </p>
      </article>
    </main>
  )
}
