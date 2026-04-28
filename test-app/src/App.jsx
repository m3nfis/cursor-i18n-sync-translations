import { useMemo, useState } from 'react'
import en from './locales/i18n-en.json'
import es from './locales/i18n-es.json'
import fr from './locales/i18n-fr.json'
import zh from './locales/i18n-zh.json'
import './App.css'

const catalogs = { en, es, fr, zh }

function interpolate(template, values) {
  return template.replaceAll(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`)
}

function App() {
  const [lang, setLang] = useState('en')
  const [guests, setGuests] = useState(2)
  const [nights, setNights] = useState(3)
  const [breakfast, setBreakfast] = useState(false)

  const dictionary = catalogs[lang] ?? catalogs.en
  const values = useMemo(
    () => ({
      price: '$149',
      fee: '$18',
      refundPct: '80%',
      refundDays: 7,
      guests,
      nights,
    }),
    [guests, nights],
  )

  const t = (key) => interpolate(dictionary[key] ?? catalogs.en[key] ?? key, values)

  return (
    <main className="booking-page">
      <header className="top-row">
        <h1>{t('pageTitle')}</h1>
        <label className="lang-picker">
          <span>{t('languagePickerLabel')}</span>
          <select value={lang} onChange={(event) => setLang(event.target.value)}>
            <option value="en">English</option>
            <option value="es">Espanol</option>
            <option value="fr">Francais</option>
            <option value="zh">Chinese</option>
          </select>
        </label>
      </header>

      <p
        className="html-line"
        dangerouslySetInnerHTML={{ __html: t('heroSubtitle') }}
      />

      <section className="booking-card">
        <div className="field-group">
          <label>
            {t('checkInLabel')}
            <input type="date" defaultValue="2026-05-12" />
          </label>
          <label>
            {t('checkOutLabel')}
            <input type="date" defaultValue="2026-05-15" />
          </label>
          <label>
            {t('guestLabel')}
            <input
              type="number"
              min="1"
              max="8"
              value={guests}
              onChange={(event) => setGuests(Number(event.target.value))}
            />
          </label>
          <label>
            <span>{t('nightsLabel')}</span>
            <input
              type="number"
              min="1"
              max="14"
              value={nights}
              onChange={(event) => setNights(Number(event.target.value))}
            />
          </label>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={breakfast}
            onChange={() => setBreakfast((value) => !value)}
          />
          <span>{t('breakfastToggle')}</span>
        </label>

        <p className="summary">{t('roomSummary')}</p>
        <button type="button">{t('ctaButton')}</button>
      </section>

      <p className="html-line" dangerouslySetInnerHTML={{ __html: t('trustNote') }} />

      <section className="legal-block">
        <p
          className="legal-paragraph"
          dangerouslySetInnerHTML={{ __html: t('roomOptions') }}
        />
        <p
          className="legal-paragraph"
          dangerouslySetInnerHTML={{ __html: t('legalDisclaimer') }}
        />
        <p
          className="legal-paragraph"
          dangerouslySetInnerHTML={{ __html: t('cancellationTerms') }}
        />
      </section>

      <p className="footer-note">{t('footerHelp')}</p>
    </main>
  )
}

export default App
