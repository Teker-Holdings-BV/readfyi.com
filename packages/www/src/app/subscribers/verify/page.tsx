"use client";

import { Suspense, useEffect, useState } from "react";

const PAYMENT_LINK = process.env.NEXT_PUBLIC_CLAUDE_ACTUALLY_PAYMENT_LINK;

function ClaudeActuallyOffer({ subscriberUuid }: { subscriberUuid: string | null }) {
  if (!PAYMENT_LINK) return null;

  const url = new URL(PAYMENT_LINK);
  // Ties the Stripe payment back to the subscriber (visible on the payment in Stripe).
  if (subscriberUuid) url.searchParams.set("client_reference_id", subscriberUuid);

  return (
    <section style={{ marginTop: "2rem", padding: "1.5rem", border: "1px solid currentColor", borderRadius: 8 }}>
      <a href={url.toString()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
        <img
          src="/img/offers/claude-actually.png"
          alt="Claude, Actually ebook cover"
          width={1983}
          height={793}
          style={{ display: "block", width: "100%", height: "auto", marginBottom: "1rem" }}
        />
      </a>
      <h2>One-time offer for new subscribers</h2>
      <p>
        <strong>Claude, Actually</strong>: a no-nonsense guide to getting real work done with Claude.
        Get the full ebook (PDF) for just <strong>$5</strong>.
      </p>
      <p>
        <a href={url.toString()}>Get the ebook for $5 →</a>
      </p>
      <p>
        <small>
          30-day money-back guarantee. If it isn&apos;t useful, reply to any of our emails within
          30 days and we&apos;ll refund you.
        </small>
      </p>
    </section>
  );
}

function VerifySubscriberPageContent() {
  const [isLoading, setIsLoading] = useState(true);

  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  const tokenParam = searchParams.get("token");

  useEffect(() => {
    (async () => {
      try {
        await fetch(
          `${process.env.NEXT_PUBLIC_API_HOST}/subscribers/${tokenParam}/verify`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, [tokenParam]);

  return (
    <>
      <h1>Confirm subscription</h1>
      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <>
          <p>Done! You&apos;re good to go!</p>
          <ClaudeActuallyOffer subscriberUuid={tokenParam} />
        </>
      )}
    </>
  );
}

export default function VerifySubscriberPage() {
  return (
    <Suspense fallback={<><h1>Confirm subscription</h1><p>Loading...</p></>}>
      <VerifySubscriberPageContent />
    </Suspense>
  );
}
