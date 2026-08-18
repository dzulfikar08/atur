import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommentEditor from "@/components/editor/CommentEditor";

const MEMBERS = [
  { id: "u1", username: "alice", display_name: "Alice", email: "alice@x.com" },
  { id: "u2", username: "bob", display_name: "Bob", email: "bob@x.com" },
  { id: "u3", username: "carol", display_name: "Carol", email: "carol@x.com" },
];

function editorEl() {
  const el = document.querySelector(".tiptap");
  if (!el) throw new Error("tiptap editor not mounted");
  return el as HTMLElement;
}

describe("CommentEditor mention picker", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the @ mention picker filtered by query", async () => {
    const user = userEvent.setup();
    render(<CommentEditor value="" onChange={() => {}} members={MEMBERS} />);

    const editor = editorEl();
    editor.focus();
    await user.type(editor, "@al");

    expect(await screen.findByText("@alice")).toBeTruthy();
    expect(screen.queryByText("@bob")).toBeNull();
  });

  it("inserts a mention chip on selection", async () => {
    const user = userEvent.setup();
    let html = "";
    render(<CommentEditor value="" onChange={(h) => (html = h)} members={MEMBERS} />);

    const editor = editorEl();
    editor.focus();
    await user.type(editor, "@a");

    const item = await screen.findByText("@alice");
    await user.click(item);

    expect(editor.innerHTML).toContain("@alice");
    expect(html).toContain('data-mention-id="u1"');
    expect(html).toContain("@alice");
  });

  it("pickup works when members arrive after the editor mounts (async load)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CommentEditor value="" onChange={() => {}} members={[]} />);

    const editor = editorEl();
    editor.focus();
    // Members resolve asynchronously after mount — simulate the parent
    // receiving them.
    rerender(<CommentEditor value="" onChange={() => {}} members={MEMBERS} />);

    await user.type(editor, "@ca");

    expect(await screen.findByText("@carol")).toBeTruthy();
  });
});
