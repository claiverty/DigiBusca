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
