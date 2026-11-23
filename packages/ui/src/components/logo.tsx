import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        data-slot="logo-logo-mark-shadow"
        d="M10 6L14 8.5V13.5L10 16L6 13.5V8.5L10 6ZM10 8.2L7.8 9.5V12.5L10 13.8L12.2 12.5V9.5L10 8.2Z"
        fill="var(--icon-weak-base)"
      />
      <path
        data-slot="logo-logo-mark-o"
        d="M8.5 1C3.8 1 0 4.8 0 9.5C0 14.2 3.8 18 8.5 18C10.9 18 13.1 17 14.6 15.4C13.6 15.8 12.5 16.1 11.3 16.1C6.7 16.1 3 12.4 3 7.8C3 4.9 4.5 2.3 6.8 0.8C7.4 0.9 7.9 1 8.5 1Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M50 30L70 42.5V67.5L50 80L30 67.5V42.5L50 30ZM50 41L39 47.5V62.5L50 69L61 62.5V47.5L50 41Z"
        fill="var(--icon-base)"
      />
      <path
        d="M42.5 5C19 5 0 24 0 47.5C0 71 19 90 42.5 90C54.5 90 65.5 85 73 77C68 79 62.5 80.5 56.5 80.5C33.5 80.5 15 62 15 39C15 24.5 22.5 11.5 34 4C37 4.5 39.5 5 42.5 5Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 294 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        {/* O */}
        <path d="M18 30H6V18H18V30Z" fill="var(--icon-weak-base)" />
        <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" fill="var(--icon-base)" />
        {/* N */}
        <path d="M48 36H36V18H48V36Z" fill="var(--icon-weak-base)" />
        <path d="M48 12H36V36H30V6H48V12ZM54 36H48V12H54V36Z" fill="var(--icon-base)" />
        {/* E */}
        <path d="M84 24V30H66V24H84Z" fill="var(--icon-weak-base)" />
        <path d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" fill="var(--icon-base)" />
        {/* T */}
        <path d="M114 36H90V12H99V36ZM105 36V12H114V36Z" fill="var(--icon-weak-base)" />
        <path d="M114 12H105V36H99V12H90V6H114V12Z" fill="var(--icon-base)" />
        {/* H */}
        <path d="M138 36H126V24H138V36Z" fill="var(--icon-weak-base)" />
        <path d="M126 6V18H138V6H144V36H138V24H126V36H120V6H126Z" fill="var(--icon-base)" />
        {/* Y */}
        <path d="M168 18H156V6H168V18Z" fill="var(--icon-weak-base)" />
        <path d="M156 6V18H168V6H174V24H165V36H159V24H150V6H156Z" fill="var(--icon-base)" />
        {/* C */}
        <path d="M204 30H186V18H204V30Z" fill="var(--icon-weak-base)" />
        <path d="M204 12H186V30H204V36H180V6H204V12Z" fill="var(--icon-strong-base)" />
        {/* O */}
        <path d="M228 30H216V18H228V30Z" fill="var(--icon-weak-base)" />
        <path d="M228 12H216V30H228V12ZM234 36H210V6H234V36Z" fill="var(--icon-strong-base)" />
        {/* D */}
        <path d="M258 30H246V18H258V30Z" fill="var(--icon-weak-base)" />
        <path d="M258 12H246V30H258V12ZM264 36H240V6H258V0H264V36Z" fill="var(--icon-strong-base)" />
        {/* E */}
        <path d="M294 24V30H276V24H294Z" fill="var(--icon-weak-base)" />
        <path d="M276 12V18H288V12H276ZM294 24H276V30H294V36H270V6H294V24Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
