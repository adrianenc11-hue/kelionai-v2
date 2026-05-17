import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { t } from '../lib/uiStrings'

// Kelion — standard contact page.
// Form fields: name, email, department (select), subject, message.
// Submit composes a mailto: to contact@kelionai.app with the department
// encoded in the subject prefix, so whoever triages the inbox can sort
// by department with a filter rule. Frontend-only for now — we can swap
// in a server-side POST later without changing the UI.

const DEPARTMENTS = [
  { key: 'general',      i18nKey: 'generalInquiry' },
  { key: 'support',      i18nKey: 'technicalSupport' },
  { key: 'billing',      i18nKey: 'billingAndSubs' },
  { key: 'sales',        i18nKey: 'salesAndDemos' },
  { key: 'partnerships', i18nKey: 'partnerships' },
  { key: 'press',        i18nKey: 'pressAndMedia' },
  { key: 'careers',      i18nKey: 'careers' },
  { key: 'privacy',      i18nKey: 'privacyAndData' },
]

const CONTACT_EMAIL = 'contact@kelionai.app'

function InputLabel({ children }) {
  return (
    <label style={{
      display: 'block',
      fontSize: 12,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: 'rgba(237, 233, 254, 0.55)',
      marginBottom: 6,
    }}>
      {children}
    </label>
  )
}

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  background: 'rgba(10, 8, 20, 0.55)',
  border: '1px solid rgba(167, 139, 250, 0.25)',
  color: '#ede9fe',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.15s, background 0.15s',
  boxSizing: 'border-box',
}

export default function ContactPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [department, setDepartment] = useState('general')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const deptLabel = useMemo(
    () => t(DEPARTMENTS.find((d) => d.key === department)?.i18nKey || 'generalInquiry'),
    [department],
  )

  const canSubmit = email.trim().length > 3 && message.trim().length > 0

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSubmit) return

    // Subject prefix lets Kelion's inbox filter by department.
    const prefix = `[${deptLabel}]`
    const finalSubject = subject.trim()
      ? `${prefix} ${subject.trim()}`
      : `${prefix} ${name.trim() ? `Message from ${name.trim()}` : 'New message'}`

    const body = [
      name.trim() && `Name: ${name.trim()}`,
      email.trim() && `Email: ${email.trim()}`,
      `Department: ${deptLabel}`,
      '',
      message.trim(),
    ].filter(Boolean).join('\n')

    const mailto = `mailto:${CONTACT_EMAIL}`
      + `?subject=${encodeURIComponent(finalSubject)}`
      + `&body=${encodeURIComponent(body)}`

    window.location.href = mailto
  }

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: 'radial-gradient(ellipse at 30% 20%, #1a1130 0%, #05060a 65%)',
      color: '#ede9fe',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      padding: '40px 20px',
      boxSizing: 'border-box',
      display: 'flex',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* Back link */}
        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'rgba(237, 233, 254, 0.6)',
            textDecoration: 'none',
            fontSize: 13,
            marginBottom: 24,
          }}
        >
          {t('backToKelionFull')}
        </Link>

        <h1 style={{
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          margin: '0 0 8px',
        }}>
          {t('contactTitle')}
        </h1>
        <p style={{
          color: 'rgba(237, 233, 254, 0.6)',
          fontSize: 14,
          lineHeight: 1.55,
          margin: '0 0 28px',
        }}>
          {t('contactSubtitle')}{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            style={{ color: '#a78bfa', textDecoration: 'none' }}
          >
            {CONTACT_EMAIL}
          </a>.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            padding: 24,
            borderRadius: 16,
            background: 'rgba(10, 8, 20, 0.35)',
            border: '1px solid rgba(167, 139, 250, 0.18)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div>
            <InputLabel>{t('yourName')}</InputLabel>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              style={inputStyle}
              autoComplete="name"
            />
          </div>

          <div>
            <InputLabel>{t('emailLabel')} <span style={{ color: '#f87171' }}>*</span></InputLabel>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
              required
              autoComplete="email"
            />
          </div>

          <div>
            <InputLabel>{t('department')}</InputLabel>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{ ...inputStyle, appearance: 'auto' }}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d.key} value={d.key} style={{ background: '#1a1130' }}>
                  {t(d.i18nKey)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <InputLabel>{t('subject')}</InputLabel>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('subjectPlaceholder')}
              style={inputStyle}
            />
          </div>

          <div>
            <InputLabel>{t('message')} <span style={{ color: '#f87171' }}>*</span></InputLabel>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('messagePlaceholder')}
              rows={6}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 120, lineHeight: 1.5 }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: '14px 20px',
              borderRadius: 12,
              border: '1px solid rgba(167, 139, 250, 0.5)',
              background: canSubmit
                ? 'linear-gradient(135deg, #a78bfa, #60a5fa)'
                : 'rgba(167, 139, 250, 0.15)',
              color: canSubmit ? '#0b0716' : 'rgba(237, 233, 254, 0.45)',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.03em',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'transform 0.1s, box-shadow 0.15s',
              boxShadow: canSubmit
                ? '0 8px 24px rgba(167, 139, 250, 0.25)'
                : 'none',
            }}
            onMouseDown={(e) => {
              if (canSubmit) e.currentTarget.style.transform = 'scale(0.98)'
            }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            {t('sendMessage')}
          </button>

          <p style={{
            fontSize: 11,
            color: 'rgba(237, 233, 254, 0.45)',
            lineHeight: 1.5,
            margin: 0,
          }}>
            {t('submitHint')} {CONTACT_EMAIL}.
          </p>
        </form>
      </div>
    </div>
  )
}
