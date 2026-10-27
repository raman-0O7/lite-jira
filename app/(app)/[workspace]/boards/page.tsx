import { redirect } from "next/navigation";

// Feature 06 URL; projects replaced boards in Feature 07.
export default async function LegacyBoardsRedirect({
  params,
}: PageProps<"/[workspace]/boards">) {
  redirect(`/${(await params).workspace}/projects`);
}
