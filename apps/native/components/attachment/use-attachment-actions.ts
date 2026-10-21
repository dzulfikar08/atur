import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { openAttachment, shareAttachment, type AttachmentRef } from "@/lib/attachment-file";

export interface AttachmentActions {
  /** Download, then the system share sheet (iOS: includes "Open in…"). */
  share: UseMutationResult<void, Error, void>;
  /** Download, then view in another app (Android ACTION_VIEW; iOS share sheet). */
  open: UseMutationResult<void, Error, void>;
}

export function useAttachmentActions(att: AttachmentRef): AttachmentActions {
  const share = useMutation<void, Error, void>({ mutationFn: () => shareAttachment(att) });
  const open = useMutation<void, Error, void>({ mutationFn: () => openAttachment(att) });
  return { share, open };
}
