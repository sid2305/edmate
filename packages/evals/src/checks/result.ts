/** One scored check on one turn. `detail` says why it failed (or the judge's reason). */
export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function result(name: string, pass: boolean, detail: string): CheckResult {
  return pass ? { name, pass } : { name, pass, detail };
}
