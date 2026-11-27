"use client";

import { useMetrics } from "@readfyi/shared";
import { useEffect, useState } from "react";
import styles from "./ReaderCount.module.css";

const COUNT_UP_MS = 1400;
const formatter = new Intl.NumberFormat("en-US");

// Gentle ease-out: a steeper curve (like expo) covers most of the count in
// the first ~150ms, which reads as instant.
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

/**
 * Counts from 0 up to `target` once it arrives. Skips the animation when the
 * value was already cached on first render, or the reader prefers less motion.
 */
const useCountUp = (target: number | undefined) => {
  // Captured once: a value cached by SWR on first render is shown as is.
  const [hadValueOnMount] = useState(target !== undefined);
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (target === undefined || hadValueOnMount) return;
    if (prefersReducedMotion()) return;

    let frame: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_UP_MS);
      setAnimated(Math.round(easeOutQuad(progress) * target));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [target, hadValueOnMount]);

  if (target === undefined) return 0;
  if (hadValueOnMount || prefersReducedMotion()) return target;
  return animated;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "Join 1,234 readers" with the count from GET /metrics. */
const ReaderCount: React.FC = () => {
  const { metrics, isFetching } = useMetrics();
  const target = metrics?.subscribers;
  const value = useCountUp(target);

  // A failed request or an empty list reads better as the old wording.
  if (!isFetching && !target) return <>Join other readers</>;

  const finalText = target !== undefined ? formatter.format(target) : "";

  return (
    <span className={styles.root}>
      Join
      {isFetching ? (
        <span className={styles.placeholder} aria-label="Loading reader count" />
      ) : (
        <span
          className={styles.count}
          data-done={value === target}
          // Reserve the final width up front so the line does not grow as it counts.
          style={{ minWidth: `${finalText.length}ch` }}
          aria-label={finalText}
        >
          {formatter.format(value)}
        </span>
      )}
      readers
    </span>
  );
};

export default ReaderCount;
