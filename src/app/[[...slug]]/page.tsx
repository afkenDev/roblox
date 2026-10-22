import { notFound } from "next/navigation";
import { Studio } from "@/components/studio";
const pages = ["dashboard", "games", "tasks", "agents", "activity", "settings"];
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = slug?.[0] ?? "dashboard";
  if ((slug?.length ?? 0) > 1 || !pages.includes(page)) notFound();
  return <Studio page={page} />;
}
