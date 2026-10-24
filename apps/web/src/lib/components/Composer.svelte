<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import Icon from "./Icon.svelte";
  import { ArrowUp02Icon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";

  let text = $state("");
  let el = $state<HTMLTextAreaElement | null>(null);
  let composing = false;

  const canSend = $derived(text.trim().length > 0);

  function grow() {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function submit() {
    const value = text.trim();
    if (!value) return;
    text = "";
    queueMicrotask(grow);
    await harness.send(value);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !composing && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<form
  class="border-border bg-bar flex shrink-0 items-end gap-2 border-t p-3 pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
  onsubmit={(e) => {
    e.preventDefault();
    void submit();
  }}
>
  <label class="sr-only" for="composer">Message the agent</label>
  <Textarea
    id="composer"
    bind:ref={el}
    bind:value={text}
    {onkeydown}
    oninput={grow}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => (composing = false)}
    rows={1}
    placeholder={harness.running ? "Agent is working. Messages queue." : "Message the agent"}
    class="max-h-40 min-h-11 resize-none py-3 md:min-h-10 md:py-2.5"
    maxlength={8000}
  />
  <Button type="submit" size="icon" class="size-11 shrink-0 md:size-10" disabled={!canSend} aria-label="Send message">
    <Icon icon={ArrowUp02Icon} strokeWidth={2.2} />
  </Button>
</form>
