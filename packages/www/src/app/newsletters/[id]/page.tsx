import SignupForm from "@/app/components/SignupForm";
import { NewsletterEnum } from "@readfyi/shared";
import { ROLE_PAGES } from "../role-pages";

export function generateStaticParams() {
  return [...Object.values(NewsletterEnum), ...Object.keys(ROLE_PAGES)].map(
    (id) => ({ id }),
  );
}

export default async function NewsletterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rolePage = ROLE_PAGES[id];
  if (rolePage) {
    return (
      <SignupForm newsletter={rolePage.newsletter} title={rolePage.title} />
    );
  }
  return <SignupForm newsletter={id as NewsletterEnum} />;
}
