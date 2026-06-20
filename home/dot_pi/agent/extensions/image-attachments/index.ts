/**
 * Inline image attachment UX for pi.
 *
 * Environment note: this extension is intended for Kitty-compatible graphics
 * running through tmux with the tmux-kitty-images infrastructure enabled. It
 * assumes terminal image rendering is already handled elsewhere and does not
 * implement Kitty/tmux graphics transport itself.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installAtomicPlaceholder } from "./atomic-placeholder";
import { installDraftAttachments } from "./draft-attachments";
import { installDraftPreview } from "./draft-preview";
import { installPruneOnRequest } from "./prune-on-request";
import { installSubmittedRendering } from "./submitted-rendering";
import { installSubmitGuards } from "./submit-guards";
import { installTransientLabels } from "./transient-labels";

export default function (pi: ExtensionAPI) {
  const drafts = installDraftAttachments(pi);

  installPruneOnRequest(pi);
  installTransientLabels(pi);
  installSubmitGuards(drafts);
  installSubmittedRendering();
  installDraftPreview(pi, drafts);
  installAtomicPlaceholder(drafts);
}
