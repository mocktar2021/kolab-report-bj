/**
 * Text for comparing searches: lowercase and without accents, so "energie"
 * finds "Énergie" and "ÉTUDE" finds "étude".
 */
export function foldForSearch(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
