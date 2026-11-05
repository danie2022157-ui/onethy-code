export interface NativeMCPItem { name: string; installed: boolean }
export function isNativeMCP(name: string): boolean
export function bundlePath(root: string): string
export function nativeDefaults(): Record<string, {type:string;command:string;args:string[];disabled:boolean}>
export function readNativeBundle(root: string): Promise<{mcpServers: Record<string, unknown>} | undefined>
export function removeNativeMCP(root: string, name: string): Promise<boolean>
export function restoreNativeMCP(root: string, name: string): Promise<readonly string[]>
export function listNativeMCPs(root: string): Promise<NativeMCPItem[]>
