export type HomeCommand = 'help' | 'nearest' | 'readAlert' | 'alerts' | 'buddy';

// Indonesian and English phrasings. Help is matched first: a frightened "tolong, di mana titik kumpul" must reach a person.
export function homeCommand(transcript: string): HomeCommand | null {
  const text = transcript.toLocaleLowerCase();
  if (/tolong|bantu|help|sos/.test(text)) return 'help';
  if (/kumpul|terdekat|evakuasi|gathering|nearest|shelter|evacuat/.test(text)) return 'nearest';
  if (/all warnings|all alerts|notifications|semua peringatan|notifikasi|daftar peringatan/.test(text)) return 'alerts';
  if (/buddy status|status buddy|pendamping/.test(text)) return 'buddy';
  if (/peringatan|baca|alert|warning|read/.test(text)) return 'readAlert';
  return null;
}
