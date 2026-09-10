import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { ArrowLeft, Building2, CalendarClock, Eye, EyeOff, LayoutDashboard, Mail, MessageSquareText, UsersRound, Wallet } from 'lucide-react'
import { FaGoogle } from 'react-icons/fa'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { LandingPage } from '../pages/LandingPage'
import { LegalPage } from '../pages/LegalPage'
import './AuthGate.css'

const providers = [
  { id: 'google', label: 'Google' },
] as const

type AuthProvider = (typeof providers)[number]['id']
type AuthScreen = 'providers' | 'forgot'
type LegalPageName = 'privacy' | 'terms'
type AppRoute = '/' | '/login' | '/cadastro' | '/sistema'

const appRoutes = new Set<AppRoute>(['/', '/login', '/cadastro', '/sistema'])

function normalizePathname(pathname = window.location.pathname) {
  return pathname.replace(/\/+$/, '') || '/'
}

function isSystemPath(pathname: string) {
  return pathname === '/sistema' || pathname.startsWith('/sistema/')
}

function getCurrentRoute(): AppRoute {
  const pathname = normalizePathname()

  if (isSystemPath(pathname)) {
    return '/sistema'
  }

  return appRoutes.has(pathname as AppRoute) ? (pathname as AppRoute) : '/'
}

function isKnownPath(pathname: string) {
  return isSystemPath(pathname) || appRoutes.has(pathname as AppRoute)
}

const providerIcons = {
  google: FaGoogle,
} satisfies Record<AuthProvider, typeof FaGoogle>

type AuthContextValue = {
  user: User
  signOut: () => Promise<void>
  showLanding: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

type PasswordFieldProps = {
  label: string
  value: string
  placeholder: string
  autoComplete: string
  autoFocus?: boolean
  onChange: (value: string) => void
}

function PasswordField({
  label,
  value,
  placeholder,
  autoComplete,
  autoFocus = false,
  onChange,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <label className="auth-field">
      <span>{label}</span>
      <span className="password-input-wrap">
        <input
          autoFocus={autoFocus}
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <button
          className="password-visibility-button"
          type="button"
          aria-label={isVisible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          onClick={() => setIsVisible((current) => !current)}
        >
          {isVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </span>
    </label>
  )
}

function AuthShowcase() {
  return (
    <aside className="auth-showcase" aria-label="Uma visão do DigiBusca">
      <div className="auth-dashboard-stage" aria-hidden="true">
        <div className="auth-dashboard-frame">
          <div className="auth-dashboard-topbar">
            <span className="auth-dashboard-brand"><i /> DigiBusca</span>
            <b>C</b>
          </div>
          <div className="auth-dashboard-body">
            <nav>
              <span className="active"><LayoutDashboard size={13} /></span>
              <span><Building2 size={13} /></span>
              <span><UsersRound size={13} /></span>
              <span><Wallet size={13} /></span>
            </nav>
            <div className="auth-dashboard-content">
              <small>VISÃO GERAL</small>
              <h3>Seu próximo negócio começa aqui.</h3>
              <div className="auth-dashboard-stats">
                <article><UsersRound size={13} /><span>Leads salvos</span><strong>18</strong></article>
                <article><CalendarClock size={13} /><span>Follow-ups</span><strong>6</strong></article>
                <article><Wallet size={13} /><span>Vendas</span><strong>R$ 8,4k</strong></article>
              </div>
              <div className="auth-dashboard-activity">
                <span>ATIVIDADE RECENTE</span>
                <div><i /><i /><i /><i /><i /></div>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-floating-lead">
          <Building2 size={16} />
          <span><small>OPORTUNIDADE</small><strong>Empresa sem site</strong></span>
          <b>89%</b>
        </div>
        <div className="auth-floating-message">
          <MessageSquareText size={16} />
          <span><strong>Abordagem pronta</strong><small>Gerada com IA</small></span>
        </div>
      </div>

      <div className="auth-showcase-copy">
        <span className="auth-showcase-eyebrow">DIGIBUSCA</span>
        <h2>Sua prospecção, organizada de verdade.</h2>
        <p>Busque oportunidades, prepare abordagens e acompanhe cada conversa.</p>
      </div>
    </aside>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error('useAuth precisa ser usado dentro de AuthGate.')
  }

  return auth
}

export function AuthGate({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [authScreen, setAuthScreen] = useState<AuthScreen>('providers')
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute)
  const [legalPage, setLegalPage] = useState<LegalPageName | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const isCreatingAccount = route === '/cadastro'

  const navigateTo = useCallback((nextRoute: AppRoute, replace = false) => {
    if (window.location.pathname !== nextRoute || window.location.hash) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', nextRoute)
    }

    setRoute(nextRoute)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const syncRoute = () => setRoute(getCurrentRoute())
    const currentRoute = getCurrentRoute()
    const currentPath = normalizePathname()

    if (!isKnownPath(currentPath)) {
      window.history.replaceState({}, '', currentRoute)
    }

    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  useEffect(() => {
    if (!supabase) {
      return
    }

    let isMounted = true

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!isMounted) {
        return
      }

      if (sessionError) {
        setError('Não foi possível verificar sua sessão.')
      }

      setSession(data.session)
      setIsLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
      }

      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!session && route === '/sistema') {
      navigateTo('/login', true)
      return
    }

    if (session && !isPasswordRecovery && (route === '/login' || route === '/cadastro')) {
      navigateTo('/sistema', true)
    }
  }, [isLoading, isPasswordRecovery, navigateTo, route, session])

  async function handleProviderLogin(provider: AuthProvider) {
    if (!supabase) {
      return
    }

    setError('')
    const { error: loginError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/sistema` },
    })

    if (loginError) {
      setError('Não foi possível iniciar o login. Tente novamente.')
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!email.trim()) {
      setError('Digite um e-mail válido para continuar.')
      return
    }

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (isCreatingAccount && password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }

    if (!supabase) {
      return
    }

    setIsSubmitting(true)
    setError('')
    setFeedback('')
    const result = isCreatingAccount
      ? await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/sistema` },
        })
      : await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
    setIsSubmitting(false)

    if (result.error) {
      setError(
        isCreatingAccount
          ? 'Não foi possível criar a conta. Confira os dados e tente novamente.'
          : 'E-mail ou senha inválidos.',
      )
      return
    }

    if (isCreatingAccount) {
      if (!result.data.session) {
        setError('A confirmação de e-mail ainda está ativa no Supabase. Desative-a para entrar sem verificação.')
        return
      }

      setSession(result.data.session)
      return
    }

    setSession(result.data.session)
  }

  async function handleForgotPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!email.trim() || !supabase) {
      setError('Digite um e-mail válido para continuar.')
      return
    }

    setIsSubmitting(true)
    setError('')
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`,
    })
    setIsSubmitting(false)

    if (resetError) {
      setError('Não foi possível enviar o link. Confira o e-mail e tente novamente.')
      return
    }

    setFeedback('Enviamos um link de recuperação para seu e-mail.')
  }

  async function handlePasswordResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (password !== confirmPassword || !supabase) {
      setError('As senhas não coincidem.')
      return
    }

    setIsSubmitting(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setIsSubmitting(false)

    if (updateError) {
      setError('Não foi possível atualizar sua senha. Solicite um novo link.')
      return
    }

    setPassword('')
    setConfirmPassword('')
    setIsPasswordRecovery(false)
    setFeedback('Senha atualizada. Seu acesso está pronto.')
  }

  function handleBackToProviders() {
    setError('')
    setFeedback('')
    setPassword('')
    setConfirmPassword('')
    setAuthScreen('providers')
  }

  function handleOpenSignIn() {
    if (session) {
      navigateTo('/sistema')
      return
    }

    setError('')
    setFeedback('')
    setLegalPage(null)
    setAuthScreen('providers')
    navigateTo('/login')
  }

  function handleOpenCreateAccount() {
    if (session) {
      navigateTo('/sistema')
      return
    }

    setError('')
    setFeedback('')
    setLegalPage(null)
    setAuthScreen('providers')
    navigateTo('/cadastro')
  }

  function handleSwitchAuthMode() {
    setError('')
    setFeedback('')
    setPassword('')
    setConfirmPassword('')
    navigateTo(isCreatingAccount ? '/login' : '/cadastro')
  }

  async function handleSignOut() {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
    setSession(null)
    setAuthScreen('providers')
    setPassword('')
    setConfirmPassword('')
    setIsPasswordRecovery(false)
    setFeedback('')
    setError('')
    navigateTo('/')
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-card panel" aria-labelledby="auth-setup-title">
          <button
            className="auth-brand"
            type="button"
            onClick={() => navigateTo('/')}
            aria-label="Voltar ao início"
          >
            <span className="auth-brand-mark" />
            <span>DigiBusca</span>
          </button>
          <span className="eyebrow">CONFIGURAÇÃO INICIAL</span>
          <h1 id="auth-setup-title">Sua conta começa aqui.</h1>
          <p>
            Configure o projeto Supabase para ativar o login social e proteger os dados de cada
            usuário.
          </p>
          <div className="auth-setup-note">
            <strong>Falta apenas conectar o ambiente.</strong>
            <span>As chaves ficam no arquivo .env e nunca entram no código ou no GitHub.</span>
          </div>
        </section>
      </main>
    )
  }

  if (isLoading) {
    return (
      <main className="auth-page">
        <section className="auth-card panel" aria-live="polite">
          <span className="eyebrow">DIGIBUSCA</span>
          <h1>Preparando seu espaço.</h1>
          <p>Verificando sua sessão com segurança.</p>
        </section>
      </main>
    )
  }

  if (!session) {
    if (legalPage) {
      return <LegalPage page={legalPage} onBack={() => setLegalPage(null)} />
    }

    if (route === '/') {
      return (
        <LandingPage
          onCreateAccount={handleOpenCreateAccount}
          onSignIn={handleOpenSignIn}
          onShowLegalPage={setLegalPage}
        />
      )
    }

    return (
      <main className="auth-page auth-access-page">
        <div className="auth-shell">
          <section className="auth-card auth-access-panel" aria-labelledby="auth-title">
            <button
              className="auth-brand"
              type="button"
              onClick={() => navigateTo('/')}
              aria-label="Voltar ao início"
            >
              <span className="auth-brand-mark" />
              <span>DigiBusca</span>
            </button>
          {authScreen === 'providers' && (
            <form className="auth-form auth-primary-form" onSubmit={handleEmailSubmit}>
              <span className="eyebrow">PROSPECÇÃO DIGITAL</span>
              <h1 id="auth-title">
                {isCreatingAccount ? 'Crie sua conta.' : 'Bem-vindo de volta.'}
              </h1>
              <p>
                {isCreatingAccount
                  ? 'Comece a organizar seus leads, abordagens e vendas em um só lugar.'
                  : 'Acesse sua carteira de leads e continue de onde parou.'}
              </p>
              <label className="auth-field">
                <span>Seu e-mail</span>
                <span className="auth-input-wrap">
                  <Mail className="auth-input-icon" size={17} aria-hidden="true" />
                  <input
                    autoFocus
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="seu@email.com"
                    autoComplete="email"
                  />
                </span>
              </label>
              <PasswordField
                label="Senha"
                value={password}
                onChange={setPassword}
                placeholder="Mínimo de 8 caracteres"
                autoComplete={isCreatingAccount ? 'new-password' : 'current-password'}
              />
              {isCreatingAccount && (
                <PasswordField
                  label="Confirme sua senha"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="Digite a senha novamente"
                  autoComplete="new-password"
                />
              )}
              {!isCreatingAccount && (
                <div className="auth-login-options">
                  <span>Acesso seguro</span>
                  <button
                    className="auth-link-button"
                    type="button"
                    onClick={() => {
                      setError('')
                      setFeedback('')
                      setAuthScreen('forgot')
                    }}
                  >
                    Esqueceu sua senha?
                  </button>
                </div>
              )}
              <button className="email-submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Aguarde...' : isCreatingAccount ? 'Criar conta' : 'Entrar'}
              </button>

              <div className="auth-divider" aria-hidden="true">
                <span />
                <small>Ou</small>
                <span />
              </div>
              <div className="social-login-list auth-social-alternative">
                {providers.map(({ id, label }) => {
                  const Icon = providerIcons[id]

                  return (
                    <button
                      className="auth-social-icon-button"
                      key={id}
                      type="button"
                      aria-label={isCreatingAccount ? `Criar com ${label}` : `Continuar com ${label}`}
                      onClick={() => void handleProviderLogin(id)}
                    >
                      <Icon aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
              <button className="auth-home-link" type="button" onClick={handleSwitchAuthMode}>
                {isCreatingAccount ? 'Já tenho uma conta' : 'Criar uma conta'}
              </button>
            </form>
          )}

          {authScreen === 'forgot' && (
            <form className="auth-form" onSubmit={handleForgotPasswordSubmit}>
              <button className="auth-back-button" type="button" onClick={handleBackToProviders}>
                <ArrowLeft size={16} aria-hidden="true" /> Voltar
              </button>
              <span className="eyebrow">RECUPERAÇÃO DE ACESSO</span>
              <h1 id="auth-title">Recupere sua senha.</h1>
              <p>Enviaremos um link seguro para você criar uma nova senha.</p>
              <label className="auth-field">
                <span>Seu e-mail</span>
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@empresa.com"
                  autoComplete="email"
                />
              </label>
              <button className="email-submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Enviando...' : 'Enviar link de recuperação'}
              </button>
            </form>
          )}

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {feedback && <p className="auth-feedback">{feedback}</p>}
          </section>
          <AuthShowcase />
        </div>
      </main>
    )
  }

  if (route === '/') {
    if (legalPage) {
      return <LegalPage page={legalPage} onBack={() => setLegalPage(null)} />
    }

    return (
      <LandingPage
        onCreateAccount={handleOpenCreateAccount}
        onSignIn={handleOpenSignIn}
        onShowLegalPage={setLegalPage}
      />
    )
  }

  if (isPasswordRecovery && session) {
    return (
      <main className="auth-page">
        <section className="auth-card panel" aria-labelledby="password-reset-title">
          <div className="auth-brand" aria-label="DigiBusca">
            <span className="auth-brand-mark" />
            <span>DigiBusca</span>
          </div>
          <form className="auth-form" onSubmit={handlePasswordResetSubmit}>
            <span className="eyebrow">NOVA SENHA</span>
            <h1 id="password-reset-title">Escolha uma nova senha.</h1>
            <p>Use pelo menos 8 caracteres para proteger sua conta.</p>
            <PasswordField
              label="Nova senha"
              value={password}
              onChange={setPassword}
              placeholder="Mínimo de 8 caracteres"
              autoComplete="new-password"
              autoFocus
            />
            <PasswordField
              label="Confirme sua senha"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Digite a senha novamente"
              autoComplete="new-password"
            />
            <button className="email-submit-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Atualizando...' : 'Atualizar senha'}
            </button>
          </form>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {feedback && <p className="auth-feedback">{feedback}</p>}
        </section>
      </main>
    )
  }

  return (
    <AuthContext.Provider
      value={{ user: session.user, signOut: handleSignOut, showLanding: () => navigateTo('/') }}
    >
      {children}
    </AuthContext.Provider>
  )
}
