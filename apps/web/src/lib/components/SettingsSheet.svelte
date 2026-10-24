<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { toast } from "svelte-sonner";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import Icon from "./Icon.svelte";
  import NumberField from "./NumberField.svelte";
  import { Cancel01Icon, Loading03Icon } from "$lib/icons";
  import { harness } from "$lib/store.svelte";
  import {
    RISK_GROUPS,
    buildPatch,
    isEmptyPatch,
    parseTickers,
    toForm,
    validate,
    type SettingsForm,
  } from "$lib/settingsForm";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const saved = $derived(harness.status?.settings);
  let form = $state<SettingsForm | null>(null);
  let formError = $state<string | null>(null);
  let saving = $state(false);
  let tickerInput = $state("");
  let tickerError = $state<string | null>(null);
  let confirmDisconnect = $state(false);

  // Fresh copy of the saved settings each time the sheet opens.
  $effect(() => {
    if (open && saved && !form) form = toForm(saved);
    if (!open) {
      form = null;
      formError = null;
      tickerInput = "";
      tickerError = null;
    }
  });

  const clientErrors = $derived(form ? validate(form) : {});
  const errors = $derived(clientErrors);
  const patch = $derived(saved && form ? buildPatch(saved, form) : {});
  const dirty = $derived(!isEmptyPatch(patch));
  const changeCount = $derived(
    Object.keys(patch).filter((k) => k !== "risk").length + Object.keys(patch.risk ?? {}).length,
  );
  const canSave = $derived(dirty && Object.keys(clientErrors).length === 0 && !saving);

  function addTickers() {
    if (!form) return;
    const { added, rejected } = parseTickers(tickerInput, form.watchlist);
    form.watchlist = [...form.watchlist, ...added];
    tickerError = rejected.length ? `Not a ticker: ${rejected.join(", ")}` : null;
    tickerInput = rejected.join(" ");
  }

  async function save() {
    if (!form || !canSave) return;
    saving = true;
    formError = null;
    try {
      await harness.patchSettings(patch);
      toast.success("Settings saved");
      if (saved) form = toForm(saved);
    } catch (e) {
      formError = e instanceof Error ? e.message : "Could not save settings";
    } finally {
      saving = false;
    }
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" class="data-[side=right]:w-full data-[side=right]:sm:max-w-lg gap-0">
    <Sheet.Header class="border-border border-b">
      <Sheet.Title>Settings</Sheet.Title>
      <Sheet.Description class="sr-only">Watchlist, cadence and risk limits</Sheet.Description>
    </Sheet.Header>

    {#if form}
      <form
        id="settings-form"
        class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section class="flex flex-col gap-2.5" aria-labelledby="s-watch">
          <h3 id="s-watch" class="label-caps">Watchlist</h3>
          <ul class="flex flex-wrap gap-1.5">
            {#each form.watchlist as t (t)}
              <li class="bg-secondary num flex h-8 items-center gap-1 rounded-md pr-1 pl-2.5 text-[12.5px] font-medium">
                {t}
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 place-items-center rounded"
                  aria-label={`Remove ${t}`}
                  onclick={() => form && (form.watchlist = form.watchlist.filter((x) => x !== t))}
                >
                  <Icon icon={Cancel01Icon} class="size-3.5" />
                </button>
              </li>
            {:else}
              <li class="text-muted-foreground text-[13px]">No tickers</li>
            {/each}
          </ul>
          <div class="flex gap-2">
            <Label for="ticker-add" class="sr-only">Add tickers</Label>
            <Input
              id="ticker-add"
              bind:value={tickerInput}
              placeholder="Add tickers"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              class="num h-10 md:h-9"
              aria-invalid={tickerError ? true : undefined}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTickers();
                }
              }}
            />
            <Button type="button" variant="outline" class="h-10 md:h-9" disabled={!tickerInput.trim()} onclick={addTickers}>Add</Button>
          </div>
          {#if tickerError || errors.watchlist}<p class="text-destructive text-[12px]">{tickerError ?? errors.watchlist}</p>{/if}
        </section>

        <section class="flex flex-col gap-3" aria-labelledby="s-cad">
          <h3 id="s-cad" class="label-caps">Cycle cadence</h3>
          <div class="grid grid-cols-2 gap-3">
            <NumberField id="f-open" label="Market open" unit="min" step="5" bind:value={form.cycleMinutesOpen} error={errors.cycleMinutesOpen} />
            <NumberField id="f-closed" label="Market closed" unit="min" step="30" bind:value={form.cycleMinutesClosed} error={errors.cycleMinutesClosed} />
          </div>
        </section>

        {#each RISK_GROUPS as group (group.title)}
          <section class="flex flex-col gap-3" aria-labelledby={`s-${group.title}`}>
            <h3 id={`s-${group.title}`} class="label-caps">{group.title}</h3>
            <div class="grid grid-cols-2 gap-3">
              {#each group.fields as f (f.key)}
                <NumberField
                  id={`f-${f.key}`}
                  label={f.label}
                  unit={f.unit}
                  step={f.step}
                  bind:value={form.risk[f.key]}
                  error={errors[`risk.${f.key}`]}
                />
              {/each}
            </div>
          </section>
        {/each}

        {#if harness.status?.broker.state === "connected"}
          <section class="border-border flex items-center justify-between gap-3 border-t pt-4">
            <span class="text-[13px] font-medium">Robinhood</span>
            <Button type="button" variant="outline" class="h-10 md:h-9" onclick={() => (confirmDisconnect = true)}>Disconnect</Button>
          </section>
        {/if}
      </form>

      <Sheet.Footer class="border-border pb-safe flex-col gap-2 border-t sm:flex-col">
        {#if formError}<p class="text-destructive text-[12.5px]" role="alert">{formError}</p>{/if}
        <div class="flex gap-2">
          <Button type="submit" form="settings-form" class="h-10 flex-1" disabled={!canSave}>
            {#if saving}<Icon icon={Loading03Icon} class="size-4 animate-spin" />{/if}
            {dirty ? `Save ${changeCount} change${changeCount === 1 ? "" : "s"}` : "Save"}
          </Button>
          <Button type="button" variant="ghost" class="h-10" disabled={!dirty || saving} onclick={() => saved && (form = toForm(saved))}>
            Revert
          </Button>
        </div>
      </Sheet.Footer>
    {:else}
      <div class="text-muted-foreground p-4 text-[13px]">Settings unavailable until the server responds.</div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<ConfirmDialog
  bind:open={confirmDisconnect}
  title="Disconnect Robinhood?"
  description="The agent keeps researching but cannot read the account or place orders until you reconnect."
  confirmLabel="Disconnect"
  destructive
  onconfirm={() => harness.disconnectRobinhood()}
/>
