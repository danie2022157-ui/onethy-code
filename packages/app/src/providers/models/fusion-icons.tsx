import type { ComponentProps } from "solid-js"

export function BoltIcon(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={props.class ?? "size-3.5 shrink-0"}
    >
      <path
        d="M9 1.75L3.25 9H7.75L7 14.25L12.75 7H8.25L9 1.75Z"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
