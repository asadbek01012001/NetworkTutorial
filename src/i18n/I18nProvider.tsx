import { useEffect, useState, type ReactNode } from 'react'
import { I18nContext, savedUiLang, storeUiLang } from './context'
import { STRINGS, type UiLang } from './strings'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<UiLang>(savedUiLang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = STRINGS[lang].siteTitle
  }, [lang])

  const change = (l: UiLang) => {
    setLang(l)
    storeUiLang(l)
  }

  return <I18nContext.Provider value={{ lang, t: STRINGS[lang], setLang: change }}>{children}</I18nContext.Provider>
}
