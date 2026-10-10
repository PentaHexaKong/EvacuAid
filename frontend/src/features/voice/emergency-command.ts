export type EmergencyCommand = 'help' | 'evacuate' | 'safe';
export function emergencyCommand(transcript: string): EmergencyCommand | null {
  const text = transcript.toLocaleLowerCase();
  if (/tolong|bantu|help|sos/.test(text)) return 'help';
  // "I'm not safe" must never be recorded as safe: ask again instead.
  if (/\b(not|no|un|tidak|tak|belum|bukan|nggak|enggak|gak|ga)\b.*\b(safe|aman|selamat)\b|unsafe/.test(text)) return null;
  if (/\bgo\b|evakuasi|evacuat|pergi|berangkat/.test(text)) return 'evacuate';
  if (/\baman\b|\bsafe\b|selamat/.test(text)) return 'safe';
  return null;
}
