import { createUniqueId, type ComponentProps } from "solid-js"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 904 129"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            {/* O */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M55.3846 36.4286H18.4615V91.7143H55.3846V36.4286ZM73.8462 110.143H0V18H73.8462V110.143Z"
            />
            {/* N */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M147.385 36.4286H110.462V110.143H92V18H147.385V36.4286ZM165.846 110.143H147.385V36.4286H165.846V110.143Z"
            />
            {/* E */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M258.846 73.2857H203.462V91.7143H258.846V110.143H185V18H258.846V73.2857ZM203.462 54.8571H240.385V36.4286H203.462V54.8571Z"
            />
            {/* T */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M350.846 36.4286H323.154V110.143H304.692V36.4286H277V18H350.846V36.4286Z"
            />
            {/* H */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M387.462 18V54.8571H424.385V18H442.846V110.143H424.385V73.2857H387.462V110.143H369V18H387.462Z"
            />
            {/* Y */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M480.462 18V54.8571H517.385V18H535.846V73.2857H508.154V110.143H489.692V73.2857H462V18H480.462Z"
            />
            {/* C */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M627.846 36.4286H572.462V91.7143H627.846V110.143H554V18H627.846V36.4286Z"
            />
            {/* O */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M701.385 36.4286H664.462V91.7143H701.385V36.4286ZM719.846 110.143H646V18H719.846V110.143Z"
            />
            {/* D */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M793.385 36.8571H756.462V92.1429H793.385V36.8571ZM811.846 110.571H738V18.4286H793.385V0H811.846V110.571Z"
            />
            {/* E */}
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M848.462 36.4286V54.8571H885.385V36.4286H848.462ZM903.846 73.2857H848.462V91.7143H903.846V110.143H830V18H903.846V73.2857Z"
            />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="904" height="129">
          <rect width="904" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="452" y1="68" x2="452" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
