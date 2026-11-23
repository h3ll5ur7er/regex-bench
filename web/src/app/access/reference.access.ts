import { FlavorId } from '../contracts';
import {
  ANCHOR_TEXT,
  FLAG_TEXT,
  GROUP_TEXT,
  POSIX_TEXT,
  QUICK_REFERENCE,
  ReferenceSection,
  SHORTHAND_TEXT,
} from './reference.content';

/**
 * ReferenceAccess: business verbs over the bundled reference content (V10). Content is data in
 * `reference.content.ts`; nothing is ever fetched.
 */
export const ReferenceAccess = {
  quickReference(flavor: FlavorId): ReferenceSection[] {
    return QUICK_REFERENCE.map((s) => ({
      ...s,
      entries: s.entries.filter((e) => !e.flavors || e.flavors.includes(flavor)),
    })).filter((s) => s.entries.length > 0);
  },
  shorthand: (kind: string) => SHORTHAND_TEXT[kind] ?? `\\${kind}`,
  anchor: (kind: string) => ANCHOR_TEXT[kind] ?? kind,
  group: (kind: string) => GROUP_TEXT[kind] ?? kind,
  flag: (letter: string) => FLAG_TEXT[letter] ?? letter,
  posix: (name: string) => POSIX_TEXT[name] ?? `[:${name}:]`,
};
