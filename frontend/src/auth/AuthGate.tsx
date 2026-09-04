import {
  createContext,
  type FormEvent,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { ArrowLeft, Eye, EyeOff, Mail, RotateCw, ShieldCheck } from 'lucide-react'
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
type AuthScreen = 'providers' | 'email' | 'forgot' | 'verify' | 'reset'

const DEVICE_TRUST_KEY = 'digibusca:trusted-device'

const providerIcons = {
  google: FaGoogle,
  github: FaGithub,
  apple: FaApple,
  facebook: FaFacebookF,
} satisfies Record<AuthProvider, typeof FaGoogle>

type AuthContextValue = { user: User; signOut: () => Promise<void> }

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
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [authScreen, setAuthScreen] = useState<AuthScreen>('providers')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [verificationMode, setVerificationMode] = useState<'email-signup' | 'device'>('device')
  const [verificationRequestedFor, setVerificationRequestedFor] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const awaitingSignupConfirmation = useRef(false)
  const awaitingDeviceLink = useRef(false)

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

      if (event === 'SIGNED_IN' && (awaitingSignupConfirmation.current || awaitingDeviceLink.current)) {
        window.localStorage.setItem(DEVICE_TRUST_KEY, 'true')
        awaitingSignupConfirmation.current = false
        awaitingDeviceLink.current = false
        setIsDeviceVerified(true)
        setFeedback('E-mail confirmado. Tudo pronto.')
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
    setAuthScreen('verify')

    if (verificationRequestedFor !== sessionEmail) {
      setVerificationRequestedFor(sessionEmail)
      void sendVerificationLink(sessionEmail, false)
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

  async function sendVerificationLink(targetEmail: string, shouldCreateUser: boolean) {
    if (!supabase) {
      return false
    }

    setError('')
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: { shouldCreateUser, emailRedirectTo: window.location.origin },
    })

    if (otpError) {
      setError('Não foi possível enviar o link. Confira o e-mail e tente novamente.')
      return false
    }

    awaitingDeviceLink.current = !shouldCreateUser
    setFeedback(`Enviamos um link de verificação para ${targetEmail}.`)
    return true
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
          options: { emailRedirectTo: window.location.origin },
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
      awaitingSignupConfirmation.current = true
      setVerificationMode('email-signup')
      setAuthScreen('verify')
      setFeedback(`Enviamos um link de confirmação para ${email.trim()}.`)
      return
    }

    setSession(result.data.session)
  }

  async function handleResendLink() {
    if (!supabase) {
      return
    }

    setIsSubmitting(true)
    if (verificationMode === 'email-signup') {
      setError('')
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      })

      if (resendError) {
        setError('Não foi possível reenviar o link. Tente novamente em instantes.')
      } else {
        setFeedback(`Enviamos um novo link de confirmação para ${email}.`)
      }
    } else {
      await sendVerificationLink(email, false)
    }
    setIsSubmitting(false)
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
      redirectTo: window.location.origin,
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
    awaitingSignupConfirmation.current = false
    awaitingDeviceLink.current = false
    setIsCreatingAccount(false)
    setAuthScreen('providers')
  }

  async function handleSignOut() {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
    window.localStorage.removeItem(DEVICE_TRUST_KEY)
    awaitingSignupConfirmation.current = false
    awaitingDeviceLink.current = false
    setSession(null)
    setIsDeviceVerified(false)
    setAuthScreen('providers')
    setPassword('')
    setConfirmPassword('')
    setIsPasswordRecovery(false)
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
              <h1 id="auth-title">{isCreatingAccount ? 'Crie sua conta.' : 'Entre na sua conta.'}</h1>
              <p>
                {isCreatingAccount
                  ? 'Crie uma conta para organizar seus leads, abordagens e vendas.'
                  : 'Use seu e-mail e senha para acessar seu espaço.'}
              </p>
              <label className="auth-field">
                <span>Seu e-mail</span>
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seu@email.com"
                  autoComplete="email"
                />
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
              <button className="email-submit-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Aguarde...' : isCreatingAccount ? 'Criar conta' : 'Entrar'}
              </button>
              <div className="auth-secondary-actions">
                {!isCreatingAccount && (
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
                )}
                <button
                  className="auth-link-button"
                  type="button"
                  onClick={() => {
                    setError('')
                    setFeedback('')
                    setIsCreatingAccount((current) => !current)
                    setPassword('')
                    setConfirmPassword('')
                  }}
                >
                  {isCreatingAccount ? 'Já tenho uma conta' : 'Criar uma conta'}
                </button>
              </div>
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

          {authScreen === 'verify' && (
            <div className="auth-form">
              <div className="verification-icon" aria-hidden="true">
                <ShieldCheck size={21} />
              </div>
              <span className="eyebrow">
                {verificationMode === 'device' ? 'NOVO DISPOSITIVO' : 'VERIFICAÇÃO'}
              </span>
              <h1 id="auth-title">
                {verificationMode === 'device' ? 'Confirme seu dispositivo.' : 'Confirme seu e-mail.'}
              </h1>
              <p>
                {verificationMode === 'device'
                  ? 'Enviamos um link para o e-mail da sua conta. Abra-o para liberar este navegador.'
                  : 'Enviamos um link para o seu e-mail. Abra-o para confirmar sua conta.'}{' '}
                <strong>{email}</strong>.
              </p>
              <button
                className="auth-resend-button"
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleResendLink()}
              >
                <RotateCw size={14} aria-hidden="true" /> Reenviar link
              </button>
            </div>
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
          <p>Enviamos um link para o e-mail da sua conta antes de liberar este navegador.</p>
          <div className="auth-form">
            <button
              className="auth-resend-button"
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleResendLink()}
            >
              <RotateCw size={14} aria-hidden="true" /> Reenviar link
            </button>
          </div>
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
