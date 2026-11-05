export interface SyncOnethyCustomizationsOptions {
  readonly install?: boolean
  readonly verify?: boolean
  readonly global?: boolean
  readonly globalDir?: string
  readonly type?: string
  readonly sourceDir?: string
  readonly cwd?: string
}
export interface SyncOnethyCustomizationsReport {
  readonly mode: "verify" | "install" | "preview"
  readonly target: string
  readonly ready: number
  readonly installed: number
  readonly existing: number
  readonly rejected: number
  readonly pending: number
  readonly obsoleteGeneratedMcpRemoved?: number
  readonly errors: readonly string[]
  readonly components: Record<string, { files: number; warnings: Array<{ name: string; warning: string }>; missing?: boolean }>
}
export const types: readonly string[]
export function syncOnethyCustomizations(options?: SyncOnethyCustomizationsOptions): Promise<SyncOnethyCustomizationsReport>
