import type { Metadata } from "next";
import TrackPurchase from "./TrackPurchase";
import styles from "./thanks.module.css";

// Unlisted page: Stripe redirects here after a successful payment.
export const metadata: Metadata = {
  title: "Thanks for your purchase",
  robots: { index: false, follow: false },
};

const DOWNLOAD_PATH = "/d/ca897aa2bfd2fd4be8d84057/claude-actually-compressed.pdf";

export default function ClaudeActuallyThanksPage() {
  return (
    <section className={styles.card}>
      <TrackPurchase />
      <h1 className={styles.title}>Thank you!</h1>
      <p className={styles.lead}>
        Your copy of <strong>Claude, Actually</strong> is ready.
      </p>
      <p className={styles.download}>
        <a className={styles.cta} href={DOWNLOAD_PATH} download="Claude, Actually.pdf">
          Download the ebook (PDF)
        </a>
      </p>
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
    </section>
  );
}
