export function confirmCommand(transcript: string): 'yes' | 'no' | null {
  const text = transcript.toLocaleLowerCase();
  if (/\b(no|not|never|don't|dont|tidak|jangan|bukan|nggak|enggak)\b/.test(text)) return 'no';
  if (/\b(yes|ya|iya)\b/.test(text)) return 'yes';
  return null;
}
