import { createContext, useContext, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/cn";

type StripEdge = "leading" | "trailing" | "both";

const EDGE_CLASS: Readonly<Record<StripEdge, string>> = {
  leading: "window-strip-leading",
  trailing: "window-strip-trailing",
  both: "window-strip-leading window-strip-trailing",
};

interface WindowStripProps extends ComponentProps<"header"> {
  // The edges of the window this strip reaches, which the operating system's buttons may cover.
  readonly edge?: StripEdge;
}

// What the window's trailing corner holds when the column beneath it has nothing of its own there:
// the side panel's toggle while the panel is closed. A strip inside it reaches that corner.
const TrailingCorner = createContext<ReactNode>(null);

// The top of a column. Together the strips are the window's title bar: dragging one moves the
// window and every control inside stays clickable. Main sizes the overlay and centres the traffic
// lights on this height.
function WindowStrip({ edge, className, children, ...props }: WindowStripProps) {
  const corner = useContext(TrailingCorner);
  const reach = corner === null ? edge : "trailing";
  return (
    <header
      data-slot="window-strip"
      className={cn(
        "window-strip flex h-12 shrink-0 items-center border-b border-line",
        reach === undefined ? null : EDGE_CLASS[reach],
        className,
      )}
      {...props}
    >
      {children}
      {corner === null ? null : <div className="ml-auto flex shrink-0 items-center">{corner}</div>}
    </header>
  );
}

export { TrailingCorner, WindowStrip };
