import type { Metadata } from "next";
import TrackPurchase from "./TrackPurchase";

// Unlisted page: Stripe redirects here after a successful payment.
export const metadata: Metadata = {
  title: "Thanks for your purchase",
  robots: { index: false, follow: false },
};

const DOWNLOAD_PATH = "/d/ca897aa2bfd2fd4be8d84057/claude-actually-compressed.pdf";

export default function ClaudeActuallyThanksPage() {
  return (
    <>
      <TrackPurchase />
      <h1>Thank you!</h1>
      <p>Your copy of <strong>Claude, Actually</strong> is ready.</p>
      <p>
        <a href={DOWNLOAD_PATH} download="Claude, Actually.pdf">
          Download the ebook (PDF)
        </a>
      </p>
      <p>
        <small>
          30-day money-back guarantee. If it isn&apos;t useful, reply to any of our emails within
          30 days and we&apos;ll refund you.
        </small>
      </p>
    </>
  );
}
