"use client";

import { TrackingEventEnum, useTracking } from "@teker-holdings-bv/tracking";
import { useEffect } from "react";

const TRACKED_KEY = "readfyi-purchase-tracked-claude-actually";

/** Fires Purchase when the thank-you page (Stripe's redirect) loads. */
export default function TrackPurchase() {
  const { track } = useTracking();

  useEffect(() => {
    // Once per browser: readers come back to this page to download again.
    if (localStorage.getItem(TRACKED_KEY)) return;
    localStorage.setItem(TRACKED_KEY, new Date().toISOString());
    void track(TrackingEventEnum.Purchase);
    // track() is a new function on every render: fire on load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
