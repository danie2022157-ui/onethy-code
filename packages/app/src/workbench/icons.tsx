import type { JSX } from "solid-js"

type SvgProps = {
  class?: string
  size?: number
}

function Svg(props: SvgProps & { children: JSX.Element; viewBox?: string }) {
  const size = () => props.size ?? 16
  return (
    <svg
      width={size()}
      height={size()}
      viewBox={props.viewBox ?? "0 0 16 16"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

export function ExplorerIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3l1.3 1.5h4.7A1.5 1.5 0 0 1 14 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
      <path d="M2 6h12" stroke="currentColor" stroke-width="1.2" opacity="0.65" />
    </Svg>
  )
}

export function SearchCodeIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4" />
      <path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </Svg>
  )
}

export function GitBranchIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <circle cx="4.5" cy="3.5" r="1.75" stroke="currentColor" stroke-width="1.35" />
      <circle cx="4.5" cy="12.5" r="1.75" stroke="currentColor" stroke-width="1.35" />
      <circle cx="11.5" cy="5.5" r="1.75" stroke="currentColor" stroke-width="1.35" />
      <path d="M4.5 5.25v5.5M11.5 7.25v.5a3 3 0 0 1-3 3H6.25" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
    </Svg>
  )
}

export function AgentsIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="4" width="11" height="8.5" rx="2.2" stroke="currentColor" stroke-width="1.35" />
      <path d="M8 1.5V4M5.75 8.25h.01M10.25 8.25h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <path d="M6 10.4c.55.45 1.25.65 2 .65s1.45-.2 2-.65" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  )
}

export function SessionsIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h7A1.5 1.5 0 0 1 13 3.5v6A1.5 1.5 0 0 1 11.5 11H6.7L3.5 13.7V11A1.5 1.5 0 0 1 3 9.5v-6Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
      <path d="M5.5 5.5h5M5.5 8h3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </Svg>
  )
}

export function McpPlugIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.4a3.5 3.5 0 0 1-7 0V5.5Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M8 11.4V14" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
    </Svg>
  )
}

export function SkillsSparkIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.8 9.6 6.4 14.2 8 9.6 9.6 8 14.2 6.4 9.6 1.8 8 6.4 6.4 8 1.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
    </Svg>
  )
}

export function ExtensionsBlocksIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.35" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.35" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.35" />
      <rect x="9.5" y="1.8" width="4.7" height="4.7" rx="1" stroke="currentColor" stroke-width="1.35" />
    </Svg>
  )
}

export function ModelsChipIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.4" stroke="currentColor" stroke-width="1.35" />
      <path d="M6.5 1.8v2.45M9.5 1.8v2.45M6.5 11.75v2.45M9.5 11.75v2.45M1.8 6.5h2.45M1.8 9.5h2.45M11.75 6.5h2.45M11.75 9.5h2.45" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  )
}

export function MemoryDbIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" stroke-width="1.35" />
      <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" stroke="currentColor" stroke-width="1.35" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" stroke="currentColor" stroke-width="1.2" opacity="0.7" />
    </Svg>
  )
}

export function SettingsGearIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.35" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
    </Svg>
  )
}

export function LayoutChatIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.8" stroke="currentColor" stroke-width="1.3" />
      <path d="M4.8 6h6.4M4.8 8.8h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </Svg>
  )
}

export function LayoutSplitIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.8" stroke="currentColor" stroke-width="1.3" />
      <path d="M8 2.5v11" stroke="currentColor" stroke-width="1.3" />
    </Svg>
  )
}

export function LayoutEditorIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.8" stroke="currentColor" stroke-width="1.3" />
      <path d="m6.2 6.2-1.8 1.8 1.8 1.8M9.8 6.2 11.6 8l-1.8 1.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </Svg>
  )
}

export function SidebarLeftIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.8" stroke="currentColor" stroke-width="1.3" />
      <path d="M6 2.5v11" stroke="currentColor" stroke-width="1.3" />
    </Svg>
  )
}

export function PanelBottomIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.8" stroke="currentColor" stroke-width="1.3" />
      <path d="M2 9.5h12" stroke="currentColor" stroke-width="1.3" />
    </Svg>
  )
}

export function SunModeIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.75" stroke="currentColor" stroke-width="1.35" />
      <path d="M8 1.75v1.4M8 12.85v1.4M1.75 8h1.4M12.85 8h1.4M3.58 3.58l1 1M11.42 11.42l1 1M12.42 3.58l-1 1M4.58 11.42l-1 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </Svg>
  )
}

export function MoonModeIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M12.8 9.6A5.2 5.2 0 0 1 6.4 3.2a5.2 5.2 0 1 0 6.4 6.4Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
    </Svg>
  )
}

export function TerminalPromptIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.8" stroke="currentColor" stroke-width="1.3" />
      <path d="m4.8 6.3 2 1.7-2 1.7M8.3 9.7h2.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </Svg>
  )
}

export function BugDebugIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="5" width="6" height="7.5" rx="3" stroke="currentColor" stroke-width="1.3" />
      <path d="M6.2 5V4a1.8 1.8 0 0 1 3.6 0v1M2.5 7.5H5M11 7.5h2.5M2.5 10.5H5M11 10.5h2.5M4 4l1.5 1.2M12 4l-1.5 1.2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
    </Svg>
  )
}

export function LogsStreamIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4h11M2.5 7.2h8.5M2.5 10.4h11M2.5 13.4h6.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
    </Svg>
  )
}

export function SaveDiskIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M3 2.5h8.2L13.5 4.8V13a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8V3.3a.8.8 0 0 1 .5-.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M5.2 2.5v3.2h5.2V2.5M5 13.8V9.5h6v4.3" stroke="currentColor" stroke-width="1.2" />
    </Svg>
  )
}

export function PlayRunIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 3.2 12.5 8l-8 4.8V3.2Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" />
    </Svg>
  )
}

export function StopSquareIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.4" stroke="currentColor" stroke-width="1.35" />
    </Svg>
  )
}

export function CheckShieldIcon(props: SvgProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.8 13.5 4v3.8c0 3.3-2.3 5.3-5.5 6.4-3.2-1.1-5.5-3.1-5.5-6.4V4L8 1.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      <path d="m5.8 8.1 1.5 1.5 3-3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
    </Svg>
  )
}

export function OnethyLogoMark(props: SvgProps) {
  return (
    <Svg {...props}>
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3.2" stroke="currentColor" stroke-width="1.4" />
      <path d="m5.3 6.1 2.2 1.9-2.2 1.9M8.5 9.9h2.4" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" />
    </Svg>
  )
}
