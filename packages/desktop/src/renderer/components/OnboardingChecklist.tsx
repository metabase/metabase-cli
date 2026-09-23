import { Check, ChevronRight, Circle } from "lucide-react";
import type { ReactElement } from "react";

import type { OnboardingStep } from "@/onboarding";
import type { SettingsSection } from "@/settings-sections";

import { Button } from "./ui/button";

interface OnboardingChecklistProps {
  readonly steps: readonly OnboardingStep[];
  readonly onOpen: (section: SettingsSection) => void;
}

export function OnboardingChecklist({ steps, onOpen }: OnboardingChecklistProps): ReactElement {
  return (
    <section className="w-96 rounded-card bg-surface p-6 shadow-card">
      <h1 className="text-title font-semibold text-ink">Finish setting up</h1>
      <ul className="mt-3 flex flex-col gap-1">
        {steps.map((step) => (
          <li key={step.id}>
            <Button
              variant="ghost"
              className="h-auto w-full justify-between px-2 py-2"
              onClick={() => {
                onOpen(step.section);
              }}
            >
              <span className="flex items-center gap-2">
                {step.done ? (
                  <Check aria-hidden className="size-4 text-green" />
                ) : (
                  <Circle aria-hidden className="size-4 text-ink-3" />
                )}
                <span className={step.done ? "text-ink-2 line-through" : "text-ink"}>
                  {step.label}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 text-ink-3" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
