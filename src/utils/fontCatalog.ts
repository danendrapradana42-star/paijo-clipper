import type { CaptionSettings, SubtitleStyleId } from '../types/clipper';

export type FontCategory = 'all' | 'viral' | 'modern' | 'serif' | 'playful' | 'tech';

export interface FontCatalogEntry {
  id: string;
  name: string;
  label: string;
  category: Exclude<FontCategory, 'all'>;
  value: string;
  /** Google Fonts CSS2 family query (omit for system font) */
  googleFamily?: string;
  /** True when the typeface only ships a single heavy display weight (400) */
  singleDisplayWeight?: boolean;
}

export const FONT_CATEGORIES: Array<{ id: FontCategory; label: string }> = [
  { id: 'all', label: 'Semua (22)' },
  { id: 'viral', label: 'Viral & Impact' },
  { id: 'modern', label: 'Modern Sans' },
  { id: 'serif', label: 'Editorial Serif' },
  { id: 'playful', label: 'Komik & Kreatif' },
  { id: 'tech', label: 'Mono & Sistem' },
];

export const FONT_CATALOG: FontCatalogEntry[] = [
  // Viral & Impact
  {
    id: 'montserrat',
    name: 'Montserrat',
    label: 'Montserrat · Viral Shorts',
    category: 'viral',
    value: '"Montserrat", "Plus Jakarta Sans", sans-serif',
    googleFamily: 'Montserrat:ital,wght@0,700;0,800;0,900;1,700;1,800;1,900',
  },
  {
    id: 'anton',
    name: 'Anton',
    label: 'Anton · Bold Impact',
    category: 'viral',
    value: '"Anton", Impact, sans-serif',
    googleFamily: 'Anton',
    singleDisplayWeight: true,
  },
  {
    id: 'bebas-neue',
    name: 'Bebas Neue',
    label: 'Bebas Neue · Editorial Tinggi',
    category: 'viral',
    value: '"Bebas Neue", "Oswald", sans-serif',
    googleFamily: 'Bebas+Neue',
    singleDisplayWeight: true,
  },
  {
    id: 'archivo-black',
    name: 'Archivo Black',
    label: 'Archivo Black · Blok Tebal',
    category: 'viral',
    value: '"Archivo Black", "Montserrat", sans-serif',
    googleFamily: 'Archivo+Black',
    singleDisplayWeight: true,
  },
  {
    id: 'rubik',
    name: 'Rubik',
    label: 'Rubik · Geometris Tebal',
    category: 'viral',
    value: '"Rubik", "Plus Jakarta Sans", sans-serif',
    googleFamily: 'Rubik:ital,wght@0,700;0,800;0,900;1,700;1,800;1,900',
  },
  {
    id: 'titan-one',
    name: 'Titan One',
    label: 'Titan One · Chunky Viral',
    category: 'viral',
    value: '"Titan One", "Montserrat", sans-serif',
    googleFamily: 'Titan+One',
    singleDisplayWeight: true,
  },

  // Modern Sans
  {
    id: 'poppins',
    name: 'Poppins',
    label: 'Poppins · Bersih Populer',
    category: 'modern',
    value: '"Poppins", "Plus Jakarta Sans", sans-serif',
    googleFamily: 'Poppins:ital,wght@0,700;0,800;0,900;1,700;1,800;1,900',
  },
  {
    id: 'inter',
    name: 'Inter',
    label: 'Inter · Tajam & Rapi',
    category: 'modern',
    value: '"Inter", "Plus Jakarta Sans", sans-serif',
    googleFamily: 'Inter:ital,wght@0,700;0,800;0,900;1,700;1,800;1,900',
  },
  {
    id: 'outfit',
    name: 'Outfit',
    label: 'Outfit · Kreator Kekinian',
    category: 'modern',
    value: '"Outfit", "Plus Jakarta Sans", sans-serif',
    googleFamily: 'Outfit:wght@700;800;900',
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    label: 'Space Grotesk · Futuristik',
    category: 'modern',
    value: '"Space Grotesk", "Plus Jakarta Sans", sans-serif',
    googleFamily: 'Space+Grotesk:wght@700',
  },
  {
    id: 'syne',
    name: 'Syne',
    label: 'Syne · Gaya Poster Lebar',
    category: 'modern',
    value: '"Syne", "Plus Jakarta Sans", sans-serif',
    googleFamily: 'Syne:wght@700;800',
  },
  {
    id: 'oswald',
    name: 'Oswald',
    label: 'Oswald · Kondens Tegas',
    category: 'modern',
    value: '"Oswald", sans-serif',
    googleFamily: 'Oswald:wght@600;700',
  },
  {
    id: 'plus-jakarta',
    name: 'Plus Jakarta Sans',
    label: 'Plus Jakarta · Modern Lokal',
    category: 'modern',
    value: '"Plus Jakarta Sans", sans-serif',
    googleFamily: 'Plus+Jakarta+Sans:ital,wght@0,700;0,800;1,700;1,800',
  },

  // Editorial Serif
  {
    id: 'playfair',
    name: 'Playfair Display',
    label: 'Playfair Display · Editorial Mewah',
    category: 'serif',
    value: '"Playfair Display", Georgia, serif',
    googleFamily: 'Playfair+Display:ital,wght@0,700;0,800;0,900;1,700;1,800',
  },
  {
    id: 'cinzel',
    name: 'Cinzel',
    label: 'Cinzel · Sinematik Klasik',
    category: 'serif',
    value: '"Cinzel", Georgia, serif',
    googleFamily: 'Cinzel:wght@700;800;900',
  },
  {
    id: 'dm-serif',
    name: 'DM Serif Display',
    label: 'DM Serif · Dokumenter Elegan',
    category: 'serif',
    value: '"DM Serif Display", Georgia, serif',
    googleFamily: 'DM+Serif+Display:ital@0;1',
    singleDisplayWeight: true,
  },

  // Playful & Kreatif
  {
    id: 'bangers',
    name: 'Bangers',
    label: 'Bangers · Komik Seru',
    category: 'playful',
    value: '"Bangers", cursive',
    googleFamily: 'Bangers',
    singleDisplayWeight: true,
  },
  {
    id: 'luckiest-guy',
    name: 'Luckiest Guy',
    label: 'Luckiest Guy · Kartun Pop',
    category: 'playful',
    value: '"Luckiest Guy", cursive',
    googleFamily: 'Luckiest+Guy',
    singleDisplayWeight: true,
  },
  {
    id: 'bungee',
    name: 'Bungee',
    label: 'Bungee · Urban Display',
    category: 'playful',
    value: '"Bungee", sans-serif',
    googleFamily: 'Bungee',
    singleDisplayWeight: true,
  },
  {
    id: 'permanent-marker',
    name: 'Permanent Marker',
    label: 'Permanent Marker · Spidol Tangan',
    category: 'playful',
    value: '"Permanent Marker", cursive',
    googleFamily: 'Permanent+Marker',
    singleDisplayWeight: true,
  },
  {
    id: 'righteous',
    name: 'Righteous',
    label: 'Righteous · Retro Arcade',
    category: 'playful',
    value: '"Righteous", sans-serif',
    googleFamily: 'Righteous',
    singleDisplayWeight: true,
  },

  // Tech & Sistem
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    label: 'JetBrains Mono · Kode & Tech',
    category: 'tech',
    value: '"JetBrains Mono", monospace',
    googleFamily: 'JetBrains+Mono:ital,wght@0,700;0,800;1,700',
  },
  {
    id: 'system-ui',
    name: 'Font Sistem',
    label: 'Font Sistem · Offline Instan',
    category: 'tech',
    value: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
];

export interface SubtitleStyleOption {
  value: SubtitleStyleId;
  label: string;
  desc: string;
}

export const STYLE_OPTIONS: SubtitleStyleOption[] = [
  {
    value: 'capcut',
    label: 'CapCut · Kotak Gelap & Sorot',
    desc: 'Latar kotak gelap rapi dengan kata aktif disorot terang.',
  },
  {
    value: 'tiktok_stroke',
    label: 'Remotion TikTok · Stroke & Pop',
    desc: 'Gaya TikTok ikonik: garis luar hitam tebal dan skala kata aktif.',
  },
  {
    value: 'hormozi',
    label: 'Bold Punch · Outline & Bayangan',
    desc: 'Teks besar memantul dengan bayangan jatuh tegas untuk hook cepat.',
  },
  {
    value: 'highlight',
    label: 'Stabilo · Blok Sorot Aktif',
    desc: 'Penanda blok warna kontras langsung di belakang kata yang diucap.',
  },
  {
    value: 'pop',
    label: 'Pop Card · Kartu Per Kata',
    desc: 'Setiap kata dibungkus kartu bulat dengan efek zoom halus.',
  },
  {
    value: 'box3d',
    label: 'Sticker 3D · Bayangan Solid',
    desc: 'Kartu bergaya stiker dengan bayangan keras 3D di bawahnya.',
  },
  {
    value: 'pill_glass',
    label: 'Glass Pill · Kapsul Transparan',
    desc: 'Kapsul gelap transparan dengan bingkai tipis dan kata aktif bercahaya.',
  },
  {
    value: 'retro_shadow',
    label: 'Retro Offset · Bayangan Ganda',
    desc: 'Teks tebal dengan lapisan bayangan offset ganda bergaya poster.',
  },
  {
    value: 'outline_hollow',
    label: 'Hollow Outline · Garis Kosong',
    desc: 'Kata non-aktif bergaris tepi transparan, kata aktif terisi solid.',
  },
  {
    value: 'typewriter_box',
    label: 'Editorial Tape · Pita Miring',
    desc: 'Pita kontras ala majalah dengan penekanan kata aktif yang dinamis.',
  },
  {
    value: 'gradient',
    label: 'Gradient Glow · Gradasi Cerah',
    desc: 'Teks kata aktif memakai gradasi warna berpendar lembut.',
  },
  {
    value: 'karaoke_bar',
    label: 'Karaoke Halus · Jejak Warna',
    desc: 'Kata yang sudah terbaca tetap menyala mengikuti progres suara.',
  },
  {
    value: 'classic',
    label: 'Klasik · Tebal Ber-Outline',
    desc: 'Subtitle bersih klasik dengan outline hitam yang mudah dibaca.',
  },
  {
    value: 'clean',
    label: 'Minimal · Putih Bayangan Halus',
    desc: 'Tampilan bersih minimalis tanpa kotak tambahan.',
  },
  {
    value: 'neon',
    label: 'Neon · Sorotan Bercahaya',
    desc: 'Efek pendar neon menyala untuk konten hiburan & musik.',
  },
];

export interface CaptionStylePreset {
  id: string;
  name: string;
  subtitle: string;
  patch: Partial<CaptionSettings>;
}

export const CAPTION_PRESETS: CaptionStylePreset[] = [
  {
    id: 'remotion-tiktok',
    name: 'TikTok Viral',
    subtitle: 'Anton · Stroke Tebal',
    patch: {
      fontFamily: '"Anton", Impact, sans-serif',
      style: 'tiktok_stroke',
      highlightColor: '#c7ff55',
      caps: true,
      italic: false,
      fontWeight: '800',
    },
  },
  {
    id: 'hormozi-punch',
    name: 'Hormozi Punch',
    subtitle: 'Montserrat · Emas',
    patch: {
      fontFamily: '"Montserrat", "Plus Jakarta Sans", sans-serif',
      style: 'hormozi',
      highlightColor: '#ffe45c',
      caps: true,
      italic: false,
      fontWeight: '900',
    },
  },
  {
    id: 'editorial-serif',
    name: 'Editorial Mewah',
    subtitle: 'Playfair · Glass Pill',
    patch: {
      fontFamily: '"Playfair Display", Georgia, serif',
      style: 'pill_glass',
      highlightColor: '#ffe45c',
      caps: false,
      italic: true,
      fontWeight: '800',
    },
  },
  {
    id: 'retro-komik',
    name: 'Poster Komik',
    subtitle: 'Bangers · Retro Offset',
    patch: {
      fontFamily: '"Bangers", cursive',
      style: 'retro_shadow',
      highlightColor: '#ff5436',
      caps: true,
      italic: false,
      fontWeight: '800',
    },
  },
  {
    id: 'tech-hollow',
    name: 'Tech Modern',
    subtitle: 'Space Grotesk · Hollow',
    patch: {
      fontFamily: '"Space Grotesk", "Plus Jakarta Sans", sans-serif',
      style: 'outline_hollow',
      highlightColor: '#38bdf8',
      caps: true,
      italic: false,
      fontWeight: '700',
    },
  },
  {
    id: 'creator-clean',
    name: 'Kreator Rapi',
    subtitle: 'Poppins · Stabilo',
    patch: {
      fontFamily: '"Poppins", "Plus Jakarta Sans", sans-serif',
      style: 'highlight',
      highlightColor: '#c7ff55',
      caps: false,
      italic: false,
      fontWeight: '800',
    },
  },
];

export const HIGHLIGHT_SWATCHES = [
  { color: '#c7ff55', title: 'Lime' },
  { color: '#ffe45c', title: 'Kuning Emas' },
  { color: '#38bdf8', title: 'Cyan' },
  { color: '#ff6ad5', title: 'Pink Neon' },
  { color: '#ff5436', title: 'Coral Merah' },
  { color: '#ffffff', title: 'Putih' },
];

export function findFontEntry(fontFamily: string): FontCatalogEntry | undefined {
  return FONT_CATALOG.find((f) => f.value === fontFamily);
}

export function resolveCanvasFontString(
  fontFamily: string,
  sizePx: number,
  requestedWeight: '700' | '800' | '900' = '800',
  italic = false
): string {
  const entry = findFontEntry(fontFamily);
  const weight = entry?.singleDisplayWeight ? '400' : requestedWeight;
  const italicPrefix = italic && !entry?.singleDisplayWeight ? 'italic ' : '';
  return `${italicPrefix}${weight} ${sizePx}px ${fontFamily}`;
}

const injectedFontIds = new Set<string>();
const fontLoadPromises = new Map<string, Promise<void>>();

/**
 * Dynamically injects Google Fonts CSS2 stylesheet (inspired by @remotion/google-fonts)
 * and resolves once document.fonts has loaded the primary face for Canvas rendering.
 */
export async function ensureFontLoaded(
  fontFamily: string,
  italic = false,
  weight: '700' | '800' | '900' = '800'
): Promise<void> {
  if (typeof document === 'undefined') return;
  const entry = findFontEntry(fontFamily);
  if (!entry || !entry.googleFamily) return;

  if (!injectedFontIds.has(entry.id)) {
    const linkId = `gf-autoclipper-${entry.id}`;
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${entry.googleFamily}&display=swap`;
      document.head.appendChild(link);
    }
    injectedFontIds.add(entry.id);
  }

  const effectiveWeight = entry.singleDisplayWeight ? '400' : weight;
  const effectiveItalic = italic && !entry.singleDisplayWeight ? 'italic ' : '';
  const loadKey = `${entry.name}-${effectiveItalic}${effectiveWeight}`;

  if (!fontLoadPromises.has(loadKey) && document.fonts?.load) {
    const p = document.fonts
      .load(`${effectiveItalic}${effectiveWeight} 40px "${entry.name}"`)
      .then(() => undefined)
      .catch(() => undefined);
    fontLoadPromises.set(loadKey, p);
  }
  await fontLoadPromises.get(loadKey);
}
