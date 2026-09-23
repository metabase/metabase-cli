import { Button as ButtonPrimitive } from "@base-ui/react/button";

// A button that brings no look of its own, for a row or a pill whose composite styles the whole
// hit area; it still gives the keyboard, the focus ring and the disabled state the primitive gives.
function PlainButton(props: ButtonPrimitive.Props) {
  return <ButtonPrimitive data-slot="plain-button" {...props} />;
}

export { PlainButton };
