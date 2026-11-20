import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import {
  APP_LANGUAGES,
  LOCALE_STORAGE_KEY,
  detectInitialLocale,
  translate,
  type AppLocale,
  type TranslationKey,
} from './translations';

interface LanguageContextValue {
  locale: AppLocale;
  bcp47: string;
  setLocale: (next: AppLocale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => detectInitialLocale());

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const bcp47 = useMemo(
    () => APP_LANGUAGES.find((l) => l.code === locale)?.bcp47 || 'id-ID',
    [locale]
  );

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale]
  );

  const value = useMemo(
    () => ({ locale, bcp47, setLocale, t }),
    [locale, bcp47, setLocale, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      locale: 'id',
      bcp47: 'id-ID',
      setLocale: () => {},
      t: (key, vars) => translate('id', key, vars),
    };
  }
  return ctx;
}

export function LanguageSelector({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-lg bg-[#101d3d] border border-[#2a4173] hover:border-[#ff6b00]/70 transition-colors cursor-pointer ${
        compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
      } ${className}`}
      title={t('nav.languageLabel')}
    >
      <Globe className="w-3.5 h-3.5 text-[#ff8224] shrink-0" />
      <select
        aria-label={t('nav.languageLabel')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as AppLocale)}
        className="w-full bg-transparent text-[#f1f5fc] font-semibold focus:outline-none cursor-pointer pr-1"
      >
        {APP_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code} className="bg-[#0c1733] text-[#f1f5fc]">
            {compact ? `${lang.shortLabel} · ${lang.nativeName}` : lang.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
