import { createContext, useContext, useState, type ReactNode } from 'react';

export type RequestDraft = { contactId: string; message: string };
export const emptyDraft: RequestDraft = { contactId: '', message: '' };
export const canReviewRequest = (draft: RequestDraft) => Boolean(draft.contactId && draft.message.trim());
const Context = createContext<{ draft: RequestDraft; setDraft: (draft: RequestDraft) => void }>({ draft: emptyDraft, setDraft: () => {} });
export const useRequestDraft = () => useContext(Context);
export function RequestDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState(emptyDraft);
  return <Context.Provider value={{ draft, setDraft }}>{children}</Context.Provider>;
}
