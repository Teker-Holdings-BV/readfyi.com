"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./verify.module.css";

const PAYMENT_LINK = process.env.NEXT_PUBLIC_CLAUDE_ACTUALLY_PAYMENT_LINK;

// How long the confirmation stands on its own before the offer appears.
const OFFER_DELAY_MS = 2200;

type Status = "loading" | "confirmed" | "error";

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
          <h2 className={styles.offerTitle}>Get useful answers from Claude on the first try</h2>
          <p className={styles.lead}>
            A plain-English guide for professionals who want AI to take busywork
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
      <p className={styles.guarantee}>
        Not useful? Reply to any of our emails within 30 days and get your $1 back.
      </p>
      <p className={styles.fineprint}>
        Secure checkout by Stripe · Independent guide, not affiliated with Anthropic
      </p>
    </section>
  );
}

function VerifySubscriberPageContent() {
  const [status, setStatus] = useState<Status>("loading");
  const [showOffer, setShowOffer] = useState(false);

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
        setStatus(res.ok ? "confirmed" : "error");
      } catch {
        setStatus("error");
      }
    })();
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
