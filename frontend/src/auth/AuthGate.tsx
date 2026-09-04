import { type PropsWithChildren, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import './AuthGate.css'

const providers = [
  { id: 'google', label: 'Continuar com Google' },
  { id: 'github', label: 'Continuar com GitHub' },
  { id: 'apple', label: 'Continuar com Apple' },
  { id: 'facebook', label: 'Continuar com Facebook' },
] as const

type AuthProvider = (typeof providers)[number]['id']

export function AuthGate({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState('')

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
          <span className="eyebrow">PROSPECÇÃO DIGITAL</span>
          <h1 id="auth-title">Encontre sua próxima oportunidade.</h1>
          <p>Entre para organizar seus leads, abordagens e vendas em um só lugar.</p>
          <div className="social-login-list">
            {providers.map(({ id, label }) => (
              <button
                className="social-login-button"
                key={id}
                type="button"
                onClick={() => void handleProviderLogin(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <small>Você será redirecionado para o provedor escolhido.</small>
        </section>
      </main>
    )
  }

  return children
}
