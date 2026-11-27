"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { TrackingEventEnum, useTracking } from "@teker-holdings-bv/tracking";
import type { MetaClickIds } from "@readfyi/shared";
import styles from "./verify.module.css";

const PAYMENT_LINK = process.env.NEXT_PUBLIC_CLAUDE_ACTUALLY_PAYMENT_LINK;

// How long the confirmation stands on its own before the offer appears.
const OFFER_DELAY_MS = 500;

type Status = "loading" | "confirmed" | "error";

/**
 * The link is usually opened in an email app's browser, without the Meta
 * cookies from signup. track() reads them from the cookies, so restore them.
 */
const restoreMetaCookies = ({ fbc, fbp }: MetaClickIds) => {
  const maxAge = 90 * 24 * 60 * 60; // Meta's own cookie lifetime
  if (fbc) document.cookie = `_fbc=${fbc}; path=/; max-age=${maxAge}; SameSite=Lax`;
  if (fbp) document.cookie = `_fbp=${fbp}; path=/; max-age=${maxAge}; SameSite=Lax`;
};

function ConfirmedHeader({ compact }: { compact: boolean }) {
  return (
    <div className={`${styles.confirmed} ${compact ? styles.confirmedCompact : ""}`}>
      <svg className={styles.check} viewBox="0 0 56 56" fill="none" strokeWidth="3" aria-hidden>
        <circle className={styles.checkCircle} cx="28" cy="28" r="25" />
        <path className={styles.checkMark} d="M17 29l7 7 15-15" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <h1>You&apos;re in.</h1>
        <p className={styles.subline}>Your subscription is confirmed.</p>
      </div>
    </div>
  );
}

function ClaudeActuallyOffer({
  paymentLink,
  subscriberUuid,
}: {
  paymentLink: string;
  subscriberUuid: string | null;
}) {
  const url = new URL(paymentLink);
  // Ties the Stripe payment back to the subscriber (visible on the payment in Stripe).
  if (subscriberUuid) url.searchParams.set("client_reference_id", subscriberUuid);

  return (
    <section className={styles.offer} aria-live="polite">
      <p className={styles.eyebrow}>$1: a thank-you price for subscribers</p>
      <div className={styles.intro}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
        <img
          className={styles.cover}
          src="/img/offers/claude-actually-thumb.png"
          alt="Claude, Actually ebook cover"
          width={264}
          height={400}
        />
        <div>
          <h2 className={styles.offerTitle}>Get the answer you need from Claude on the first try</h2>
          <p className={styles.lead}>
            A guide for professionals who want AI to take busywork
            off their plate.
          </p>
          <p className={styles.facts}>32 pages · 15 chapters · PDF</p>
        </div>
      </div>
      <ul className={styles.inside}>
        <li>
          <strong>Stop re-asking.</strong> Why context beats clever phrasing, with prompts to copy.
        </li>
        <li>
          <strong>Write faster.</strong> The email you&apos;ve been avoiding, and the tricky ones that need a second look.
        </li>
        <li>
          <strong>Hand off the busywork.</strong> First drafts of proposals, meeting prep, summaries and to-do lists.
        </li>
      </ul>
      <div className={styles.actions}>
        <a className={styles.cta} href={url.toString()}>
          Get the PDF for $1
        </a>
        <Link className={styles.decline} href="/">
          No thanks
        </Link>
      </div>
      <div className={styles.guarantee}>
        <svg className={styles.guaranteeIcon} viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden>
          <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" strokeLinejoin="round" />
          <path d="M8.5 12l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p>
          <strong>30-day money-back guarantee</strong>
          <br />
          Not useful? Reply to any of our emails for a full refund.
        </p>
      </div>
      <p className={styles.fineprint}>
        Secure checkout by Stripe · Independent guide, not affiliated with Anthropic
      </p>
    </section>
  );
}

function VerifySubscriberPageContent() {
  const [status, setStatus] = useState<Status>("loading");
  const [showOffer, setShowOffer] = useState(false);
  const { track } = useTracking();

  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  const tokenParam = searchParams.get("token");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_HOST}/subscribers/${tokenParam}/verify`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
        if (!res.ok) return setStatus("error");

        // Empty when the subscription was already confirmed: don't track twice.
        const body = await res.text();
        if (body) {
          restoreMetaCookies(JSON.parse(body) as MetaClickIds);
          track(TrackingEventEnum.Subscribe);
        }
        setStatus("confirmed");
      } catch {
        setStatus("error");
      }
    })();
    // track() is a new function on every render: verify once per token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam]);

  useEffect(() => {
    if (status !== "confirmed" || !PAYMENT_LINK) return;
    const timer = setTimeout(() => setShowOffer(true), OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "loading") {
    return (
      <>
        <h1>Confirming your subscription…</h1>
        <p>One moment.</p>
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        <h1>Something went wrong</h1>
        <p>We couldn&apos;t confirm your subscription. Please try the link in your email again.</p>
      </>
    );
  }

  return (
    <>
      <ConfirmedHeader compact={showOffer} />
      {showOffer && PAYMENT_LINK && (
        <ClaudeActuallyOffer paymentLink={PAYMENT_LINK} subscriberUuid={tokenParam} />
      )}
    </>
  );
}

export default function VerifySubscriberPage() {
  return (
    <Suspense fallback={<><h1>Confirming your subscription…</h1><p>One moment.</p></>}>
      <VerifySubscriberPageContent />
    </Suspense>
  );
}
