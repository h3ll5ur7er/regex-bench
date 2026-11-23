export type FlavorId = 'ecmascript' | 'pcre' | 'python' | 'java' | 'dotnet' | 'rust' | 'go';

export interface FlagInfo {
  /** The flag letter as the flavor writes it. */
  letter: string;
  name: string;
  description: string;
}
