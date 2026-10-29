"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertUser } from "@/lib/auth";
import { run, str } from "@/lib/forms";
import { reportMessage, sendMessage, startWithManagement } from "@/lib/messaging";
import { deliverPending } from "@/lib/notify";
import type { ActionResult } from "@/components/action-form";

export async function sendMessageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const u = await assertUser();
    const id = str(fd, "conversationId");
    await sendMessage(u, id, str(fd, "body"));
    void deliverPending();
    revalidatePath(`/messages/${id}`);
    return { ok: "Sent" };
  });
}
export async function startConversationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await run(async () => { const u = await assertUser(); id = (await startWithManagement(u, str(fd, "subject"), str(fd, "body"))).id; return { ok: "Sent" }; });
  if (id) redirect(`/messages/${id}`);
  return r;
}
export async function reportMessageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => { const u = await assertUser(); await reportMessage(u, str(fd, "messageId"), str(fd, "reason")); return { ok: "Thank you — our team has been alerted and will review this." }; });
}
