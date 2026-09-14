import { expect, test, type Page } from '@playwright/test'

const email = process.env.E2E_USER_EMAIL
const password = process.env.E2E_USER_PASSWORD
const hasTestAccount = Boolean(email && password)

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: /Seu e-mail/ }).fill(email!)
  await page.getByPlaceholder('Mínimo de 8 caracteres').fill(password!)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()

  await expect(page).toHaveURL(/\/sistema$/, { timeout: 15_000 })
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible()
}

const testLead = {
  id: 'e2e-ui-flow-lead',
  name: 'Empresa de teste E2E',
  category: 'Serviços profissionais',
  address: 'Rua de Teste, 123, São Paulo - SP',
  phone: '(11) 99999-9999',
  rating: 4.7,
  reviews: 83,
  source: 'Google Maps' as const,
  retrievedAt: '2026-09-11T12:00:00.000Z',
  opportunity: 'Sem site' as const,
  score: 89,
  diagnosis: 'O perfil público não informa um site próprio.',
  status: 'Novo' as const,
}

async function mockLeadWorkflowApi(page: Page) {
  await page.route('**/api/saved-lead-ids', (route) =>
    route.fulfill({ json: { data: [] } }),
  )
  await page.route(`**/api/leads/${testLead.id}/save`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        json: {
          data: {
            leadId: testLead.id,
            status: 'Novo',
            updatedAt: '2026-09-11T12:00:00.000Z',
          },
        },
      })
      return
    }

    await route.fulfill({ status: 204 })
  })
  await page.route(`**/api/leads/${testLead.id}`, async (route) => {
    const changes = route.request().postDataJSON()
    await route.fulfill({
      json: {
        data: {
          leadId: testLead.id,
          ...changes,
          updatedAt: '2026-09-11T12:05:00.000Z',
        },
      },
    })
  })
  await page.route(`**/api/leads/${testLead.id}/interactions`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { data: [] } })
      return
    }

    const input = route.request().postDataJSON()
    await route.fulfill({
      json: {
        data: {
          id: 'e2e-interaction',
          leadId: testLead.id,
          ...input,
          createdAt: '2026-09-11T12:10:00.000Z',
        },
      },
    })
  })
  await page.route('**/api/ai/outreach', (route) =>
    route.fulfill({
      json: {
        data: {
          salesArgument: 'Um site próprio facilita a apresentação dos serviços.',
          whatsappMessage: 'Olá, preparei uma sugestão de site para sua empresa.',
          followUpMessage: 'Olá, posso detalhar a sugestão que enviei?',
          analysis: {
            leadType: 'NO_WEBSITE',
            primaryOpportunity: 'website',
            secondaryOpportunities: [],
            confidence: 'high',
            evidence: ['Nenhum site foi informado no perfil público.'],
          },
          generationSource: 'ai',
        },
      },
    }),
  )
  await page.route('**/api/sales', async (route) => {
    const input = route.request().postDataJSON()
    await route.fulfill({ json: { data: { id: 'e2e-sale', ...input } } })
  })
}

async function openTestLeadFromCachedSearch(page: Page) {
  await page.evaluate((lead) => {
    window.sessionStorage.setItem(
      'digibusca:lead-search',
      JSON.stringify({
        countryCode: 'BR',
        stateCode: 'SP',
        city: 'São Paulo',
        segment: 'Serviços profissionais',
        opportunity: '',
        pages: [[lead]],
        currentPage: 1,
        status: 'success',
        searchedLocation: 'São Paulo, São Paulo, Brasil',
        lastQuery: { city: 'São Paulo, São Paulo, Brasil', segment: 'Serviços profissionais' },
      }),
    )
  }, testLead)
  await page.goto('/sistema/buscar')
  await page.getByRole('button', { name: `Abrir ${testLead.name}` }).click()
  await expect(page.getByRole('heading', { name: testLead.name })).toBeVisible()
}

test.describe('área autenticada — somente leitura', () => {
  test.skip(
    !hasTestAccount,
    'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD com uma conta exclusiva de teste.',
  )

  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('abre a visão geral e carrega os dados da conta', async ({ page }) => {
    await expect(page.getByText('VISÃO GERAL', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Uso geral do Google' })).toBeVisible()
    await expect(page.getByRole('alert')).not.toBeVisible()
  })

  test('navega pelas quatro áreas sem perder a rota', async ({ page }) => {
    const destinations = [
      { label: 'Buscar leads', path: '/sistema/buscar', heading: 'Encontre empresas que precisam de você.' },
      { label: 'Meus leads', path: '/sistema/leads', heading: 'Meus leads' },
      { label: 'Financeiro', path: '/sistema/financeiro', heading: 'Acompanhe suas vendas.' },
      { label: 'Visão geral', path: '/sistema', heading: 'Uso geral do Google' },
    ]

    for (const destination of destinations) {
      await page.getByRole('button', { name: destination.label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${destination.path.replaceAll('/', '\\/')}$`))
      await expect(page.getByRole('heading', { name: destination.heading })).toBeVisible()
    }
  })

  test('mantém cada área aberta após uma recarga direta', async ({ page }) => {
    const destinations = [
      { path: '/sistema', marker: 'VISÃO GERAL' },
      { path: '/sistema/buscar', marker: 'BUSCAR OPORTUNIDADES' },
      { path: '/sistema/leads', marker: 'ACOMPANHAMENTO' },
      { path: '/sistema/financeiro', marker: 'CONTROLE FINANCEIRO' },
    ]

    for (const destination of destinations) {
      await page.goto(destination.path)
      await page.reload()

      await expect(page).toHaveURL(new RegExp(`${destination.path.replaceAll('/', '\\/')}$`))
      await expect(page.getByText(destination.marker, { exact: true }).first()).toBeVisible()
    }
  })

  test('não cria rolagem horizontal nas áreas internas', async ({ page }) => {
    for (const path of ['/sistema', '/sistema/buscar', '/sistema/leads', '/sistema/financeiro']) {
      await page.goto(path)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true)
    }
  })
})

test.describe('área autenticada — fluxos de negócio isolados', () => {
  test.skip(
    !hasTestAccount,
    'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD com uma conta exclusiva de teste.',
  )

  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await mockLeadWorkflowApi(page)
  })

  test('acompanha um lead, gera abordagem e registra a conversão', async ({ page }) => {
    await openTestLeadFromCachedSearch(page)
    await expect(page.getByRole('link', { name: 'Abrir no WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/5511999999999\?text=/,
    )

    await page.getByRole('button', { name: 'Salvar lead', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Lead salvo', exact: true })).toBeVisible()

    await page.getByLabel('Status').selectOption('Contatado')
    await page.getByLabel('Observações do lead').fill('Contato iniciado pelo teste isolado.')
    await page.getByRole('button', { name: 'Salvar acompanhamento' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Alterações salvas.' })).toBeVisible()

    await page.getByLabel('Resumo da interação').fill('Apresentei a proposta inicial.')
    await page.getByLabel('Resultado da interação').fill('Solicitou retorno.')
    await page.getByRole('button', { name: 'Registrar interação' }).click()
    await expect(page.getByLabel('Interações registradas')).toContainText('Apresentei a proposta inicial.')

    await page.getByRole('button', { name: 'Gerar abordagem com IA' }).click()
    await page.getByRole('button', { name: 'Gerar com IA' }).click()
    await expect(page.getByText('Gerada com IA', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Usar na abordagem' }).click()
    await expect(page.getByLabel('Mensagem de abordagem')).toHaveValue(
      'Olá, preparei uma sugestão de site para sua empresa.',
    )

    await page.getByRole('combobox', { name: 'O que foi vendido' }).fill('Site institucional')
    await page.getByLabel('Valor').fill('150000')
    await page.getByRole('button', { name: 'Registrar venda', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Venda registrada no Financeiro.' })).toBeVisible()
  })

  test('registra uma venda manual sem persistir dados reais', async ({ page }) => {
    await page.route('**/api/sales', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { data: [] } })
        return
      }

      const input = route.request().postDataJSON()
      await route.fulfill({ json: { data: { id: 'e2e-manual-sale', ...input } } })
    })
    await page.goto('/sistema/financeiro')

    await page.getByRole('button', { name: 'Nova venda' }).click()
    await page.getByLabel('Comércio ou cliente').fill('Cliente do teste isolado')
    await page.getByRole('combobox', { name: 'O que foi vendido' }).fill('Landing page')
    await page.getByLabel('Valor').fill('250000')
    await page.getByRole('dialog', { name: 'Adicionar ao histórico' })
      .getByRole('button', { name: 'Registrar venda' })
      .click()

    await expect(page.getByRole('status')).toHaveText('Venda registrada.')
    await expect(page.getByText('Cliente do teste isolado')).toBeVisible()
  })

  test('edita e exclui uma venda com confirmação', async ({ page }) => {
    let sale = {
      id: 'e2e-edit-sale',
      businessName: 'Cliente para corrigir',
      service: 'Site institucional',
      amount: 1500,
      soldAt: '2026-09-14',
    }

    await page.route('**/api/sales', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { data: [sale] } })
        return
      }
      await route.fallback()
    })
    await page.route('**/api/sales/e2e-edit-sale', async (route) => {
      if (route.request().method() === 'PATCH') {
        sale = { ...sale, ...route.request().postDataJSON() }
        await route.fulfill({ json: { data: sale } })
        return
      }
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 204 })
        return
      }
      await route.fallback()
    })

    await page.goto('/sistema/financeiro')
    await page.getByRole('button', { name: 'Editar venda de Cliente para corrigir' }).click()

    const dialog = page.getByRole('dialog', { name: 'Corrigir registro' })
    await expect(dialog).toBeVisible()
    await page.getByLabel('Valor').fill('275000')
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByRole('status')).toHaveText('Venda atualizada.')
    await expect(page.getByText('R$ 2.750,00')).toBeVisible()

    await page.getByRole('button', { name: 'Editar venda de Cliente para corrigir' }).click()
    await page.getByRole('button', { name: 'Excluir venda' }).click()

    const confirmation = page.getByRole('alertdialog', { name: 'Remover este registro?' })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancelar' }).click()
    await expect(confirmation).not.toBeVisible()
    await expect(page.getByText('Cliente para corrigir')).toBeVisible()

    await page.getByRole('button', { name: 'Excluir venda' }).click()
    await page.getByRole('alertdialog', { name: 'Remover este registro?' })
      .getByRole('button', { name: 'Excluir venda' })
      .click()
    await expect(page.getByRole('status')).toHaveText('Venda excluída.')
    await expect(page.getByText('Cliente para corrigir')).not.toBeVisible()
  })

  test('exporta a carteira em CSV sem alterar os leads', async ({ page }) => {
    await page.route('**/api/saved-leads', (route) =>
      route.fulfill({
        json: {
          data: [{
            leadId: testLead.id,
            lead: { ...testLead, status: undefined },
            status: 'Contatado',
            notes: 'Lead usado somente na exportação isolada.',
            updatedAt: '2026-09-11T12:05:00.000Z',
          }],
        },
      }),
    )
    await page.route(`**/api/saved-leads/${testLead.id}`, (route) =>
      route.fulfill({
        json: {
          data: {
            ...testLead,
            status: 'Contatado',
            notes: 'Lead usado somente na exportação isolada.',
          },
        },
      }),
    )
    await page.goto('/sistema/leads')
    await expect(page.getByText(testLead.name, { exact: true }).first()).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar CSV' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/^leads-digibusca-\d{4}-\d{2}-\d{2}\.csv$/)
    await expect(page.getByText('1 lead(s) exportado(s).', { exact: true })).toBeVisible()
  })
})
