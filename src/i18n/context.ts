import { createContext, useContext } from 'react'
import { STRINGS, type Strings, type UiLang } from './strings'

const KEY = 'network-tutorial-ui-lang'

export function savedUiLang(): UiLang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'uz' || v === 'ru' || v === 'en') return v
  } catch {
    // ignore
  }
  const nav = navigator.language.toLowerCase()
  if (nav.startsWith('ru')) return 'ru'
  if (nav.startsWith('en')) return 'en'
  return 'uz'
}

export function storeUiLang(l: UiLang) {
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // ignore
  }
}

interface I18n {
  lang: UiLang
  t: Strings
  setLang: (l: UiLang) => void
}

export const I18nContext = createContext<I18n>({ lang: 'uz', t: STRINGS.uz, setLang: () => {} })

export const useI18n = () => useContext(I18nContext)
