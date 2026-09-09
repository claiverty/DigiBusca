import { Check, Copy, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  generateAiOutreach,
  getCachedAiOutreach,
  type GenerateOutreachInput,
  type GeneratedOutreach,
  type LeadAnalysis,
  type OutreachTone,
} from '../services/leadsService'
import type { Lead } from '../types'
import './AiOutreachAssistant.css'

type AiOutreachAssistantProps = {
  lead: Lead
  onUseMessage: (message: string) => void
}

const tones: OutreachTone[] = ['Profissional', 'Direto', 'Informal']
type CopyField = 'salesArgument' | 'whatsappMessage' | 'followUpMessage'

const analysisLabels: Record<LeadAnalysis['leadType'], string> = {
  NO_WEBSITE: 'Site não informado',
  INCOMPLETE_GOOGLE_PROFILE: 'Perfil incompleto',
  NO_CLEAR_OPPORTUNITY: 'Abordagem exploratória',
}

const confidenceLabels: Record<LeadAnalysis['confidence'], string> = {
  high: 'Confiança alta',
  medium: 'Confiança média',
  low: 'Confiança baixa',
}

function createLocalAnalysis(lead: Lead): LeadAnalysis {
  if (!lead.website) {
    return {
      leadType: 'NO_WEBSITE',
      primaryOpportunity: 'website',
      secondaryOpportunities: [],
      confidence: 'high',
      evidence: ['Nenhum site foi informado nos dados públicos do perfil do Google.'],
    }
  }

  if (lead.opportunity === 'Perfil incompleto') {
    return {
      leadType: 'INCOMPLETE_GOOGLE_PROFILE',
      primaryOpportunity: 'google_profile',
      secondaryOpportunities: [],
      confidence: 'medium',
      evidence: ['O perfil do Google não apresenta todos os dados públicos esperados.'],
    }
  }

  return {
    leadType: 'NO_CLEAR_OPPORTUNITY',
    primaryOpportunity: 'general_outreach',
    secondaryOpportunities: [],
    confidence: 'low',
    evidence: ['Há um site informado e não existem dados suficientes para avaliar sua qualidade.'],
  }
}

function createGenerationInput(
  lead: Lead,
  service: string,
  tone: OutreachTone,
): GenerateOutreachInput {
  return {
    businessName: lead.name,
    category: lead.category,
    websiteStatus: lead.website ? 'listed' : 'not_listed',
    googleProfileStatus: lead.opportunity === 'Perfil incompleto' ? 'incomplete' : 'complete',
    service: service.trim(),
    tone,
  }
}

function createReadyTemplate(lead: Lead, service: string, tone: OutreachTone): GeneratedOutreach {
  const greeting = tone === 'Profissional' ? 'Olá' : 'Oi'
  const analysis = createLocalAnalysis(lead)
  const ending = tone === 'Informal'
    ? 'Posso te mandar uma ideia rápida por aqui?'
    : 'Posso compartilhar uma sugestão rápida, sem compromisso?'

  if (analysis.leadType === 'NO_WEBSITE') {
    return {
      salesArgument: 'Um site pode funcionar como um canal próprio para apresentar a empresa, explicar seus serviços e facilitar o contato de quem já encontrou o negócio pelo Google.',
      whatsappMessage: `${greeting}, tudo bem? Encontrei a empresa de vocês pelo Google e resolvi entrar em contato. Trabalho com ${service} e não encontrei um site informado no perfil. Vocês já pensaram em ter um espaço próprio para apresentar melhor a empresa e os serviços?`,
      followUpMessage: `${greeting}, tudo bem? Passando só para saber se faz sentido eu enviar uma sugestão de ${service}. Posso resumir a ideia em poucos pontos por aqui?`,
      analysis,
      generationSource: 'safe_template',
    }
  }

  if (analysis.leadType === 'INCOMPLETE_GOOGLE_PROFILE') {
    return {
      salesArgument: 'Informações organizadas ajudam quem já encontrou a empresa no Google a entender os serviços e escolher o canal de contato.',
      whatsappMessage: `${greeting}, tudo bem? Encontrei a empresa de vocês pelo Google e notei que algumas informações públicas não aparecem no perfil. Trabalho com ${service}. ${ending}`,
      followUpMessage: `${greeting}, tudo bem? Posso enviar uma sugestão simples de ${service} para organizar melhor a apresentação da empresa no Google?`,
      analysis,
      generationSource: 'safe_template',
    }
  }

  return {
    salesArgument: `Os dados disponíveis não comprovam uma falha específica. A abordagem inicia uma conversa respeitosa sobre ${service}.`,
    whatsappMessage: `${greeting}, tudo bem? Encontrei a empresa de vocês pelo Google e resolvi entrar em contato. Trabalho com ${service} para negócios desse segmento. ${ending}`,
    followUpMessage: `${greeting}, tudo bem? Passando só para saber se faz sentido eu enviar aquela sugestão de ${service}. Posso resumir a ideia em poucos pontos por aqui.`,
    analysis,
    generationSource: 'safe_template',
  }
}

export function AiOutreachAssistant({ lead, onUseMessage }: AiOutreachAssistantProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [service, setService] = useState('Site institucional')
  const [tone, setTone] = useState<OutreachTone>('Profissional')
  const [result, setResult] = useState<GeneratedOutreach>()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copiedField, setCopiedField] = useState<CopyField>()

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  useEffect(() => {
    setIsOpen(false)
    setResult(undefined)
    setError('')
  }, [lead.id])

  useEffect(() => {
    if (!isOpen || !service.trim()) return
    let isCurrent = true

    void getCachedAiOutreach(createGenerationInput(lead, service, tone)).then((cached) => {
      if (isCurrent && cached) {
        setResult(cached)
        setError('')
      }
    })

    return () => {
      isCurrent = false
    }
  }, [isOpen, lead, service, tone])

  async function handleGenerate() {
    if (!service.trim()) {
      setError('Informe qual serviço você quer oferecer.')
      return
    }

    setIsGenerating(true)
    setError('')
    setResult(undefined)
    try {
      setResult(await generateAiOutreach(createGenerationInput(lead, service, tone)))
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : 'Não foi possível gerar a abordagem agora.',
      )
    } finally {
      setIsGenerating(false)
    }
  }

  function handleReadyTemplate() {
    if (!service.trim()) {
      setError('Informe qual serviço você quer oferecer.')
      return
    }
    setError('')
    setResult(createReadyTemplate(lead, service.trim(), tone))
  }

  async function handleCopy(field: CopyField) {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result[field])
      setCopiedField(field)
      window.setTimeout(() => setCopiedField(undefined), 1600)
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.')
    }
  }

  return (
    <>
      <button className="secondary-button ai-outreach-trigger" type="button" onClick={() => setIsOpen(true)}>
        <Sparkles size={17} /> Gerar abordagem com IA
      </button>

      {isOpen && (
        <div className="ai-outreach-backdrop" role="presentation" onMouseDown={() => setIsOpen(false)}>
          <section
            className="ai-outreach-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-outreach-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="ai-outreach-header">
              <div>
                <span className="eyebrow">ASSISTENTE COM IA</span>
                <h2 id="ai-outreach-title">Criar abordagem para {lead.name}</h2>
              </div>
              <button className="ai-outreach-close" type="button" onClick={() => setIsOpen(false)} aria-label="Fechar">
                <X size={20} />
              </button>
            </header>

            <p className="ai-outreach-privacy">
              Enviamos somente nome comercial, categoria e disponibilidade de dados públicos. Telefone, endereço e anotações ficam de fora.
            </p>

            <div className="ai-outreach-form">
              <label>
                <span>Serviço que você oferece</span>
                <input
                  value={service}
                  onChange={(event) => {
                    setService(event.target.value)
                    setResult(undefined)
                  }}
                  placeholder="Ex.: Site institucional"
                />
              </label>
              <fieldset>
                <legend>Tom da mensagem</legend>
                <div className="ai-outreach-tones">
                  {tones.map((option) => (
                    <button
                      className={tone === option ? 'active' : ''}
                      type="button"
                      key={option}
                      aria-pressed={tone === option}
                      onClick={() => {
                        setTone(option)
                        setResult(undefined)
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="ai-outreach-actions">
              <button className="primary-button" type="button" onClick={() => void handleGenerate()} disabled={isGenerating}>
                {isGenerating ? <RefreshCw className="ai-spinning" size={17} /> : <Sparkles size={17} />}
                {isGenerating ? 'Criando...' : 'Gerar com IA'}
              </button>
              <button className="secondary-button" type="button" onClick={handleReadyTemplate} disabled={isGenerating}>
                Usar modelo sem IA
              </button>
            </div>

            {error && <p className="ai-outreach-error" role="alert">{error}</p>}

            {result && (
              <div className="ai-outreach-results" aria-live="polite">
                <div className="ai-outreach-analysis">
                  <div>
                    <span>{analysisLabels[result.analysis.leadType]}</span>
                    <span>{confidenceLabels[result.analysis.confidence]}</span>
                    <span>
                      {result.cacheHit
                        ? 'Resultado em cache'
                        : result.generationSource === 'ai'
                          ? 'Gerada com IA'
                          : 'Modelo seguro'}
                    </span>
                  </div>
                  <p>{result.analysis.evidence[0]}</p>
                </div>
                <article className="ai-outreach-result featured">
                  <div>
                    <span>Mensagem inicial</span>
                    <button type="button" onClick={() => void handleCopy('whatsappMessage')}>
                      {copiedField === 'whatsappMessage' ? <Check size={15} /> : <Copy size={15} />}
                      {copiedField === 'whatsappMessage' ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <p>{result.whatsappMessage}</p>
                </article>
                <article className="ai-outreach-result">
                  <div>
                    <span>Follow-up</span>
                    <button type="button" onClick={() => void handleCopy('followUpMessage')}>
                      {copiedField === 'followUpMessage' ? <Check size={15} /> : <Copy size={15} />}
                      {copiedField === 'followUpMessage' ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <p>{result.followUpMessage}</p>
                </article>
                <article className="ai-outreach-result">
                  <div>
                    <span>Argumento principal</span>
                    <button type="button" onClick={() => void handleCopy('salesArgument')}>
                      {copiedField === 'salesArgument' ? <Check size={15} /> : <Copy size={15} />}
                      {copiedField === 'salesArgument' ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <p>{result.salesArgument}</p>
                </article>
                <button
                  className="primary-button ai-use-message"
                  type="button"
                  onClick={() => {
                    onUseMessage(result.whatsappMessage)
                    setIsOpen(false)
                  }}
                >
                  Usar na abordagem
                </button>
              </div>
            )}

            <small className="ai-outreach-note">Revise o texto antes de enviar. Nada é enviado automaticamente.</small>
          </section>
        </div>
      )}
    </>
  )
}
