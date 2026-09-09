"use client";

import * as React from "react";
import { Segmented } from "@/components/ui/segmented";

export function BillingToggle() {
  const [cycle, setCycle] = React.useState<"monthly" | "yearly">("monthly");
  return (
    <Segmented
      label="Billing cycle"
      value={cycle}
      onChange={setCycle}
      options={[
        { value: "monthly", label: "Monthly" },
        { value: "yearly", label: "Yearly · 2 months free" },
      ]}
    />
  );
}
