import type {
  GenerateOutreachInput,
  GeneratedOutreach,
  GeneratedOutreachCopy,
} from '../contracts/aiOutreach.js'
import {
  buildOutreachContext,
  createSafeOutreachTemplate,
  validateGeneratedOutreach,
} from '../domain/outreachPipeline.js'
import {
  generateOutreachWithGemini,
  GeminiOutreachError,
} from '../integrations/geminiOutreachProvider.js'

export async function generateLeadOutreach(
  apiKey: string,
  input: GenerateOutreachInput,
): Promise<GeneratedOutreach> {
  const context = buildOutreachContext(input)
  let generatedCopy: GeneratedOutreachCopy

  try {
    generatedCopy = await generateOutreachWithGemini(apiKey, context)
  } catch (error) {
    if (error instanceof GeminiOutreachError && error.status === 429) throw error

    console.warn('Gemini indisponível; usando o modelo seguro:', error)
    return {
      ...createSafeOutreachTemplate(context),
      analysis: context.leadAnalysis,
      generationSource: 'safe_template',
    }
  }

  const validationIssues = validateGeneratedOutreach(generatedCopy, context)

  if (validationIssues.length > 0) {
    console.warn('Abordagem do Gemini substituída pelo modelo seguro:', validationIssues)
    return {
      ...createSafeOutreachTemplate(context),
      analysis: context.leadAnalysis,
      generationSource: 'safe_template',
    }
  }

  return {
    ...generatedCopy,
    analysis: context.leadAnalysis,
    generationSource: 'ai',
  }
}
