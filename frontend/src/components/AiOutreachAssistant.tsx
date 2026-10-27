import { Check, Copy, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  generateAiOutreach,
  generateOpenBotOutreach,
  getCachedAiOutreach,
  getOpenBotAgents,
  type GenerateOutreachInput,
  type GeneratedOutreach,
  type LeadAnalysis,
  type OpenBotAgent,
  type OutreachTone,
} from '../services/leadsService'
import { conversationStages, greetingOptions, type ConversationStage, type OutreachGreeting } from '../../../backend/src/contracts/aiOutreach'
import { buildOutreachContext, createSafeOutreachTemplate } from '../../../backend/src/domain/outreachPipeline'
import type { Lead } from '../types'
import './AiOutreachAssistant.css'

type AiOutreachAssistantProps = {
  lead: Lead
  currentStage?: string
  onUseMessage: (message: string, stage: ConversationStage) => void
}

const tones: OutreachTone[] = ['Profissional', 'Direto', 'Informal']
type OutreachGenerator = 'gemini' | 'openbot'
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

function createGenerationInput(lead: Lead, service: string, tone: OutreachTone, stage: ConversationStage, lastReply: string, senderName: string, greeting: OutreachGreeting): GenerateOutreachInput {
  return { businessName: lead.name, category: lead.category, websiteStatus: lead.website ? 'listed' : 'not_listed', googleProfileStatus: lead.opportunity === 'Perfil incompleto' ? 'incomplete' : 'complete', service: service.trim() || 'sites e presença digital', tone, stage, lastReply, senderName, greeting }
}

export function AiOutreachAssistant({ lead, currentStage, onUseMessage }: AiOutreachAssistantProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const generatorChosenByUser = useRef(false)
  const [stage, setStage] = useState<ConversationStage>(conversationStages.find((item) => item === (currentStage ?? lead.conversationStage)) ?? 'Abertura')
  const [lastReply, setLastReply] = useState('')
  const [senderName, setSenderName] = useState('')
  const [greeting, setGreeting] = useState<OutreachGreeting>(() => {
    const hour = new Date().getHours()
    return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  })
  const [isOpen, setIsOpen] = useState(false)
  const [service, setService] = useState('Site institucional')
  const [tone, setTone] = useState<OutreachTone>('Profissional')
  const [generator, setGenerator] = useState<OutreachGenerator>('gemini')
  const [openBotAgents, setOpenBotAgents] = useState<OpenBotAgent[]>([])
  const [selectedOpenBotAgentId, setSelectedOpenBotAgentId] = useState('')
  const [isLoadingOpenBotAgents, setIsLoadingOpenBotAgents] = useState(false)
  const [openBotAgentsError, setOpenBotAgentsError] = useState('')
  const [result, setResult] = useState<GeneratedOutreach>()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copiedField, setCopiedField] = useState<CopyField>()

  useEffect(() => {
    if (!isOpen) return
    let isCurrent = true
    setIsLoadingOpenBotAgents(true)
    setOpenBotAgentsError('')
    void getOpenBotAgents().then((agents) => {
      if (!isCurrent) return
      setOpenBotAgents(agents)
      const prospectingAgent = agents.find((agent) => agent.name.toLocaleLowerCase('pt-BR') === 'digiprospector')
      setSelectedOpenBotAgentId((selected) => agents.some((agent) => agent.id === selected)
        ? selected
        : prospectingAgent?.id ?? '')
      if (prospectingAgent && !generatorChosenByUser.current) {
        setGenerator('openbot')
        setResult(undefined)
      }
    }).catch((agentError) => {
      if (isCurrent) setOpenBotAgentsError(agentError instanceof Error ? agentError.message : 'Não foi possível conectar aos agentes do OpenBot.')
    }).finally(() => {
      if (isCurrent) setIsLoadingOpenBotAgents(false)
    })
    return () => { isCurrent = false }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    dialogRef.current?.querySelector<HTMLSelectElement>('select')?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? [])
        .filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); triggerRef.current?.focus() }
  }, [isOpen])

  useEffect(() => {
    setIsOpen(false)
    setResult(undefined)
    setError('')
  }, [lead.id])

  useEffect(() => {
    if (!isOpen || generator !== 'gemini' || !service.trim()) return
    let isCurrent = true

    void getCachedAiOutreach(createGenerationInput(lead, service, tone, stage, lastReply, senderName, greeting)).then((cached) => {
      if (isCurrent && cached) {
        setResult(cached)
        setError('')
      }
    }).catch(() => { /* Cache is optional. */ })

    return () => {
      isCurrent = false
    }
  }, [isOpen, generator, lead, service, tone, stage, lastReply, senderName, greeting])

  async function handleGenerate() {
    if ((stage === 'Pedir permissão' || stage === 'Apresentar ideia') && !service.trim()) {
      setError('Informe qual serviço você quer oferecer.')
      return
    }

    setIsGenerating(true)
    setError('')
    setResult(undefined)
    try {
      const input = createGenerationInput(lead, service, tone, stage, lastReply, senderName, greeting)
      if (generator === 'openbot') {
        if (!selectedOpenBotAgentId) {
          setError('Ative Local scripts no DigiProspector ou selecione um agente disponível no OpenBot.')
          return
        }
        setResult(await generateOpenBotOutreach(input, selectedOpenBotAgentId))
      } else {
        setResult(await generateAiOutreach(input))
      }
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
    if ((stage === 'Pedir permissão' || stage === 'Apresentar ideia') && !service.trim()) {
      setError('Informe qual serviço você quer oferecer.')
      return
    }
    setError('')
    const context = buildOutreachContext(createGenerationInput(lead, service, tone, stage, lastReply, senderName, greeting))
    setResult({ ...createSafeOutreachTemplate(context), stage: context.conversation.stage, analysis: context.leadAnalysis, generationSource: 'safe_template' })
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
      <button ref={triggerRef} className="secondary-button ai-outreach-trigger" type="button" onClick={() => { setStage(conversationStages.find((item) => item === (currentStage ?? lead.conversationStage)) ?? 'Abertura'); setResult(undefined); setIsOpen(true) }}>
        <Sparkles size={17} /> Gerar abordagem
      </button>

      {isOpen && (
        <div className="ai-outreach-backdrop" role="presentation" onMouseDown={() => setIsOpen(false)}>
          <section
            ref={dialogRef}
            className="ai-outreach-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-outreach-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="ai-outreach-header">
              <div>
                <span className="eyebrow">ABORDAGEM COM IA</span>
                <h2 id="ai-outreach-title">Continuar conversa com {lead.name}</h2>
              </div>
              <button className="ai-outreach-close" type="button" onClick={() => setIsOpen(false)} aria-label="Fechar">
                <X size={20} />
              </button>
            </header>

            <p className="ai-outreach-privacy">
              A resposta informada entra no contexto da IA junto com os dados comerciais e a etapa. Inclua apenas o necessário.
            </p>

            <p className="ai-outreach-note">Comece com um cumprimento e espere a resposta. Avance uma etapa por vez, conforme a conversa.</p>
            <div className="ai-outreach-form">
              <label><span>Gerar com</span><select value={generator} disabled={isGenerating} onChange={(event) => { generatorChosenByUser.current = true; setGenerator(event.target.value as OutreachGenerator); setResult(undefined); setError('') }}>
                <option value="gemini">Gemini</option>
                <option value="openbot">Agente do OpenBot</option>
              </select></label>
              {generator === 'openbot' && <>
                {openBotAgents.length > 0 ? <label><span>Agente</span><select value={selectedOpenBotAgentId} disabled={isGenerating || isLoadingOpenBotAgents} onChange={(event) => { setSelectedOpenBotAgentId(event.target.value); setResult(undefined) }}>
                  <option value="" disabled>Selecione um agente</option>
                  {openBotAgents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
                </select></label> : <p className="ai-outreach-openbot-status" role={openBotAgentsError ? 'alert' : 'status'}>
                  {isLoadingOpenBotAgents ? 'Conectando ao OpenBot…' : openBotAgentsError || 'Nenhum agente com Local scripts ativo foi encontrado.'}
                </p>}
              </>}
              <label><span>Etapa da conversa</span><select value={stage} disabled={isGenerating} onChange={(event) => { setStage(event.target.value as ConversationStage); setResult(undefined) }}>
                {conversationStages.map((item) => <option key={item}>{item}</option>)}
              </select></label>
              {(stage === 'Abertura' || stage === 'Pedir permissão') && <label><span>Seu nome (opcional)</span><input value={senderName} maxLength={80} disabled={isGenerating} onChange={(event) => { setSenderName(event.target.value); setResult(undefined) }} placeholder="Como você quer se apresentar" /></label>}
              {stage === 'Abertura' ? <label><span>Saudação</span><select value={greeting} disabled={isGenerating} onChange={(event) => { setGreeting(event.target.value as OutreachGreeting); setResult(undefined) }}>
                {greetingOptions.map((item) => <option key={item}>{item}</option>)}
              </select></label> : <label><span>O que a pessoa respondeu?</span><textarea value={lastReply} disabled={isGenerating} maxLength={2000} onChange={(event) => { setLastReply(event.target.value); setResult(undefined) }} placeholder="Cole ou resuma a resposta para contextualizar a próxima mensagem" /></label>}
              {(stage === 'Pedir permissão' || stage === 'Apresentar ideia') && <label>
                <span>Serviço que você oferece</span>
                <input
                  value={service}
                  disabled={isGenerating}
                  maxLength={120}
                  onChange={(event) => {
                    setService(event.target.value)
                    setResult(undefined)
                  }}
                  placeholder="Ex.: Site institucional"
                />
              </label>}
              <fieldset>
                <legend>Tom da mensagem</legend>
                <div className="ai-outreach-tones">
                  {tones.map((option) => (
                    <button
                      className={tone === option ? 'active' : ''}
                      type="button"
                      key={option}
                      aria-pressed={tone === option}
                      disabled={isGenerating}
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
              <button className="primary-button" type="button" onClick={() => void handleGenerate()} disabled={isGenerating || (generator === 'openbot' && (isLoadingOpenBotAgents || openBotAgents.length === 0 || !selectedOpenBotAgentId))}>
                {isGenerating ? <RefreshCw className="ai-spinning" size={17} /> : <Sparkles size={17} />}
                {isGenerating ? 'Criando...' : generator === 'openbot' ? 'Gerar com agente' : 'Gerar com IA'}
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
                          : result.generationSource === 'openbot'
                            ? 'Gerada pelo agente OpenBot'
                            : 'Modelo seguro'}
                    </span>
                  </div>
                  <p>{result.analysis.evidence[0]}</p>
                </div>
                <article className="ai-outreach-result featured">
                  <div>
                    <span>{result.stage ?? stage} · próxima mensagem</span>
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
                    <span>Orientação para a conversa</span>
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
                    onUseMessage(result.whatsappMessage, result.stage ?? stage)
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
