'use client';

import { useLocale } from '@/i18n/context';

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  const locales = [
    { code: 'zh', label: '中文' },
    { code: 'en', label: 'English' },
  ] as const;

  return (
    <div className="relative">
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as 'zh' | 'en')}
        className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm font-mono cursor-pointer hover:bg-white/20 transition-colors appearance-none focus:outline-none focus:border-emerald-500/50"
      >
        {locales.map(({ code, label }) => (
          <option key={code} value={code} className="bg-gray-900">
            {label}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}
