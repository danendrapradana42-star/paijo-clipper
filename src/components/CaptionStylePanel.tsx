import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import type { CaptionSettings, SubtitlePosition, SubtitleStyleId } from '../types/clipper';
import {
  CAPTION_PRESETS,
  FONT_CATEGORIES,
  FONT_CATALOG,
  HIGHLIGHT_SWATCHES,
  STYLE_OPTIONS,
  ensureFontLoaded,
  findFontEntry,
  type FontCategory,
} from '../utils/fontCatalog';

interface CaptionStylePanelProps {
  settings: CaptionSettings;
  onChange: (patch: Partial<CaptionSettings>) => void;
  compact?: boolean;
  onFontReady?: () => void;
}

export function CaptionStylePanel({
  settings,
  onChange,
  compact = false,
  onFontReady,
}: CaptionStylePanelProps) {
  const { t } = useTranslation();
  const [fontCategory, setFontCategory] = useState<FontCategory>('all');
  const onFontReadyRef = useRef(onFontReady);
  onFontReadyRef.current = onFontReady;

  useEffect(() => {
    let active = true;
    ensureFontLoaded(
      settings.fontFamily,
      Boolean(settings.italic),
      settings.fontWeight || '800'
    ).then(() => {
      if (active) onFontReadyRef.current?.();
    });
    return () => {
      active = false;
    };
  }, [settings.fontFamily, settings.italic, settings.fontWeight]);

  const filteredFonts =
    fontCategory === 'all'
      ? FONT_CATALOG
      : FONT_CATALOG.filter((f) => f.category === fontCategory);

  const activeFont = findFontEntry(settings.fontFamily);
  const dropdownFonts =
    activeFont && !filteredFonts.some((f) => f.value === activeFont.value)
      ? [activeFont, ...filteredFonts]
      : filteredFonts;

  const activeStyleMeta =
    STYLE_OPTIONS.find((s) => s.value === settings.style) || STYLE_OPTIONS[0];

  return (
    <div className={compact ? 'space-y-3.5 pt-2 border-t border-[#1e3159]' : 'space-y-5'}>
      {/* Quick Presets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#b8c7e3] font-medium">
            {t('style.presetsTitle')}
          </span>
          <span className="text-[11px] text-[#6d83ad]">
            {t('style.catalogCount', { fonts: FONT_CATALOG.length, styles: STYLE_OPTIONS.length })}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CAPTION_PRESETS.map((preset) => {
            const isMatch =
              settings.style === preset.patch.style &&
              settings.fontFamily === preset.patch.fontFamily;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(preset.patch)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  isMatch
                    ? 'bg-[#16264d] border-[#c7ff55]'
                    : 'bg-[#0c1733] border-[#1e3159] hover:border-[#2a4173]'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-bold text-white truncate">{preset.name}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: preset.patch.highlightColor || '#c7ff55' }}
                  />
                </div>
                <div className="text-[11px] text-[#93a7cc] truncate mt-0.5">{preset.subtitle}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category Tabs for Font Library */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs text-[#b8c7e3] font-medium">
            {t('style.fontLibrary', { count: dropdownFonts.length })}
          </label>
          <div className="flex flex-wrap gap-1">
            {FONT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setFontCategory(cat.id);
                  const firstInCat =
                    cat.id === 'all'
                      ? null
                      : FONT_CATALOG.find((f) => f.category === cat.id);
                  if (firstInCat) {
                    ensureFontLoaded(firstInCat.value, Boolean(settings.italic), settings.fontWeight);
                  }
                }}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${
                  fontCategory === cat.id
                    ? 'bg-[#ff6b00] text-white'
                    : 'bg-[#0c1733] text-[#93a7cc] hover:text-white border border-[#1e3159]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <select
              aria-label={t('style.fontLibrary', { count: dropdownFonts.length })}
              value={settings.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value })}
              className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs"
            >
              {dropdownFonts.map((opt) => (
                <option key={opt.id} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              aria-label={t('studio.tabStyle')}
              value={settings.style}
              onChange={(e) => onChange({ style: e.target.value as SubtitleStyleId })}
              className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs"
            >
              {STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-[#070e20] border border-[#1e3159] rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div
            className="text-base text-white tracking-wide truncate max-w-full"
            style={{
              fontFamily: settings.fontFamily,
              fontWeight: activeFont?.singleDisplayWeight ? 400 : Number(settings.fontWeight || 800),
              fontStyle: settings.italic && !activeFont?.singleDisplayWeight ? 'italic' : 'normal',
              textTransform: settings.caps ? 'uppercase' : 'none',
            }}
          >
            {t('style.samplePreviewBefore')}{' '}
            <span style={{ color: settings.highlightColor }}>{t('style.samplePreviewHighlight')}</span>
          </div>
          <span className="text-[11px] text-[#93a7cc]">{activeStyleMeta.desc}</span>
        </div>
      </div>

      {/* Size, Position, Weight */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-[#b8c7e3] font-medium mb-1.5">{t('style.fontSize')}</label>
          <select
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs"
          >
            <option value={36}>{t('style.sizeSmall')}</option>
            <option value={43}>{t('style.sizeMedium')}</option>
            <option value={52}>{t('style.sizeLarge')}</option>
            <option value={60}>{t('style.sizeXLarge')}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#b8c7e3] font-medium mb-1.5">{t('style.verticalPos')}</label>
          <select
            value={settings.position}
            onChange={(e) => onChange({ position: e.target.value as SubtitlePosition })}
            className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs"
          >
            <option value="bottom">{t('style.posBottom')}</option>
            <option value="lower">{t('style.posLower')}</option>
            <option value="center">{t('style.posCenter')}</option>
            <option value="top">{t('style.posTop')}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#b8c7e3] font-medium mb-1.5">{t('style.fontWeight')}</label>
          <select
            disabled={Boolean(activeFont?.singleDisplayWeight)}
            value={settings.fontWeight || '800'}
            onChange={(e) => onChange({ fontWeight: e.target.value as '700' | '800' | '900' })}
            className="w-full bg-[#0c1733] text-[#f1f5fc] border border-[#2a4173] rounded-lg px-3 py-2 text-xs disabled:opacity-45"
          >
            <option value="700">Bold (700)</option>
            <option value="800">Extra Bold (800)</option>
            <option value="900">Black (900)</option>
          </select>
        </div>
      </div>

      {/* Swatches & Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#1e3159]">
        <div className="space-y-2">
          <span className="block text-xs text-[#b8c7e3] font-medium">{t('style.highlightColor')}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {HIGHLIGHT_SWATCHES.map((sw) => {
              const active = settings.highlightColor === sw.color;
              return (
                <button
                  key={sw.color}
                  type="button"
                  title={sw.title}
                  onClick={() => onChange({ highlightColor: sw.color })}
                  className={`w-7 h-7 rounded-lg border-2 transition-transform cursor-pointer flex items-center justify-center ${
                    active ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: sw.color }}
                >
                  {active && <Check className="w-3.5 h-3.5 text-black" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#e4ecfa] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={Boolean(settings.italic)}
              disabled={Boolean(activeFont?.singleDisplayWeight)}
              onChange={(e) => onChange({ italic: e.target.checked })}
            />
            <span className={activeFont?.singleDisplayWeight ? 'opacity-50' : 'italic'}>
              {t('style.italic')}
            </span>
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#e4ecfa] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={settings.caps}
              onChange={(e) => onChange({ caps: e.target.checked })}
            />
            <span>{t('style.uppercase')}</span>
          </label>
        </div>
      </div>
    </div>
  );
}
