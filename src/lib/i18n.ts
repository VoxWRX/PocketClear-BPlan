/**
 * @file i18n.ts
 * @description Barrel module re-exporting PocketClear's multilingual translation
 * dictionaries (EN, FR, AR with RTL support) and starter category presets.
 */
export {
  STARTER_BUCKET_PRESETS,
  TRANSLATIONS,
  getStarterCategoriesForLanguage,
  type StarterPreset,
  type TranslationDictionary,
} from '@/i18n/translations';
