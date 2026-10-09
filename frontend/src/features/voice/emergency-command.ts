export type EmergencyCommand = 'help' | 'evacuate' | 'safe';
export function emergencyCommand(transcript: string): EmergencyCommand | null {
  const text = transcript.toLocaleLowerCase();
  if (/tolong|bantu|help|sos/.test(text)) return 'help';
  if (/\bgo\b|evakuasi|evacuat|pergi|berangkat/.test(text)) return 'evacuate';
  if (/\baman\b|\bsafe\b|selamat/.test(text)) return 'safe';
  return null;
}
