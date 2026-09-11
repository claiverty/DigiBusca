import { expect, test } from '@playwright/test'

test('API responde ao health check', async ({ request }) => {
  const response = await request.get('/api/health')

  expect(response.ok()).toBeTruthy()
  await expect(response.json()).resolves.toMatchObject({
    status: 'ok',
    service: 'digibusca-backend',
  })
})

test('API protege dados de usuários não autenticados', async ({ request }) => {
  const response = await request.get('/api/saved-leads')

  expect(response.status()).toBe(401)
  await expect(response.json()).resolves.toMatchObject({
    error: expect.stringMatching(/login/i),
  })
})

test('landing page abre as rotas de entrada e cadastro', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /Onde existe um negócio/ })).toBeVisible()

  await page.getByRole('button', { name: /Entrar/ }).first().click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta.' })).toBeVisible()

  await page.getByRole('button', { name: 'Criar uma conta' }).click()
  await expect(page).toHaveURL(/\/cadastro$/)
  await expect(page.getByRole('heading', { name: 'Crie sua conta.' })).toBeVisible()
})

test('login e cadastro preservam a rota após recarregar', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta.' })).toBeVisible()

  await page.goto('/cadastro')
  await expect(page.getByRole('button', { name: 'Criar conta', exact: true })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/\/cadastro$/)
  await expect(page.getByPlaceholder('Digite a senha novamente')).toBeVisible()
})

test('formulários de acesso validam os dados antes de enviar', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Digite um e-mail válido')

  await page.getByRole('textbox', { name: /Seu e-mail/ }).fill('teste@digibusca.local')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('pelo menos 8 caracteres')

  await page.goto('/cadastro')
  await page.getByRole('textbox', { name: /Seu e-mail/ }).fill('teste@digibusca.local')
  await page.getByPlaceholder('Mínimo de 8 caracteres').fill('senha-segura')
  await page.getByPlaceholder('Digite a senha novamente').fill('senha-diferente')
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('senhas não coincidem')
})

test('rota protegida redireciona visitantes para o login', async ({ page }) => {
  await page.goto('/sistema/leads')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta.' })).toBeVisible()
})

test('páginas públicas não criam rolagem horizontal', async ({ page }) => {
  for (const path of ['/', '/login', '/cadastro']) {
    await page.goto(path)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true)
  }
})
