import { Check, Copy, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  generateAiOutreach,
  type GeneratedOutreach,
  type OutreachTone,
} from '../services/leadsService'
import type { Lead } from '../types'
import './AiOutreachAssistant.css'

type AiOutreachAssistantProps = {
  lead: Lead
  onUseMessage: (message: string) => void
}

const tones: OutreachTone[] = ['Profissional', 'Direto', 'Informal']

function createReadyTemplate(lead: Lead, service: string, tone: OutreachTone): GeneratedOutreach {
  const greeting = tone === 'Informal' ? 'Oi' : 'Olá'
  const intro = tone === 'Direto' ? 'Vi uma oportunidade' : 'Encontrei vocês pelo Google e notei uma oportunidade'
  const ending = tone === 'Informal'
    ? 'Posso te mandar uma ideia rápida por aqui?'
    : 'Posso compartilhar uma sugestão rápida, sem compromisso?'

  return {
    salesArgument: `${lead.diagnosis} Uma solução de ${service} pode tornar a presença digital mais clara e facilitar novos contatos.`,
    whatsappMessage: `${greeting}, pessoal da ${lead.name}! ${intro} na presença digital de vocês. Trabalho com ${service} para ajudar negócios a apresentar melhor seus serviços e gerar mais contatos. ${ending}`,
    followUpMessage: `${greeting}! Passando só para saber se faz sentido eu enviar aquela sugestão de ${service} para a ${lead.name}. Posso resumir a ideia em poucos pontos por aqui.`,
  }
}

export function AiOutreachAssistant({ lead, onUseMessage }: AiOutreachAssistantProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [service, setService] = useState('Site institucional')
  const [tone, setTone] = useState<OutreachTone>('Profissional')
  const [result, setResult] = useState<GeneratedOutreach>()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copiedField, setCopiedField] = useState<keyof GeneratedOutreach>()

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

  async function handleGenerate() {
    if (!service.trim()) {
      setError('Informe qual serviço você quer oferecer.')
      return
    }

    setIsGenerating(true)
    setError('')
    setResult(undefined)
    try {
      setResult(await generateAiOutreach({
        businessName: lead.name,
        category: lead.category,
        opportunity: lead.opportunity,
        diagnosis: lead.diagnosis,
        service: service.trim(),
        tone,
      }))
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

  async function handleCopy(field: keyof GeneratedOutreach) {
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
              Enviamos somente nome, categoria e diagnóstico comercial. Telefone, endereço e anotações ficam de fora.
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
