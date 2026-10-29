import {
  MetabaseTestProvider,
  type MetabaseTestProviderProps,
} from "@metabase/embedding-sdk-react/testing";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderWithProviders(ui: ReactElement, options: MetabaseTestProviderProps = {}) {
  return render(<MetabaseTestProvider {...options}>{ui}</MetabaseTestProvider>);
}
