import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
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
  const [fontCategory, setFontCategory] = useState<FontCategory>('all');

  useEffect(() => {
    let active = true;
    ensureFontLoaded(
      settings.fontFamily,
      Boolean(settings.italic),
      settings.fontWeight || '800'
    ).then(() => {
      if (active) onFontReady?.();
    });
    return () => {
      active = false;
    };
  }, [settings.fontFamily, settings.italic, settings.fontWeight, onFontReady]);

  const filteredFonts =
    fontCategory === 'all'
      ? FONT_CATALOG
      : FONT_CATALOG.filter((f) => f.category === fontCategory);

  // Always keep currently selected font visible in dropdown even if filtered
  const activeFont = findFontEntry(settings.fontFamily);
  const dropdownFonts =
    activeFont && !filteredFonts.some((f) => f.value === activeFont.value)
      ? [activeFont, ...filteredFonts]
      : filteredFonts;

  const activeStyleMeta =
    STYLE_OPTIONS.find((s) => s.value === settings.style) || STYLE_OPTIONS[0];

  return (
    <div className={compact ? 'space-y-3.5 pt-2 border-t border-[#1e2432]' : 'space-y-5'}>
      {/* Quick Presets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#b7c0cf] font-medium">
            Preset Gaya Populer (1 Klik)
          </span>
          <span className="text-[11px] text-[#687285]">
            {FONT_CATALOG.length} font · {STYLE_OPTIONS.length} gaya
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
                    ? 'bg-[#181c27] border-[#c7ff55]'
                    : 'bg-[#0d1017] border-[#1e2432] hover:border-[#2d3548]'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-bold text-white truncate">{preset.name}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: preset.patch.highlightColor || '#c7ff55' }}
                  />
                </div>
                <div className="text-[11px] text-[#8f98a8] truncate mt-0.5">{preset.subtitle}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category Tabs for Font Library */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs text-[#b7c0cf] font-medium">
            Koleksi Font ({dropdownFonts.length})
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
                    ? 'bg-[#ff5436] text-white'
                    : 'bg-[#0d1017] text-[#8f98a8] hover:text-white border border-[#1e2432]'
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
              aria-label="Pilih Font Subtitle"
              value={settings.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value })}
              className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-3 py-2 text-xs"
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
              aria-label="Pilih Gaya Animasi dan Tampilan"
              value={settings.style}
              onChange={(e) => onChange({ style: e.target.value as SubtitleStyleId })}
              className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-3 py-2 text-xs"
            >
              {STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-[#080a0f] border border-[#1e2432] rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div
            className="text-base text-white tracking-wide truncate max-w-full"
            style={{
              fontFamily: settings.fontFamily,
              fontWeight: activeFont?.singleDisplayWeight ? 400 : Number(settings.fontWeight || 800),
              fontStyle: settings.italic && !activeFont?.singleDisplayWeight ? 'italic' : 'normal',
              textTransform: settings.caps ? 'uppercase' : 'none',
            }}
          >
            Contoh Teks <span style={{ color: settings.highlightColor }}>Subtitle 9:16</span>
          </div>
          <span className="text-[11px] text-[#8f98a8]">{activeStyleMeta.desc}</span>
        </div>
      </div>

      {/* Size, Position, Weight */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-[#b7c0cf] font-medium mb-1.5">Ukuran Huruf</label>
          <select
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-3 py-2 text-xs"
          >
            <option value={36}>Kecil (36px)</option>
            <option value={43}>Sedang (43px)</option>
            <option value={52}>Besar (52px)</option>
            <option value={60}>Ekstra Besar (60px)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#b7c0cf] font-medium mb-1.5">Posisi Vertikal</label>
          <select
            value={settings.position}
            onChange={(e) => onChange({ position: e.target.value as SubtitlePosition })}
            className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-3 py-2 text-xs"
          >
            <option value="bottom">Bawah (Aman UI Reels)</option>
            <option value="lower">Tengah-Bawah</option>
            <option value="center">Tengah Layar</option>
            <option value="top">Atas</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[#b7c0cf] font-medium mb-1.5">Ketebalan Huruf</label>
          <select
            disabled={Boolean(activeFont?.singleDisplayWeight)}
            value={settings.fontWeight || '800'}
            onChange={(e) => onChange({ fontWeight: e.target.value as '700' | '800' | '900' })}
            className="w-full bg-[#0d1017] text-[#f3f5f8] border border-[#2d3548] rounded-lg px-3 py-2 text-xs disabled:opacity-45"
          >
            <option value="700">Bold (700)</option>
            <option value="800">Extra Bold (800)</option>
            <option value="900">Black (900)</option>
          </select>
        </div>
      </div>

      {/* Swatches & Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#1e2432]">
        <div className="space-y-2">
          <span className="block text-xs text-[#b7c0cf] font-medium">Warna Sorotan Kata</span>
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
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#e4e8f0] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={Boolean(settings.italic)}
              disabled={Boolean(activeFont?.singleDisplayWeight)}
              onChange={(e) => onChange({ italic: e.target.checked })}
            />
            <span className={activeFont?.singleDisplayWeight ? 'opacity-50' : 'italic'}>
              Miring (Italic)
            </span>
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#e4e8f0] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={settings.caps}
              onChange={(e) => onChange({ caps: e.target.checked })}
            />
            <span>HURUF KAPITAL</span>
          </label>
        </div>
      </div>
    </div>
  );
}
