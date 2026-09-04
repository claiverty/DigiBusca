import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { ArrowLeft, Mail, RotateCw, ShieldCheck } from 'lucide-react'
import { FaApple, FaFacebookF, FaGithub, FaGoogle } from 'react-icons/fa'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import './AuthGate.css'

const providers = [
  { id: 'apple', label: 'Continue com Apple' },
  { id: 'google', label: 'Continue com Google' },
  { id: 'github', label: 'Continue com GitHub' },
  { id: 'facebook', label: 'Continue com Facebook' },
] as const

type AuthProvider = (typeof providers)[number]['id']
type AuthScreen = 'providers' | 'email' | 'verify'

const DEVICE_TRUST_KEY = 'digibusca:trusted-device'

const providerIcons = {
  google: FaGoogle,
  github: FaGithub,
  apple: FaApple,
  facebook: FaFacebookF,
} satisfies Record<AuthProvider, typeof FaGoogle>

type AuthContextValue = { user: User; signOut: () => Promise<void> }

const AuthContext = createContext<AuthContextValue | null>(null)

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
  const [isDeviceVerified, setIsDeviceVerified] = useState(false)
  const [authScreen, setAuthScreen] = useState<AuthScreen>('providers')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationMode, setVerificationMode] = useState<'email-login' | 'device'>('email-login')
  const [verificationRequestedFor, setVerificationRequestedFor] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

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

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !supabase) {
      return
    }

    if (window.localStorage.getItem(DEVICE_TRUST_KEY) === 'true') {
      setIsDeviceVerified(true)
      return
    }

    const sessionEmail = session.user.email
    if (!sessionEmail) {
      setError('Sua conta não possui um e-mail disponível para verificação.')
      return
    }

    setIsDeviceVerified(false)
    setEmail(sessionEmail)
    setVerificationMode('device')
    setAuthScreen('verify')

    if (verificationRequestedFor !== sessionEmail) {
      setVerificationRequestedFor(sessionEmail)
      void sendVerificationCode(sessionEmail, false)
    }
  }, [session, verificationRequestedFor])

  async function handleProviderLogin(provider: AuthProvider) {
    if (!supabase) {
      return
    }

    setError('')
    const { error: loginError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })

    if (loginError) {
      setError('Não foi possível iniciar o login. Tente novamente.')
    }
  }

  async function sendVerificationCode(targetEmail: string, shouldCreateUser: boolean) {
    if (!supabase) {
      return false
    }

    setError('')
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: { shouldCreateUser },
    })

    if (otpError) {
      setError('Não foi possível enviar o código. Confira o e-mail e tente novamente.')
      return false
    }

    setFeedback(`Enviamos um código de verificação para ${targetEmail}.`)
    return true
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!email.trim()) {
      setError('Digite um e-mail válido para continuar.')
      return
    }

    setIsSubmitting(true)
    setVerificationMode('email-login')
    const sent = await sendVerificationCode(email.trim(), true)
    setIsSubmitting(false)

    if (sent) {
      setVerificationCode('')
      setAuthScreen('verify')
    }
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (verificationCode.trim().length !== 6 || !supabase) {
      setError('Digite o código de 6 dígitos enviado para seu e-mail.')
      return
    }

    setIsSubmitting(true)
    setError('')
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: verificationCode.trim(),
      type: 'email',
    })
    setIsSubmitting(false)

    if (verifyError || !data.session) {
      setError('Esse código é inválido ou expirou. Solicite um novo código.')
      return
    }

    window.localStorage.setItem(DEVICE_TRUST_KEY, 'true')
    setSession(data.session)
    setIsDeviceVerified(true)
    setFeedback('Dispositivo verificado. Tudo pronto.')
  }

  async function handleResendCode() {
    setIsSubmitting(true)
    await sendVerificationCode(email, verificationMode === 'email-login')
    setIsSubmitting(false)
  }

  function handleBackToProviders() {
    setError('')
    setFeedback('')
    setVerificationCode('')
    setAuthScreen('providers')
  }

  async function handleSignOut() {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
    window.localStorage.removeItem(DEVICE_TRUST_KEY)
    setSession(null)
    setIsDeviceVerified(false)
    setAuthScreen('providers')
    setVerificationCode('')
    setFeedback('')
    setError('')
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="auth-page">
        <section className="auth-card panel" aria-labelledby="auth-setup-title">
          <div className="auth-brand" aria-label="DigiBusca">
            <span className="auth-brand-mark" />
            <span>DigiBusca</span>
          </div>
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
    return (
      <main className="auth-page">
        <section className="auth-card panel" aria-labelledby="auth-title">
          <div className="auth-brand" aria-label="DigiBusca">
            <span className="auth-brand-mark" />
            <span>DigiBusca</span>
          </div>
          {authScreen === 'providers' && (
            <>
              <span className="eyebrow">PROSPECÇÃO DIGITAL</span>
              <h1 id="auth-title">Encontre sua próxima oportunidade.</h1>
              <p>Entre para organizar seus leads, abordagens e vendas em um só lugar.</p>
              <div className="social-login-list">
                {providers.map(({ id, label }) => {
                  const Icon = providerIcons[id]

                  return (
                    <button
                      className={`social-login-button provider-${id}`}
                      key={id}
                      type="button"
                      onClick={() => void handleProviderLogin(id)}
                    >
                      <Icon className="social-icon" aria-hidden="true" />
                      {label}
                    </button>
                  )
                })}
              </div>
              <div className="auth-divider" aria-hidden="true">
                <span />
                <small>Ou</small>
                <span />
              </div>
              <button
                className="social-login-button email-login-button"
                type="button"
                onClick={() => {
                  setError('')
                  setFeedback('')
                  setAuthScreen('email')
                }}
              >
                <Mail className="social-icon" aria-hidden="true" />
                Login com e-mail
              </button>
            </>
          )}

          {authScreen === 'email' && (
            <form className="auth-form" onSubmit={handleEmailSubmit}>
              <button className="auth-back-button" type="button" onClick={handleBackToProviders}>
                <ArrowLeft size={16} aria-hidden="true" /> Voltar
              </button>
              <span className="eyebrow">LOGIN COM E-MAIL</span>
              <h1 id="auth-title">Entre sem criar senha.</h1>
              <p>Enviaremos um código de acesso para confirmar seu e-mail.</p>
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
                {isSubmitting ? 'Enviando código...' : 'Enviar código'}
              </button>
            </form>
          )}

          {authScreen === 'verify' && (
            <form className="auth-form" onSubmit={handleCodeSubmit}>
              <div className="verification-icon" aria-hidden="true">
                <ShieldCheck size={21} />
              </div>
              <span className="eyebrow">
                {verificationMode === 'device' ? 'NOVO DISPOSITIVO' : 'VERIFICAÇÃO'}
              </span>
              <h1 id="auth-title">Confirme seu acesso.</h1>
              <p>
                Digite o código de 6 dígitos enviado para <strong>{email}</strong>.
              </p>
              <label className="auth-field verification-field">
                <span>Código de verificação</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
              </label>
              <button className="email-submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Verificando...' : 'Confirmar código'}
              </button>
              <button
                className="auth-resend-button"
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleResendCode()}
              >
                <RotateCw size={14} aria-hidden="true" /> Reenviar código
              </button>
            </form>
          )}

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {feedback && <p className="auth-feedback">{feedback}</p>}
          {authScreen === 'providers' && <small>Você será redirecionado para o provedor escolhido.</small>}
        </section>
      </main>
    )
  }

  if (!isDeviceVerified) {
    return (
      <main className="auth-page">
        <section className="auth-card panel" aria-labelledby="device-auth-title">
          <div className="auth-brand" aria-label="DigiBusca">
            <span className="auth-brand-mark" />
            <span>DigiBusca</span>
          </div>
          <span className="eyebrow">VERIFICAÇÃO DE ACESSO</span>
          <h1 id="device-auth-title">Confirme seu dispositivo.</h1>
          <p>Enviamos um código para o e-mail da sua conta antes de liberar este navegador.</p>
          <form className="auth-form" onSubmit={handleCodeSubmit}>
            <label className="auth-field verification-field">
              <span>Código de verificação</span>
              <input
                autoFocus
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoComplete="one-time-code"
              />
            </label>
            <button className="email-submit-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Verificando...' : 'Confirmar código'}
            </button>
            <button
              className="auth-resend-button"
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleResendCode()}
            >
              <RotateCw size={14} aria-hidden="true" /> Reenviar código
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
    <AuthContext.Provider value={{ user: session.user, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  )
}
