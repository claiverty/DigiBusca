import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const projectRoot = process.cwd()

const baseLead = {
  id: 'lead-one', name: 'Clínica Exemplo', category: 'Clínica', address: 'Rua Exemplo',
  phone: '+55 11 99999-9999', rating: 4.7, reviews: 50, source: 'Google Maps',
  retrievedAt: '2026-10-13T12:00:00.000Z', opportunity: 'Sem site', score: 89, status: 'Novo', diagnosis: 'Site não informado no Google.',
}

async function mountWorkflow(page: Page, view: 'assistant' | 'portfolio' | 'search' | 'detail') {
  await page.addInitScript(({ lead }) => {
    const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const today = key(new Date())
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    const states = Array.from({ length: 6 }, (_, i) => ({
      leadId: `overdue-${i}`, lead: { ...lead, id: `overdue-${i}`, name: `Empresa ${i}` },
      status: 'Contatado', notes: 'Observação atual', nextAction: 'Perguntar sobre divulgação',
      contactName: 'Maria', nextFollowUp: key(yesterday), updatedAt: '2026-10-13T12:00:00Z',
    }))
    states.push({ ...states[0], leadId: 'today', lead: { ...lead, id: 'today', name: 'Contato de hoje' }, nextFollowUp: today })
    states.push({ ...states[0], leadId: 'won', lead: { ...lead, id: 'won', name: 'Venda concluída' }, status: 'Ganhou' })
    Object.assign(window, { fixtureLeads: states, fixtureLead: lead })
    sessionStorage.setItem('digibusca:lead-search', JSON.stringify({ countryCode: 'BR', stateCode: 'SP', city: 'São Paulo', segment: 'Clínicas', pages: [[lead]], currentPage: 1, status: 'success', searchedLocation: 'São Paulo', lastQuery: { city: 'São Paulo', segment: 'Clínicas' }, nextPageToken: 'next-token' }))
  }, { lead: baseLead })
  // Mount the real components with isolated services; no account or external API is used.
  await page.route('**/src/services/leadsService.ts', (route) => route.fulfill({
    contentType: 'application/javascript', body: `
      export class GoogleApiMonthlyLimitError extends Error {}
      export async function getSavedLeads() { return window.fixtureLeads }
      export async function getCachedAiOutreach() { return undefined }
      export async function getOpenBotAgents() { return [] }
      export async function generateAiOutreach(input) {
        window.lastGenerationInput = input;
        const { buildOutreachContext, createSafeOutreachTemplate } = await import('/@fs${projectRoot}/backend/src/domain/outreachPipeline.ts');
        const context = buildOutreachContext(input);
        return { ...createSafeOutreachTemplate(context), analysis: context.leadAnalysis, generationSource: 'ai' }
      }
      export async function generateOpenBotOutreach(input) {
        window.lastGenerationInput = input;
        const { buildOutreachContext, createSafeOutreachTemplate } = await import('/@fs${projectRoot}/backend/src/domain/outreachPipeline.ts');
        const context = buildOutreachContext(input);
        return { ...createSafeOutreachTemplate(context), analysis: context.leadAnalysis, generationSource: 'openbot' }
      }
      export async function searchLeads() { return { data: [{ ...window.fixtureLead, id:'lead-two', name:'Outro negócio' }], meta: { total:1 } } }
      export async function getLeadInteractions() { return [] }
      export async function createLeadInteraction(id, input) { return { id:'interaction', leadId:id, ...input, createdAt:new Date().toISOString() } }
      export async function sendWhatsAppTemplateMessage() { return { messageId:'e2e-message-id', logSaved:true } }
      export async function getSiteHealth() { return { status:'healthy' } }
    `,
  }))
  await page.addInitScript((fixtureView) => { Object.assign(window, { fixtureView }) }, view)
  await page.route('**/src/main.tsx', (route) => route.fulfill({ contentType: 'application/javascript', body: `import '/@fs${projectRoot}/tests/fixtures/lead-upgrade.tsx';` }))
  await page.goto('/')
}

test('cold chat começa curto, identifica responsável e usa resposta na IA', async ({ page }, testInfo) => {
  await mountWorkflow(page, 'assistant')
  await page.getByRole('button', { name: 'Gerar abordagem', exact: true }).click()
  await page.getByLabel('Saudação').selectOption('Boa tarde')
  await page.getByRole('button', { name: 'Usar modelo sem IA' }).click()
  await expect(page.getByText('Oi, boa tarde! Tudo bem?', { exact: true })).toBeVisible()
  await page.getByLabel('Etapa da conversa').selectOption('Identificar responsável')
  await page.getByLabel('O que a pessoa respondeu?').fill('Boa tarde, tudo sim!')
  await page.getByRole('button', { name: 'Gerar com IA', exact: true }).click()
  await expect(page.getByText('Gerada com IA', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).lastGenerationInput.lastReply)).toBe('Boa tarde, tudo sim!')
  await page.screenshot({ path: testInfo.outputPath('assistant.png'), fullPage: true })
  await page.getByRole('button', { name: 'Usar na abordagem' }).click()
  await expect(page.locator('#used-message')).toContainText('quem cuida da divulgação')
  expect(await page.evaluate(() => (window as any).usedStage)).toBe('Identificar responsável')
})

test('carteira conta todos os atrasados, filtra hoje e exporta dados atuais', async ({ page }, testInfo) => {
  await mountWorkflow(page, 'portfolio')
  await expect(page.locator('.lead-priority-summary')).toContainText('6 atrasado(s)')
  await page.locator('summary').click()
  await page.getByRole('button', { name: 'Hoje', exact: true }).click()
  await expect(page.locator('.saved-leads-list')).toContainText('Contato de hoje')
  await expect(page.locator('.saved-leads-list')).not.toContainText('Venda concluída')
  await expect(page.locator('.saved-leads-list')).toContainText('Contato hoje')
  await page.screenshot({ path: testInfo.outputPath('portfolio.png'), fullPage: true })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  const download = await pending
  const path = await download.path()
  const csv = await readFile(path!, 'utf8')
  expect(csv).toContain('Observação atual')
  expect(csv).toContain('Perguntar sobre divulgação')
  expect(csv).not.toContain('Venda concluída')
  await page.getByLabel('Buscar na carteira').fill('Não existe')
  await expect(page.getByText('Nenhum lead corresponde aos filtros selecionados.')).toBeVisible()
})

test('filtro que esvazia uma página mantém próxima página acessível', async ({ page }) => {
  await mountWorkflow(page, 'search')
  await expect(page.getByText('Já salvo na carteira')).toBeVisible()
  await page.getByLabel('Ocultar leads já salvos').check()
  await expect(page.getByText('Nenhuma oportunidade nesta página com os filtros atuais.')).toBeVisible()
  await page.getByRole('button', { name: 'Próxima', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Outro negócio' })).toBeVisible()
})

test('ficha salva etapa, contato e próximo passo e limpa follow-up', async ({ page }) => {
  await mountWorkflow(page, 'detail')
  await page.getByLabel('Etapa da conversa').selectOption('Entender cenário')
  await page.getByLabel('Pessoa de contato').fill('Maria, proprietária')
  await page.getByLabel('Próximo passo').fill('Perguntar como recebe contatos')
  await page.getByRole('button', { name: 'Retornar em 3 dia(s)', exact: true }).click()
  await page.getByRole('button', { name: 'Salvar acompanhamento', exact: true }).click()
  expect(await page.evaluate(() => (window as any).savedChanges)).toMatchObject({ conversationStage:'Entender cenário',contactName:'Maria, proprietária',nextAction:'Perguntar como recebe contatos' })
  await page.getByRole('button', { name: 'Limpar agendamento' }).click()
  await page.getByRole('button', { name: 'Salvar acompanhamento', exact: true }).click()
  expect(await page.evaluate(() => (window as any).savedChanges.nextFollowUp)).toBe('')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
