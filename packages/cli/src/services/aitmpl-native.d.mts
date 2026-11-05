export interface SyncAITmplOptions {
  readonly install?: boolean
  readonly verify?: boolean
  readonly global?: boolean
  readonly type?: string
  readonly sourceDir?: string
  readonly cwd?: string
}
export interface SyncAITmplReport {
  readonly mode: "verify" | "install" | "preview"
  readonly target: string
  readonly ready: number
  readonly installed: number
  readonly existing: number
  readonly rejected: number
  readonly pending: number
  readonly errors: readonly string[]
  readonly components: Record<string, { files: number; warnings: Array<{ name: string; warning: string }>; missing?: boolean }>
}
export const types: readonly string[]
export function syncAITmpl(options?: SyncAITmplOptions): Promise<SyncAITmplReport>
